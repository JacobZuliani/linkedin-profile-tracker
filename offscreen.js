// Offscreen document: persists the FileSystemFileHandle and appends CSV rows.
// MV3 service workers can't hold OPFS/handle references reliably across restarts,
// so we keep the handle alive here.

const DB_NAME = "lpt-handles";
const STORE = "kv";
const HANDLE_KEY = "csvFileHandle";

const HEADERS = [
  "url",
  "name",
  "headline",
  "company",
  "location",
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
  "causes",
  "full_profile_text",
  "timestamp"
];
let activeHandle = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadHandle() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(HANDLE_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function saveHandle(handle) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowToCsv(row) {
  return HEADERS.map((h) => csvEscape(row[h])).join(",") + "\n";
}

async function ensureHeaders(handle) {
  const file = await handle.getFile();
  if (file.size > 0) return;
  const writable = await handle.createWritable({ keepExistingData: false });
  await writable.write(HEADERS.join(",") + "\n");
  await writable.close();
}

async function appendRow(handle, row) {
  // Read existing contents, then write existing + new line. The File System
  // Access API doesn't support true append on every platform, so this
  // read-then-write is the portable approach.
  const file = await handle.getFile();
  const existing = await file.text();
  const writable = await handle.createWritable({ keepExistingData: false });
  const headerPrefix = existing.length === 0 ? HEADERS.join(",") + "\n" : "";
  await writable.write(existing + headerPrefix + rowToCsv(row));
  await writable.close();
}

function isFileHandle(handle) {
  return (
    handle &&
    typeof handle.getFile === "function" &&
    typeof handle.createWritable === "function" &&
    typeof handle.queryPermission === "function" &&
    typeof handle.requestPermission === "function"
  );
}

async function verifyPermission(handle) {
  const opts = { mode: "readwrite" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  // requestPermission requires a user gesture; this will fail silently from
  // background contexts and succeed when triggered from the popup click.
  try {
    if ((await handle.requestPermission(opts)) === "granted") return true;
  } catch {}
  return false;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!["APPEND_ROW", "OFFSCREEN_PING", "SET_HANDLE"].includes(msg?.type)) {
    return false;
  }

  (async () => {
    try {
      if (msg?.type === "SET_HANDLE") {
        if (!isFileHandle(msg.handle)) {
          sendResponse({ ok: false, noFile: true });
          return;
        }
        activeHandle = msg.handle;
        await saveHandle(activeHandle);
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === "APPEND_ROW") {
        const handle = activeHandle || (await loadHandle());
        if (!handle) {
          sendResponse({ ok: false, noFile: true });
          return;
        }
        if (!isFileHandle(handle)) {
          activeHandle = null;
          sendResponse({ ok: false, noFile: true });
          return;
        }
        activeHandle = handle;
        const ok = await verifyPermission(handle);
        if (!ok) {
          sendResponse({ ok: false, needsPermission: true });
          return;
        }
        await ensureHeaders(handle);
        await appendRow(handle, msg.row);
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === "OFFSCREEN_PING") {
        sendResponse({ ok: true });
        return;
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
    }
  })();
  return true;
});
