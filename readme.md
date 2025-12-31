# US Federal Policy Tracker (Typesense + InstantSearch)

A static, browser-based search interface for exploring a curated dataset of US federal policy / legislative items.
It uses **Typesense** as the search backend and **InstantSearch.js** for a fast UI with faceted filtering, pagination, and hybrid (keyword + vector) search.

## What this is
- A front-end UI (HTML/CSS/JS) that:
  - Queries a Typesense collection (e.g., `bills_federal`)
  - Supports keyword search + hybrid/vector search behavior
  - Provides filters for policy type, themes, entity type, status, and date ranges
  - Displays results as cards with summary text and outbound links (LegiScan + entity source)

## What this is not
- This repo does **not** include the backend ingestion pipeline that generates the dataset.
- This repo is **not** intended to be a general-purpose Typesense admin tool.
- This repo should not be used to host secrets: the API key used in the UI must be **search-only**.

---

## Live link / Home
The tracker UI includes a "Home" link back to:
- https://integrityinstitute.org/legislative-tracker

---

## Architecture (high-level)
- **Browser UI**
  - InstantSearch.js widgets for search box, hits, pagination, stats, refinement lists
  - Custom widgets:
    - "Current legislative session only" checkbox refinement
    - Intro date range picker (Flatpickr + InstantSearch range connector)
- **Typesense**
  - Hosts the search collection and supports faceting + hybrid/vector search
- **Hybrid Search**
  - Uses a normalized query and applies vector/keyword weighting
  - When the query is empty: disables hybrid/vector and runs a normal faceted browse

---

## Files (typical)
- `index.html` – main page and layout
- `typesense-instantsearch-demo/src/app.js` – UI logic (InstantSearch configuration + widgets)
- `typesense-instantsearch-demo/src/app.css` – UI styling

> Note: some deployments may bundle JS/CSS differently. Adjust paths accordingly.

---

## Setup / Configuration

### 1) Typesense connection
In `app.js` (or equivalent), configure:

- `apiKey`: **search-only** key
- `nodes`: host + https port 443
- `indexName`: e.g. `bills_federal`
- `query_by`: comma-separated field list (text fields only)

Example:

```js
const typesenseInstantsearchAdapter = new TypesenseInstantSearchAdapter({
  server: {
    apiKey: "SEARCH_ONLY_KEY",
    nodes: [{ host: "YOUR_HOST", port: "443", protocol: "https" }],
    connectionTimeoutSeconds: 10
  },
  additionalSearchParameters: {
    query_by: "Name,Introduced by,Themes,Bill Summary"
  }
});