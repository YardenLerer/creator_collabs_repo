import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// The one place the model is called from. The key is a project secret and
// never reaches a browser.
//
// Tasks:
//   read_clip     - what is in a clip, and whether a face is recognisable
//   score_creator - topical affinity for a batch of gaps, in a validated shape
//   brief_notes   - how to shoot a shot that has already been computed
//   search        - free text turned into taxonomy values
//
// What the model is NOT asked, anywhere: how many clips a gap needs, which
// room, which branch, what the rights say, or whether a clip may be released.
// Those are computed or entered by a person. A model guessing at them would be
// guessing at the parts that carry consequences.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "claude-sonnet-4-6";

function readKey(): string | null {
  const env = Deno.env.toObject();
  const name = Object.keys(env).find((n) => /anthropic/i.test(n) && env[n]?.trim());
  return name ? env[name].trim() : null;
}

// score_creator answers in the exact shape the app's validation layer already
// checks: a results array, one object per gap_id, with basis values drawn
// verbatim from a vocabulary supplied in the input. That layer is older than
// this function and is the thing that catches a model inventing a value, so
// the prompt is written to satisfy it rather than the other way round.
const PROMPTS: Record<string, string> = {
  read_clip: `You are looking at frames from one short video shot inside a spa.

Answer with JSON only, no prose and no markdown fence:
{"room":"","action":"","framing":"","lighting":"","people_visible":false,"face_recognisable":false,"quality_notes":""}

Use plain words a person would say out loud: "sauna", "nobody in frame", "close",
"warm and dim". Do not invent a vocabulary.

face_recognisable is the one field with consequences. If a guest's face could be
recognised by someone who knows them, it is true. If you are unsure, it is true.
Do not soften it and do not weigh it against how good the shot is.`,

  score_creator: `You rate topical affinity only: how naturally a creator's editorial territory produces the footage a gap describes.

Geography, travel, scheduling, deadlines, priority and volume are computed elsewhere and are deliberately absent from your input. Never infer or comment on them.

Answer with JSON only, no markdown fence:
{"results":[{"gap_id":"","affinity":0,"basis":[],"rationale":"","concern":null}]}

Rules:
- Every value in "basis" MUST appear verbatim in allowed_vocabulary. Never invent, translate or abbreviate a value, and never use a value that is not in allowed_vocabulary even if you believe it is valid.
- "basis" holds 1 to 4 values, taken from the creator's verticals and the gap's rooms and scenes.
- "affinity" is an integer 0-100.
- "rationale" is one plain sentence, 120 characters maximum.
- "concern" is a real tension in 80 characters maximum, or null. Do not invent one.
- Return one result object for every gap_id you were given.`,

  brief_notes: `You are writing shooting instructions for one shot on a creator brief. The room, the count, the format and the scene are already decided and are given to you. Do not change them, restate them as a list, or add shots.

Answer with JSON only:
{"instruction":"","note":""}

"instruction" is what she should actually do, two sentences at most, in plain English a person would say on a phone call. It should cover holding the shot long enough to be usable and staying clear of guests.

"note" is one short line of craft advice specific to this room: what tends to go wrong in a room like this one.

No emoji, no exclamation marks, no marketing language.`,

  search: `Turn a person's description of footage into the controlled values this system uses. You are given the allowed values. Answer with JSON only:
{"matched":{},"unmatched":[]}

Only use values from the lists given. Anything you cannot map goes in unmatched rather than being forced into the nearest value.`,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  const key = readKey();
  if (!key) {
    return json({
      error: "no_key",
      message: "No Anthropic key is set on this project. Add one under Project Settings, Edge Functions, Secrets.",
    }, 500);
  }

  let task: string, input: unknown, images: string[], max_tokens: number;
  try {
    const b = await req.json();
    task = b.task; input = b.input ?? {}; images = b.images ?? []; max_tokens = b.max_tokens ?? 1600;
  } catch {
    return json({ error: "bad_request", message: "Body must be JSON." }, 400);
  }

  const system = PROMPTS[task];
  if (!system) return json({ error: "unknown_task", message: `No task called ${task}.` }, 400);

  if (task === "read_clip" && (!Array.isArray(images) || images.length === 0)) {
    return json({ error: "no_frames", message: "This clip has no frames to read." }, 400);
  }

  // deno-lint-ignore no-explicit-any
  const content: any[] = [];
  for (const url of images.slice(0, 8)) {
    content.push({ type: "image", source: { type: "url", url } });
  }
  content.push({ type: "text", text: JSON.stringify(input) });

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL, max_tokens, system, messages: [{ role: "user", content }] }),
    });
  } catch (e) {
    return json({ error: "upstream_unreachable", message: String(e).slice(0, 200) }, 502);
  }

  const raw = await res.text();
  if (!res.ok) {
    if (res.status === 401) return json({ error: "bad_key", message: "Anthropic refused the key on this project." }, 502);
    if (res.status === 429) return json({ error: "rate_limited", message: "Rate limited. Wait a moment." }, 502);
    return json({ error: "upstream_error", status: res.status, body: raw.slice(0, 400) }, 502);
  }

  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    return json({ error: "bad_upstream_json", body: raw.slice(0, 400) }, 502);
  }

  const text = (parsed.content ?? [])
    // deno-lint-ignore no-explicit-any
    .filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();

  // The model was told JSON only. If it fenced it anyway, that is not a reason
  // to fail the whole call - the caller still gets the text and decides.
  let data = null;
  try {
    data = JSON.parse(text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
  } catch { /* leave null */ }

  return json({ task, data, text, frames_read: images.length, ms: Date.now() - started });
});
