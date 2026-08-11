import { handlePermits } from "./permits.js";
import { handleProfiles, handleContactDetail } from "./profiles.js";
import { handleStats } from "./stats.js";
import { handleLists } from "./lists.js";
import { handleTags } from "./tags.js";
import { handleNotes } from "./notes.js";
import { handlePhotos } from "./photos.js";

export { ListRoom } from "./list-room.js";

const ROUTES = [
  { pattern: /^\/api\/permits/, handler: handlePermits },
  { pattern: /^\/api\/profiles/, handler: handleProfiles },
  { pattern: /^\/api\/contact\//, handler: handleContactDetail },
  { pattern: /^\/api\/stats/, handler: handleStats },
  { pattern: /^\/api\/lists/, handler: handleLists },
  { pattern: /^\/api\/tags/, handler: handleTags },
  { pattern: /^\/api\/notes/, handler: handleNotes },
  { pattern: /^\/api\/photo\//, handler: handlePhotos },
];

// ALLOWED_ORIGIN is a comma-separated list so a local preview can exercise the
// real API. The browser compares Access-Control-Allow-Origin to its own origin
// EXACTLY — a list is not a legal value — so the matching origin is echoed back
// and everything else falls to the first entry, which keeps production the
// default for any caller that sends no Origin at all.
//
// `Vary: Origin` is not decoration. The response now differs by request origin,
// and without it any shared cache in front of this Worker may hand a response
// minted for one origin to a browser on another, which fails in a way that
// looks like a Worker bug and is not reproducible locally.
function allowedOrigin(env, request) {
  const configured = (env.ALLOWED_ORIGIN || "*").split(",").map(s => s.trim()).filter(Boolean);
  if (configured.includes("*")) return "*";
  const origin = request && request.headers.get("Origin");
  return origin && configured.includes(origin) ? origin : (configured[0] || "*");
}

function corsHeaders(env, request) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(env, request),
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }

    const url = new URL(request.url);

    // WebSocket live-sync: route the upgrade straight to the list's Durable
    // Object so its 101/404 response is returned untouched by the CORS wrapper.
    const live = url.pathname.match(/^\/api\/lists\/([A-Za-z0-9]{1,16})\/live$/);
    if (live) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      const stub = env.LIST_ROOM.getByName(live[1]);
      const fwd = new URL(request.url);
      fwd.searchParams.set("id", live[1]);
      return stub.fetch(new Request(fwd, request));
    }

    for (const route of ROUTES) {
      if (route.pattern.test(url.pathname)) {
        try {
          const response = await route.handler(url, env, request);
          // Attach CORS headers to every response
          const headers = new Headers(response.headers);
          for (const [k, v] of Object.entries(corsHeaders(env, request))) {
            headers.set(k, v);
          }
          return new Response(response.body, {
            status: response.status,
            headers,
          });
        } catch (err) {
          return json({ error: err.message }, 500, env, request);
        }
      }
    }

    return json(
      {
        name: "Chicago Building Permits API",
        endpoints: [
          "GET /api/permits?q=&ward=&status=&type=&limit=&offset=",
          "GET /api/profiles?category=general_contractor|open_tech",
          "GET /api/contact/:name",
          "GET /api/stats",
          "GET /api/lists?q=&tag=&cursor= -> {lists, cursor}",
          "POST /api/lists  (body: {permits, focal, title, author, desc, tags}) -> {id}",
          "GET /api/lists/:id -> {permits, focal, desc, custom, ticks, fu, called, meta}",
          "PUT /api/lists/:id/ticks | /follow | /called  (body: {key, on, by?}) -> {ok}",
          "PUT /api/lists/:id  (body: any subset) -> {id, rev}",
          "DELETE /api/lists/:id -> soft-delete (30-day trash)",
          "GET /api/tags -> {tags}",
          "PUT /api/tags  (body: {name, slot})",
          "GET·POST /api/notes/:permit ; PUT·DELETE /api/notes/:permit/:id",
          "GET /api/notes/counts?p=a,b,c -> {counts}",
          "GET /api/notes/bulk?p=a,b,c -> {threads,truncated}",
          "POST /api/photo/:permit ; GET·DELETE /api/photo/:permit/:id",
          "GET /api/lists/:id/live (WebSocket) -> live sync",
        ],
      },
      200,
      env,
      request
    );
  },

};

export function json(data, status = 200, env = {}, request = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(env, request),
    },
  });
}
