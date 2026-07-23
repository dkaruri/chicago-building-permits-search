import { handlePermits } from "./permits.js";
import { handleProfiles, handleContactDetail } from "./profiles.js";
import { handleStats } from "./stats.js";
import { handleLists } from "./lists.js";
import { handleTags } from "./tags.js";
import { handleNotes } from "./notes.js";

const ROUTES = [
  { pattern: /^\/api\/permits/, handler: handlePermits },
  { pattern: /^\/api\/profiles/, handler: handleProfiles },
  { pattern: /^\/api\/contact\//, handler: handleContactDetail },
  { pattern: /^\/api\/stats/, handler: handleStats },
  { pattern: /^\/api\/lists/, handler: handleLists },
  { pattern: /^\/api\/tags/, handler: handleTags },
  { pattern: /^\/api\/notes/, handler: handleNotes },
];

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    const url = new URL(request.url);
    for (const route of ROUTES) {
      if (route.pattern.test(url.pathname)) {
        try {
          const response = await route.handler(url, env, request);
          // Attach CORS headers to every response
          const headers = new Headers(response.headers);
          for (const [k, v] of Object.entries(corsHeaders(env))) {
            headers.set(k, v);
          }
          return new Response(response.body, {
            status: response.status,
            headers,
          });
        } catch (err) {
          return json({ error: err.message }, 500, env);
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
          "GET /api/lists/:id -> {permits, focal, desc, custom, ticks, meta}",
          "PUT /api/lists/:id  (body: any subset) -> {id, rev}",
          "GET /api/tags -> {tags}",
          "PUT /api/tags  (body: {name, slot})",
          "GET·POST /api/notes/:permit ; PUT·DELETE /api/notes/:permit/:id",
          "GET /api/notes/counts?p=a,b,c -> {counts}",
        ],
      },
      200,
      env
    );
  },

  // ponytail: cron can't run on CF free tier (10ms CPU). Use seed-kv.js locally.
  async scheduled() {},
};

export function json(data, status = 200, env = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(env),
    },
  });
}
