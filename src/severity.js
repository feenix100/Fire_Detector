export function getHotspotSeverity(hotspot) {
  // Severity is a local display category, not an official fire classification.
  // It combines FIRMS confidence and FRP (fire radiative power) for quick scanning.
  const frp = Number(hotspot.frp || 0);
  const confidence = hotspot.confidence;

  if (confidence === "h" && frp >= 75) return "Extreme";
  if (confidence === "h" || frp >= 50) return "High";
  if (confidence === "n" || frp >= 20) return "Moderate";
  return "Low";
}

export function getClusterSeverity(cluster) {
  // Clusters are ranked by both size and strongest FRP inside the group.
  if (cluster.hotspotCount >= 10 && cluster.maxFrp >= 75) return "Extreme";
  if (cluster.hotspotCount >= 5 || cluster.maxFrp >= 50) return "High";
  if (cluster.hotspotCount >= 2 || cluster.maxFrp >= 20) return "Moderate";
  return "Low";
}

export function filterByConfidence(hotspots, confidenceFilter) {
  // The dropdown values in index.html map directly to these filter branches.
  if (confidenceFilter === "high") return hotspots.filter((item) => item.confidence === "h");
  if (confidenceFilter === "nominal_high") {
    return hotspots.filter((item) => ["n", "h"].includes(item.confidence));
  }
  return hotspots;
}
