// Service worker: watches LinkedIn SPA navigations and orchestrates extraction + file writes.

const PROFILE_PATH_PREFIX = "/in/";
const OFFSCREEN_DOC = "offscreen.html";
const DEDUP_KEY = "seenUrls";
const COUNTER_KEY = "sessionCount";
const STATUS_KEY = "lastStatus";

async function ensureOffscreen() {
  const existing = await chrome.offscreen.hasDocument?.();
  if (existing) return;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOC,
      reasons: ["BLOBS"],
      justification:
        "Holds the FileSystemFileHandle for the user-chosen CSV across service worker restarts."
    });
  } catch (err) {
    if (!String(err).includes("Only a single offscreen")) {
      console.error("[LPT] Failed to create offscreen document:", err);
    }
  }
}

function normalizeProfileUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    // Strip query and fragment; collapse trailing slash.
    let path = u.pathname.replace(/\/+$/, "");
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
    // Reject the "edit/" or "detail/" sub-paths under /in/handle/.
    const rest = u.pathname.slice(PROFILE_PATH_PREFIX.length).replace(/\/+$/, "");
    if (!rest) return false;
    if (rest.includes("/")) return false;
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
  } catch (err) {
    // Content script may not be loaded yet (e.g. extension was just installed).
    // Inject on the fly and try again.
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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

      await ensureOffscreen();
      const writeResult = await chrome.runtime
        .sendMessage({
          type: "APPEND_ROW",
          row: { ...msg.data, url: normalized }
        })
        .catch((e) => ({ ok: false, error: String(e) }));

      if (writeResult?.ok) {
        const { [COUNTER_KEY]: count = 0 } = await chrome.storage.local.get(COUNTER_KEY);
        await chrome.storage.local.set({ [COUNTER_KEY]: count + 1 });
        await setStatus(`Saved ${normalized}`);
      } else if (writeResult?.needsPermission) {
        await setStatus("Click the extension icon and press Resume to re-grant file access.");
      } else if (writeResult?.noFile) {
        await setStatus("No CSV chosen yet. Open the popup to pick a file.");
      } else {
        await setStatus(`Write failed: ${writeResult?.error ?? "unknown"}`);
      }

      sendResponse(writeResult ?? { ok: false });
      return;
    }

    if (msg?.type === "REQUEST_STATUS") {
      const data = await chrome.storage.local.get([COUNTER_KEY, STATUS_KEY]);
      sendResponse({
        count: data[COUNTER_KEY] ?? 0,
        status: data[STATUS_KEY] ?? null
      });
      return;
    }

    if (msg?.type === "CLEAR_DEDUP") {
      await chrome.storage.local.set({ [DEDUP_KEY]: {}, [COUNTER_KEY]: 0 });
      await setStatus("Cleared dedup history.");
      sendResponse({ ok: true });
      return;
    }
  })();
  return true; // keep the channel open for async response
});

chrome.runtime.onInstalled.addListener(() => {
  setStatus("Installed. Open the popup to choose your CSV file.");
});
