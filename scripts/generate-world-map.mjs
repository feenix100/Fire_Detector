import fs from "node:fs";
import path from "node:path";
import { geoPath } from "d3-geo";
import { geoRobinson } from "d3-geo-projection";
import { feature } from "topojson-client";

const width = 1000;
const height = 500;
const worldPath = path.join("node_modules", "world-atlas", "land-110m.json");
const countriesPath = path.join("node_modules", "world-atlas", "countries-110m.json");
const world = JSON.parse(fs.readFileSync(worldPath, "utf8"));
const countries = JSON.parse(fs.readFileSync(countriesPath, "utf8"));

const worldProjection = geoRobinson().fitExtent(
  [
    [28, 22],
    [width - 28, height - 24]
  ],
  { type: "Sphere" }
);
const worldPathGenerator = geoPath(worldProjection);
const land = feature(world, world.objects.land);
const landPath = worldPathGenerator(land);
const spherePath = worldPathGenerator({ type: "Sphere" });

const northAmericaNames = new Set([
  "Antigua and Barb.",
  "Bahamas",
  "Belize",
  "Canada",
  "Costa Rica",
  "Cuba",
  "Dominica",
  "Dominican Rep.",
  "El Salvador",
  "Greenland",
  "Grenada",
  "Guatemala",
  "Haiti",
  "Honduras",
  "Jamaica",
  "Mexico",
  "Nicaragua",
  "Panama",
  "Puerto Rico",
  "St. Kitts and Nevis",
  "St. Lucia",
  "St. Vin. and Gren.",
  "Trinidad and Tobago",
  "United States of America"
]);
const northAmericaGeo = {
  type: "FeatureCollection",
  features: feature(countries, countries.objects.countries).features.filter((item) =>
    northAmericaNames.has(item.properties.name)
  )
};
const northAmericaPath = featureCollectionToPath(northAmericaGeo, projectNorthAmerica);
const northAmericaFrame = rectanglePath([
  [-170, 5],
  [-50, 5],
  [-50, 84],
  [-170, 84],
  [-170, 5]
], projectNorthAmerica);

const output = `export const WORLD_MAP_PATHS = {
  projection: "Robinson",
  source: "Natural Earth via world-atlas land-110m",
  width: ${width},
  height: ${height},
  land: ${JSON.stringify(landPath)},
  sphere: ${JSON.stringify(spherePath)}
};

export const NORTH_AMERICA_MAP_PATHS = {
  projection: "Regional Mercator",
  source: "Natural Earth via world-atlas countries-110m",
  width: ${width},
  height: ${height},
  bounds: { west: -170, south: 5, east: -50, north: 84 },
  land: ${JSON.stringify(northAmericaPath)},
  frame: ${JSON.stringify(northAmericaFrame)}
};
`;

fs.writeFileSync(path.join("public", "world-map-paths.js"), output);

function featureCollectionToPath(collection, project) {
  return collection.features
    .flatMap((item) => geometryToPaths(item.geometry, project))
    .join("");
}

function geometryToPaths(geometry, project) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [ringsToPath(geometry.coordinates, project)];
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.map((rings) => ringsToPath(rings, project));
  }
  return [];
}

function ringsToPath(rings, project) {
  return rings
    .map((ring) => {
      const points = ring.map(([lon, lat]) => project(lat, lon));
      return `M${points.map((point) => `${round(point.x)},${round(point.y)}`).join("L")}Z`;
    })
    .join("");
}

function rectanglePath(points, project) {
  const projected = points.map(([lon, lat]) => project(lat, lon));
  return `M${projected.map((point) => `${round(point.x)},${round(point.y)}`).join("L")}Z`;
}

function projectNorthAmerica(lat, lon) {
  const bounds = { west: -170, south: 5, east: -50, north: 84 };
  const margin = { left: 42, right: 36, top: 24, bottom: 30 };
  const minY = mercatorY(bounds.north);
  const maxY = mercatorY(bounds.south);
  const x =
    margin.left +
    ((lon - bounds.west) / (bounds.east - bounds.west)) * (width - margin.left - margin.right);
  const y =
    margin.top +
    ((mercatorY(lat) - minY) / (maxY - minY)) * (height - margin.top - margin.bottom);
  return { x, y };
}

function mercatorY(lat) {
  const clamped = Math.max(-85, Math.min(85, lat));
  const radians = (clamped * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

function round(value) {
  return Math.round(value * 10) / 10;
}
