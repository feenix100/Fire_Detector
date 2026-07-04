// Browser-side dashboard code:
// - reads the controls in index.html
// - calls the Express API in server.js
// - renders summary/table data
// - draws FIRMS detections on the Leaflet/OpenStreetMap map
// Help text shown under the sensor dropdown when the selected FIRMS source changes.
const SOURCE_HELP = {
  VIIRS_SNPP_NRT: "Good default near-real-time fire detection",
  VIIRS_NOAA20_NRT: "Additional VIIRS near-real-time detections",
  VIIRS_NOAA21_NRT: "Newer VIIRS near-real-time detections",
  MODIS_NRT: "Older lower-resolution near-real-time detections",
  LANDSAT_NRT: "Higher-detail detections where available",
  GOES_NRT: "Geostationary near-real-time fire detections"
};

const SEVERITY_COLORS = {
  Low: "#ffd34e",
  Moderate: "#ff7a18",
  High: "#ff3131",
  Extreme: "#a855f7"
};

// Leaflet expects coordinates as [latitude, longitude].
const DEFAULT_MAP_CENTER = [33.4484, -112.074];

const elements = {
  locationType: document.querySelector("#locationType"),
  location: document.querySelector("#location"),
  lat: document.querySelector("#lat"),
  lon: document.querySelector("#lon"),
  radiusMiles: document.querySelector("#radiusMiles") || document.querySelector("#radiusKm"),
  date: document.querySelector("#date"),
  source: document.querySelector("#source"),
  days: document.querySelector("#days"),
  mode: document.querySelector("#mode"),
  confidence: document.querySelector("#confidence"),
  fetchButton: document.querySelector("#fetchButton"),
  sourceHelper: document.querySelector("#sourceHelper"),
  message: document.querySelector("#message"),
  detectionMap: document.querySelector("#detectionMap"),
  summary: document.querySelector("#summary"),
  tableHead: document.querySelector("#tableHead"),
  tableBody: document.querySelector("#tableBody"),
  listTitle: document.querySelector("#listTitle"),
  mapLocation: document.querySelector("#mapLocation"),
  headerLocation: document.querySelector("#headerLocation"),
  headerDate: document.querySelector("#headerDate"),
  lastFetched: document.querySelector("#lastFetched")
};

const today = formatDateInputValue(new Date());

// These are created once in getLeafletMap() and reused after each search.
let leafletMap = null;
let detectionLayer = null;
let searchLayer = null;

// Initial page state before the user presses "Fetch Satellite Data".
elements.date.value = today;
elements.headerDate.textContent = today;

drawWorldMap();
renderSummary();
renderEmptyList("Awaiting manual fetch.");

// Any control change updates the header preview, but data is not fetched until the button is pressed.
document.querySelectorAll("select, input").forEach((input) => {
  input.addEventListener("change", () => {
    updateLocationFields();
    updateHeaderContext();
    elements.sourceHelper.textContent = SOURCE_HELP[elements.source.value];
    showMessage("Settings changed. Press \"Fetch Satellite Data\" to load updated results.");
  });
});

elements.fetchButton.addEventListener("click", fetchSatelliteData);
updateLocationFields();

async function fetchSatelliteData() {
  // Validate in the browser first so simple mistakes never hit the server.
  const validationError = validateInputs();
  if (validationError) {
    showMessage(validationError, true);
    return;
  }

  const params = new URLSearchParams({
    source: elements.source.value,
    date: elements.date.value,
    days: elements.days.value,
    mode: elements.mode.value,
    confidence: elements.confidence.value,
    locationType: elements.locationType.value,
    location: elements.location.value.trim(),
    lat: elements.lat.value,
    lon: elements.lon.value,
    radiusMiles: elements.radiusMiles?.value || "200"
  });

  setLoading(true);
  showMessage("Fetching NASA FIRMS thermal detections...");

  try {
    // /api/firms is implemented in server.js. It returns JSON for both success and error cases.
    const response = await fetch(`/api/firms?${params.toString()}`);
    const data = await parseJsonResponse(response);
    if (!response.ok) throw new Error(data.error || "Frontend fetch failure.");

    updateDashboard(data);
    const itemCount = data.mode === "clusters" ? data.clusters.length : data.hotspots.length;
    showMessage(
      itemCount
        ? `Loaded ${itemCount} ${data.mode === "clusters" ? "clusters" : "thermal detections"}.`
        : "No FIRMS thermal detections found for the selected settings.",
      false,
      true
    );
  } catch (error) {
    showMessage(error.message || "Frontend fetch failure.", true);
  } finally {
    setLoading(false);
  }
}

async function parseJsonResponse(response) {
  // If Express crashes or a wrong URL is requested, the browser may receive HTML instead of JSON.
  // This makes that failure easier to understand from the UI.
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const preview = text.trim().slice(0, 80);
    throw new Error(
      `Backend did not return JSON. Open the app at http://localhost:3000 and refresh. Response started with: ${preview}`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Backend returned invalid JSON.");
  }
}

function updateDashboard(data) {
  // This is the single place that applies fresh API data to all visible dashboard sections.
  const locationLabel = shortLocation(data.location);
  elements.headerLocation.textContent = locationLabel;
  elements.headerDate.textContent = data.date;
  elements.lastFetched.textContent = new Date(data.updatedAt).toLocaleString();
  elements.mapLocation.textContent = `LOCATION: ${locationLabel.toUpperCase()}`;
  renderSummary(data);
  drawWorldMap(data);
  if (data.mode === "clusters") renderClusterList(data.clusters);
  else renderHotspotList(data.hotspots);
}

function updateLocationFields() {
  // The location and coordinate inputs occupy the same area. Only one mode is visible at a time.
  const type = elements.locationType.value;
  document.querySelectorAll(".location-field").forEach((field) => {
    field.classList.toggle("is-hidden", field.dataset.field !== type);
  });
}

function updateHeaderContext() {
  const type = elements.locationType.value;
  if (type === "location") elements.headerLocation.textContent = elements.location.value.trim() || "Location search";
  if (type === "coordinates") {
    elements.headerLocation.textContent = elements.lat.value && elements.lon.value
      ? `${elements.lat.value}, ${elements.lon.value}`
      : "Coordinates";
  }
  elements.headerDate.textContent = elements.date.value;
}

function validateInputs() {
  // Server-side validation still exists; this just gives faster feedback in the UI.
  if (!elements.date.value) return "Invalid date.";
  if (elements.locationType.value === "location" && !elements.location.value.trim()) return "Empty location input.";
  if (elements.locationType.value === "coordinates") {
    const lat = Number(elements.lat.value);
    const lon = Number(elements.lon.value);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return "Invalid latitude.";
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) return "Invalid longitude.";
  }
  return "";
}

function renderSummary(data = null) {
  // Summary cards use the same renderer for the empty state and for real data.
  const cards = [
    ["Total detections", data ? data.count : "0"],
    ["Selected location", data ? shortLocation(data.location) : "Phoenix, Arizona"],
    ["Detection date", data ? data.date : today],
    ["Satellite/source", data ? data.source : elements.source.value],
    ["Time range", data ? formatDaysLabel(data) : "Past 5 days"],
    ["Confidence filter", confidenceLabel(data ? data.confidence : elements.confidence.value)],
    ["High severity count", data ? data.summary.highSeverityCount : "0"],
    ["Extreme severity count", data ? data.summary.extremeSeverityCount : "0"]
  ];

  elements.summary.innerHTML = cards
    .map(([label, value]) => `<article class="summary-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></article>`)
    .join("");
}

function drawWorldMap(data = null) {
  // The name is kept because older code calls it, but this now updates a Leaflet map.
  const map = getLeafletMap();
  if (!map) return;

  detectionLayer.clearLayers();
  searchLayer.clearLayers();

  if (!data) {
    map.setView(DEFAULT_MAP_CENTER, 5);
    return;
  }

  drawSearchArea(data.location);
  drawDetectionOverlays(data);
  fitMapToSearch(data.location);
}

function getLeafletMap() {
  // Leaflet is loaded from a script tag in index.html, so it appears as window.L.
  const L = window.L;
  if (!L || !elements.detectionMap) {
    showMessage("Leaflet map library is still loading. Refresh if the map does not appear.", true);
    return null;
  }

  if (leafletMap) return leafletMap;

  // Create the map once. Later searches only clear/redraw the overlay layers.
  leafletMap = L.map(elements.detectionMap, {
    zoomControl: true,
    scrollWheelZoom: true,
    worldCopyJump: true
  }).setView(DEFAULT_MAP_CENTER, 5);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(leafletMap);

  searchLayer = L.layerGroup().addTo(leafletMap);
  detectionLayer = L.layerGroup().addTo(leafletMap);

  setTimeout(() => leafletMap.invalidateSize(), 0);
  return leafletMap;
}

function drawSearchArea(location) {
  // The backend sends a FIRMS bbox string as "west,south,east,north".
  // Leaflet rectangles use [[south, west], [north, east]].
  const L = window.L;
  const bbox = parseBbox(location?.bbox);
  if (!bbox) return;

  L.rectangle(
    [
      [bbox.south, bbox.west],
      [bbox.north, bbox.east]
    ],
    {
      color: "#66f2ff",
      weight: 1,
      opacity: 0.8,
      fillColor: "#66f2ff",
      fillOpacity: 0.05,
      dashArray: "6 5"
    }
  ).addTo(searchLayer);
}

function drawDetectionOverlays(data) {
  // Raw mode draws every hotspot; cluster mode draws one marker for each computed cluster.
  const items = data.mode === "clusters" ? data.clusters : data.hotspots;
  items.forEach((item) => {
    if (data.mode === "clusters") drawClusterOverlay(item);
    else drawHotspotOverlay(item);
  });
}

function drawHotspotOverlay(hotspot) {
  // Circle size uses FRP so stronger detections are easier to spot visually.
  const L = window.L;
  const lat = Number(hotspot.latitude);
  const lon = Number(hotspot.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

  const color = SEVERITY_COLORS[hotspot.severity] || SEVERITY_COLORS.Low;
  const radius = Math.min(10, 4 + Math.sqrt(Number(hotspot.frp || 0)) / 4);

  L.circleMarker([lat, lon], {
    radius,
    color: "#fff6df",
    weight: 1,
    fillColor: color,
    fillOpacity: 0.88,
    opacity: 0.95
  })
    .bindPopup(`
      <strong>${escapeHtml(hotspot.severity || "Detection")}</strong><br>
      Lat/Lon: ${formatNumber(lat)}, ${formatNumber(lon)}<br>
      FRP: ${formatNumber(hotspot.frp, 1)}<br>
      Confidence: ${escapeHtml(hotspot.confidence || "")}<br>
      Date: ${escapeHtml(hotspot.acq_date || "")} ${escapeHtml(hotspot.acq_time || "")}
    `)
    .addTo(detectionLayer);
}

function drawClusterOverlay(cluster) {
  // Cluster size uses hotspotCount so larger groups stand out from isolated detections.
  const L = window.L;
  const lat = Number(cluster.centerLat);
  const lon = Number(cluster.centerLon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

  const color = SEVERITY_COLORS[cluster.severity] || SEVERITY_COLORS.Low;
  const radius = Math.min(22, 7 + Math.sqrt(cluster.hotspotCount) * 2.4);

  L.circleMarker([lat, lon], {
    radius,
    color: "#fff6df",
    weight: 1,
    fillColor: color,
    fillOpacity: 0.72,
    opacity: 0.95
  })
    .bindTooltip(`${escapeHtml(cluster.severity)} ${cluster.hotspotCount}`, {
      direction: "right",
      offset: [8, 0],
      opacity: 0.9
    })
    .bindPopup(`
      <strong>${escapeHtml(cluster.severity || "Cluster")}</strong><br>
      Center: ${formatNumber(lat)}, ${formatNumber(lon)}<br>
      Hotspots: ${cluster.hotspotCount}<br>
      Max FRP: ${formatNumber(cluster.maxFrp, 1)}<br>
      Avg FRP: ${formatNumber(cluster.avgFrp, 1)}
    `)
    .addTo(detectionLayer);
}

function fitMapToSearch(location) {
  // After each fetch, zoom to the searched area instead of leaving the user at the previous map view.
  const L = window.L;
  const bbox = parseBbox(location?.bbox);
  if (!bbox) {
    leafletMap.setView([location?.lat || DEFAULT_MAP_CENTER[0], location?.lon || DEFAULT_MAP_CENTER[1]], 5);
    return;
  }

  leafletMap.fitBounds(
    L.latLngBounds(
      [bbox.south, bbox.west],
      [bbox.north, bbox.east]
    ),
    { padding: [28, 28], maxZoom: 10 }
  );
}

function parseBbox(value) {
  // Converts the FIRMS bbox string into named numbers so later code is harder to mix up.
  const parts = String(value || "").split(",").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;
  return {
    west: parts[0],
    south: parts[1],
    east: parts[2],
    north: parts[3]
  };
}

function renderHotspotList(hotspots) {
  elements.listTitle.textContent = "Recent Hotspots";
  elements.tableHead.innerHTML = "<tr><th>Date</th><th>Time</th><th>Lat</th><th>Lon</th><th>FRP</th><th>Confidence</th><th>Severity</th></tr>";
  elements.tableBody.innerHTML = hotspots.slice(0, 20).map((item) => `
    <tr>
      <td>${escapeHtml(item.acq_date || "")}</td>
      <td>${escapeHtml(item.acq_time || "")}</td>
      <td>${formatNumber(item.latitude)}</td>
      <td>${formatNumber(item.longitude)}</td>
      <td>${formatNumber(item.frp, 1)}</td>
      <td>${escapeHtml(item.confidence || "")}</td>
      <td>${escapeHtml(item.severity || "")}</td>
    </tr>
  `).join("") || emptyRow(7);
}

function renderClusterList(clusters) {
  elements.listTitle.textContent = "Simple Clusters";
  elements.tableHead.innerHTML = "<tr><th>ID</th><th>Center Lat</th><th>Center Lon</th><th>Hotspots</th><th>Max FRP</th><th>Avg FRP</th><th>Severity</th></tr>";
  elements.tableBody.innerHTML = clusters.slice(0, 20).map((item) => `
    <tr>
      <td>${escapeHtml(item.id)}</td>
      <td>${formatNumber(item.centerLat)}</td>
      <td>${formatNumber(item.centerLon)}</td>
      <td>${item.hotspotCount}</td>
      <td>${formatNumber(item.maxFrp, 1)}</td>
      <td>${formatNumber(item.avgFrp, 1)}</td>
      <td>${escapeHtml(item.severity)}</td>
    </tr>
  `).join("") || emptyRow(7);
}

function renderEmptyList(message) {
  elements.tableHead.innerHTML = "<tr><th>Status</th></tr>";
  elements.tableBody.innerHTML = `<tr><td>${escapeHtml(message)}</td></tr>`;
}

function emptyRow(colspan) {
  return `<tr><td colspan="${colspan}">No FIRMS thermal detections found for the selected settings.</td></tr>`;
}

function shortLocation(location) {
  if (!location) return "Phoenix, Arizona";
  if (location.type === "location") return location.label.split(",").slice(0, 3).join(",");
  return location.label;
}

function confidenceLabel(value) {
  return {
    all: "All",
    nominal_high: "Nominal + High",
    high: "High only"
  }[value] || value;
}

function formatDaysLabel(data) {
  const selected = `Past ${data.days} day${data.days > 1 ? "s" : ""}`;
  if (data.effectiveDays && data.effectiveDays !== data.days) {
    return `${selected} (FIRMS queried ${data.effectiveDays})`;
  }
  return selected;
}

function setLoading(isLoading) {
  elements.fetchButton.disabled = isLoading;
  elements.fetchButton.textContent = isLoading ? "Fetching..." : "Fetch Satellite Data";
}

function showMessage(text, isError = false, isOk = false) {
  elements.message.textContent = text;
  elements.message.classList.toggle("error", isError);
  elements.message.classList.toggle("ok", isOk);
}

function formatNumber(value, digits = 4) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function formatDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
