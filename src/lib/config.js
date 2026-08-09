/* ============================================================================
   Where the connection details come from.

   Three sources, in this order of precedence:

     1. What the person typed into the connect screen, kept in this browser.
     2. Build-time environment (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
     3. The demonstration project baked in below.

   The browser wins because pointing this at your own database should not
   require rebuilding it, and because somebody who has connected their own
   project should not silently fall back to the demonstration one.

   The demonstration project comes last and exists so that opening the
   deployed URL shows a working system rather than a form. A reviewer with no
   credentials is not a configuration problem to be solved by asking them to
   go and find two values.

   On the key being in here: `sb_publishable_*` is designed to sit in browser
   code and is served to anyone who loads the page either way. What actually
   governs access is the row-level policy, and this project's policies allow
   anonymous read and write - which the README and the migration both say in
   as many words. Embedding it changes who has to paste it, not who can reach
   the data.

   For a project holding real agreements, the connect screen and a policy
   keyed to an authenticated user are the arrangement to use. This one holds
   invented spas.
============================================================================ */

const STORE_KEY = "creator-collabs.connection";

/* The demonstration project. Publishable key, wide-open policies, fictional
   data - see the note above before pointing anything real at this pattern. */
const DEMO = {
  url: "https://kkvboruhfkllhjapqhny.supabase.co",
  key: "sb_publishable_6L6XTiQHuRQ7uMzz0bob-A_ZP1qc8GK",
};

const fromEnv = () => {
  const url = import.meta?.env?.VITE_SUPABASE_URL;
  const key = import.meta?.env?.VITE_SUPABASE_ANON_KEY;
  // A .env still holding the placeholder is not a configured connection.
  if (!url || !key) return null;
  if (url.includes("YOUR-PROJECT-REF") || key.includes("PASTE_YOUR")) return null;
  return { url: url.replace(/\/+$/, ""), key, source: "env" };
};

const fromBrowser = () => {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const { url, key } = JSON.parse(raw);
    if (!url || !key) return null;
    return { url: url.replace(/\/+$/, ""), key, source: "browser" };
  } catch {
    return null;
  }
};

const fromDemo = () => ({ ...DEMO, source: "demo" });

/**
 * The connection in force.
 *
 * Browser first, then a build-time env, then the demonstration project. The
 * order matters: a person who connected their own database keeps it, and
 * everybody else gets something that works.
 */
export const getConnection = () => fromBrowser() ?? fromEnv() ?? fromDemo();

/** Whether the app is running against the demonstration project. */
export const isDemoConnection = () => !fromBrowser() && !fromEnv();

export function saveConnection({ url, key }) {
  const clean = { url: String(url).trim().replace(/\/+$/, ""), key: String(key).trim() };
  window.localStorage.setItem(STORE_KEY, JSON.stringify(clean));
  return { ...clean, source: "browser" };
}

export function forgetConnection() {
  window.localStorage.removeItem(STORE_KEY);
}

/* The model key used to live here, in this browser. It does not any more:
   every model call goes through the `ai` Edge Function, which holds the key as
   a project secret. This clears the old one out of anyone who still has it. */
try { window.localStorage.removeItem("creator-collabs.model-key"); } catch { /* no storage */ }


/**
 * Says what is wrong with a pasted pair before any request is made, so the
 * person gets "that is the wrong key" instead of a raw 401 out of the network.
 *
 * The service_role check is the one that matters. That key bypasses every
 * policy in the project, and someone who does not work with keys daily has no
 * reason to know which of the two on the Supabase page is which.
 */
export function checkConnectionShape({ url, key }) {
  const problems = [];
  const u = String(url ?? "").trim();
  const k = String(key ?? "").trim();

  if (!u) problems.push({ field: "url", text: "The project URL is empty." });
  else if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(u))
    problems.push({ field: "url", text: "That does not look like a Supabase project URL. It should look like https://abcdefgh.supabase.co and nothing after it." });

  if (!k) problems.push({ field: "key", text: "The key is empty." });
  else if (k.startsWith("sb_secret_") || /"role"\s*:\s*"service_role"/.test(safeJwt(k)))
    problems.push({ field: "key", danger: true, text: "That is the secret key. It bypasses every rule in the project and must never go in a browser. Go back and copy the one labelled publishable or anon instead." });
  else if (k.startsWith("postgresql://") || k.startsWith("postgres://"))
    problems.push({ field: "key", danger: true, text: "That is the database connection string, not a key. It contains your database password. Change that password in Supabase, then copy the publishable key instead." });
  else if (!k.startsWith("sb_publishable_") && !k.startsWith("eyJ"))
    problems.push({ field: "key", text: "That does not look like a Supabase key. The one you want starts with sb_publishable_." });

  return problems;
}

function safeJwt(token) {
  try { return atob(token.split(".")[1] ?? ""); } catch { return ""; }
}
