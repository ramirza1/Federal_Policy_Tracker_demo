// Initialize the Typesense Instantsearch Adapter
const typesenseInstantsearchAdapter = new TypesenseInstantSearchAdapter({
  server: {
    apiKey: "JrkZtt5wKSNACgUpSrJNdZ8n3hhmGdEK", // Your search-only API key
    nodes: [
      {
        host: "6b02zkvpmslnjyd8p-1.a1.typesense.net",
        port: "443",
        protocol: "https"
      }
    ],
    connectionTimeoutSeconds: 10
  },
  additionalSearchParameters: {
    query_by: "Name,Introduced by,Themes,Bill Summary"
  }
});

const searchClient = typesenseInstantsearchAdapter.searchClient;

// Normalize the search query
function normalizeQuery(query) {
  let q = (query || "").toLowerCase().trim();
  q = q.replace(/[-_/]+/g, " ");
  q = q.replace(/\s+/g, " ");
  q = q.replace(/\bdeep\s*fake(s)?\b/g, "deepfake");
  return q;
}

const searchConfig = {
  vectorWeight: 0.7,
  keywordWeight: 0.3,
  vectorK: 1000, // fixed pool for vector search (hitsPerPage * pages)
  typoTolerance: 2,
  queryBy: ["Name", "Introduced by", "Themes", "Bill Summary"],
};

const HITS_PER_PAGE = 10; // fixed page size; column count flexes with screen width

const search = instantsearch({
  indexName: "bills_federal",
  searchClient,
  searchFunction(helper) {
    let query = (helper.state.query || "").trim();
    const page = helper.getPage();
    const perPage = helper.state.hitsPerPage || 10;
    const vectorK = searchConfig.vectorK || perPage * 100;

    if (!query) {
      helper.setQueryParameter("hybrid_search", undefined);
      helper.setQueryParameter("vector_query", undefined);
      helper.setQueryParameter("query_by", searchConfig.queryBy.join(","));
      helper.setQueryParameter("typo_tolerance", undefined);
      helper.setQueryParameter("num_typos", undefined);
      helper.setPage(page);
      helper.search();
      return;
    }

    query = normalizeQuery(query);
    helper.setQuery(query);

    helper.setQueryParameter("query_by", searchConfig.queryBy.join(","));
    helper.setQueryParameter("typo_tolerance", true);
    helper.setQueryParameter("num_typos", searchConfig.typoTolerance);

    const qLen = query.length;
    const vectorWeight = qLen <= 12 ? 0.9 : searchConfig.vectorWeight;
    const keywordWeight = 1 - vectorWeight;

    helper.setQueryParameter("hybrid_search", {
      enabled: true,
      weight: { vector: vectorWeight, keyword: keywordWeight },
    });

    helper.setQueryParameter("vector_query", `embedding:([], k:${vectorK})`);
    helper.setPage(page);
    helper.search();
  },
});

// Custom checkbox filter for Current Legislative Session
const customCurrentSessionFilter =
  instantsearch.connectors.connectRefinementList((renderOptions, isFirstRender) => {
    const { items, refine } = renderOptions;

    if (isFirstRender) {
      const container = document.querySelector("#current-session-filter");
      container.innerHTML = `
      <div class="current-session-checkbox">
        <input type="checkbox" id="current-session-checkbox" />
        <label for="current-session-checkbox">Current legislative session only</label>
      </div>
    `;
      const checkbox = document.querySelector("#current-session-checkbox");
      checkbox.addEventListener("change", function () {
        refine("1");
      });
    }

    const checkbox = document.querySelector("#current-session-checkbox");
    const isCurrentSessionSelected = items.find(
      (item) => item.value === "1" && item.isRefined
    );
    if (checkbox) {
      checkbox.checked = !!isCurrentSessionSelected;
    }
  });

// Custom date range picker
const customDateRangePicker = instantsearch.connectors.connectRange(
  (() => {
    // Persisted across renders so handlers always see the latest refine fn.
    let latestRefine = null;
    let latestCurrent = null;
    let startFp = null;
    let endFp = null;

    return (renderOptions, isFirstRender) => {
      latestRefine = renderOptions.refine;
      latestCurrent = renderOptions.currentRefinement;

      if (isFirstRender) {
        const container = document.querySelector("#intro-date-picker");
        container.innerHTML = `
        <input type="text" id="date-picker-start" placeholder="Start date" name="start-date">
        <input type="text" id="date-picker-end" placeholder="End date" name="end-date">
        <button type="button" id="date-picker-clear" class="date-clear" hidden>Clear dates</button>
      `;

        startFp = flatpickr("#date-picker-start", {
          onChange: (selectedDates) => {
            if (selectedDates[0] && latestRefine) {
              latestRefine([
                Math.floor(selectedDates[0].getTime() / 1000),
                latestCurrent ? latestCurrent.max : undefined,
              ]);
            }
            updateClearButton();
          },
        });

        endFp = flatpickr("#date-picker-end", {
          onChange: (selectedDates) => {
            if (selectedDates[0] && latestRefine) {
              latestRefine([
                latestCurrent ? latestCurrent.min : undefined,
                Math.floor(selectedDates[0].getTime() / 1000),
              ]);
            }
            updateClearButton();
          },
        });

        document
          .querySelector("#date-picker-clear")
          .addEventListener("click", () => {
            if (startFp) startFp.clear();
            if (endFp) endFp.clear();
            if (latestRefine) latestRefine([undefined, undefined]);
            updateClearButton();
          });
      }

      // Sync inputs FROM the refinement (one direction only — never the reverse).
      const hasMin =
        latestCurrent &&
        latestCurrent.min !== -Infinity &&
        latestCurrent.min !== undefined;
      const hasMax =
        latestCurrent &&
        latestCurrent.max !== Infinity &&
        latestCurrent.max !== undefined;

      if (startFp && hasMin) {
        startFp.setDate(new Date(latestCurrent.min * 1000), false);
      }
      if (endFp && hasMax) {
        endFp.setDate(new Date(latestCurrent.max * 1000), false);
      }
      updateClearButton();
    };

    function updateClearButton() {
      const clearBtn = document.querySelector("#date-picker-clear");
      if (!clearBtn) return;
      const startHasValue = startFp && startFp.selectedDates.length > 0;
      const endHasValue = endFp && endFp.selectedDates.length > 0;
      clearBtn.hidden = !(startHasValue || endHasValue);
    }
  })()
);

// Helper: escape strings for safe insertion when no highlight wrapper is used
function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Theme color palette — pulled out so it's not rebuilt per hit
const THEME_COLORS = {
  "Algorithmic Fairness and Accountability": { bg: "#ff6f61", text: "#ffffff" },
  "Artificial Intelligence and Machine Learning": { bg: "#42a5f5", text: "#ffffff" },
  Children: { bg: "#ffd54f", text: "#000000" },
  "Cybersecurity and Information Security": { bg: "#7e57c2", text: "#ffffff" },
  "Data Management and Analytics": { bg: "#26a69a", text: "#000000" },
  "Data Privacy and Protection": { bg: "#ff7043", text: "#ffffff" },
  "Design & Testing Standards": { bg: "#66bb6a", text: "#000000" },
  "Digital Economy and Fintech": { bg: "#ffa726", text: "#000000" },
  "Digital Identity and Biometrics": { bg: "#29b6f6", text: "#000000" },
  "Digital Platforms and Social Media": { bg: "#ec407a", text: "#ffffff" },
  "Digital Rights and Ethics": { bg: "#ab47bc", text: "#ffffff" },
  "Economic Policy": { bg: "#5c6bc0", text: "#ffffff" },
  "Emerging Industry Concepts": { bg: "#9ccc65", text: "#000000" },
  "Emerging Technologies": { bg: "#ef5350", text: "#ffffff" },
  "Employment and Labor": { bg: "#8bc34a", text: "#000000" },
  "Government Spending": { bg: "#ce93d8", text: "#ffffff" },
  Legal: { bg: "#b39ddb", text: "#ffffff" },
  Liability: { bg: "#4db6ac", text: "#000000" },
  "Misinformation and Deceptive Practices": { bg: "#ff8a65", text: "#ffffff" },
  "Network and Internet Infrastructure": { bg: "#81c784", text: "#000000" },
  "Online Safety and Content Regulation": { bg: "#bcaaa4", text: "#ffffff" },
  "Public Health": { bg: "#aed581", text: "#000000" },
  "Software and Device Security": { bg: "#9575cd", text: "#ffffff" },
  "Technology and Democracy": { bg: "#ffb74d", text: "#000000" },
  Transparency: { bg: "#ffe082", text: "#000000" },
};

// Extract a short bill code (e.g. "S10473") from the start of the name if present
function extractBillCode(name) {
  if (!name) return null;
  // Strip any HTML tags from highlight wrapper before matching
  const plain = String(name).replace(/<[^>]+>/g, "");
  const m = plain.match(/^([A-Z]{1,4}\s?\d+[A-Z]?)/);
  return m ? m[1].replace(/\s+/g, "") : null;
}

// Strip a leading "S10473:" or "S10473 -" prefix from the displayed title.
// Robust against InstantSearch wrapping the code in <mark> highlight tags.
function stripBillCodeFromTitle(html, code) {
  if (!code || !html) return html;
  // Allow optional opening tag, the code (with possible internal whitespace), optional closing tag,
  // then a separator (: - —) with surrounding whitespace.
  const codePattern = code.split("").map(c => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*");
  const re = new RegExp(
    "^\\s*(?:<[^>]+>)?\\s*" + codePattern + "\\s*(?:</[^>]+>)?\\s*[:\\-—]\\s*",
    "i"
  );
  return html.replace(re, "");
}

search.addWidgets([
  instantsearch.widgets.searchBox({
    container: "#searchbox",
    placeholder: "Search bills by title, sponsor, theme, or summary…",
    autofocus: false,
    showReset: true,
    showSubmit: false,
    showLoadingIndicator: true,
  }),

  instantsearch.widgets.configure({
    hitsPerPage: HITS_PER_PAGE,
  }),

  instantsearch.widgets.hits({
    container: "#hits",
    templates: {
      item(hit) {
        const formatDate = (timestamp) => {
          if (typeof timestamp === "number" && !isNaN(timestamp)) {
            return new Date(timestamp * 1000).toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
            });
          }
          return null;
        };

        const themes =
          hit.Themes && Array.isArray(hit.Themes)
            ? hit.Themes.map((t) => t.trim())
            : [];

        const themeLozenges = themes
          .map((theme) => {
            const { bg, text } = THEME_COLORS[theme] || { bg: "#e1f5fe", text: "#000000" };
            return `<span class="theme-lozenge" style="background-color: ${bg}; color: ${text}">${escapeHtml(theme)}</span>`;
          })
          .join("");

        const isCurrentSession = hit["Current legislative session"] === 1;
        const currentSessionPill = isCurrentSession
          ? `<span class="card-session">Current Session</span>`
          : "";

        const nameHighlighted =
          instantsearch.highlight({ attribute: "Name", hit }) || "Untitled";
        const billCode = extractBillCode(hit.Name);
        const titleHtml = billCode ? stripBillCodeFromTitle(nameHighlighted, billCode) : nameHighlighted;

        const sponsorsHighlighted =
          instantsearch.highlight({ attribute: "Introduced by", hit }) || "";

        const introDate = formatDate(hit["Intro date"]);
        const entityType = hit["Entity Type"];
        const status = hit.Status;

        // Build the meta line with separators
        const metaParts = [];
        if (introDate) metaParts.push(`<span><span class="meta-label">Introduced</span> ${escapeHtml(introDate)}</span>`);
        if (entityType) metaParts.push(`<span>${escapeHtml(entityType)}</span>`);
        if (status) metaParts.push(`<span>${escapeHtml(status)}</span>`);
        const metaLine = metaParts.join('<span class="sep">·</span>');

        // Top row: bill code chip + current-session pill
        const topParts = [];
        if (billCode) topParts.push(`<span class="card-id">${escapeHtml(billCode)}</span>`);

        const summaryHtml =
          instantsearch.highlight({ attribute: "Bill Summary", hit }) ||
          "<em style='color:#999'>No summary available</em>";

        const policyType = hit["Policy Type"];
        const legiscanLink =
          hit.Legiscan && hit.Legiscan.trim() !== ""
            ? `<a href="${escapeHtml(hit.Legiscan)}" target="_blank" rel="noopener">Legiscan ↗</a>`
            : "";
        const entitySiteLink =
          hit["Entity site"] && hit["Entity site"].trim() !== ""
            ? `<a href="${escapeHtml(hit["Entity site"])}" target="_blank" rel="noopener">Entity site ↗</a>`
            : "";

        return `
        <article class="hit-item">
          <div class="card-top">
            ${topParts.join("")}
            ${currentSessionPill}
          </div>

          <h2><span class="bill-name">${titleHtml}</span></h2>

          ${sponsorsHighlighted ? `<p class="card-sponsors">${sponsorsHighlighted}</p>` : ""}

          ${metaLine ? `<p class="card-meta">${metaLine}</p>` : ""}

          <div class="summary">
            <span class="summary-text">${summaryHtml}</span>
          </div>

          ${themes.length ? `<div class="themes-container">${themeLozenges}</div>` : ""}

          <div class="links">
            ${policyType ? `<span class="policy-type"><strong>Type:</strong> ${escapeHtml(policyType)}</span>` : ""}
            ${legiscanLink}
            ${entitySiteLink}
          </div>
        </article>
      `;
      },
    },
  }),

  instantsearch.widgets.pagination({
    container: "#pagination",
    totalPages: 100,
  }),

  customCurrentSessionFilter({
    container: "#current-session-filter",
    attribute: "Current legislative session",
  }),

  instantsearch.widgets.refinementList({
    container: "#policy-type-list",
    attribute: "Policy Type",
    searchable: false,
    showMore: true,
    limit: 10,
    showMoreLimit: 20,
  }),

  customDateRangePicker({
    container: "#intro-date-picker",
    attribute: "Intro date",
    min: 1546300800,
    max: Math.floor(Date.now() / 1000),
  }),

  instantsearch.widgets.refinementList({
    container: "#themes-list",
    attribute: "Themes",
    searchable: true,
    searchablePlaceholder: "Search themes…",
    showMore: true,
    limit: 10,
    showMoreLimit: 20,
  }),

  instantsearch.widgets.refinementList({
    container: "#entity-type-list",
    attribute: "Entity Type",
    searchable: false,
    showMore: true,
    limit: 10,
    showMoreLimit: 20,
  }),

  instantsearch.widgets.refinementList({
    container: "#status-list",
    attribute: "Status",
    searchable: false,
    limit: 10,
    showMore: true,
    showMoreLimit: 20,
  }),

  instantsearch.widgets.stats({
    container: "#stats",
  }),
]);

search.start();

// Custom placeholder behavior
setTimeout(() => {
  const searchInput = document.querySelector(".ais-SearchBox-input");
  if (searchInput) {
    const originalPlaceholder = searchInput.placeholder;

    searchInput.addEventListener("focus", function () {
      this.placeholder = "";
    });
    searchInput.addEventListener("blur", function () {
      if (this.value === "") this.placeholder = originalPlaceholder;
    });
    searchInput.addEventListener("input", function () {
      this.placeholder = this.value === "" ? originalPlaceholder : "";
    });
  }
}, 500);

// Click-to-expand behavior for clamped summary and title
document.addEventListener("click", function (e) {
  if (e.target && e.target.classList.contains("summary-text")) {
    e.target.classList.toggle("expanded");
  }
  if (e.target && e.target.classList.contains("bill-name")) {
    e.target.classList.toggle("expanded");
  }
});

console.log("Search initialized");