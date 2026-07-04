export const STATES = {
  arizona: { label: "Arizona", bbox: "-115,31,-109,37" },
  california: { label: "California", bbox: "-125,32,-114,42" },
  nevada: { label: "Nevada", bbox: "-120,35,-114,42" },
  new_mexico: { label: "New Mexico", bbox: "-109.1,31.2,-103,37" },
  utah: { label: "Utah", bbox: "-114.1,37,-109,42.1" },
  colorado: { label: "Colorado", bbox: "-109.1,37,-102,41.1" },
  texas: { label: "Texas", bbox: "-106.7,25.8,-93.5,36.6" },
  oregon: { label: "Oregon", bbox: "-124.7,42,-116.4,46.3" },
  washington: { label: "Washington", bbox: "-124.8,45.5,-116.9,49.1" },
  idaho: { label: "Idaho", bbox: "-117.3,42,-111,49.1" },
  montana: { label: "Montana", bbox: "-116.1,44.3,-104,49.1" },
  wyoming: { label: "Wyoming", bbox: "-111.1,41,-104,45.1" }
};

export function resolveState(key) {
  return STATES[String(key || "").toLowerCase()];
}
