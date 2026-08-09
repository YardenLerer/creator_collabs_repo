/* The connect screen has to catch the one paste that actually matters:
   the secret key, which bypasses every rule in the project. */
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../src/lib/config.js", import.meta.url), "utf8");
const body = src.slice(src.indexOf("export function checkConnectionShape"));
const check = new Function("atob", body.replace("export function", "return function")
  .replace(/\nfunction safeJwt[\s\S]*$/, "\nfunction safeJwt(t){try{return atob(t.split('.')[1]??'')}catch{return''}}")
  + "\n")(globalThis.atob ?? ((s) => Buffer.from(s, "base64").toString()));

let pass = 0, bad = 0;
const t = (n, f) => { try { f(); console.log("  ok   " + n); pass++; } catch (e) { console.log("  FAIL " + n + " — " + e.message); bad++; } };
const yes = (c, m) => { if (!c) throw new Error(m ?? "expected true"); };
const URL_OK = "https://abcdefgh.supabase.co";

t("a good pair passes", () =>
  yes(check({ url: URL_OK, key: "sb_publishable_xxxxxxxxxxxxxxxxxxxx" }).length === 0));

t("the secret key is caught and flagged as dangerous", () => {
  const p = check({ url: URL_OK, key: "sb_secret_abcdefghijklmnop" });
  yes(p.length === 1 && p[0].danger, "must be flagged danger");
  yes(/never go in a browser/i.test(p[0].text));
  yes(/publishable/i.test(p[0].text), "must say which key to use instead");
});

t("a service_role JWT is caught even though it looks like a normal key", () => {
  const jwt = "eyJ." + Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64") + ".sig";
  const p = check({ url: URL_OK, key: jwt });
  yes(p.length === 1 && p[0].danger, "a service_role JWT must be refused");
});

t("a connection string is caught and the person is told to change the password", () => {
  const p = check({ url: URL_OK, key: "postgresql://postgres:hunter2@db.x.supabase.co:5432/postgres" });
  yes(p[0].danger); yes(/change that password/i.test(p[0].text));
});

t("a plain anon JWT is allowed, since older projects still issue them", () => {
  const jwt = "eyJ." + Buffer.from(JSON.stringify({ role: "anon" })).toString("base64") + ".sig";
  yes(check({ url: URL_OK, key: jwt }).length === 0);
});

t("a dashboard URL is rejected with a description of the right shape", () => {
  const p = check({ url: "https://supabase.com/dashboard/project/abcdefgh", key: "sb_publishable_x" });
  yes(p.some((x) => x.field === "url" && /abcdefgh\.supabase\.co/.test(x.text)));
});

t("empty fields are reported as empty, not as malformed", () => {
  const p = check({ url: "", key: "" });
  yes(p.length === 2 && p.every((x) => /empty/i.test(x.text)));
});

console.log(`\n  ${pass} passed, ${bad} failed\n`);
process.exit(bad ? 1 : 0);
