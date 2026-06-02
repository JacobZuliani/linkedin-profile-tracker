// Popup UI.
//
// Always available:
//   - "Download CSV" button: compiles stored rows into a CSV blob and downloads it.
//   - "Clear saved data" button: wipes stored rows and dedup history.
//
// Chrome-only (feature-detected via showSaveFilePicker):
//   - "Choose CSV file…" picks a file the extension will auto-append to.
//   - "Resume tracking" re-grants write permission after a browser restart.

const DB_NAME = "lpt-handles";
const STORE = "kv";
const HANDLE_KEY = "csvFileHandle";
const NAME_KEY = "csvFileName";

const HEADERS = ["url", "name", "headline", "company", "location", "timestamp"];

const HAS_FS_ACCESS = typeof window.showSaveFilePicker === "function";

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

async function dbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function dbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
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

function rowsToCsv(rows) {
  const lines = [HEADERS.join(",")];
  for (const row of rows) {
    lines.push(HEADERS.map((h) => csvEscape(row[h])).join(","));
  }
  return lines.join("\n") + "\n";
}

const $ = (id) => document.getElementById(id);
const fileSection = $("file-section");
const fileNameEl = $("file-name");
const pickBtn = $("pick-file");
const resumeBtn = $("resume");
const clearBtn = $("clear");
const downloadBtn = $("download");
const countEl = $("count");
const statusEl = $("status");

function setStatus(text, warn) {
  statusEl.textContent = text || "";
  statusEl.classList.toggle("warn", !!warn);
}

function renderFileName(name) {
  if (name) {
    fileNameEl.textContent = name;
    fileNameEl.classList.remove("empty");
  } else {
    fileNameEl.textContent = "No CSV file selected";
    fileNameEl.classList.add("empty");
  }
}

async function ensureOffscreen() {
  if (!chrome.offscreen) return;
  const exists = await chrome.offscreen.hasDocument?.();
  if (exists) return;
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["BLOBS"],
      justification:
        "Holds the FileSystemFileHandle for the user-chosen CSV across service worker restarts."
    });
  } catch (e) {
    if (!String(e).includes("Only a single offscreen")) throw e;
  }
}

async function activateFileHandle(handle) {
  await ensureOffscreen();
  await chrome.runtime.sendMessage({ type: "SET_HANDLE", handle });
}

async function syncStoredRowsToFile(handle) {
  const { rows } = (await chrome.runtime.sendMessage({ type: "REQUEST_ROWS" })) ?? { rows: [] };
  const writable = await handle.createWritable({ keepExistingData: false });
  await writable.write(rowsToCsv(rows));
  await writable.close();
  return rows.length;
}

async function refreshStatus() {
  const resp = await chrome.runtime.sendMessage({ type: "REQUEST_STATUS" });
  if (resp) {
    countEl.textContent = String(resp.count ?? 0);
    downloadBtn.disabled = (resp.count ?? 0) === 0;
    if (resp.status?.text) {
      const isWarn = /re-grant|failed|resume/i.test(resp.status.text);
      setStatus(resp.status.text, isWarn);
    } else {
      setStatus("Ready.");
    }
  }
  if (HAS_FS_ACCESS) {
    const fileName = await dbGet(NAME_KEY);
    renderFileName(fileName);
  }
}

downloadBtn.addEventListener("click", async () => {
  const { rows } = (await chrome.runtime.sendMessage({ type: "REQUEST_ROWS" })) ?? { rows: [] };
  if (!rows.length) {
    setStatus("Nothing to download yet — visit a LinkedIn profile first.", true);
    return;
  }
  const csv = rowsToCsv(rows);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `linkedin-profiles-${stamp}.csv`;

  try {
    if (chrome.downloads?.download) {
      await chrome.downloads.download({ url, filename, saveAs: true });
    } else {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setStatus(`Exported ${rows.length} rows.`);
  } catch (err) {
    setStatus(`Download failed: ${err.message || err}`, true);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
});

if (HAS_FS_ACCESS) {
  fileSection.classList.remove("hidden");

  pickBtn.addEventListener("click", async () => {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: "linkedin-profiles.csv",
        types: [{ description: "CSV file", accept: { "text/csv": [".csv"] } }]
      });

      const file = await handle.getFile();
      if (file.size === 0) {
        const writable = await handle.createWritable({ keepExistingData: false });
        await writable.write(HEADERS.join(",") + "\n");
        await writable.close();
      }

      await dbSet(HANDLE_KEY, handle);
      await dbSet(NAME_KEY, handle.name);
      renderFileName(handle.name);
      await activateFileHandle(handle);
      const synced = await syncStoredRowsToFile(handle);
      setStatus(`Auto-saving to ${handle.name}. Synced ${synced} stored rows.`);
    } catch (err) {
      if (err && err.name === "AbortError") return;
      setStatus(`Could not pick file: ${err.message || err}`, true);
    }
  });

  resumeBtn.addEventListener("click", async () => {
    const handle = await dbGet(HANDLE_KEY);
    if (!handle) {
      setStatus("Pick a CSV file first.", true);
      return;
    }
    try {
      const perm = await handle.requestPermission({ mode: "readwrite" });
      if (perm === "granted") {
        await dbSet(HANDLE_KEY, handle);
        await activateFileHandle(handle);
        const synced = await syncStoredRowsToFile(handle);
        setStatus(`Tracking resumed. Synced ${synced} stored rows.`);
      } else {
        setStatus("Permission denied.", true);
      }
    } catch (err) {
      setStatus(`Could not resume: ${err.message || err}`, true);
    }
  });
}

clearBtn.addEventListener("click", async () => {
  if (!confirm("Clear all saved profiles and dedup history? Your CSV file (if any) is untouched.")) {
    return;
  }
  await chrome.runtime.sendMessage({ type: "CLEAR_DATA" });
  await refreshStatus();
});

refreshStatus();
ensureOffscreen();
