# Creator Collabs

An internal desk for running content-creator visits at a spa chain.

A creator gets a free visit. She shoots footage. Somebody decides what may be
published and what may not. Six screens follow that from end to end:

**Gaps** → **Creators** → **Briefs** → **Visits** → **Intake** → **Library**

---

## What it is for

A marketing team knows it is short of footage — the sauna at San Jose, nobody
in frame, four vertical clips. It finds someone to shoot it, agrees what may be
done with the result, books a date with the branch, and then decides clip by
clip what goes into the library.

The hard part is not the workflow. It is that every step produces a fact
somebody will need to defend in six months: who agreed to what, who approved a
brief, who cleared a clip with a guest in the background.

---

## The rules the code is built around

These are not style preferences. Most of the code exists to hold them.

**A model never touches anything with consequences.** It reads clips and judges
how close a creator's work feels to a request. It never decides how many clips
a gap needs, what the rights say, or whether footage may be released. Those are
computed or entered by a person.

**Violet means a model touched this.** One colour, one meaning, everywhere.
Hand-written sample text is marked as sample and rendered neutrally, because a
description that looks model-produced and is not would make the mark worthless.

**A missing field is never a bad score.** There is no composite total when a
component is missing. A creator with two clips behind her gets "not enough
yet", not a low rating.

**Privacy overrides everything.** A recognisable guest blocks a clip whatever
the creator agreed to, and only a person can clear the flag. When the check
cannot be read, the clip is held — a clip that was never checked is not a clip
that is clean.

**Every decision is signed.** Approvals, rights entries, overrides, visit
answers and privacy clearances all carry a name and a date.

**Nothing is shown as saved until the server says so.** Writes diff, wait, and
put the old state back if they were refused.

---

## Running it

```bash
npm install
npm run build     # produces creator-collabs.html, one self-contained file
npm test          # twenty checks; nothing deploys unless they pass
```

`npm install` is the only manual step. `npm test` bundles the app itself and
then runs everything - there is nothing to prepare first.

The build output is a single HTML file with the CSS and JavaScript inlined.
Drag it onto any static host. It is git-ignored: it is a 1 MB artefact, not
source.

### The database

```bash
# In the Supabase SQL editor, or with the CLI:
psql "$DATABASE_URL" -f supabase/migrations/001_schema.sql
```

Then open the app, paste the project URL and publishable key into the
connection panel. They live in that browser's local storage and are never
committed.

### The two Edge Functions

The source is in `supabase/functions/`. Deploy both:

```bash
supabase functions deploy ai
supabase functions deploy media
```

`ai` reads clips, scores creators and writes shot instructions.
`media` fetches placeholder photography and video.

Both read their API key from a project secret. Set them under **Project
Settings → Edge Functions → Secrets**:

| Secret | Used by |
|---|---|
| `ANTHROPIC_API_KEY` | `ai` |
| any name containing `pexels` | `media` |

No key ever reaches the browser. There is no screen that asks for one.

---

## Security, said plainly

**The row-level policies in the migration allow anonymous read and write on
every table.** That is workable for one team on an unlisted URL and it is not
access control. Anyone with the project URL and the publishable key can read,
change and delete every row.

Before this holds real agreements or real footage, replace those policies with
ones keyed to an authenticated user. The migration says so at the point where
they are created.

---

## Known, and left alone

`validatePrivacy` is exported and tested but nothing calls it - the privacy
path that ships is `clipReadingToPrivacy` in `src/lib/ai.js`, which is simpler.
Both block on doubt, so the product rule holds either way. Removing one is a
decision about which to keep, not a cleanup.

Some seed creators have a coverage note that disagrees with their `home_metro`
- "Los Angeles and Orange County" against `sacramento`. It is fictional data
and harms nothing, but it reads oddly.

## Layout

```
src/
  App.jsx                 the shell, the taxonomy, the validation layer
  lib/
    db.js repos.js        every read and write, and the shape of a row
    sync.js               diffing state against the server
    ai.js                 the model client, and the word matcher
    config.js storage.js  connection, signed URLs
  components/
    Primitives.jsx        button, field, modal, drawer, signature
    Screens.jsx           gaps, creators
    Stages.jsx            visits, briefs, sidebar
    Collab.jsx            creator card, brief, date proposal
    CreatorProfile.jsx    one creator, everything known about her
supabase/
  migrations/             the whole schema in one file
  functions/ai            the model, server side
  functions/media         placeholder photography
test/                     fifteen checks, run by all.sh
```

### The word matcher

The model answers in plain language — "sauna", "nobody in frame". The product
validates against a fixed vocabulary. `src/lib/ai.js` closes that gap in code,
and it is deliberately dumb: exact match, then containment, and nothing else.
A matcher that is right nine times in ten quietly mislabels the tenth clip and
nobody ever finds out which one. Words it cannot match are kept as unmatched
rather than forced into the nearest value.

---

## Tests

```
validation rules              the taxonomy and what counts as a valid answer
the model word matcher        that it stays silent rather than guessing
score row shaping             that a wide object never breaks a write
connection handling           a bad key caught before a request
database failure handling     what a refused write does to what is on screen
the write diff                that only changed rows are sent
stage gates                   which stage is reachable, and why
human names everywhere        no field name reaches a screen
nothing raw reaches a screen  the same thing, checked by rendering
every screen renders          with the real components, above a size floor
the app boots and runs        every stage opens
a first load seeds            the only check that takes the empty-database path
intake opens on click         the crash that shipped twice
library opens on click        the crash that shipped twice
library row shapes            including the shapes a view returns
frames survive a write        the bug that emptied every screen
accepting is one write        and in the order that fails safely
the new features render       stars, specialities, dashboard
every AI has a way in         the button, not the function
no old style layer            the override block stays deleted
```

A missing test file is reported as MISSING and fails the gate. A check that
cannot run is not a check that passed.

The last one is there because a stylesheet that re-pointed Tailwind's classes
with `!important` silently defeated four rounds of redesign. It is gone, and
the test makes sure it stays gone.

---

## Licence

MIT. See `LICENSE`.
