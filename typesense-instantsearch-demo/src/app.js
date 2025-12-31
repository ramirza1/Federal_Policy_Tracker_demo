// Initialize the Typesense Instantsearch Adapter
const typesenseInstantsearchAdapter = new TypesenseInstantSearchAdapter({
  server: {
    apiKey: "JrkZtt5wKSNACgUpSrJNdZ8n3hhmGdEK", // Your search-only API key
    nodes: [
      {
        host: "6b02zkvpmslnjyd8p-1.a1.typesense.net",
        port: "443",  // Changed from 8108 to 443
        protocol: "https"
      }
    ],
    connectionTimeoutSeconds: 10  // Increased from default 5 seconds
  },
  additionalSearchParameters: {
    query_by: "Name,Introduced by,Themes,Bill Summary" 
  }
});

// Create the searchClient using Typesense
const searchClient = typesenseInstantsearchAdapter.searchClient;

// Normalize the search query
function normalizeQuery(query) {
  return query.toLowerCase().replace(/deep fake/g, 'deepfake');
}

// Initialize the search configuration
const searchConfig = {
  vectorWeight: 0.7,
  keywordWeight: 0.3,
  vectorK: 1000, // Will be updated dynamically
  typoTolerance: 2,
  queryBy: ['Name', 'Introduced by', 'Themes', 'Bill Summary'], 
};

// Function to calculate the number of hits per page
function calculateHitsPerPage() {
  const hitsList = document.querySelector('.ais-Hits-list');
  
  if (!hitsList) {
    console.warn('Hits list element not found. Using default value.');
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

// Function to update the hits per page and vectorK dynamically
function updateHitsPerPage() {
  const hitsPerPage = calculateHitsPerPage();
  const totalPages = 100; // Adjust as needed
  const vectorK = hitsPerPage * totalPages;

  // Update searchConfig with new vectorK
  searchConfig.vectorK = vectorK;

  // Trigger a search to apply the new hitsPerPage and vectorK
  search.helper.setQueryParameter('hitsPerPage', hitsPerPage).search();
}

// Initialize InstantSearch
const search = instantsearch({
  indexName: 'bills_federal',
  searchClient,
  searchFunction(helper) {
  // Read current UI state
  let query = (helper.state.query || "").trim();
  const page = helper.getPage();
  const perPage = helper.state.hitsPerPage || 10;

  // Decide k for vector search (keeps your dynamic behavior)
  const vectorK = searchConfig.vectorK || perPage * 100;

  // Always keep pagination consistent
  helper.setPage(page);

  // If there is NO query, explicitly disable hybrid/vector and run a normal faceted browse
  if (!query) {
    // Important: clear any previous hybrid/vector settings so they don't "stick"
    helper.setQueryParameter("hybrid_search", undefined);
    helper.setQueryParameter("vector_query", undefined);

    // Keep keyword settings sane
    helper.setQueryParameter("query_by", searchConfig.queryBy.join(","));

    // You can keep typo tolerance enabled even for empty query, but it's irrelevant; clear to be safe
    helper.setQueryParameter("typo_tolerance", undefined);

    // Let adapter handle q (don’t set helper.setQueryParameter('q', ...))
    helper.search();
    return;
  }

  // Normalize query for your special case(s)
  query = normalizeQuery(query);

  // DO NOT set 'q' manually — InstantSearch/adapter already uses helper.state.query
  // helper.setQueryParameter('q', query);  // <-- remove

  // Ensure query_by matches your text fields only
  helper.setQueryParameter("query_by", searchConfig.queryBy.join(","));

  // Enable hybrid search with your weights
  helper.setQueryParameter("hybrid_search", {
    enabled: true,
    weight: {
      vector: searchConfig.vectorWeight,
      keyword: searchConfig.keywordWeight,
    },
  });

  // Typo tolerance: keep it simple. If Typesense expects a scalar, this will still be fine,
  // but if your server supports the object form, it stays.
  helper.setQueryParameter("typo_tolerance", {
    enabled: true,
    num_typos: searchConfig.typoTolerance,
  });

  // Vector query: IMPORTANT — use the computed k, and target your embedding field
  helper.setQueryParameter("vector_query", `embedding:([], k:${vectorK})`);

  // Run search once
  helper.search();
}
,
});

// Custom checkbox filter for Current Legislative Session
const customCurrentSessionFilter = instantsearch.connectors.connectRefinementList((renderOptions, isFirstRender) => {
  const { items, refine, createURL } = renderOptions;

  if (isFirstRender) {
    const container = document.querySelector('#current-session-filter');
    container.innerHTML = `
      <div class="current-session-checkbox">
        <input type="checkbox" id="current-session-checkbox" />
        <label for="current-session-checkbox">Current legislative session only</label>
      </div>
    `;

    const checkbox = document.querySelector('#current-session-checkbox');
    checkbox.addEventListener('change', function() {
      if (this.checked) {
        refine('1'); // Filter to show only current session (value = 1)
      } else {
        refine('1'); // Toggle off the filter
      }
    });
  }

  // Update checkbox state based on current refinements
  const checkbox = document.querySelector('#current-session-checkbox');
  const isCurrentSessionSelected = items.find(item => item.value === '1' && item.isRefined);
  
  if (checkbox) {
    checkbox.checked = !!isCurrentSessionSelected;
  }
});

// Custom date range picker widget
const customDateRangePicker = instantsearch.connectors.connectRange((renderOptions, isFirstRender) => {
  const { refine, currentRefinement } = renderOptions;

  if (isFirstRender) {
    const container = document.querySelector('#intro-date-picker');
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
      document.querySelector('#date-picker-start')._flatpickr.setDate(new Date(currentRefinement.min * 1000));
    }
    if (currentRefinement.max !== Infinity) {
      document.querySelector('#date-picker-end')._flatpickr.setDate(new Date(currentRefinement.max * 1000));
    }
  }
});


// Event listeners to trigger hits update on page load and window resize
window.addEventListener('resize', updateHitsPerPage);
window.addEventListener('load', function () {
  setTimeout(updateHitsPerPage, 1000); // Add a slight delay to ensure the hits list is rendered
});

// Search widgets setup
search.addWidgets([
  instantsearch.widgets.searchBox({
    container: '#searchbox',
    placeholder: 'Search',
    autofocus: false,
    showReset: true,
    showSubmit: false,
    showLoadingIndicator: true,
    cssClasses: {
      input: 'custom-input-class',
    },
  }),
  instantsearch.widgets.configure({
    hitsPerPage: calculateHitsPerPage(),
  }),
  instantsearch.widgets.hits({
    container: '#hits',
    templates: {
      item(hit) {
        const formatDate = (timestamp) => {
          if (typeof timestamp === 'number' && !isNaN(timestamp)) {
            return new Date(timestamp * 1000).toLocaleDateString();
          }
          return 'Invalid Date';
        };
        const themes = (hit.Themes && Array.isArray(hit.Themes))
          ? hit.Themes.map((theme) => theme.trim())
          : [];



        // Color mapping for themes
        const themeColors = {
          "Algorithmic Fairness and Accountability": { bg: "#ff6f61", text: "#ffffff" }, // Coral with white text
          "Artificial Intelligence and Machine Learning": { bg: "#42a5f5", text: "#ffffff" }, // Light blue with white text
          "Children": { bg: "#ffd54f", text: "#000000" }, // Yellow with black text
          "Cybersecurity and Information Security": { bg: "#7e57c2", text: "#ffffff" }, // Deep purple with white text
          "Data Management and Analytics": { bg: "#26a69a", text: "#000000" }, // Teal with black text
          "Data Privacy and Protection": { bg: "#ff7043", text: "#ffffff" }, // Deep orange with white text
          "Design & Testing Standards": { bg: "#66bb6a", text: "#000000" }, // Medium green with black text
          "Digital Economy and Fintech": { bg: "#ffa726", text: "#000000" }, // Deep orange with black text
          "Digital Identity and Biometrics": { bg: "#29b6f6", text: "#000000" }, // Sky blue with black text
          "Digital Platforms and Social Media": { bg: "#ec407a", text: "#ffffff" }, // Pink with white text
          "Digital Rights and Ethics": { bg: "#ab47bc", text: "#ffffff" }, // Deep purple with white text
          "Economic Policy": { bg: "#5c6bc0", text: "#ffffff" }, // Indigo with white text
          "Emerging Industry Concepts": { bg: "#9ccc65", text: "#000000" }, // Light green with black text
          "Emerging Technologies": { bg: "#ef5350", text: "#ffffff" }, // Red with white text
          "Employment and Labor": { bg: "#8bc34a", text: "#000000" }, // Light green with black text
          "Government Spending": { bg: "#ce93d8", text: "#ffffff" }, // Light purple with white text
          "Legal": { bg: "#b39ddb", text: "#ffffff" }, // Lighter purple with white text
          "Liability": { bg: "#4db6ac", text: "#000000" }, // Teal with black text
          "Misinformation and Deceptive Practices": { bg: "#ff8a65", text: "#ffffff" }, // Orange with white text
          "Network and Internet Infrastructure": { bg: "#81c784", text: "#000000" }, // Medium green with black text
          "Online Safety and Content Regulation": { bg: "#bcaaa4", text: "#ffffff" }, // Brown with white text
          "Public Health": { bg: "#aed581", text: "#000000" }, // Light green with black text
          "Software and Device Security": { bg: "#9575cd", text: "#ffffff" }, // Purple with white text
          "Technology and Democracy": { bg: "#ffb74d", text: "#000000" }, // Orange with black text
          "Transparency": { bg: "#ffe082", text: "#000000" }  // Light yellow with black text
        };
    
        // Generate lozenge HTML with dynamic colors and text color based on background contrast
        const themeLozenges = themes.map(theme => {
          const { bg, text } = themeColors[theme.trim()] || { bg: '#e1f5fe', text: '#000000' }; // Default color if theme is not in the map
            return `<span class="theme-lozenge" style="background-color: ${bg}; color: ${text}">${theme.trim()}</span>`;
          }).join(' ');

    
          return `
          <div class="hit-item">
            <h2><span class="bill-name">${instantsearch.highlight({ attribute: 'Name', hit }) || 'No Name'}</span></h2>
            <p><strong>Introduced by:</strong> ${instantsearch.highlight({ attribute: 'Introduced by', hit }) || 'N/A'}</p>
            <p><strong>Intro date:</strong> ${formatDate(hit['Intro date'])}</p>
            <p><strong>Status:</strong> ${hit.Status || 'N/A'}</p>
            <p><strong>Entity Type:</strong> ${hit['Entity Type'] || 'N/A'}</p>
            <p class="summary"><strong>Summary:</strong> <span class="summary-text">${instantsearch.highlight({ attribute: 'Bill Summary', hit }) || 'No summary available'}</span></p>
            <div class="themes-container">
              <p><strong>Themes: </strong></p>
              ${themeLozenges}
            </div>
            <div class="links">
              <p><strong>Policy Type:</strong> ${hit['Policy Type'] || 'N/A'}</p>
              <p><strong>Legiscan:</strong> <a href="${hit.Legiscan}" target="_blank">Link</a></p>
              <p><strong>Entity site:</strong> <a href="${hit['Entity site']}" target="_blank">Link</a></p>
            </div>
          </div>
        `;
      },
    },
    render() {
      updateHitsPerPage(); // Update hits per page after the hits list is rendered
    },
  }),
  instantsearch.widgets.pagination({
    container: '#pagination',
    totalPages: 100, // Set the total number of pages
  }),
  customCurrentSessionFilter({
    container: '#current-session-filter',
    attribute: 'Current legislative session',
  }),
  instantsearch.widgets.refinementList({
    container: '#policy-type-list',
    attribute: 'Policy Type',
    searchable: false, // Remove search functionality
    showMore: true,
    limit: 10,
    showMoreLimit: 20,
  }),
  customDateRangePicker({
    container: '#intro-date-picker',
    attribute: 'Intro date',
    min: 1546300800, // Jan 1, 2019 (adjust as needed)
    max: Math.floor(Date.now() / 1000), // Current timestamp
  }),
  instantsearch.widgets.refinementList({
    container: '#themes-list',
    attribute: 'Themes',
    searchable: true,
    searchablePlaceholder: 'Search themes',
    showMore: true,
    limit: 10,
    showMoreLimit: 20,
  }),
  instantsearch.widgets.refinementList({
    container: '#entity-type-list',
    attribute: 'Entity Type',
    searchable: false, // Remove search functionality
    showMore: true,
    limit: 10,
    showMoreLimit: 20,
  }),
  instantsearch.widgets.refinementList({
    container: '#status-list',
    attribute: 'Status',
    searchable: false,
    limit: 10,
    showMore: true,
    showMoreLimit: 20,
  }),
  instantsearch.widgets.stats({
    container: '#stats',
  }),
]);

// Start the search instance
search.start();

// Custom logic for placeholder in the search box
setTimeout(() => {
  const searchInput = document.querySelector('.ais-SearchBox-input');
  if (searchInput) {
    const originalPlaceholder = searchInput.placeholder;

    // Event listener to clear placeholder on focus
    searchInput.addEventListener('focus', function () {
      this.placeholder = '';
    });

    // Event listener to restore placeholder on blur
    searchInput.addEventListener('blur', function () {
      if (this.value === '') {
        this.placeholder = originalPlaceholder;
      }
    });

    // Event listener to adjust placeholder dynamically
    searchInput.addEventListener('input', function () {
      if (this.value === '') {
        this.placeholder = originalPlaceholder;
      } else {
        this.placeholder = '';
      }
    });
  } else {
    console.error('Search input element not found');
  }
}, 500);

// Event listeners for interactions
document.addEventListener('click', function (e) {
  if (e.target && e.target.classList.contains('summary-text')) {
    e.target.classList.toggle('expanded');
  }
  if (e.target && e.target.classList.contains('bill-name')) {
    e.target.classList.toggle('expanded');
  }
});

console.log('Search initialized');