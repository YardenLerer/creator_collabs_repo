# Changes

Everything that moved after the repository was first assembled. Written
because a list of thirty-two changed files says what was touched and not why.

---

## The deployed page had to work for somebody with no credentials

Opening the URL showed a form asking for a Supabase address and key. A reviewer
has neither and is not going to go looking, so the system read as broken.

**`src/lib/config.js`** — the connection now resolves in three steps: what is
in this browser, then a build-time environment, then a demonstration project
baked into the file. It never returns nothing, so the form never appears.

The browser comes first deliberately. Somebody who connected their own database
should not silently fall back to the shared one.

**`src/App.jsx`** — the connect screen is no longer a gate. It is reachable
from settings, and it can be backed out of.

On the key being in the file: `sb_publishable_*` is designed to sit in browser
code and is served to anyone who loads the page either way. What governs access
is the row-level policy. Embedding it changed who has to paste it, not who can
reach the data — but it did change how easily somebody stumbles into it, which
is what the next change is about.

## Deleting is refused, and the refusal is visible

**`supabase/migrations/002_block_anonymous_delete.sql`** — anonymous callers
may read, create and edit. They may not delete.

Everything a reviewer would actually do still works: write a gap, start a
collab, enter rights, approve a brief, propose a date, read clips, accept them
into the library. What no single request can do is empty the tables.

`shot_items` and `edit_clips` stay deletable. Rebuilding a brief after its gap
changed deletes and re-inserts the whole shot list, and an edit removes clips
from itself the same way. Blocking those would break editing to protect rows
that are regenerated from their parents anyway.

**`src/lib/db.js`** — and this is the part that mattered more than the policy.

A delete that a policy does not permit **is not an error.** PostgREST reports
`204 Success` and removes nothing. Every other write in this codebase refuses
to claim more than the server confirmed; `remove()` was the exception, and
would have reported "deleted" for a row still sitting in the table. It now asks
for the deleted row back and treats an empty result as a refusal.

**`src/App.jsx`** — *Reset to sample data* and *Start empty* clear the tables
before writing, so on the shared project they would report success and leave
the old data in place. They are disabled there, with a line saying why, rather
than offered and quietly wrong.

## Edge Function source, which was missing entirely

**`supabase/functions/ai/index.ts`** and **`supabase/functions/media/index.ts`**
— both directories were empty while the README told you to deploy from them.
Git would not even have pushed them.

Both were verified against the live project: `ai` returned `{instruction,
note}` in 3.3s, `media` returned two items with credit fields in 275ms, and
both secrets resolved — including the Pexels one, still stored under a name
with spaces, which is why the function scans by pattern.

## The repository did not work for anyone who cloned it

Found by an external review, and all of it was correct:

- **`package.json`** — `lucide-react` was imported and never declared, so
  `npm run build` failed on a clean clone.
- **`test/all.mjs`** replaces `test/all.sh`, which used absolute sandbox paths.
  The gate the README described could not run on anyone else's machine.
- **`test/bundle.mjs`** — new. `npm test` now bundles the app itself; there is
  no manual step.
- **`build.mjs`** — calls esbuild as a library and resolves Tailwind out of
  `node_modules` instead of shelling out to `npx`, which failed with an error
  that said nothing about the cause. Writes to a real temp directory rather
  than a hardcoded `/tmp`, so it works on Windows.
- **`.gitignore`** — was blocking `index.built.html`, a filename the build
  never produced, while the real 1 MB artefact was committable. It now names
  what the build actually writes, and the test bundle too.

## One source for the validation layer

There was a standalone `validation.js` that the tests imported, and **nine of
its fourteen functions had drifted** from the ones the app used. The suite was
green against code nobody shipped.

The tests now import the bundle — the same file the screens are rendered from —
so there is no second copy to drift. Two assertions failed immediately and were
real: `matchClipToShots` had grown a third argument, and a refusal message had
been reworded. The wording assertion now asks for an actionable instruction
rather than one phrasing.

## Tests: 15 → 21

**`test/anon.mjs`** — new, and the reason this changelog exists. A browser with
nothing stored: no connect form, reaches the product, calls the demonstration
project, not stuck loading, not on the failure screen. The bug that was
reported, written down as a check.

Also added to the gate: `db.test`, `sync.test`, `states.test`, `rawscan`,
`empty` — seven files that were sitting in the directory and outside the gate.

Two were deleted. `run.cjs` caught its own error and exited zero, and a test
that cannot fail is worse than no test. `root.cjs` predated `mount.mjs` and its
four failures were the old design.

**`test/empty.mjs`** — `attachEvent` is an Internet Explorer API jsdom does not
implement and React probes for. It was failing the check on every machine while
the app was fine. Filtered by name, with a note, rather than by widening the
filter until things passed.

## Documents

**`THINKING.md`** and **`AI-WORK-LOG.md`** — new, written from the code rather
than from description, with every number checked against a run.

**`README.md`** — said "fifteen checks, run by all.sh" in one place and
"twenty" in another. Both were wrong by the end. The count and the list of
checks are now generated from what the gate actually runs.
