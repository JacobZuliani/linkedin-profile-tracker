// Content script: scrapes profile fields from the rendered DOM and forwards to background.

(function () {
  const FIELD_TIMEOUT_MS = 8000;

  function firstMatch(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent && el.textContent.trim()) {
        return el.textContent.trim().replace(/\s+/g, " ");
      }
    }
    return "";
  }

  function waitFor(selectors, timeoutMs) {
    return new Promise((resolve) => {
      const tryNow = () => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent && el.textContent.trim()) {
            return el;
          }
        }
        return null;
      };
      const found = tryNow();
      if (found) return resolve(found);

      const obs = new MutationObserver(() => {
        const el = tryNow();
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        obs.disconnect();
        resolve(null);
      }, timeoutMs);
    });
  }

  // Layered selectors: LinkedIn changes class names occasionally, so each field
  // has several fallbacks. If nothing matches, the field is left blank and the
  // row is still written.
  const SELECTORS = {
    name: [
      "main section h1.text-heading-xlarge",
      "main section h1",
      "h1.text-heading-xlarge",
      "h1"
    ],
    headline: [
      "main section .text-body-medium.break-words",
      "main section div.text-body-medium",
      ".pv-text-details__left-panel div.text-body-medium"
    ],
    location: [
      "main section span.text-body-small.inline.t-black--light.break-words",
      "main section .pv-text-details__left-panel .text-body-small.inline",
      ".pv-text-details__left-panel span.text-body-small"
    ],
    company: [
      "button[aria-label^='Current company']",
      "[data-field='current_company_name']",
      "section[data-section='currentPositionsDetails'] a span[aria-hidden='true']",
      "main section ul li[aria-label*='Current']"
    ]
  };

  async function extractProfile() {
    // Wait for the name to appear (the strongest signal that the profile DOM has
    // hydrated). Other fields fall back to whatever's available right then.
    await waitFor(SELECTORS.name, FIELD_TIMEOUT_MS);

    const row = {
      url: window.location.href,
      name: firstMatch(SELECTORS.name),
      headline: firstMatch(SELECTORS.headline),
      company: firstMatch(SELECTORS.company),
      location: firstMatch(SELECTORS.location),
      timestamp: new Date().toISOString()
    };

    // Heuristic cleanup: location selectors sometimes pick up "Contact info" links.
    if (/contact info/i.test(row.location)) row.location = "";

    return row;
  }

  let inFlight = false;
  async function run() {
    if (inFlight) return;
    inFlight = true;
    try {
      const data = await extractProfile();
      if (!data.name && !data.headline) {
        // Probably not a real profile page (e.g. /in/me redirect, settings, etc.)
        return;
      }
      chrome.runtime.sendMessage({ type: "PROFILE_DATA", data });
    } catch (err) {
      console.warn("[LPT] extract failed:", err);
    } finally {
      inFlight = false;
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "EXTRACT_PROFILE") {
      run().then(() => sendResponse({ ok: true }));
      return true;
    }
  });

  // Run once on initial load too, in case webNavigation didn't catch it.
  if (location.pathname.startsWith("/in/")) {
    run();
  }
})();
