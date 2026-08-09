# How this was built

Two sessions with Claude, in a browser, with the database, the deploy target
and the model all reachable as tools. That mattered more than it sounds: it
meant a claim could be checked against a running system in the same breath it
was made, and several of the failures below were caught that way rather than
by reasoning about the code.

## Method

**Session one: the product.** The taxonomy, the validation layer, the six
screens, the rules about what a model may and may not decide. Everything lived
in browser storage. The output was a single HTML file.

**Session two: the real thing.** Supabase behind it, the Edge Functions, the
design handoff, and the long tail of making it true rather than plausible.

The working shape in both was the same: small steps, a check after each, and a
build stamp visible in the tab so there was never a question about which
version was on screen. That stamp exists because of a failure, see below.

## Deploys, in order

Every deploy went to one address that updates in place, and the build stamp in
the sidebar and the tab title said which build it was.

1. **First working build**, browser storage, six screens, no database.
2. **Database**, schema, repositories, the sync layer that puts state back
   when a write is refused.
3. **Storage**, frames and originals in two private buckets, signed on read.
4. **The design handoff**, five screens rebuilt from Claude Design HTML,
   token by token.
5. **The style layer removed**, see failure four's cousin below.
6. **Edge Functions**: the model key moved out of the browser entirely.
7. **Pexels**, placeholder footage, marked as placeholder.
8. **The last four screens**, Visits, Briefs, Intake, Library.
9. **The additions**, recommendations, specialities, the Today dashboard, the
   three AI capabilities beyond clip reading.

## Course corrections

**The library was a view, not a table.** Acceptance was built as a second write
into `library`, with a comment explaining that this froze the rights at the
moment of acceptance. Both parts were wrong: a joined view cannot be written
to, and the rights are read live. Acceptance became one write on the clip, and
the consequence, renegotiating a collab's rights changes what may be done with
footage already accepted under them, is now written down in the migration
rather than assumed away.

**Seven groups in Intake became two.** Each of the seven headings was true, and
together they read as a wall of chores. The distinctions did not disappear;
they moved onto the card they describe, as a state pill and one action.

**Stars on creator profiles.** Asked for, and pushed back on, because a
composite score computed from partial data is exactly what the product spends
its validation layer preventing. What shipped counts signed human answers to
"would you book her again", five stars is four out of four people saying yes,
and clicking through shows the four names.

## The four failures worth reading

### 1. A schema written from a summary

The database schema was written from a summary of the data model rather than
from reading the code that produced it. It looked right. The database rejected
twelve rows on the first real write.

**The database was right to refuse.** A permissive schema would have taken the
rows and the data would have been quietly wrong for weeks, and by the time
somebody noticed, the wrong rows would have been indistinguishable from the
right ones. The refusal was a load-bearing constraint doing its job at the only
moment it could still be cheap.

The fix was not to loosen the schema. It was to go and read the code.

### 2. The same mistake, one layer down

A migration renamed and retyped `room_type` in every table that had a column by
that name. But `room_type` means two different things:

```sql
-- gaps: a set of rooms the footage could come from
room_type  text[] not null default '{}'

-- shot_items: one room, for one shot
room_type  text
```

Treating a name as a type is the same error as trusting a summary, assuming
that things that look alike are alike.

**And the test written to catch it covered four tables out of six, and missed
exactly the two the bug survived in.** That is the part worth sitting with: the
test was written by the same process that had just made the assumption, so it
tested the tables that fit the assumption. A test written from the same
misunderstanding as the code confirms the misunderstanding.

### 3. An error message that did not read the error

Every upload failure produced the same sentence: *the browser could not decode
this file.* It was written once, for the case where a browser genuinely cannot
decode a codec, and then it caught everything.

The real cause was different: the environment was blocking media loading
entirely, and the message pointed users at their files instead.

The uncomfortable part: **this product contains an entire mechanism for
stopping a model from claiming more than it knows.** Confidence downgrades,
`unmatched` instead of a forced value, `not_found` distinguished from
`refused`. None of it was applied to the error messages the product writes
itself. The scepticism was pointed outward at the model and not at our own
output. Failures now carry the code that produced them.

### 4. A key stored under a name with spaces

The Pexels key was saved as `pexels api key`. The function looked up
`PEXELS_API_KEY`. Environment variable names are case- and space-sensitive, so
the lookup returned nothing, and the failure looked exactly like a broken
integration, for two rounds, while the key sat there working.

What settled it was checking instead of guessing: a temporary function that
returned only the *names* of matching variables and the length of the value,
never the value. It answered in one call.

The fix does not require anyone to rename anything:

```ts
// The secret is read by pattern rather than by exact name, so renaming it
// in the dashboard cannot silently break the screens.
const name = Object.keys(env).find((n) => /pex/i.test(n) && env[n]?.trim());
```

## What the tests are for

`npm test` runs **21 checks**, and they are a fair record of what went wrong:

```
validation rules            29 assertions
the model word matcher      12
stage gates                 17
database failure handling    9
the write diff               9
connection handling          7
frames survive a write       7
score row shaping            4
accepting is one write       4
```

plus rendering checks that boot the app, click into Intake and Library, render
every screen with the real components above a size floor, confirm no field name
reaches a screen, and open the page as a stranger with nothing stored - which
is the check that came from a real report rather than from imagining one.

Several exist because the same bug shipped twice:

- **intake / library open on click**, both crashed in production on a row
  shape a database *view* returns, which is not the shape a table returns.
- **frames survive a write**: the write path stripped the column holding every
  frame, and every screen went blank while looking fine in the session that
  created them.
- **no old style layer**: a stylesheet re-pointed a hundred Tailwind utilities
  with `!important` and silently defeated four rounds of redesign. It is gone,
  and this check makes sure it stays gone.
- **every AI has a way in**, checks the *button*, not the function. Three
  capabilities were lost twice: the code survived, the thing that called it did
  not.

A missing test file is reported as MISSING and fails the gate. A check that
cannot run is not a check that passed.

## Conversations

The build session is shared in full, including the wrong turns.

- Build: LINK_HERE

A separate planning session came before it, where the reframe was argued out
and the build prompts were written before any code ran. It is not shared, but
every decision made in it is recorded above.
