// Popup: lets the user pick the CSV file once, re-grants permission after
// browser restarts, and shows current status.
//
// The File System Access API requires a user gesture for showSaveFilePicker and
// for handle.requestPermission. Both must happen here in the popup (or another
// visible page), never in the background service worker.

const DB_NAME = "lpt-handles";
const STORE = "kv";
const HANDLE_KEY = "csvFileHandle";
const NAME_KEY = "csvFileName";

const HEADERS = ["url", "name", "headline", "company", "location", "timestamp"];

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

const $ = (id) => document.getElementById(id);
const fileNameEl = $("file-name");
const pickBtn = $("pick-file");
const resumeBtn = $("resume");
const clearBtn = $("clear");
const countEl = $("count");
const statusEl = $("status");

async function ensureOffscreen() {
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

function renderFileName(name) {
  if (name) {
    fileNameEl.textContent = name;
    fileNameEl.classList.remove("empty");
  } else {
    fileNameEl.textContent = "No CSV file selected";
    fileNameEl.classList.add("empty");
  }
}

function setStatus(text, warn) {
  statusEl.textContent = text || "";
  statusEl.classList.toggle("warn", !!warn);
}

async function refreshStatus() {
  const fileName = await dbGet(NAME_KEY);
  renderFileName(fileName);

  const resp = await chrome.runtime.sendMessage({ type: "REQUEST_STATUS" });
  if (resp) {
    countEl.textContent = String(resp.count ?? 0);
    if (resp.status?.text) {
      const isWarn = /re-grant|failed|no csv/i.test(resp.status.text);
      setStatus(resp.status.text, isWarn);
    } else {
      setStatus("Ready.");
    }
  }
}

pickBtn.addEventListener("click", async () => {
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: "linkedin-profiles.csv",
      types: [
        {
          description: "CSV file",
          accept: { "text/csv": [".csv"] }
        }
      ]
    });

    // If the file is new/empty, seed headers immediately so the user can verify.
    const file = await handle.getFile();
    if (file.size === 0) {
      const writable = await handle.createWritable({ keepExistingData: false });
      await writable.write(HEADERS.join(",") + "\n");
      await writable.close();
    }

    await dbSet(HANDLE_KEY, handle);
    await dbSet(NAME_KEY, handle.name);
    renderFileName(handle.name);

    await ensureOffscreen();
    setStatus(`Saving to ${handle.name}.`);
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
      await ensureOffscreen();
      setStatus("Tracking resumed.");
    } else {
      setStatus("Permission denied.", true);
    }
  } catch (err) {
    setStatus(`Could not resume: ${err.message || err}`, true);
  }
});

clearBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "CLEAR_DEDUP" });
  await refreshStatus();
});

refreshStatus();
ensureOffscreen();
