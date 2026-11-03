// Fetch a snapshot of live aircraft (and, when an AISStream key is set, vessels)
// server-side, where the feeds' browser (CORS) restrictions don't apply.
// Writes aircraft.json and ships.json next to index.html. Node 22+, no dependencies.
import { readFileSync, writeFileSync } from "node:fs";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = { "User-Agent": "meridian-watch (github.com/kbobby92/meridian-watch)" };

async function getJSON(url, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: UA, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.headers.get("retry-after") ? "retry-after " + r.headers.get("retry-after") : ""}`.trim());
    return await r.json();
  } finally { clearTimeout(t); }
}

// Areas to sweep: every hotspot and chokepoint, plus the world's busiest air corridors.
const HUBS = [
  [40.7, -74], [41.9, -87.6], [33.9, -118.4], [32.9, -97], [33.6, -84.4], [47.4, -122.3], [25.8, -80.3], [43.7, -79.6],
  [19.4, -99.1], [-23.4, -46.5], [4.7, -74.1], [51.5, -0.5], [49, 2.5], [50, 8.6], [52.3, 4.8], [40.5, -3.6], [41.8, 12.3],
  [55.7, 37.6], [41, 29], [25.3, 55.4], [28.6, 77.1], [19.1, 72.9], [13.7, 100.7], [1.4, 104], [22.3, 114], [31.2, 121.5],
  [39.9, 116.4], [35.6, 139.8], [37.5, 127], [-33.9, 151.2], [-26.1, 28.2], [30.1, 31.4], [53, -30], [60, -150]
];
function points() {
  const pts = [];
  try {
    const d = JSON.parse(readFileSync("data.json", "utf8"));
    for (const p of [...(d.hotspots || []), ...(d.chokepoints || [])]) if (p.lat != null) pts.push([p.lat, p.lng]);
  } catch {}
  pts.push(...HUBS);
  const out = [];
  for (const [la, lo] of pts) if (!out.some(([a, b]) => Math.abs(a - la) < 3 && Math.abs(b - lo) < 3.5)) out.push([la, lo]);
  return out;
}

const pack = (a, mil) => {
  if (a.lat == null || a.lon == null) return null;
  const alt = a.alt_baro === "ground" ? 0 : Math.round(+a.alt_baro || +a.alt_geom || 0);
  return [+a.lat.toFixed(3), +a.lon.toFixed(3), alt, Math.round(a.gs || 0), Math.round(a.track || 0),
    (a.flight || "").trim(), a.t || "", mil || ((a.dbFlags || 0) & 1) ? 1 : 0, a.hex || ""];
};

// Two feeds, each asked at most about once every 1.5 s. Each area goes to adsb.lol first;
// if that is refused (usually rate limiting) it is retried on airplanes.live.
const FEEDS = {
  "adsb.lol": { mil: "https://api.adsb.lol/v2/mil", point: (la, lo) => `https://api.adsb.lol/v2/point/${la}/${lo}/250`, next: 0 },
  "airplanes.live": { mil: "https://api.airplanes.live/v2/mil", point: (la, lo) => `https://api.airplanes.live/v2/point/${la}/${lo}/250`, next: 0 }
};
// adsb.lol allows roughly 18 requests a minute and answers 429 with a Retry-After;
// honour it (up to ~65 s) and try the same request again.
async function ask(name, url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const f = FEEDS[name]; const wait = f.next - Date.now();
    if (wait > 0) await sleep(wait);
    f.next = Date.now() + 1500;
    try { return await getJSON(url); }
    catch (e) {
      const m = /HTTP 429(?: retry-after (\d+))?/.exec(e.message);
      if (!m || attempt === 3) throw e;
      const secs = Math.min(+(m[1] || 30), 65) + 1;
      console.log(`${name}: rate limited, waiting ${secs}s`);
      f.next = Date.now() + secs * 1000;
    }
  }
}
async function aircraft() {
  const map = new Map(); const used = new Set(); const errs = {}; let ok = 0, fail = 0;
  const add = (d, mil, name) => { used.add(name); for (const a of d.ac || []) { const p = pack(a, mil); if (p && (mil || !map.has(p[8]))) map.set(p[8], p); } };
  for (const name of Object.keys(FEEDS)) {
    try { add(await ask(name, FEEDS[name].mil), true, name); break; } catch (e) { console.log(name, "mil", e.message); }
  }
  for (const [la, lo] of points()) {
    let got = false;
    for (const name of ["adsb.lol"]) {
      try { add(await ask(name, FEEDS[name].point(la.toFixed(2), lo.toFixed(2))), false, name); ok++; got = true; break; }
      catch (e) { if ((errs[name] = (errs[name] || 0) + 1) <= 3) console.log(`${name} area ${la},${lo}: ${e.message}`); }
    }
    if (!got) fail++;
  }
  console.log(`areas: ${ok} ok, ${fail} failed; ${map.size} aircraft from ${[...used].join(" + ")}`);
  return map.size ? { source: [...used].join(" + "), ac: [...map.values()] } : null;
}

const AIS_BOXES = [
  [[22, 47], [31, 60]], [[10, 32], [30.5, 45]], [[11, 43], [16, 54]], [[30, 25], [37.5, 36.5]], [[40, 26], [47, 42]],
  [[53, 9], [66, 31]], [[18, 105], [30, 125]], [[-3, 95], [8, 106]], [[-38, 10], [-30, 25]], [[7, -82], [10.5, -77]]
];
async function ships(key, seconds = 50) {
  if (!key) return null;
  const seen = new Map();
  await new Promise(resolve => {
    const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
    const stop = setTimeout(() => { try { ws.close(); } catch {} resolve(); }, seconds * 1000);
    ws.onopen = () => ws.send(JSON.stringify({ APIKey: key, BoundingBoxes: AIS_BOXES, FilterMessageTypes: ["PositionReport"] }));
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString()); } catch { return; }
      if (m.error) { console.log("AISStream:", m.error); clearTimeout(stop); try { ws.close(); } catch {} resolve(); return; }
      const md = m.MetaData; if (!md || md.latitude == null) return;
      const pr = (m.Message || {}).PositionReport || {};
      seen.set(String(md.MMSI), [+md.latitude.toFixed(3), +md.longitude.toFixed(3), pr.Sog ?? null, (md.ShipName || "").trim(), String(md.MMSI)]);
    };
    ws.onerror = e => console.log("AISStream socket error", e.message || "");
  });
  console.log(`AISStream: ${seen.size} vessels`);
  return seen.size ? { source: "AISStream", ships: [...seen.values()] } : null;
}

const at = new Date().toISOString();
const [ac, sh] = await Promise.all([aircraft(), ships(process.env.AISSTREAM_KEY)]);
if (ac) writeFileSync("aircraft.json", JSON.stringify({ at, ...ac }));
if (sh) writeFileSync("ships.json", JSON.stringify({ at, ...sh }));
if (!ac) { console.log("No aircraft source answered"); process.exitCode = 1; }
