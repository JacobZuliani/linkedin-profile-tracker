# LinkedIn Profile Tracker

A tiny browser extension that quietly logs every LinkedIn profile you view to a CSV. Zero servers, zero API keys, $0/month. Works on Chromium browsers and (with a couple extra steps) Safari.

For each profile you visit, it captures one row. Basic fields are split into their own columns, common profile sections get their own long-text columns, and `full_profile_text` keeps the whole readable profile body as a fallback.

| Field | What it saves |
|-------|---------------|
| `url` | LinkedIn profile URL |
| `name` | Displayed profile name |
| `headline` | Displayed headline |
| `company` | Current company, when LinkedIn exposes it cleanly |
| `location` | Displayed location |
| `description` | About section |
| `work_history` | Experience section, including visible role descriptions |
| `education` | Education section |
| `licenses_certifications` | Licenses and certifications section |
| `volunteering` | Volunteering section |
| `projects` | Projects section |
| `skills` | Skills section |
| `languages` | Languages section |
| `recommendations` | Recommendations section |
| `interests` | Interests section |
| `featured` | Featured section |
| `activity` | Activity section |
| `courses` | Courses section |
| `honors_awards` | Honors and awards section |
| `publications` | Publications section |
| `patents` | Patents section |
| `organizations` | Organizations section |
| `causes` | Causes section |
| `full_profile_text` | Combined readable profile text from the visible profile sections |
| `timestamp` | Capture time |

When LinkedIn shows a "Show all ..." link for a supported section, the extension tries to read that detail page in your current LinkedIn session and saves the longer version if it can. If LinkedIn blocks or changes that detail page, the row still saves the visible profile text.

You always get a **Download CSV** button and a local **Dashboard** button in the popup. The dashboard opens in your browser, reads the profiles saved in local extension storage, and lets you search, inspect, copy, or reopen viewed profiles. On Chrome you also get optional **auto-append** straight to a `.csv` file you pick once.

## Install on Chrome, Edge, Brave, Arc, or Opera

1. Clone or download this repo (top-right green **Code** button → **Download ZIP** → unzip).
2. Open `chrome://extensions` (or `edge://extensions`, etc.).
3. Toggle on **Developer mode** (top right).
4. Click **Load unpacked** and pick this folder.
5. Pin the extension's icon in the toolbar.
6. (Optional, for auto-append) Click the icon → **Choose CSV file…** → pick or create a `.csv` anywhere on your disk.
7. Browse LinkedIn. Rows are saved automatically.

> **After every browser restart**, if you're using the auto-append feature, click the extension icon once and press **Resume tracking** to re-grant write permission to the CSV. This is a Chrome security requirement; the **Download CSV** button works regardless.

## Install on Safari (macOS only)

Safari doesn't have a "Load unpacked" mode, so the extension has to be wrapped in a tiny Xcode-built macOS app. The conversion is a one-line command.

Prerequisites:
- Xcode (free from the Mac App Store, ~10 GB)
- `xcode-select --install`
- `sudo xcodebuild -license accept`

```bash
cd safari
chmod +x build-safari.sh
./build-safari.sh
open build/LinkedInProfileTracker/LinkedInProfileTracker.xcodeproj
# In Xcode: press the Run button (▶), then quit the host app it launches.
```

Then in Safari:
1. Settings → Advanced → enable **Show features for web developers**.
2. Develop menu → **Allow Unsigned Extensions**.
3. Settings → Extensions → enable **LinkedIn Profile Tracker**.
4. Click the toolbar icon → grant access to `linkedin.com`.

See [safari/README.md](safari/README.md) for the long version, distribution caveats, and the list of feature differences vs. Chrome. (Short version: no auto-append on Safari, but the **Download CSV** button works exactly the same way.)

> For non-technical users, installing Chrome/Edge/Brave on macOS and using the Chromium path above is dramatically easier than the Safari path.

## How it works

```
┌──────────────────────┐    ┌──────────────────┐    ┌────────────────────────┐
│  content.js          │    │  background.js   │    │  chrome.storage.local  │
│  (DOM scraper)       │───▶│  (dedup + route) │───▶│  rows[] (always)       │
└──────────────────────┘    └──────┬───────────┘    └────────────────────────┘
         ▲                         │
         │ MutationObserver        │ (Chrome only)
         │ waits for <h1>          ▼
   linkedin.com/in/<handle>   ┌──────────────────┐    ┌────────────────────────┐
                              │  offscreen.js    │───▶│  user-picked .csv file │
                              │  (file writer)   │    │  (auto-appended)       │
                              └──────────────────┘    └────────────────────────┘
```

`chrome.storage.local` is the source of truth. The file write on Chrome is a best-effort mirror; if the file handle has expired or the user hasn't picked a file, rows still pile up safely in storage and can be downloaded as a CSV anytime.

## Files

- [`manifest.json`](manifest.json) — Manifest V3 declaration; works for both Chrome and Safari.
- [`background.js`](background.js) — service worker; SPA navigation listener + dedup + storage + optional file mirror.
- [`content.js`](content.js) — DOM scraper with layered selectors and fallbacks.
- [`offscreen.html`](offscreen.html) / [`offscreen.js`](offscreen.js) — Chrome-only file writer holding the `FileSystemFileHandle`.
- [`popup.html`](popup.html) / [`popup.js`](popup.js) — feature-detected UI: Download CSV everywhere; file picker only on Chrome.
- [`dashboard.html`](dashboard.html) / [`dashboard.css`](dashboard.css) / [`dashboard.js`](dashboard.js) — local searchable dashboard for saved profiles.
- [`icons/`](icons/) — 16/48/128 px PNG icons.
- [`safari/`](safari/) — Safari Web Extension converter script and notes.

## When a field stops working

LinkedIn renames CSS classes every few months. When a field starts coming through blank, open [`content.js`](content.js) and prepend a new entry to the relevant array inside `SELECTORS`. Each field already supports multiple fallbacks; you just need to find the current selector.

To find one: right-click the field on a profile page → Inspect → look for stable attributes like `aria-label`, `data-field`, or class prefixes that look semantic rather than randomized.

## Notes on LinkedIn's Terms of Service

This extension only reads pages you're already viewing in your own browser session — no scraping of pages you wouldn't otherwise see, no automation that fetches profiles in the background, no API abuse. That's the same posture as your browser's own history.

Saving displayed profile details into a private local file for personal reference is broadly considered acceptable for personal use, but redistributing the data, selling it, building a product on top of it, or using it to circumvent LinkedIn's own search/filtering is **not** allowed under LinkedIn's User Agreement. Use it for your own bookkeeping.

## Roadmap ideas

- Google Sheets / Notion / Airtable export
- "Notes" column you can write per profile from the popup
- Right-click "Save without opening" on search-result links
- Firefox port (small manifest tweak; basically free)

## License

MIT
