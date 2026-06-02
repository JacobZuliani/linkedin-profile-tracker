// Content script: scrapes profile fields from the rendered DOM and forwards to background.

(function () {
  const FIELD_TIMEOUT_MS = 8000;
  const INLINE_EXPAND_WAIT_MS = 400;
  const DETAIL_FETCH_TIMEOUT_MS = 6000;

  const SECTION_LABELS = {
    description: ["About"],
    work_history: ["Experience"],
    education: ["Education"],
    licenses_certifications: ["Licenses & certifications", "Licenses and certifications"],
    volunteering: ["Volunteering"],
    projects: ["Projects"],
    skills: ["Skills"],
    languages: ["Languages"],
    recommendations: ["Recommendations"],
    interests: ["Interests"],
    featured: ["Featured"],
    activity: ["Activity"],
    courses: ["Courses"],
    honors_awards: ["Honors & awards", "Honors and awards"],
    publications: ["Publications"],
    patents: ["Patents"],
    organizations: ["Organizations"],
    causes: ["Causes"]
  };

  const IGNORED_SECTION_RE =
    /^(people similar|more profiles|business consulting|people you may know|you might like|advertisement|ad\b)/i;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeText(text) {
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function visibleText(el) {
    if (!el) return "";
    return normalizeText(el.innerText || el.textContent || "");
  }

  function firstMatch(selectors) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const text = visibleText(el).replace(/\n+/g, " ");
      if (text) {
        return text;
      }
    }
    return "";
  }

  function waitFor(selectors, timeoutMs) {
    return new Promise((resolve) => {
      const tryNow = () => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (visibleText(el)) {
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

  async function expandInlineText() {
    const buttons = [...document.querySelectorAll("main button")];
    for (const button of buttons) {
      const text = visibleText(button).replace(/\s+/g, " ");
      if (/^(\u2026|\.\.\.)?\s*see more$/i.test(text)) {
        button.click();
      }
    }
    await sleep(INLINE_EXPAND_WAIT_MS);
  }

  function sectionTitle(section, includeH1 = false) {
    const headingSelector = includeH1 ? "h1, h2, h3" : "h2, h3";
    const heading = [...section.querySelectorAll(headingSelector)].find((el) => visibleText(el));
    return visibleText(heading).replace(/\n+/g, " ");
  }

  function cleanSectionText(section, title) {
    const lines = visibleText(section)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    while (lines.length && lines[0].replace(/\s+/g, " ") === title) {
      lines.shift();
    }

    return lines.join("\n");
  }

  function detailUrl(section) {
    const link = [...section.querySelectorAll("a[href*='/details/']")].find((el) =>
      /^show all\b/i.test(visibleText(el))
    );
    const href = link?.getAttribute("href");
    if (!href) return "";
    try {
      return new URL(href, window.location.origin).href;
    } catch {
      return "";
    }
  }

  function extractSections(root = document, options = {}) {
    const { includeH1 = false, includeDetailLinks = true } = options;
    const sections = [];
    for (const section of root.querySelectorAll("main section")) {
      const title = sectionTitle(section, includeH1);
      if (!title || IGNORED_SECTION_RE.test(title)) continue;

      const text = cleanSectionText(section, title);
      if (!text) continue;

      sections.push({
        title,
        text,
        detailUrl: includeDetailLinks ? detailUrl(section) : ""
      });
    }
    return sections;
  }

  function sectionMatches(section, labels) {
    const title = section.title.toLowerCase();
    return labels.some((label) => title === label.toLowerCase());
  }

  function pickSectionText(sections, labels) {
    return sections
      .filter((section) => sectionMatches(section, labels))
      .map((section) => section.text)
      .join("\n\n---\n\n");
  }

  async function fetchDetailSections(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DETAIL_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        credentials: "include",
        signal: controller.signal
      });
      if (!response.ok) return [];

      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      return extractSections(doc, { includeH1: true, includeDetailLinks: false });
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  async function enrichSectionsWithDetailPages(sections) {
    const enriched = [];

    for (const section of sections) {
      const labels = Object.values(SECTION_LABELS).find((candidate) =>
        sectionMatches(section, candidate)
      );
      if (!labels || !section.detailUrl) {
        enriched.push(section);
        continue;
      }

      const detailSections = await fetchDetailSections(section.detailUrl);
      const detailText = pickSectionText(detailSections, labels);
      if (detailText && detailText.length > section.text.length) {
        enriched.push({ ...section, text: detailText });
      } else {
        enriched.push(section);
      }
    }

    return enriched;
  }

  function profileText(row, sections) {
    const headerLines = [
      row.name && `Name: ${row.name}`,
      row.headline && `Headline: ${row.headline}`,
      row.company && `Company: ${row.company}`,
      row.location && `Location: ${row.location}`,
      row.url && `URL: ${row.url}`
    ].filter(Boolean);

    const sectionLines = sections.map((section) => `${section.title}\n${section.text}`);
    return [...headerLines, ...sectionLines].join("\n\n");
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
    await expandInlineText();

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

    const sections = await enrichSectionsWithDetailPages(extractSections());
    for (const [key, labels] of Object.entries(SECTION_LABELS)) {
      row[key] = pickSectionText(sections, labels);
    }
    row.full_profile_text = profileText(row, sections);

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
