const geocodeCache = new Map();

export async function geocodeCity(query) {
  // Nominatim converts names like "Phoenix, Arizona" into latitude/longitude.
  // Cache by normalized query so repeated searches do not call the service again.
  const normalized = query.trim().toLowerCase();
  if (geocodeCache.has(normalized)) return geocodeCache.get(normalized);

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");

  const response = await fetch(url, {
    headers: {
      "User-Agent": "DesertFireGrid/1.0 local wildfire dashboard"
    }
  });

  if (!response.ok) throw httpError(502, "Geocoding request failed.");
  const results = await response.json();
  if (!Array.isArray(results) || results.length === 0) {
    throw httpError(404, "Could not find that location. Try adding the state name, such as \"Phoenix, Arizona.\"");
  }

  const first = results[0];
  const result = {
    query,
    lat: Number(first.lat),
    lon: Number(first.lon),
    displayName: first.display_name
  };
  geocodeCache.set(normalized, result);
  return result;
}

export function bboxFromPoint(lat, lon, radiusKm) {
  // NASA FIRMS area searches need a bounding box, not a center point and radius.
  // This approximates kilometers per degree well enough for a search rectangle.
  const safeLat = clamp(Number(lat), -90, 90);
  const safeLon = clamp(Number(lon), -180, 180);
  const latDelta = radiusKm / 111;
  const cosLat = Math.max(Math.cos((safeLat * Math.PI) / 180), 0.000001);
  const lonDelta = radiusKm / (111 * cosLat);
  const west = clamp(safeLon - lonDelta, -180, 180);
  const south = clamp(safeLat - latDelta, -90, 90);
  const east = clamp(safeLon + lonDelta, -180, 180);
  const north = clamp(safeLat + latDelta, -90, 90);

  return [west, south, east, north].map(round4).join(",");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round4(value) {
  return (Math.round(value * 10000) / 10000).toFixed(4);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
