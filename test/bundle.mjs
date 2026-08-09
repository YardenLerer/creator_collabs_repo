/* Bundles the app once so the tests can render it.
 *
 * The screens live in a JSX module tree Node cannot import directly, so this
 * compiles them to one CommonJS file the tests require. It runs from
 * `npm test` automatically - there is no manual step.
 *
 * Everything is resolved relative to this file, so the suite works from a
 * clone on any machine. It previously used absolute sandbox paths, which meant
 * the gate the README describes could not run for anybody else.
 */
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/* The app exports what it renders. The tests need the helpers too, because the
   screens take them as props - and a test that invents stubs instead would
   pass while the real component was broken. */
const EXPORTS = [
  "HomeScreen", "LibraryScreen", "GapsScreen", "CreatorsScreen", "BriefsScreen",
  "VisitsScreen", "IntakeScreen", "ClipCard", "CreatorCard", "GapCard",
  "BranchManagerApp", "CollabDetail", "ProposeDate", "CreatorProfile", "App",
  "makeGap", "makeCreator", "makeCollab", "makeClip",
  "SEED_GAPS", "SEED_CREATORS", "buildWorkedExample",
  "buildSampleCollabs", "buildSampleClips", "crossSearch", "Avatar",
];

const app = readFileSync(join(root, "src/App.jsx"), "utf8");
writeFileSync(join(here, ".app.jsx"),
  app.split('"./lib/').join('"../src/lib/').split('"./components/').join('"../src/components/')
  + "\nexport { " + EXPORTS.join(", ") + " };\n");
writeFileSync(join(here, ".entry.jsx"), 'export * from "./.app.jsx";\n');

/* lucide-react draws icons. The tests care whether a screen renders, not what
   an icon looks like, so every icon becomes an empty span.
 *
 * The stub declares a named export per icon the app imports, read out of the
 * source. A Proxy cannot satisfy a named import - esbuild resolves those at
 * build time - which is why the earlier version failed on the first icon and
 * took the whole suite down with it. */
const icons = [...new Set(
  [...app.matchAll(/from\s+"lucide-react"/g)].length
    ? (app.match(/import\s*\{([^}]+)\}\s*from\s*"lucide-react"/s)?.[1] ?? "")
        .split(",").map((n) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean)
    : [],
)];

const shim = join(root, "node_modules", ".lucide-stub");
mkdirSync(shim, { recursive: true });
writeFileSync(join(shim, "index.mjs"),
  'import React from "react";\n'
  + 'const I = () => React.createElement("span", null, null);\n'
  + icons.map((n) => `export const ${n} = I;`).join("\n")
  + "\nexport default I;\n");

if (icons.length === 0) {
  console.warn("  no lucide imports found - the stub is empty, which is wrong if the app draws icons");
}

await esbuild.build({
  entryPoints: [join(here, ".entry.jsx")],
  bundle: true,
  outfile: join(here, "out.cjs"),
  format: "cjs",
  platform: "node",
  loader: { ".jsx": "jsx", ".css": "empty" },
  external: ["react", "react-dom", "react-dom/server", "react-dom/client", "jsdom"],
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [{
    name: "icon-stub",
    setup(b) { b.onResolve({ filter: /^lucide-react$/ }, () => ({ path: join(shim, "index.mjs") })); },
  }],
  logLevel: "warning",
});

console.log("  bundling the app for the tests    ok");
