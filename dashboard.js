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

const DETAIL_FIELDS = [
  ["description", "Description"],
  ["work_history", "Work History"],
  ["education", "Education"],
  ["skills", "Skills"],
  ["licenses_certifications", "Licenses & Certifications"],
  ["volunteering", "Volunteering"],
  ["projects", "Projects"],
  ["languages", "Languages"],
  ["recommendations", "Recommendations"],
  ["interests", "Interests"],
  ["featured", "Featured"],
  ["activity", "Activity"],
  ["courses", "Courses"],
  ["honors_awards", "Honors & Awards"],
  ["publications", "Publications"],
  ["patents", "Patents"],
  ["organizations", "Organizations"],
  ["causes", "Causes"],
  ["full_profile_text", "Full Profile Text"]
];

let rows = [];
let filteredRows = [];
let selectedIndex = -1;

const $ = (id) => document.getElementById(id);
const totalCountEl = $("total-count");
const shownCountEl = $("shown-count");
const searchInput = $("search");
const profileListEl = $("profile-list");
const emptyStateEl = $("empty-state");
const detailEl = $("profile-detail");
const detailNameEl = $("detail-name");
const detailHeadlineEl = $("detail-headline");
const detailMetaEl = $("detail-meta");
const sectionsEl = $("sections");
const refreshBtn = $("refresh");
const downloadBtn = $("download");
const openLinkedinBtn = $("open-linkedin");
const copyProfileBtn = $("copy-profile");

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowsToCsv(sourceRows) {
  const lines = [HEADERS.join(",")];
  for (const row of sourceRows) {
    lines.push(HEADERS.map((h) => csvEscape(row[h])).join(","));
  }
  return lines.join("\n") + "\n";
}

function cleanText(value) {
  return String(value || "").trim();
}

function profileLabel(row) {
  return cleanText(row.name) || cleanText(row.url) || "Unnamed profile";
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function searchableText(row) {
  return HEADERS.map((key) => cleanText(row[key])).join("\n").toLowerCase();
}

function setSelected(index) {
  selectedIndex = index;
  renderList();
  renderDetail(filteredRows[selectedIndex] || null);
}

function renderList() {
  profileListEl.replaceChildren();

  for (const [index, row] of filteredRows.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `profile-item${index === selectedIndex ? " active" : ""}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", index === selectedIndex ? "true" : "false");
    button.addEventListener("click", () => setSelected(index));

    const name = document.createElement("strong");
    name.textContent = profileLabel(row);

    const headline = document.createElement("span");
    headline.textContent = cleanText(row.headline) || cleanText(row.company) || "No headline saved";

    const date = document.createElement("small");
    date.textContent = formatDate(row.timestamp);

    button.append(name, headline, date);
    profileListEl.append(button);
  }

  if (!filteredRows.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<h2>No Matches</h2><p>Try a different search.</p>";
    profileListEl.append(empty);
  }
}

function renderDetail(row) {
  if (!row) {
    emptyStateEl.classList.remove("hidden");
    detailEl.classList.add("hidden");
    return;
  }

  emptyStateEl.classList.add("hidden");
  detailEl.classList.remove("hidden");

  detailNameEl.textContent = profileLabel(row);
  detailHeadlineEl.textContent = cleanText(row.headline);
  detailMetaEl.textContent = [cleanText(row.location), cleanText(row.company), formatDate(row.timestamp)]
    .filter(Boolean)
    .join(" · ");

  sectionsEl.replaceChildren();
  for (const [key, label] of DETAIL_FIELDS) {
    const value = cleanText(row[key]);
    if (!value) continue;

    const section = document.createElement("section");
    section.className = "section-card";

    const title = document.createElement("h3");
    title.textContent = label;

    const text = document.createElement("pre");
    text.textContent = value;

    section.append(title, text);
    sectionsEl.append(section);
  }
}

function applySearch() {
  const query = searchInput.value.trim().toLowerCase();
  filteredRows = query ? rows.filter((row) => searchableText(row).includes(query)) : [...rows];
  shownCountEl.textContent = String(filteredRows.length);
  selectedIndex = filteredRows.length ? 0 : -1;
  renderList();
  renderDetail(filteredRows[selectedIndex] || null);
}

async function loadRows() {
  const response = (await chrome.runtime.sendMessage({ type: "REQUEST_ROWS" })) ?? { rows: [] };
  rows = [...(response.rows || [])].sort((a, b) => {
    const aTime = new Date(a.timestamp || 0).getTime();
    const bTime = new Date(b.timestamp || 0).getTime();
    return bTime - aTime;
  });

  totalCountEl.textContent = String(rows.length);
  downloadBtn.disabled = rows.length === 0;
  applySearch();
}

downloadBtn.addEventListener("click", () => {
  const csv = rowsToCsv(rows);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  chrome.downloads.download({
    url,
    filename: `linkedin-profiles-${stamp}.csv`,
    saveAs: true
  });

  setTimeout(() => URL.revokeObjectURL(url), 60_000);
});

refreshBtn.addEventListener("click", loadRows);
searchInput.addEventListener("input", applySearch);

openLinkedinBtn.addEventListener("click", () => {
  const row = filteredRows[selectedIndex];
  if (row?.url) {
    chrome.tabs.create({ url: row.url });
  }
});

copyProfileBtn.addEventListener("click", async () => {
  const row = filteredRows[selectedIndex];
  if (!row) return;

  const text =
    cleanText(row.full_profile_text) ||
    DETAIL_FIELDS.map(([key, label]) => {
      const value = cleanText(row[key]);
      return value ? `${label}\n${value}` : "";
    })
      .filter(Boolean)
      .join("\n\n");

  await navigator.clipboard.writeText(text);
  copyProfileBtn.textContent = "Copied";
  setTimeout(() => {
    copyProfileBtn.textContent = "Copy Text";
  }, 1500);
});

loadRows();
