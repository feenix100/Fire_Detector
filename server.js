import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchFirmsData, getAllowedSources } from "./src/firms.js";
import { clusterHotspots } from "./src/clustering.js";
import { filterByConfidence, getHotspotSeverity } from "./src/severity.js";
import { bboxFromPoint, geocodeCity } from "./src/geocode.js";

// server.js is the small backend for the app. It serves the static frontend files
// and exposes API routes that hide the NASA FIRMS key from the browser.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;
const KEY_PATH = path.join(__dirname, "APIKEY.txt");
const MISSING_KEY_MESSAGE =
  "Missing NASA FIRMS API key. Create APIKEY.txt and place your FIRMS MAP_KEY inside it.";

let firmsMapKey = "";
try {
  // APIKEY.txt can contain either the raw key or a line like API_KEY="..."
  firmsMapKey = parseApiKeyFile(fs.readFileSync(KEY_PATH, "utf8"));
} catch {
  firmsMapKey = "";
}

const app = express();

// Cache identical FIRMS requests briefly so repeated clicks do not hammer NASA's API.
const firmsCache = new Map();
const CACHE_MS = 5 * 60 * 1000;

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/geocode", async (req, res) => {
  try {
    // This endpoint is available for future autocomplete/search UI work.
    const query = String(req.query.query || "").trim();
    if (!query) return res.status(400).json({ error: "Location query is required." });
    const result = await geocodeCity(query);
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.get("/api/firms", async (req, res) => {
  try {
    if (!firmsMapKey) return res.status(500).json({ error: MISSING_KEY_MESSAGE });

    // 1. Validate browser parameters.
    // 2. Convert the location input into lat/lon and a FIRMS bbox.
    // 3. Fetch NASA CSV data, enrich it, and return JSON to the browser.
    const params = validateFirmsParams(req.query);
    const location = await resolveLocation(params);

    // NASA FIRMS area queries are limited here to a maximum of 5 days.
    const effectiveDays = Math.min(params.days, 5);

    // The resolved location is included because location names can map to different coordinates.
    const cacheKey = JSON.stringify({
      source: params.source,
      date: params.date,
      days: params.days,
      effectiveDays,
      confidence: params.confidence,
      locationType: params.locationType,
      location,
      radiusMiles: params.radiusMiles
    });
    const cached = firmsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_MS) {
      return res.json({ ...cached.payload, cached: true });
    }

    const rawHotspots = await fetchFirmsData({
      mapKey: firmsMapKey,
      source: params.source,
      bbox: location.bbox,
      days: effectiveDays
    });
    const hotspots = filterByConfidence(rawHotspots, params.confidence).map((hotspot) => ({
      ...hotspot,
      severity: getHotspotSeverity(hotspot)
    }));

    // Cluster mode groups nearby detections. Raw mode sends individual hotspots.
    const clusters = params.mode === "clusters" ? clusterHotspots(hotspots) : [];
    const activeItems = params.mode === "clusters" ? clusters : hotspots;
    const payload = {
      updatedAt: new Date().toISOString(),
      location,
      mapType: "world",
      date: params.date,
      source: params.source,
      days: params.days,
      effectiveDays,
      mode: params.mode,
      confidence: params.confidence,
      count: activeItems.length,
      rawCount: hotspots.length,
      hotspots: params.mode === "raw" ? hotspots : [],
      clusters,
      summary: buildSummary(hotspots, clusters, params.mode)
    };

    firmsCache.set(cacheKey, { timestamp: Date.now(), payload });
    res.json(payload);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

function validateFirmsParams(query) {
  // Treat all browser input as untrusted. This normalizes defaults and rejects bad values.
  const source = String(query.source || "VIIRS_SNPP_NRT");
  const date = String(query.date || currentLocalDate());
  const days = Number(query.days || 5);
  const mode = String(query.mode || "raw");
  const confidence = String(query.confidence || "all");
  const locationType = String(query.locationType || "location");
  const radiusMiles = Number(query.radiusMiles || query.radiusKm || 200);

  if (!getAllowedSources().includes(source)) throw httpError(400, "Invalid source.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw httpError(400, "Invalid date.");
  }
  if (![1, 2, 3, 4, 5].includes(days)) throw httpError(400, "Invalid day range.");
  if (!["raw", "clusters"].includes(mode)) throw httpError(400, "Invalid display mode.");
  if (!["all", "nominal_high", "high"].includes(confidence)) {
    throw httpError(400, "Invalid confidence filter.");
  }
  if (!["location", "coordinates"].includes(locationType)) {
    throw httpError(400, "Invalid location input type.");
  }
  if (!isValidRadiusMiles(radiusMiles)) throw httpError(400, "Invalid radius.");

  return {
    source,
    date,
    days,
    mode,
    confidence,
    locationType,
    location: String(query.location || query.city || "Phoenix, Arizona").trim(),
    lat: query.lat,
    lon: query.lon,
    radiusMiles,
    radiusKm: milesToKm(radiusMiles)
  };
}

async function resolveLocation(params) {
  // Location mode geocodes a city/place name. Coordinate mode trusts the numeric fields after validation.
  if (params.locationType === "location") {
    if (!params.location) throw httpError(400, "Empty location input.");
    const result = await geocodeCity(params.location);
    return {
      label: result.displayName,
      lat: result.lat,
      lon: result.lon,
      bbox: bboxFromPoint(result.lat, result.lon, params.radiusKm),
      type: "location",
      radiusMiles: params.radiusMiles,
      radiusKm: params.radiusKm
    };
  }

  const lat = Number(params.lat);
  const lon = Number(params.lon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw httpError(400, "Invalid latitude.");
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw httpError(400, "Invalid longitude.");
  return {
    label: `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
    lat,
    lon,
    bbox: bboxFromPoint(lat, lon, params.radiusKm),
    type: "coordinates",
    radiusMiles: params.radiusMiles,
    radiusKm: params.radiusKm
  };
}

function buildSummary(hotspots, clusters, mode) {
  // Summary counts match the currently selected display mode.
  const items = mode === "clusters" ? clusters : hotspots;
  return {
    highSeverityCount: items.filter((item) => item.severity === "High").length,
    extremeSeverityCount: items.filter((item) => item.severity === "Extreme").length,
    lowSeverityCount: items.filter((item) => item.severity === "Low").length,
    moderateSeverityCount: items.filter((item) => item.severity === "Moderate").length
  };
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isValidRadiusMiles(value) {
  return Number.isFinite(value) && value >= 25 && value <= 200 && value % 25 === 0;
}

function milesToKm(value) {
  return Math.round(value * 1.609344 * 10000) / 10000;
}

function parseApiKeyFile(contents) {
  // Accept a plain key file or dotenv-like "API_KEY=value" so setup is less brittle.
  const trimmed = contents.trim();
  const match = trimmed.match(/^API_KEY\s*=\s*(.+)$/i);
  return (match ? match[1] : trimmed).trim().replace(/^["']|["']$/g, "");
}

function currentLocalDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

app.listen(PORT, () => {
  console.log(`Desert Fire Grid running at http://localhost:${PORT}`);
  if (!firmsMapKey) console.warn(MISSING_KEY_MESSAGE);
});
