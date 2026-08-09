-- ============================================================================
-- Anonymous callers may read, create and edit. They may not delete.
--
-- WHY THIS CHANGED
--
-- The publishable key used to live in the browser of whoever typed it into the
-- connect screen. It now ships inside the page, so that somebody opening the
-- deployed URL sees a working system instead of a form asking for two values
-- they do not have.
--
-- That is the right trade for a demonstration, and its price is that the key
-- is now readable by anyone who views source. Nothing about access changed -
-- the policies were always what governed it - but the effort required to
-- reach the data went from "be given a key" to "open the page".
--
-- Blocking delete is what keeps that trade cheap. A reviewer can still do
-- every real thing: write a gap, start a collab, enter rights, approve a
-- brief, propose a date, upload and read clips, accept them into the library.
-- What no single request can do any more is empty the tables.
--
-- WHAT IS DELIBERATELY STILL DELETABLE
--
-- shot_items and edit_clips are derived child rows, not substance. Rebuilding
-- a brief after its gap changed deletes and re-inserts the whole shot list,
-- and an edit removes clips from itself the same way. Blocking those would
-- break editing to protect rows that are regenerated from their parents
-- anyway.
--
-- ONE CONSEQUENCE WORTH KNOWING
--
-- A delete that a policy does not permit is not an error. PostgREST reports
-- success and removes nothing. `remove()` in src/lib/db.js therefore asks for
-- the deleted row back and treats an empty result as a refusal, and the two
-- settings actions that clear the tables are disabled when the app is running
-- against this project.
--
-- This is a demonstration posture, not a security model. A project holding
-- real agreements needs policies keyed to an authenticated user - see the note
-- at the bottom of 001_schema.sql.
-- ============================================================================

do $$
declare
  t text;
  protected text[] := array['gaps','creators','collabs','clips',
                            'clip_privacy_flags','scores','edits',
                            'settings','activity_log','visit_proposals'];
  derived   text[] := array['shot_items','edit_clips'];
begin
  foreach t in array protected loop
    execute format('drop policy if exists anon_all on %I', t);
    execute format('drop policy if exists anon_select on %I', t);
    execute format('drop policy if exists anon_insert on %I', t);
    execute format('drop policy if exists anon_update on %I', t);
    execute format('drop policy if exists anon_delete on %I', t);
    execute format('drop policy if exists %I on %I', t || '_anon', t);

    execute format('create policy anon_select on %I for select to anon using (true)', t);
    execute format('create policy anon_insert on %I for insert to anon with check (true)', t);
    execute format('create policy anon_update on %I for update to anon using (true) with check (true)', t);
    -- No delete policy. Under row-level security, an action with no policy is
    -- refused rather than allowed, so the absence here is the block.
  end loop;

  foreach t in array derived loop
    execute format('drop policy if exists anon_all on %I', t);
    execute format('drop policy if exists anon_select on %I', t);
    execute format('drop policy if exists anon_insert on %I', t);
    execute format('drop policy if exists anon_update on %I', t);
    execute format('drop policy if exists anon_delete on %I', t);
    execute format('drop policy if exists %I on %I', t || '_anon', t);
    execute format('create policy anon_all on %I for all to anon using (true) with check (true)', t);
  end loop;
end $$;
