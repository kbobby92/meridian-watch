// Russian-occupied territory of Ukraine, from DeepState's daily map as republished in GeoJSON by
// github.com/cyterat/deepstate-map-data (updated about 03:00 UTC). Writes control_ua.json.
import { writeFileSync } from "node:fs";
const base = "https://raw.githubusercontent.com/cyterat/deepstate-map-data/main/data/deepstatemap_data_";
const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, "");
for (let back = 0; back < 5; back++) {
  const d = new Date(Date.now() - back * 864e5);
  try {
    const r = await fetch(base + ymd(d) + ".geojson", { signal: AbortSignal.timeout(30000) });
    if (!r.ok) { console.log(`DeepState ${ymd(d)}: HTTP ${r.status}`); continue; }
    const j = await r.json(), f = (j.features || [])[0];
    if (!f || !f.geometry) { console.log("DeepState: no geometry"); continue; }
    // Round to ~100 m to keep the file small.
    const round = c => typeof c[0] === "number" ? [+c[0].toFixed(3), +c[1].toFixed(3)] : c.map(round);
    writeFileSync("control_ua.json", JSON.stringify({ at: new Date().toISOString(), date: d.toISOString().slice(0, 10), source: "DeepState", geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) } }));
    console.log(`DeepState ${ymd(d)}: ok`);
    break;
  } catch (e) { console.log(`DeepState ${ymd(d)}: ${e.message}`); }
}
