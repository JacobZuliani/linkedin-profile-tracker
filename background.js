// Service worker: watches LinkedIn SPA navigations, dedupes, and stores rows.
//
// Storage strategy (works in Chrome AND Safari):
//   1. Every captured row is always saved to chrome.storage.local.rows.
//      The popup can download these as a CSV anytime.
//   2. On Chrome (where the File System Access API + offscreen documents exist),
//      we ALSO write each row to a user-chosen CSV file for auto-append behavior.
//      The file write is best-effort; storage is the source of truth.

const PROFILE_PATH_PREFIX = "/in/";
const OFFSCREEN_DOC = "offscreen.html";
const DEDUP_KEY = "seenUrls";
const ROWS_KEY = "rows";
const STATUS_KEY = "lastStatus";

// Safari doesn't implement chrome.offscreen; feature-detect it.
const OFFSCREEN_SUPPORTED = typeof chrome.offscreen !== "undefined";

async function ensureOffscreen() {
  if (!OFFSCREEN_SUPPORTED) return false;
  try {
    const existing = await chrome.offscreen.hasDocument?.();
    if (existing) return true;
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOC,
      reasons: ["BLOBS"],
      justification:
        "Holds the FileSystemFileHandle for the user-chosen CSV across service worker restarts."
    });
    return true;
  } catch (err) {
    if (!String(err).includes("Only a single offscreen")) {
      console.warn("[LPT] Offscreen creation failed:", err);
      return false;
    }
    return true;
  }
}

function normalizeProfileUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.origin}${path}`;
  } catch {
    return rawUrl;
  }
}

function isProfileUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== "www.linkedin.com") return false;
    if (!u.pathname.startsWith(PROFILE_PATH_PREFIX)) return false;
    const rest = u.pathname.slice(PROFILE_PATH_PREFIX.length).replace(/\/+$/, "");
    if (!rest || rest.includes("/")) return false;
    return true;
  } catch {
    return false;
  }
}

async function setStatus(text) {
  await chrome.storage.local.set({ [STATUS_KEY]: { text, at: Date.now() } });
}

async function handleProfileVisit(tabId, url) {
  if (!isProfileUrl(url)) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: "EXTRACT_PROFILE" });
  } catch {
    // Content script not loaded yet (e.g., just-installed). Inject and retry.
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"]
      });
      await chrome.tabs.sendMessage(tabId, { type: "EXTRACT_PROFILE" });
    } catch (innerErr) {
      console.warn("[LPT] Could not message content script:", innerErr);
    }
  }
}

chrome.webNavigation.onHistoryStateUpdated.addListener(
  (details) => {
    if (details.frameId !== 0) return;
    handleProfileVisit(details.tabId, details.url);
  },
  { url: [{ hostEquals: "www.linkedin.com", pathPrefix: PROFILE_PATH_PREFIX }] }
);

chrome.webNavigation.onCompleted.addListener(
  (details) => {
    if (details.frameId !== 0) return;
    handleProfileVisit(details.tabId, details.url);
  },
  { url: [{ hostEquals: "www.linkedin.com", pathPrefix: PROFILE_PATH_PREFIX }] }
);

async function appendRowToStorage(row) {
  const { [ROWS_KEY]: rows = [] } = await chrome.storage.local.get(ROWS_KEY);
  rows.push(row);
  await chrome.storage.local.set({ [ROWS_KEY]: rows });
  return rows.length;
}

async function tryWriteToFile(row) {
  if (!OFFSCREEN_SUPPORTED) return { skipped: true };
  const ready = await ensureOffscreen();
  if (!ready) return { skipped: true };
  try {
    const result = await chrome.runtime.sendMessage({ type: "APPEND_ROW", row });
    return result ?? { ok: false };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (
    ![
      "PROFILE_DATA",
      "REQUEST_STATUS",
      "REQUEST_ROWS",
      "CLEAR_DATA"
    ].includes(msg?.type)
  ) {
    return false;
  }

  (async () => {
    if (msg?.type === "PROFILE_DATA") {
      const normalized = normalizeProfileUrl(msg.data.url);
      const { [DEDUP_KEY]: seen = {} } = await chrome.storage.local.get(DEDUP_KEY);
      if (seen[normalized]) {
        sendResponse({ ok: true, duplicate: true });
        return;
      }
      seen[normalized] = Date.now();
      await chrome.storage.local.set({ [DEDUP_KEY]: seen });

      const row = { ...msg.data, url: normalized };
      const total = await appendRowToStorage(row);

      const fileResult = await tryWriteToFile(row);
      if (fileResult.ok) {
        await setStatus(`Saved ${normalized} (file + ${total} stored)`);
      } else if (fileResult.skipped) {
        await setStatus(`Saved ${normalized} (${total} stored; open popup to download)`);
      } else if (fileResult.needsPermission) {
        await setStatus(
          `Saved to storage (${total}). Click Resume in the popup to also write to your CSV.`
        );
      } else if (fileResult.noFile) {
        await setStatus(`Saved to storage (${total}). Pick a CSV file to enable auto-append.`);
      } else {
        await setStatus(`Saved to storage (${total}). File write skipped.`);
      }

      sendResponse({ ok: true, total });
      return;
    }

    if (msg?.type === "REQUEST_STATUS") {
      const data = await chrome.storage.local.get([ROWS_KEY, STATUS_KEY]);
      const rows = data[ROWS_KEY] ?? [];
      sendResponse({
        count: rows.length,
        status: data[STATUS_KEY] ?? null,
        offscreenSupported: OFFSCREEN_SUPPORTED
      });
      return;
    }

    if (msg?.type === "REQUEST_ROWS") {
      const { [ROWS_KEY]: rows = [] } = await chrome.storage.local.get(ROWS_KEY);
      sendResponse({ rows });
      return;
    }

    if (msg?.type === "CLEAR_DATA") {
      await chrome.storage.local.set({ [DEDUP_KEY]: {}, [ROWS_KEY]: [] });
      await setStatus("Cleared saved profiles and dedup history.");
      sendResponse({ ok: true });
      return;
    }
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  setStatus("Installed. Open the popup to get started.");
});
