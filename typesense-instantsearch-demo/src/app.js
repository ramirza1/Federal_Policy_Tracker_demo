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

// Create the searchClient using Typesense
const searchClient = typesenseInstantsearchAdapter.searchClient;

// Normalize the search query
function normalizeQuery(query) {
  let q = (query || "").toLowerCase().trim();

  // Normalize separators
  q = q.replace(/[-_/]+/g, " ");
  q = q.replace(/\s+/g, " ");

  // Canonicalize deepfake variants
  q = q.replace(/\bdeep\s*fake(s)?\b/g, "deepfake");

  return q;
}

// Initialize the search configuration
const searchConfig = {
  vectorWeight: 0.7,
  keywordWeight: 0.3,
  vectorK: 1000, // Will be updated dynamically
  typoTolerance: 2,
  queryBy: ["Name", "Introduced by", "Themes", "Bill Summary"],
};

// Function to calculate the number of hits per page
function calculateHitsPerPage() {
  const hitsList = document.querySelector(".ais-Hits-list");

  if (!hitsList) {
    console.warn("Hits list element not found. Using default value.");
    return 10; // Default value
  }

  const containerWidth = hitsList.offsetWidth;
  const containerHeight = window.innerHeight;
  const itemHeight = 250;
  const itemWidth = 300;

  const columns = Math.max(1, Math.floor(containerWidth / itemWidth));
  const rows = Math.max(1, Math.floor(containerHeight / itemHeight));

  return columns * rows;
}

// ----- Hits-per-page updater (idempotent + preserves page) -----
let lastHitsPerPage = null;

function updateHitsPerPage() {
  const hitsPerPage = calculateHitsPerPage();

  // Only apply if it actually changed (prevents pagination reset loops)
  if (hitsPerPage === lastHitsPerPage) return;
  lastHitsPerPage = hitsPerPage;

  const currentPage = search.helper.getPage();
  const totalPages = 100; // Adjust as needed
  searchConfig.vectorK = hitsPerPage * totalPages;

  // Apply without nuking pagination
  search.helper.setQueryParameter("hitsPerPage", hitsPerPage);
  search.helper.setPage(currentPage);
  search.helper.search();
}

// Debounce resize calls
function scheduleHitsUpdate(delayMs = 150) {
  clearTimeout(window.__hppTimer);
  window.__hppTimer = setTimeout(updateHitsPerPage, delayMs);
}

// Initialize InstantSearch
const search = instantsearch({
  indexName: "bills_federal",
  searchClient,
  searchFunction(helper) {
    // Read current UI state
    let query = (helper.state.query || "").trim();
    const page = helper.getPage();
    const perPage = helper.state.hitsPerPage || 10;

    // Decide k for vector search (keeps your dynamic behavior)
    const vectorK = searchConfig.vectorK || perPage * 100;

    // If there is NO query, explicitly disable hybrid/vector and run a normal faceted browse
    if (!query) {
      // Clear any previous hybrid/vector settings so they don't "stick"
      helper.setQueryParameter("hybrid_search", undefined);
      helper.setQueryParameter("vector_query", undefined);

      // Keep keyword settings sane
      helper.setQueryParameter("query_by", searchConfig.queryBy.join(","));

      // Typo tolerance irrelevant on empty query; clear to be safe
      helper.setQueryParameter("typo_tolerance", undefined);
      helper.setQueryParameter("num_typos", undefined);

      // Keep pagination consistent
      helper.setPage(page);
      helper.search();
      return;
    }

    // Normalize query for your special case(s)
    query = normalizeQuery(query);
    helper.setQuery(query);

    // Ensure query_by matches your text fields only
    helper.setQueryParameter("query_by", searchConfig.queryBy.join(","));

    // Optional: typo tolerance on query
    helper.setQueryParameter("typo_tolerance", true);
    helper.setQueryParameter("num_typos", searchConfig.typoTolerance);

    // Use computed weights (short queries lean vector-heavy)
    const qLen = query.length;
    const vectorWeight = qLen <= 12 ? 0.9 : searchConfig.vectorWeight;
    const keywordWeight = 1 - vectorWeight;

    // Enable hybrid search with computed weights
    helper.setQueryParameter("hybrid_search", {
      enabled: true,
      weight: {
        vector: vectorWeight,
        keyword: keywordWeight,
      },
    });

    // Vector query: use computed k, and target your embedding field
    helper.setQueryParameter("vector_query", `embedding:([], k:${vectorK})`);

    // Keep pagination consistent
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
        // NOTE: connectRefinementList refine() toggles.
        // Calling refine('1') in both branches is fine (it toggles on/off).
        refine("1");
      });
    }

    // Update checkbox state based on current refinements
    const checkbox = document.querySelector("#current-session-checkbox");
    const isCurrentSessionSelected = items.find(
      (item) => item.value === "1" && item.isRefined
    );

    if (checkbox) {
      checkbox.checked = !!isCurrentSessionSelected;
    }
  });

// Custom date range picker widget
const customDateRangePicker = instantsearch.connectors.connectRange(
  (renderOptions, isFirstRender) => {
    const { refine, currentRefinement } = renderOptions;

    if (isFirstRender) {
      const container = document.querySelector("#intro-date-picker");
      container.innerHTML = `
      <input type="text" id="date-picker-start" placeholder="Start Date" name="start-date">
      <input type="text" id="date-picker-end" placeholder="End Date" name="end-date">
    `;

      flatpickr("#date-picker-start", {
        onChange: (selectedDates) => {
          if (selectedDates[0]) {
            refine([
              Math.floor(selectedDates[0].getTime() / 1000),
              currentRefinement ? currentRefinement.max : undefined,
            ]);
          }
        },
      });

      flatpickr("#date-picker-end", {
        onChange: (selectedDates) => {
          if (selectedDates[0]) {
            refine([
              currentRefinement ? currentRefinement.min : undefined,
              Math.floor(selectedDates[0].getTime() / 1000),
            ]);
          }
        },
      });
    }

    // Update the inputs if the refinement changes
    if (currentRefinement) {
      if (currentRefinement.min !== -Infinity) {
        document
          .querySelector("#date-picker-start")
          ._flatpickr.setDate(new Date(currentRefinement.min * 1000));
      }
      if (currentRefinement.max !== Infinity) {
        document
          .querySelector("#date-picker-end")
          ._flatpickr.setDate(new Date(currentRefinement.max * 1000));
      }
    }
  }
);

// Event listeners to trigger hits update on page load and window resize
window.addEventListener("resize", () => scheduleHitsUpdate(150));
window.addEventListener("load", function () {
  setTimeout(() => updateHitsPerPage(), 500); // slight delay so hits list exists
});

// Search widgets setup
search.addWidgets([
  instantsearch.widgets.searchBox({
    container: "#searchbox",
    placeholder: "Search",
    autofocus: false,
    showReset: true,
    showSubmit: false,
    showLoadingIndicator: true,
    cssClasses: {
      input: "custom-input-class",
    },
  }),

  // Set initial hitsPerPage once (subsequent updates are handled by updateHitsPerPage)
  instantsearch.widgets.configure({
    hitsPerPage: calculateHitsPerPage(),
  }),

  instantsearch.widgets.hits({
    container: "#hits",
    templates: {
      item(hit) {
        const formatDate = (timestamp) => {
          if (typeof timestamp === "number" && !isNaN(timestamp)) {
            return new Date(timestamp * 1000).toLocaleDateString();
          }
          return "Invalid Date";
        };

        const themes =
          hit.Themes && Array.isArray(hit.Themes)
            ? hit.Themes.map((theme) => theme.trim())
            : [];

        // Color mapping for themes
        const themeColors = {
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

        const themeLozenges = themes
          .map((theme) => {
            const { bg, text } = themeColors[theme.trim()] || {
              bg: "#e1f5fe",
              text: "#000000",
            };
            return `<span class="theme-lozenge" style="background-color: ${bg}; color: ${text}">${theme.trim()}</span>`;
          })
          .join(" ");

        return `
        <div class="hit-item">
          <h2><span class="bill-name">${
            instantsearch.highlight({ attribute: "Name", hit }) || "No Name"
          }</span></h2>
          <p><strong>Introduced by:</strong> ${
            instantsearch.highlight({ attribute: "Introduced by", hit }) || "N/A"
          }</p>
          <p><strong>Intro date:</strong> ${formatDate(hit["Intro date"])}</p>
          <p><strong>Status:</strong> ${hit.Status || "N/A"}</p>
          <p><strong>Entity Type:</strong> ${hit["Entity Type"] || "N/A"}</p>
          <p class="summary"><strong>Summary:</strong>
            <span class="summary-text">${
              instantsearch.highlight({ attribute: "Bill Summary", hit }) ||
              "No summary available"
            }</span>
          </p>
          <div class="themes-container">
            <p><strong>Themes: </strong></p>
            ${themeLozenges}
          </div>
          <div class="links">
            <p><strong>Policy Type:</strong> ${hit["Policy Type"] || "N/A"}</p>
            <p><strong>Legiscan:</strong> <a href="${hit.Legiscan}" target="_blank">Link</a></p>
            <p><strong>Entity site:</strong> <a href="${hit["Entity site"]}" target="_blank">Link</a></p>
          </div>
        </div>
      `;
      },
    },
    // NOTE: do NOT call updateHitsPerPage() here — it breaks pagination
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
    min: 1546300800, // Jan 1, 2019
    max: Math.floor(Date.now() / 1000),
  }),

  instantsearch.widgets.refinementList({
    container: "#themes-list",
    attribute: "Themes",
    searchable: true,
    searchablePlaceholder: "Search themes",
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

// Start the search instance
search.start();

// Custom logic for placeholder in the search box
setTimeout(() => {
  const searchInput = document.querySelector(".ais-SearchBox-input");
  if (searchInput) {
    const originalPlaceholder = searchInput.placeholder;

    searchInput.addEventListener("focus", function () {
      this.placeholder = "";
    });

    searchInput.addEventListener("blur", function () {
      if (this.value === "") {
        this.placeholder = originalPlaceholder;
      }
    });

    searchInput.addEventListener("input", function () {
      if (this.value === "") {
        this.placeholder = originalPlaceholder;
      } else {
        this.placeholder = "";
      }
    });
  } else {
    console.error("Search input element not found");
  }
}, 500);

// Event listeners for interactions
document.addEventListener("click", function (e) {
  if (e.target && e.target.classList.contains("summary-text")) {
    e.target.classList.toggle("expanded");
  }
  if (e.target && e.target.classList.contains("bill-name")) {
    e.target.classList.toggle("expanded");
  }
});

console.log("Search initialized");
