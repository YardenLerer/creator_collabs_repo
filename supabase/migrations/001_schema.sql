-- ============================================================================
-- Creator Collabs: the whole schema, in one file.
--
-- Generated from a running database rather than accumulated from migrations,
-- because migrations drift and the thing that matters to somebody setting this
-- up is what the tables actually are.
--
-- Read the policies at the bottom before pointing a public app at this.
-- ============================================================================

-- ------------------------------------------------------------------ gaps ---
-- Footage that does not exist yet. Everything else in the product hangs off a
-- gap: a shot list is computed from one, a clip is accepted against one.
create table if not exists gaps (
  id                text primary key,
  room_type         text[] not null default '{}',
  scene             text[] not null default '{}',
  branch_id         text[] not null default '{}',
  aspect            text[] not null default '{}',
  shot_size         text[] not null default '{}',
  lighting          text[] not null default '{}',
  quantity_needed   integer not null default 1,
  priority          text not null default 'p1',
  status            text not null default 'open',
  intended_channel  text[] not null default '{}',
  deadline          text not null default '',
  closed_at         text,
  taxonomy_version  integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- -------------------------------------------------------------- creators ---
-- The roster. `notes` holds signed opinions - each one carries who wrote it and
-- whether they would work with her again, which is what the star rating counts.
create table if not exists creators (
  id                text primary key,
  display_name      text not null,
  handle            text not null,
  creator_vertical  text[] not null default '{}',
  format_strength   text[] not null default '{}',
  audience_geo      text[] not null default '{}',
  nearest_branch_id text,
  branch_proximity  text,
  home_metro        text,
  photo             text,
  email             text,
  phone             text,
  links             jsonb not null default '[]',
  coverage_note     text,
  style_note        text,
  camera            text,
  brings_lighting   text not null default 'unknown',
  works_with        text not null default 'unknown',
  platform_stats    jsonb not null default '[]',
  notes             jsonb not null default '[]',
  taxonomy_version  integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- --------------------------------------------------------------- collabs ---
-- One creator, one branch, and the gaps a single visit should close.
--
-- `rights` is entered by a person and never by a model. `brief_fingerprint` is
-- what makes a brief go stale when a gap changes underneath it.
create table if not exists collabs (
  id                     text primary key,
  creator_id             text not null references creators(id) on delete cascade,
  branch_id              text not null,
  gap_ids                text[] not null default '{}',
  stage                  text not null default 'brief',
  rights                 jsonb not null default '{}',
  channel_override       jsonb,
  brief_approved_by      text,
  brief_approved_at      text,
  brief_fingerprint      text,
  selection_note         jsonb,
  started_without_score  boolean not null default false,
  created_by             text,
  taxonomy_version       integer not null default 1,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ------------------------------------------------------------ shot_items ---
-- The shot list. Derived from the gap, which is why `source` defaults to
-- 'derived': the gap holds every value a shot needs, so nothing here is
-- guessed. `instruction` is the one field a model may write.
create table if not exists shot_items (
  id           text primary key,
  collab_id    text not null references collabs(id) on delete cascade,
  gap_id       text,
  room_type    text,
  scene        text[] not null default '{}',
  aspect       text,
  shot_size    text,
  lighting     text,
  count        integer not null default 1,
  source       text not null default 'derived',
  note         text,
  instruction  text not null default '',
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ------------------------------------------------------- visit_proposals ---
-- A date asked of a branch. It is a proposal until the branch answers, and a
-- decline carries a reason from a fixed list rather than free text so the
-- reasons can be counted later.
create table if not exists visit_proposals (
  id                          text primary key,
  collab_id                   text not null references collabs(id) on delete cascade,
  date                        text not null default '',
  time_of_day                 text,
  duration                    text,
  note                        text default '',
  status                      text not null default 'pending',
  proposed_by                 text,
  proposed_at                 text not null,
  responded_by                text,
  responded_at                text,
  decline_reason              text,
  decline_note                text default '',
  room_snapshot               jsonb default '[]',
  brief_snapshot_fingerprint  text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- ----------------------------------------------------------------- clips ---
-- What came back from a visit.
--
-- `ai` is what a model read; `ai_status` says whether it was a model at all -
-- 'sample' means a person wrote it for a demonstration and no model has looked.
-- `thumbs` holds frames as URLs or data URLs; `thumb_paths` points into storage.
-- One of the two is always the source of the pictures, and the screens read
-- whichever is populated.
create table if not exists clips (
  id                     text primary key,
  collab_id              text not null references collabs(id) on delete cascade,
  branch_id              text,
  filename               text not null default '',
  clip_status            text not null default 'uploaded',
  video_path             text,
  thumb_paths            text[] not null default '{}',
  thumbs                 jsonb not null default '[]',
  frame_count            integer not null default 0,
  loaded_via             text,
  system                 jsonb not null default '{}',
  ai                     jsonb,
  ai_status              text not null default 'not_scored',
  ai_issues              jsonb not null default '[]',
  quality_flags          jsonb not null default '[]',
  overconfidence         jsonb not null default '[]',
  match                  jsonb,
  unmatched_keep         boolean not null default false,
  privacy_status         text not null default 'unreviewed',
  privacy_reason         text,
  privacy_manual_review  jsonb,
  privacy_issues         jsonb not null default '[]',
  read_failure           jsonb,
  resend_request         jsonb not null default '{"status": "none"}',
  release_request        jsonb,
  rights_override        jsonb,
  rights_status          text not null default 'unknown',
  corrected_by           text,
  corrected_at           text,
  accepted_by            text,
  accepted_at            text,
  gap_id_closed          text,
  reject_reason          text default '',
  rejected_by            text,
  rejected_at            text,
  blocked_reason         text,
  sample                 jsonb,
  taxonomy_version       integer not null default 1,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on column clips.sample is
  'Null for real footage. For placeholder rows: {source, credit, page, alt}.';

-- ---------------------------------------------------- clip_privacy_flags ---
-- The one rule that overrides everything else. A recognisable guest blocks a
-- clip whatever the rights say, and only a person can clear the flag.
create table if not exists clip_privacy_flags (
  id           text primary key,
  clip_id      text not null references clips(id) on delete cascade,
  flag         text not null,
  confidence   text not null,
  frame_index  integer,
  note         text,
  status       text not null default 'unreviewed',
  resolved_by  text,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------- scores ---
-- How well a creator fits a gap.
--
-- Two halves that never merge. `measured` is arithmetic on records. `affinity`
-- is the only thing a model is asked, and it stays null when nothing was run -
-- there is no composite total when a component is missing.
create table if not exists scores (
  id                 text primary key,
  creator_id         text not null references creators(id) on delete cascade,
  gap_id             text not null references gaps(id) on delete cascade,
  disqualified       text[] not null default '{}',
  measured           jsonb not null default '{}',
  measured_score     integer,
  affinity           jsonb,
  ai_status          text not null default 'not_scored',
  total              integer,
  branch_fit         jsonb,
  format_fit         jsonb,
  audience_fit       jsonb,
  input_fingerprint  text,
  created_by         text,
  taxonomy_version   integer not null default 1,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (creator_id, gap_id)
);

-- ----------------------------------------------------------------- edits ---
-- What editors are assembling out of the library. This is what turns "nobody
-- has used it" on a clip card from a guess into a count.
create table if not exists edits (
  id            text primary key,
  title         text not null,
  purpose       text,
  editor        text not null,
  status        text not null default 'in_edit'
                check (status in ('in_edit', 'waiting_on_you', 'published')),
  due_at        date,
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- `library_id` points at a library row rather than a clip, because an edit uses
-- cleared footage and the rights are attached there.
create table if not exists edit_clips (
  edit_id     text not null references edits(id) on delete cascade,
  library_id  text not null,
  position    integer not null default 0,
  added_at    timestamptz not null default now(),
  primary key (edit_id, library_id)
);

create index if not exists edit_clips_library_idx on edit_clips(library_id);

-- -------------------------------------------------------------- settings ---
create table if not exists settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------- activity_log ---
create table if not exists activity_log (
  id          bigserial primary key,
  actor       text not null,
  action      text not null,
  entity      text not null,
  entity_id   text,
  detail      jsonb,
  created_at  timestamptz not null default now()
);

-- --------------------------------------------------------------- library ---
-- A view, not a table: accepted clips joined to the collab they came from, so
-- the rights and the creator travel with the footage.
--
-- Because it is a view it cannot be written to, and the rights are read live.
-- Renegotiating a collab's rights therefore changes what may be done with
-- footage already accepted under them. If that is not wanted, this has to
-- become a table that freezes the rights at the moment of acceptance.
drop view if exists library;
create view library as
  select c.*, col.rights, col.creator_id
  from clips c
  join collabs col on col.id = c.collab_id
  where c.clip_status = 'accepted';

-- ================================================================ access ===
-- READ THIS BEFORE PUTTING A PUBLIC URL IN FRONT OF THIS DATABASE.
--
-- These policies let the anonymous role read and write everything. That is
-- deliberate for a single-team internal tool with an unlisted URL, and it is
-- NOT access control: anybody who has the project URL and the publishable key
-- can read, change and delete every row.
--
-- Before this is used with real creators, real agreements or real footage,
-- replace these with policies keyed to an authenticated user.
alter table gaps               enable row level security;
alter table creators           enable row level security;
alter table collabs            enable row level security;
alter table shot_items         enable row level security;
alter table visit_proposals    enable row level security;
alter table clips              enable row level security;
alter table clip_privacy_flags enable row level security;
alter table scores             enable row level security;
alter table edits              enable row level security;
alter table edit_clips         enable row level security;
alter table settings           enable row level security;
alter table activity_log       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['gaps','creators','collabs','shot_items','visit_proposals',
                           'clips','clip_privacy_flags','scores','edits','edit_clips',
                           'settings','activity_log']
  loop
    execute format('drop policy if exists anon_all on %I', t);
    execute format('create policy anon_all on %I for all to anon using (true) with check (true)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- storage --
-- Frames and originals. Private: the app signs URLs on read.
insert into storage.buckets (id, name, public)
values ('clip-thumbs', 'clip-thumbs', false), ('clip-videos', 'clip-videos', false)
on conflict (id) do nothing;
