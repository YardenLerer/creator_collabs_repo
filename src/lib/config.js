/* ============================================================================
   Where the connection details come from.

   Two sources, in this order:

     1. Build-time environment (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY),
        for anyone running this locally with a .env file.

     2. What the person typed into the connect screen, kept in this browser.

   Source 2 exists because the key should not have to pass through a file, a
   commit, or a build log to get here. It goes from the clipboard to the
   browser and stops. Nobody else's machine ever sees it, and rotating it means
   pasting a new one, not redeploying.

   Neither value is a secret in the sense that matters - the publishable key is
   designed to sit in browser code, and the README says plainly what that means
   for this project. Keeping it out of the repository is about not leaving
   copies lying around, not about pretending it is protected.
============================================================================ */

const STORE_KEY = "creator-collabs.connection";

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

export const getConnection = () => fromEnv() ?? fromBrowser();

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
