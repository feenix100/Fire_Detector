import { parse } from "csv-parse/sync";

// NASA FIRMS exposes several sensor feeds. The frontend sends one of these names,
// and server.js rejects anything that is not in this allow-list.
const SOURCES = [
  "VIIRS_SNPP_NRT",
  "VIIRS_NOAA20_NRT",
  "VIIRS_NOAA21_NRT",
  "MODIS_NRT",
  "LANDSAT_NRT",
  "GOES_NRT"
];

const NUMERIC_FIELDS = new Set([
  "latitude",
  "longitude",
  "frp",
  "bright_ti4",
  "bright_ti5",
  "scan",
  "track"
]);

const KEEP_FIELDS = [
  "latitude",
  "longitude",
  "acq_date",
  "acq_time",
  "satellite",
  "instrument",
  "confidence",
  "frp",
  "daynight",
  "bright_ti4",
  "bright_ti5",
  "scan",
  "track"
];

export function getAllowedSources() {
  return SOURCES;
}

export async function fetchFirmsData({ mapKey, source, bbox, days }) {
  // FIRMS returns CSV, not JSON. This function handles the HTTP request and parsing.
  const url = buildFirmsUrl({ mapKey, source, bbox, days });
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    const message = body.trim() || `HTTP ${response.status}`;
    throw httpError(502, `FIRMS request failure: ${message}`);
  }
  const csv = await response.text();
  if (!csv.trim()) return [];
  return parseFirmsCsv(csv);
}

export function buildFirmsUrl({ mapKey, source, bbox, days }) {
  // API format: /area/csv/{MAP_KEY}/{SOURCE}/{west,south,east,north}/{days}
  return `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/${source}/${bbox}/${days}`;
}

export function parseFirmsCsv(csv) {
  try {
    // columns:true turns each CSV row into an object keyed by the header names.
    const rows = parse(csv, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    return rows
      .map((row) => normalizeHotspot(row))
      .filter((row) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude));
  } catch {
    throw httpError(502, "CSV parse failure.");
  }
}

function normalizeHotspot(row) {
  // Keep only fields the UI uses, and convert numeric-looking strings to numbers.
  const hotspot = {};
  for (const field of KEEP_FIELDS) {
    if (!(field in row)) continue;
    hotspot[field] = NUMERIC_FIELDS.has(field) ? toNumber(row[field]) : row[field];
  }
  return hotspot;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
