# Thinking

## The problem

The brief said "manage creator collaborations." Before deciding what that
meant, I wrote down three questions I would have asked the business, and what
each answer would have changed.

**"Describe the last time an editor looked for a clip and could not find it.
What did they do in the end?"**

Ask "is it hard for editors to find footage" and everyone says yes, because
nobody likes their own system. Asking for a recent, specific incident tests
whether the pain is real. And the second half is where the money is: shot it
again, bought stock, or shipped a weaker edit. That is the cost, in currency,
of the problem I would be solving.

**"How many collaborations in the last three months, and how many of the clips
you received ended up in an edit?"**

Ten collaborations and a thousand clips is an organisation problem. Two and a
hundred is a volume problem. Two hundred received and ten used is neither: it
means they are getting the wrong footage, and no library will fix that.

**"Who coordinates this today, and how many hours a week does it take them?"**

If somebody is spending ten hours a week on scheduling, there is a real
management problem. If it is twenty minutes, the interesting problem is
somewhere else.

### What the process actually looks like

Eight enquiries arrive by email and Instagram. The coordinator has to decide
who to invite, write each of them a brief, agree a date with the branch,
receive a drive with thirty files named `IMG_4471`, go through them one by one
to work out whether she got what she asked for, and write back saying what is
missing.

**I chose to build around step five, going through the footage, because it is
the only action that solves two problems at once.**

For the coordinator it is the heaviest thing she does. Thirty files, open each
one, watch it, decide what it shows, cross-check it against what she asked
for. One to two hours per collaboration, from scratch every time.

But the real reason is that **the same action builds the library.** Nobody sits
and tags hundreds of clips by hand, so an organised archive never comes into
existence if it depends on somebody remembering to create it. Here it is a
by-product of work she is doing for herself anyway. That is what makes it
leverage rather than a time saving: she is paid back on the first
collaboration, before a library exists, and the library builds itself behind
her.

### And what the word "manage" decides

Managing a collaboration does not end when the creator leaves the branch. It
ends when the clip she shot goes into an edit. A system that tracks up to
handover solves today's pain and produces a drive nobody can find anything in a
year from now.

So the product runs end to end: it starts with defining what is missing and
finishes with a tagged clip whose rights are clear. `library` is a view over
accepted clips joined to their collab, so footage never stops being part of the
collaboration it came from, and the rights travel with it.

### The consequence this business carries

A spa is full of people in robes who came to be private. A guest can walk
through the back of a shot. If that clip is published, a real person's
afternoon at a spa is on the internet.

That is why `clip_privacy_flags` is its own table and why the rule is absolute:
a recognisable face blocks a clip whatever the creator agreed to, only a person
can clear the flag, and a check that could not be read holds the clip rather
than passing it. A clip that was never checked is not a clip that is clean.

### Who uses it, and who I left out

The coordinator is in it every day. The branch manager enters twice, to accept
a date and to mark that the visit happened, which is why he gets one screen
that works on a phone. The editor searches and manages nothing. The creator is
outside the system: she gets a brief, uploads footage, sees what is missing.

I considered and rejected a fifth persona, a marketing manager with a
dashboard. He would not have noticed if the screen disappeared, because he
looks at it once a quarter. The numbers live on the coordinator's Today screen
instead.

## The solution

Six screens, in the order the work happens:

**Gaps**, footage that does not exist yet. One sentence: which rooms, what
happens in them, how many clips, which branches, by when.

**Creators**, who could shoot it. Scoring is optional; a coordinator who
already knows who to call starts a collab directly.

**Briefs**: one creator, one branch, and the gaps a single visit should close.
The rights are typed in here by a person.

**Visits**: a date asked of a branch. It is a proposal until the branch
answers, and a decline carries a reason from a fixed list.

**Intake**, what came back, one visit at a time, decided clip by clip.

**Library**, everything cleared for use, with what each clip is allowed to do
and whether anybody has used it.

**The brief is derived from the gap, not written freely.** The gap already
holds every value a shot needs: room, scene, format, shot size, lighting,
count. `shot_items.source` defaults to `derived` for that reason. Writing a
shot list by hand would mean re-entering data that already exists, and every
re-entry is a chance to enter it differently, at which point the brief and the
gap describe different footage and nothing downstream can tell which is right.

The one part a person or a model does write is `instruction`: how to shoot it.
That is craft, it has no single right answer, and getting it wrong costs a
worse clip rather than a wrong record.

## AI

Four capabilities, all through one Edge Function (`supabase/functions/ai`):

| Task | What it does |
|---|---|
| `read_clip` | what is in a clip, and whether a face is recognisable |
| `score_creator` | how close a creator's work feels to a request |
| `brief_notes` | how to shoot a shot that has already been computed |
| `search` | free text turned into taxonomy values |

Two decisions matter more than the list.

**The model answers in plain language; code matches it to the vocabulary.**
`read_clip` returns `{"room":"sauna","action":"nobody in frame"}`, words a
person would say out loud. The product validates against a closed vocabulary.
The gap between them is closed in `src/lib/ai.js` by `matchOne`, which is
deliberately dumb: exact match on the label, then on the code, then a
containment check. No synonyms, no stemming. A clever matcher that is right
nine times in ten quietly mislabels the tenth clip and nobody ever finds out
which one. Words it cannot match are returned as `unmatched` and the field is
left empty, because missing is already a handled state everywhere downstream
and a guess is not.

**The model never sees the brief before it describes a clip.** `read_clip` gets
frames and nothing else. If it knew what was asked for, "does this match the
brief" would stop being a measurement and become a suggestion the model was
primed to agree with. The comparison happens afterwards, in
`matchClipToShots`, in code.

### What the model is never asked

| Never asked | Where it comes from instead |
|---|---|
| How many clips a gap needs | The gap. Typed by a person. |
| Which room, scene or format a shot is | Derived from the gap. |
| Which branch or which date | A person proposes, a branch answers. |
| What the rights say | Typed by a person. The model never sees the agreement. |
| Whether a clip may be released | The rights and the privacy flag. Never a judgement. |
| Whether a creator is good, reliable or punctual | Counted from her own record. |
| A single blended score | There is none. Measured and judged stay apart. |

And it does not generate video or images. Placeholder footage comes from Pexels
through a second function and every row it fills carries `sample`, so stock can
never be mistaken for footage a creator shot at a branch.

## Decisions

**A closed vocabulary.** Every controlled value has a human name, and a test
(`check-labels`) fails the build if one reaches a screen as a field name.

**A read that returns nothing says which kind of nothing.** `src/lib/db.js`
distinguishes `refused` from `not_found` from an empty result. "No rows" and
"you are not allowed to see the rows" look identical over HTTP and mean
opposite things.

**Nothing is shown as saved until the server confirms it.** `src/lib/sync.js`
diffs, writes, waits, and puts the previous array back if the write was
refused. The screen never claims a state the database does not hold.

**Two frame resolutions.** `THUMB_PX = 256` for display, `ANALYSIS_PX = 1024`
for the model. A thumbnail is cheap to store and useless to judge a face from;
sending one to a privacy check would be a quiet downgrade of the one decision
that matters most.

**Two private buckets.** `clip-thumbs` and `clip-videos`, neither public. URLs
are signed on read.

**Both API keys live in Edge Functions.** No key reaches the browser, and there
is no screen that asks for one. An earlier version stored the model key in
local storage; it was removed along with the panel that collected it.

**There is no authentication, and the product says so.** Identity is a
declaration: `"This is a declaration, not a login, and it protects nothing."`
The row-level policies allow anonymous read and write, and the migration says
that at the point where they are created. An unlisted URL is not access
control, and pretending otherwise would be worse than the gap itself.

## Prioritisation, what was not built

**A model-drafted shot list.** The Edge Function could write one. It does not,
and this was the hardest thing to leave out because it demos well. The gap
already contains every value a shot needs, so a model writing the list would
replace a deterministic calculation with a guess, and nobody would re-check a
field that looks filled in. What the model writes is the instruction, where a
wrong answer costs a worse clip rather than a wrong record.

**Sending the brief to the creator.** There is no channel, no delivery record,
no "she opened it". A button that looks like it sends and does not is worse
than no button.

**Export, and "start an edit" from the library.** `edits` and `edit_clips`
exist and are read, so "in three edits" is a count rather than a guess. Editors
do not yet create edits from inside this product.

**Duplicate detection beyond the obvious.** There is a near-duplicate finder;
it is not a perceptual model.

## Next steps

**Server-side conversion.** Frames are extracted in the browser today, which
means the format the browser cannot decode is the format that fails. Doing it
server-side removes a class of failure that currently lands on the user.

**Measuring corrections.** Every time a person overrides what the model read,
that is a labelled example of it being wrong. Nothing counts them yet. It is
the cheapest signal available and it is being thrown away.

**A regression pack for the prompts.** The four prompts are validated by shape,
not by content. A fixed set of clips with known answers, run on every prompt
change, would catch a rewrite that quietly makes the privacy check softer.

**Rights enforced at the point of use.** The library knows what each clip may
do. Nothing stops somebody downloading a clip whose rights do not cover the
channel they are about to publish on.

**Real authentication.** Everything else on this list is an improvement. This
one is a prerequisite before the product holds a real agreement with a real
creator.
