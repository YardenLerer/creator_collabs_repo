/* Builds the single self-contained file.
 *
 * Everything is inlined - the compiled CSS and the bundled JavaScript - so the
 * output is one HTML file that can be dropped on any static host with no build
 * step and no network dependency beyond the database it talks to.
 *
 * esbuild is called as a library. Tailwind is called through its own CLI entry
 * point resolved from node_modules rather than through `npx`, which failed on
 * any machine where npx could not resolve the binary and said nothing useful
 * about why. Both work the same on Windows.
 */
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const tmp = mkdtempSync(join(tmpdir(), "creator-collabs-"));
const stamp = `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;

/* The stamp is written into the source deliberately: App.jsx shows it in the
   tab title, and that is how anybody tells which build they are looking at -
   a question that cost this project several rounds. */
const appPath = join(here, "src/App.jsx");
writeFileSync(appPath,
  readFileSync(appPath, "utf8").replace(/const BUILD = "[^"]*";/, `const BUILD = "${stamp}";`));

// ------------------------------------------------------------------ css ---
const cssOut = join(tmp, "tw.css");
const twCli = join(here, "node_modules", "tailwindcss", "lib", "cli.js");
if (!existsSync(twCli)) {
  console.error("tailwindcss is not installed. Run npm install first.");
  process.exit(1);
}
const tw = spawnSync(process.execPath,
  [twCli, "-c", join(here, "tailwind.config.js"), "-i", join(here, "src/tw.css"), "-o", cssOut, "--minify"],
  { encoding: "utf8" });
if (tw.status !== 0) {
  console.error(tw.stderr || tw.stdout);
  process.exit(1);
}

// ------------------------------------------------------------- javascript ---
const { outputFiles } = await esbuild.build({
  entryPoints: [join(here, "src/main.jsx")],
  bundle: true,
  format: "esm",
  loader: { ".jsx": "jsx" },
  define: { "process.env.NODE_ENV": '"production"' },
  minify: true,
  write: false,
  logLevel: "warning",
});

// ----------------------------------------------------------------- inline ---
let html = readFileSync(join(here, "index.html"), "utf8");
html = html.replace(/<style>[\s\S]*?<\/style>/, `<style>${readFileSync(cssOut, "utf8")}</style>`);
html = html.replace('<script type="module" src="/main.js"></script>',
  `<script type="module">\n${outputFiles[0].text}\n</script>`);

writeFileSync(join(here, "creator-collabs.html"), html);
console.log(`built creator-collabs.html - ${Math.round(html.length / 1024)} KB - ${stamp}`);
