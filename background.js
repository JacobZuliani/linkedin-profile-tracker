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
const MIN_PARSED_SECTIONS_TO_SAVE = 2;
const PROFILE_SECTION_KEYS = [
  "description",
  "work_history",
  "education",
  "licenses_certifications",
  "volunteering",
  "projects",
  "skills",
  "languages",
  "recommendations",
  "interests",
  "featured",
  "activity",
  "courses",
  "honors_awards",
  "publications",
  "patents",
  "organizations",
  "causes"
];

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

function cleanText(value) {
  return String(value || "").trim();
}

function rowCompletenessScore(row) {
  const sectionCount = PROFILE_SECTION_KEYS.filter((key) => cleanText(row[key])).length;
  const sectionLength = PROFILE_SECTION_KEYS.reduce(
    (total, key) => total + cleanText(row[key]).length,
    0
  );
  const basicCount = ["name", "headline", "company", "location"].filter((key) =>
    cleanText(row[key])
  ).length;

  return sectionCount * 100000 + sectionLength + basicCount * 100;
}

function parsedSectionCount(row) {
  return PROFILE_SECTION_KEYS.filter((key) => cleanText(row[key])).length;
}

function mergeRows(existing, incoming) {
  const merged = { ...existing, ...incoming };
  for (const [key, value] of Object.entries(existing)) {
    if (!cleanText(incoming[key]) && cleanText(value)) {
      merged[key] = value;
    }
  }
  return merged;
}

async function upsertRowToStorage(row) {
  const data = await chrome.storage.local.get([ROWS_KEY, DEDUP_KEY]);
  const rows = data[ROWS_KEY] ?? [];
  const seen = data[DEDUP_KEY] ?? {};
  const normalized = normalizeProfileUrl(row.url);
  const nextRow = { ...row, url: normalized };
  const existingIndex = rows.findIndex((candidate) => normalizeProfileUrl(candidate.url) === normalized);

  seen[normalized] = Date.now();

  if (existingIndex === -1) {
    rows.push(nextRow);
    await chrome.storage.local.set({ [ROWS_KEY]: rows, [DEDUP_KEY]: seen });
    return { rows, total: rows.length, added: true };
  }

  const existing = rows[existingIndex];
  const nextScore = rowCompletenessScore(nextRow);
  const existingScore = rowCompletenessScore(existing);
  if (nextScore <= existingScore) {
    await chrome.storage.local.set({ [DEDUP_KEY]: seen });
    return { rows, total: rows.length, duplicate: true };
  }

  rows[existingIndex] = mergeRows(existing, nextRow);
  await chrome.storage.local.set({ [ROWS_KEY]: rows, [DEDUP_KEY]: seen });
  return { rows, total: rows.length, updated: true };
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

async function trySyncFile(rows) {
  if (!OFFSCREEN_SUPPORTED) return { skipped: true };
  const ready = await ensureOffscreen();
  if (!ready) return { skipped: true };
  try {
    const result = await chrome.runtime.sendMessage({ type: "SYNC_ROWS", rows });
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
      const row = { ...msg.data, url: normalized };

      if (parsedSectionCount(row) < MIN_PARSED_SECTIONS_TO_SAVE) {
        await setStatus(`Skipped ${normalized}; profile sections are not loaded yet.`);
        sendResponse({ ok: true, skipped: true, incomplete: true });
        return;
      }

      const result = await upsertRowToStorage(row);

      if (result.duplicate) {
        sendResponse({ ok: true, duplicate: true });
        return;
      }

      const fileResult = result.updated
        ? await trySyncFile(result.rows)
        : await tryWriteToFile(row);

      const action = result.updated ? "Updated" : "Saved";
      if (fileResult.ok) {
        await setStatus(`${action} ${normalized} (file + ${result.total} stored)`);
      } else if (fileResult.skipped) {
        await setStatus(`${action} ${normalized} (${result.total} stored; open popup to download)`);
      } else if (fileResult.needsPermission) {
        await setStatus(
          `${action} storage (${result.total}). Click Resume in the popup to also write to your CSV.`
        );
      } else if (fileResult.noFile) {
        await setStatus(`${action} storage (${result.total}). Pick a CSV file to enable auto-append.`);
      } else {
        await setStatus(`${action} storage (${result.total}). File write skipped.`);
      }

      sendResponse({ ok: true, total: result.total, updated: result.updated });
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
