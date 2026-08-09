import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Fetches placeholder footage and stills from Pexels.
//
//   const { data } = await supabase.functions.invoke('media', {
//     body: { kind: 'photos', query: 'sauna interior', per_page: 6, orientation: 'portrait' }
//   })
//
// The key lives here as a project secret and never reaches the browser.
//
// Everything this returns is PLACEHOLDER. The rows it fills are marked as
// sample data, because a stranger's sauna is not footage a creator shot at a
// branch, and telling those apart is the whole point of the product.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// The secret is read by pattern rather than by exact name. On the original
// project it was stored as `pexels api key`, with spaces, and an exact lookup
// returned nothing - which looked exactly like a broken integration for two
// rounds. Renaming it in the dashboard cannot silently break the screens now.
function readKey(): { name: string; value: string } | null {
  const env = Deno.env.toObject();
  const name = Object.keys(env).find((n) => /pex/i.test(n) && env[n]?.trim());
  return name ? { name, value: env[name].trim() } : null;
}

type Photo = { id: number; alt: string; photographer: string; url: string; src: Record<string, string> };
type Video = {
  id: number; duration: number; width: number; height: number; url: string;
  user: { name: string }; image: string;
  video_files: { link: string; quality: string; width: number; height: number; file_type: string }[];
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  const key = readKey();
  if (!key) {
    return json({
      error: "no_key",
      message:
        "No Pexels key is set on this project. Add one under Project Settings, Edge Functions, Secrets. " +
        "Any name mentioning pexels works.",
    }, 500);
  }

  let kind: string, query: string, per_page: number, orientation: string, size: string;
  try {
    const body = await req.json();
    kind = body.kind ?? "photos";
    query = String(body.query ?? "").trim();
    per_page = Math.min(Math.max(Number(body.per_page) || 6, 1), 30);
    orientation = body.orientation ?? "portrait";
    size = body.size ?? "medium";
  } catch {
    return json({ error: "bad_request", message: "Body must be JSON." }, 400);
  }

  if (!query) return json({ error: "no_query", message: "Say what to look for." }, 400);
  if (kind !== "photos" && kind !== "videos") {
    return json({ error: "unknown_kind", message: "kind must be photos or videos." }, 400);
  }

  const url = new URL(`https://api.pexels.com/${kind === "videos" ? "videos/search" : "v1/search"}`);
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", String(per_page));
  url.searchParams.set("orientation", orientation);
  url.searchParams.set("size", size);

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: key.value } });
  } catch (e) {
    return json({ error: "upstream_unreachable", message: String(e).slice(0, 200) }, 502);
  }

  const raw = await res.text();
  if (!res.ok) {
    if (res.status === 401) {
      return json({ error: "bad_key", message: `Pexels refused the key held in "${key.name}".` }, 502);
    }
    if (res.status === 429) {
      return json({ error: "rate_limited", message: "Pexels is rate limiting this key. Wait a minute." }, 502);
    }
    return json({ error: "upstream_error", status: res.status, body: raw.slice(0, 400) }, 502);
  }

  let parsed: { photos?: Photo[]; videos?: Video[]; total_results?: number };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "bad_upstream_json", body: raw.slice(0, 400) }, 502);
  }

  // Only the fields the app needs, and credit on every item - the licence asks
  // for it, and a picture whose source is unknown is one nobody can make a
  // decision about later.
  if (kind === "photos") {
    const items = (parsed.photos ?? []).map((p) => ({
      id: `px_${p.id}`,
      alt: p.alt || query,
      credit: p.photographer,
      source: p.url,
      small: p.src.medium,
      large: p.src.large,
      portrait: p.src.portrait,
    }));
    return json({ kind, query, items, total: parsed.total_results ?? items.length, ms: Date.now() - started });
  }

  const items = (parsed.videos ?? []).map((v) => {
    // The smallest file still worth watching. A 4K master is not a sample clip,
    // and downloading one to make a thumbnail is rude to whoever is on a phone.
    const files = [...(v.video_files ?? [])]
      .filter((f) => f.file_type === "video/mp4")
      .sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
    const pick = files.find((f) => (f.width ?? 0) >= 640) ?? files[files.length - 1] ?? null;
    return {
      id: `px_${v.id}`,
      alt: query,
      credit: v.user?.name ?? "",
      source: v.url,
      duration: v.duration,
      width: pick?.width ?? v.width,
      height: pick?.height ?? v.height,
      poster: v.image,
      file: pick?.link ?? null,
    };
  }).filter((v) => v.file);

  return json({ kind, query, items, total: parsed.total_results ?? items.length, ms: Date.now() - started });
});
