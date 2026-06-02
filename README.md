# LinkedIn Profile Tracker

A tiny Chromium browser extension that quietly logs every LinkedIn profile you view to a CSV file on your computer. Zero servers, zero API keys, $0/month.

For each profile you visit, it appends one row to your chosen CSV:

| url | name | headline | company | location | timestamp |
|-----|------|----------|---------|----------|-----------|

## Install (one minute)

1. Clone or download this repo.
2. Open `chrome://extensions` (works the same in Edge, Brave, Arc, Opera).
3. Toggle on **Developer mode** in the top right.
4. Click **Load unpacked** and pick this folder.
5. Click the extension icon in the toolbar.
6. Click **Choose CSV file…** and pick (or create) any `.csv` file on your disk. This is a one-time setup.
7. Browse LinkedIn normally. Rows append automatically.

> **After every browser restart**, click the extension icon once and press **Resume tracking**. This re-grants write permission to the CSV. It's a browser security requirement — not avoidable.

## How it works

- A background service worker listens to `chrome.webNavigation.onHistoryStateUpdated` to catch LinkedIn's single-page-app navigations.
- A content script waits for the profile DOM to render, then scrapes the URL, name, headline, current company, and location.
- An offscreen document holds the `FileSystemFileHandle` so the file write can survive service worker restarts.
- A dedup set in `chrome.storage.local` keeps revisits from creating duplicate rows.

```
┌─────────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  content.js         │    │  background.js   │    │  offscreen.js    │
│  (scrapes DOM)      │───▶│  (dedup + route) │───▶│  (writes CSV)    │
└─────────────────────┘    └──────────────────┘    └──────────────────┘
         ▲                                                     │
         │ MutationObserver waits for <h1>                     ▼
         │                                            user-picked .csv
   linkedin.com/in/<handle>
```

## Files

- `manifest.json` — Manifest V3 declaration, permissions, content script match
- `background.js` — service worker; SPA navigation listener + dedup + routing
- `content.js` — DOM scraper with layered selectors and fallbacks
- `offscreen.html` / `offscreen.js` — holds the file handle, writes CSV rows
- `popup.html` / `popup.js` — file picker, resume button, status display

## When a field stops working

LinkedIn updates their class names every few months. When a column suddenly comes through blank for everyone, open `content.js` and update the corresponding entry in the `SELECTORS` object. Each field already supports a list of fallback selectors — just add the new one to the front of the list.

To find the right selector: right-click the field on a profile page → Inspect → look for stable attributes like `aria-label`, `data-field`, or class prefixes that look semantic rather than randomized.

## Notes on LinkedIn's Terms of Service

This extension only reads pages you're already viewing in your own browser session — no scraping of pages you wouldn't otherwise see, no automation that fetches profiles in the background, no API abuse. That's the same posture as your browser's own history.

Capturing the displayed name/headline/company/location into a private local file for personal reference is broadly considered acceptable for personal use, but it is *not* allowed under LinkedIn's User Agreement to redistribute that data, sell it, build a product on top of it, or use it to circumvent LinkedIn's own search/filtering. Use it for your own bookkeeping.

## Roadmap ideas

- Export-to-Google-Sheets button in the popup
- "Notes" column you can write per profile from the popup
- Right-click "Save without opening" on LinkedIn search result links
- Firefox port (needs Manifest V2 fork)

## License

MIT
