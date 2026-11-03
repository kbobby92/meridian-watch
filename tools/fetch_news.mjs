// Breaking news for Meridian Watch, fetched server-side every run of the site workflow.
//  - breaking.json: recent headlines from major outlets' public RSS feeds plus GDELT's article
//    index, kept only when they match a tracked hotspot, newest first.
// Raw, unverified headlines: they are not checked or ranked. Node 22+, no dependencies.
import { readFileSync, writeFileSync } from "node:fs";

const UA = { "User-Agent": "meridian-watch (github.com/kbobby92/meridian-watch)" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, ms = 20000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { headers: UA, signal: ctl.signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.text(); }
  finally { clearTimeout(t); }
}

const FEEDS = [
  ["BBC", "https://feeds.bbci.co.uk/news/world/rss.xml"],
  ["Al Jazeera", "https://www.aljazeera.com/xml/rss/all.xml"],
  ["The Guardian", "https://www.theguardian.com/world/rss"],
  ["DW", "https://rss.dw.com/rdf/rss-en-world"],
  ["France 24", "https://www.france24.com/en/rss"],
  ["NPR", "https://feeds.npr.org/1004/rss.xml"]
];

// Keyword patterns per hotspot (case-insensitive, whole words). The hotspot with most matches wins.
const HOT = {
  iran: ["iran(ian)?", "tehran", "irgc", "hormuz", "khamenei", "araghchi", "qeshm", "pezeshkian"],
  ukraine: ["ukrain(e|ian)", "kyiv", "zelensky[iy]?", "kharkiv", "zaporizhzhia", "donetsk", "dnipro", "odesa", "kremlin"],
  levant: ["gaza", "israel(i)?", "hezbollah", "lebanon", "lebanese", "hamas", "west bank", "netanyahu"],
  yemen: ["houthis?", "yemen(i)?", "red sea", "aden", "bab el-mandeb", "ansarallah"],
  sudan: ["sudan(ese)?", "rsf", "khartoum", "darfur", "el fasher", "rapid support forces"],
  drc: ["congo(lese)?", "drc", "m23", "kinshasa", "goma", "kivu"],
  taiwan: ["taiwan(ese)?", "taipei", "pla", "taiwan strait"],
  scs: ["south china sea", "scarborough", "second thomas", "spratly", "philippine coast guard"],
  blacksea: ["black sea", "bosporus", "sevastopol"],
  baltic: ["baltic", "undersea cable", "kaliningrad"],
  horn: ["somalia", "somaliland", "ethiopia(n)?", "eritrea", "al-shabaab"],
  korea: ["north korea(n)?", "pyongyang", "kim jong un"],
  venezuela: ["venezuela(n)?", "maduro", "machado", "caracas"],
  iraq: ["iraq(i)?", "baghdad", "syria(n)?", "damascus", "erbil", "kurdistan"]
};
const HOT_RE = Object.fromEntries(Object.entries(HOT).map(([k, ws]) => [k, ws.map(w => new RegExp(`\\b${w}\\b`, "gi"))]));
function tag(text) {
  let best = null, bestN = 0;
  for (const [k, res] of Object.entries(HOT_RE)) {
    const n = res.reduce((a, re) => a + ((text.match(re) || []).length), 0);
    if (n > bestN) { best = k; bestN = n; }
  }
  return best;
}

const decode = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;|&#8217;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/\s+/g, " ").trim();
function parseFeed(xml, source) {
  const out = [];
  for (const m of xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/g)) {
    const b = m[0], g = re => { const x = b.match(re); return x ? decode(x[1]) : ""; };
    const title = g(/<title[^>]*>([\s\S]*?)<\/title>/);
    let url = g(/<link>([\s\S]*?)<\/link>/) || (b.match(/<link[^>]*href="([^"]+)"/) || [])[1] || "";
    const when = g(/<pubDate>([\s\S]*?)<\/pubDate>/) || g(/<dc:date>([\s\S]*?)<\/dc:date>/) || g(/<updated>([\s\S]*?)<\/updated>/) || g(/<published>([\s\S]*?)<\/published>/);
    const desc = g(/<description>([\s\S]*?)<\/description>/) || g(/<summary[^>]*>([\s\S]*?)<\/summary>/);
    const t = Date.parse(when);
    if (!title || !/^https?:\/\//.test(url) || isNaN(t)) continue;
    out.push({ t: new Date(t).toISOString(), title, url, source, hotspot: tag(`${title} ${title} ${desc}`) });
  }
  return out;
}

const GDELT_TERMS = '(Iran OR Hormuz OR Ukraine OR Kyiv OR Gaza OR Hezbollah OR Houthi OR Sudan OR Congo OR Taiwan OR "North Korea" OR Venezuela OR Iraq OR Syria OR Somalia)';
async function gdeltArticles() {
  const q = encodeURIComponent(`${GDELT_TERMS} sourcelang:english`);
  const txt = await get(`https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=ArtList&maxrecords=75&timespan=3h&sort=DateDesc&format=json`);
  let j; try { j = JSON.parse(txt); } catch { throw new Error("GDELT said: " + txt.slice(0, 160).replace(/\s+/g, " ")); }
  return (j.articles || []).map(a => {
    const s = a.seendate || ""; // 20261103T201500Z
    const t = Date.parse(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`);
    return isNaN(t) || !a.title || !a.url ? null : { t: new Date(t).toISOString(), title: decode(a.title), url: a.url, source: a.domain || "GDELT", hotspot: tag(a.title), via: "GDELT" };
  }).filter(Boolean);
}
const now = Date.now(), DAY = 24 * 3600e3;
const items = [];
for (const [name, url] of FEEDS) {
  try { const got = parseFeed(await get(url), name); items.push(...got); console.log(`${name}: ${got.length} items, ${got.filter(x => x.hotspot).length} on hotspots`); }
  catch (e) { console.log(`${name}: ${e.message}`); }
}
try { const g = await gdeltArticles(); items.push(...g); console.log(`GDELT articles: ${g.length}, ${g.filter(x => x.hotspot).length} on hotspots`); } catch (e) { console.log(`GDELT articles: ${e.message}`); }

const seen = new Set();
const norm = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").slice(0, 80);
const breaking = items
  .filter(x => x.hotspot && now - Date.parse(x.t) < DAY && Date.parse(x.t) <= now + 5 * 60e3)
  .sort((a, b) => b.t.localeCompare(a.t))
  .filter(x => { const k = norm(x.title); if (seen.has(k)) return false; seen.add(k); return true; })
  .slice(0, 80);
const at = new Date().toISOString();
writeFileSync("breaking.json", JSON.stringify({ at, items: breaking }));
console.log(`breaking: ${breaking.length} items`);
