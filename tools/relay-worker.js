// Meridian Watch live-traffic relay (Cloudflare Worker, free plan).
//
// The adsb.lol feed no longer lets web pages on other sites read it directly (CORS). This Worker
// fetches the two requests the site needs and returns them with the header that allows your
// GitHub Pages site to read them. It only answers your site, only these two requests, and caches
// each answer for 25 seconds so it never asks adsb.lol more often than needed.
//
// It also serves /opensky: every aircraft OpenSky sees worldwide, packed small, refreshed at most
// every 2 minutes (about 720 requests a day, within a free account's 4000-credit allowance).
//
// Setup: Cloudflare dashboard → Workers & Pages → Create → Create Worker → name it
// "meridian-relay" → Deploy → Edit code → replace everything with this file → Deploy.
// For /opensky, add two secrets under the worker's Settings → Variables and Secrets:
// OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET (from your OpenSky account's API client).

const ALLOWED_ORIGINS = ["https://kbobby92.github.io"];

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: cors });
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return new Response("Forbidden", { status: 403, headers: cors });

    const path = new URL(request.url).pathname;
    if (path === "/opensky") return withCors(await openskyWorld(env, ctx), cors);
    let upstream = null, m;
    if (path === "/mil") {
      upstream = "https://api.adsb.lol/v2/mil";
    } else if ((m = path.match(/^\/point\/(-?\d{1,2}(?:\.\d+)?)\/(-?\d{1,3}(?:\.\d+)?)\/(\d{1,3})$/))) {
      const lat = Math.max(-90, Math.min(90, +m[1])), lng = Math.max(-180, Math.min(180, +m[2])), nm = Math.min(+m[3], 250);
      upstream = `https://api.adsb.lol/v2/point/${lat.toFixed(1)}/${lng.toFixed(1)}/${nm}`;
    }
    if (!upstream) return new Response("Not found", { status: 404, headers: cors });

    const cache = caches.default;
    const key = new Request(upstream);
    let res = await cache.match(key);
    if (!res) {
      const r = await fetch(upstream, { headers: { "User-Agent": "meridian-watch relay (github.com/kbobby92/meridian-watch)" } });
      res = new Response(r.body, {
        status: r.status,
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=25" }
      });
      if (r.ok) ctx.waitUntil(cache.put(key, res.clone()));
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  }
};

function withCors(res, cors) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
  return out;
}

const UA = { "User-Agent": "meridian-watch relay (github.com/kbobby92/meridian-watch)" };
let token = null, tokenExp = 0;
// Returns { token } or { error } with a plain description of what went wrong (never the secret itself).
async function openskyToken(env) {
  const id = (env.OPENSKY_CLIENT_ID || "").trim(), secret = (env.OPENSKY_CLIENT_SECRET || "").trim();
  if (!id || !secret) return { error: `OpenSky secrets not found on the relay (client id ${id ? "set" : "missing"}, client secret ${secret ? "set" : "missing"})` };
  if (token && Date.now() < tokenExp) return { token };
  let r;
  try {
    r = await fetch("https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token", {
      method: "POST", headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret })
    });
  } catch (e) { return { error: `OpenSky sign-in could not be reached: ${e.message}` }; }
  if (!r.ok) {
    const txt = (await r.text()).slice(0, 300);
    return { error: `OpenSky sign-in refused (HTTP ${r.status}) for client id "${id}": ${txt}` };
  }
  const j = await r.json();
  token = j.access_token; tokenExp = Date.now() + Math.max(60, (j.expires_in || 1800) - 120) * 1000;
  return { token };
}

// Same packing as the site's aircraft.json:
// [lat, lng, altFt, groundSpeedKt, trackDeg, callsign, type, military, hex, reportedAtEpochS, source]
async function openskyWorld(env, ctx) {
  const cache = caches.default, key = new Request("https://meridian-relay.internal/opensky-world");
  const hit = await cache.match(key);
  if (hit) return hit;
  const t = await openskyToken(env);
  if (!t.token) return new Response(JSON.stringify({ error: t.error }), { status: 503, headers: { "Content-Type": "application/json" } });
  const r = await fetch("https://opensky-network.org/api/states/all", { headers: { ...UA, Authorization: `Bearer ${t.token}` } });
  if (!r.ok) return new Response(JSON.stringify({ error: `OpenSky data request refused (HTTP ${r.status}): ${(await r.text()).slice(0, 200)}` }), { status: 502, headers: { "Content-Type": "application/json", "Cache-Control": "max-age=30" } });
  const d = await r.json();
  const ac = (d.states || []).filter(s => s[5] != null && s[6] != null && !s[8]).map(s => [
    +s[6].toFixed(3), +s[5].toFixed(3), Math.round((s[7] ?? s[13] ?? 0) * 3.28084), Math.round((s[9] || 0) * 1.94384),
    Math.round(s[10] || 0), (s[1] || "").trim(), "", 0, s[0], s[3] || d.time, "o"]);
  const res = new Response(JSON.stringify({ at: new Date((d.time || Date.now() / 1000) * 1000).toISOString(), source: "OpenSky", ac }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=120" }
  });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}
