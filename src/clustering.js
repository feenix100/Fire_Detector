import { getClusterSeverity } from "./severity.js";

export function clusterHotspots(hotspots, radiusKm = 10) {
  // Simple greedy clustering: each hotspot joins the first existing cluster within radiusKm.
  // To make clustering stricter or looser, adjust the default radiusKm value.
  const clusters = [];

  for (const hotspot of hotspots) {
    const match = clusters.find((cluster) =>
      haversineKm(hotspot.latitude, hotspot.longitude, cluster.centerLat, cluster.centerLon) <= radiusKm
    );

    if (match) {
      match.hotspots.push(hotspot);
      recalculateCluster(match);
    } else {
      clusters.push({
        id: `cluster-${clusters.length + 1}`,
        centerLat: hotspot.latitude,
        centerLon: hotspot.longitude,
        hotspotCount: 1,
        maxFrp: Number(hotspot.frp || 0),
        avgFrp: Number(hotspot.frp || 0),
        highestConfidence: hotspot.confidence || "",
        hotspots: [hotspot],
        severity: "Low"
      });
    }
  }

  return clusters.map((cluster) => {
    const { hotspots: _hotspots, ...publicCluster } = cluster;
    return { ...publicCluster, severity: getClusterSeverity(cluster) };
  });
}

function recalculateCluster(cluster) {
  // Recompute cluster center and summary stats whenever a hotspot is added.
  const count = cluster.hotspots.length;
  const totals = cluster.hotspots.reduce(
    (acc, hotspot) => {
      const frp = Number(hotspot.frp || 0);
      acc.lat += hotspot.latitude;
      acc.lon += hotspot.longitude;
      acc.frp += frp;
      acc.maxFrp = Math.max(acc.maxFrp, frp);
      acc.highestConfidence = rankConfidence(hotspot.confidence) > rankConfidence(acc.highestConfidence)
        ? hotspot.confidence
        : acc.highestConfidence;
      return acc;
    },
    { lat: 0, lon: 0, frp: 0, maxFrp: 0, highestConfidence: "" }
  );

  cluster.centerLat = round4(totals.lat / count);
  cluster.centerLon = round4(totals.lon / count);
  cluster.hotspotCount = count;
  cluster.maxFrp = round1(totals.maxFrp);
  cluster.avgFrp = round1(totals.frp / count);
  cluster.highestConfidence = totals.highestConfidence;
  cluster.severity = getClusterSeverity(cluster);
}

function haversineKm(lat1, lon1, lat2, lon2) {
  // Haversine distance accounts for Earth's curvature and returns kilometers.
  const earthKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function rankConfidence(value) {
  return { l: 1, n: 2, h: 3 }[value] || 0;
}

function toRad(degrees) {
  return (degrees * Math.PI) / 180;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}
