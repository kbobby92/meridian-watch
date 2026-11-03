// Meridian Watch live-traffic relay (Cloudflare Worker, free plan).
//
// The adsb.lol feed no longer lets web pages on other sites read it directly (CORS). This Worker
// fetches the two requests the site needs and returns them with the header that allows your
// GitHub Pages site to read them. It only answers your site, only these two requests, and caches
// each answer for 25 seconds so it never asks adsb.lol more often than needed.
//
// Setup: Cloudflare dashboard → Workers & Pages → Create → Create Worker → name it
// "meridian-relay" → Deploy → Edit code → replace everything with this file → Deploy.

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
