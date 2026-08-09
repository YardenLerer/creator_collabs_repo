import React, { useState, useEffect, useMemo, useCallback } from "react";
import { getConnection, saveConnection, forgetConnection, checkConnectionShape } from "./lib/config.js";
import { callAi, clipReadingToFields, clipReadingToPrivacy, findMedia, draftShotNotes } from "./lib/ai.js";
import { Button, Chip, Field, Section, SingleSelect, Modal, Drawer, Sheet,
  Signature, SourceBadge } from "./components/Primitives.jsx";
import { GapsScreen, GapCard, SpecLine, RankedSceneSelect, CreatorsScreen,
  StartCollabDrawer } from "./components/Screens.jsx";
import { VisitsScreen, BriefsScreen, SidebarBody } from "./components/Stages.jsx";
import { CreatorCard, ProposeDate, CollabDetail } from "./components/Collab.jsx";
import { ok } from "./lib/db.js";
import {
  gapsRepo, creatorsRepo, collabsRepo, shotsRepo, visitsRepo,
  clipsRepo, scoresRepo, settingsRepo, loadEverything,
} from "./lib/repos.js";
import { diffRows, applyDiff, syncCollabs, syncScores } from "./lib/sync.js";
import { uploadVideo, uploadThumbs, signThumbs, signVideo, fetchOriginal, deleteClipFiles } from "./lib/storage.js";
import { Failure, Loading } from "./components/DataState.jsx";
import ReadingRun from "./components/ReadingRun.jsx";
import CreatorProfile, { creatorRecord } from "./components/CreatorProfile.jsx";
import {
  Target, Users, FileText, CalendarCheck, Inbox, Library,
  Plus, X, ArrowUp, Check, AlertTriangle, Trash2, RotateCcw,
  Loader2, ChevronRight, ChevronLeft, Info, Ruler, Sparkles, Ban,
  RefreshCw, Zap, MapPin, Lock, PenLine, ShieldAlert, ScrollText,
  Building2, Clock, ArrowLeftRight, CalendarPlus,
  Upload, Film, Eye, ShieldCheck, CornerDownRight, ImageOff, Search, Menu, Play,
} from "lucide-react";

/* ============================================================================
   CREATOR COLLAB — SLICE 5
   Adds: two-resolution frame extraction, two separate model paths (description
         and privacy), the validation layer, the brief diff, privacy review and
         signed acceptance.

   Built:   1 Gaps · 2 Creators + Matching · 3 Briefs · 4 Visits · 5 Intake
   Stubbed: 6 Library

   The validation functions in this file mirror validation.js, which is what
   the test suite runs against with `node validation.test.js`. An artifact
   cannot import a sibling module, so they are duplicated here. Change one,
   change both.

   PRINCIPLES HELD ACROSS THE PRODUCT
   1. A question with one right answer never goes to the model.
   2. Everything the model touched is violet. Everything computed is slate.
   3. A missing field is a missing field, never a bad score.
   4. No composite score is shown when a component is missing.
   5. You can always pass a gate. You cannot pass it silently.
   6. What you saw when you decided is stored, not recomputed later.
   7. The least binding value is the default. Every upgrade from it is a
      deliberate act by a person.
   8. Reasons are enums, not free text. Free text cannot be counted, and
      "fully_booked ten times at this branch" is something you need to see.
   9. Each persona sees only what it needs to make the decision it owns.
  10. The system never guesses what the user meant.
  11. Description and privacy never share a request. One costs a bad search,
      the other costs a guest in a robe in a paid campaign.
  12. The model is never shown the brief. If it knew we asked for a sauna it
      would find a sauna, and the comparison would be worthless.
  13. Analysis never quietly degrades. If the full resolution frames are gone,
      the clip goes to human review with the reason on screen.

   Storage key layout
     "gaps" | "creators" | "scores" | "collabs" | "app_meta"
     "clip:<id>"  -> one key per record, slice 5
============================================================================ */

const TAXONOMY_VERSION = 1;

/**
 * When this file was built, printed where anyone can see it.
 *
 * Every deploy here is a fresh drag onto a host and a brand new address, and
 * the old address keeps working. Without a stamp there is no way to tell "the
 * change did not happen" from "this tab is the previous build", and we spent
 * several rounds unable to tell those apart.
 */
/**
 * The model these calls go to.
 *
 * Sonnet 4.6 rather than Sonnet 5, on purpose. Sonnet 5 rejects non-default
 * sampling parameters, and this product sends temperature: 0 everywhere
 * because the same frames should produce the same description twice - the
 * whole validation layer is built on being able to compare one answer to
 * another. Determinism is worth more here than the newer model.
 */
const MODEL = "claude-sonnet-4-6";

const BUILD = "2026-08-09 17:16 UTC";

/* ---------------------------------------------------------------- 1. ROOM  */
const ROOM_TYPE = [
  "reception_lobby", "relaxation_lounge", "treatment_room_massage",
  "treatment_room_facial", "couples_suite", "sauna", "steam_room", "hammam",
  "cold_plunge", "hot_tub", "indoor_pool", "outdoor_pool_deck", "locker_room",
  "shower_area", "salt_room", "infrared_room", "fitness_studio",
  "movement_studio", "nail_station", "hair_salon", "retail_shop", "juice_bar",
  "hallway_transition", "exterior_entrance", "outdoor_grounds", "other_room",
];

/* --------------------------------------------------------------- 2. SCENE  */
const SCENE = [
  "ambience_no_people", "detail_texture", "treatment_in_progress",
  "treatment_prep", "product_application", "product_closeup",
  "arrival_checkin", "transition_walking", "resting_relaxing",
  "social_conversation", "food_beverage", "water_immersion", "heat_exposure",
  "movement_fitness", "staff_at_work", "reaction_face", "talking_head",
  "voiceover_walkthrough", "before_after", "other_scene",
];

/* -------------------------------------------------------------- 3. FORMAT  */
const ASPECT_NATIVE = ["vertical_9_16", "square_1_1", "horizontal_16_9", "other_ratio"];
const REFRAME_SAFE = ["yes", "partial", "no"];
const SHOT_SIZE = ["extreme_wide", "wide", "medium", "close_up", "extreme_close_up", "pov"];
const CAMERA_MOTION = ["static", "handheld_subtle", "handheld_active", "pan_tilt", "tracking", "gimbal", "orbit"];
const DURATION_BUCKET = ["under_3s", "3_10s", "10_30s", "30_60s", "over_60s"];
const CAPTURE_SOURCE = ["phone", "mirrorless", "action_cam", "drone", "screen_recording", "unknown"];
const AUDIO_STATE = ["ambient_usable", "speech_usable", "music_baked_in", "noise_unusable", "silent"];

/* ------------------------------------------------------------ 4. LIGHTING  */
const LIGHTING_CONDITION = [
  "daylight_bright", "daylight_soft", "golden_hour", "mixed_sources",
  "warm_dim_ambient", "clinical_bright", "underlit", "backlit_silhouette",
  "harsh_contrast",
];
const COLOR_CAST = ["neutral", "warm_orange", "cool_blue", "green_fluorescent", "magenta", "indeterminate"];
const TIME_OF_DAY = ["morning", "midday", "afternoon", "evening", "night", "indeterminate"];
// A visit must be planned into a real window. Only a clip is allowed to be
// indeterminate, and only when nothing in the record can say otherwise.
const VISIT_TIME_OF_DAY = TIME_OF_DAY.filter((t) => t !== "indeterminate");

/* ------------------------------------------------------------- 5. QUALITY  */
const QUALITY_FLAG = [
  "out_of_focus", "motion_blur", "unstable_shake", "overexposed",
  "underexposed", "white_balance_off", "lens_fog_condensation", "lens_smudge",
  "audio_clipping", "audio_hvac_wind", "low_resolution",
  "compression_artifacts", "frame_drops", "aspect_mismatch_vs_brief",
  "watermark_burned_in", "text_overlay_burned_in", "heavy_filter_applied",
  "near_duplicate", "too_short_unusable",
];
const QUALITY_SEVERITY = ["blocking", "fixable_in_post", "cosmetic"];

/* ------------------------------------------------------------- 6. PRIVACY  */
const PRIVACY_FLAG = [
  "guest_face_identifiable", "staff_face_identifiable", "body_exposure_partial",
  "changing_or_locker_context", "intimate_treatment_context",
  "possible_unverified_person", "name_badge_readable",
  "screen_or_document_readable", "license_plate", "third_party_brand_visible",
  "third_party_speech_audible",
];
const PRIVACY_STATUS = ["unreviewed", "cleared", "blocked", "release_required", "release_on_file"];
const PRIVACY_FLAG_DEFINITION = {
  possible_unverified_person:
    "A person is in frame with no identified release on file. Human clearance required.",
};

/* -------------------------------------------------------------- 7. RIGHTS  */
const RIGHTS_CHANNEL = [
  "organic_owned", "paid_social", "website", "email", "ooh_print", "in_store",
  "third_party_press", "ai_training_derivative",
];
const RIGHTS_TERRITORY = ["single_branch", "us_only", "north_america", "worldwide"];
const RIGHTS_DURATION = ["3m", "6m", "12m", "24m", "perpetual", "unknown"];
const RIGHTS_STATUS = ["active", "expiring_60d", "expired", "unknown"];
const EXCLUSIVITY = ["non_exclusive", "category_exclusive", "full_buyout"];
const CREDIT_REQUIRED = ["handle_on_screen", "caption_mention", "not_required"];
const EDIT_PERMISSION = ["verbatim_only", "trim_only", "full_recut", "derivatives_allowed"];
const MUSIC_RIGHTS = ["creator_owns", "licensed_pass_through", "replace_required", "no_music"];
const RELEASES_ON_FILE = ["none", "creator_only", "creator_plus_staff", "all_persons"];
const AGREEMENT_FORM = ["signed_contract", "email_confirmation", "dm_confirmation", "verbal_undocumented"];
const CONSIDERATION = ["visit_only", "visit_plus_fee", "gifted_product", "affiliate"];

/* ----------------------------------------------------------------- 8. GAP  */
const PRIORITY = ["p0", "p1", "p2"];
const GAP_STATUS = ["open", "closed"];

/* ------------------------------------------------------------- 9. CREATOR  */
const METRO = [
  "bay_area", "sacramento", "monterey", "los_angeles", "orange_county",
  "san_diego", "santa_barbara", "austin", "san_antonio", "houston", "dallas",
  "phoenix", "tucson", "seattle", "portland", "denver", "chicago",
  "new_york", "miami",
];
const AUDIENCE_GEO = [...METRO, "us_national", "international"];
const CREATOR_VERTICAL = [
  "wellness_selfcare", "beauty_skincare", "fitness_movement", "food_beverage",
  "travel_hospitality", "lifestyle_general", "luxury", "parenting_family",
  "local_city_guide",
];
const FORMAT_STRENGTH = [
  "vertical_shortform", "horizontal_longform", "stills_only", "talking_head",
  "voiceover_narrative", "silent_ambient", "live_realtime",
];
const BRANCH_PROXIMITY = ["home_branch", "same_metro", "drivable_2h", "requires_travel"];

/**
 * A colour per speciality.
 *
 * Colour here is a label, not a judgement. Nine subjects that are hard to tell
 * apart in grey text become scannable, and no hue means better or worse than
 * another - the palette is chosen so none of them reads as a warning or as an
 * approval, which are the two meanings colour already carries in this product.
 */
const VERTICAL_TINT = {
  wellness_selfcare:  { bg: "#ECFDF5", fg: "#065F46" },
  beauty_skincare:    { bg: "#FDF2F8", fg: "#9D174D" },
  fitness_movement:   { bg: "#EFF6FF", fg: "#1E40AF" },
  food_beverage:      { bg: "#FFF7ED", fg: "#9A3412" },
  travel_hospitality: { bg: "#F0FDFA", fg: "var(--accent-hover)" },
  lifestyle_general:  { bg: "var(--model-tint)", fg: "var(--model-text)" },
  luxury:             { bg: "#FAF5FF", fg: "#6B21A8" },
  parenting_family:   { bg: "#FEFCE8", fg: "#854D0E" },
  local_city_guide:   { bg: "#F0F9FF", fg: "#075985" },
};

/**
 * A recommendation score, drawn as stars.
 *
 * The stars count PEOPLE, not clips: every note in this product ends with
 * "would you book her again", signed. Three of four saying yes is four fifths
 * of five stars, and clicking through shows you the four names.
 *
 * It is deliberately not an average of the measured rates on the profile.
 * Those are four separate things with four separate sources, and collapsing
 * them into one number would produce a score nobody could check and that a
 * creator with two clips behind her would lose work over.
 */
function Recommendation({ notes = [], size = 14, showCount = true }) {
  const answered = notes.filter((n) => n.worked === "yes" || n.worked === "no");
  if (answered.length === 0) {
    return <span style={{ fontSize: 12, color: "var(--text-meta)" }}>Nobody has said yet</span>;
  }
  const yes = answered.filter((n) => n.worked === "yes").length;
  const stars = (yes / answered.length) * 5;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
      title={`${yes} of ${answered.length} would book her again`}>
      <span aria-label={`${yes} of ${answered.length} would book her again`} role="img"
        style={{ display: "inline-flex", gap: 2 }}>
        {[0, 1, 2, 3, 4].map((i) => {
          const fill = Math.max(0, Math.min(1, stars - i));
          return (
            <span key={i} style={{ position: "relative", width: size, height: size, display: "block" }}>
              <svg width={size} height={size} viewBox="0 0 24 24" fill="var(--hairline)" aria-hidden="true"
                style={{ position: "absolute", inset: 0 }}>
                <path d="M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.5 6.1 20.6l1.2-6.5L2.5 9.5l6.6-.9z" />
              </svg>
              <span style={{ position: "absolute", inset: 0, width: `${fill * 100}%`, overflow: "hidden" }}>
                <svg width={size} height={size} viewBox="0 0 24 24" fill="var(--warn)" aria-hidden="true">
                  <path d="M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.5 6.1 20.6l1.2-6.5L2.5 9.5l6.6-.9z" />
                </svg>
              </span>
            </span>
          );
        })}
      </span>
      {showCount && (
        <span className="cc-num" style={{ fontSize: 12, color: "var(--text-meta)" }}>
          {yes} of {answered.length}
        </span>
      )}
    </span>
  );
}

/** A speciality, as a chip you can pick out of a grid at a glance. */
function Speciality({ value }) {
  const t = VERTICAL_TINT[value] ?? { bg: "var(--page)", fg: "var(--text-body)" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", fontSize: 12, lineHeight: 1.3,
      borderRadius: 8, padding: "4px 9px", background: t.bg, color: t.fg, whiteSpace: "nowrap" }}>
      {label(value)}
    </span>
  );
}

/* ------------------------------------------------------------- 10. VISIT - */
const VISIT_DURATION = ["30m", "60m", "90m", "2h", "3h", "half_day"];
const VISIT_PROPOSAL_STATUS = ["pending", "accepted", "declined"];
const VISIT_DECLINE_REASON = [
  "fully_booked", "room_unavailable", "staffing", "private_event", "other",
];
const PERSONA = ["coordinator", "branch_manager"];

/* ------------------------------------------------------------------- CLIP  */
const CLIP_STATUS = [
  "uploaded", "analysing", "analysed", "analysis_failed", "privacy_pending",
  "requires_human_review", "unreadable_file",
  "accepted", "rejected", "archived", "rights_expired",
];
const RESEND_REQUEST_STATUS = ["none", "asked", "resent", "gave_up"];
const RELEASE_REQUEST_STATUS = ["none", "requested", "granted", "denied"];
const CONFIDENCE = ["high", "medium", "low"];
const FRAMES_AVAILABLE = ["full", "recoverable", "thumbs_only", "none"];
const MATCH_LEVEL = ["full", "partial", "unmatched"];

/**
 * Rooms where no exterior light reaches the frame. A model that reports a
 * definite time of day from inside one of these is not reading the image, it
 * is filling a slot.
 */
const WINDOWLESS_ROOMS = new Set([
  "sauna", "steam_room", "hammam", "cold_plunge", "salt_room", "infrared_room",
  "locker_room", "shower_area", "treatment_room_massage", "treatment_room_facial",
  "couples_suite",
]);

/* ------------------------------------------------------------ AI STATUS -- */
const AI_STATUS = [
  "ok", "not_scored", "failed_parse", "failed_shape", "failed_range",
  "failed_vocabulary_invented", "failed_vocabulary_out_of_scope",
  "no_basis", "failed_api",
];
const COLLAB_STAGE = ["brief", "visit", "intake", "done"];

const TAXONOMY = {
  version: TAXONOMY_VERSION,
  ROOM_TYPE, SCENE, ASPECT_NATIVE, REFRAME_SAFE, SHOT_SIZE, CAMERA_MOTION,
  DURATION_BUCKET, CAPTURE_SOURCE, AUDIO_STATE, LIGHTING_CONDITION, COLOR_CAST,
  TIME_OF_DAY, QUALITY_FLAG, QUALITY_SEVERITY, PRIVACY_FLAG, PRIVACY_STATUS,
  RIGHTS_CHANNEL, RIGHTS_TERRITORY, RIGHTS_DURATION, RIGHTS_STATUS,
  EXCLUSIVITY, CREDIT_REQUIRED, EDIT_PERMISSION, MUSIC_RIGHTS,
  RELEASES_ON_FILE, AGREEMENT_FORM, CONSIDERATION, PRIORITY, GAP_STATUS,
  METRO, AUDIENCE_GEO, CREATOR_VERTICAL, FORMAT_STRENGTH, BRANCH_PROXIMITY,
  VISIT_DURATION, VISIT_PROPOSAL_STATUS, VISIT_DECLINE_REASON, PERSONA,
  CLIP_STATUS, RELEASE_REQUEST_STATUS, RESEND_REQUEST_STATUS, AI_STATUS,
  COLLAB_STAGE, CONFIDENCE, FRAMES_AVAILABLE, MATCH_LEVEL,
};

const ALL_TAXONOMY_VALUES = new Set(Object.values(TAXONOMY).filter(Array.isArray).flat());

/* ============================================================ LABELS ===== */
/* ============================================================ LABELS =====
   Every controlled value has a human name. The enum stays in the record and
   never reaches a screen. One value left as raw_snake_case is enough to make
   an entire page read like a database dump, so this table covers all of them
   and check-labels.js fails the build if a value is missing.
   ------------------------------------------------------------------------ */
const LABEL_OVERRIDE = {
  // rooms
  reception_lobby: "Reception", relaxation_lounge: "Relaxation lounge",
  treatment_room_massage: "Massage room", treatment_room_facial: "Facial room",
  couples_suite: "Couples suite", sauna: "Sauna", steam_room: "Steam room",
  hammam: "Hammam", cold_plunge: "Cold plunge", hot_tub: "Hot tub",
  indoor_pool: "Indoor pool", outdoor_pool_deck: "Pool deck",
  locker_room: "Locker room", shower_area: "Showers", salt_room: "Salt room",
  infrared_room: "Infrared room", fitness_studio: "Gym",
  movement_studio: "Movement studio", nail_station: "Nail station",
  hair_salon: "Hair salon", retail_shop: "Shop", juice_bar: "Juice bar",
  hallway_transition: "Hallway", exterior_entrance: "Entrance",
  outdoor_grounds: "Grounds", other_room: "Somewhere else",

  // scenes
  ambience_no_people: "Empty room", detail_texture: "Materials and texture",
  treatment_in_progress: "Treatment in progress", treatment_prep: "Setting the room up",
  product_application: "Product going on", product_closeup: "Product close-up",
  arrival_checkin: "Arriving", transition_walking: "Walking through",
  resting_relaxing: "Resting", social_conversation: "People talking",
  food_beverage: "Food and drink", water_immersion: "In the water",
  heat_exposure: "In the heat", movement_fitness: "Moving and training",
  staff_at_work: "Staff at work", reaction_face: "A reaction",
  talking_head: "Talking to camera", voiceover_walkthrough: "Walkthrough",
  before_after: "Before and after", other_scene: "Something else",

  // format
  vertical_9_16: "Vertical 9:16", square_1_1: "Square 1:1",
  horizontal_16_9: "Widescreen 16:9", other_ratio: "Another shape",
  yes: "Yes", partial: "Partly", no: "No",
  extreme_wide: "Very wide", wide: "Wide", medium: "Medium",
  close_up: "Close", extreme_close_up: "Very close", pov: "Point of view",
  static: "Still camera", handheld_subtle: "Gently handheld",
  handheld_active: "Actively handheld", pan_tilt: "Pan or tilt",
  tracking: "Tracking", gimbal: "Gimbal", orbit: "Orbiting",
  under_3s: "Under 3 seconds", "3_10s": "3 to 10 seconds", "10_30s": "10 to 30 seconds",
  "30_60s": "30 to 60 seconds", over_60s: "Over a minute",
  phone: "Phone", mirrorless: "Mirrorless camera", action_cam: "Action camera",
  drone: "Drone", screen_recording: "Screen recording", unknown: "Not known",
  ambient_usable: "Usable room sound", speech_usable: "Usable speech",
  music_baked_in: "Music baked in", noise_unusable: "Unusable noise", silent: "Silent",

  // lighting
  daylight_bright: "Bright daylight", daylight_soft: "Soft daylight",
  golden_hour: "Golden hour", mixed_sources: "Mixed light",
  warm_dim_ambient: "Warm and dim", clinical_bright: "Bright and clinical",
  underlit: "Underlit", backlit_silhouette: "Backlit", harsh_contrast: "Harsh contrast",
  neutral: "Neutral", warm_orange: "Warm", cool_blue: "Cool",
  green_fluorescent: "Green cast", magenta: "Magenta cast", indeterminate: "Can't tell",
  morning: "Morning", midday: "Midday", afternoon: "Afternoon",
  evening: "Evening", night: "Night",

  // quality
  out_of_focus: "Out of focus", motion_blur: "Motion blur", unstable_shake: "Shaky",
  overexposed: "Overexposed", underexposed: "Underexposed",
  white_balance_off: "Colour is off", lens_fog_condensation: "Fogged lens",
  lens_smudge: "Smudged lens", audio_clipping: "Clipped audio",
  audio_hvac_wind: "Air or wind noise", low_resolution: "Low resolution",
  compression_artifacts: "Compression artefacts", frame_drops: "Dropped frames",
  aspect_mismatch_vs_brief: "Wrong shape for the brief",
  watermark_burned_in: "Watermark burned in", text_overlay_burned_in: "Text burned in",
  heavy_filter_applied: "Heavy filter", near_duplicate: "Looks like another clip",
  too_short_unusable: "Too short to use",
  blocking: "Unusable", fixable_in_post: "Fixable in the edit", cosmetic: "Cosmetic",

  // privacy
  guest_face_identifiable: "A guest's face is recognisable",
  staff_face_identifiable: "A staff face is recognisable",
  body_exposure_partial: "Partial body exposure",
  changing_or_locker_context: "Changing area",
  intimate_treatment_context: "Intimate treatment",
  possible_unverified_person: "Someone with no release on file",
  name_badge_readable: "A name badge is readable",
  screen_or_document_readable: "A screen or document is readable",
  license_plate: "A number plate is readable",
  third_party_brand_visible: "Another brand is visible",
  third_party_speech_audible: "Someone else can be heard",
  unreviewed: "Not reviewed", cleared: "Cleared", blocked: "Blocked",
  release_required: "Needs a release", release_on_file: "Release on file",

  // rights
  organic_owned: "Our own channels", paid_social: "Paid social", website: "Website",
  email: "Email", ooh_print: "Out-of-home and print", in_store: "In store",
  third_party_press: "Press", ai_training_derivative: "AI training",
  single_branch: "One branch only", us_only: "United States",
  north_america: "North America", worldwide: "Worldwide",
  "3m": "3 months", "6m": "6 months", "12m": "12 months", "24m": "2 years",
  perpetual: "Forever",
  active: "Cleared for use", expiring_60d: "Rights end soon", expired: "Rights expired",
  non_exclusive: "Non-exclusive", category_exclusive: "Exclusive in our category",
  full_buyout: "Full buyout",
  handle_on_screen: "Credit on screen", caption_mention: "Credit in the caption",
  not_required: "No credit needed",
  verbatim_only: "No edits", trim_only: "Trimming only",
  full_recut: "Free to re-cut", derivatives_allowed: "Derivatives allowed",
  creator_owns: "She owns the music", licensed_pass_through: "Licence passes to us",
  replace_required: "Music must be replaced", no_music: "No music",
  none: "None", creator_only: "The creator only",
  creator_plus_staff: "Creator and staff", all_persons: "Everyone in frame",
  signed_contract: "Signed contract", email_confirmation: "Confirmed by email",
  dm_confirmation: "Confirmed in a DM", verbal_undocumented: "Agreed verbally, nothing written",
  visit_only: "The visit", visit_plus_fee: "Visit and a fee",
  gifted_product: "Gifted product", affiliate: "Affiliate",

  // gap
  p0: "P0", p1: "P1", p2: "P2", open: "Open", closed: "Closed",

  // metros and creators
  bay_area: "Bay Area", sacramento: "Sacramento", monterey: "Monterey",
  los_angeles: "Los Angeles", orange_county: "Orange County", san_diego: "San Diego",
  santa_barbara: "Santa Barbara", austin: "Austin", san_antonio: "San Antonio",
  houston: "Houston", dallas: "Dallas", phoenix: "Phoenix", tucson: "Tucson",
  seattle: "Seattle", portland: "Portland", denver: "Denver", chicago: "Chicago",
  new_york: "New York", miami: "Miami",
  us_national: "Nationwide", international: "International",
  wellness_selfcare: "Wellness and self-care", beauty_skincare: "Beauty and skincare",
  fitness_movement: "Fitness and movement", travel_hospitality: "Travel and hospitality",
  lifestyle_general: "Lifestyle", luxury: "Luxury",
  parenting_family: "Parenting and family", local_city_guide: "Local city guide",
  vertical_shortform: "Vertical short-form", horizontal_longform: "Widescreen long-form",
  stills_only: "Stills", voiceover_narrative: "Voiceover storytelling",
  silent_ambient: "Quiet and atmospheric", live_realtime: "Live",
  home_branch: "This is her home branch", same_metro: "Her home area",
  drivable_2h: "About two hours away", requires_travel: "Would have to travel",

  // visits
  "30m": "30 minutes", "60m": "An hour", "90m": "An hour and a half",
  "2h": "2 hours", "3h": "3 hours", half_day: "Half a day",
  pending: "Waiting on the branch", accepted: "Accepted", declined: "Turned down",
  fully_booked: "Fully booked", room_unavailable: "The room is unavailable",
  staffing: "Not enough staff", private_event: "A private event", other: "Something else",
  coordinator: "Coordinator", branch_manager: "Branch manager",
  scheduled: "Booked", awaiting_branch: "Waiting on the branch",
  needs_new_date: "Needs a new date", not_proposed: "No date asked for yet",

  // clips
  uploaded: "Uploaded", analysing: "Being read", analysed: "Read",
  analysis_failed: "Could not be read", privacy_pending: "Privacy check pending",
  requires_human_review: "Needs you to look",
  unreadable_file: "Could not be opened here",
  blocked_by_environment: "Blocked by this page",
  asked: "We asked for it again", resent: "She sent it again", gave_up: "Given up on",
  alone: "On her own", with_crew: "With a small crew",
  instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube",
  rejected: "Rejected", archived: "Archived", rights_expired: "Rights expired",
  requested: "Requested", granted: "Granted", denied: "Denied",
  full: "Full frames", recoverable: "Can be re-read from the original", thumbs_only: "Thumbnails only",
  unmatched: "Nothing asked for this",
  high: "Confident", low: "Unsure",

  // model contract
  ok: "Fine", not_scored: "Not scored", failed_parse: "Reply could not be read",
  failed_shape: "Reply was the wrong shape", failed_range: "Number out of range",
  failed_vocabulary_invented: "Invented a value",
  failed_vocabulary_out_of_scope: "Used a value we did not send",
  no_basis: "Gave no basis", failed_api: "The call failed",
  brief: "Brief", visit: "Visit", intake: "Intake", done: "Done",
  derived: "Computed", edited: "You edited it", manual: "You added it",
};

const CONFIDENCE_LABEL = { high: "Confident", medium: "Fairly sure", low: "Unsure" };
const label = (v) =>
  v == null ? "" : (LABEL_OVERRIDE[v] ?? String(v).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()));

/* ========================================================== BRANCHES ===== */
const BRANCHES = [
  { id: "br_sj", name: "San Jose", metro: "bay_area" },
  { id: "br_sf", name: "San Francisco", metro: "bay_area" },
  { id: "br_sm", name: "Santa Monica", metro: "los_angeles" },
  { id: "br_atx", name: "Austin", metro: "austin" },
  { id: "br_scz", name: "Scottsdale", metro: "phoenix" },
];
const branchById = (id) => BRANCHES.find((b) => b.id === id);

const DRIVE_ADJACENCY = {
  bay_area: ["sacramento", "monterey"],
  los_angeles: ["orange_county", "santa_barbara", "san_diego"],
  austin: ["san_antonio"],
  phoenix: ["tucson"],
};

const PROXIMITY_RANK = { home_branch: 0, same_metro: 1, drivable_2h: 2, requires_travel: 3 };
const PROXIMITY_SCORE = { home_branch: 100, same_metro: 85, drivable_2h: 60, requires_travel: 0 };

function proximityToBranch(homeMetro, branch) {
  if (!homeMetro || !branch) return "requires_travel";
  if (branch.metro === homeMetro) {
    const sharing = BRANCHES.filter((b) => b.metro === branch.metro).length;
    return sharing > 1 ? "same_metro" : "home_branch";
  }
  if ((DRIVE_ADJACENCY[branch.metro] || []).includes(homeMetro)) return "drivable_2h";
  return "requires_travel";
}

function deriveBranchProximity(homeMetro) {
  if (!homeMetro) return { value: null, branchId: null };
  let best = null;
  for (const b of BRANCHES) {
    const p = proximityToBranch(homeMetro, b);
    if (!best || PROXIMITY_RANK[p] < PROXIMITY_RANK[best.value]) best = { value: p, branchId: b.id };
  }
  return best;
}

function proximityForGap(creator, gap) {
  const targets = gap.branch_id.length ? gap.branch_id.map(branchById).filter(Boolean) : BRANCHES;
  let best = null;
  for (const b of targets) {
    const p = proximityToBranch(creator.home_metro, b);
    if (!best || PROXIMITY_RANK[p] < PROXIMITY_RANK[best.value]) best = { value: p, branch: b };
  }
  return best ?? { value: "requires_travel", branch: null };
}

/* ============================================== FORMAT / ASPECT MAPPING == */
const FORMAT_DELIVERS_ASPECT = {
  vertical_shortform: ["vertical_9_16", "square_1_1"],
  horizontal_longform: ["horizontal_16_9"],
  stills_only: ["vertical_9_16", "square_1_1", "horizontal_16_9"],
  talking_head: ["vertical_9_16", "horizontal_16_9"],
  voiceover_narrative: ["vertical_9_16", "horizontal_16_9"],
  silent_ambient: ["vertical_9_16", "square_1_1", "horizontal_16_9"],
  live_realtime: ["vertical_9_16", "horizontal_16_9"],
};

function formatCoverage(creator, gap) {
  if (gap.aspect.length === 0) return { covered: [], missing: [], ratio: 1, anyAspect: true };
  const can = new Set();
  creator.format_strength.forEach((f) => (FORMAT_DELIVERS_ASPECT[f] || []).forEach((a) => can.add(a)));
  const covered = gap.aspect.filter((a) => can.has(a));
  return { covered, missing: gap.aspect.filter((a) => !can.has(a)), ratio: covered.length / gap.aspect.length, anyAspect: false };
}

/* ============================================== LAYER A — HARD FILTER ==== */
function hardFilter(creator, gap) {
  const out = [];
  const prox = proximityForGap(creator, gap);
  if (prox.value === "requires_travel") {
    const names = (gap.branch_id.length ? gap.branch_id.map(branchById) : BRANCHES).filter(Boolean).map((b) => b.name).join(", ");
    out.push({ code: "unreachable_branch", text: `Home metro ${label(creator.home_metro)} is not within reach of ${names}.` });
  }
  const fmt = formatCoverage(creator, gap);
  if (!fmt.anyAspect && fmt.covered.length === 0) {
    out.push({ code: "format_mismatch", text: `Gap needs ${gap.aspect.join(" or ")}. Nothing in ${creator.format_strength.join(", ") || "an empty format list"} delivers it.` });
  }
  if (creator.creator_vertical.length === 0) {
    out.push({ code: "no_vertical", text: "No verticals recorded. There is nothing to judge affinity against." });
  }
  return out;
}

/* ============================================ LAYER B — MEASURED SCORES == */
const WEIGHTS = { branch_fit: 30, format_fit: 25, audience_fit: 15, affinity: 30 };
const MEASURED_WEIGHT = WEIGHTS.branch_fit + WEIGHTS.format_fit + WEIGHTS.audience_fit;

function measuredScores(creator, gap) {
  const prox = proximityForGap(creator, gap);
  const branch_fit = {
    value: PROXIMITY_SCORE[prox.value], weight: WEIGHTS.branch_fit, source: "computed",
    detail: prox.branch ? `${label(prox.value)} · nearest requested branch is ${prox.branch.name}` : "No branch resolved",
  };
  const fmt = formatCoverage(creator, gap);
  const format_fit = {
    value: Math.round(fmt.ratio * 100), weight: WEIGHTS.format_fit, source: "computed",
    detail: fmt.anyAspect ? "Gap accepts any aspect, so format cannot disqualify"
      : fmt.missing.length === 0 ? `Covers ${fmt.covered.join(", ")}`
      : `Covers ${fmt.covered.join(", ") || "nothing"}, missing ${fmt.missing.join(", ")}`,
  };
  const targetMetros = new Set((gap.branch_id.length ? gap.branch_id.map(branchById) : BRANCHES).filter(Boolean).map((b) => b.metro));
  const overlap = creator.audience_geo.filter((g) => targetMetros.has(g));
  let aVal, aDetail;
  if (overlap.length) { aVal = 100; aDetail = `Audience overlaps ${overlap.map(label).join(", ")}`; }
  else if (creator.audience_geo.includes("us_national")) { aVal = 75; aDetail = "National audience, no local concentration"; }
  else if (creator.audience_geo.includes("international")) { aVal = 40; aDetail = "International audience, no US metro overlap"; }
  else if (creator.audience_geo.length === 0) { aVal = 50; aDetail = "Audience not recorded, treated as neutral rather than poor"; }
  else { aVal = 20; aDetail = `Audience sits in ${creator.audience_geo.map(label).join(", ")}, none of the requested metros`; }
  return { branch_fit, format_fit, audience_fit: { value: aVal, weight: WEIGHTS.audience_fit, source: "computed", detail: aDetail } };
}

/* ============================================ LAYER C — MODEL CONTRACT === */
const CHUNK_SIZE = 8;

const SYSTEM_PROMPT = `You rate topical affinity only: how naturally a creator's editorial territory produces the footage a gap describes.

Geography, travel, scheduling, deadlines, priority and volume are computed elsewhere and are deliberately absent from your input. Never infer or comment on them.

Rules:
- Every value in "basis" MUST appear verbatim in allowed_vocabulary. Never invent, translate or abbreviate a value, and never use a value that is not in allowed_vocabulary even if you believe it is valid.
- "basis" holds 1 to 4 values, taken from the creator's verticals and the gap's rooms and scenes.
- "affinity" is an integer 0-100.
- "rationale" is one plain sentence, 120 characters maximum.
- "concern" is a real tension in 80 characters maximum, or null. Do not invent one.
- Return one result object for every gap_id you were given.
- Output ONLY the JSON object. No markdown fences, no text before or after it.`;

function buildScoringInput(creator, gaps) {
  const vocab = {
    creator_vertical: [...new Set(creator.creator_vertical)],
    room_type: [...new Set(gaps.flatMap((g) => g.room_type))],
    scene: [...new Set(gaps.flatMap((g) => g.scene))],
  };
  return {
    vocab,
    payload: {
      taxonomy_version: TAXONOMY_VERSION, allowed_vocabulary: vocab,
      creator: { id: creator.id, creator_vertical: creator.creator_vertical, format_strength: creator.format_strength },
      gaps: gaps.map((g) => ({ gap_id: g.id, room_type: g.room_type, scene_primary: g.scene[0] ?? null, scene_secondary: g.scene.slice(1) })),
    },
  };
}

function extractJson(text) {
  let t = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a === -1 || b === -1 || b < a) throw new Error("no json object found");
  return JSON.parse(t.slice(a, b + 1));
}

function validateReply(parsed, sentGapIds, vocab) {
  const allowed = new Set([...vocab.creator_vertical, ...vocab.room_type, ...vocab.scene]);
  const byGap = {}; const log = [];
  const results = Array.isArray(parsed?.results) ? parsed.results : null;
  if (!results) {
    sentGapIds.forEach((id) => (byGap[id] = { ai_status: "failed_shape", ai_error_detail: "No results array in reply." }));
    return { byGap, log: ["Reply had no results array."] };
  }
  const seen = new Set();
  for (const r of results) {
    const id = r?.gap_id;
    if (!sentGapIds.includes(id)) { log.push(`Unknown gap_id "${id}" ignored.`); continue; }
    if (seen.has(id)) { log.push(`Duplicate gap_id "${id}" ignored.`); continue; }
    seen.add(id);
    if (typeof r.affinity !== "number" || !Number.isFinite(r.affinity)) {
      byGap[id] = { ai_status: "failed_shape", ai_error_detail: "affinity missing or not a number." }; continue;
    }
    if (r.affinity < 0 || r.affinity > 100) {
      byGap[id] = { ai_status: "failed_range", ai_error_detail: `affinity ${r.affinity} outside 0-100.` }; continue;
    }
    if (!Array.isArray(r.basis) || r.basis.length === 0) {
      byGap[id] = { ai_status: "no_basis", ai_error_detail: "basis empty. A score with nothing to point at is not a score." }; continue;
    }
    const offending = r.basis.filter((v) => !allowed.has(v));
    if (offending.length) {
      const invented = offending.filter((v) => !ALL_TAXONOMY_VALUES.has(v));
      const outOfScope = offending.filter((v) => ALL_TAXONOMY_VALUES.has(v));
      if (invented.length) {
        byGap[id] = { ai_status: "failed_vocabulary_invented", ai_error_detail: `Not in the taxonomy at all: ${invented.join(", ")}` };
        log.push(`INVENTED on ${id}: ${invented.join(", ")} — prompt or sampling problem.`);
      } else {
        byGap[id] = { ai_status: "failed_vocabulary_out_of_scope", ai_error_detail: `Valid taxonomy value, not sent in this call: ${outOfScope.join(", ")}` };
        log.push(`OUT OF SCOPE on ${id}: ${outOfScope.join(", ")} — the vocabulary we send may be too narrow.`);
      }
      continue;
    }
    byGap[id] = {
      ai_status: "ok", affinity: Math.round(r.affinity), basis: r.basis.slice(0, 4),
      rationale: typeof r.rationale === "string" ? r.rationale.slice(0, 160) : "",
      concern: typeof r.concern === "string" && r.concern.trim() ? r.concern.slice(0, 120) : null,
      confidence: ["high", "medium", "low"].includes(r.confidence) ? r.confidence : "medium",
    };
  }
  sentGapIds.forEach((id) => { if (!byGap[id]) byGap[id] = { ai_status: "not_scored", ai_error_detail: "Model returned no result for this gap." }; });
  return { byGap, log };
}

/**
 * Every model request goes out from here.
 *
 * The key is the person's own, held in their browser. Running outside the
 * Claude artifact means nothing injects credentials any more, so a missing key
 * is a state the product has to name rather than a 401 nobody can read.
 */
/**
 * Scoring, through the Edge Function.
 *
 * The key is on the server. Nothing here holds one, and the vocabulary the
 * model is allowed to answer with still travels in the payload so that the
 * validation on the way back has something to check against.
 */
async function callModel(payload) {
  const r = await callAi({ task: "score_creator", input: payload });
  if (!r.ok) { const e = new Error(r.detail); e.kind = r.kind; e.title = r.title; throw e; }
  return r.text;
}

async function scoreChunk(creator, gaps) {
  const { payload, vocab } = buildScoringInput(creator, gaps);
  const ids = gaps.map((g) => g.id);
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await callModel(payload);
      try { return validateReply(extractJson(text), ids, vocab); }
      catch (e) {
        lastErr = `Could not parse reply: ${e.message}`;
        if (attempt === 1) { const byGap = {}; ids.forEach((id) => (byGap[id] = { ai_status: "failed_parse", ai_error_detail: lastErr })); return { byGap, log: [lastErr] }; }
      }
    } catch (e) {
      lastErr = e.message;
      if (attempt === 1) { const byGap = {}; ids.forEach((id) => (byGap[id] = { ai_status: "failed_api", ai_error_detail: lastErr })); return { byGap, log: [`API error: ${lastErr}`] }; }
      await new Promise((r) => setTimeout(r, 900));
    }
  }
  return { byGap: {}, log: [] };
}

/* ============================================================ SCORE REC == */
function djb2(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h); }
function fingerprint(creator, gap) {
  return djb2(JSON.stringify([creator.creator_vertical, creator.format_strength, creator.audience_geo, creator.home_metro,
    gap.room_type, gap.scene, gap.aspect, gap.branch_id]));
}
const pairId = (c, g) => `${c.id}::${g.id}`;

function buildScore(creator, gap, aiPart) {
  const dq = hardFilter(creator, gap);
  const m = measuredScores(creator, gap);
  const measured = Math.round((m.branch_fit.value * m.branch_fit.weight + m.format_fit.value * m.format_fit.weight +
    m.audience_fit.value * m.audience_fit.weight) / MEASURED_WEIGHT);
  const ok = aiPart?.ai_status === "ok";
  return {
    id: pairId(creator, gap), creator_id: creator.id, gap_id: gap.id,
    taxonomy_version: TAXONOMY_VERSION, scored_at: new Date().toISOString(),
    input_fingerprint: fingerprint(creator, gap), disqualified: dq, ...m,
    affinity: ok ? { value: aiPart.affinity, weight: WEIGHTS.affinity, source: "model", basis: aiPart.basis,
      rationale: aiPart.rationale, concern: aiPart.concern, confidence: aiPart.confidence }
      : { value: null, weight: WEIGHTS.affinity, source: "model", basis: [], rationale: "", concern: null, confidence: null },
    ai_status: aiPart?.ai_status ?? "not_scored", ai_error_detail: aiPart?.ai_error_detail ?? "",
    measured_score: measured,
    total: ok ? Math.round((m.branch_fit.value * WEIGHTS.branch_fit + m.format_fit.value * WEIGHTS.format_fit +
      m.audience_fit.value * WEIGHTS.audience_fit + aiPart.affinity * WEIGHTS.affinity) / 100) : null,
  };
}

function scoreFreshness(score, creator, gap) {
  if (!score) return "missing";
  return score.input_fingerprint === fingerprint(creator, gap) ? "fresh" : "stale";
}

/* ============================================================================
   INTAKE VALIDATION LAYER
   Mirrors validation.js, which is the version the test suite runs against.
   An artifact cannot import a sibling file, so the functions live here too.
   If you change one, change both. The tests are the source of truth.

   Two rules, pointing deliberately in opposite directions:
     DESCRIPTION  doubt collapses to "indeterminate".
     PRIVACY      doubt survives as a flag, and an unreadable warning still
                  forces review. "We don't know" is not "we assume it's fine".
============================================================================ */

function classifyValue(value, allowedList) {
  if (typeof value !== "string" || !value) return "failed_shape";
  if (allowedList.includes(value)) return "ok";
  if (ALL_TAXONOMY_VALUES.has(value)) return "failed_vocabulary_out_of_scope";
  return "failed_vocabulary_invented";
}

// An unstated confidence is not a middling one.
const normaliseConfidence = (c) => (CONFIDENCE.includes(c) ? c : "low");

function validateEnumField(raw, allowedList, { fallback = null } = {}) {
  if (raw === undefined || raw === null) {
    return { value: fallback, confidence: null, status: "missing", detail: "Field absent from the reply." };
  }
  const value = typeof raw === "object" ? raw.value : raw;
  const confidence = typeof raw === "object" ? normaliseConfidence(raw.confidence) : "low";
  const status = classifyValue(value, allowedList);
  if (status === "ok") return { value, confidence, status, detail: null };
  const detail = status === "failed_vocabulary_invented"
    ? `"${value}" is not in the taxonomy at all.`
    : status === "failed_vocabulary_out_of_scope"
      ? `"${value}" is a real taxonomy value but not legal for this field.`
      : `Value was ${JSON.stringify(value)}, expected a string.`;
  return { value: fallback, confidence: null, status, detail };
}

function validateSceneList(raw, allowedList) {
  if (!Array.isArray(raw)) return { value: [], confidence: null, status: "missing", detail: "scene was not an array.", dropped: [] };
  const kept = []; const dropped = []; let worst = "ok"; let lowest = "high";
  for (const item of raw) {
    const v = typeof item === "object" ? item.value : item;
    const c = typeof item === "object" ? normaliseConfidence(item.confidence) : "low";
    const st = classifyValue(v, allowedList);
    if (st === "ok") {
      if (!kept.includes(v)) kept.push(v);
      if (CONFIDENCE.indexOf(c) > CONFIDENCE.indexOf(lowest)) lowest = c;
    } else { dropped.push({ value: v, status: st }); if (worst === "ok") worst = st; }
  }
  return {
    value: kept, confidence: kept.length ? lowest : null,
    status: kept.length ? (dropped.length ? "partial" : "ok") : (dropped.length ? worst : "missing"),
    detail: dropped.length ? `${dropped.length} scene value(s) rejected.` : null, dropped,
  };
}

function validateQualityFlags(raw, allowedFlags) {
  const flags = []; const issues = [];
  if (raw === undefined || raw === null) return { flags, issues };
  if (!Array.isArray(raw)) {
    issues.push({ code: "failed_shape", field: "quality_flags", detail: "quality_flags was not an array." });
    return { flags, issues };
  }
  for (const item of raw) {
    const flag = typeof item === "object" ? item.flag : item;
    const st = classifyValue(flag, allowedFlags);
    if (st !== "ok") { issues.push({ code: st, field: "quality_flags", detail: `Rejected quality flag "${flag}".` }); continue; }
    const confidence = normaliseConfidence(typeof item === "object" ? item.confidence : undefined);
    let severity = typeof item === "object" ? item.severity : undefined;
    if (!QUALITY_SEVERITY.includes(severity)) {
      issues.push({ code: "failed_shape", field: "quality_flags", detail: `"${flag}" had severity ${JSON.stringify(severity)}, downgraded to cosmetic.` });
      severity = "cosmetic";
    }
    // Uncertain damage is a cleanup note, never a rejection.
    if (confidence === "low" && severity === "blocking") {
      issues.push({ code: "downgraded_low_confidence", field: "quality_flags", detail: `"${flag}" was blocking at low confidence, downgraded to cosmetic.` });
      severity = "cosmetic";
    }
    if (!flags.some((f) => f.flag === flag)) flags.push({ flag, severity, confidence });
  }
  return { flags, issues };
}

/** The model may be wrong. It may not be certain about what it cannot see. */
function checkOverconfidence(fields) {
  const out = [];
  const room = fields.room_type.value;
  const tod = fields.time_of_day;
  if (room && WINDOWLESS_ROOMS.has(room) && tod.value && tod.value !== "indeterminate"
      && (tod.confidence === "high" || tod.confidence === "medium")) {
    out.push({
      code: "overconfidence_flag", field: "time_of_day",
      detail: `Reported "${tod.value}" at ${tod.confidence} confidence inside ${room}, which has no exterior light. Downgraded to indeterminate.`,
      was: tod.value, was_confidence: tod.confidence,
    });
    tod.value = "indeterminate"; tod.confidence = null; tod.status = "overconfidence_downgraded";
  }
  return out;
}

function validateDescription(parsed, vocab) {
  const issues = [];
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, fields: null, quality_flags: [], overconfidence: [],
      issues: [{ code: "failed_shape", field: null, detail: "Reply was not an object." }] };
  }
  const fields = {
    room_type: validateEnumField(parsed.room_type, vocab.room_type),
    scene: validateSceneList(parsed.scene, vocab.scene),
    shot_size: validateEnumField(parsed.shot_size, vocab.shot_size),
    camera_motion: validateEnumField(parsed.camera_motion, vocab.camera_motion),
    lighting_condition: validateEnumField(parsed.lighting_condition, vocab.lighting_condition),
    color_cast: validateEnumField(parsed.color_cast, vocab.color_cast, { fallback: "indeterminate" }),
    reframe_safe_9_16: validateEnumField(parsed.reframe_safe_9_16, vocab.reframe_safe_9_16),
    audio_state: validateEnumField(parsed.audio_state, vocab.audio_state),
    time_of_day: validateEnumField(parsed.time_of_day, vocab.time_of_day, { fallback: "indeterminate" }),
  };
  for (const [name, f] of Object.entries(fields)) {
    if (f.status === "partial") f.dropped.forEach((d) => issues.push({ code: d.status, field: name, detail: `Rejected scene value "${d.value}".` }));
    else if (f.status === "missing") issues.push({ code: "missing", field: name, detail: "Absent from the reply, recorded as unknown." });
    else if (f.status !== "ok") issues.push({ code: f.status, field: name, detail: f.detail });
  }
  const q = validateQualityFlags(parsed.quality_flags, vocab.quality_flag);
  q.issues.forEach((i) => issues.push(i));
  const overconfidence = checkOverconfidence(fields);
  overconfidence.forEach((o) => issues.push(o));
  return { ok: fields.room_type.status === "ok", fields, quality_flags: q.flags, issues, overconfidence };
}

function validatePrivacy(parsed, vocab) {
  const allowed = vocab.privacy_flag;
  const issues = []; const flags = [];
  if (!parsed || typeof parsed !== "object") {
    return { privacy_flags: [], issues: [{ code: "failed_shape", field: "privacy_flags", detail: "Reply was not an object." }],
      review_required: true, review_reason: "The privacy check did not return a readable answer. Unreadable is not clean." };
  }
  const raw = parsed.privacy_flags;
  if (raw === undefined || raw === null) {
    return { privacy_flags: [], issues: [{ code: "missing", field: "privacy_flags", detail: "No privacy_flags key in the reply." }],
      review_required: true, review_reason: "The reply contained no privacy_flags key at all, so nothing was actually checked." };
  }
  if (!Array.isArray(raw)) {
    return { privacy_flags: [], issues: [{ code: "failed_shape", field: "privacy_flags", detail: "privacy_flags was not an array." }],
      review_required: true, review_reason: "The privacy answer was malformed and could not be read." };
  }
  let droppedAny = false;
  for (const item of raw) {
    const flag = typeof item === "object" ? item.flag : item;
    const st = classifyValue(flag, allowed);
    if (st !== "ok") {
      droppedAny = true;
      issues.push({ code: st, field: "privacy_flags", detail: `Rejected privacy flag "${flag}". The model raised something we could not map.` });
      continue;
    }
    const confidence = normaliseConfidence(typeof item === "object" ? item.confidence : undefined);
    let frame_index = typeof item === "object" ? item.frame_index : null;
    if (!Number.isInteger(frame_index) || frame_index < 0) frame_index = null;
    const note = typeof item === "object" && typeof item.note === "string" ? item.note.slice(0, 120) : "";
    if (flags.some((f) => f.flag === flag)) continue;
    flags.push({ flag, confidence, frame_index, note, status: "unreviewed", resolved_by: null, resolved_at: null });
  }
  return {
    privacy_flags: flags, issues,
    review_required: flags.length > 0 || droppedAny,
    review_reason: flags.length > 0
      ? `${flags.length} privacy flag${flags.length === 1 ? "" : "s"} raised. Only a person can clear these.`
      : droppedAny
        ? "The model raised a privacy signal we could not map to a known flag. Treated as unreviewed rather than nothing."
        : null,
  };
}

/**
 * Whether a privacy flag is still standing in the way.
 *
 * Takes a missing list as an empty one rather than throwing. A row read from
 * the library view has no privacy_flags column at all, and a screen crashing
 * on that shape means nobody can open the library - which is worse than any
 * answer this function could give.
 */
const privacyBlocks = (fl) => (fl ?? []).some((f) =>
  f.status === "unreviewed" || f.status === "blocked" || f.status === "release_required");

/**
 * Analysis frames are still never persisted, and a privacy judgement made from
 * a 256px thumbnail is still not a judgement. What changed is that the
 * original file is in storage, so the full-size frames can be made again
 * instead of the clip being a dead end.
 *
 * The gate is unchanged in the case that matters. If the original is gone,
 * analysis refuses exactly as it did before and says exactly why. Recovery is
 * an extra door, not a removed lock.
 */
function canAnalyse(framesAvailable) {
  if (framesAvailable === "full") return { allowed: true, reason: null };
  if (framesAvailable === "recoverable") {
    return { allowed: false, code: "recoverable", recoverable: true,
      reason: "The full resolution frames are gone, as they always are between sessions. The original file is still in storage, so they can be made again." };
  }
  if (framesAvailable === "thumbs_only") {
    return { allowed: false, code: "requires_human_review",
      reason: "Only the small thumbnails are left and the original file is not in storage, so nothing can be re-read. A privacy call cannot be made from a thumbnail. Upload the file again, or describe it yourself." };
  }
  return { allowed: false, code: "requires_human_review", reason: "No frames were extracted from this file. Nothing can be analysed." };
}

/* -------------------------------------------------- BRIEF DIFF, IN CODE -- */
/**
 * The model never sees the brief. If it knew we asked for a sauna it would
 * find a sauna, and the comparison would be worth nothing.
 */
function matchClipToShots(clipFields, aspectNative, shotList) {
  const room = clipFields?.room_type?.value;
  if (!room) return { shot_id: null, gap_id: null, level: "unmatched", mismatches: ["No room could be read from the clip."] };
  const candidates = shotList.filter((s) => s.room_type === room);
  if (candidates.length === 0) return { shot_id: null, gap_id: null, level: "unmatched", mismatches: [`Nothing in the brief asks for ${room}.`] };
  let best = null;
  for (const s of candidates) {
    const mismatches = [];
    if (s.aspect && aspectNative && s.aspect !== aspectNative) mismatches.push(`asked ${s.aspect}, got ${aspectNative}`);
    if (s.shot_size && clipFields.shot_size.value && s.shot_size !== clipFields.shot_size.value) mismatches.push(`asked ${s.shot_size}, got ${clipFields.shot_size.value}`);
    if (s.scene.length && clipFields.scene.value.length) {
      const overlap = s.scene.filter((x) => clipFields.scene.value.includes(x));
      if (overlap.length === 0) mismatches.push(`asked ${s.scene[0]}, got ${clipFields.scene.value[0]}`);
    }
    const level = mismatches.length === 0 ? "full" : "partial";
    if (!best || (best.level === "partial" && level === "full") ||
        (best.level === level && mismatches.length < best.mismatches.length)) {
      best = { shot_id: s.id, gap_id: s.gap_id, level, mismatches };
    }
  }
  return best;
}

/* ================================================== MEDIA DIAGNOSTICS === */
/**
 * The browser tells you exactly why a video would not open. Until now every
 * one of these four became the same sentence about iPhones, which sent you
 * looking in the wrong place. They are different failures with different fixes.
 */
const MEDIA_ERROR = {
  1: { code: "aborted", plain: "Loading the file was interrupted before it finished." },
  2: { code: "network", plain: "The browser could not read the file's data." },
  3: { code: "decode", plain: "The browser opened the file but could not decode the video inside it." },
  4: { code: "unsupported", plain: "The video source was refused before any decoding happened." },
};
const mediaError = (v) => {
  const e = v?.error;
  if (!e) return { code: "no_error_object", plain: "The video element failed without saying why." };
  return { ...(MEDIA_ERROR[e.code] ?? { code: `code_${e.code}`, plain: "The video element reported an unknown failure." }),
    raw: `MediaError ${e.code}${e.message ? ` · ${e.message}` : ""}` };
};

/** Costs nothing and runs before any work. Catches the common case early. */
function probeFile(file) {
  const el = document.createElement("video");
  const byType = file.type ? el.canPlayType(file.type) : "";
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const looksApple = ext === "mov" || ext === "hevc" || /hevc|h265/i.test(file.type || "");
  return {
    type: file.type || "(the file carries no type)",
    ext,
    canPlayType: byType || "no",
    verdict: byType === "probably" || byType === "maybe" ? "likely_ok"
      : looksApple ? "likely_unreadable_apple" : "likely_unreadable",
  };
}

/* ======================================================= FRAME EXTRACTION */
/**
 * Two sizes out of one pass over the video, because they answer two different
 * questions. The 256px thumbnail exists so a person can tell which clip they
 * are looking at. The 1024px frame exists so the model can see whether a
 * guest's face is identifiable. Neither can do the other's job.
 * Only the thumbnail is stored.
 */
const THUMB_PX = 256;
const ANALYSIS_PX = 1024;

function framePlan(durationSeconds) {
  const d = Number(durationSeconds);
  if (!Number.isFinite(d) || d <= 0) return { count: 3, positions: [0.1, 0.5, 0.9] };
  let count;
  if (d < 5) count = 3; else if (d < 15) count = 4; else if (d < 30) count = 5;
  else if (d < 60) count = 6; else if (d < 120) count = 7; else count = 8;
  const start = 0.08, end = 0.92; // never 0.0: the first frame is usually black
  return { count, positions: Array.from({ length: count }, (_, i) => start + ((end - start) * i) / (count - 1)) };
}

function aspectFromDimensions(w, h) {
  if (!w || !h) return "other_ratio";
  const r = w / h;
  if (r <= 0.8) return "vertical_9_16";
  if (r < 1.25) return "square_1_1";
  if (r >= 1.5) return "horizontal_16_9";
  return "other_ratio";
}

function durationBucket(d) {
  if (!Number.isFinite(d)) return null;
  if (d < 3) return "under_3s";
  if (d < 10) return "3_10s";
  if (d < 30) return "10_30s";
  if (d < 60) return "30_60s";
  return "over_60s";
}

function drawFrame(video, maxPx, quality) {
  const w = video.videoWidth, h = video.videoHeight;
  const scale = Math.min(1, maxPx / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

/**
 * Waits for the seek to land. Setting currentTime to where the video already
 * is fires no event at all, so that case resolves immediately instead of
 * sitting there until the timeout.
 */
function seekTo(video, t, ms = 12000) {
  return new Promise((resolve, reject) => {
    if (Math.abs(video.currentTime - t) < 0.02) return resolve("already there");
    let settled = false;
    const bail = setTimeout(() => {
      if (settled) return;
      settled = true; video.removeEventListener("seeked", done);
      reject(new Error(`seek to ${t.toFixed(2)}s did not complete in ${ms / 1000}s`));
    }, ms);
    function done() {
      if (settled) return;
      settled = true; clearTimeout(bail); video.removeEventListener("seeked", done); resolve("seeked");
    }
    video.addEventListener("seeked", done);
    try { video.currentTime = t; }
    catch (e) { settled = true; clearTimeout(bail); reject(new Error(`could not set currentTime: ${e.message}`)); }
  });
}

/** Loads the video from one source and reports every step on the way. */
function loadVia(video, src, label, log, ms = 30000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, arg) => { if (!settled) { settled = true; clearTimeout(bail); fn(arg); } };
    const bail = setTimeout(() => {
      log(`${label}: gave up after ${ms / 1000}s · readyState ${video.readyState} · networkState ${video.networkState}`);
      finish(reject, Object.assign(new Error("timed out while loading"), { kind: "timeout" }));
    }, ms);

    video.onloadedmetadata = () =>
      log(`${label}: metadata loaded · duration ${Number(video.duration).toFixed(2)}s · ${video.videoWidth}x${video.videoHeight}`);
    video.onloadeddata = () => {
      log(`${label}: first frame decoded · readyState ${video.readyState}`);
      finish(resolve, label);
    };
    video.onerror = () => {
      const m = mediaError(video);
      // "URL safety check" is the sandbox refusing the source, not a codec
      // verdict. Naming it correctly is the difference between debugging the
      // environment and debugging a file that was never the problem.
      const refused = /safety check|not allowed|blocked/i.test(m.raw ?? "");
      const kind = refused ? "blocked_by_environment" : m.code;
      log(`${label}: FAILED · ${m.raw ?? m.code}${refused ? " · the source was refused before decoding" : ""}`);
      finish(reject, Object.assign(new Error(refused
        ? "This page will not let the browser open local video." : m.plain), { kind, raw: m.raw }));
    };
    video.onstalled = () => log(`${label}: stalled`);
    video.onsuspend = () => log(`${label}: suspended · readyState ${video.readyState}`);

    log(`${label}: starting`);
    video.src = src;
    video.load();
  });
}

const fileToDataUrl = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(new Error("FileReader could not read the file"));
  r.readAsDataURL(file);
});

/**
 * Two sizes out of one pass over the video, because they answer two different
 * questions. The 256px thumbnail exists so a person can tell which clip they
 * are looking at. The 1024px frame exists so the model can see whether a
 * guest's face is identifiable. Only the thumbnail is stored.
 *
 * Tries a blob URL first and a data URL second. A sandboxed page can block
 * blob: media while allowing data:, and when that happens the file is fine and
 * only the delivery was wrong. The log says which one worked.
 */
async function extractFrames(file, onStep) {
  const steps = [];
  const log = (m) => {
    const line = `${String(steps.length + 1).padStart(2, "0")}  ${m}`;
    steps.push(line);
    onStep?.(line, steps);
  };

  const probe = probeFile(file);
  log(`file "${file.name}" · ${(file.size / 1048576).toFixed(2)} MB · type ${probe.type}`);
  log(`canPlayType says "${probe.canPlayType}" for this type`);

  const video = document.createElement("video");
  video.preload = "auto"; video.muted = true; video.playsInline = true;
  video.crossOrigin = "anonymous";

  const attempts = [];
  let loadedVia = null, blobUrl = null;

  try {
    try {
      blobUrl = URL.createObjectURL(file);
      log(`blob URL created (${blobUrl.slice(0, 24)}…)`);
      loadedVia = await loadVia(video, blobUrl, "blob URL", log);
    } catch (e) {
      attempts.push(`blob URL: ${e.message}`);
      log("blob URL did not work, falling back to a data URL");
      try {
        const data = await fileToDataUrl(file);
        log(`data URL built · ${(data.length / 1048576).toFixed(2)} MB of base64`);
        loadedVia = await loadVia(video, data, "data URL", log);
      } catch (e2) {
        attempts.push(`data URL: ${e2.message}`);
        const err = new Error(e2.message);
        err.kind = e2.kind ?? "load_failed";
        err.probe = probe; err.steps = steps; err.attempts = attempts;
        throw err;
      }
    }

    const duration = video.duration, width = video.videoWidth, height = video.videoHeight;
    log(`loaded via ${loadedVia} · duration ${Number(duration).toFixed(2)}s · ${width}x${height}`);
    if (!width || !height) {
      const err = new Error("The video reported no width or height, so there is nothing to draw.");
      err.kind = "no_dimensions"; err.probe = probe; err.steps = steps; throw err;
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      log(`duration is ${duration}, treating the clip as a single frame`);
    }

    const plan = framePlan(duration);
    log(`plan: ${plan.count} frames at ${plan.positions.map((p) => (p * 100).toFixed(0) + "%").join(", ")}`);

    const thumbs = [], analysis = [];
    for (let i = 0; i < plan.positions.length; i++) {
      const safeDur = Number.isFinite(duration) && duration > 0 ? duration : 1;
      const t = Math.min(Math.max(0.05, safeDur * plan.positions[i]), Math.max(0.05, safeDur - 0.05));
      const how = await seekTo(video, t);
      log(`frame ${i}: ${how} at ${t.toFixed(2)}s · currentTime ${video.currentTime.toFixed(2)}s`);
      const thumb = drawFrame(video, THUMB_PX, 0.6);
      const big = drawFrame(video, ANALYSIS_PX, 0.85);
      log(`frame ${i}: canvas gave ${Math.round(thumb.length / 1024)} KB thumbnail and ${Math.round(big.length / 1024)} KB full frame`);
      if (thumb.length < 200) {
        const err = new Error("The canvas came back empty, which usually means the page is not allowed to read the video.");
        err.kind = "empty_canvas"; err.probe = probe; err.steps = steps; throw err;
      }
      thumbs.push(thumb); analysis.push(big);
    }

    log(`done · ${thumbs.length} frames extracted`);
    return {
      duration, width, height, thumbs, analysis,
      aspect_native: aspectFromDimensions(width, height),
      duration_bucket: durationBucket(duration),
      frame_count: plan.count, loaded_via: loadedVia, steps,
    };
  } finally {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    video.removeAttribute("src");
    video.load();
  }
}

/* ================================================== INTAKE MODEL PATHS === */
/**
 * Two calls, never one. A description failure costs a bad search. A missed
 * privacy flag costs a guest in a robe in a paid campaign. They fail
 * differently, they cost differently, so they do not share a request.
 */
const DESCRIBE_SYSTEM = `You describe what is visible in a set of frames taken from one short video shot inside a spa.

You are describing, not matching. You have not been told what anyone asked for and you must not try to infer it.

Rules:
- Every value must appear verbatim in allowed_vocabulary for that specific field. Never invent a value. Never place a value from one field into another.
- Every field is an object: {"value": "...", "confidence": "high|medium|low"}.
- Where the frames do not support an answer, use "indeterminate" if that field allows it, at low confidence. An explicit unknown is worth more than a guess.
- time_of_day: answer only if exterior daylight is actually visible in the frames. An interior room with no window is "indeterminate" no matter how warm or bright the lighting looks. Warm lamps are not evening.
- quality_flags: only real, visible problems, each as {"flag","severity","confidence"}. Do not pad the list to seem thorough.
- Output ONLY the JSON object. No markdown fences, no text before or after.`;

const PRIVACY_SYSTEM = `You look at frames from one short video shot inside a spa and raise privacy flags. Nothing else.

Do not describe the video. Do not comment on quality, composition or lighting.

Rules:
- Every flag must appear verbatim in allowed_flags.
- Raise a flag if there is any real chance it applies. A person reviews every flag you raise. A flag you do not raise is never reviewed by anyone.
- "possible_unverified_person" means only this: a person is in frame with no identified release on file. Never estimate, mention or imply anyone's age. Never describe anyone's appearance, body or clothing beyond what the flag itself names.
- frame_index is the 0-based index of the frame that prompted the flag.
- note: at most 80 characters, factual, no speculation about who anyone is.
- If nothing applies, return an empty array.
- Output ONLY the JSON object. No markdown fences, no text before or after.`;

const DESCRIBE_VOCAB = {
  room_type: ROOM_TYPE, scene: SCENE, shot_size: SHOT_SIZE,
  camera_motion: CAMERA_MOTION, lighting_condition: LIGHTING_CONDITION,
  color_cast: COLOR_CAST, reframe_safe_9_16: REFRAME_SAFE,
  audio_state: AUDIO_STATE, time_of_day: TIME_OF_DAY, quality_flag: QUALITY_FLAG,
};
const PRIVACY_VOCAB = { privacy_flag: PRIVACY_FLAG };

function imageBlocks(dataUrls) {
  return dataUrls.map((d) => ({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: d.split(",")[1] },
  }));
}

/**
 * Reading one clip. Description and privacy come from the SAME answer now.
 *
 * They used to be two separate requests, so that a model failing to describe a
 * clip could not also decide it was safe. The Edge Function makes one call and
 * returns both, which changes where that separation lives but not whether it
 * exists: the two halves are pulled apart HERE, validated separately, and a
 * privacy answer that cannot be read still blocks the clip on its own.
 *
 * `frames` must be URLs the model can fetch. Signed storage URLs work.
 */
async function readClip(frames) {
  const r = await callAi({ task: "read_clip", images: frames.analysis ?? frames });
  if (!r.ok) { const e = new Error(r.detail); e.kind = r.kind; e.title = r.title; throw e; }

  const read = clipReadingToFields(r.data, { ROOM_TYPE, SCENE, SHOT_SIZE, LIGHTING, label });
  const priv = clipReadingToPrivacy(r.data);

  // Straight back through the validation the product already had. The words
  // changed shape on the way in; nothing about what counts as valid did.
  const described = validateDescription(read.fields, DESCRIBE_VOCAB);

  return {
    described,
    privacy: priv.blocked
      ? { privacy_flags: [{ flag: "guest_face_visible", severity: "blocking", confidence: "high" }],
          issues: [], review_required: true, review_reason: priv.reason }
      : { privacy_flags: priv.peopleVisible
            ? [{ flag: "person_present_not_identifiable", severity: "advisory", confidence: "medium" }]
            : [],
          issues: [], review_required: false, review_reason: null },
    unmatched: read.unmatched,
    notes: read.notes,
    ms: r.ms,
    framesRead: r.framesRead,
  };
}


/* =========================================================== SCHEMAS ===== */
const uid = (p) => `${p}_${Math.random().toString(36).slice(2, 9)}`;
const now = () => new Date().toISOString();

function makeGap(o = {}) {
  return {
    id: o.id ?? uid("gap"), taxonomy_version: TAXONOMY_VERSION,
    created_at: o.created_at ?? now(), updated_at: now(),
    status: o.status ?? "open", closed_at: o.closed_at ?? null,
    branch_id: o.branch_id ?? [], room_type: o.room_type ?? [], scene: o.scene ?? [],
    shot_size: o.shot_size ?? [], aspect: o.aspect ?? [], lighting: o.lighting ?? [],
    quantity_needed: o.quantity_needed ?? 1, priority: o.priority ?? "p1",
    deadline: o.deadline ?? "", intended_channel: o.intended_channel ?? [],
  };
}

function makeCreator(o = {}) {
  const prox = deriveBranchProximity(o.home_metro);
  return {
    id: o.id ?? uid("crt"), taxonomy_version: TAXONOMY_VERSION,
    created_at: o.created_at ?? now(), updated_at: now(),
    display_name: o.display_name ?? "", handle: o.handle ?? "",
    home_metro: o.home_metro ?? null, creator_vertical: o.creator_vertical ?? [],
    audience_geo: o.audience_geo ?? [], format_strength: o.format_strength ?? [],
    branch_proximity: prox.value, nearest_branch_id: prox.branchId,
    // A key into the sample portraits, not an image. Creators added by hand
    // have none, and get initials instead.
    photo: o.photo ?? null,
    // How to reach her, and what she is like to work with. All typed in by a
    // person: none of it is inferred, and none of it is scored.
    email: o.email ?? "", phone: o.phone ?? "",
    links: o.links ?? [],                      // [{ platform, url }]
    coverage_note: o.coverage_note ?? "",
    style_note: o.style_note ?? "",
    camera: o.camera ?? "", brings_lighting: o.brings_lighting ?? "unknown",
    works_with: o.works_with ?? "unknown",
    platform_stats: o.platform_stats ?? [],    // [{ platform, followers, engagement }]
    notes: o.notes ?? [],                      // [{ text, by, at, worked }]
  };
}

/** Least binding value is always the default. */
function makeRights(o = {}) {
  return {
    channels: o.channels ?? [], territory: o.territory ?? null,
    duration: o.duration ?? "unknown", start_date: o.start_date ?? "",
    exclusivity: o.exclusivity ?? "non_exclusive",
    credit_required: o.credit_required ?? "not_required",
    edit_permission: o.edit_permission ?? "trim_only",
    music_rights: o.music_rights ?? "no_music",
    releases_on_file: o.releases_on_file ?? "none",
    agreement_form: o.agreement_form ?? "verbal_undocumented",
    consideration: o.consideration ?? "visit_only",
    entered_by: o.entered_by ?? null, entered_at: o.entered_at ?? null,
  };
}

function makeCollab(o = {}) {
  return {
    id: o.id ?? uid("clb"), taxonomy_version: TAXONOMY_VERSION,
    created_at: o.created_at ?? now(), updated_at: now(), created_by: o.created_by ?? null,
    creator_id: o.creator_id ?? null, branch_id: o.branch_id ?? null,
    gap_ids: o.gap_ids ?? [], stage: o.stage ?? "brief",
    brief_shot_list: o.brief_shot_list ?? [], brief_fingerprint: o.brief_fingerprint ?? null,
    brief_approved_by: o.brief_approved_by ?? null, brief_approved_at: o.brief_approved_at ?? null,
    rights: o.rights ?? makeRights(),
    channel_override: o.channel_override ?? null,
    selection_note: o.selection_note ?? null,
    started_without_score: o.started_without_score ?? false,
    visit_proposals: o.visit_proposals ?? [],
  };
}

function makeVisitProposal(o = {}) {
  return {
    id: o.id ?? uid("vst"),
    date: o.date ?? "", time_of_day: o.time_of_day ?? null,
    duration: o.duration ?? null, note: o.note ?? "",
    proposed_by: o.proposed_by ?? null, proposed_at: o.proposed_at ?? now(),
    status: o.status ?? "pending",
    responded_by: o.responded_by ?? null, responded_at: o.responded_at ?? null,
    decline_reason: o.decline_reason ?? null, decline_note: o.decline_note ?? "",
    // What the branch actually agreed to. Later edits to the brief do not
    // rewrite this, they get flagged against it.
    brief_snapshot_fingerprint: o.brief_snapshot_fingerprint ?? null,
    room_snapshot: o.room_snapshot ?? [],
  };
}

function makeShotItem(o = {}) {
  return {
    id: o.id ?? uid("shot"), gap_id: o.gap_id ?? null,
    room_type: o.room_type ?? null, scene: o.scene ?? [],
    shot_size: o.shot_size ?? null, aspect: o.aspect ?? null,
    lighting: o.lighting ?? null, count: o.count ?? 1,
    instruction: o.instruction ?? "", note: o.note ?? null,
    source: o.source ?? "manual", // derived | edited | manual  (drafted, later)
  };
}

function makeClip(o = {}) {
  return {
    id: o.id ?? uid("clip"), taxonomy_version: TAXONOMY_VERSION, created_at: o.created_at ?? now(),
    collab_id: o.collab_id ?? null, gap_id_closed: o.gap_id_closed ?? null,
    branch_id: o.branch_id ?? null, filename: o.filename ?? "",
    clip_status: o.clip_status ?? "uploaded",
    blocked_reason: o.blocked_reason ?? null,
    // Why a file could not be opened, in the browser's own words. Kept on the
    // record so a failure can be sent to someone who can act on it.
    read_failure: o.read_failure ?? null,      // { kind, plain, probe, steps[] }
    loaded_via: o.loaded_via ?? null,
    // Null for real footage. Set only on rows pulled from a stock search.
    sample: o.sample ?? null,
    resend_request: o.resend_request ?? { status: "none", asked_by: null, asked_at: null },

    // Only the 256px thumbnails are persisted. The 1024px analysis frames live
    // in memory for this session and are deliberately never written to storage.
    thumbs: o.thumbs ?? [],
    frame_count: o.frame_count ?? 0,

    ai: o.ai ?? null,                       // validated description fields
    ai_status: o.ai_status ?? "not_scored",
    ai_issues: o.ai_issues ?? [],
    overconfidence: o.overconfidence ?? [],

    // aspect, duration and time of day are known without asking a model.
    system: o.system ?? {
      duration: null, width: null, height: null,
      aspect_native: null, duration_bucket: null, capture_source: "unknown",
      time_of_day: null, time_of_day_source: null,
    },

    quality_flags: o.quality_flags ?? [],
    privacy_flags: o.privacy_flags ?? [],
    privacy_status: o.privacy_status ?? "unreviewed",
    privacy_issues: o.privacy_issues ?? [],
    privacy_reason: o.privacy_reason ?? null,
    privacy_manual_review: o.privacy_manual_review ?? null,  // { by, at }
    corrected_by: o.corrected_by ?? null, corrected_at: o.corrected_at ?? null,

    match: o.match ?? null,                 // computed in code, never by a model
    unmatched_keep: o.unmatched_keep ?? false,

    rights_override: o.rights_override ?? null, rights_status: o.rights_status ?? "unknown",
    release_request: o.release_request ?? { status: "none", requested_by: null, requested_at: null,
      resolved_by: null, resolved_at: null, note: "" },
    accepted_by: o.accepted_by ?? null, accepted_at: o.accepted_at ?? null,
    rejected_by: o.rejected_by ?? null, rejected_at: o.rejected_at ?? null, reject_reason: o.reject_reason ?? "",
  };
}

/* Analysis frames for this session only. Cleared by a reload, on purpose. */
const sessionFrames = new Map();

/** The pictures for a clip, whether from this session or from storage. */
function thumbsFor(clip, signed = {}) {
  if (clip.thumbs?.length) return clip.thumbs;
  const paths = clip.thumb_paths ?? [];
  const urls = paths.map((p) => signed[p]).filter(Boolean);
  return urls.length === paths.length ? urls : [];
}

/**
 * What can be analysed, and it is no longer a dead end.
 *
 * The original file is in storage now, so "thumbs_only" became "recoverable":
 * the full-size frames can be made again by downloading it. The gate itself is
 * unchanged. If the original is gone the answer is "none" and analysis still
 * refuses and still says why. The rule was never "always have full frames" -
 * it was "never analyse a degraded input without saying so".
 */
function framesAvailableFor(clip) {
  if (sessionFrames.has(clip.id)) return "full";
  if (clip.video_path) return "recoverable";
  if ((clip.thumbs?.length || clip.thumb_paths?.length)) return "thumbs_only";
  return "none";
}

function computeFilled(gapId, clips) {
  return clips.filter((c) => c.gap_id_closed === gapId && c.clip_status === "accepted").length;
}

/* ================================================ DERIVED RIGHTS STATUS == */
function deriveRightsStatus(rights) {
  if (!rights?.start_date || !rights.duration || rights.duration === "unknown") return "unknown";
  if (rights.duration === "perpetual") return "active";
  const months = parseInt(rights.duration, 10);
  if (!Number.isFinite(months)) return "unknown";
  const end = new Date(rights.start_date);
  end.setMonth(end.getMonth() + months);
  const days = (end - new Date()) / 86400000;
  if (days < 0) return "expired";
  if (days < 60) return "expiring_60d";
  return "active";
}

/* ================================================= DETERMINISTIC BRIEF === */
function deriveShotList(gaps) {
  const items = [];
  for (const g of gaps) {
    const rooms = g.room_type.length ? g.room_type : ["other_room"];
    const base = Math.floor(g.quantity_needed / rooms.length);
    const extra = g.quantity_needed % rooms.length;
    rooms.forEach((room, i) => {
      const count = base + (i < extra ? 1 : 0);
      if (count <= 0) return;
      const shot = g.shot_size[0] ?? null, aspect = g.aspect[0] ?? null, light = g.lighting[0] ?? null;
      items.push(makeShotItem({
        gap_id: g.id, room_type: room, scene: [...g.scene], shot_size: shot, aspect, lighting: light,
        count, source: "derived", instruction: buildInstruction({ room, scene: g.scene, shot, aspect, light, count }),
      }));
    });
  }
  return items;
}

function buildInstruction({ room, scene, shot, aspect, light, count }) {
  const parts = [`${count} × ${aspect ? label(aspect) : "any aspect"} ${shot ? label(shot).toLowerCase() : "any shot size"} in the ${label(room).toLowerCase()}`];
  if (scene[0]) parts.push(`Primary subject: ${label(scene[0]).toLowerCase()}`);
  if (scene.length > 1) parts.push(`Also useful: ${scene.slice(1).map((s) => label(s).toLowerCase()).join(", ")}`);
  if (light) parts.push(`Lighting: ${label(light).toLowerCase()}`);
  return parts.join(". ") + ".";
}

function briefFingerprint(gaps) {
  return djb2(JSON.stringify(gaps.map((g) => [g.id, g.room_type, g.scene, g.shot_size, g.aspect, g.lighting, g.quantity_needed])));
}

function coverageForGap(gap, shotList) {
  const covered = shotList.filter((s) => s.gap_id === gap.id).reduce((n, s) => n + s.count, 0);
  return { covered, needed: gap.quantity_needed, delta: covered - gap.quantity_needed };
}

function uncoveredChannels(gaps, rights) {
  const wanted = [...new Set(gaps.flatMap((g) => g.intended_channel))];
  return wanted.filter((c) => !rights.channels.includes(c));
}

/** What the branch actually gives up: rooms and how many clips in each. */
function roomSummary(shotList) {
  const map = new Map();
  shotList.forEach((s) => map.set(s.room_type, (map.get(s.room_type) || 0) + s.count));
  return [...map.entries()].map(([room, clips]) => ({ room, clips })).sort((a, b) => b.clips - a.clips);
}

/* ============================================================ VISIT UTIL = */
const openProposal = (collab) => collab.visit_proposals.find((p) => p.status === "pending") ?? null;
const acceptedProposal = (collab) => collab.visit_proposals.find((p) => p.status === "accepted") ?? null;

function visitState(collab) {
  if (acceptedProposal(collab)) return "scheduled";
  if (openProposal(collab)) return "awaiting_branch";
  if (collab.visit_proposals.length) return "needs_new_date";
  return "not_proposed";
}

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "—";

/* ============================================================== SEED ===== */
const dayFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

const SEED_GAPS = [
  { branch_id: ["br_sj"], room_type: ["sauna", "steam_room"], scene: ["ambience_no_people", "detail_texture"], shot_size: ["wide", "medium"], aspect: ["vertical_9_16"], lighting: ["warm_dim_ambient"], quantity_needed: 4, priority: "p0", deadline: dayFromNow(9), intended_channel: ["organic_owned", "paid_social"] },
  { branch_id: ["br_sj", "br_sf"], room_type: ["cold_plunge"], scene: ["water_immersion", "reaction_face"], shot_size: ["medium", "close_up"], aspect: ["vertical_9_16"], lighting: ["clinical_bright"], quantity_needed: 6, priority: "p0", deadline: dayFromNow(4), intended_channel: ["paid_social"] },
  { branch_id: [], room_type: ["treatment_room_facial"], scene: ["product_application", "product_closeup"], shot_size: ["close_up", "extreme_close_up"], aspect: ["vertical_9_16", "square_1_1"], lighting: ["daylight_soft"], quantity_needed: 8, priority: "p1", deadline: dayFromNow(26), intended_channel: ["organic_owned", "website"] },
  { branch_id: [], room_type: ["relaxation_lounge"], scene: ["resting_relaxing", "ambience_no_people"], shot_size: ["wide"], aspect: ["horizontal_16_9"], lighting: ["golden_hour"], quantity_needed: 3, priority: "p2", deadline: "", intended_channel: ["website"] },
  { branch_id: ["br_sm"], room_type: ["reception_lobby", "exterior_entrance"], scene: ["arrival_checkin"], shot_size: ["wide", "medium"], aspect: ["vertical_9_16"], lighting: ["daylight_bright"], quantity_needed: 5, priority: "p1", deadline: dayFromNow(18), intended_channel: ["organic_owned", "in_store"] },
  { branch_id: ["br_scz"], room_type: ["hammam", "salt_room"], scene: ["detail_texture", "heat_exposure"], shot_size: ["extreme_close_up", "close_up"], aspect: ["vertical_9_16"], lighting: ["underlit", "warm_dim_ambient"], quantity_needed: 4, priority: "p1", deadline: dayFromNow(33), intended_channel: ["organic_owned"] },
  { branch_id: ["br_scz", "br_sm"], room_type: ["outdoor_pool_deck"], scene: ["ambience_no_people", "social_conversation"], shot_size: ["extreme_wide", "wide"], aspect: ["horizontal_16_9"], lighting: ["golden_hour"], quantity_needed: 3, priority: "p1", deadline: dayFromNow(45), intended_channel: ["website", "ooh_print"] },
  { branch_id: ["br_atx"], room_type: ["juice_bar"], scene: ["food_beverage", "product_closeup"], shot_size: ["close_up"], aspect: ["vertical_9_16", "square_1_1"], lighting: ["daylight_soft"], quantity_needed: 6, priority: "p2", deadline: "", intended_channel: ["organic_owned"] },
  { branch_id: ["br_atx", "br_sj"], room_type: ["movement_studio", "fitness_studio"], scene: ["movement_fitness"], shot_size: ["wide", "medium"], aspect: ["vertical_9_16"], lighting: ["daylight_bright"], quantity_needed: 5, priority: "p2", deadline: "", intended_channel: ["paid_social"] },
  { branch_id: ["br_sf"], room_type: ["treatment_room_massage"], scene: ["treatment_prep", "staff_at_work"], shot_size: ["medium"], aspect: ["horizontal_16_9"], lighting: ["warm_dim_ambient"], quantity_needed: 2, priority: "p1", deadline: dayFromNow(21), intended_channel: ["website", "third_party_press"] },
  { branch_id: [], room_type: ["hallway_transition"], scene: ["transition_walking", "ambience_no_people"], shot_size: ["wide"], aspect: ["vertical_9_16"], lighting: ["mixed_sources"], quantity_needed: 4, priority: "p2", deadline: "", intended_channel: ["organic_owned"] },
  { branch_id: ["br_sm", "br_sf"], room_type: ["retail_shop"], scene: ["product_closeup", "detail_texture"], shot_size: ["close_up", "extreme_close_up"], aspect: ["square_1_1"], lighting: ["clinical_bright"], quantity_needed: 10, priority: "p1", deadline: dayFromNow(12), intended_channel: ["email", "website"] },
];

const SEED_CREATORS = [
  { email: "maya@okonkwo.studio", phone: "+14085550142", links: [{ platform: "instagram", url: "https://instagram.com/mayaok" }, { platform: "tiktok", url: "https://tiktok.com/@mayaok" }], platform_stats: [{ platform: "instagram", followers: 128000, engagement: "4.1%" }, { platform: "tiktok", followers: 64000, engagement: "6.8%" }], coverage_note: "Bay Area, and will drive to Sacramento for a full day.", style_note: "Quiet and unhurried. Long holds, natural light, almost no talking over the footage.", camera: "Sony A7C II", brings_lighting: "yes", works_with: "alone", photo: "p0", display_name: "Maya Okonkwo", handle: "@mayaok", home_metro: "bay_area", creator_vertical: ["wellness_selfcare", "beauty_skincare"], audience_geo: ["bay_area", "us_national"], format_strength: ["vertical_shortform", "voiceover_narrative"] },
  { email: "dane@ferreira.co", phone: "+14155550188", links: [{ platform: "instagram", url: "https://instagram.com/daneferreira" }], platform_stats: [{ platform: "instagram", followers: 54000, engagement: "3.2%" }], coverage_note: "San Francisco and the peninsula.", style_note: "Fast and bright. Cuts on movement, lots of hands and product.", camera: "iPhone 15 Pro", brings_lighting: "no", works_with: "alone", photo: "p1", display_name: "Dane Ferreira", handle: "@danefer", home_metro: "bay_area", creator_vertical: ["fitness_movement"], audience_geo: ["bay_area"], format_strength: ["vertical_shortform", "live_realtime"] },
  { email: "priya@ramanmedia.com", phone: "+13105550177", links: [{ platform: "instagram", url: "https://instagram.com/priyaraman" }, { platform: "youtube", url: "https://youtube.com/@priyaraman" }], platform_stats: [{ platform: "instagram", followers: 212000, engagement: "2.8%" }, { platform: "youtube", followers: 89000, engagement: "5.4%" }], coverage_note: "Los Angeles and Orange County.", style_note: "Warm and talkative. Strong to camera, good at explaining a treatment while it happens.", camera: "Canon R6", brings_lighting: "yes", works_with: "with_crew", photo: "p2", display_name: "Priya Raman", handle: "@priyaraman", home_metro: "sacramento", creator_vertical: ["lifestyle_general", "local_city_guide"], audience_geo: ["sacramento", "bay_area"], format_strength: ["talking_head", "horizontal_longform"] },
  { email: "colette@weiss.photo", phone: "+16195550119", links: [{ platform: "instagram", url: "https://instagram.com/coletteweiss" }], platform_stats: [{ platform: "instagram", followers: 38000, engagement: "5.9%" }], coverage_note: "San Diego. Travels for two days or more.", style_note: "Editorial and still. Almost photographic, very little camera movement.", camera: "Fujifilm X-T5", brings_lighting: "yes", works_with: "alone", photo: "p3", display_name: "Colette Weiss", handle: "@coletteweiss", home_metro: "los_angeles", creator_vertical: ["luxury", "travel_hospitality"], audience_geo: ["us_national", "international"], format_strength: ["silent_ambient", "horizontal_longform"] },
  { email: "tobi@alarcon.tv", phone: "+15125550164", links: [{ platform: "tiktok", url: "https://tiktok.com/@tobialarcon" }], platform_stats: [{ platform: "tiktok", followers: 340000, engagement: "7.2%" }], coverage_note: "Austin and San Antonio.", style_note: "Playful, quick cuts, talks to the camera the whole way through.", camera: "iPhone 15 Pro Max", brings_lighting: "no", works_with: "alone", photo: "p4", display_name: "Tobi Alarcón", handle: "@tobialarcon", home_metro: "san_diego", creator_vertical: ["food_beverage", "lifestyle_general"], audience_geo: ["san_diego", "los_angeles"], format_strength: ["vertical_shortform", "stills_only"] },
  { email: "reese@nakamura.studio", phone: "+12065550153", links: [{ platform: "instagram", url: "https://instagram.com/reesenakamura" }, { platform: "website", url: "https://nakamura.studio" }], platform_stats: [{ platform: "instagram", followers: 71000, engagement: "3.7%" }], coverage_note: "Seattle and Portland.", style_note: "Cool and clean. Symmetrical framing, room tone, no music.", camera: "Sony FX30", brings_lighting: "yes", works_with: "with_crew", photo: "p5", display_name: "Reese Nakamura", handle: "@reesenak", home_metro: "austin", creator_vertical: ["wellness_selfcare", "parenting_family"], audience_geo: ["austin", "us_national"], format_strength: ["talking_head", "voiceover_narrative"] },
  { email: "jonah@brightfilms.co", phone: "+16025550131", links: [{ platform: "instagram", url: "https://instagram.com/jonahbright" }], platform_stats: [{ platform: "instagram", followers: 46000, engagement: "4.4%" }], coverage_note: "Phoenix and Tucson.", style_note: "Golden hour and open air. Best outdoors, weaker in dim rooms.", camera: "Sony A7 IV", brings_lighting: "no", works_with: "alone", photo: "p6", display_name: "Jonah Bright", handle: "@jonahbright", home_metro: "phoenix", creator_vertical: ["fitness_movement", "wellness_selfcare"], audience_geo: ["phoenix", "tucson"], format_strength: ["vertical_shortform"] },
  { email: "ingrid@sollberg.se", phone: "+13035550196", links: [{ platform: "instagram", url: "https://instagram.com/ingridsollberg" }, { platform: "youtube", url: "https://youtube.com/@ingridsollberg" }], platform_stats: [{ platform: "instagram", followers: 95000, engagement: "4.9%" }, { platform: "youtube", followers: 22000, engagement: "6.1%" }], coverage_note: "Denver. Will fly for a multi-day shoot.", style_note: "Nordic and spare. Cold plunges, steam, texture. Very little face.", camera: "Canon R5", brings_lighting: "yes", works_with: "alone", photo: "p7", display_name: "Ingrid Sollberg", handle: "@ingridsollberg", home_metro: "new_york", creator_vertical: ["beauty_skincare", "luxury"], audience_geo: ["new_york", "international"], format_strength: ["stills_only", "silent_ambient"] },
  { email: "marcus@ilo.nyc", phone: "+19175550108", links: [{ platform: "instagram", url: "https://instagram.com/marcusilo" }, { platform: "tiktok", url: "https://tiktok.com/@marcusilo" }], platform_stats: [{ platform: "instagram", followers: 158000, engagement: "3.1%" }, { platform: "tiktok", followers: 210000, engagement: "5.5%" }], coverage_note: "New York, and Miami a few times a year.", style_note: "Loud and social. Groups, reactions, people talking to each other.", camera: "iPhone 15 Pro", brings_lighting: "no", works_with: "with_crew", photo: "p8", display_name: "Marcus Ilo", handle: "@marcusilo", home_metro: "bay_area", creator_vertical: ["travel_hospitality"], audience_geo: ["us_national"], format_strength: ["horizontal_longform"] },
];

/* ==================================================== WORKED EXAMPLE ==== */
/**
 * A shortcut into the middle of the product, built from data that already
 * exists. It makes no model call.
 *
 * It exists because of something the build itself exposed: reaching the one
 * action this product is really about took seven screens and two API calls.
 * That is a finding, not just a demo problem. A real coordinator on her first
 * morning needs a way in too.
 */
/**
 * Enough sample work that no stage opens on an empty page.
 *
 * Three collabs at three different points in the flow: one still a draft, one
 * approved and waiting on a branch, one visited. Between them, Briefs, Visits
 * and Today all have something real to show, and the shape of the product is
 * legible before anyone uploads anything.
 *
 * Clips are not seeded here. A clip without frames is a grey box, and a clip
 * with a description nobody's model produced is the one lie this product does
 * not tell.
 */
function buildSampleCollabs(gaps, creators) {
  const pick = (name) => creators.find((c) => c.display_name.startsWith(name)) ?? creators[0];
  const gapFor = (room) => gaps.find((g) => g.room_type.includes(room) && g.status === "open");
  const out = [];
  const iso = (days) => new Date(Date.now() + days * 86400000).toISOString();
  const day = (days) => iso(days).slice(0, 10);

  // 1. Visited. Its brief is approved and the branch accepted a date.
  const g1 = gapFor("sauna") ?? gaps[0];
  const c1 = pick("Maya");
  if (g1 && c1) {
    const shots = deriveShotList([g1]);
    out.push(makeCollab({
      creator_id: c1.id, branch_id: g1.branch_id[0] ?? BRANCHES[0].id, gap_ids: [g1.id],
      stage: "intake", created_by: "Sample data",
      brief_shot_list: shots, brief_fingerprint: briefFingerprint(shots),
      brief_approved_by: "Sample data", brief_approved_at: iso(-6),
      rights: makeRights({ channels: ["organic_owned", "paid_social"], territory: "us_only",
        duration: "12m", agreement_form: "email_confirmation", entered_by: "Sample data", entered_at: iso(-7) }),
      visit_proposals: [
        makeVisitProposal({ date: day(-4), time_of_day: "morning", duration: "90m",
          note: "She brings her own lighting, no staff needed.", status: "accepted",
          proposed_by: "Sample data", proposed_at: iso(-7), responded_by: "Sample data (branch)", responded_at: iso(-6),
          room_snapshot: g1.room_type }),
      ],
    }));
  }

  // 2. Approved, and the branch has not answered yet.
  const g2 = gapFor("cold_plunge") ?? gaps[1];
  const c2 = pick("Ingrid");
  if (g2 && c2) {
    const shots = deriveShotList([g2]);
    out.push(makeCollab({
      creator_id: c2.id, branch_id: g2.branch_id[0] ?? BRANCHES[0].id, gap_ids: [g2.id],
      stage: "visit", created_by: "Sample data",
      brief_shot_list: shots, brief_fingerprint: briefFingerprint(shots),
      brief_approved_by: "Sample data", brief_approved_at: iso(-2),
      rights: makeRights({ channels: ["organic_owned"], territory: "single_branch", duration: "6m",
        agreement_form: "dm_confirmation", entered_by: "Sample data", entered_at: iso(-2) }),
      visit_proposals: [
        makeVisitProposal({ date: day(3), time_of_day: "afternoon", duration: "60m",
          status: "declined", decline_reason: "fully_booked", decline_note: "Both plunge pools are booked all afternoon.",
          proposed_by: "Sample data", proposed_at: iso(-2), responded_by: "Sample data (branch)", responded_at: iso(-1),
          room_snapshot: g2.room_type }),
        makeVisitProposal({ date: day(6), time_of_day: "morning", duration: "60m",
          status: "pending", proposed_by: "Sample data", proposed_at: iso(-1), room_snapshot: g2.room_type }),
      ],
    }));
  }

  // 3. Still a draft, so the Briefs screen has something to approve.
  const g3 = gapFor("treatment_room_facial") ?? gapFor("relaxation_lounge") ?? gaps[2];
  const c3 = pick("Priya");
  if (g3 && c3) {
    const shots = deriveShotList([g3]);
    out.push(makeCollab({
      creator_id: c3.id, branch_id: g3.branch_id[0] ?? BRANCHES[0].id, gap_ids: [g3.id],
      stage: "brief", created_by: "Sample data",
      brief_shot_list: shots, brief_fingerprint: briefFingerprint(shots),
    }));
  }

  return out;
}

/**
 * The clips that fill the library and the intake screen.
 *
 * Each one carries everything a person or the code can know without a model:
 * its frames, which branch and visit it came from, the rights that came with
 * the collab, and the gap it was shot for. The fields the model fills are
 * empty, and the screens say "not read yet" rather than inventing a sentence.
 *
 * That is also what makes the demo worth watching: the library arrives full
 * and unread, and one press of Read them turns twenty filenames into twenty
 * descriptions while you watch.
 */
function buildSampleClips(gaps, creators, collabs) {
  const rooms = Object.keys(SAMPLE_FRAMES);
  const visited = collabs.find((c) => (c.visit_proposals ?? []).some((p) => p.status === "accepted"));
  const iso = (d) => new Date(Date.now() + d * 86400000).toISOString();
  const out = [];

  const make = (opts) => makeClip({
    branch_id: opts.branch, collab_id: opts.collab, filename: opts.filename,
    thumbs: opts.frames, frame_count: opts.frames.length,
    clip_status: opts.status, created_at: opts.at,
    accepted_by: opts.status === "accepted" ? "Sample data" : null,
    accepted_at: opts.status === "accepted" ? opts.at : null,
    gap_id_closed: opts.gap ?? null,
    system: {
      duration: opts.duration, width: 1080, height: 1350,
      aspect_native: "vertical_9_16", duration_bucket: durationBucket(opts.duration),
      capture_source: "phone",
      time_of_day: opts.time ?? null, time_of_day_source: opts.time ? "visit_record" : null,
    },
  });

  // The library: accepted work from visits that already happened.
  let n = 0;
  rooms.forEach((room, ri) => {
    const gap = gaps.find((g) => g.room_type.includes(room));
    SAMPLE_FRAMES[room].forEach((frames, ci) => {
      if (n >= 20) return;
      n += 1;
      out.push(make({
        branch: gap?.branch_id?.[0] ?? BRANCHES[ri % BRANCHES.length].id,
        collab: visited?.id ?? null,
        filename: `IMG_${4300 + n}.mov`,
        frames, status: "accepted", gap: gap?.id ?? null,
        at: iso(-30 + n), duration: 6 + ((n * 3) % 22),
        time: ["morning", "afternoon", "midday"][ci % 3],
      }));
    });
  });

  // The intake screen: what came back from the visit that just happened, not
  // yet read, which is the state this screen exists to move things out of.
  if (visited) {
    const accepted = (visited.visit_proposals ?? []).find((p) => p.status === "accepted");
    const brief = visited.brief_shot_list ?? [];
    const roomsAsked = [...new Set(brief.map((b) => b.room_type))].filter((r) => SAMPLE_FRAMES[r]);
    const pool = roomsAsked.length ? roomsAsked : ["sauna", "steam_room"];
    pool.forEach((room, i) => {
      (SAMPLE_FRAMES[room] ?? []).slice(0, 3).forEach((frames, j) => {
        out.push(make({
          branch: visited.branch_id, collab: visited.id,
          filename: `IMG_${4471 + i * 3 + j}.mov`,
          frames, status: "uploaded", gap: null,
          at: iso(-1), duration: 5 + ((i * 4 + j * 3) % 20),
          time: accepted?.time_of_day ?? null,
        }));
      });
    });
  }

  return out;
}

function buildWorkedExample(gaps, creators) {
  const gap = gaps.find((g) => g.branch_id.includes("br_sj") && g.room_type.includes("sauna")) ?? gaps[0];
  const creator = creators.find((c) => c.home_metro === "bay_area" && c.creator_vertical.includes("wellness_selfcare")) ?? creators[0];
  if (!gap || !creator) return null;

  const by = "Sample data";
  const start = new Date().toISOString().slice(0, 10);
  const rights = makeRights({
    channels: [...gap.intended_channel],
    territory: "us_only", duration: "12m", start_date: start,
    exclusivity: "non_exclusive", credit_required: "handle_on_screen",
    edit_permission: "full_recut", music_rights: "replace_required",
    releases_on_file: "creator_only", agreement_form: "email_confirmation",
    consideration: "visit_only", entered_by: by, entered_at: now(),
  });

  const collab = makeCollab({
    creator_id: creator.id, branch_id: "br_sj", gap_ids: [gap.id], created_by: by,
    brief_shot_list: deriveShotList([gap]), brief_fingerprint: briefFingerprint([gap]),
    brief_approved_by: by, brief_approved_at: now(), rights, stage: "intake",
  });

  const d = new Date(); d.setDate(d.getDate() + 3);
  collab.visit_proposals = [makeVisitProposal({
    date: d.toISOString().slice(0, 10), time_of_day: "morning", duration: "90m",
    note: "She brings her own lighting, no staff needed.",
    proposed_by: by, proposed_at: now(),
    status: "accepted", responded_by: "Sample data (branch)", responded_at: now(),
    brief_snapshot_fingerprint: collab.brief_fingerprint,
    room_snapshot: roomSummary(collab.brief_shot_list),
  })];
  return collab;
}

/* ============================================================ STORAGE ==== */
/**
 * Everything below used to be a key-value store that answered instantly and
 * could not fail. It is now a database across a network. The screens above did
 * not change: they still hand a whole array to a setter. What changed is that
 * the setter now diffs, writes, waits, and puts the old array back if the
 * write was refused - so nothing on screen ever claims to be saved when it is
 * not.
 */

async function saveClipRecord(clip) {
  const { privacy_flags, thumbs, ...row } = clip;
  const existing = await clipsRepo.patch(clip.id, row);
  if (existing.ok && Array.isArray(existing.data) && existing.data.length) return existing;
  return clipsRepo.create(clip, privacy_flags ?? []);
}

async function deleteClipEverywhere(clip) {
  sessionFrames.delete(clip.id);
  const files = await deleteClipFiles(clip.id, clip.video_path, clip.thumb_paths);
  const row = await clipsRepo.destroy(clip.id);
  return row.ok ? files : row;
}


/* ========================================================= UI PRIMITIVES = */
/* ========================================================= UI PRIMITIVES = */
/**
 * One small stylesheet. Tokens and nothing else.
 *
 * What was here before re-pointed a hundred and twenty Tailwind utilities at
 * custom properties with !important - ninety-one of them. That is why every
 * redesign lost: any new styling written against those classes was overruled
 * by a rule it could not see. The layer is gone and it does not come back.
 * Screens now style themselves with ordinary values.
 */
const inputCls = "cc-input";

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500&display=swap');

:root {
  --page:         #FAF9F7;
  --surface:      #FFFFFF;
  --hairline:     #E7E5E4;
  --hairline-2:   #D6D3D1;
  --text:         #1C1917;
  --text-body:    #44403C;
  --text-meta:    #78716C;
  --accent:       #0F766E;
  --accent-hover: #115E59;
  --accent-tint:  #F0FAF8;
  --model:        #7C3AED;
  --model-tint:   #F5F3FF;
  --model-ring:   #C4B5FD;
  --model-text:   #5B21B6;
  --blocked:      #E11D48;
  --blocked-tint: #FFF1F2;
  --blocked-text: #9F1239;
  --warn:         #D97706;
  --warn-tint:    #FFFBEB;
  --warn-text:    #92400E;
  --on-dark:      #FAFAF9;
}

/* Dark.
 *
 * The same tokens, re-pointed. No screen knows this exists: screens name
 * meanings - surface, hairline, blocked - and the meanings move together.
 *
 * What does NOT move is which colour means what. Rose is still the privacy
 * block, violet is still the model, amber is still a deadline. Somebody who
 * learned that in daylight should not have to learn it again at night. */
[data-theme="dark"] {
  --page:         #171614;
  --surface:      #201E1B;
  --hairline:     #322F2B;
  --hairline-2:   #46423C;
  --text:         #F5F4F1;
  --text-body:    #D6D3D1;
  --text-meta:    #A8A29E;
  --accent:       #2DD4BF;
  --accent-hover: #5EEAD4;
  --accent-tint:  #133029;
  --model:        #A78BFA;
  --model-tint:   #241C3B;
  --model-ring:   #6D28D9;
  --model-text:   #C4B5FD;
  --blocked:      #FB7185;
  --blocked-tint: #3B1620;
  --blocked-text: #FDA4AF;
  --warn:         #FBBF24;
  --warn-tint:    #33240C;
  --warn-text:    #FCD34D;
  --on-dark:      #171614;
}

body { background: #FAF9F7; background: var(--page);
  color: #1C1917; color: var(--text);
  font-family: 'Inter Tight', ui-sans-serif, system-ui, sans-serif; }

.cc-num { font-variant-numeric: tabular-nums lining-nums; }
.cc-lift { transition: box-shadow 150ms, transform 150ms; }
.cc-lift:hover { box-shadow: 0 0 0 0.5px var(--hairline-2), 0 8px 22px rgba(28,25,23,0.09);
  transform: translateY(-2px); }
.cc-expiring { transition: box-shadow 150ms; }
.cc-expiring:hover { box-shadow: inset 0 0 0 0.5px var(--warn); }
@media (prefers-reduced-motion: reduce) { .cc-lift, .cc-lift:hover { transition:none; transform:none; } }
.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px;
  overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
.cc-nav:hover { background: var(--page) !important; }
.cc-nav[aria-current="page"]:hover { background: var(--text) !important; }

.cc-btn-accent  { background: var(--accent); color: var(--on-dark); border: 0; }
.cc-btn-accent:hover:not(:disabled)  { background: var(--accent-hover); }
.cc-btn-outline { background: var(--surface); color: var(--text); border: 0;
  box-shadow: 0 0 0 0.5px var(--hairline-2); }
.cc-btn-outline:hover:not(:disabled) { box-shadow: 0 0 0 0.5px var(--text-meta); }
.cc-btn-ghost   { background: transparent; color: var(--text-body); border: 0; }
.cc-btn-ghost:hover:not(:disabled)   { background: var(--page); color: var(--text); }
.cc-btn-quiet   { background: var(--model-tint); color: var(--model-text); border: 0;
  box-shadow: inset 0 0 0 0.5px var(--model-ring); }
.cc-btn-quiet:hover:not(:disabled)   { background: var(--model-ring); }
.cc-btn-danger  { background: transparent; color: var(--blocked-text); border: 0; }
.cc-btn-danger:hover:not(:disabled)  { background: var(--blocked-tint); }
.cc-btn-accent, .cc-btn-outline, .cc-btn-ghost, .cc-btn-quiet, .cc-btn-danger {
  cursor: pointer; transition: background 150ms, box-shadow 150ms, color 150ms; }
button:disabled { cursor: not-allowed; }

.cc-input { background: var(--surface); color: var(--text); border: 0; border-radius: 11px;
  padding: 10px 12px; font-size: 14px; font-family: inherit; width: 100%;
  box-shadow: 0 0 0 0.5px var(--hairline-2); }
.cc-input:focus { outline: none; box-shadow: 0 0 0 1.5px var(--accent); }
.cc-input::placeholder { color: var(--text-meta); }
`;

/* ============================================= BRANCH MANAGER (MOBILE) === */
function BranchManagerApp({ collabs, setCollabs, creators, identity, branchId, setBranchId, onSwitchPersona, onEditIdentity }) {
  const [declining, setDeclining] = useState(null);
  const [reason, setReason] = useState(null);
  const [note, setNote] = useState("");
  const [showAnswered, setShowAnswered] = useState(false);

  const mine = collabs.filter((c) => c.branch_id === branchId && c.brief_approved_by);
  const pending = mine.filter((c) => openProposal(c));
  const answered = mine.filter((c) => !openProposal(c) && c.visit_proposals.length);

  const respond = (collab, proposalId, patch) => {
    setCollabs(collabs.map((c) => c.id !== collab.id ? c : {
      ...c, updated_at: now(),
      visit_proposals: c.visit_proposals.map((p) => (p.id === proposalId ? { ...p, ...patch } : p)),
    }));
  };

  const accept = (collab, p) => respond(collab, p.id, {
    status: "accepted", responded_by: identity, responded_at: now(),
    brief_snapshot_fingerprint: collab.brief_fingerprint,
  });

  const confirmDecline = () => {
    const { collab, proposal } = declining;
    respond(collab, proposal.id, {
      status: "declined", responded_by: identity, responded_at: now(),
      decline_reason: reason, decline_note: note.trim(),
    });
    setDeclining(null); setReason(null); setNote("");
  };

  const declineValid = reason && (reason !== "other" || note.trim().length >= 5);

  return (
    <div style={{ minHeight: "100vh", background: "var(--page)" }}>
      <div className="max-w-sm mx-auto min-h-screen" style={{ background: "var(--page)" }}>
        <header className="bg-white border-b border-slate-200 px-4 py-3 sticky top-0 z-10">
          <div className="flex items-center gap-2 mb-2">
            <Building2 size={18} className="text-slate-500" />
            <span className="text-base font-semibold text-slate-900 flex-1">Branch manager</span>
            <button onClick={onSwitchPersona} className="p-2 -m-2 text-slate-500 cursor-pointer" aria-label="Switch between coordinator and branch manager">
              <ArrowLeftRight size={18} />
            </button>
          </div>
          <SingleSelect options={BRANCHES.map((b) => b.id)} value={branchId} onChange={(v) => setBranchId(v || BRANCHES[0].id)}
            placeholder="Choose your branch" labelFn={(id) => branchById(id)?.name ?? id}
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-base bg-white text-slate-900" />
          <button onClick={onEditIdentity} className="text-xs text-slate-500 mt-2 flex items-center gap-1">
            Answering as <span className="text-slate-700 font-medium">{identity}</span> <PenLine size={10} />
          </button>
        </header>

        <div className="px-4 py-3 bg-amber-50 border-b border-amber-200">
          <p className="text-xs text-amber-900 leading-relaxed">
            This is a mode, not a login. Nothing stops anyone switching between it and the coordinator view.
            In a real version this would be a role.
          </p>
        </div>

        <main className="px-4 py-5 pb-16">
          <h2 className="text-lg font-semibold text-slate-900 mb-3">
            {pending.length === 0 ? "Nothing to answer" : `${pending.length} to answer`}
          </h2>

          {pending.length === 0 && (
            <div className="border border-dashed border-slate-300 rounded-xl bg-white py-10 px-5 text-center">
              <CalendarCheck size={22} className="mx-auto text-slate-500 mb-2" />
              <p className="text-sm text-slate-500 leading-relaxed">
                When the marketing team asks for a shoot date at {branchById(branchId)?.name}, it lands here.
              </p>
            </div>
          )}

          <div className="space-y-4">
            {pending.map((c) => {
              const p = openProposal(c);
              const creator = creators.find((x) => x.id === c.creator_id);
              const rooms = roomSummary(c.brief_shot_list);
              return (
                <article key={c.id} className="border border-slate-200 rounded-xl bg-white overflow-hidden">
                  <div className="px-4 py-4">
                    <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Content creator visit</div>
                    <h3 className="text-xl font-semibold text-slate-900 leading-tight">{creator?.display_name}</h3>

                    <div className="mt-4 flex items-baseline gap-2 flex-wrap">
                      <span className="text-lg font-semibold text-slate-900">{fmtDate(p.date)}</span>
                      <span className="text-base text-slate-600">{label(p.time_of_day)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
                      <Clock size={14} /> About {label(p.duration).toLowerCase()}
                    </div>

                    <div className="mt-4 border-t border-slate-100 pt-3">
                      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Rooms needed</div>
                      <ul className="space-y-2">
                        {rooms.map((r) => (
                          <li key={r.room} className="flex items-center gap-3">
                            <span className="text-base text-slate-800 flex-1">{label(r.room)}</span>
                            <span className="text-sm text-slate-500">{r.clips} clip{r.clips === 1 ? "" : "s"}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {p.note && (
                      <p className="mt-3 text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 leading-relaxed">
                        {p.note}
                      </p>
                    )}
                    <p className="mt-3 text-xs text-slate-500">Asked by {p.proposed_by}</p>
                  </div>

                  <div className="px-4 pb-4 space-y-2">
                    <Button variant="accept" size="lg" className="w-full" onClick={() => accept(c, p)}>
                      <Check size={18} /> Yes, that works
                    </Button>
                    <Button variant="outline" size="lg" className="w-full"
                      onClick={() => { setDeclining({ collab: c, proposal: p }); setReason(null); setNote(""); }}>
                      Can't do that day
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>

          {answered.length > 0 && (
            <div className="mt-8">
              <button onClick={() => setShowAnswered(!showAnswered)}
                className="w-full text-left flex items-center gap-2 py-3 text-sm font-medium text-slate-600">
                <span className="flex-1">Already answered ({answered.length})</span>
                <ChevronRight size={16} className={`text-slate-500 ${showAnswered ? "rotate-90" : ""}`} />
              </button>
              {showAnswered && (
                <div className="space-y-3">
                  {answered.map((c) => {
                    const creator = creators.find((x) => x.id === c.creator_id);
                    const last = c.visit_proposals[c.visit_proposals.length - 1];
                    const acc = acceptedProposal(c);
                    const show = acc ?? last;
                    return (
                      <div key={c.id} className={`border rounded-xl px-4 py-3 ${acc ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}>
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-base font-medium text-slate-900">{creator?.display_name}</span>
                          <Chip tone={acc ? "emerald" : "slate"}>{label(show.status)}</Chip>
                        </div>
                        <div className="text-sm text-slate-600">{fmtDate(show.date)} · {label(show.time_of_day)}</div>
                        {show.status === "declined" && (
                          <div className="text-xs text-slate-500 mt-1">Reason: {label(show.decline_reason)}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      <Sheet open={!!declining} title="What's in the way?" onClose={() => setDeclining(null)}>
        <p className="text-sm text-slate-600 leading-relaxed mb-4">
          Pick the closest one. The marketing team needs to know what to try next, and a reason they can count
          is worth more than a sentence they have to interpret.
        </p>
        <div className="space-y-2 mb-4">
          {VISIT_DECLINE_REASON.map((r) => (
            <button key={r} onClick={() => setReason(r)}
              className={`w-full text-left px-4 py-3.5 rounded-xl border text-base font-medium transition-colors ${
                reason === r ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-800"}`}>
              {label(r)}
            </button>
          ))}
        </div>
        {reason && (
          <div className="mb-4">
            <label className="text-xs font-semibold text-slate-800 uppercase tracking-wider block mb-1.5">
              {reason === "other" ? "Tell them what it is" : "Anything to add?"}
              {reason === "other" && <span className="text-rose-600 ml-0.5">*</span>}
            </label>
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-base"
              placeholder={reason === "other" ? "Renovation in that wing all week." : "Optional"} />
          </div>
        )}
        <Button variant="primary" size="lg" className="w-full" disabled={!declineValid} onClick={confirmDecline}>
          Send it back
        </Button>
        <p className="text-xs text-slate-500 mt-3 text-center">Signed as {identity}</p>
      </Sheet>
    </div>
  );
}

/* ======================================================== INTAKE (STAGE 5) */

/** Average hash of one thumbnail, for near-duplicate detection in code. */
function imageHash(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = 8; c.height = 8;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, 8, 8);
      const d = ctx.getImageData(0, 0, 8, 8).data;
      const grey = [];
      for (let i = 0; i < d.length; i += 4) grey.push((d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000);
      const avg = grey.reduce((a, b) => a + b, 0) / grey.length;
      resolve(grey.map((g) => (g > avg ? 1 : 0)));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
const hamming = (a, b) => a.reduce((n, v, i) => n + (v === b[i] ? 0 : 1), 0);

function clipPrivacyState(clip) {
  // Same reason as privacyBlocks: a library row has no flags column, and a
  // screen must not fall over on the shape it is actually handed.
  const flags = clip.privacy_flags ?? [];
  const outstanding = privacyBlocks(flags);
  const unresolvedReason = !!clip.privacy_reason && !clip.privacy_manual_review;
  if (outstanding || unresolvedReason) {
    return {
      blocked: true,
      label: flags.length ? "needs review" : "unreviewed",
      reason: unresolvedReason ? clip.privacy_reason : `${flags.filter((f) => f.status !== "cleared" && f.status !== "release_on_file").length} flag(s) still open.`,
    };
  }
  return { blocked: false, label: flags.length ? "cleared" : "clear", reason: null };
}

function FieldRow({ name, field, planned }) {
  if (!field) return null;
  const bad = field.status && !["ok", "partial"].includes(field.status);
  const val = Array.isArray(field.value) ? (field.value.map(label).join(" · ") || "—") : (field.value ? label(field.value) : "—");
  const conf = field.confidence;
  return (
    <div className="flex items-baseline gap-2 py-1 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-500 w-32 shrink-0">{name}</span>
      <span className={`text-xs flex-1 ${bad ? "text-rose-600" : field.value === "indeterminate" ? "text-slate-500 italic" : "text-slate-900"}`}>
        {bad ? "—" : val}
      </span>
      {planned && <span className="text-xs text-blue-600">The visit says {label(planned).toLowerCase()}</span>}
      {conf && (
        <span className={`text-xs ${conf === "high" ? "text-slate-500" : conf === "medium" ? "text-amber-600" : "text-rose-600"}`}>{CONFIDENCE_LABEL[conf] ?? conf}</span>
      )}
      {bad && <span className="text-xs text-rose-600">{label(field.status)}</span>}
    </div>
  );
}

function PrivacyFlagRow({ flag, thumbs, onResolve, disabled, identity }) {
  const [open, setOpen] = useState(false);
  const resolved = flag.status !== "unreviewed";
  const tone = flag.status === "cleared" || flag.status === "release_on_file" ? "emerald"
    : flag.status === "blocked" ? "rose" : flag.status === "release_required" ? "amber" : "slate";
  return (
    <div className={`border rounded-md px-3 py-2 ${resolved ? "border-slate-200 bg-white" : "border-rose-200 bg-rose-50"}`}>
      <div className="flex items-start gap-2 flex-wrap">
        <Chip tone={resolved ? tone : "rose"}>{label(flag.flag)}</Chip>
        <Chip tone={flag.confidence === "low" ? "amber" : "slate"}>{CONFIDENCE_LABEL[flag.confidence]}</Chip>
        {flag.frame_index !== null && thumbs[flag.frame_index] && (
          <button onClick={() => setOpen(!open)} className="text-xs text-blue-700 inline-flex items-center gap-1">
            <Eye size={11} /> frame {flag.frame_index}
          </button>
        )}
        <span className="flex-1" />
        {resolved && <Signature by={flag.resolved_by} at={flag.resolved_at} verb={flag.status} />}
      </div>
      {flag.flag === "possible_unverified_person" && (
        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
          A person is in frame with no identified release on file. Human clearance required.
        </p>
      )}
      {flag.note && <p className="text-xs text-slate-600 mt-1">{flag.note}</p>}
      {open && thumbs[flag.frame_index] && (
        <img src={thumbs[flag.frame_index]} alt={`Frame ${flag.frame_index}`} className="mt-2 rounded border border-slate-200 max-w-full" />
      )}
      {!disabled && (
        <div className="flex flex-wrap gap-1 mt-2">
          {PRIVACY_STATUS.filter((s) => s !== "unreviewed").map((s) => (
            <button key={s} onClick={() => onResolve(s)}
              className={`text-xs px-2.5 py-1.5 rounded border cursor-pointer ${flag.status === s ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-300 text-slate-700 hover:bg-slate-50"}`}>
              {label(s)}
            </button>
          ))}
        </div>
      )}
      {!disabled && <p className="text-sm text-slate-600 mt-1.5">Signed as {identity}. Only a person can clear this.</p>}
    </div>
  );
}

function HandDescribeDrawer({ open, clip, onClose, onSave, identity }) {
  const [room, setRoom] = useState(null);
  const [scene, setScene] = useState([]);
  const [shot, setShot] = useState(null);
  useEffect(() => {
    if (!open || !clip) return;
    setRoom(clip.ai?.room_type?.value ?? null);
    setScene(clip.ai?.scene?.value ?? []);
    setShot(clip.ai?.shot_size?.value ?? null);
  }, [open, clip?.id]); // eslint-disable-line
  if (!open || !clip) return null;
  return (
    <Drawer open={open} title="Describe by hand" subtitle={clip.filename} onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!room} onClick={() => onSave({ room, scene, shot })}>Save description</Button></>}>
      <div className="mb-5 flex gap-2 items-start border border-slate-200 bg-slate-50 rounded-md px-3 py-2.5">
        <Ruler size={14} className="text-slate-500 shrink-0 mt-0.5" />
        <p className="text-xs text-slate-600 leading-relaxed">
          Anything you set here is recorded as yours, not the model's. The confidence column will read
          "human" and the clip stops being a machine description.
        </p>
      </div>
      <Field label="Room" required><SingleSelect options={ROOM_TYPE} value={room} onChange={setRoom} /></Field>
      <Field label="Scenes" hint="First = primary"><RankedSceneSelect value={scene} onChange={setScene} /></Field>
      <Field label="Shot size"><SingleSelect options={SHOT_SIZE} value={shot} onChange={setShot} placeholder="Not set" /></Field>
      <p className="text-xs text-slate-500">Signed as {identity}.</p>
    </Drawer>
  );
}

/**
 * What went wrong, said only as far as the evidence goes.
 *
 * The first version of this claimed every failure was an iPhone recording
 * format. It had no evidence for that and it sent a whole afternoon looking in
 * the wrong place. This is the same error the product refuses to let the model
 * make, so it is not allowed here either: when the cause is unknown, the text
 * says the cause is unknown and shows the browser's own words.
 */
function readFailureSentence(clip) {
  const f = clip.read_failure;
  if (!f) return "The browser could not open this file.";

  // The sandbox refuses the source outright, before decoding. The format was
  // never examined, so nothing can be concluded about it.
  if (f.kind === "blocked_by_environment") {
    return "This page will not let the browser open local video at all. That is a restriction of where this "
      + "prototype is running, not a problem with your file. Nothing about the file's format was even checked.";
  }
  if (f.kind === "unsupported") {
    const known = f.probe?.canPlayType && f.probe.canPlayType !== "no";
    return known
      ? "The browser recognised this format but refused to load the file. That points at where this prototype "
        + "is running rather than at the file itself."
      : "The browser says it cannot play this format. That is common for video sent straight from an iPhone, "
        + "though the file has not been examined closely enough to be sure.";
  }
  if (f.kind === "network") return "The browser could not read the file's data. Why is not clear from here.";
  if (f.kind === "decode") return "The browser opened the file but could not decode the video inside it. It may be damaged or only partly downloaded.";
  if (f.kind === "timeout") return "The file did not finish opening in time. It may be very large, or the browser may have quietly given up.";
  if (f.kind === "empty_canvas") return "The frames came back blank. This page is not allowed to read pixels out of the video.";
  if (f.kind === "no_dimensions") return "The file opened but reported no picture size, so there was nothing to take a frame from.";
  return f.plain ?? "The browser could not open this file. The log below has the browser's own words for it.";
}

/** Same shape as every other request in here: a person sends it, we record it. */
function resendMessage(clip) {
  return `Hi, one of the clips you sent (${clip.filename}) will not open on our side. `
    + `It is almost certainly the format rather than anything you did.\n\n`
    + `Could you send that one again as an MP4? On an iPhone: Settings, Camera, Formats, choose "Most Compatible" `
    + `and re-share the clip, or share it through a link rather than as a file.\n\n`
    + `Everything else came through fine. Thank you.`;
}

function ClipCard({ clip, shotList, gaps, identity, onPatch, onDelete, onAnalyse, onMakeGap, onSendToLibrary, busy, showTechnical, defaultOpen, thumbUrls = {}, onWatch }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [describing, setDescribing] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectText, setRejectText] = useState("");
  const [resendOpen, setResendOpen] = useState(false);
  const frames = framesAvailableFor(clip);
  const priv = clipPrivacyState(clip);
  const decided = clip.clip_status === "accepted" || clip.clip_status === "rejected";
  const shot = clip.match?.shot_id ? shotList.find((s) => s.id === clip.match.shot_id) : null;
  const gap = clip.match?.gap_id ? gaps.find((g) => g.id === clip.match.gap_id) : null;

  const blockers = [];
  if (priv.blocked) blockers.push(`Privacy: ${priv.reason}`);
  if (!clip.ai?.room_type?.value) blockers.push("Nobody has said what is in this clip. Describe it yourself, or read it again.");
  if (clip.match?.level === "unmatched" && !clip.unmatched_keep) blockers.push("It matches nothing in the brief. Keep it anyway, or turn it into a gap.");

  const resolveFlag = (i, status) => {
    const next = clip.privacy_flags.map((f, idx) => idx === i ? { ...f, status, resolved_by: identity, resolved_at: now() } : f);
    onPatch({ privacy_flags: next });
  };

  const unreadable = clip.clip_status === "unreadable_file";
  const headline = clip.ai?.room_type?.value ? clipSentence(clip)
    : unreadable ? "The browser cannot open this file"
    : clip.clip_status === "requires_human_review" ? "Cannot be read any more"
    : clip.clip_status === "uploaded" ? "Not read yet"
    : clip.clip_status === "analysing" ? "Being read…"
    : clip.clip_status === "analysis_failed" ? "Could not be described"
    : "Not described yet";

  const subline =
    clip.clip_status === "accepted" ? "In the library"
    : clip.clip_status === "rejected" ? clip.reject_reason
    : priv.blocked ? priv.reason
    : unreadable ? readFailureSentence(clip)
    : clip.clip_status === "uploaded" ? "Waiting to be read"
    : clip.match?.level === "unmatched" ? clip.match.mismatches[0]
    : clip.match?.level === "partial" ? clip.match.mismatches.join(", ")
    : clip.match?.level === "full" ? "Matches the brief"
    : null;

  const dot = unreadable ? "var(--warn)"
    : priv.blocked ? "var(--blocked)"
    : clip.clip_status === "accepted" ? "var(--accent)"
    : clip.match?.level === "partial" ? "var(--warn)"
    : clip.match?.level === "unmatched" ? "var(--accent)"
    : clip.clip_status === "uploaded" || clip.clip_status === "analysing" ? "var(--text-meta)"
    : "var(--accent)";

  const topFlag = priv.blocked && clip.privacy_flags[0] ? label(clip.privacy_flags[0].flag) : null;

  return (
    <article className={`border rounded-xl overflow-hidden ${priv.blocked ? "cc-blocked" : "bg-white"} ${
      clip.clip_status === "accepted" ? "border-emerald-200"
      : clip.clip_status === "rejected" ? "border-slate-200 opacity-70"
      : priv.blocked ? "border-rose-200" : "border-slate-200"}`}>

      <button onClick={() => setOpen(!open)} aria-expanded={open}
        className="w-full text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
        <Thumb thumbs={thumbsFor(clip, thumbUrls)} pending={!!clip.thumb_paths?.length && !thumbsFor(clip, thumbUrls).length}
          onPlay={onWatch} alt={`Frames from ${clip.filename}`} muted={clip.clip_status === "rejected"}
          ratio="4/5"
          badge={<>
            <span style={{ position: "absolute", left: 9, bottom: 9, fontSize: 11, color: "#fff",
              background: "rgba(28,25,23,0.62)", borderRadius: 6, padding: "2px 6px" }} className="cc-num">
              {fmtDuration(clip.system?.duration)}
            </span>
            {(() => {
              const [bg, fg, word] =
                topFlag ? ["var(--blocked-tint)", "var(--blocked-text)", topFlag]
                : clip.clip_status === "analysing" ? ["var(--model-tint)", "var(--model-text)", "Reading…"]
                : (clip.quality_flags ?? []).some((f) => f.severity === "blocking") ? ["var(--warn-tint)", "var(--warn-text)", "Problem"]
                : clip.ai ? ["var(--model-tint)", "var(--model-text)", "Read"]
                : ["rgba(255,255,255,0.9)", "var(--text-body)", "Not read"];
              return (
                <span style={{ position: "absolute", right: 9, top: 9, fontSize: 11, color: fg,
                  background: bg, borderRadius: 6, padding: "2px 7px" }}>{word}</span>
              );
            })()}
          </>} />
        <div className="px-3 py-2.5">
          <p className="text-sm text-slate-900 leading-snug">{headline}</p>
          {subline && (
            <div className="flex items-start gap-1.5 mt-1.5">
              <span className="cc-dot mt-1.5" style={{ background: dot }} aria-hidden="true" />
              <span className={`text-xs leading-relaxed ${priv.blocked ? "text-rose-700" : "text-slate-600"}`}>{subline}</span>
            </div>
          )}
        </div>
      </button>

      <div className="px-3 pb-2.5 flex items-center gap-1.5 flex-wrap">
        {["uploaded", "analysis_failed", "requires_human_review"].includes(clip.clip_status) && (
          <Button size="sm" variant="outline" onClick={onAnalyse} disabled={busy}>
            {busy ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Sparkles size={12} aria-hidden="true" />} Read it
          </Button>
        )}
        {!decided && !blockers.length && clip.ai && (
          <Button size="sm" variant="primary" onClick={() => onSendToLibrary(clip)} disabled={busy}>
            <Check size={12} aria-hidden="true" /> Send to the library
          </Button>
        )}
        {priv.blocked && <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Review it</Button>}
        {unreadable && (
          <>
            <Button size="sm" variant="primary" onClick={() => setDescribing(true)}>Describe it</Button>
            {clip.read_failure?.kind !== "blocked_by_environment" && (
              <Button size="sm" variant="outline" onClick={() => setResendOpen(true)}>Ask her to resend</Button>
            )}
          </>
        )}
        <span className="flex-1" />
        <button onClick={() => setOpen(!open)} aria-label={open ? "Hide details" : "Show details"}
          className="text-xs text-slate-500 hover:text-slate-900 cursor-pointer">{open ? "Less" : "Details"}</button>
      </div>

      {clip.blocked_reason && !open && (
        <p className="px-3 pb-3 text-xs text-amber-800 leading-relaxed">{clip.blocked_reason}</p>
      )}

      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-slate-100 pt-3">
          {unreadable && (
            <div className="border border-amber-200 bg-amber-50 rounded-lg px-3 py-3">
              <p className="text-sm text-amber-900 leading-relaxed">{readFailureSentence(clip)}</p>
              <p className="text-sm text-amber-900 leading-relaxed mt-2">
                {clip.read_failure?.kind === "blocked_by_environment"
                  ? "The file is still here, and asking her for another copy would not help, because no video "
                    + "can be opened here. Write down what is in it yourself."
                  : "The file is still here. You can write down what is in it yourself, or ask her to send it "
                    + "again in a format the browser can open."}
              </p>
              {clip.resend_request?.status !== "none" && (
                <p className="text-sm text-amber-900 mt-2">
                  <Signature by={clip.resend_request.asked_by} at={clip.resend_request.asked_at} verb="asked by" />
                </p>
              )}
              {clip.read_failure?.steps?.length > 0 && (
                <details className="mt-2">
                  <summary className="text-sm font-medium text-amber-900 cursor-pointer">The technical log for this file</summary>
                  <textarea readOnly rows={8} value={clip.read_failure.steps.join("\n")}
                    className="w-full cc-mono text-xs p-2 rounded-lg mt-2" style={{ border: "0.5px solid var(--hairline-2)" }} />
                </details>
              )}
            </div>
          )}
          <div className="border border-slate-200 rounded-md">
            <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
              <SourceBadge source={clip.corrected_by ? "computed" : "model"} />
              <span className="text-xs font-semibold text-slate-800 flex-1">Description</span>
              <Button size="sm" variant="ghost" onClick={() => setDescribing(true)} disabled={decided}>
                <PenLine size={11} /> By hand
              </Button>
            </div>
            <div className="px-3 py-2">
              {clip.ai ? (
                <>
                  <FieldRow name="Room" field={clip.ai.room_type} />
                  <FieldRow name="What is happening" field={clip.ai.scene} />
                  <FieldRow name="Shot size" field={clip.ai.shot_size} />
                  <FieldRow name="Camera" field={clip.ai.camera_motion} />
                  <FieldRow name="Lighting" field={clip.ai.lighting_condition} />
                  <FieldRow name="Colour" field={clip.ai.color_cast} />
                  <FieldRow name="Crops to vertical" field={clip.ai.reframe_safe_9_16} />
                  <FieldRow name="Sound" field={clip.ai.audio_state} />
                  <FieldRow name="Time of day" field={clip.ai.time_of_day} planned={clip.system.time_of_day} />
                  <div className="flex items-baseline gap-2 py-1 border-t border-slate-100 mt-1">
                    <span className="text-xs text-slate-500 w-32 shrink-0">Shape</span>
                    <span className="text-xs text-slate-900 flex-1">{label(clip.system.aspect_native)}</span>
                    <span className="text-xs text-slate-500">from the file</span>
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-500 italic py-2">Not analysed yet.</p>
              )}
            </div>
          </div>

          {clip.overconfidence.length > 0 && (
            <div className="border border-violet-200 bg-violet-50 rounded-md px-3 py-2.5">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles size={12} className="text-violet-700" />
                <span className="text-xs font-semibold text-violet-900">Overconfidence caught</span>
              </div>
              {clip.overconfidence.map((o, i) => <p key={i} className="text-xs text-violet-900 leading-relaxed">{o.detail}</p>)}
            </div>
          )}

          {clip.quality_flags.length > 0 && (
            <div className="border border-slate-200 rounded-md px-3 py-2.5">
              <div className="text-xs font-semibold text-slate-800 mb-2">Quality</div>
              <div className="flex flex-wrap gap-1">
                {clip.quality_flags.map((f) => (
                  <Chip key={f.flag} tone={f.severity === "blocking" ? "rose" : f.severity === "fixable_in_post" ? "amber" : "slate"}>
                    {label(f.flag)} · {label(f.severity)} · {CONFIDENCE_LABEL[f.confidence]}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          <div className={`border rounded-md px-3 py-2.5 ${priv.blocked ? "border-rose-200 bg-rose-50" : "border-slate-200"}`}>
            <div className="flex items-center gap-2 mb-2">
              <ShieldAlert size={13} className={priv.blocked ? "text-rose-700" : "text-slate-500"} />
              <span className="text-xs font-semibold text-slate-800 flex-1">Privacy</span>
              <span className="text-xs text-slate-500">Only a person decides</span>
            </div>
            {clip.privacy_reason && !clip.privacy_manual_review && (
              <div className="border border-rose-200 bg-white rounded px-2 py-2 mb-2">
                <p className="text-xs text-rose-900 leading-relaxed mb-2">{clip.privacy_reason}</p>
                <Button size="sm" variant="outline" disabled={decided}
                  onClick={() => onPatch({ privacy_manual_review: { by: identity, at: now() } })}>
                  I reviewed this clip myself
                </Button>
              </div>
            )}
            {clip.privacy_manual_review && (
              <p className="text-xs text-slate-500 mb-2">
                Reviewed by hand · <Signature by={clip.privacy_manual_review.by} at={clip.privacy_manual_review.at} />
              </p>
            )}
            {clip.privacy_flags.length === 0 && !clip.privacy_reason && (
              <p className="text-xs text-slate-500">No privacy flags raised.</p>
            )}
            <div className="space-y-2">
              {clip.privacy_flags.map((f, i) => (
                <PrivacyFlagRow key={f.flag} flag={f} thumbs={clip.thumbs} identity={identity}
                  disabled={decided} onResolve={(s) => resolveFlag(i, s)} />
              ))}
            </div>
          </div>

          {clip.match && (
            <div className="border border-slate-200 rounded-md px-3 py-2.5">
              <div className="flex items-center gap-2 mb-1.5">
                <Ruler size={12} className="text-slate-500" />
                <span className="text-xs font-semibold text-slate-800 flex-1">Against the brief</span>
                <span className="text-xs text-slate-500">Worked out in code</span>
              </div>
              {clip.match.level === "unmatched" ? (
                <>
                  <p className="text-xs text-slate-600 leading-relaxed mb-2">{clip.match.mismatches[0]}</p>
                  <p className="text-xs text-slate-500 leading-relaxed mb-2">
                    Good footage nobody thought to ask for is exactly where the library gains something. Keep it,
                    or turn what it shows into a new gap.
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    <Button size="sm" variant="outline" disabled={decided || clip.unmatched_keep}
                      onClick={() => onPatch({ unmatched_keep: true })}>
                      {clip.unmatched_keep ? "Kept as unmatched" : "Keep as unmatched"}
                    </Button>
                    {clip.ai?.room_type?.value && (
                      <Button size="sm" variant="primary" onClick={onMakeGap}>
                        <CornerDownRight size={12} /> Make this a gap
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-slate-600">
                    {shot ? `${shot.room_type} · ${shot.scene[0] ?? "any_scene"} · ×${shot.count}` : "shot removed"}
                    {gap && <> → {gap.id}</>}
                  </p>
                  {clip.match.mismatches.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {clip.match.mismatches.map((m) => <li key={m} className="text-xs text-amber-700">{m}</li>)}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}

          {clip.ai_issues.length > 0 && (
            <details className="border border-slate-200 rounded-md px-3 py-2">
              <summary className="text-xs font-semibold text-slate-700 cursor-pointer">
                Validation issues ({clip.ai_issues.length})
              </summary>
              <ul className="mt-2 space-y-1">
                {clip.ai_issues.map((i, n) => (
                  <li key={n} className="text-xs text-slate-500">
                    <span className={i.code.startsWith("failed") ? "text-rose-600" : "text-amber-600"}>{i.code}</span>
                    {i.field ? ` · ${i.field}` : ""} · {i.detail}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="flex items-center gap-2 pt-2 border-t border-slate-100 flex-wrap">
            {decided ? (
              <>
                <Chip tone={clip.clip_status === "accepted" ? "emerald" : "slate"}>{clip.clip_status === "accepted" ? "In the library" : "Rejected"}</Chip>
                <Signature by={clip.accepted_by ?? clip.rejected_by} at={clip.accepted_at ?? clip.rejected_at} />
                {clip.reject_reason && <span className="text-xs text-slate-500">{clip.reject_reason}</span>}
                <span className="flex-1" />
                <Button size="sm" variant="ghost" onClick={() => onPatch({ clip_status: "analysed", accepted_by: null, accepted_at: null, rejected_by: null, rejected_at: null, gap_id_closed: null })}>Reopen</Button>
              </>
            ) : (
              <>
                <div className="flex-1 min-w-0">
                  {blockers.length > 0 && (
                    <ul className="space-y-0.5">
                      {blockers.map((b) => <li key={b} className="text-xs text-rose-700 flex gap-1.5"><X size={11} className="shrink-0 mt-0.5" />{b}</li>)}
                    </ul>
                  )}
                </div>
                <Button size="sm" variant="outline" onClick={() => { setRejectText(""); setRejectOpen(true); }}>Reject</Button>
                <Button size="sm" variant="primary" disabled={blockers.length > 0 || busy}
                  onClick={() => onSendToLibrary(clip)}>
                  <Check size={12} aria-hidden="true" /> Send to the library
                </Button>
              </>
            )}
            <Button size="sm" variant="danger" onClick={onDelete}><Trash2 size={12} /></Button>
          </div>
        </div>
      )}

      <HandDescribeDrawer open={describing} clip={clip} identity={identity} onClose={() => setDescribing(false)}
        onSave={({ room, scene, shot: sh }) => {
          const ai = clip.ai ?? {};
          onPatch({
            ai: {
              ...ai,
              room_type: { value: room, confidence: "human", status: "ok", detail: null },
              scene: { value: scene, confidence: "human", status: "ok", detail: null, dropped: [] },
              shot_size: { value: sh, confidence: sh ? "human" : null, status: sh ? "ok" : "missing", detail: null },
              camera_motion: ai.camera_motion ?? { value: null, confidence: null, status: "missing" },
              lighting_condition: ai.lighting_condition ?? { value: null, confidence: null, status: "missing" },
              color_cast: ai.color_cast ?? { value: "indeterminate", confidence: null, status: "missing" },
              reframe_safe_9_16: ai.reframe_safe_9_16 ?? { value: null, confidence: null, status: "missing" },
              audio_state: ai.audio_state ?? { value: null, confidence: null, status: "missing" },
              time_of_day: ai.time_of_day ?? { value: "indeterminate", confidence: null, status: "missing" },
            },
            corrected_by: identity, corrected_at: now(),
            clip_status: ["analysis_failed", "requires_human_review", "unreadable_file"].includes(clip.clip_status) ? "analysed" : clip.clip_status,
          });
          setDescribing(false);
        }} />

      <Modal open={resendOpen} title="Ask her to send this one again" onClose={() => setResendOpen(false)}
        footer={<><Button variant="outline" onClick={() => setResendOpen(false)}>Close</Button>
          <Button variant="primary" onClick={() => { onPatch({ resend_request: { status: "asked", asked_by: identity, asked_at: now() } }); setResendOpen(false); }}>
            Mark as asked</Button></>}>
        <p className="text-sm text-slate-600 leading-relaxed mb-3">
          Copy this and send it to her however you normally talk. Marking it as asked just records that you did,
          so the clip stops looking like something nobody has dealt with.
        </p>
        <textarea readOnly rows={5} className={inputCls} value={resendMessage(clip)} />
        <p className="text-sm text-slate-500 mt-2">Signed as {identity}.</p>
      </Modal>

      <Modal open={rejectOpen} title="Reject this clip" onClose={() => setRejectOpen(false)}
        footer={<><Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
          <Button variant="primary" disabled={rejectText.trim().length < 5}
            onClick={() => { onPatch({ clip_status: "rejected", rejected_by: identity, rejected_at: now(), reject_reason: rejectText.trim() }); setRejectOpen(false); }}>
            Reject</Button></>}>
        <p className="text-sm text-slate-600 leading-relaxed mb-3">
          A person gave up a day and a branch gave up a room. Say why this one is not usable.
        </p>
        <textarea className={inputCls} rows={3} value={rejectText} onChange={(e) => setRejectText(e.target.value)}
          placeholder="Guest walks through frame at 4s and cannot be cropped out." />
        <p className="text-sm text-slate-600 mt-2">Signed as {identity}.</p>
      </Modal>
    </article>
  );
}

function CoveragePanel({ collabGaps, shotList, clips }) {
  return (
    <Section title="Against the brief" hint="Counted in code. The model was never told what we asked for, so this comparison means something.">
      {collabGaps.map((g) => {
        const shots = shotList.filter((s) => s.gap_id === g.id);
        const ids = new Set(shots.map((s) => s.id));
        const rel = clips.filter((c) => c.match && ids.has(c.match.shot_id));
        const usable = rel.filter((c) => c.clip_status === "accepted");
        const blocked = rel.filter((c) => clipPrivacyState(c).blocked && c.clip_status !== "rejected");
        const partial = rel.filter((c) => c.match.level === "partial" && c.clip_status !== "rejected");
        const shortfall = Math.max(0, g.quantity_needed - usable.length);
        return (
          <div key={g.id} className="mb-4 last:mb-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <Chip tone={{ p0: "rose", p1: "amber", p2: "slate" }[g.priority]}>{label(g.priority)}</Chip>
              <SpecLine gap={g} label={label} />
            </div>
            <div className="text-xs flex flex-wrap gap-2">
              <span className="px-2 py-1 rounded bg-slate-100 text-slate-700">asked {g.quantity_needed}</span>
              <span className="px-2 py-1 rounded bg-emerald-50 text-emerald-800">{usable.length} usable</span>
              {blocked.length > 0 && <span className="px-2 py-1 rounded bg-rose-50 text-rose-800">{blocked.length} privacy blocked</span>}
              {partial.length > 0 && <span className="px-2 py-1 rounded bg-amber-50 text-amber-800">{partial.length} partial</span>}
              {shortfall > 0 && <span className="px-2 py-1 rounded bg-slate-900 text-white">short {shortfall}</span>}
            </div>
          </div>
        );
      })}
      {(() => {
        const un = clips.filter((c) => c.match?.level === "unmatched" && c.clip_status !== "rejected");
        if (!un.length) return null;
        return (
          <div className="mt-4 pt-3 border-t border-slate-100">
            <p className="text-xs text-slate-600">
              <span className="font-semibold">{un.length}</span> clip{un.length === 1 ? "" : "s"} match nothing in
              this brief. That is not a failure, it is where a new gap comes from.
            </p>
          </div>
        );
      })()}
    </Section>
  );
}

function IntakeScreen({ collabs, gaps, creators, clips, setClips, identity, onNewGap, onGo, focus, onClearFocus, showTechnical, thumbUrls = {}, setSaveFailure, onLibraryAdded }) {
  const [sampling, setSampling] = useState(null);
  const eligible = collabs.filter((c) => c.brief_approved_by);
  /* Chosen on the first render rather than in an effect. The effect version
     painted an empty screen for one frame on every load, and meant the screen
     rendered as blank anywhere effects do not run. */
  const [collabId, setCollabId] = useState(() => eligible[0]?.id ?? null);
  const [queue, setQueue] = useState({ active: false, done: 0, total: 0, stop: false, current: "", elapsed: 0 });
  const [dragging, setDragging] = useState(false);

  /* A live count and a live elapsed time. A spinner says something is
     happening; this says how much of it is done and how long it has taken. */
  useEffect(() => {
    if (!queue.active) return;
    const started = Date.now() - queue.elapsed;
    const t = setInterval(() => setQueue((q) => (q.active ? { ...q, elapsed: Date.now() - started } : q)), 100);
    return () => clearInterval(t);
  }, [queue.active]);
  const [busyIds, setBusyIds] = useState(new Set());
  const [dupRunning, setDupRunning] = useState(false);
  const [diag, setDiag] = useState([]);
  const diagFailed = diag.some((l) => /FAILED|NOT SAVED/.test(l));
  const [watching, setWatching] = useState(null);
  // The run is a first-class thing on screen, so its start and end are recorded
  // rather than inferred from whether anything happens to be busy.
  const [run, setRun] = useState({ ids: [], startedAt: null, finishedAt: null, active: false });
  const stopRef = React.useRef(false);

  useEffect(() => { if (!collabId && eligible.length) setCollabId(eligible[0].id); }, [eligible, collabId]);
  useEffect(() => { if (focus?.collabId) setCollabId(focus.collabId); }, [focus]);
  const collab = eligible.find((c) => c.id === collabId);
  const collabGaps = collab ? collab.gap_ids.map((id) => gaps.find((g) => g.id === id)).filter(Boolean) : [];
  const myClips = clips.filter((c) => c.collab_id === collabId);
  const unanalysed = myClips.filter((c) => ["uploaded", "analysis_failed", "requires_human_review"].includes(c.clip_status));
  const unreadableCount = myClips.filter((c) => c.clip_status === "unreadable_file").length;
  const accepted = acceptedProposal(collab ?? { visit_proposals: [] });

  const patchClip = useCallback(async (id, p) => {
    const next = clips.map((c) => (c.id === id ? { ...c, ...p } : c));
    setClips(next);
    const target = next.find((c) => c.id === id);
    if (target) await saveClipRecord(target);
  }, [clips, setClips]);

  const recomputeMatch = (clip) => {
    if (!collab || !clip.ai) return null;
    return matchClipToShots(clip.ai, clip.system.aspect_native, collab.brief_shot_list);
  };

  /* ---------------------------------------------------------- upload ---- */
  const onFiles = async (fileList) => {
    const files = [...fileList];
    if (!collab || files.length === 0) return;
    stopRef.current = false;
    setQueue({ active: true, done: 0, total: files.length, stop: false, current: "", elapsed: 0 });
    let current = [...clips];
    const runLog = [];
    for (let i = 0; i < files.length; i++) {
      if (stopRef.current) break;
      const f = files[i];
      setQueue((q) => ({ ...q, done: i, current: f.name }));
      runLog.push(`\n=== ${f.name} ===`);
      let rec;
      try {
        const frames = await extractFrames(f, (line) => {
          runLog.push(line);
          setDiag([...runLog]);
        });
        rec = makeClip({
          collab_id: collab.id, branch_id: collab.branch_id, filename: f.name,
          thumbs: frames.thumbs, frame_count: frames.frame_count, clip_status: "uploaded",
          loaded_via: frames.loaded_via,
          // Set only on files pulled from Pexels. Real uploads carry nothing
          // here, and the library reads this to say what it is showing.
          sample: f.sample ?? null,
          system: {
            duration: frames.duration, width: frames.width, height: frames.height,
            aspect_native: frames.aspect_native, duration_bucket: frames.duration_bucket,
            capture_source: "unknown",
            // The only reliable source for this. A treatment room has no window.
            time_of_day: accepted?.time_of_day ?? null,
            time_of_day_source: accepted ? "visit_record" : null,
          },
        });
        // The large frames go to the model from memory and are never stored.
        sessionFrames.set(rec.id, frames.analysis);

        // The original is kept so full-size frames can be made again later.
        // Both uploads are awaited: a clip whose files did not land must not
        // sit in the list looking like every other clip.
        setQueue((q) => ({ ...q, current: `${f.name} — saving the file` }));
        const vid = await uploadVideo(rec.id, f);
        if (!vid.ok) { rec.blocked_reason = `The file itself did not save. ${vid.detail}`; }
        else rec.video_path = vid.data.path;

        setQueue((q) => ({ ...q, current: `${f.name} — saving the frames` }));
        const th = await uploadThumbs(rec.id, frames.thumbs);
        if (!th.ok) { rec.blocked_reason = `The frames did not save. ${th.detail}`; }
        else rec.thumb_paths = th.data;
      } catch (e) {
        // The file stays on the record. It is not thrown away, and it does not
        // stop the files queued behind it.
        runLog.push(`FAILED: ${e.message}`);
        setDiag([...runLog]);
        rec = makeClip({
          collab_id: collab.id, branch_id: collab.branch_id, filename: f.name,
          clip_status: "unreadable_file",
          read_failure: { kind: e.kind ?? "load_failed", plain: e.message,
            probe: e.probe ?? null, steps: e.steps ?? [] },
        });
      }

      const written = await saveClipRecord(rec);
      if (!written.ok) {
        // Nothing goes on screen that the database has not taken. A clip shown
        // here but absent from the database would vanish on the next reload
        // with no explanation.
        runLog.push(`NOT SAVED: ${written.detail}`);
        setDiag([...runLog]);
        setSaveFailure(written);
        continue;
      }
      current = [...current, rec];
      setClips(current);
    }
    setQueue({ active: false, done: 0, total: 0, stop: false, current: "" });
  };

  /* --------------------------------------------------------- analyse ---- */
  const analyseOne = async (clip) => {
    let avail = framesAvailableFor(clip);
    let gate = canAnalyse(avail);

    // The original is in storage, so fetch it and make the full frames again.
    // This is the only new path: it never lowers the bar, it restores it.
    if (!gate.allowed && gate.recoverable) {
      setBusyIds((s) => new Set([...s, clip.id]));
      await patchClip(clip.id, { blocked_reason: "Fetching the original file so the frames can be made again…" });
      const got = await fetchOriginal(clip.video_path);
      if (!got.ok) {
        setBusyIds((s) => { const n = new Set(s); n.delete(clip.id); return n; });
        await patchClip(clip.id, { clip_status: "requires_human_review",
          blocked_reason: `The original could not be fetched, so full frames cannot be made. ${got.detail} Describe it yourself instead.` });
        return;
      }
      try {
        const file = new File([got.data], clip.filename, { type: got.data.type || "video/mp4" });
        const frames = await extractFrames(file);
        sessionFrames.set(clip.id, frames.analysis);
        avail = "full"; gate = { allowed: true };
      } catch (e) {
        setBusyIds((s) => { const n = new Set(s); n.delete(clip.id); return n; });
        await patchClip(clip.id, { clip_status: "requires_human_review",
          blocked_reason: `The original came back but the browser could not read it again. ${e.message}` });
        return;
      }
    }

    if (!gate.allowed) {
      // No quiet fallback to 256px. This is the whole privacy argument.
      await patchClip(clip.id, { clip_status: gate.code, blocked_reason: gate.reason });
      return;
    }
    setBusyIds((s) => new Set([...s, clip.id]));
    await patchClip(clip.id, { clip_status: "analysing", blocked_reason: null });

    const analysisFrames = sessionFrames.get(clip.id);
    const frames = { analysis: analysisFrames, duration_bucket: clip.system.duration_bucket, aspect_native: clip.system.aspect_native };

    /* One call, two answers, still judged apart. The privacy half can block
       a clip whose description came back fine, and a description that failed
       does not make the clip safe. */
    const patch = {};
    try {
      const r = await readClip(frames);
      const d = r.described;
      patch.ai = d.fields; patch.quality_flags = d.quality_flags;
      patch.ai_issues = d.issues; patch.overconfidence = d.overconfidence;
      patch.ai_status = d.ok ? "ok" : (d.issues.find((i) => i.code.startsWith("failed"))?.code ?? "failed_shape");
      patch.clip_status = d.ok ? "analysed" : "analysis_failed";

      patch.privacy_flags = r.privacy.privacy_flags;
      patch.privacy_issues = r.privacy.issues;
      patch.privacy_reason = r.privacy.review_reason;
      patch.privacy_status = r.privacy.review_required ? "unreviewed" : "cleared";
      if (r.privacy.review_required && patch.clip_status === "analysed") patch.clip_status = "privacy_pending";

      // Words the reader used that are not in the vocabulary. Kept, not
      // discarded: they are the honest record of what it actually saw.
      if (r.unmatched?.length) {
        patch.ai_issues = [...(patch.ai_issues ?? []),
          { code: "unmatched_words", field: null,
            detail: `The reader described this with words the taxonomy does not have: ${r.unmatched.join(", ")}.` }];
      }
    } catch (e) {
      patch.ai_status = "failed_api";
      patch.ai_issues = [{ code: "failed_api", field: null, detail: e.message ?? "The reader failed." }];
      patch.clip_status = "analysis_failed";
      // Asymmetric on purpose. A clip that was never checked is not clean.
      patch.privacy_flags = []; patch.privacy_status = "unreviewed";
      patch.privacy_issues = [{ code: "failed_api", field: "privacy_flags", detail: e.message ?? "The reader failed." }];
      patch.privacy_reason = "The privacy check did not complete. A clip that was never checked is not a clip that is clean.";
    }

    const merged = { ...clip, ...patch };
    patch.match = merged.ai ? matchClipToShots(merged.ai, merged.system.aspect_native, collab.brief_shot_list) : null;

    await patchClip(clip.id, patch);
    setBusyIds((s) => { const n = new Set(s); n.delete(clip.id); return n; });
  };

  /**
   * Reading a batch. The run is recorded from the first clip to the last, so
   * the elapsed time on screen is the real one rather than a guess, and it is
   * as correct for three files as for thirty.
   */
  /**
   * Accepting a clip puts it in the library.
   *
   * The library is a VIEW over accepted clips joined to their collab, so this
   * is one write, not two: mark the clip accepted and it appears there. An
   * earlier version of this wrote a second row into the library itself, which
   * would have failed - a joined view is not writable - and the reasoning that
   * came with it, that acceptance freezes the rights, is not true of this
   * schema either. The rights are read live from the collab.
   *
   * That is a real difference and worth knowing: renegotiating a collab's
   * rights changes what may be done with footage already accepted under them.
   * If that should not be the case, the view has to become a table.
   */
  const sendToLibrary = async (clip) => {
    setBusyIds((s) => new Set([...s, clip.id]));
    const r = await patchClip(clip.id, {
      clip_status: "accepted", accepted_by: identity, accepted_at: now(),
      gap_id_closed: clip.match?.gap_id ?? null,
    });
    if (r && r.ok === false) setSaveFailure(r);
    setBusyIds((s) => { const n = new Set(s); n.delete(clip.id); return n; });
  };

  /**
   * Pulls a handful of real videos and hands them to onFiles, which is the
   * ordinary upload path. Nothing about intake knows these came from a search.
   */
  const onLoadSample = async () => {
    setSaveFailure(null);
    try {
      if (!collab) {
        setSaveFailure({ ok: false, kind: "no_visit", title: "No visit is selected",
          detail: "Pick a visit above first. Sample footage is always attached to one.", retryable: false });
        return;
      }
      const rooms = [...new Set((collab.brief_shot_list ?? []).map((sh) => sh.room_type))]
        .filter(Boolean).slice(0, 3);
      if (!rooms.length) {
        setSaveFailure({ ok: false, kind: "no_shot_list",
          title: "This visit has no shot list to search on",
          detail: `The collab ${collab.id} has no shots recorded, and the sample follows what the brief `
            + `asks for. Approve a brief with at least one shot in it first.`, retryable: false });
        return;
      }

      setSampling({ done: 0, total: 0, name: rooms.map(label).join(", ") });
      const r = await fetchSampleVideos({ rooms, per_room: 2, onStep: setSampling });
      setSampling(null);

      if (!r.ok) { setSaveFailure(r); return; }
      if (!r.files.length) {
        setSaveFailure({ ok: false, kind: "nothing_downloaded",
          title: "Nothing came back that this browser could download",
          detail: `Pexels answered for ${rooms.map(label).join(", ")}, but none of the video files `
            + `could be fetched.`, retryable: true });
        return;
      }
      await onFiles(r.files);
    } catch (e) {
      // Anything unexpected still has to say so. A button that fails in
      // silence is the thing this whole product exists to argue against.
      setSampling(null);
      setSaveFailure({ ok: false, kind: e?.name ?? "unexpected",
        title: "Loading the sample stopped",
        detail: String(e?.message ?? e).slice(0, 300), retryable: true });
    }
  };

  const analyseAll = async () => {
    const todo = myClips.filter((c) => ["uploaded", "analysis_failed", "requires_human_review", "recoverable"].includes(c.clip_status));
    if (!todo.length) return;
    stopRef.current = false;
    setRun({ ids: todo.map((c) => c.id), startedAt: Date.now(), finishedAt: null, active: true });
    setQueue({ active: true, done: 0, total: todo.length, stop: false, current: "", elapsed: 0 });
    for (let i = 0; i < todo.length; i++) {
      if (stopRef.current) break;
      setQueue((q) => ({ ...q, done: i, current: todo[i].filename }));
      // eslint-disable-next-line no-await-in-loop
      await analyseOne(todo[i]);
    }
    setQueue({ active: false, done: 0, total: 0, stop: false, current: "" });
    setRun((r) => ({ ...r, active: false, finishedAt: Date.now() }));
  };

  /* ------------------------------------------------- near duplicates ---- */
  const findDuplicates = async () => {
    setDupRunning(true);
    const withThumbs = myClips.filter((c) => c.thumbs.length);
    const hashes = [];
    for (const c of withThumbs) {
      // eslint-disable-next-line no-await-in-loop
      const h = await imageHash(c.thumbs[Math.floor(c.thumbs.length / 2)]);
      if (h) hashes.push({ id: c.id, h });
    }
    const dupes = new Set();
    for (let i = 0; i < hashes.length; i++) {
      for (let j = i + 1; j < hashes.length; j++) {
        if (hamming(hashes[i].h, hashes[j].h) <= 6) { dupes.add(hashes[i].id); dupes.add(hashes[j].id); }
      }
    }
    let next = clips;
    for (const c of withThumbs) {
      const has = c.quality_flags.some((f) => f.flag === "near_duplicate");
      if (dupes.has(c.id) && !has) {
        const rec = { ...c, quality_flags: [...c.quality_flags, { flag: "near_duplicate", severity: "cosmetic", confidence: "high", source: "computed" }] };
        next = next.map((x) => (x.id === c.id ? rec : x));
        await saveClipRecord(rec);
      } else if (!dupes.has(c.id) && has) {
        const rec = { ...c, quality_flags: c.quality_flags.filter((f) => f.flag !== "near_duplicate") };
        next = next.map((x) => (x.id === c.id ? rec : x));
        await saveClipRecord(rec);
      }
    }
    setClips(next);
    setDupRunning(false);
  };

  /* ------------------------------------------------------- issue log ---- */
  const issueLog = useMemo(() => {
    const m = new Map();
    myClips.forEach((c) => {
      [...c.ai_issues, ...c.privacy_issues].forEach((i) => m.set(i.code, (m.get(i.code) || 0) + 1));
      c.overconfidence.forEach(() => m.set("overconfidence_flag", (m.get("overconfidence_flag") || 0)));
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [myClips]);

  if (eligible.length === 0) {
    return (
      <>
        <ScreenIntro eyebrow="Stage 5" title="What came back" onHome={() => onGo("home")}
          intent="Upload what she sent from one visit, read it, and decide clip by clip what goes into the library. Nothing is accepted until you say so." />
        <EmptyState skeleton="grid" then="Clips are always taken in against one visit, so the system knows who shot them and what was asked for." icon={Upload} title="There is no visit to take clips against yet"
          body="Clips are always uploaded against one visit, so the system knows who shot them and what was asked for. That needs an approved brief first."
          missing={[
            { label: "A gap saying what is missing", done: gaps.some((g) => g.status === "open") },
            { label: "A creator on the roster", done: creators.length > 0 },
            { label: "A collab pairing the two", done: collabs.length > 0 },
            { label: "That collab's brief approved", done: false },
          ]}
          action={<Button variant="primary" onClick={() => onGo("home")}><Zap size={14} /> Show me the shortcut</Button>}
          secondary={<Button variant="outline" onClick={() => onGo("briefs")}>Go to Briefs</Button>} />
      </>
    );
  }

  const creator = creators.find((x) => x.id === collab?.creator_id);
  const askedFor = collab ? collab.brief_shot_list.reduce((n, x) => n + x.count, 0) : 0;
  const rooms = collab ? roomSummary(collab.brief_shot_list) : [];

  const focusIds = focus?.clipIds ?? null;
  const shown = focusIds ? myClips.filter((c) => focusIds.includes(c.id)) : myClips;

  /* Two sections, not seven.
   *
   * The seven headings this replaced were each true, and together they read as
   * a list of chores. The distinctions are not gone: each one is now the state
   * pill and the action on the card itself, where it belongs to the clip it
   * describes rather than to a bucket the clip was sorted into. */
  const pending = shown.filter((c) => !["accepted", "rejected"].includes(c.clip_status));
  const decided = shown.filter((c) => ["accepted", "rejected"].includes(c.clip_status));

  /** What the card says about itself, and the one thing it offers to do. */
  const cardState = (c) => {
    if (clipPrivacyState(c).blocked) {
      return { pill: "Problem", pillBg: "var(--warn-tint)", pillFg: "var(--warn-text)",
        meta: clipPrivacyState(c).reason ?? "A person has to rule on this one.",
        action: "Review the privacy flag", primary: false };
    }
    if (c.clip_status === "unreadable_file") {
      return { pill: "Problem", pillBg: "var(--warn-tint)", pillFg: "var(--warn-text)",
        meta: "The browser could not open this file.",
        action: "Describe it yourself", primary: false };
    }
    if (c.clip_status === "requires_human_review") {
      return { pill: "Problem", pillBg: "var(--warn-tint)", pillFg: "var(--warn-text)",
        meta: "The frames it was read from are gone. Upload it again.",
        action: "Read this clip", primary: false };
    }
    if (!c.ai) {
      return { pill: "Not read", pillBg: "rgba(255,255,255,0.9)", pillFg: "var(--text-body)",
        meta: "Nobody has looked at this one yet.",
        action: "Read this clip", primary: false };
    }
    if (c.match?.level === "unmatched") {
      return { pill: "Read", pillBg: "var(--model-tint)", pillFg: "var(--model-text)",
        meta: "Matches nothing in the brief. That is where a new gap comes from.",
        action: "Send to the library", primary: true };
    }
    return { pill: "Read", pillBg: "var(--model-tint)", pillFg: "var(--model-text)",
      meta: c.match?.level === "exact" ? "Matches what she was asked for."
        : c.match?.level ? "Close to what she was asked for." : "Read, not matched to a shot.",
      action: "Send to the library", primary: true };
  };

  const needsYou = pending.length;

  return (
    <>
      {/* This screen's whole job is to answer "whose footage am I looking at",
          so it says so at the top and then never lets go of it: the visit
          picker, the contract card, and every counter below follow one visit. */}
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ margin: 0, fontSize: 32, lineHeight: 1.1, letterSpacing: "-0.03em", fontWeight: 500 }}>
          Footage that came back
        </h1>
        <div style={{ marginTop: 9, fontSize: 14, color: "var(--text-body)" }}>
          <span className="cc-num">{clips.length}</span> clip{clips.length === 1 ? "" : "s"} from
          {" "}<span className="cc-num">{eligible.filter((c) => clips.some((k) => k.collab_id === c.id)).length}</span>
          {" "}visit{eligible.filter((c) => clips.some((k) => k.collab_id === c.id)).length === 1 ? "" : "s"}
          {needsYou > 0 && <> · <span className="cc-num">{needsYou}</span> waiting on a decision from you</>}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-meta)", marginBottom: 22 }}>
        <button onClick={() => onGo("home")} style={{ color: "var(--text-body)", background: "none", border: 0,
          cursor: "pointer", padding: 0, fontSize: 13 }}>Intake</button>
        <span aria-hidden="true">›</span>
        <span style={{ color: "var(--text)" }}>
          {creator?.display_name ?? "no visit"} at {branchById(collab?.branch_id)?.name ?? "—"}
          {accepted ? `, ${fmtDate(accepted.date)}` : ""}
        </span>
      </div>

      {/* One card per visit with footage. Clicking one switches the contract
          card, the upload wording, all four counters and both clip sections.
          The dropdown that was here said the same thing and nobody read it. */}
      {eligible.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
          gap: 12, marginBottom: 22 }}>
          {eligible.map((c) => {
            const cr = creators.find((x) => x.id === c.creator_id);
            const acc = acceptedProposal(c);
            const mine = clips.filter((k) => k.collab_id === c.id);
            const undecided = mine.filter((k) => k.clip_status !== "accepted" && k.clip_status !== "rejected");
            const on = c.id === collabId;
            return (
              <button key={c.id} onClick={() => { setCollabId(c.id); onClearFocus(); }}
                aria-current={on ? "true" : undefined}
                style={{ borderRadius: 14, padding: 14, display: "flex", alignItems: "center", gap: 12,
                  cursor: "pointer", border: 0, textAlign: "left", width: "100%",
                  background: on ? "var(--surface)" : "transparent",
                  boxShadow: on ? "0 0 0 1.5px var(--text)" : "inset 0 0 0 0.5px var(--hairline)",
                  transition: "box-shadow 150ms, background 150ms" }}>
                <span role="img" aria-label={cr?.display_name ?? "Creator"}
                  style={{ width: 42, height: 42, flex: "none", borderRadius: 11, display: "block",
                    background: "var(--hairline) center/cover no-repeat",
                    backgroundImage: cr?.photo ? `url(${cr.photo})` : "none" }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 500, overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap",
                    color: on ? "var(--text)" : "var(--text-body)" }}>{cr?.display_name ?? "Creator"}</span>
                  <span style={{ display: "block", marginTop: 3, fontSize: 12, color: "var(--text-meta)" }}>
                    {branchById(c.branch_id)?.name}{acc ? ` · ${fmtDate(acc.date)}` : " · no date yet"}
                  </span>
                </span>
                {undecided.length > 0 && (
                  <span className="cc-num" style={{ flex: "none", fontSize: 12, borderRadius: 8,
                    padding: "4px 9px", background: "var(--warn-tint)", color: "var(--warn-text)" }}>
                    {undecided.length} waiting
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {collab && (
        <section style={{ background: "var(--surface)", borderRadius: 18, padding: 20, marginBottom: 22,
          boxShadow: "0 0 0 0.5px var(--hairline), 0 1px 2px rgba(28,25,23,0.03)",
          display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
          <Avatar name={creator?.display_name ?? "??"} photo={creator?.photo} size={76} square />
          <div style={{ flex: "1 1 380px", minWidth: "min(100%, 300px)" }}>
            <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-body)" }}>
              You are looking at
            </div>
            <h1 style={{ margin: "7px 0 0", fontSize: 26, lineHeight: 1.15, letterSpacing: "-0.025em", fontWeight: 500 }}>
              {creator?.display_name} at {branchById(collab.branch_id)?.name}
            </h1>
            <div style={{ marginTop: 6, fontSize: 14, color: "var(--text-body)" }}>
              {accepted
                ? `Visited ${fmtDate(accepted.date)}, ${label(accepted.time_of_day).toLowerCase()}`
                : "No date agreed yet"}
              {collab.brief_approved_at ? ` · Brief approved ${fmtDate(collab.brief_approved_at.slice(0, 10))}` : ""}
            </div>
            {(collab.brief_shot_list ?? []).length > 0 && (
              <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 7 }}>
                <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-body)" }}>
                  What we asked her for
                </div>
                {collab.brief_shot_list.map((sh) => (
                  <div key={sh.id} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 14, color: "var(--text)" }}>
                    <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 999, background: "var(--accent)", flex: "none" }} />
                    <span className="cc-num">{sh.count}</span>&nbsp;clips of the {label(sh.room_type).toLowerCase()}
                    {sh.scene ? `, ${label(sh.scene).toLowerCase()}` : ""} · {label(sh.aspect)}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ flex: "none", display: "flex", gap: 9, flexWrap: "wrap" }}>
            <button onClick={() => onGo("briefs", { collabId: collab.id })}
              style={{ background: "var(--surface)", border: 0, borderRadius: 11, height: 40, padding: "0 14px",
                fontSize: 14, fontWeight: 500, color: "var(--text)", cursor: "pointer", boxShadow: "0 0 0 0.5px var(--hairline-2)" }}>
              Open the brief
            </button>
            <button onClick={() => onGo("creators", { creatorId: creator?.id })}
              style={{ background: "var(--surface)", border: 0, borderRadius: 11, height: 40, padding: "0 14px",
                fontSize: 14, fontWeight: 500, color: "var(--text)", cursor: "pointer", boxShadow: "0 0 0 0.5px var(--hairline-2)" }}>
              Her profile
            </button>
          </div>
        </section>
      )}

      {unreadableCount > 0 && (
        <div className="border border-amber-200 bg-amber-50 rounded-xl px-4 py-3 mb-4 flex items-start gap-2">
          <AlertTriangle size={15} className="text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-sm text-amber-900 leading-relaxed">
            {unreadableCount} file{unreadableCount === 1 ? "" : "s"} could not be opened by the browser. They are still
            listed below, with a note on why and a message you can send asking for them again.
          </p>
        </div>
      )}

      {/* Upload zone and counter strip, to the design: one well with an inset
          ring rather than a dashed border, and the run button in violet
          because the model does the work. */}
      <section style={{ background: "var(--surface)", borderRadius: 18, padding: 20, marginBottom: 22,
        boxShadow: "0 0 0 0.5px var(--hairline), 0 1px 2px rgba(28,25,23,0.03)" }}>
        <label
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); onFiles(e.dataTransfer.files); }}
          style={{ borderRadius: 14, background: dragging ? "var(--accent-tint)" : "var(--page)",
            boxShadow: `inset 0 0 0 1.5px ${dragging ? "var(--accent)" : "var(--hairline)"}`,
            padding: "34px 24px", display: "flex", flexDirection: "column", alignItems: "center",
            gap: 12, textAlign: "center", cursor: queue.active ? "wait" : "pointer",
            transition: "box-shadow 150ms, background 150ms" }}>
          <input type="file" accept="video/*" multiple className="sr-only" disabled={queue.active}
            onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
          <svg width="40" height="40" viewBox="0 0 48 48" fill="none" stroke="var(--text-meta)" strokeWidth="1.3" aria-hidden="true">
            <path d="M24 32V12M17 19l7-7 7 7" /><path d="M10 30v5a3 3 0 003 3h22a3 3 0 003-3v-5" />
          </svg>
          <div style={{ fontSize: 17, fontWeight: 500, color: "var(--text)" }}>
            {queue.active
              ? `Reading ${queue.current}…`
              : `Drop the files ${creator?.display_name?.split(" ")[0] ?? "she"} sent here`}
          </div>
          <div style={{ fontSize: 14, color: "var(--text-body)", maxWidth: "46ch", lineHeight: 1.5 }}>
            {queue.active
              ? `${queue.done} of ${queue.total}`
              : "Everything you drop goes to this visit. MP4 or MOV, thirty at once is fine."}
          </div>
          <span style={{ marginTop: 4, background: "var(--accent)", color: "#fff", borderRadius: 11, height: 44,
            padding: "0 20px", fontSize: 14, fontWeight: 500, display: "inline-flex", alignItems: "center" }}>
            Choose files
          </span>
        </label>

        {!queue.active && (
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <Button variant="outline" onClick={onLoadSample} disabled={!!sampling}>
              {sampling
                ? `Fetching ${sampling.name ?? "footage"}… ${sampling.done} of ${sampling.total}`
                : "Load a sample visit"}
            </Button>
            <span style={{ fontSize: 12, color: "var(--text-meta)", flex: 1, minWidth: 200 }}>
              {(collab?.brief_shot_list ?? []).length === 0
                ? "This visit has no shot list yet, so there is nothing to search on."
                : `Pulls real video files from Pexels for ${[...new Set(collab.brief_shot_list.map((sh) => sh.room_type))]
                    .map(label).join(" and ")}, and puts them through the same path an upload takes.`}
            </span>
          </div>
        )}

        {queue.active && (
          <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>Uploading now</span>
              <span className="cc-num" style={{ fontSize: 12, color: "var(--text-body)" }}>
                {queue.done} of {queue.total} done
              </span>
            </div>
            <div style={{ height: 4, borderRadius: 999, background: "var(--hairline)", overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", borderRadius: 999, background: "var(--text)",
                width: `${Math.round((queue.done / Math.max(1, queue.total)) * 100)}%` }} />
            </div>
          </div>
        )}
      </section>

      <section style={{ background: "var(--surface)", borderRadius: 18, padding: "20px 22px", marginBottom: 22,
        boxShadow: "0 0 0 0.5px var(--hairline), 0 1px 2px rgba(28,25,23,0.03)",
        display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 320px", minWidth: "min(100%, 280px)", display: "flex", gap: 30, flexWrap: "wrap" }}>
          {[[myClips.length, "Clips in"],
            [myClips.filter((c) => c.ai).length, "Read by the model"],
            [needsYou, "Waiting on you"],
            [myClips.filter((c) => c.clip_status === "accepted").length, "Sent to the library"]].map(([v, k]) => (
            <div key={k}>
              <div className="cc-num" style={{ fontSize: 24, letterSpacing: "-0.02em" }}>{v}</div>
              <div style={{ marginTop: 2, fontSize: 12, color: "var(--text-meta)" }}>{k}</div>
            </div>
          ))}
        </div>
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "var(--text-body)" }}>
            {queue.active
              ? `${queue.done} read · ${(queue.elapsed / 1000).toFixed(1)}s`
              : !myClips.length ? "Nothing to read until you upload something."
              : !unanalysed.length ? "Every clip here has been read."
              : `${unanalysed.length} still to read.`}
          </span>
          {queue.active ? (
            <Button variant="ghost" onClick={() => { stopRef.current = true; }}>Stop</Button>
          ) : (
            <button onClick={analyseAll} disabled={!unanalysed.length}
              style={{ background: unanalysed.length ? "var(--model)" : "var(--surface)",
                color: unanalysed.length ? "#fff" : "var(--text-meta)", border: 0, borderRadius: 11, height: 44,
                padding: "0 18px", fontSize: 14, fontWeight: 500,
                cursor: unanalysed.length ? "pointer" : "not-allowed",
                boxShadow: unanalysed.length ? "none" : "0 0 0 0.5px var(--hairline-2)",
                display: "inline-flex", alignItems: "center", gap: 9 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2l2.2 6.3L20.5 10l-6.3 2.2L12 18.5 9.8 12.2 3.5 10l6.3-1.7z" />
              </svg>
              {unanalysed.length ? `Read the last ${unanalysed.length}` : `All ${myClips.length} read`}
            </button>
          )}
          {myClips.length >= 2 && (
            <Button variant="outline" onClick={findDuplicates} disabled={dupRunning}>
              {dupRunning ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Film size={12} aria-hidden="true" />}
              Find near-duplicates
            </Button>
          )}
        </div>
      </section>

      {/* The log is for when something went wrong, so it stays shut until
          something does. Twelve lines of extraction trace opening after every
          successful upload is debug output wearing a product's clothes. */}
      {diag.length > 0 && diagFailed && (
        <div className="border border-amber-200 rounded-xl bg-white p-4 mb-6">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <AlertTriangle size={15} style={{ color: "var(--warn)" }} aria-hidden="true" />
            <span className="text-base font-medium text-slate-900 flex-1">A file did not open. Here is what the browser said.</span>
            <Button size="sm" variant="outline" onClick={() => {
              const t = document.getElementById("cc-diag");
              if (t) { t.focus(); t.select(); }
              navigator.clipboard?.writeText(diag.join("\n")).catch(() => {});
            }}>Copy the log</Button>
            <Button size="sm" variant="ghost" onClick={() => setDiag([])}>Hide</Button>
          </div>
          <p className="text-sm text-slate-600 mb-2 leading-relaxed">
            Every step of pulling frames out of the files you just added. Send this whole box if something failed.
          </p>
          <textarea id="cc-diag" readOnly value={diag.join("\n")} rows={12}
            className="w-full cc-mono text-xs p-3 rounded-lg" style={{ border: "0.5px solid var(--hairline-2)" }} />
        </div>
      )}

      {diag.length > 0 && !diagFailed && showTechnical && (
        <details className="border border-slate-200 rounded-xl bg-white px-4 py-3 mb-4">
          <summary className="text-sm text-slate-600 cursor-pointer">What happened while reading the files</summary>
          <textarea readOnly value={diag.join("\n")} rows={10}
            className="w-full cc-mono text-xs p-3 rounded-lg mt-2" style={{ border: "0.5px solid var(--hairline-2)" }} />
        </details>
      )}

      {run.ids.length > 0 && (
        <ReadingRun
          clips={run.ids.map((id) => myClips.find((c) => c.id === id)).filter(Boolean)}
          active={run.active} startedAt={run.startedAt} finishedAt={run.finishedAt}
          sentenceFor={clipSentence}
          onDismiss={() => setRun({ ids: [], startedAt: null, finishedAt: null, active: false })} />
      )}

      {focusIds && <FocusBanner count={shown.length} why={focus.why ?? "you asked for"} onClear={onClearFocus} />}

      {issueLog.length > 0 && showTechnical && (
        <details className="border border-slate-200 bg-slate-50 rounded-xl px-4 py-3 mb-5">
          <summary className="text-sm font-medium text-slate-800 cursor-pointer">
            Validation log across {myClips.length} clip{myClips.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 space-y-0.5">
            {issueLog.map(([code, n]) => (
              <li key={code} className="text-xs text-slate-600">
                <span className={code === "failed_vocabulary_invented" ? "text-rose-600" : code.startsWith("failed") ? "text-amber-700" : "text-slate-500"}>{code}</span> × {n}
              </li>
            ))}
          </ul>
          <p className="text-sm text-slate-600 mt-2 leading-relaxed">
            invented means a value that exists nowhere in the taxonomy, and points at the prompt. out_of_scope means
            a real value in the wrong field, and points at the vocabulary we send.
          </p>
        </details>
      )}

      {myClips.length === 0 ? (
        <EmptyState skeleton="grid" then="Frames are pulled in this browser, then each clip is read and compared against the brief." icon={Inbox} title="No clips on this visit yet"
          body="Use the box above. Thirty files all called IMG_4471 is exactly the case this screen was built for: each one gets read, checked, and sorted into what still needs you." />
      ) : (
        <>
          {collab && <CoveragePanel collabGaps={collabGaps} shotList={collab.brief_shot_list} clips={myClips} />}
          <div className="space-y-10">
            {/* The one automation on this screen.
                *
                * After a run, every clip the matcher tied to a shot is listed
                * here as a proposal with the gap named. Accepting them is one
                * press; the system never writes the decision itself. An
                * automation that quietly accepted footage would be making the
                * only judgement this product exists to keep with a person. */}
            {(() => {
              const proposals = pending.filter((c) => c.ai && c.match?.gap_id
                && !clipPrivacyState(c).blocked && c.match.level !== "unmatched");
              if (proposals.length < 2) return null;
              const byGap = {};
              for (const c of proposals) (byGap[c.match.gap_id] ??= []).push(c);
              return (
                <section style={{ background: "var(--model-tint)", borderRadius: 16, padding: 18, marginBottom: 22,
                  boxShadow: "inset 0 0 0 0.5px var(--model-ring)" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 11, flexWrap: "wrap" }}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="var(--model-text)" aria-hidden="true"
                      style={{ flex: "none", marginTop: 2 }}>
                      <path d="M12 2l2.2 6.3L20.5 10l-6.3 2.2L12 18.5 9.8 12.2 3.5 10l6.3-1.7z" />
                    </svg>
                    <div style={{ flex: "1 1 300px", minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: "var(--model-text)" }}>
                        <span className="cc-num">{proposals.length}</span> of these match a gap you wrote
                      </p>
                      <div style={{ marginTop: 7, display: "flex", flexDirection: "column", gap: 5 }}>
                        {Object.entries(byGap).map(([gid, list]) => {
                          const g = gaps.find((x) => x.id === gid);
                          return (
                            <div key={gid} style={{ fontSize: 13, color: "var(--model-text)", lineHeight: 1.5 }}>
                              <span className="cc-num">{list.length}</span>
                              {" "}for {g ? g.room_type.map(label).join(" or ").toLowerCase() : "a gap"}
                              {g && <span style={{ opacity: 0.75 }}> · {g.quantity_needed} asked for</span>}
                            </div>
                          );
                        })}
                      </div>
                      <p style={{ margin: "9px 0 0", fontSize: 12, color: "var(--model-text)", opacity: 0.8 }}>
                        Nothing has been accepted. Sending them to the library is still your decision,
                        one clip at a time or all at once.
                      </p>
                    </div>
                    <Button size="sm" variant="violet" style={{ flex: "none" }}
                      disabled={busyIds.size > 0}
                      onClick={async () => { for (const c of proposals) await sendToLibrary(c); }}>
                      Send all {proposals.length} to the library
                    </Button>
                  </div>
                </section>
              );
            })()}

            {pending.length > 0 && (
              <section style={{ marginBottom: 26 }}>
                <div style={{ marginBottom: 13 }}>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 500, letterSpacing: "-0.015em" }}>
                    Decide on these
                  </h2>
                  <div style={{ marginTop: 4, fontSize: 13, color: "var(--text-body)" }}>
                    The model has read them. Nothing moves until you say so.
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 16 }}>
                  {pending.map((c) => {
                    const st = cardState(c);
                    const frame = thumbsFor(c, thumbUrls)[0];
                    return (
                      <article key={c.id} className="cc-lift"
                        style={{ background: "var(--surface)", borderRadius: 16, overflow: "hidden",
                          display: "flex", flexDirection: "column",
                          boxShadow: "0 0 0 0.5px var(--hairline), 0 1px 2px rgba(28,25,23,0.03)" }}>
                        <button onClick={() => setWatching(c)}
                          style={{ position: "relative", width: "100%", aspectRatio: "4/5",
                            background: "var(--hairline)", border: 0, padding: 0, cursor: "pointer", display: "block" }}>
                          <span role="img" aria-label={clipSentence(c)}
                            style={{ position: "absolute", inset: 0, display: "block",
                              background: "var(--hairline) center/cover no-repeat",
                              backgroundImage: frame ? `url(${frame})` : "none" }} />
                          <span className="cc-num" style={{ position: "absolute", left: 9, bottom: 9,
                            fontSize: 11, color: "#fff", background: "rgba(28,25,23,0.62)",
                            borderRadius: 6, padding: "2px 6px" }}>
                            {fmtDuration(c.system?.duration)}
                          </span>
                          <span style={{ position: "absolute", right: 9, top: 9, fontSize: 11,
                            borderRadius: 7, padding: "3px 7px",
                            background: st.pillBg, color: st.pillFg }}>{st.pill}</span>
                        </button>
                        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 9 }}>
                          <div style={{ fontSize: 13, lineHeight: 1.45, minHeight: 38 }}>
                            {c.ai ? clipSentence(c) : "Not read yet"}
                          </div>
                          <div style={{ fontSize: 12, color: "var(--text-meta)", minHeight: 17, lineHeight: 1.4 }}>
                            {st.meta}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 7, paddingTop: 10,
                            boxShadow: "inset 0 0.5px 0 var(--hairline)" }}>
                            <Button size="sm" variant={st.primary ? "primary" : "outline"}
                              disabled={busyIds.has(c.id)} style={{ flex: 1 }}
                              onClick={() => {
                                if (st.primary) return sendToLibrary(c);
                                if (!c.ai) return analyseOne(c);
                                setWatching(c);
                              }}>
                              {st.action}
                            </Button>
                            <button aria-label={`More options for this clip`} onClick={() => setWatching(c)}
                              style={{ flex: "none", width: 34, height: 34, border: 0, background: "transparent",
                                borderRadius: 9, cursor: "pointer", display: "flex", alignItems: "center",
                                justifyContent: "center" }}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--text-body)" aria-hidden="true">
                                <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" />
                                <circle cx="19" cy="12" r="1.6" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}

            {decided.length > 0 ? (
              <section>
                <div style={{ marginBottom: 13 }}>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 500, letterSpacing: "-0.015em" }}>
                    Already decided
                  </h2>
                  <div style={{ marginTop: 4, fontSize: 13, color: "var(--text-body)" }}>
                    <span className="cc-num">{decided.filter((c) => c.clip_status === "accepted").length}</span>
                    {" "}went to the library.
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(128px, 1fr))", gap: 12 }}>
                  {decided.map((c) => {
                    const frame = thumbsFor(c, thumbUrls)[0];
                    const blocked = clipPrivacyState(c).blocked;
                    const kept = c.clip_status === "accepted";
                    return (
                      <button key={c.id} onClick={() => setWatching(c)}
                        style={{ borderRadius: 12, overflow: "hidden", background: "var(--surface)", border: 0,
                          padding: 0, cursor: "pointer", textAlign: "left",
                          boxShadow: "0 0 0 0.5px var(--hairline)" }}>
                        <span style={{ position: "relative", display: "block", width: "100%",
                          aspectRatio: "4/5", background: "var(--hairline)" }}>
                          <span role="img" aria-label={clipSentence(c)}
                            style={{ position: "absolute", inset: 0, display: "block", opacity: 0.82,
                              background: "var(--hairline) center/cover no-repeat",
                              backgroundImage: frame ? `url(${frame})` : "none" }} />
                        </span>
                        <span style={{ padding: "9px 10px", display: "flex", alignItems: "center", gap: 7 }}>
                          <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 999, flex: "none",
                            background: blocked ? "var(--blocked)" : kept ? "var(--accent)" : "var(--text-meta)" }} />
                          <span style={{ fontSize: 12, color: "var(--text-body)", overflow: "hidden",
                            textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {blocked ? "Blocked · guest in frame" : kept ? "In the library" : "Reshoot asked for"}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : pending.length > 0 && (
              <div style={{ background: "var(--surface)", borderRadius: 16, boxShadow: "0 0 0 0.5px var(--hairline)",
                padding: 20, fontSize: 13, color: "var(--text-body)" }}>
                Nothing has been decided on this visit yet. Every clip above is still waiting on you.
              </div>
            )}
          </div>
        </>
      )}

      {watching && <ClipViewer clip={watching} thumbs={thumbsFor(watching, thumbUrls)} onClose={() => setWatching(null)} />}

      <NextStep onGo={() => onGo("library")} goLabel="Go to the Library">
        Everything you accept lands in the library, described and stamped with what you are allowed to do with it.
      </NextStep>
    </>
  );
}

/** A named pile of clips that all need the same thing from you. */
function ClipGroup({ group, children }) {
  const [open, setOpen] = useState(group.open);
  const bar = { rose: "var(--blocked)", amber: "var(--warn)", violet: "var(--model)",
    blue: "var(--accent)", emerald: "var(--accent)", slate: "var(--text-meta)" }[group.tone];
  return (
    <section>
      <button onClick={() => setOpen(!open)}
        className="w-full text-left flex items-start gap-3 mb-3 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded">
        <span className="self-stretch rounded" style={{ width: 3, background: bar }} aria-hidden="true" />
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2">
            <span className="text-xl font-semibold text-slate-900">{group.title}</span>
            <span className="text-base text-slate-500">{group.items.length}</span>
          </span>
          <span className="block text-sm text-slate-600 mt-0.5 leading-relaxed max-w-2xl">{group.note}</span>
        </span>
        <ChevronRight size={18} className={`text-slate-500 shrink-0 mt-1 ${open ? "rotate-90" : ""}`} aria-hidden="true" />
      </button>
      {open && <div className="grid gap-3 pl-0 sm:pl-4" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", maxWidth: 5 * 178 }}>{children}</div>}
    </section>
  );
}

/* ============================================================== SHARED === */
function ScreenHeader({ eyebrow, title, blurb, stats, action }) {
  return (
    <header className="mb-6">
      <div className="flex items-start justify-between gap-6 mb-3">
        <div className="max-w-2xl">
          <div className="text-xs text-slate-500 uppercase mb-1">{eyebrow}</div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">{title}</h1>
          {blurb && <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">{blurb}</p>}
        </div>
        {action}
      </div>
      {stats && (
        <div className="flex gap-6 border-y border-slate-200 py-3">
          {stats.map((s) => (
            <div key={s.k}>
              <div className={`cc-mono text-xl font-semibold ${s.tone === "rose" ? "text-rose-600" : "text-slate-900"}`}>{s.v}</div>
              <div className="text-sm text-slate-600">{s.k}</div>
            </div>
          ))}
        </div>
      )}
    </header>
  );
}

/**
 * Every empty state answers the same three things: what this screen is, what is
 * missing, and the one button that fixes it.
 */
/* ================================================== SAMPLE FOOTAGE ====== */
/**
 * Frames for the sample clips.
 *
 * Nine photographs of real rooms, each cut into three regions and each region
 * into three frames that drift slightly - which is what frames from one clip
 * actually look like. They are demo data in the same way the names and the
 * branches are.
 *
 * What is NOT here is a description. Every sample clip arrives with its
 * frames, its rights and the gap it was shot for, and with nothing in the
 * fields the model fills. Writing a sentence into the seed and showing it in
 * violet would claim the model produced it, and that mark is the one thing in
 * this product that has to stay true.
 */
const SAMPLE_FRAMES = {
  sauna: [
    ["data:image/jpeg;base64,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", "data:image/jpeg;base64,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", "data:image/jpeg;base64,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"],
    ["data:image/jpeg;base64,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", "data:image/jpeg;base64,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", "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABELDA8MChEPDg8TEhEUGSobGRcXGTMkJh4qPDU/Pjs1OjlDS2BRQ0daSDk6U3FUWmNma2xrQFB2fnRofWBpa2f/2wBDARITExkWGTEbGzFnRTpFZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2f/wAARCADcALADASIAAhEBAxEB/8QAGQAAAwEBAQAAAAAAAAAAAAAAAQIDAAQF/8QAQxAAAQMCAwcCAwMIBwkAAAAAAQACEQMhEjFBBBNRYXGBkSIyQqGxUmKCBRRTcpLB0eEVI0NUVWPwJDM0NUSDorLx/8QAGQEBAQEBAQEAAAAAAAAAAAAAAQIAAwQF/8QAJREBAQEAAQMEAQUBAAAAAAAAAAERAhIhMQNBUfChUmFxkdHx/9oADAMBAAIRAxEAPwDlBRQWXz30xTZpQNSis0gohKiswyBl5WCCIk5I8nw2WVpRg62WFjBzR6pxtGdFpQJAWAJ5BDDM5LZdUTKBMZrHAPNAmFgS7SBzWhZsY3zshMZCETAzQ+SzBC0cFvmgTxKRjWHPogXOMXwgcLLTOSEDW62jIyzYJz7IgTfRMswID5o9FoWLLI5LAHXwg+GA7IjgFiJzRzyWbGWknJDDNyiSG5lZsYBMXBuZSDE7L0j5p2sDeZ4otMgS52QgcSiGgczxK2Kcr9EcDjmY5BCgJAQueSfCGjglJnILaM+SxCBTEcT4QMDVbWwtzyQw/wCimvoPKEcU6MKeqyPT5IFZsGeC2eXlDPomyCpLBbPJAAnOw4JskFgI/isXAGACShBPIIiGoOMATc+E2IAIQTyW9LTzRaZGIc7I4R81g0Mv8yjDjyCMNBzk+SjTgAk5DuUwpzdxlEBx0jqjDQbnEeGfyRqsEEZNBPRGHHMhvRMG1CLNwj7yGBs+pxcfsj+SNVhDhbnc+SgcRybH6yrgMQ2nhHNKW3u6/Bq2jEi20ud+5CAPaFQiDZkcylInN09AnRhSDqQEsDmU+HgB3QLec9FtGEM9EvkqhaBp5QgnKeyqCnNEAfEOyVtGM3k8yF1uEtQAgLrjhK5TTdIwubzlHdkagrrtN0arAWCwR0nqcQY8i4jkDKOEgwGnqukMEXAQFMEm0xzU9K+pzkECXEgIgRYCOquWDFaQFt3fNHSZyRGE/Fi5BOBAsGsHNMaRFhEJMIYceAElT01fVPdRjGu+0/5BWDCLANYFbZNpoD30XvOgavQbt1EAYNgqjowLn3HL1OnxNeUKM5hz+tgnbTIsMLeQEr1vz8kej8n1J5gJht1eLfk893NCZx33c763L9P5jyxsxcLgn9b+ASO2dxsGmOTV639I7U3LYQP+4FOp+VNsDSTsrAB/mJ6Z8/f7aetz+Py8SpTwG7Y6qTja0+FbbNoq13lx9N7wJUWMBu4uJ6qumybXWc97FNtLpbnJVptGHJEAAqpIm2oBpJyRwHUlVgBB9oKuRztdBHoslccFPEcskxkNIjoUWiytziZphz5JIjRUcDuwJ7pY/rCne20ib6IKMVC4CQACZ5hNTAnmU5BSsiboUzrOWMaZpKsvdDHd1TDAmbLY29ghIbNs4BOQ/eGfZFuKDgYHpB/WRIbS7O6KgO83X3omF1iqzXb39mFc+yB2+GDdz/mRC9Fp2ofHsQ7hcvUndtQ3lHXbax6NRNTZtdq2g/hXUH7Z+n2Idwsam2f3rYh3CnPv2J6vv2OF1TZT/b7Qeyk99DCcL6xOkhd7n7Vrtux9iP4Ln2irVFM49s2cg6NIk/JVN37/AIZXnl7pMEd0WZouI4T3QZ7p5rtz8Hh5O3QIawsxwkaWWxAETrZSbQAtdCqJc1UAi3RCpdw6K8Rq0eiUQAAOJTEf1MpmxgVOblON1RwbaCgdpLW+psQY6qzSQXzEShVAc0dVKyCoS7L0pmD1BHCC0JRin0xPNBMWAPsIEJw2w6pWkkeqxjROT6bcVUGs6zSudzZAJaXdFU3lSqgWBLh0QdHZ2AvE7O+qDplK6RTo/wCGv/aK4qQ9Ul9QD7uaoC39NXXLnLqpNdoZR/wup+0UcFGP+VVPJXGHN/T11sbR/wBRtCjv91un93S5tPT8lvH4ipVWjAY2Es5ybKJe3+8V0pc0i1eoeqqS7/1sxNxHNt0MLntLWEtJyKDwcPp9R1kKmzjI6rtZo43BwYm4eIWYyGtHDJOw3RMW6Ika0C3LqEKljPJM8gNBOSSsMUA8P3qkug/7pYE4Lxnop7wkFuGABmieMlbUyNiDcRKzj9VIloqE5ujJUxWlCha9pb6SkGIPztGSQYXvaRLSJgcVT4kFi4yeEaJg3DRDZPVISU5PpHVLAyzYuYESrU2F7gJAFpKi0zK66QDQOai3HSR6GyEMpwAPcfqupr2ybDIaLgou9B6n6q4qXPb6Lz8rlcOfDa6iW8B4U6mHCfSMuCTeWU6lSxUW6jjw7rkMkelvhRdu8TvQ3T4Qg+p6x0XO6rJfGUhTO7px4Vz7Qxr2uIaPcdFxMbDZ5LsDpYf1iuWIpFeng9FnYlMe3os6Z7LNsB0Qcbjouzmc3ACmRAPRAwHzqUtSphBnOEpWPtQxIOPpSustUwQ0Yi6L5LCbg3CErAoIlrXPDjm3JGfV2SzdAkYhxhZQlpLnSZBGSdxsI4qRDi6Q6BGSO6eAwCobm5RpxemwBpi0ArpbIIUGtIkg2iCF0AS4XC5Wu0itN0M7n6qmPPt9FJnsTtYTMCR/JRy8udkUx+lI+pOqxDh8J8KL8WIggiBmVDceMXe/19lEuu7qiTidYqZFz1Wi+MIw+jufqoOP+z/hV2Wpefqov/4f8K6w1IH0g8kpP0R+Hsk0XVyM64iYUi3GQSMgmJhE2VJPDsIBMxxS4Lkybob37pRa7ECQ02SjRIShsZE+VqjywgYZnmkNY8B5WOqYUMDZnVSFdxMYdYyTY3n/AOIUqEwceXhRaXmZt2VAHGLx4U1U1dlV41+QVm16n2vkFzNadXjynDWz7/qouL/l0jaKv6R3lN+cVNajv2lzYWYYxf8AikbRYGwXuPb+aMjdvh1mu7Wof2kG1jMhx8qILGtgA/JYOa6xkKbFzHT+cPFzhPVoSurtJ9VMfhMLne1/9m4dJUnVKrXOxs9IiDGa3T7jJrqx0cMetvUAqNXCaZa14NouCFPfemSNEm8Y4TPlVINsF4MZA2iyk44M7DonW7q4m2JOhzSDcFBvtuqEA6JS0QqQpumfZCOBoyACjvKpy/8AVOzGQcUz0VuZ8I4BaAp1GvPtJHdJuqhzcf2litC1uIUtwdXBEbOOPyUk+Jo+IeURUYPiCUUGakpxSp/ZJ7oU29ZxPhbfsGhTBlMZU295TDCMmMH4QpUmdpa34T5TU65e2WsVMZ0t0CBqHVx8oPcrnVTkw+ClJc03F0XVBq4eUrXgmQeiLDKcVhrZO2r9k+CkOF3uaDzyKmdnaXFzHlpPH+IW7Has5zXe5oKm+kwyBLbdUjm16YmMQ4i6Tfj4h4TILRdRI9rh9Eh3jeMeVQPaciiqRUd8RMgGOBWFZpEkOHUKpAI9QBUzSacpCUuhYkcR5XPCzgDaE6MWxt+0EN43ipkXWC2tim8bwPhbecikCIRqsHeHgtvHckFkEcboz+S0ujMrQiAsxTOpKEXTHJaLoIEDhkjp3WOSxyHVZgxuaCZ8phVB9whIckD7UHV2u1ae4WcQ/wB7Wu6i/lQda44LCq4Hitjad9Cm7IlvI3CmaVRntMj7pVN43W3VHmFUTXPvnt9wB+SffN+IEJ3XEG/VI6m13EKk0VlltVNaCc4WCJEoEAwLwsWb0NkcplYZIhBAXumWGaKxBMgjMQsQcEIuUxWGZQxSgdOqYpSfb1WYDkhom0W0WYrkhb6gqOvPJLF1mA5oaWt0THNDRKaAqOGcFEPbrbql0Qdkq0KLDNLIEItN4APhAMTeBmiZAyk6LAOOTUzaL50C2ErTmOCYJ9xPuf4Ts2emNXHVGFzlwGV0Q8E2XW2jTblTHcqghv2G9kbDlcYa8mzHHsnGz1nD2gdSusPnJzj0C0E/Ae5RpxyjZHAQ6o1vRM3ZWDNz3fJdOFw+y1Axq8nottORIUKbcqQ/EUtak2o2DhaRlCsQPsE9VodFg1oRpx5z6dWlmC5vFZrw5tiu5xbk6pPILnq7K15xUw8O45KvKfCTtUuZCD95TneN7hBrpMzImybBKZyVw9KYm6B9qzUlxzHFB2S0kgyI/es5IXBaMgjj6IABGBwXRyg4ymknTyhkEA4lGK1QF3IJgeL1NEWU2KiwLObk7XR7WALldUcDZM0ki7ipxWurG7UgLbxutQnp/Jc4A4T1ThxAspxSuJulNx6/zRxP0DW/NcwrPc+JA6K2CRck9StjaLjHuqx0gJfQfhc/yUQAMgAkrVXMEiO6zHBdkGBvUoEOiS+OgU6bnVRLnEdLJhTbOU9brZg3SuFJ1iS8+VzVdlvipAt/1wXYTAsoGq5z8MwOSqUWOMvLDFQRz0TlwLV1VKLHMOKXdSuDaG7q7CROirNTbhnC1kHGXINcSFnmHjmgv//Z"],
    ["data:image/jpeg;base64,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", "data:image/jpeg;base64,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", "data:image/jpeg;base64,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"]
  ],
  relaxation_lounge: [
    ["data:image/jpeg;base64,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", "data:image/jpeg;base64,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", "data:image/jpeg;base64,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"],
    ["data:image/jpeg;base64,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", "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABELDA8MChEPDg8TEhEUGSobGRcXGTMkJh4qPDU/Pjs1OjlDS2BRQ0daSDk6U3FUWmNma2xrQFB2fnRofWBpa2f/2wBDARITExkWGTEbGzFnRTpFZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2f/wAARCADcALADASIAAhEBAxEB/8QAGwAAAQUBAQAAAAAAAAAAAAAABAECAwUGAAf/xABGEAACAQMDAQUEBQgHCAMBAAABAgMABBEFEiExBhNBUWEiMnGRFHKBobEVIzNCgrLB0RYkNVJz4fAlNDZDYoOSs0RTY/H/xAAYAQEBAQEBAAAAAAAAAAAAAAAAAQIDBP/EACERAQEBAAMAAwACAwAAAAAAAAABEQIhMQMSQRNhIlFx/9oADAMBAAIRAxEAPwC5pMVWJq5jwsqb8frA4NFW+o29ywVHw56Kwway1ggiq7Vri9toWe0hjcAZLMTx9lWOKgv1BsJ8/wD1t+FENg71oEM6qsuBuCnjPjinYqYqKaRQR7aTFPNNIqBtJTqTFEJUR/3tf8M/iKlYhVLMQoHUk4FBPqFmt2mbmPGwjIOeciqDDTa6GWK4TdDKki+anNP2igjrqfwPCuz6UDMHyrtpp2TSEnzoE2eZrtq11JQL7Ioe3bFzd8frr+4Knoe3H9auvrr+6KCgW+bftmUq465qUXA6g/Kj9a06zR2VLhEdesUmePgfCs8waM+ycjyrWS+NzlnrXaPrC3RFvOwE36rf3/8AOrC9/wByn/w2/CsCkjFuMg+HNGRaleqjIZ3KkEEMd341MxLl8bYsuOtNLCgNJ1KK/hCkBZ1HtL5+oo/isoQnNJTqSgb9lJzS9enNcxVerKPiaCo16Q5gj3AAnJznA5Azx5VU3ESx3G12IZDyqtyMfqj1PUeQ4o3VZw+ojgOAyqMjKnw/nS3NuI5nRiheJ+5Z/wC82f0n2fz8q3PEM0KRvylIrOrAoVBUcHGOnpxgfCr41k1nFlqLsEG6OXGQeDjr86Mm7RSj3FhT5mpVk1f120nwrJy6/ct/8kj6gAoVr64uD788vwJNRcbN5I4x+ckRPrMBQ0mqWMfvXUZ+rz+FZRbS8l5W1k/aGPxqdNG1CT/lon1m/lQyLyTtBYJ7veyfBMfjQz9pox+jtGP13AoROzd23vzovwXNTp2XX/mXLn4ACh0jk7TXJ9yCFPjk0I2uXgd3WdUMmC21QOgx/CrdOzVkvv73+LU620iyFzcIYFYIUC5GcZXPjRNg/XbGTUe0TQRsqu0YOW6cLVQ3Z67eQrHskIODtzj8K0jNntkvrCf3KK0Lky/4h/hXRjcebXMTRsVI5UkH0xUtnG0ysSx9mrC8QfTdSX0f/wBi1FpUe4TD0pb01EUcc1u6SwyYdeQelGRdprtXKSpExBweCKQp7K/AVTSMI76QspYBjkA4rEmtWtna301xEHIUZ8hQ17rLWkmx1lLeG1etD6bqtoY0iyYzjgPxmrSJIXbIC5POagpvyvcScQ2c5HqMCkD6rOfYtAg82atIkXkvyFSiNv8ARoMXcRTyzDDhRuUZz5n/ADzVrcW5jnYd85eJvonMh5z+t8OnHxqTVoBDIH7pZGVuF2bgxOAAfjyPlUVxIA2NpKLGYu9OOYyeZOvUE4rTKnls4op5UaZiQ7IOc8Aj2v8ALzq6stCsjbxySQe2wyQxNAEmW8ETQd3I7BWAGMY4A+PjWnKhRgDgcDmpQJHp1pF7lvGP2RUwjReigU4n0FIWNFdgDoPupeaad1JzRDqEkvzFIRJaXAX++FDD7jUsjOvuJu/axTN03j3a/DJ/lUU+K7hmH5uQMfLx+VVNtrkX5TuFZGRGI9snhcDHNGXVubiIh23H0QA/YfCqY6MrtsUzYzySeAfjiqNNqV6lh2oS4lDFFiAIXrypFN07tHZ2bybo5mDMWGAPT19KmuFV+2NurqGUx9CMj3TUul6daXMsrTQKxWQgeGBgeVbrHWdsxcTRTXN3Iiuneq5G7xywPz9Kj09xaw3Mj4GFyucjcfKn6jD/ALQvYwzhYu8KgMeMHinaF+cEySAOvBwwz51L42jiulkhXePzgGCqkH7/AAqpukzcueSSTnA6VfzW8Ic7YY1+CiqS4Zo72VUYqA3ABxipPelvjV6ZoUF7oFq0kOWKEll5PU9RQsmh31kd1jPvUfqNzWl7LtnQrM457s5PmcmipbVGv5JnlPtQ47vPAIPvfwrntXGPt9aktJNt7A0JHBOMqau7fUbe5xsbg9DnIoySzgukZeJQo5Dpj5GqW47ORBy9pI9tJ1wOnypp/wBO1+LGx8gDzJwMjp8OvX0rOz3XtEiYEdQCBjnwP4sP7xFWV5HqUCqLyNriJDkPE34jpUlg2mXEoQTTxk+DsoOfUbfX8PIVremcD9nUF3qhk3GTu1Lktyc9Bn1/jWmaM+C0zT7S1gaVoMM+drNv3HHhmiyKWgNo2phjPjijCo8qjYDyoBSlNK0QwHlUZxREBHoaaR6VMcVGaAZ41+kK20btp5xz4U40rn86v1T/AApgYtnIxgkcHNUH3Ax2xtPVB+61F6GcyXH+IfwFC3f/ABfZH/pH4NU+iOFuLlOd2/P3Vu+sXxmNQGNZ1Aek1N7PDM0/wH8afqPOt3/wm/Ck7NDNxcfAfxrN8biS8OzcfKqC7GZ956v7RrRX6ZLDzrO3mVue7PVMDPnU4rXo3ZbP9H7Ly7s4/wDI1YSFRMQQS3dnnOBjNV3ZbH5Asuee7Of/ACNWUm/vTtXK92eduec8D/KsX1v8QQShi47oLhCc7yc10EhMrAxRj2CQwz8qWAXIdu83FdpwSoHP2U6EXAkbfISu0/rDg1WTEQyy4eNQpB5RSuOKAu+z1tfEd5b4J/XA2kVYwrIJ899uXByDJnwNNiCidSbhCQeR3mayrC6j9I0HUZI7S6kLodpDr4Yz18an07tVdiJ0uIlndDndu2nHy5q0iltH1vUWkkhMQfGWxjOB0zWctIkl1W4Qe40gXjyJrSNLa67Y3j95Ex3FACCvI9Kna+De5DKw8wAB95ql7OaNZzX9xFNCJk2nG9sFcSFcj7AKs9T7Pm0nRdNublCAXKmTcABjPB+NX9Q9riUnIt2x6sKazzn/AJKD4yf5VRw63qtvMYrmBJNz7VZl24OAccehB+2jf6QwtMsJt5FkceztG7J8sUBp+kHwhHzNNKTnrJGPgh/nTDqEW7a2+M+UqlPxpwZ5VDRbXB5BDZB+VBG0chlXM2OD0QelNER9rM8nvHpgfwqG4W9+mJ3axbVUhgz+f2Z+VKkdyFPeNCTuOSARQaHUYlHaywIGPZH8aG0rjWbj4HwpL25z2msORxtyT9tdpzD8uy+qk1Zd7S+KLUR/ty9/737ppOzAzdXH1R/Gl1H+3bz/AL37hpeyvN5cfVFL4om9GJD8azGo/wBpS/EfgK1N8PbPxrK6mf8AaMv1h+FOJXoXZSRToNmMqCEOeefeNWUn6chmGdhAGf4VRdmnVdCszkKWUjp19o1atJ4tngYB8q8/L5MuOlnULbRwh5CkinKEEBT86W0EKsyq43lDnEZHFRJJ7QJY+uPGponUsSY8HaR72eKs+SfqWEtjALkBWIcg4Bj254pY+5+lRZDh93s7kABqMvtHu4bwIYmlR+ckjHgDU/km9M6qlsbW51a9WS3R1D8ZXp7I8qy8RS2v71zuCRtnCcEAZ6VrIGP5Y1EgYHBx+yKzdkivrNwrAFTKoIIyCM12l2J+rLskXW+ZoWVw8e5vpHJCmQ9MeOa0WotILz2VQt3EgPJGBxz8az3ZiUxatc7W2gRt4eHetxV68zPcMznjuJOn2VPtPthrKtJI9/brPBsX6WxLBgwz3SDHn0AP21Csixava4UkiYEHHHvr4/ZVjjdqVrnn+vN/6EoLu1OrxRuN0csoV1I6jcAR99a5epGq1vbLpREm7u3ZNxzjjd4nwrJXun2dvrKpp8nsCHdlJN3OOea1F2qxWPdIrKAyE8+9z41VavAjdpAoUDFpngY8Kxwz69L+9KqwiaTULBQGLTSbWKuQ2Oc8itNN2ejsoLiaOe6brIQzjGfI8VW6XppjuNInYYkmnlKsh52heAfXr860+qQl7GTCscREkA9K1SM/e/8AEdj+x+Jqaw47QP8A4Z/jVdrGoourJNbkSvBjJ/UDAk4J8evhQD6tefThKkyQs6kFol6D7c+dZ+OX6zSzYI1H+3rv/vfuGu7J831z9QVV3MkpczNPI7uTuYnk5GPL7KI0WaWC63QtguQvhyK650Li/wDfPxrJ6p/aUvxH4CtPcTiYFuOGIOOmRWb1CGSTUZisbsMj3Vz4Cpx9K2fZjH5AtsjnBxx6mrTHHj8MVmdP1S407TYIRZlk2nBc89T4eFTL2jlUDNmpJ6+2f5V5efDlbcbjQjOMHOfSuYkE9TkdMVRf0jkUZFkB+2alsdXvNQfKWQigB5mkcgfZxzWL8XLC9LEzbMbmwGbHPnUsbbiSRwBxiq+5vLSWKWL6XEj4yd2BtH86It721dh3dxCXC8qXANWcbiW8aitudS1A+aZ+4VnbHjWrg/8A6ofvq0vrS9n1BmtAe6fGJMjb8c+VAzaXLavczTXVqquFXIkyQcY5AGa9PGXE6Edm2P5SuyELfm2zjw/OtR/acumkQvEWDMM5TOTk1W2PZi5so5Zrm7EHHJjc9Ov+hQz6pZ2sR7m/muXwVVG3AL86fX/LU6Tacxa508sct9MbOTz+hSoZQH1uCJvdaXBx6sKAtJII7uKaK5QTqch2JCqcc5GOnJFQzXCyXwkmxL7XJjOOM+BNauov/wArd1pYttql4kB3nIyVOMAfDH31NPIJtdjkDbt1nnOc+FZdrsJv7iHYHGPaOSB8ada38llcI62iEhCMFjyDUnHI1saTTtQ+kDTF2+1bSzLtU8kbMg8/H7qB17UbuXU5EViqgLtC9WABxwPtqu0m6uLfVLWbutoaTqSACDwfuJq+mWzl1oXJlUymIge0NoxgdfOljKvnXvLS2WND+gU4wcnkkn55qCa0MJtJJDxOjsuOeBgVZXIthFaxRTB+6jEZYREbuevX1oa8w50/bGSBHICoQ7jg88+J/DxrXHGr0Bu0DQAJvJBHXx/1x99PtEngbb3bLO3EaMOdzcL+JP2VK7TQkMkTxNyQxU9R4jPlz91QyXU4uo5BIwlUbg3iMA4/E1pFxPZy2sIQQyCOMY3FT8yafpmkJfQvctcSx5YqBGRjjx5Bqjn1S+nQJNcu6HkqT1xR/Z+a6sklSDu5ogNxyxUA/aM1mcZ+nK2eNCmkwpEql5GKjBZsZb1NNbSYz0ldfTaK7Tr6W7RJXCKrrnbngeXPnUt7fG2MAUQnvZBH7UmAMg8/dVnHhZ4x9ue+h30oKjN9IfgZ/RrWaMkupBrdFB7weydu3PI8fnRfai/uUuREWKBVB2xNkc9ckYobQZUgjluTBLI23u1I/V8TwT8OlZ+vH8jc5cpO6Bm0yaGPIZJAq+2FPuehPnQSs7zRrznIHvYz/Kpbm4ZmzvJG4ttzwKHhV57hEQe07ACrIlmNvZassESRySRqiKoCgZ28cjI8qzVxNG2qLdOTIjsHfHsnHiPuo+Hs/K4Pfvyenj+IqSPs9GjYMjfCqTpHea4dQtPo7rhFcyBskknJwPvrNuQTx49a3EmiQpp+I1G8sACfjWJnUCdxxwxH30gM0ruVimlmgWcRjIRjjNFNc2c6mOPTY4nPRw5OMehoTTxm0uh/0ikVMAnjG0/galWOc20NwGaFXRTlkDYyPLOKubPSbXVLFbmK2+jKHKkZ3luBz6VT2K9zMkqSosiHK5APIBPj6j761Mkk30C1lErBpIVdiDjJIyaSHK/sBQdmrdJS026RMcKBjnzzQeoRaTY3HctZTMcA5WWjvpNxj9K5/aqu1UCVGLLl1HvY5+dVnU5kVQrOdo68+VGWt6XvbOVkIEaOFIPte0cg89cf/wBqj+kgzqCAYwfHq3pUX0lmm45J4Cr4elcuM5RPtb60OoahHcsuNuxJAR7Q4GMMB/M+VBRgNdoiIWYNjDDggjHX7apZS8LbN+cckDwNPSd1ctJ7TFcfDnrxWrOX+zavLCygupEE3sRxqwIU+0eeOfPrSXN/Cs2yG0gjCcD2SxPx86F0yeGSJhOkrSbgVdf1aHviY7iUhiCSACOKvHcyrO6Nl1C6KbWcRR+QxGPlxQVvfLbXKzTXLTlHDBVGfsJNVhJY5PJ8zUkERnmREGSzYFaVvE7Rwd2Pz0a8dOOKrdd1mK6tQIpV3g/q8HFUv5InPIYgfVrjpUy9ZPmtLaSRWkM7/GrLQQbbU45jGJWXOxR5+dMXTXVs9591F2lpJHcId561Bp/pzyAd5Ayfs4rgyMc5x9tMkRjGMtQoRgetRVk0jd3tV8c5zVRLoFrM7MdoLHJIWiHztAzQDMQ56/Ok06O/o7HGrCOXaGGD15qBuz8mCFmU5GKmEzjozD7aUTy+Ej/+VXs6VV1YPYywqVMjO21VU4J4x1oubtGUk7j6IYli9gRZB244x0pL+WQzWjZMjLONoNVV5k61MWXaTO2RnOOaQWY7QRMcG25+qtH2f0fU7Se6e3RY1YI2UGXJ58Ky6j+ut9Zv41ptA/4Ym8c3Z/dFWepfNZtUYvgts2rk+gpinC7lByTx6UqrvUscAn1pFl2RFGHiCPOjBhxyetSQJK8gjiVmZuABUQILDNT2k5trmOZGIKnnB5weCPlRRdlazFRKshjU4HOVLDz/AJfCh9RBSYx795z7x8eKutZ1d7q1WJ1V1jACHptHpis4T3khJ6AE1cxeNIAoPnz91XvZy073Uohj9FAZD8W6fcRVIMeyoxkrj7Sa2PY2JGfUJA4Zg6xj6oBwf9eVSqsWhKjABoWaE45FXToB4UJcLkEdKmrijeEFqdFbkODRhhwc4pQMHkGmofghcVCxxUjn+6DUDHB61FKzDHI+6hJAuaILnFDyMeeKqIjt86TcKRiPHNMJWgbNL3M1rOCPzVwjY+2qy6mDas023OW3You/IWJCSdokUnHXFVjyL9JDjLKPTBNUypBIv5QZiCA2fDpkVZadfvb6YIFWTEtwcZAKk4GfUHkfOq+xVLrWIUfIWWRUyByMkCtLrehW2lahpkFsZds0x3F23c8DNP7X+qzUibGJH3+FDOSJDnBPrRUxoR8ZrUjJtcODXZpM1RNJOzLtJ6CoR8etKVOAfOk5rIO0/Tmu3G51hTxY8n7BWg0WNdL19obeRpYJIAXJ6g/6/GsrE7q3ssw+BrT9nI/akd8s5HWpWo07TA9Dmh5XJPNRs2OnAqMyeZrClJHlTCRSF80wtVQrsPOoWalZuKiZvMVUKTnwqJwKcWFRsfWgjYeRppGetOJ5pCfCgEv4i8AAIbDAkelVs8HHsIQauZQCOah7sGqaq7EvbX9vMUJEcqt8iK2/beUA6bdQt7SOzo3h4EVmjCB0OD4cUVqd8bjT9Pt5CPZ3pvzxnjH3/jS3FndZ1pM1GTSV1aZdXV1PiGZB6c0UZ3SKoBB6U0xR+fzFK0hAzXRqZTzwPOohYoVLDBBrQ6Vujb2c8iqeJAmAtW9kxAHOKzVi1YsTUTmnq+U6gVFIeay0jYioy3rTmNRnBqo4tzTGekbAphNVClqYWFITTC1ApPrTc0hNJmgUtTQ4zyKa3SmEnNUFKVPlVfqib+5jDYBY/ZwKJjY0y5UP1GRQUVdXV1UdUiAjBFMqZOlLQ/fuxkdKIjII8qgVTRESN5YrOrieMc1YWzYxQcanHnRCAg00xZo+RXGg0dhUokYjpUVI2aifNKXPlTS2aIjY+dMY1I3NRMBVQwmmlqVhTTQIWpM1xNIeaBCeKaM07FLtqhUNc200gFcQaChxXfDmp9gBqQRKPCmgZQTjjiiETPhUixqD0p4Az0rNqujAX1NTKRnn5CowKmVRxxUVLGc+FEouRUMQ5xRSDiinqtPApUAIFPIxwPOoIiMHJp6oMAnx8KcFHPHQZpR16UC9yp6gYPnTWtEPmPgalFO8SKaYDaxJztf5ioHs5R0UH4GrMnCkjrS+FXaZFK8Lr7yMPsqMrV44Gw8U3uI2X2lDceIq/ZnFMFNOANWzWMBHClfgaCuIVibC5PxqypYgC+lMZDipwBimMeKo/9k=", "data:image/jpeg;base64,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"],
    ["data:image/jpeg;base64,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", "data:image/jpeg;base64,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", "data:image/jpeg;base64,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"]
  ],
  salt_room: [
    ["data:image/jpeg;base64,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", "data:image/jpeg;base64,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", "data:image/jpeg;base64,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"],
    ["data:image/jpeg;base64,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", "data:image/jpeg;base64,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", "data:image/jpeg;base64,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"],
    ["data:image/jpeg;base64,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", "data:image/jpeg;base64,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", "data:image/jpeg;base64,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"]
  ],
  reception_lobby: [
    ["data:image/jpeg;base64,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", "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABELDA8MChEPDg8TEhEUGSobGRcXGTMkJh4qPDU/Pjs1OjlDS2BRQ0daSDk6U3FUWmNma2xrQFB2fnRofWBpa2f/2wBDARITExkWGTEbGzFnRTpFZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2f/wAARCADcALADASIAAhEBAxEB/8QAGgAAAgMBAQAAAAAAAAAAAAAAAgQBAwUABv/EAD4QAAIBAgQDBgMGBAUEAwAAAAECAAMRBBIhMUFRcQUTIjJhgRSRwQYjQnKhsSQzUtEVNGLh8VNzgvAlVGP/xAAZAQEBAQEBAQAAAAAAAAAAAAAAAQIDBAX/xAAkEQEBAAICAwABBAMAAAAAAAAAAQIRITEDEkETBDJRYXGBsf/aAAwDAQACEQMRAD8Af70jzIR6jWStRW8rA+k4g+h6wWUHzJf9ZphZedeUEZRdHI9DqINOrVZcxQEehtBswwDbi8HKRsx99YArL+K69RDDXFwbiBFyN1+UkMDsZ14NRlVCz7CB1WoKa7XY6Ko4mRRQpdmN3bzH6D0gU6bZu8Y2YiwU65RyllyNx8oFoaX0sS9PZtOR1igYHYyQ0DUp41W0cZfUaiMKyuLqQR6TFDw0qlTcEg+kml20qmGpvsMp9IrVwjpqBmHMQqeOYaOAw+RjNPE06mzWPI6RyvFZhWUtTsbocp9Nj7TbqUUqeZdeYmZi1Wm1qRDnjwtCWFjUyC9Twgfi4TgzVB4PCp/EePQTgmuZjmb9B0EnIL3U5T6f2hEqgW9tzuTuYUHMV8w9xtCBBFxqIA6cNOk7XmD1lV+TfOdmPoZRadd1+siw4G0DvLb3EkVAfWBJDDkYBRb3ylTzEMMvTpJB9bwip6jUxcNm9DCRHqMKlRCAPKvL1MawbUatQmqPAu2lwx/tHjh6FXVD8jCyMudaaD4A8CD1i9TCun4SIXRYgHcXg2I2J99ZaabDheCRbfTrCAuRuPlJDA7GTBbLa7WsOJkBhpJqhdDqTsBuZT428hKjmRcyVGT8O+5Gt4F4r1Sti5Vf6QbwC54jT0ghgdjOLZVJsTbkLwJBB2N4QlaFaqBwDrtcWMIBhsb9YBiRkF7jwn0nBhx06wrgG3HlARvyJnXPMQCg5Wg3OawYj0IlFucjgZxqA7gQPEOR/SRmPFT+8A8/K4gNVZyUU6DzHb2gFg/hp78TbyyVTKAF2+cBhMQUAGWwHKMU8VeJYS2IxDUg9iq3JAv7Rk4KsNVyP72ja6rQo4p7gAsSeG8aGJZfOo/aJ4OnkCZhY6X6zSKgwqovRqeZbe0BsJTqDwP9YbUFPC3SZmKr9ziHQsbDYQicVR7p8q2Y8wdusX7sg3Y5j6jaccSrcZwqX4gyILXlOBvIDQgQeRgQQDuJ2U8D85alJn8oJ6C8FkqA2y267/KANyNx7zg4byjNOyC/iuT/AKoeW++sgHKW8x05CGi5PJ4fThOC8j84QHpAzpMq15kQwTzlXQrSylTFSoqZgpbYnaCgZmVQFJJsLm0bXs6st2y5ieKm/tC6cvZLqtqbo/EkHeLY7A4ilhqh7thYbiMmjWTdWHtKcVVrLhKoztbLteNmmd2KMmJf8n1E2kqaTG7Na1dtfwzRVtJGocWppC74qNGI05xRamhk57g9I2pv4yoBuD1EzsfTNaq1YPYkXItpDZ/BK65vRbpJaahJiUF22hLUBOja9YFTVFgGmCxJmfapcIZWqeHilq1GPmPsIlSuvE2vHqYRud/Sb2x6m8PjXpKFU2UcI2vaCuLVEVpmqgYaN84NSnWRbquYf6dTGzlqkYStzT9pXVw9Omt0qoeQG8xw+KY2WmV9Xl9OjXf+ZWA9FEqLlqVL3YIo9TrIbE018zH2hLhKYF3Yn8zQ1pUaflCj1A+slsndXTOFM3vpeEEsLkfrMtO1sSN0pn2I+sZo9rVwwcUFuOTETRy1qWGosAzVSrW2K7S9aFvJXT52iCds1yoLYZiDyKn6Q6PbFOrXWk2GKsxtqg+hksalrST4hfK+bo8o7Rr1Bg6yugzZDuBLXVLglFVN7g69Ipj7tgqroyhGUm1uE5XKS8O+PjystrJ7OscQ1wD4eMfCrl2A6aTP7OP8Q/5frH3NlE25Rx0QkE7c5AqMFHi35iAzeC3pBbZJFWF2BC6RXtHtGlhKQ7+6hiVBGusY3qLMX7U64ej/ANw/tIVanaeEqKB36Drp+8aGIpOt0qI3QgzyBXwggddISr/DkjQ5h+xluKbetW2X3jVJjf5TxCVq9M+CtUXoxjadq46iiFa5N7+YAyaHsKT2AHrGGqWE8fQ+0GLDAMlJteREZH2o8RFTDEWO6tGqj0lSpdSLxVqtVXOSowHK8VwHaiY8OadOoMtrg2jJI3IYdRMXauXG1lezBWHO2sk41nXMgUKdA42B5NxErUK1QXOhPCaK9m2Pe0X71diy+a3JhxnPLH+FlYtHB924ZvFYjQcTNBaAdAFVQw0IvcmLgoourEHbfXlHKNQAABkItoCTPfHJNLDsumQ6G8Huaa12zZFF+JIYe8t+Iy3GUH1uYjUrZ3dmW9gbNeefz+S4Tl6/03inkpvEV3p1yioGLIagLHS/ID0iWJxLfDPTqBs5JbkBeDVpGpQDVAL30I4ERR3qtSzVAAScug09p4ZlvKafRylxwsy/ir+zDfEP+X6x6q3hFpn9ln+If8n1jjn7oH1nutfIiKhsl/SG48NOU1dKUubyU+km1TqKgmP9qbLh6N1J+8PG3CbCn7wTK+1Qvh6H5z+0TtL0w62NWrh6dLue7yCxZTq3WVqV+HIW/mG/QwGXSGuUUDmNvEOF+E2yq47S5x93T94NTuiRkqk6a3QiG1VVpKMge9/FtaACplqrrxBlhwpZqt7jLqNL5tZHfrVrq3dlToND7SU7NxNdTVpUHdMxF1EDZ+zKlVrXBGx195u28P8A5TD+y6lRXBvcW395vcAPWYs5ShpU7uo5zVp0LMArZfURKiL1F6iairaoOsesqbeXQOtrDECx020l61yPK9S4P4rTMRtYwj6T1RDT1S2pMXqVlWzJmWpfe+khn0MWdtZjPDHLXtOnTDyZYb9b22KmHNfFVKSm9kU3JifaNEU1C08rKBqQNB0M0sOf/ka//bSUdr1Fo0DSUoO8BYq2/UTzZeCb3HbD9Vl6+uTL7N/zD/l+sdqH7pesR7O/zD/l+sde5QdZb25wNbWn7S0nRNeEof8Alw83lkVcv8yZX2idu7wwABvUI16TRV7PE+2KluzaluLqD0vE5qV57GuGewphCuhHORTpd5hKpAJKWYARijhKeKbEHvwlQM2VWGjcd5R3j0KBZNCxsflOk4k0zeVdVaPwtFkNqtyHGvsZq9i4HB4zCv8AE6OjeHx5dDMl0q00GegVXgSpEIU3qhMqnTcDrLOEuvgqtDucc9Maqr2BGtxeNU+2atIOFpm3eFyQ5GpnoaPZ+FN2bDoBeygACJdsYHD0ezK5SgocsuRlUX312mvWzlnfwH2cqd42JfLluQbXvzm8uw6zz32ZBVa4IIN13956BDoOs5lX0f5iH1E1VzMVNrAi8yaJ+8XqJrvU7lENgQSF3taah28EjayK7OEbIQDbj1jCdm4z/wCu466SKvZeKcEFFUEW1qKPrNeTnF28GXrnveu/+FkFWm7JWILA8PUSS0vp9lVEJvVoi5vrVEMdlk74qh7En6SeOWS8L58vaznfDVwVQv2niQbaIkHtvJkBakWbIbNfRdYth0r08RWqCquapbXJcae8sxtWp8DV75wxtYG1vab1w85Hs3/MP+Q/vHSfBb1mf2e4GIb8sKv2jTpuaZBuLa9b/wBp59W3Udt6nJpj937QcwGT1i4xSGmPEADCNQNkIOloss7NymAfvFmf21SqVqdFaZYA1LMV4A6RsVAKguRp6yxMTQopUarWVPA1gW3PKTHtL0we0ezGwVDvBXqVDnCWtb6xIAnCvcknMNz1mv2hjKGJSlTw7+PvQ2pHT6yR2EQrCriHU75RRJuet56PXd4Zn9s/F3+GBYr95ldQGuTIwWDq41hSpAeUlieAuJqf4C9ZULNVOVcq6AWHuYVPsPF0MxoOyki3mAuOWkvpy16SfY2qSk00ubWJ4A8Yj9pkI7JYHxG41/8AIRoVq9NQvw1U29JV2q+L7Vwr0+5bPlA8Qygi44y3pyZP2cISnW6j6zcSsoUXmZ2X2Zi8MlQNSVSbWs4Me+FxNtVJ5eITjcbvpabTE06L0zVcKGYAE847XrfEO572yZgoAItsJn4fDOcVQ7xTlFS7G4Nha06rR+LeqlBlHd1y3iNiBYibwnyxOSAphtyT7wloqPww81trTi+k7IkUwNgIQ0lXeEcZBYmBcaoXjE+0a5dAq7De6wybyrEWNF+kzl0sKYdj3jWJGnCRfNUYMSevvOw38w9JDixYzz/XX4YTCrUC5EYkEEWudby9cI1OmVNJgQdMyxjsKp/DOA1mD30Ou01BWJ8wDdZ0mHtOax7arCOGqlbBAPcSauCTEIUxAGW3AXIPpym01DD1drofSUVsBUCnIyuPXQzP48pdxr2leaqdiBal6NXwi1s+h/Sb/ZFKoMGRWqNUYOdSb6QEw6LTPeU/Hcg3a1v2H6x7AqvcHKLDNqPbqZuS75YtnxPdkbGTlb0l2WdlmmVXiHD9Z2ZuR+cuyyCkCguw4N84Jqt/rjBSDklRR37D+uR37HWzy/u5IpyjI95G31nX1tbaRpuekqpgnSTubXkHQ2I/3gCW9jKsQ33Lj0lhlNZGcWF9ZmkL4M3qt0gVjq3WFSV8NVvUQldidpLUjW+IcKaarqmY+Y8rmcNXbruaI1aj0XR1ZlPBgbGaOD+0FVLDEKKq/wBQ0b/eI4nDVPhO8YA5ddDewiIJG06Y4cbna/knWU3Ht8Jj8Pix91UBb+k6H5RoMRsbTwKVSCPTiJq4PtzEUQA5FZBwbf5x7XH90X8Uz58d/wBPVBlYeJfcS3DhKakIVFze0zcBj6WNplqdwR5lO4jYM3vfLjZZdU7oR5flOyrziYYjY2hiq4/EYQ13fqJ3dmLjEVBxB6iT8Uw/CsC80jppvBNM8pV8aRug+ck44f8ASHzlRZ3ZnCnK/jR/0/1nfG//AJD5wMYJqL8ZxQWvC3EjMNDbfX+8oEAX9eEnKGE5t9JwJ0NtDA6w4DWDYW204iE3MQdRqIAkLa1r9YGijRQPaEdr/MSpyBxkVYaC4ugbVUIbRlG4E8ziKJoVmQ6gGwbgZtVXsbqoueNorVQVb5rHmJnelZV5IJG0urYYqbpqOXGUTcuz/BzAY2phcQKiHUbjgw5T1mDxlPF0RUpHqp3Uzw4MbweNqYaqHpNlbiOB6znlPXmdO015Zq9vagwgZndn9qUcYAvkq8UJ36R4GWWXpxyxuN1R3nXg3kEyokwbziYN5UGDOvBvOvAVABtbjAB1tJzWUfvIOj39ZR17NrrznXAJU7GSDYm+ovY9JW/EcoBBtLQSTe42+sgEkabicBf3/WFcRpzErqJy2lt8psdjIbe94Cb0yBtpKHSxj7i+q6HjKXp3FwP9pLAmwB0Ohi9XDK++h5iOskqYZdxMdKy6lJqRsw94F5qMoK2IBHKK1MGzG9EZr/h4zUyFSVbWudec2MF25VogLXHepzv4h/eYRBUkMCCNwYSMRfXhM3D7i7TyyzWc29phsdQxQ+5qAn+k6H5S/NPDrVsb7HnH8P2ziqIAziqvJ9f13mfaz90L4pecK9QTBvMmj9oKTaVqTIea6iN0+0sLV8tdL8mNv3m5lK5XDKdw5edmlSuGF1IPQ3kkzTCnQqPTSQdV9pw1UjjIG56yjmNwrc9DIbUA+xnKLhkHtOWx04NpADbXhxkjwt6TiLaSF5EbftCrfMNR/wAyvW9pPAi/p1EjUg33H6wOI19ZWy+LgOktBzD14SDYjX/iAs9PiPeVlAw2jbLlGvzlRS503k0E2Qr6iQvhYMpsRtGmW/WVmnaZ0qjE5cSwapTF7WuJT/hiVP5dQr6EXjmQGcBlO8cjNqdm4hDYBX/KZTUw1dNTRqADS+UzYJcHNe8tXEnu2XLe5vcHaN0ef8YNiCOokZ56injk+IaoyNYpltodbWiLFSf5fD+kTNkvxueTKMdXI1BI6SxcVXHlrVfZjNEBb+QD2l9OoqLbJr0EnrF/JWip1vwkWs1r+k5hZ7Dac2gB5H6zs4oPhYGSfMRxOo/9/wDd5DbGc+iIeMK5+Dc4BuNRwlg1DDha/wBYJ8w9YRB01EngCvtIH4hy1ElQASOEDjbcf8SMwMMC9vU2MqOjQqdQLDhIKgi4FiNwJYFFrel5Vcg3HKB2UONfN+8DLeWsouDted5qasd72kFBp3PrBKHjGLbdJzKNvS8BUIwNxJCA8LGWrobcJLAXHrIKe718Q953dDjtwMuXXwnUXtIHhJtz2lFXdwhTsOYlrKFawnWtqNNYH//Z", "data:image/jpeg;base64,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"],
    ["data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABELDA8MChEPDg8TEhEUGSobGRcXGTMkJh4qPDU/Pjs1OjlDS2BRQ0daSDk6U3FUWmNma2xrQFB2fnRofWBpa2f/2wBDARITExkWGTEbGzFnRTpFZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2f/wAARCADcALADASIAAhEBAxEB/8QAGwAAAgMBAQEAAAAAAAAAAAAAAQMCBAUABgf/xAA9EAACAQIEAwUECgEDBAMAAAABAgADEQQSITFBUXEFEyIyYRRCgZEGIzNSYnKhscHR4RUkNCVTkvBjc4L/xAAXAQEBAQEAAAAAAAAAAAAAAAAAAQID/8QAJBEBAQACAgMAAgEFAAAAAAAAAAECERIxAyFBE1FhIjJCcbH/2gAMAwEAAhEDEQA/AL97jSKqMazmmpso87D9hBVN2yU9HOpYe6Ocmid2gVbWHPeaYMWygACwGwEYtQg3BsYjNbcEQhoF+njXXRrMPXeWaeKp1OOU8jMkNJB5F22WVXFmAIlapggdUNvQypSxD0/Kxty4S3TxwOjrb1EL6qrUoPTPiUiJemGFmFxNhXSovhIYRGIw9HKWJyevCNpplZWXY5hyb+5E1lDBbHOdltrJvmZiB4V58T/UARQtrCx3vxlQMrP9odPujb485MC20jlZfKbjkf7hDC9joeRkEod506BDKU8mo+6f4klYNtuNwdxJQMgbqNiNxAMMjcr5tR94fzDnB8vi6f3AMJIG5tI2dh5gnTUxlAqGysoV+fP4wKqU+7Wxvc6ljxMlblNNsEjC6N/MS+BcbAN0hdKUiVHKx9I96DLvcdRFlCNx8pULsw2N+s7PbcESUEgIaSDRTFQbAHNyXeDIzecgj7v/ALvActc3+r1P3uA/uSerUY3Z85/FE5rbi0leBxccdOsIkGqBXVSG8WxA0kso93TpAkISARYi4kQWG4v0klIOxgDKR5TpyMIbgdD6wg38oLdILFtGNvwiBIkLubQZmPlW3q39TlphPJp1kgeB0PrIBkv5iW67fKcEy+TT8PD/ABJ2hAgBTfTY8jCVBFiISoO87y+Y6c4CaWJO4JHSXaOJqMLi5A5iZtLCVVrLnVSvEqZrYRRlYTSiMSDo6zimHqfhPyjGpqdxK+KpinQd10Ki8elRrYFcpYOtvxTOdGJsCVHPiYDiwd2uZHvgeMjO0guUWAEN+ekiHvykg0AwZRw06SQF5M0agXMEYjpAVYj16wlwvm0hKvx0/LOVQNv8yDgWOwsOZh7sN5vEfWHKOnSSAPWAVZl45hyMYCjizC3XaQEOYdekCRpEeU/AwW4EW6wAsPL4f1/SAi4+sYt+g+UA6Lx+EIJPukddIA6KNCBItiaY43gNyk7t8oQoHDXnK5xJ9xGPUQCtWYeQL1MBoqRgqaylntJ95t0jbqte0OpFmMFbEtVpPSa1mFr21Eqs+qyOfx2k2aUq1FqbAB8wPpaK7wKxBNiJYxJ+tXpKrDMz+szyqcIctQAXDRi1n4D4mUilgLaSzQO+bWamW2eK1TqFWDE6jbhL9LtJxuQ3WUAqaWJF5PuSfIQT66S7TVjSGKoVftKYvzE44fDVdUqWP4v8zGrHEUzYU3P5RpBT9sc+4g9dTA0MQppG1MrU+Ogi+9KjxsgP4YtMKz/aVWPTSNGFoDRspPqbwhftVMmwux6Xnd9VbyUiOukf9Wg0+QFpF6ypqKdx+I2mbnjPrXGlqcQ3mKKPTUyQoM27MekWnadM1GS2QjfMhA+eogrY4UrZ3YK2xIuvzEzfLJ8WYU/2Rdyo6sZMUUQXLKB6CZ9THClZWLIG8rHxoYBjWNTu/sah8pU3VvgZi+f+F4NQIlr3ZhzWE5bDukWprqM1iPhMpcVUar3b2pVfddTa55EQ9/Uq1e5xAyVPdcC1zM/mtXhEyq35dDAzEOoDGRZvHI5r1VndU87NxBy+kAqNq1gbeshTPiaFfsyeZkozcT2xhRiWpu5RkJU5lMlSx2FdyRiKZv8Ainnu0gP9WxF9u8MqstjqN5dRnb2DOrEZWBHpGUzZj0nj6oZKxysRa2x9IyhjMUjgLiKg1+9JpdvaZjlXqJYpPqZ4te28dTJBdXAPvKJbo/STEIhZ6FNtR5SRGqj1Rq76xNdydQSNOEwqf0mpN56FRehBmqlbvaStkazAHbnM3aj7TXVT4y3o2sI7QYCzqgJNhfQfPhIORa2o6iOwWHp1y6tVFM8CRdT6Gc8puEpbV67XCq6keZBoy+oGzCLvWHiFULfy1F0VvRl4GaTdntRCqykAaqQ1wPynh0M4YYliTudzbzdRsfhOftpRRKrMRTHdViPHRJ8FQenOWMHg6dTMgUoD5qL8DzEtrhcqBbeHgL6DodxGCkbgm5I2OxEcdm2e+AOFDUnUvh290i5X1ET7GqqKdS7UfcqDXL6dJ6DMzplqLm5G1jIDDoL2KjmDNXx/o2zBg+9pinWOYjy1BuesYMMXTu6pDMuzEb9ZopQW3hAsOUl3QttfrL+KpyefLfWESNPXEAekDfa25QUtcWOk7bXRiDxN1kkBNPpIg2ZjGUdUMmx5HF4hcN21XqGiKhWo1wW0MqVqqVqpcqygm4UWIHpLPaa/9TxP/wBhlMrrOnxgzEG9RiBy/YSNHWqvWNc0u+YPUZeiX4SFIoKgs4OvIwAUzM3C1zJU6ZajUtqQRpD7SoZ70BqCpsbbwKO+plEVsxYWBt6wC2HKd2Rc5hci209jhBfC0fyL+08fU7PxOFINai9Nb2uZ7HBD/aUfyL+0mSGOt3P/ALwlrBUQ2Y8ooasfhLuBW4e3pM62mzRTKpcOQL7CdnsLZVPwjgl0secJVbWsJeMN0mk5NQCwtId4x94yarlqgjaRSncay6HISWGs63ijkRQeUgACbjURpDKRIpOekadD9ncc5BRak/WPuOc1FeRJ+uaClpib+k5tKh6yKm1a/pOLscDoZNDlQRAbRpIP4PjJR57E1LY/Fs9MOi1Df5zMOrzV7dqZsXWB2FOmBbjx/mV8VgqdFab0q4qq1wdLEHpOskjOy6tKmmLotVUmlUCljr8Ygqi4phTOZA/hPMX0jKz1qlTu1QuKeoABPxixmWtZ6YVri4IIIj+U9NntXszB0+zzXwp8dg1s99DvpMuhWOHou2W9yvpsb/xLvYeFz16pqUg91GTNrxm/U7MwppZVoIWFr3UEEzcx2xvTzWJ7WqYpClSmRchvOTaepwf/ABaP5F/aea7dw6U+0rUKRRRTW4AsL21npMGf9tS/Iv7TGR8W18xl7s4kMRa95QB1mh2Zq7HlEFtA2XxQMJCrjEotlewsyre973vwjallUkkAAXJmkLUeMSAFoUrUmdAtRDnF1s249IdwCIGb212guEwjrrmcFbrwvEdi4yriUGTIotfKTwvvbgbyp27Uq47HrhaOJVKdIZ2tsvqTz5CO7EwNFX8NRids2huev8TllLb6Yr0dr0iNrmApc3JuZGvWTD0VLhiCbAKt+H6SSVUfQMC3EX1E6ujyrG9QSBP1gEqL2hTq1LAEH16Ri4hGqgZgTOVxs7jrylPRr5rQqfAesro9rmTSouS2Yb33mRlt2dUxePxRerUpKrXXS9weWszsZRfDYupRDuwSwzX5i89NicfhKVOkjVwxsbhWF1N5lez/AOqYzEtRe1PMraDMRpbb4TvJuRznanSVmxpRbXdABc+gP8RdYg4y4IPl1BuNhNdexjTrI9PEVXqW3FErl4bkzh9G2A8PefHKP5muF03MJ3tL6P4OqjrinAyVBlXa5GbeegpUyW0bjc6D+plYHA4zBOuYPUpqtlUG+XW80KWPxNBiVw1QEixul7ia1pzymq8v9IFv2ubj3F/mb2GqWoUvyr+0z+1OzcXjcStZKIKlbDM+U7nhNBMJiRTQZLWUDccpyyxv6FpaoJsJawmPpImIRai96ota9iDM+nhsQG1Rtt8w1jxTWh2dimqgqxqKV46aan5RjLv2lW6lMO5L1GZgddReV+3fpPTwGK9lGHaqHphiwa29+EW2CqPiziQ9PKX7xRm30H6yli/o3iMZiDVeqWFsqnMD4dbcJ2sxibMwX0gonDviBhqgXCqLjMLkG4sPnHjHYzE0VZaq01YZsuQ6A7DeVMP9Ha9DC18M1ZLVyLnKTYCWaXYDqdcc6rwCEi3zMaxnxbbeyE/5NRGqUgEp3qELYm5Fj+kZ2b2hgxUYpWJWmQVLGy7a/rH1OwqXdYi2LqtUrIEJYgm3LaVcH9HqdAkPVL02ILKwBuOUzcYy1fb2qrVr4eq9Wmfc0KjpKtOo/tiLUrUjVdgduPpLq0qNGn3dId3SAsF0tONWgrX8ObmP8SZY+vRt5GkqMFzDhzllMCxYslKob2OinfWUr5SvSerSswF1fwn1uDM4zdrpbqMZsO+YZaf6WgXD1QxJUAW5zcLJUFqiA+sW2Cpv9lUKnkdZL4r8amc+sDGdk0MQM7MVq66oosT6yvhOza2FrBqdfLci+QkX1m5iMHUVgWUFLi5WA0qKMLU7W4lr/wAj9pdZJbF40tdJ2Q8x8o4rrOyzo5kgN6Q3YcP1jcs7JASXbkfnAajDg0cUgKShBrMPvyPtDD/uSx3cHdwhHfHk8Hft92p85a7sThTEorCo52pN8TJA1TsijqZaWmOUmEHKBWVahvdgOglPFY72WrWSuzWSj3im9sx10/aa4QnYTJ7d7Cqdo18M6aWbLUufd5yaIWuORcPTZqReoaYY/K85MXiMRUyUgFG3hW9psp2Xh82ZqYNrWvsLCwjwiIPCAB8oW6+Pnzklh0isL2hXwdQilUKgHVTqD8JarYV1ekFK3ZbsGNsp5TOxtFqOIIYWzC4nPHHddZnxehwn0gpVLLiFNNvvLqv9ia9KqlVA9NldTxU3E8CHIlnDYypQfNSqNTb0O81eWPftqY+PPq6r3Gc8dRyMLJSqCxFus8/hPpBsuKT/APafyJuI4ZQykEEXBHGWZTLpzz8eWF/qXgwPENDlHIiUryQdhsxHxlYXAg5zu76SsK1Qe984RiXH3T8IFjuiTYQd0eUT7Ww9xYRjbb0wfjKGd2Z3dmL9tBP2Q+c720f9ofOEN7ucKcV7d/8AEPnB7c3BFEoshJMIJT9sqnbKPhOOIqtu5+GkDQHhXgOsVUxCD3s3SUiSdyT1nXtILL4x2FlAA9dYhnLHxEnrK+IxdHDLetUVL8zr8plV+3c75MOpX8TjX5RoRzAMAzKgPEjSU+2sDeh3odXZTZcp0YfzHOy7Wv6Ss76FbAL0kt00xDobGdeaFfDrUF+PMSjUpNTOo05yzIcrlZt9i9rCiBQrN9UfKx90/wBTCkkfKZMsd+8e3XDP/HPr/j3oa8kDPL9mdsPhgKdS70f1Xp/U9DQr069MVKTh1PETOOUrGfjuH+li868iDOvNMCTImcTIkwg3hvIXhvKJXnAyN515QwGSBigZINAZeZ3bOLq4eigosFZ768rCXs0ye1qFXG4laaCyKmrHbUyDIqVGZDUdLuzn6wm5NgNOkdhOzauICuxKIQLsdCek0aWDw+Eo02qkMaQPjbQC+8rVO0a2Mc0sCug3qtsJLlpqS1N6d+ERUTmJdJGx1vEuvA7cDLYikVIinphtuPCXKlOx1iWSZsVn1cJxp/8AjKxBBsdDNU6nbWKrUUqaMLHgwiVVBWIOktYXGVMPUz0XKNx5GIq4arSBYqSn3htFXjLGZe28PJcfXceowfb1OoAuJXu2+8NVP9TTSqtRAyMGU7EG4nhxUIA4x1DFVKLZqVRkPobTG8se2+Hjz/tuq9neAmefodv1k0rItQcx4TLtLtvCVPMWpn8Q/qamcrnl4sp8aV4c0rU8XQq/Z1qbdGEbmm3MwtBmiyYA0IcGhzSu1VUF3YKPU2lTEds4WiNH7xuSa/rFsiyW9NMvaZmO7XpYdilP62rtlXh1lBsXje0jlpjuaJ3P+f6ljDYWlhR4Bmfix3mLlvprjMeyhhq2LcVce5C7rSWXFChAlMBUGygWkdWPOTX1FokZttSFyLwEaG2ohvYgjY7QmwF+B3nQJKgjWJZMvqJaKgnhf95BwL2+YkFSpSvrFEWNiJcKEC42i2S/SSxSqVRqSsoF1bcGVmwtGodVKHmJcKWkcg4SaFN+yXy5qdVSOTC0rnA4lLnuiR+HWawLAWDEftOWoyHWN0YjUq1M2am625qYMxAuRPRjGWZiUPiTLob8J1bEo+EpU8hzITe4HGSyXuNTPKdPOZ7yS1nTyuy9CRNUhSPsx/4iFLAg5P0EzxjX5azRisUfLWrHoxks2Nfdqx6sZr9+LeFP2EWQztc6S8U/Jf0z0wFaob1GC9Tcy3QwFGmbkGo3rt8o9QBuCY1UuNI4xLnaI0W37QgEmSWkQLyaLymtOYBTGAnYicAenodZwGuvzGogDa4O37QE5SZIbA9JzAZT6G02qOh1HA7QdRcGdTFzaFxoDz3gQIynTUH9YGQDUaiTXW6nUawL4WFuJsZAopykTTtqJYYAORwvAoBMCsUPDeDKQLEaR7qLA7GcpzDWQJFM7r8p3dg7aHlGnS5HAwsAVJO+0BPdD4winc8o5RmBB4bGAbGBAU+Y15yfd+kPlNhtJnwnSUR7vS4F+sIQX0uDJr5QecJAufSRERcebUc4coO2vSEjSC1gSN4HeIbayQIOxs0kBfQ8p1g1ri8D/9k=", "data:image/jpeg;base64,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", "data:image/jpeg;base64,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"],
    ["data:image/jpeg;base64,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", "data:image/jpeg;base64,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", "data:image/jpeg;base64,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"]
  ],
  juice_bar: [
    ["data:image/jpeg;base64,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", "data:image/jpeg;base64,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", "data:image/jpeg;base64,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"],
    ["data:image/jpeg;base64,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", "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABELDA8MChEPDg8TEhEUGSobGRcXGTMkJh4qPDU/Pjs1OjlDS2BRQ0daSDk6U3FUWmNma2xrQFB2fnRofWBpa2f/2wBDARITExkWGTEbGzFnRTpFZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2f/wAARCADcALADASIAAhEBAxEB/8QAGgAAAgMBAQAAAAAAAAAAAAAAAwQBAgUABv/EADkQAAICAgECBQIEBAUDBQEAAAECAAMEESESMQUTIkFRYXEjMoGRFEKhsQYVcsHRJJLwMzRDUmLx/8QAGQEAAgMBAAAAAAAAAAAAAAAAAgMAAQQF/8QAKBEAAgICAgICAQMFAAAAAAAAAAECEQMhEjEEQRNRIgUyYRQVI1Jx/9oADAMBAAIRAxEAPwCvj2UbsgU66fLPI+szOAZ2XlPl5T3OACx7D2lUHUYqqFtlhydyp9TaEIVIHEZpxeirrbuYuWRR2y0Kj0jUL5/QmtcyvR1WcdoymHv1PwIueaMey0myuKgK7I5PvLXIiDtyfaGDJUvA+0olD3v1amdZG5cm6Qf8GbevTzBDg8zdsw6qay1nJ+JkW6ewkDQmzDnWR0inGg1LkDgSUpbIuGhOoYAaMOtwp5HzuaGC+hbxDFahQfbejBY52QIbPyzeOnWgTB0JogwmVEYerjY5MHZj9I2Yzvbr7iNW0CxBqZJZoxYfFmTUujHcaoM4I9jvfxJsxOjmO+GqrHRHIjlkUlaFuL9jPltdTokaMDiMMXIK2DSnsY/dYtFe+OJk5OStugvcmEmBLRpPk1lwQRuCGULrwlf6mZRsKaBH7TQ8MrUE2MRsyNJkjJ2YdddSYvU+i7e3wJGOo1sygpccMDLgFeDxFzTekMLqOq8D2EetdfL6QYit1asB7zeOX4WMer/098a9PI+dzLkwObTsJGRUgDCFybAQFB4m1jjw3KcqBUT8dpN/gOPZzUzIT9diA/Hbd2F/w8/SrW2hQOB3M0i6Y9fOgYa3wjJxaiael/twZl+WzktY0zZMbv8APSCToFlZRtb3+0RZGZ9nj6CaDIi9iIrc3wZuwySVRQD7B17Vpa7epyD33CMy65mxO0Roz2bmNYzEyt1dZJI/eGxUAXct6QI7WvpBJA+kMuRwAIh5jhwoPEdqp0oM52eME7kFFv0F31CFxytJJ7SqAahDT1LxFY8vBhNWL5uS1xKIN7ixoevTMIZVau7kEidlX9S9IGp0YuzOwDbbRjFNjAgA6gQCU7S9JCsOrtLIByMpKU2QOozMa5rWJ7ScdGzslEY66mA+0sKugk9JCk8bhUkNoFrp0TCqdkCCuJZgBLLxYBBkgBylirbB0RNXDyrlqBWw8TIXvNLwv1VkH2mDPyUbQcez0ePmeamn1uZPiuGtb9Q4Df3k2OUqJQ8gbj4avNwFd9HY39jBxzeeLjLtDKPMW4+uQSRE7cdmPpbc0Mi7+HvYfmr/ALQGSEZPMqbRmjHKcNSAqzOPVW2juGU9QG4vY5ZuYRXHTqbUQ6xORoxzHHpiiAs/MepGlgSYLKk9Nm47XloUAPtKYtC3uQe8Fl4hos9J2DFTxxmtlRk0aFBWzUdBCpMzDpvVQxUgTRxwG6uvnXtMPxLnVjrdCN+SgsKmKuQzb+Yzk46Pn9IPpAgMmkVMpX3nRgqjRmk3Zbso+Ie1q3q6dgn2iTWkLqDFp3JREy/g+E1WRXkWgquj0jR3sjg/aKZRZSqNwPeetuHpVh/L1dv9B/4nn86pQ2LXcAG6SzD9YOOfJ7HzVdGaiB7gB2lmAF5B9ozkLXUUKgb37RW0A2FhGyjsWmNI69Y+kapsFeyvGzyJihyLe8dwrUIcOYnJiuLRa7NilzZjn7RHFz7ENuOGIHeM4mRStZXqGwZi22FPES6/lJ5mXx8EoylYb9Bq7PxWqs9j3MBevlsQp4MrkWBrtjue8gsWHM6Cj7BAne5ZDzOHqbQnBSrcwikO0JsbEcoCg6MUofSAQ9LDzRuZ5vsJoZQOlvVWIQdd1w6xrXtDo6qutSFbdm9amPJn/wAbrspLZq0Ir088b4it9XLaPb4kC9kGlJEq7sUPeYPkcmmO9UZeU3l2+k894LzGs78mUvLea3V33OqYA8zux6Mcuwhr2NwfTowxcEScfGfIY9PAHvCCij0Dn8h3rVi/1BmFm1plf4gqoffR0jfOtjRM26rA66YAMx2B8amQw8z/ABLbfr00L1c/Rdf8xMFVse/o8/dbu19ADk8DtKeafmd0M5JA5OzofvJSoFdmahRQN69mXc65XiVZdnicUKjmSyUFordn2rGalGOETdg/WZeI7JaCeRPVYqU5uOFOtleQD2gSb9BxjyPN5dW7d1rv7QOmXhlI+4mvbX/A5QUgsN94xmDGyMItoBgN/aFF/Y6GHknvaMKupl9cHY5duZseG4xvo5Gh2lH8G1kAA+n3g81dC4421aEqUdUDMD0mMKRsETQ8QoFeBoDsOZn4aiywBjxFz+xmXHxaSH8ZuocxgAM4EsMZK02hgU/EtUL3mDJjuQmUXHscrx3tYLXz87hloNLdNke8OoFasT37TL8dyzVlFAfyr7SZPEXC12FF1tmf4qirYGTv7zPB2Za3KNjbY7gwd8zbig4QSYqdSdhQTuaXhthTq1rUza3A794fHsbrITWveMYN0bxrArRhsFQQAPrM7NC42LnXINO40zb3vZ1/vNJLdKwfgr3gRUtlDJYvUpG9H53uLeqHvswXxVxfCC1g1bcyr9h3I/oN/eM42Li3UhVALajHivh92U2OielFBJ38k8n9hK+G4arsjewffiFCet9jsSp00JXYNat0KPVFXwLTaK+nvN98bdvX7iD1YuSG0DqW5VsucE9mOMC2nkqTqGwsg0WcA/WehetLcclgAZmnw9R6h+uorJk47YDg4u4jNwXJVGI+sBd4Qt78MQD3G4U+ioAEQ1LN5e96MS8lu+mMk1J2wePjnGAr+B3jNdGiXPP0lPYOTswy275XtFYMkYTfL2SDS0KZdC5P4e9RGnw/+Gv9XK+01r1OwwGjFLrHFgDLNM8y2mHKSfZH8La9g6TpD3jeN4d5D7HO/mWpsLoAOIxRZqzpbk+0kfj7AnFNCuVm24tvSv8AMOJi5vmZV7Ox2TNTxbnIGvyj+8WVeO2yYjL5DjKomfj6Maykp3kdhNPNwbCAygmZtilSQRoibMcm4qwJRcSveGosNR4gl4kwxZ6PGtW5fWNt7H/aFLhAGA2X4mWqW1Fan2F9mHuZpB1VRz1Mu+fvFMfY1fpW0N70FH68n+8U0aSeB1HuPiMXPawUBQLnG+OyD5/tFWtqxOXLNxyzc7gvWkNg9AqbyLz1iRff+KWA9Ootk5Asfqr7e8lXVqtb5gxcn+LCUn+1jr2NbQOk63AC1sdCGBb6xY22VAAHYjVeQGp068yslMjf0xSt3bIJ0QDG7LxWoUe8HY/SnWo3qJtabVJ9/iJ/JsU24msih1XT94YaQ9KnZ1EMLQqPWfVDVNojZ9UJR10Ni9Dqnq/N7SLnqIAOt7ghevUQ3eLZOSmiF/NI9dMjdD9aLW2x2ML0B16hMmjJsP5jxHkzUXQB7xcMitwktEU0y92OtlfPeK1VdD8jiMWZADjZ0pnDpdtb4gTaUk0uiN7LkDqGyNRbM8NpvQsuur5Evl4wLIes9+25dAVYDk6m5ZVdMLT0ZeR4UK8XY/OJmeUw3saP1nrLF6k2RMDxOsrbsa0RG2hOSEatE4mRa9ipYCpH8rf3mqjpWOlNMTyNc6MUx8eslWsIfXKt7gfBjVIUWMU6QQOeNTM8qukVwYcnyqizcccluZiZiq7khnPz1d494vlWJTXVXcqMw6m79R+3xMUuwbkk777jYL2y7S0wistfA7SjXKraBgy+m7cShUE7HMNxXZTYwt2yB3hsjrSoFW7xdbEqUbX1Qnms671xFNcpL6ImpaLYuaa1Ndg39ZR8qtbNqsDcOl97ELhU1tZ1tzr5hOCCpv8AFBa8v3I0YR8o9APuILLspPK6BERNjGwbPEuvSJJ8HRvYrC71n2gra1axrNjj2iaXtWmkJG4W3FvSjzC46T3EW8dvQTXLoF/EF3IEtTXY7b6tARYsE53ox5VC0B1f9NwZQpaFVYbb2jpI2F+spdmEALXvYiqZ7VlgOdy+PW9wZv1lPEkg++jUxna0hnmh1KiggbmPhZI6Sp5I4jtWUoPS0VikoN8gotUPsQ6cRK3DVmBftO/jF69AwjMbUBBmh5YtNrsJU+jOwcmpi5tK1dQI6QSTv5MjHyvJymB/Hbp0SNnj6y+ThY7UVurBOleW32lcO+mhR117JGjZ23AuLYP5dMeYU+IgIysoC8c9j9ojleE1urtjM26+GQje+O4+n3l3Pn5IFYKb46xzGsexsXIKWO9g0NH3/oI2LKlE81chrPSe8Dsq2xH/AB5Upyz5Y9Lerga0DyB+0zg2x945dCZMI5LqG44nLaw43xLUVdTdIPeGFKeb0OdagVRcYS7M+x2838xIh6idaB7y+RSgf0SlQJbQ7wnsumnsZzcFU8PFyMS3G5nq7ccRjKvuCeXviLM+lEtky1eg4tZmA1G8vLu/hRWTEq7Aihu5nNkm1hsQad6KjJrVk1oxYbMcrG10pitlgC8cGRi2nr0T+sLYSaToNZWyWjqHE08YoijR4PeK5jKMcEHbRKq1ywVt6mecJTVMv9rpmx5lSWErOty0IBA5EzWdgQB2jBNT08fmiv6bVNhcX0mEouFuTv2mxj6C95iUFGHQB6vmamBWwf8AEPAgTi4ySRataMyo3NUPTY9I0ApX1ED3miMrHbD/ADdQI7a0RA43iVXkDqdusLopuRXijJY2EBSx4XXMb06RaRepLDR1Y9ihgSdMf6SabC2dW1jc610n5lOrIxlsQAN0nh9cgf8AMtU1Jwizj1hSFb33Cj3oJ9C/j9ZfK6zwnQpUH6//AMma+P8AhBlM0f8AEHV/03B6VrHJbfJ5/wBpli1gmj2muFexFRT2XSwLpt8wTuWtLbnHpaXvralE4/OvUPtBBuyBaARuUD/ill7QYqaxgqglj2AEOMLIUaFNn/YZVFKTfZ2xa3MoyjeiOIdMHKb8uPbv/SZBwssjX8PZv/TIkTt7FwimUspKttDG1wsoa/6ez/tMo9V1VmmqYHW9Ealqy6BshNY33llQBfrCp0Oo+fiM2eF5i66cZzsblbZGvZmh26tMTqH46OoERr/J8xx/7Zwf0kWeDZq66aGOvbYltWX6F6w/O/6y+KGN6l10m+Y9RhZPT+Ji2A/QbjC0WKAj0uobsSsF2Nik6B3JVVkVGsjk8zSscIq9J7zKTwfKtyCTvpB4JM1U8Lsbp6n1qBPHzYTauzNwaK3pRmFgI/MWHvr/AM5kqz12msjab4DHlZH8Bk4/GPayqQPSe37mamHg9GMWsu2x5JHH14iJJuWmVGSXR2BhW2q5PSFPHI3uJ2YbDLuSrSOp4G+Aft7zZxnIpGj7e/vA5WOoR70Y+c3Oidy41GOyXbMvxHDOctWyVYKAeeAB7/cxX/IX2ALOoH44/vNetAABqMkAIJmj5k23XSGPDH2YK+F2oWFddY1weodR/Xcl/DrMmgAKnp9II9tH2h/G7L0y18q11SysEgHjfY/2itFj4xDsoI9tErudJTi6aGR8OUo2n2N+E+Hth3m2zuq6H6zRd7Ov0Aft3neG21ZNYfbshP8A8ncf+GWttaqxlGuDxG9GRxcXTKUte7HYH21HsupVQFFA+wi9V7Mp3rtviEsyS1NetbKnf3kTBaZRnZf9J+nYwGXhJl2pa3DdHSR9oWvIYkBhCW29FZdRyO4hXoibTtGUPAKK7Bad+lurXzNFlawcsQvckSKck5FnR06HcybrAAFU+/aLbonbCCtGUew/qY0ta+Q2lHH0mfWxLCMVWnyrFJ53sS4sjRxr6gOluk++oVU/D0x6tHcXZvxO8JU3x7wrBCgge0Vzy1grpX+c8/YQLeI9LEFDsHRlg9mQvmqhHGh+8FsJIiuwsQth2o+RuXzcU1ojVOOlj+gge0rm5DDBcdR9PInGweRFw4T79ApNO0TsqoYtoD4HcyKmI2SNgxKvJa6jy0PJHG+BGqBZZQOdbE06vSHKw9a+r6Qj/TtKY4dlJbf6y7DUwuKSddGi77FM7oWyhrAdaIi+Y1bINdBTvoEbG45nILsJ0/mX1ofqJ56xz0nmdDDNPGkjZgjyV30ej8Ox1XAq1ZokAniFfBrtYM177A1wRAYj6xav9A/tC+ZHrKjHODcmw9eJVWCPMY7HO2E4YuOvPUe2vzwPmGR1mF8q+hfxP7D+RQOQ7cfWRYlZRh1NsgwPUZ3UZTzE+FEeEuors6zokgR01479wv8AWY+BYHqYqf5o2rGYc3mTxzcatEWK1Y6KqF/KEH7yfLo79KfpuJ9RndRif7jL/UnxfyOOtDHZC/1lGalR6Rz9zFtmVYmVL9QytaRFiQtkgHIcj3O51WZbTSVVtAOdQeXaEvI37CDPNKt8kmbMs28UX9h4YJyaY6YvnOExbGbsBDM0zvEr1LJjnR8w+r6CcrBjc5pGS6Oa8WUqiFOeQVjuHbdZjr+XtskCKeF46LWQ4Gu5JMZx63FreWAa98c+06W0xqoeSzQnF9wPXzzJ8wTn8m3Rp4lvzHntPNnTE/AM2fEMk04xWtXaywaHSpOh7mZOPRczqpx7ipOuEM6XjY3GF/ZowzjG7Zr4Dl8RPleDGNQuDgminT662767Cc9LKTxxGTxuLsR8kZSdAjxI3CWLvRHxKhT8QHZaejhOs2lFj6J6VJ4+faFrpLHtHa6/LHGtxuPG5O2JyZElo834JW1aXVMG3sONj9D/ALTTAI7zSbqI0da+0Vtobr0qk7+Iny/HbfOIOPJqmCH5ZAhRUVQ9SuD7cQfS3/1b9pzpYpLtDE0zp3SXIAl662b2/eNU09PJ1uOw+NLI6fQMpqJ5HxCi/IzbbEFgUtpfSew4mhhVO3hyK4IeslT1DX1E9Ger5H7Qdi+YvSzD9p2J4lKPETDI4ysxRTk2t6aGA+W4lv8AI8d3NlqFrD3JY6mnOg4vGhi/aIsSOFklPLGSFTWtCsdvjncnFwrsZQodWAGtngx5QDO39AI14osLkxNvDg9hc22gnuBrQ/pCJ4fUPzM5+7f8Q/eTqV8OO7pF/JL7OrrrqGkUy4fXZRKSIxIG2wnWT9JQrtt9T7+8idI0mWpNElQfcyOgf/r9506Tii+bL19NeyASTLecfYQc6SgW7LmxjBsob8wJ/WdOkcU+yJtdEjga5/XmdofBnKNzuo+3H2g8I/RfJkqq8Fjr7mEN3wIGdLUUuim2whub7Spdj3JlZ0KirP/Z", "data:image/jpeg;base64,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"],
    ["data:image/jpeg;base64,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", "data:image/jpeg;base64,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", "data:image/jpeg;base64,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"]
  ],
  steam_room: [
    ["data:image/jpeg;base64,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", "data:image/jpeg;base64,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", "data:image/jpeg;base64,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"],
    ["data:image/jpeg;base64,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", "data:image/jpeg;base64,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", "data:image/jpeg;base64,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"],
    ["data:image/jpeg;base64,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", "data:image/jpeg;base64,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", "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABELDA8MChEPDg8TEhEUGSobGRcXGTMkJh4qPDU/Pjs1OjlDS2BRQ0daSDk6U3FUWmNma2xrQFB2fnRofWBpa2f/2wBDARITExkWGTEbGzFnRTpFZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2f/wAARCADcALADASIAAhEBAxEB/8QAGwAAAQUBAQAAAAAAAAAAAAAAAgABAwQFBgf/xAA7EAACAgECBAMFBgMHBQAAAAABAgADEQQhBRIxQVFhcRMiMoGRBhQjscHRM0JiFRZDgpKh4VJTk6Lx/8QAGAEAAwEBAAAAAAAAAAAAAAAAAAECAwT/xAAdEQEBAQEAAwEBAQAAAAAAAAAAARECEiExUUED/9oADAMBAAIRAxEAPwDeuu85VstzI3tJzIWsmFrrkwZeCX85GziNnMnVJA/nH5pFnaLMQTBsQueQQgYwnV8Seu05lMN9ZIrQLGlTcQQQcGaVF4tGD18PGYNdhEuU3YI3wRNOemXXDR1NC2VlSMqZgX0GtyrDcToaLhYvn3EocVowy2DodjK6mzU8XLjJxiPjOwkjJgSSig4yRM5G1oAmBCC4k5SIVx4nQBY+JJjEaGFocRiIUaI2SXOIBjZxGyZDQ56xAxoogcGLJjRQAwYQOZGIWYaBjrJFMhBkgMYSq2JOjysDDVjmMq09LfysDNG9BdpyOu2RMOpzNXh9/OhQ9RuPSa83+Me5ntTOn52UecsGsKuBLIqCsT8hAslZiL1qsVAgNtJGMic7xKgTGzE28EyasjGMUYyTY8aIxu8hoeKKICIFHEQEcCAKPFiLEAUNYAhrAJBDWAIYjCaveXtESLl9cSjVL+iGbV9RNOfrPv4022QSrcZas+ESpb1m1c8V3MiJhud5GZnW0MTvGJijGSZRGKIxGxjGhGNM2hwI4ESwhAFiLELEUDNHxHxHxAAxCAj4iAgDiSCABtDHSMk9M0tAPxVmbTNTQD3/AJTXj6y/0+LtvQekpXGXLpRvbea34w5+q7bmATCMAmZVtDRRRSVFGijExBkxYhERDrIaEohxKI8YKKPHiMhHiEeACRFjaFGgDgQhBBhLGSxVNThw3J8plVHea/DhsZrx9Y/6fFi/vKF2xl+7rKGomlZcq5gGOTBJmVbQ8ExZ3jEyVFmLMYneMTiAZ0cCJRmPjEhYhHjCPmMHjyprtb90rVgnMWOOuMSn/bBP+GPrDBrXzHzMQ8Wfsoj0cSts1CrtgneGUa2YxOICtkZj5iMQMJTIoufBgFygZbabXD2RVILLnwzMTSWe+PWc7Qxu9uQzKVdmLBsYGdhiXx1jPvnfT0J3WxeZCGU9xuJn6lxkzlfs7qWHHaUV3ClXLDnPKQAT0m2dR7Ykg9zNL16Z885Uud4zHeBzRszNpg85jHeNmKBkYjvGMXaIKeYid4BYCC1g7GSpLmCWkXtIPOXdUB3Y4EArcTxZSR3G4mMzeBnU6jgTXAhtWq+if8ysfsohOTrT8qx+8uIrnec+MsaJ8ahcza/upV31rf8AjH7ySr7M6atgx1lpxvsoEewvZ6XyslzmW00GjQY53Pz/AOJFqtMi8p03M3Zl6zPGkqHMA9YjzAkMrAjrtFgn+VvoYHqbTMRv4TmdNYwosYH4nGfOdF76U2OtVjEKSFCnJ2nLAlNOF294gkiVIjqtD7P2cnE/aMfg09h9NsfrNnQuW04PnmcxoLxTfZzZBesov1H7To+HfwE9JfXxPP1oAwoCwhIWcRDpG6DMbOT1gQsd4x6RAxN0xAwnh1fd3PzgHQU9i/8AqjDWodgz/wCkxxerHZseu0BhVaCg2AEOwP8AVLSaQU/wK608yMn6yFGKMGz03mjnIGOkc9pvpUOnuY5Nij0EcaVu9x+QliKHjBtQjSr3do/3VPFvrJoK2Kzsg+JcZEMhbQDSVeDH5wl0tSnZT9ZJmIGPIW0DVBd1+kiNoXYdZZgPWH9fGGfgl/VDVm66h05mCkYwpxn5zn7OAnA5QR8pr8WGopZSGZajtlfGZZdifiY/OTti8lRUcCdbMksV7jtNzT6I11gIc47GZKse5P1ktZwdnI+cLd+nOc+NbBBwRg+BhSpTa2QCxYS0p2iByNoB6yURiuZRABMRMRXBjHpAAqoBA/SFenIo2JipbJwCMy0wHKskkOlPtEKMMDwMuVZFQGc42zIaVVbQe8s4A6R8laHMWYJ2MbMoDzMri/EPurq9HvXDKHIyo2zvvnwmlmZHE+CNrLDZVbysexi0M+v7VagaTLopuXPOeTA/pwM/WS8I+0tjO665kZAoKsiYOfSU/wC73EaWc1hSGHK2LOo8JJpvs/rc/wAKioHqSeYyrYmS77dXp9RXqaVtqbmRhkESYSnoNKNHp1qDFgo9JaBhDonqS1CrgFTsQekwuI8HfTk2UAvX1x3E3w3SGPeBEeSlLY4oEQ87Tf4hwmvU5srxXZ4gbH1EwdRTZpX5LlI8COh9JnZjSdatabfE0F6ShoCG6bzSQe7FDpAR4QXMYgiUQH6SPqJJYNpHjaAUqrgt3OAemMS7XqFcDsc9zOeTUsG+AyerVkPnlI9DFhOhR+46y2rAhD2Mx9HqhYpIOf0mvT71S484cl0G4crmR5k1+6AyDMd+ifBZj5gZi5oGOPmBzCPzQAwYSmR5hKfHaOEk6Rw+BAy2MZBg8p8Y9TiymGHXeU9TSjlq7FV1J6MIYGP5ozlTnLDMLdOTKoU6BaLWNZ9w9FPUS8teBALoBuQY6ajl8xJmKujKQGUyxWVtXKn1HhGevBlYnVSxdtjKzOAcd5c1HuqfGZmpf2eWJ28ZK4iupppTIUk+UgrqrsJYqy5l9txvACCSaGug1Wq1XNk7HO2ZKOLsuqqpNTKqWEM3l0k61tzAgGYFzU6u97We7nZyRWgHT85UR07JyCm8r57R+HF9Twyq1kYEpnfrkQW8Y+i5KP0kW57xcniTIWl5lHUiLnAkYQQgoEYSBsjbeNzseiRgB1G0kGTAjA2HygsHY45jiYWq+0GsGttooqrHI/IOYHOZe09/Fq3A1OmoZe+LApErC1f9jgbtB9kvcmGbUAyWA8pGdRX2yR44iw9F7NfCEa7GT8NuUDtIDraVO/8A8k3twEHLhl8YYCZ307qzMDnb5y7Xat65Gx7iZWt1CmtNsHnENNQ1FbWKM8o5iviB1EcuUrzsXtQiFN5z32g0YurUhCwAI93cj5Tde1balas8ysAwI7gylZupEqly2l4TpwOrf7RDhOnHdphLxTUKu1rSbS8WvNgDOWEXlz+F4d/rbHDqh0YzneHaFNFxzT2MwwzX1Af1A7f+s6GjV82AepmBxJWb7RaaoNygasWD0ZAfzQzTJ/Ge35W9p669NpSifCCxGfMk/rMSq/nL12DldWIx4jOxmsrEqVPiRMji+lZ09vVkWJ1x1x/xI7XwOPmZen4qAAt4x/WP1E0EtWxQyMGU9CDkGZ1qlG8lFR8CfSQdRAVLVs5heeXuGGYCrq1rzb5wPOC78uw2wfrBN+azgfKVjrF+8MjMnNjPKZScSavh1WserUAfjVMHUjA58b8pg62wnT+0TIYdQdj85LU/skLZ9zOx8PIwnWvUoxYdRjmU4PoZU9p+MRtRY3WRmxiPiHpL9nDN/wAPUfJhKtnD9WBhQj+HKwiw9QE4G5l3Qvz6Zl6L4n9JBVw+1Tzahf8ALn3R6+Mk1GsqUeyrIY9DyiKqhzpWflK3O4z0bt85bsYU0O7HZUJP0lbSsc5+EeHUzP49xEFPulTZLfxCOw8JM91V9Rq8BcvwWjmO6gqPQEy5YnMMylwW2ocPp0/wui5we+d8iaAHYytQxlDEg45R4kbSQN7N8qdwdz4xrlFTY5snzkXMrDBycdhM1tjQ6tTYObY+sj4/Wv8AbfCLgwTmflLE4G24/OZ1VoVgQMeQlnXaazjDezRyH02n9omD1Yt+wmvF/jPuf1uMQB0wcyB2w7Dv1lThmofUacNa3NavusAMcp75HYwOI3tVeHTt28RH0nmKPFeFZJu0q+bVj8x+0xK9Rbp3Jqcoe47H1E6+i9NRUHrOfEeEo8Q4XVrCX+C0/wAw7+oka0ZlHHmXa+nP9VZ/Qy9VxjR3YBuCnwccsx9XwzU6YnKc6j+ZN5RbfYwyDa69ubUJ+HdgH/t7yA6GsDc8x85yoHKcqSp8jiT18Q1tWAupcgdm9784eI10Srdp8+xfCnqp3B+Uj9pdW3Mlaqf6SQPpMheOaxfiWpvliEeO2nrp1/1GLKNjUOs1R6qkFtTqWG3KJlNxm09NOg/zGRtxTVN0WtflmPKNjSeu20/iWM3lnaLlq0y8zsqDzOJkPrNVYMNewHgu35SDGTliWPiTmHj+jWlquLsVNelyPGw/pK3D9KdTqADnlG7GLTaJ7j7w5F8T1mrSq0Jy1jGIW58Elv1O1W/gR05e0u6TWPWRXqen8tn7yol/NgEZkjHcdxJ1WKttbpZ72frJETb1lrUqrEAiQFQqgjxgEldQUHPWXOFOKuLANsttQUeeCcj/AHlNGLMQemJb0emS84fIIbIIOCDK5+p69xpnT+zvscLj2gy23cbTH4mcsd9iJvCrdlNjkDGAT6fvMDifX6y+2f8Amz6L7NPdzodu47GatWrr1C5VsHuD1Ex1PvYjP7p5lJBHcTPGjaZhzHPaVdRo9PqN3qUse+N/rK+m1Fjp7xzgyyWPLmStm6jg9W5qLJ5E5Ep2cKuX4WVv9ptMTAJz1j8qWRgtodQv+Hn0MH7reP8ACb6Td5Qx3iprU2bjMfkXiwxpbz0rb5yROH3Md+VfUzeNaf8ATjeA1ajcCHkPFkpw0A++5PkJPTpq6iOVMnxMtttI+m/eLVZCO3XtB3PWG4/B5u8Fdqs9zAFvtj85IjtIlEckg9fKAf/Z"]
  ],
  indoor_pool: [
    ["data:image/jpeg;base64,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", "data:image/jpeg;base64,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", "data:image/jpeg;base64,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"],
    ["data:image/jpeg;base64,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", "data:image/jpeg;base64,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", "data:image/jpeg;base64,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"],
    ["data:image/jpeg;base64,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", "data:image/jpeg;base64,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", "data:image/jpeg;base64,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"]
  ],
  treatment_room_massage: [
    ["data:image/jpeg;base64,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", "data:image/jpeg;base64,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", "data:image/jpeg;base64,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"],
    ["data:image/jpeg;base64,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", "data:image/jpeg;base64,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", "data:image/jpeg;base64,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"],
    ["data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABELDA8MChEPDg8TEhEUGSobGRcXGTMkJh4qPDU/Pjs1OjlDS2BRQ0daSDk6U3FUWmNma2xrQFB2fnRofWBpa2f/2wBDARITExkWGTEbGzFnRTpFZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2f/wAARCADcALADASIAAhEBAxEB/8QAGwAAAgMBAQEAAAAAAAAAAAAAAgMBBAUABgf/xAA/EAACAQICBQgGCQQCAwAAAAABAgADEQQhBRIxQXEiMlFhcoGxwRMUJDM0kSMlQlJic4Kh0TVDg5IVY0RT4f/EABgBAQEBAQEAAAAAAAAAAAAAAAABAgME/8QAHBEBAQEBAQEBAQEAAAAAAAAAAAERMQISIUFR/9oADAMBAAIRAxEAPwDSNS8Wzk5AXMgsOMFn3bJ4npELrt2zmaCCNt8+uLdh0kyauGqw6ZBq2MABgAStg2wmCAC4DMAOlReNDGqj7Wcg1brssIoKdchdZ77LRq0K7ghaIzG0iAovrGwvBDEDJSOoyyuAxBCkWUcdkI6KJF6tbvUbJTVIKXPKYKOmQUTYHZmOwKJr09G4dOcpc/iMamHoUjdKSKem2cYawKdMuxC0y3Uc4yngcU+ynqA/aOU3SQB0SNcHovKmsoaJrP72ooyy1TGDRFJc6lV36tkvtUERVqwfqt6jhaeync/iJMIBKSlaahQdoUWvBZySTui9bjCl4p7KT0AmLorqUFXfbOdiB6QBPvECG2+IVXqbJkaY59LgfGa7zH0xz6XZPjNzrN49kmCquecigdJzhtos5Mamt1bJf177YDOBOeLtLoYTDILtTN/xZxzCjqaqplbosItnga9pUL9Sp6xJLEdG6GlGkpyQZSdfLbA9L0GRTgFXYAOAk615XLjaTecamcqHM2UHWsb74o1IPpL2tvkVY14tnJitZidw4wKlRV2uO4wYYxvtgl7DICKNQHJLn9MELWOYpMe1C4Nqh3SvUYmNFDEbbImXTeKbDOWu9YHuvAC5INtwvnFsxAubfPONOEQ21qjm3XaEMLQFzqX4mFVKXLrD8Iv5RpEOlTVS7KAASBl1SXFgZYlU6gzMx9Ne9pdk+M2am2Y+mve0+yfGa89S8e69IOmCamcaMPSHOdiR0SfRUQbgE9ROUx+n4qtUPTADMxyBPATQ11QWWmg7oLV2tttBqsKFZv7bHjFvTqq9mUjhnLJqE7z84BqEneZAoU3bccunK8I0HZtawHE3hawINyDO9INbbmZRHq53tn+ESfV0+0znvnGodljILN1CAS0aI+wDxzhDUXmoo4CK1idgkWZtt+AEBpYk7coDPAZH3tl1SNXLMj94AtUOd4hqgucxGkAb/wBoksFFheFB6S7ZA3nNUsDeQX6JD2ZCpAN7AQoqYtRXpOZ74NTYY9hawiqo2zTKlWmNpj31PsHxmzWOXfMXTHvqfY85fPS8e+BZtise6TqVL80jjlAoY6lXWyVlLAZgmx+RzgVa9IHl4iivFxMZTTmptvZB+oSDTUjOqO5SZUOLwo/8lD2AW8JAxlAbDWbhSPnaXDVsLRHOZyerKKYUwTq3sfvG8Qcam7D1j2io85xxZPNww/VU/gRhp1l3ZQltuF5W9arbkoL3E/xIOIxDf3lXs0x53jD9W7H7v7TgH2WylMms3OxNbuIXwEA0g3Oeq3aqt/MuDQKta7HVEVUr4enz8TTXi4/mU/VaG+ihP4hfxhKlNByUReCgRkQ1sXhDsxaN2QT4RbYqieaazdYpN5yC56TFs2UfiofEi+VKqR1gDzijiGGygL/if+BJYxTGFQ2Jq/Zp0RxJP8SMM9Wri0DsmqM7Klv3vAJyMPBfGLwMi4v12Cal/tMFHfArbTF4upfG0aYJ5LAnLfGV5WVCufGYumPfU+x5zYrecxtMe9p9jzl89Lxu4oh0QMAc94vCpAACygcBBxC5LHUkyEy1BqT0mOWAEyEcq+MgEmcJLDKRa3TAkbYQteCMiJ2uoObAd8qYM7ZF84BrUxmXUd8W2Kog+9X94MPvBJlf12iPtk8FME4tG5oc/ptBhzNFs0RUxWqByGz6xEnGEjKn8zBiyzZRZMqNjHtzF+caC7U1fWsSL2tCpJyMbgT7WvAwHUWMLBgDFLb7pgU6zudPga7W9OMr5TZrTGq/13/OJr1jlKihV2d8xtMe9p9jzM2auzvmLpj31PseZl89T1x6zF4GpTCMy8m4EZSogWymlpEhsEv5wH7mVQMhM1ZWLpXEVsNiitJyq6oNrAxNLGYlxyqzd1hD06Pav0iVsPzZP4rSpsxBu7HiZJvvJPfBo7Dxk7TMqmwtBAhnZBECKo5B4QGWMq5oeEE55dcoSFzjQtoIGY4xtoFWsMhxMRbKWqq5DiYi2UsCHG2W6fuE4CV3GRlhD9EvASoKocjCwh9qXsmLfYYeE+KHAwKdT+uf5prVjlMhz9df5pq1TlLUU6mzvmLpf39PseZm0+yYumPfp2PMy+ep6499j7+qKD/7x5wFHJEsaTAGGXrrjwMqekckqiKQuVybbrzNIxdOj2n9IlXDDky1pkk1zrABtUbDcSvhubJ/GovUubOBzk09kNEUrrPUCXyGRN/lM4uoJ8JA3ya1qerZtYEZEC0AOLy4jnP0TcJBPLt1yHP0TcJxP0hhUDdxjd0Vew75BrgDfGCXzA4mItkIxage3fBtslCKg5LRgPIHAQX2NOvyRwEqDc7eMLCH2ocDFufGFhT7T3GBUqH64v8A901KhymS5+tSf+yaTtl3S1CX2TG0x8QnY8zNh9kxtL/EJ2PMy+ep64+haVPs1P8AOHnK9M3DcfKDiNK4auiocPWcK2sMwufzgLpFFvq4Ncz9tyZLCMvTQ9pPZErYa2rtE9Ctf0pDeq4QE7zS1j+80aVREprd6SG2YVFEZE3HnaNN3HJpu3BSZPq2IB9xVt2DPQnEqHuazEdAyhDGUPxX4S/J9PN1KFcgfQ1f9DAFCsP7NX/Qz0DNhBdmeqBtzNov/ltG0D725HRdj4yfJ9MJqVT0ZHoqmz7hkFHDe7f/AFM9GdM07fRo545ecB9KVzzQFHVcy/M/0+r/AI866tq81vkZVqXDWII4z1PrOKqgXqP152mHpe//ACB1szqLJmLLqrQOcZ0QEyMK+yZaKfY0EnkjhJc5NBJyHCUS58YWFPtHcYtj4wsMfpvnAqu31mfzJoM2XdMtz9Zf5DNC8tRzTH0v8SnY8zNg75jaW+JTseZmvPU9cepGkNE/Zr0+8mMTSGAvycRhx+oTyFjaAwylxHsqulMMg+IQ9SZ+ErVNO0V5iVH45TBpC9NeEMRpjTqadrn3dNE43MQ+ksXV212HUuUqQlBtskMGWZzymLHrN4xBAVY9F5QkV6GjhwQoPTLiUFG2VhU1X6rRdbSAQ2BhlpNqU1zmDpSk2Ix71UK6tlXM9AhYjHPUBAJAiBXVQQxa99wi1ZCDh6o3Kf1QDSqA80fMSya1P7zD9P8A9izUptsqfNTMtKrUqgB5P7iAbjI7QJZYof7q/I/xEMt2JDKRxlAMfGFhT9PbqMUx8YeEv6x3GBUf+on8wy+DKD/1A/mHxl4S1BdMx9LfEp2B4mbG8zH0v8UvY8zL56l4jWEBibbJxyM4yi7RVjTWw3CMWkCeVu6JND3SHqEYmbNMqAIAMgISiGFyhqMryAFXOPQZ3gKLxqiwgXamJLnKIK6zDKdSGtLdHDtUOQgKWlrZWjaeDSorFwb6xG20tlFoaqKvpKxFwl7ADpJ3Dx3SUpVEWzMGYm5IAGfVLiapPo+md7D9UUdGpudx8poOjGKamYNZ7aM6KrfKAdHMBlUHes0CjDfAYMIVmPo9x/cT5GTQwr0qoZipHVL5/FIsvTIPP1B9YH8w+MuiU6vx7fmHxlxZaCG0zH0v8UvYHiZsgbZj6X+KXsDxMvnqXhJ2yd04jOTbKaRp0B9CnRqiHTGbTsOPZ0P4RDpjb1zm0lRlCbJZFwOPROa5t0QJU5ZQt0hRyBJIt8pRpYKjrBTuIl309mahhbFxk9Qi60/5PV85mYSpUxNNVpM1OiBZqo2t1L/Pyl5AlOmEpqFRdgEIsUxToKQpJJN2Zsyx6SZJcWlcBjnOJe+YMuocWgkxesYJa++NMExEUxEhiYtiZNURAtui2y2ftJJ5IinYiFUK+CT0xqgte+sc8oKyyzXuJX2EwGCY+l/il7A8TNhdp4TI0v8AFr2B4mXz1Lwk7ZP2ZJWQRlNI1qOWFTsiSpOQGQi8Ob0Fvt1RHLMNItyxDJGrFFvpDIqVlpKC1ySbKo2seqVDvSLTplnICjaTGYXCPjiHrAph9ybDU49A6p2C0c9R1rYwZjNKW5es9JmsLAS4zaNFVFCqoAGQAE426BALyNaA28nWirydaAd5BI6IN5BMioYCLZRDJgmRS2AinXKOaKYQpXo5UYWYy/bOU8Quq7QBQ8ozL0t8WvYHiZpoeUZm6W+MXsDzlnUpV5BgK8IG9+E0jRo5UEPUIxGuYNAezr2RAT0uKrGlhRs59Q7FkVL1GNf0VJTUqsclG7rM1NHaMGHPpqx9JXP2ty9QjcBgaWCp2QXY85ztaWS1pqRi3RXAEBnEBngE3MlBa8INFiFIo9aTrRc68BmtO1ou868KImQTBLQdaQSTAJhGCRCoicSu/pEfaDWW9M5bIFJRZ5maV+MXsDxM1SLPMvSnxY7A84nSswCqp6YS1mXahlw0l6JZwmFpM4LLeb1nB4OhWx6qtzTw6gAne03cNRpYekKdNQqjdE0gFUAZCGSYSrBYdMWzRVzeCxN4BlrmcDF3zkgyKYGk60WDJvAPXna8WxzEi8gbrQS0C5vOvCiLSLwTIvAZrTrwJF4DQYQzBHTFAxinKQVKgs5mTpT4sdgec2a/vGmNpX4odgeJiLX/2Q==", "data:image/jpeg;base64,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", "data:image/jpeg;base64,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"]
  ],
  fitness_studio: [
    ["data:image/jpeg;base64,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", "data:image/jpeg;base64,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", "data:image/jpeg;base64,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"],
    ["data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABELDA8MChEPDg8TEhEUGSobGRcXGTMkJh4qPDU/Pjs1OjlDS2BRQ0daSDk6U3FUWmNma2xrQFB2fnRofWBpa2f/2wBDARITExkWGTEbGzFnRTpFZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2f/wAARCADcALADASIAAhEBAxEB/8QAGwAAAQUBAQAAAAAAAAAAAAAABQECAwQGAAf/xABAEAACAQMCAgcFBgQEBgMAAAABAgMABBESIQUxEyJBUWFxgQYUMpGxQlJyocHRI2Lh8BUkM4I0Q1OSsvEWJqL/xAAZAQADAQEBAAAAAAAAAAAAAAAAAQIDBAX/xAAmEQACAgICAQMEAwAAAAAAAAAAAQIRITEDEkEEE1EUImGBMkKx/9oADAMBAAIRAxEAPwAwo1PnsX61JiuRdKgU7FaECYpa7FI7BFLMdhSGJI4jTU3/ALqg+qaTWSQfCnyO0z5PLsHdTlWsm+xolQxQy8xnxFSrgjY04ClKA79veKaQrOApcUmGH8w/OlBB8+6mIWurq6gZ1JzpcUtIBoGKUHFLSUrHQ8b12KZypwOadio6kp2KTFAxuKQinUhpASilrqXkMmtTIQkKCScAVSlkMz9yjkKWeTpmwPgH51yIRyPzrNvsaJUcqVIBXDbmPlThg8qYjgKXFdiloASkIB5inAE8vnVa5v4bfKr/ABJBzAOw8z2UATlWUZ7O40oIO3LwoLNfXLuGEhQg8hsPpv648qng4ofhuIs/zJ+37E0hhTFdUcMqTLmFw4HMd36ipfPakMSkxT9NcRSGMxSU7FRTTxQjLuFpDJQ3fS1DHMsgyDUoNLsFHYpMU6kNFhRLVSebpDoQ9Ucz3064mzmND5mokQd1at3gzSrI5FqQCkA8aeAaAOApcA8xTgKUoe7HnQAzHca7zGfKn6aQilY6IbiM3CaBKyDtC7E+tVBwiMD/AFH2zywP7/vNEDvzpMY5GlY6KUXCoQCGLtkY3I/anpwi3HMyHv639/tVsEg7jNW7aBZd2cKO7nTTBoGpwq2Rgw1hgNiHII8v7xRGKzeQDCkD7zdtEIreKPdVBPed6looVlMcOQJ8Z1flVaa0ki3IyO8UVriQBknFFBYCYVTurJZesh0P+R8xR25FswJY4bvWhj4B2O3fWUlRonYJ6G5i6qRkv3jkav23TaB0wVT3A5qXFKBU2OhR5UuKUCuNFgU1XA51IvKmgGnAYrcyHCpoImmfSuPWoR41DIl08g6O4WJB2KDn1NFhRobezSLBPWbv7BU7KrDrKD5is9E/EIwMXUb/AIlq5Ff3Kf6pib8Oc0WFF97OFvs48jUMnD1xlZMfiqM8TYjZBmq01zJIesxpOSGkxs0fRvjUD4io8iuzXVn2Lo7NOUkHY4plKKVjosR3MicmqynECPiXNDwaXNHZoXVF6TiDH4Riq7zu/NjUOaWhybH1SOJzTefKuzjxpnu6THSxlOezWQPyqRnSSRxDMkip5mnRSJKMxurjvU1NHwCBhvEvqxNWIeB2sTBggVh2rkGr6fBPYrBciuK0UFnCAdj55qrcWyxglXBHcTvQ4NApJgvpIIyDK5Rc7kDNEIZ+FMgHSDPe2QatmwhPIEegqjd2fR/6fSeq7VplEbLItrKQZSUejVXuILaMHE5J7ABmqDCQd3rTcuTuBjwNQ5FJEmrBrg9RnPdXDJ7DU2VRNk0jMSckkmpFhlKZVQfM1DIk6nrog8mP7UndAqJFOaU+AqKNu+rsXupHXkf/ALaStjZVdioyFZvBaiE02r/hZNPfkfvRKRLHGRK/oM1UkVdWISzD+ZcU6oVjVYsN1K+Bqe3iEvORF8zUSwSn7JpwgZfiYL5mhRYWEI+Hxncyavw0slpbqP8AV0eZBofmNPinUeRprT2iDrSZ9KvHwTn5JJ0RD1JVfyqIA008SslOACTTv8Ti+zGnzzScUPsyeKSVPhY1P09w32j6DFUhxFm+EfJaX3mZvvfSmsCLeJm56vU00xHtdR61X1SNzz6muKFuf5HFH6F+wQt9Ivwyr6N/WnHidwAcSZ25BjUA6JJAWjQ47CBUktzEYHRLeBcg7hBn51qRY6Did3NEHaF9/EkH8qd/iUgOGiYHxqnDhIkxqzjsYiuMYkbJG57STmpaRVlocVJnePo/hAJyoPP1qVeNxREa409R/Ws/fKY5GAk0dfByeYxTLeITbyTgLg4wurJ7BR1QuzNYntfapsUG3cDUp9pra4jBXUoPaD+4rHLDEkcnSnfIClAMZ8au2yRPaKIlkDDOTqyPlinQrDa39rO7OrO+Dg4xzqQXcRHUhJ/EaH8Gtx0E/b/ENXJbf4h/L+lQ1TK7YJDduOSIvpSe8zsOrKq+WKBW/C+lmiVpLcl114aXGw7D3GpOG8JE1hPOJNPRylcZJzuOXhVdGT3QVLSucNclvCpE4ZczbjWQe3IFZhWkW5YCSQAKNtdXeGSSvxaKJncqwOVJODUqI+wXm4YYs9I+47Ne9RR2iO+kIM/zE0t3NDacTWOecxRmEtpY4yc+NVbPiijiMxN6Ft1z0Z0n69tVT8CsImxEDoJItmOBpXJJ5/pUknu1ujErKNIydgMVSu+Li5t4JFuVk6NyzHOAMD+o+dO4hdDM8KhQpT7wJ5U6YWTK5ZgA5GeWdqsC3YjedB/voWnEJOgQ9GgAAUs0gGTUss8k2hNKQhELMyuWJz+v71Li/kakFbKPIfJ1EHnVnoh3VFaRGKKMoMBlBfUSTnFS5kZeqwB1HmOzNNKkBkrjaU1GNw/4TUE8i5DHpesPiz2+FPW6EXVWZ1zzwCK0SsmyYswcLtjanHqr8ZDEbYqC64lKtqXjnBwQDv1qbaXa36s5KrNGp1LyBH3h+tJxoEyvfL0iKWO7TYBO++KowyGNV0kfEfqKIXir7vH/ABo1KzZyc88eVD44Ygqf5qM7nkrHtHhQIuTjo7fdg+qUEkeIzirFnOiWoUZ1NkDHPnVQiFbAZm2E56wQ899qls3iEAKyMQWb7GO3zoEaTgi/5Wb8dXZE3f8AD+lU+ESxw2EryMEXXjLHHhVprq3ctpmjOV2ww8v0NS1krwZtbfU6uhBcDdB2CiXAJscDu49BwJNTP5sABj0ND1v7ZbnLlcBNJOMjeorLiNvDbSoEYFs7hv5gR+prRkKx8Vk9xBcXCxl1GEUAgHbtz60VvbNLiKJ5ZeiS3gLNpPWJ22HyrPX1zrJjXAQ2uojPMls/tTr6R3VuspjOMsDv8qhFie+2148wuYF0rEyR6Bvr7Ca2lkipYAKAB1eXlXnMJ6rH+dq9FtD/AJIeYpgZWW3Kx20uFCByw2zuWxyxUnHrdbHiUeQraozjCgd47Koly0m7kgONhnbeifth/wAZbHvRvrSGUuK/w/ZW2IJG4H/6NE7W5ENtFK0RmCxY0A4PxUL40f8A6pa/iH/katRkHhsQbGlkKnPiT+tJiNfaHXaQsFKgoDg9m3Knxjqn8R+tVuGu7cOsyQWLQqWbu6o51YDFUJwW6xGw8aBmIm4gtxFDHdYf3di0Uigb57G/eni8tHtTG0I1lsiQ91D76JY7ycWw/wAuhwGLeHLeoo+k0hxGxQjOQpIrWyKCS21vNsCN65Ld+Ht0iQRypnO4wR5H+xVAN2qdJq5a8TeI6JRqWqw9iyLNHbX8eIGdSsmvoiOsu2PUeVVI+GRhQpuACpJGoae7vq3dQRT4mt20SDfanR8Se4j93ndIbgbLIyjS3ge7zqWqHsrS2TNYlExJ/G19XfsNdaqI0RXTQd8g5qwLbiOvQ4hUczgBvXarfDrVklL3heZQMCNFCgnvJrKU4rZcYSZWvfdCrJNcyxyJgKqDY5Gcnwzj8qpyRWZUsl8+cbdJDtnnjPn+dFLy3Ro5GHDo2PPpHfcUNLxvZrDBhS2rqqebA5HPmOVJTUtD6tbIxBbwXCKY3uSwUkxqQqhtxt2nG9T2VoZnl6K3mMJJRuiYEpnvJ8PrTITc2jh4ZdMjBdRK8ttvkCaLWBZolSOSAYOohXKnOck4xR3XgOr8lCST3PiUwihUj3cIwkQY54GO/kao3j4VB45ozxmGfS0rWwMaIC0ivq0eGx3/AK1nJ5ulbYHSNgcYzTvAqyNhP8NvxGt/w95SkqsQY1Khe/4QawdlEJSUeQRgsSWIzW64dIH94AGMMv8A44/SmgZl7qOKGBJklR2Z9JQKQwPP+zRL2pQTXlkpdUyj9ZuXYaCTQvI2oMq9Y/EcZor7SK9/bWVxCCYxqyT2Dbn67UAVeNkf/FbTByCR9TU6yJHwiBpF1DGBvjB1bGqHGLlH9n4LcZ1xEau7meVE7G0F9w+KFv8Apswx3g7VMn1VsKtpGtsRixgG20a8vKpYuTfiP1qGxbTZ2ynmY1x8hUqsFU52yxHPxpgecXU+eIXKuwjUksqAfLPpRDhPGjbcOdY00RozNk76Rttz+VUpBwiMnTDc3MnItnSD9aqcVmjjC2dvCkIXeRVJPW7iTzx9aatrI3jR1tdNNeSTTRdKshOVJIwT3Hvp6MHzjO3InkfKqUUpWMKCcZORmr/DUJkE8hGlMnJ5ADmapNslpIckjRnY4rpXWUdYb1VW6e5unIUBGJIAHIVPgeB8KfbwKi1Y8WmtAIyxkh+6Ty8j2UZsrkXVwsiXAEK7upzrPhj9azDp3U1JHicFSQRyIOCKmUVJUUpUzbG5ssbTp86G3phC67WeNJA2oajlQTsSB2Egc6De9Q3JAu4yW/6kZ0t69horY8N4LcYxNKzfdkfH0rmfFHj+7LNe7njBchaOWFZBATntCk58iKeqgMSIWB/AaJQQQwwJHCoCIMKB2U/ox2c65HyrtdG6g62Z8x+9mSGLAeUnyGDjf8qE8atTZRwQuVLZctpORzFabiCXsZUWUCOSN2Zsaah/w65uEU3cdsZB9oR6j+dbw5oqOcGcoNsyGoaBjA7Dit9w+2jijllUEvIwLMefl5UFv+AG4lXSW3XdjgAegFHIEuY4CpSFh35ZT8t62jzwZm+KSMPcBTqJGSM4oj7SrEsFpFbhcRZBVDnTsKWTgN0Tu6Fc9bGQcfKrd5wd5blmtdDxsMgFtODtns8auM4z0yXFx2CrnhnvHA7c2duXuHwX08yMmjXChJYRRNcwyxhY2Byh23qvBw680COQiMI2U0tk0agkvYIwBMzYHfn61jPljmLNI8bxIK2pBtYivLQMeWKcgDKcjOGPMeNV4LxOjUPqDAbnTtn0qWGeJlwJFzk7E47a3Uk9Mzaa2YK8XhlhaC5tF6SUnEbMScN/Tn8qC2yCViz5Yt3DJ8TU2huK36W9sNMSDSgP2VHMnxP61p+F8JitoXF0ekZiNhGMAD1qZSXGquwScnZmxLawsNcHSqPsIx3Piw/Sn8RuSlqsIjSJ5QHdEGAi/ZX9T6Vpb97KxtXkVR1RyKgenPtrHI4urxpbqQqGJZmC6t/KqhJtWxSik6JLcdHCfvMd/KiFrbW1wij3h1lxkro2Hfv3UPLoWOlsgcsjFWHc2vDC3/NuuqvhGOZ9Tt6VSVg3REZXur/TbjCswSNcegrTv7MxPGNMzBsbkrkZoV7H26ScRaV/+WvV7s8ia2UlxDCuSxP4RXNyz5HOoGsIwUfuMlcezF5GSYjHKPBsH86GzQXFo2Jo3jI+8MVvbS7t73UIWyyfEO0VM0SsukgEdxGaz+onF1JFe1F5izAwcUuoPglYDzzV2P2lvFPWZT/trST8F4fKcvaRZ71Gn6UO4lwPh9tZySrG4bGEHSHdjsKtc8JumifblHNlRfamYc0Q+lOPtVMfsJ8qzspxMUjbKg4zithw7gFqLOFriIvKVBbLHtp8j4+PcQh2npguT2lumGBgeQp0VxfXmloZ5XkO4CLyPjWji4baRDC20Q81zVxECphRgd2KyXqF/WJftPyyu0JMeGwTjfuqnNcLYEFgxU9UYUkCiZx35pDGJFwygjxrDjm4O0aSSksgyJ1nXXjY1aRCB3Cpugj+7geFO0Acth41DbbsrwQiMrv9KawJG4BHiKtACkZQKoLPNOG3L8PYvGDrdcHC6qvrccSvlyiyFO9mwPkMUeteD29mmrol2+1Ic1X4vxRbWxZopEY/Cujlq/pz+Vej1cndHHaS2ZzisvRhLNSCUOqUqPif+nL50UtPZ+AWyG5uGDsMtGg3HhQrhFsbi66Z8FUOTq3yaPMdXxOzeA2H5VrJdvJCdEY4Xw6JtKxtnGSXfkO048KA3k5vb0tGuFJCRJ3KNgKJ8XuBb2XRIArz93YgP6n6VU4Jb65mnYdVOqvn2miuqpBduw3ZvJZ2iQRMqBRuVXcntOTXOxkOXJc97nNKB3CpFt2Yamwq95piGRTywuGidlI7qK2nGWOFuI/96D6ihXTW6voi1Tv92MZqZIbqXnotl/72/YVE+OMv5FRk1oORX1vcS6Ebr9gZSM+VBvai8EaaAf8ATGf97bD5DJ9RT7S0WHiMdxqkZYo3aSR2z2f+6z/tDdNNdiM/F8bjuZuz0GBWHHxRjyOS0v8ATWc240/IzgFn77xOJSMqDqbyFb9Qe7FZ/wBjrMpayXJG7nSp8BzrR4zyNcvNLtM241URFAznfNOJ7TXAAeNKfGoSwUIBnfO1dnfvru3ekOf6UgFO9IF3ruXOu3NIB2ByFNI76cNhTcdpqgMRFObl1DZkcnALsT9aEcUuvfLwRxHMcfVTx7z6n9KtXUvuViSNppwVX+VO0+vL51Dwe0LuZiBhdhnvr2H8HAglZwi3t1jHPmT3mpwM/E2lebHuA5mlKpCuZXCj+Y4qhxq7CWixRnecZO2MJ/U/kKEhAu8ne/viyru5Cxr3DkBR+BYbGBIWcAqMYG5J8qG+z/DxdSPPKWVE6q6Tgk9u9H82lgmQI4v5j8R9edL8sf4RHGbmT/RgES/fm5/KpPclfrXUzzkdhOlR6CqknFXmbRZwNIx+02w+VSxcHvb4g3cxC/cXl8qznyqJcYNjpeLWdqpjiKswIHRx45mnwpxO+YMqCCPuO5NFLL2etLcq5hTWu4YjJoidEKZYhF7ya5p8zliJtHjS2CLs+52IjmbVkF3P8i7kepwPWsVre7u2kbd5GyfM0e9qb8PEQjZ6dtK/gXt9W+lCuCpGLpXl+FdwAMkmuiMXGCi9sybuTZsba4FnZxW1smoouCzcs9u3nVW44jc2smTca5D/AMnSD/6qtLeSyDSn8FPD4j69npVYYUYUY7/GmuKC8Cc5M1NheC7tkfqrJjroDkqatCsaJGRgyMVYciDg0RteOSxYW4HSr3jZv61zT9O1mJtHlT2aGk2HLnVa2v4LofwpAT2qdiPSp1I7R61yvDpmyyrHbHeuyoG1NZt8ClGFGaVgJ5UuNsmkU53ric0DPLbmZ+IXxdUOD1UQdgHICjlnZXfQorMtsgHJRljVLgsMcCG6nZUHJdR+Zq5LxoE6bWMyH7x2Fewmts8+vCLfulrbKXcamAJaSQ6iAOZ7qy15cPe3jSYwXOFXuHID5US4reTLYpFK4M0/XYAYCp2D1O/ypfZjhpu7hp3XKJ1Vz2n+/rSnKlY4xtk9kL1rZLe0j6NFG7cyT2nPZRGz9nOkcSXDNIx57/rR63tUjUZA2qeWeK2TMjBB2d59K43ySlhHQopbIbXhkUC4Cqo7hVl5YraPLFUHjQu44u7ZWBdI+825+VDZ58EyTSZPex3qo+ncsyJfKlhBafi5ORCv+5v2obc3EsrAFy0sh0pk9pqGFLi8z0S9FGBnW3xEdukVHf8Au1hFNPbyGVkTQJG3Jkb9hk+tdUOOMdGMpt7AfFp1ueIsIzmKICOPyG39aI8Nj6K2z2t9KD2kRklUDmTR8AKoA5AYFLcrDSocTSUmaTNUApNJS05EL8ht30APtZEhmDuhbG4wcYNWLjit5JssugZyAo39TUaxBR+tVbmY9J0MI1SHbbspOMXtAm/Ab4Txdrif3ecAyaSwZds476Las86zvBOHiLiEUjHVJpcsfQVodGW7gK8znSU/tOzjbcckoAxvTTgAmuz2UmNR8BWZZ5/acGklYGXO3fvRdrKDh9sXcAYBJPaAOf7etFoIlQDArO+19xIEEYOFZ9J8gAfqfpXoxuUsnHKkjP3E0l/fM+MvK2FUdnYBW64fDDwmxiidwukb97HtOKw3DZGhvFkQ4ddwccjWnsz0uXfrN2k8zWsod9kqXULScSkcEQLoH3m3P9KqSkKDLM/mzmnXUhtrKSVACyLkZ5UIV2uQs0zF2IyM8l8hVRgo6Jcm9liS7aQ4gXC/9Rh9BUYQBtTEu/3m/vauztSZOKYEjSlYyNR08yKGcclKiC07VHSSfjbs9BgURhUSXUCNurSAEd450AuJGnvpZJDlmck/OhukG2XuFRYJkPYMDzogWqvZgLbLjt3qWpjob2OzS5ptSQqGJJ7KYh0cZc5Owq5HHgcqZGN6rcYuJIo0jQ6Q+c450w2dd3bSSe72nWftYdlSW8MVjEWY5c/E3fXWUKQ2ylBuwyT2mqdw7S3RVj1VOwrHklRpBGj4ZIoXpFIbVz7x4UUVtQz2UB4OoDkDlR3ktcMlbs6UxTg7ClOMYHZSKAEpj7cqzeCj/9k=", "data:image/jpeg;base64,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", "data:image/jpeg;base64,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"],
    ["data:image/jpeg;base64,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", "data:image/jpeg;base64,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", "data:image/jpeg;base64,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"]
  ]
};

/* ================================================ SAMPLE PORTRAITS ====== */
/**
 * Faces for the sample roster.
 *
 * These are demo data in exactly the way the names and the branches are. A
 * card with a face shows what the screen will actually look like, and nobody
 * looking at it believes Maya Okonkwo is a real person any more than they
 * believe there is a real branch in Scottsdale.
 *
 * The line this does not cross is the one that matters: a photo makes no
 * claim, but a description shown in violet claims the model produced it. The
 * seeded clips therefore arrive with their frames, their measured fields and
 * their rights, and with no description at all until someone presses read.
 *
 * Portraits are from randomuser.me, which publishes a fixed licensed set for
 * this purpose. Resized to 96px and embedded, so the app needs nothing from
 * the network to render a roster.
 */
const SAMPLE_FACES = {
  "p0": "data:image/jpeg;base64,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",
  "p1": "data:image/jpeg;base64,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",
  "p2": "data:image/jpeg;base64,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",
  "p3": "data:image/jpeg;base64,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",
  "p4": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD//gA7Q1JFQVRPUjogZ2QtanBlZyB2MS4wICh1c2luZyBJSkcgSlBFRyB2ODApLCBxdWFsaXR5ID0gODAK/9sAQwAIBQYHBgUIBwYHCQgICQwTDAwLCwwYERIOExwYHR0bGBsaHyMsJR8hKiEaGyY0JyouLzEyMR4lNjo2MDosMDEw/9sAQwEICQkMCgwXDAwXMCAbIDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAw/8AAEQgAoACgAwEiAAIRAQMRAf/EABwAAAEFAQEBAAAAAAAAAAAAAAUCAwQGBwEACP/EADwQAAEDAgMEBwYEBgIDAAAAAAEAAgMEEQUSIQYTMUEHIlFhcYGhFDJCkbHBI1LR8BUzQ2Jy4STxNIKi/8QAGQEAAwEBAQAAAAAAAAAAAAAAAgMEAQAF/8QAIREAAgICAgMBAQEAAAAAAAAAAAECEQMhEjEEIjJBQmH/2gAMAwEAAhEDEQA/ANf5JDhdeJck6pwo6AnmJkNJTrGFccPDVUzpC6QaPZVho6UMqsUcLiMnqQg8C/7Die5TekPalmyeAOmiIdX1F2U7DyPN3gPqvmmvq5aieWpqZHTTSuLnvcbl7jxJQuVBxj+sKbSbV4ni9QZ8SrZJ5He63g1o7ABoAgvtbmdeQ5pOAHIKFmLpHSuN7cPFIcS99vn3BA2GTW1rtXvdcX0HK6cGKSudnc4hv5Qhbuu4W0aOH6rzgSNDa+izkbRYKbGiSN4SGtRqlxbgGPDnW4HS377FSGWjZnd7rfUqRS1EoAOcsDtSez9hapnUaXh2JxixqLOd25tSfJXfANpo6drRMckfAZnLFaDEnuy2vbgwHie9WCna6WMPqN+SeG7B081zkuzqs+hsOrIayBssDw5ruw3U+NwKy3o9q3UsZGd26sLa31/fctGo52yNu1wIJ5I4ysVKNMI6W0SSBzTQcV3NbmjsFC7BJNkgvSHOJ5obNGw0JQYEoNCULIjDgaAlNte50XChG1uJfwvZrEawGzooHZT/AHEWHqQsZ1WYT0nbQPx7amplDiaeAmGEX4AaX+p81R6j37N4NHqictzq834uJ8/9Ia4ZieRcfop7spGDHZtgLjhZI3ZOgGrlMEdwL8A0uPcP3ZLbCbOfwNrDuJ/0sbOogtivcgcTZq8yLO+zeHAfqpro8sBc0c8jVzdiKDQavORvgPeKGwqIMjRLOGcIo9T3rti7KHaZusf7WpdPFvC7jYnL9yiOE0BxPEI47WbIczv7WBc3RiVssmwWz3tZFfVMG64RMI5dq06iwqmaASwHyQrCo2QwxxxNAa0BoA5BH6N5BtogTt7KOPFUOQYZHBUb+EZCTqG8FaMKhke0SucCP7e1CqQh2hAR/DwxsF4xlDjqB2qiBLkRJylccO9LGq7lTRAzlK5kKkCMlKES6jSLdduV23cuhaCIN1RumOodBsg6MH+fPGw+Au4/RXsi6zjpyfbB6CIal07nfJh/VDPphw3JGMztAgJdoSLW8kMy2e2/Etv89UYr22jaB+X62CGxNz1Tr8AWj1UyeihoVIzKCOb35fJo19bJ6Zgjha0+9I7KPv6Lzm3q4mn4G5j4kk/olPIfXkP9ylju7xP7shsKhl0eeZkTdMguf8j+gTVbxIj91rMrfP8AZUprTHCwu/m1JLj3N5/omHtMk2Vo1v8A9LE9mvobp4bwhjdC8kX7BzPyB+atOyVKQx0+WxlPVHY0cEFhgzZIYh1pTu2245Rx+auGH0+J0lOHRYaC1oGhlF7eCBtsZBU7LLhkZAFxqjEbSGhw5KqYTjj31BhqqR9O7hqrHT1BeLNN9EN8dDq5bDVE8tc2+is2HEOiOU87qg1tfPTxhtNDvZzwaTYDvJ5BEtjpsVnxBvtNfARa7oYm3FvFUY5WyXNC0XmMJ4AJttk40hVkQsBdAXMy9mWHEXKuEgJLnntTTnFdaMocL+xZf03yk/wyMcLvPotLBKzHpoF58NP+Q9UvI/UbiXsZdiWpAPwgfRQKNgdVnXqh9z4NCLYk28trchf5IZQ+/M866EDzUqeiprZ2ls+qdK8aNFz4fsJunG9jJebOqpS53+I/ZSoifZXZDrIbX+qW0hjXSE9RjMjPv89F1nC5Hhz5ZrWbGAwdgCRRQmU5jpmOYnuXqhpZDHAeLvxJO7uT1Q91NAIv6kgBcByvwCFulo1K2NPxGLD5xVEWt1ImgX8SptPtXjkjju2btgaXDevyE+Fge3RdgwOKqZEZmB5aLDWxB5o/h2BQRAHduLgNC55KKEorsJwm+hUOKVFTSVEddHkqoHWLSQXM/wDYe8O9GdlMTZv2Nn4XsUKr4XRxbqEWHOw5eKYomGAh5vprZA6bsdFNKmObWYjikOLTwQRhzWSEFzmF4A7mjjpbirJ0XS47FjEstTTQ1DJYmNc6kY1mQnUh4J6p4ajsKmCiZjNFBVB5zRtyyNGt7cDZW7YuCload9PTxtZmOYkNAuVTjauqJMsZU3ZYQTbXilhyQSvB2qfZIPNKVdMh1kl0lius4TluFwxkqUGCy9lCPiBZGbEsz6bGZThr7dUPI9QtVyhZt02x3w6jkHwzj6BKyr0Y3E/ZGSYjc1d+WU39UHhcY6R7h7xa4/YI1W61Wv5Df5oOxmenYD8Tmtv3Xufooo9Fj7FOaI2sYOTb27zoAnmszVTIf6cLc7rc7cvN30TUF5a1rx8N5Bft4N+qmU0JMchjaXPkdlbbiQOHqtbrZ1XoYADpnVE+rGEEj8zuQ+5TMLzPW7yTWxzeZ4JFdMJJRBEfwYDq4fG7mUumGV0bebruP2QDIrZa8I1LVaaaNrmdyquEaZVZ6M3AAQWVUM4lFHFG5ztABxQWISTPDgy0Z5qxYhE2aLI7XNxQ9mFXj3Qkc6M8uBHmFt7B6DWyNUyknLS8ZT1S23FXXB3tFY0s0u63kqzs/gVHTQSNyXkDtCT7qsWCRObiETOOt79yfBvRPkaaZY3BeaE7uyUoMVnE8yxAakOjupTGJWQLqNGN4F7PdQWSkp9rrreVgUP5tFQul9m8waDulHHwKvOpCp3SnGZMBv8AlkBQZPljMX0jEqoZpLjTT7hCWn/jxW0vcj9/JFqofzhw5eqEg5oxYceqPmoI9FzHoAY4pJAOtZsbfH9lEcVcMKwYkn8WS0be0aa/f5pGHQt3kYk1DXGV32HooO103tFfBFJJZkbQcjeLnHU/Zb26OXRCwymdMWsDblzru7AB/wBohIwNr8jfhaBwSsNIjfe2VkULnZR23sE05/8AznPJ1cVl2xq0i0YU2wCP07y1mnFV3CpOqEchdZoubpY+yRV1TKalEsge/MbDI26FOxuo32WmpXZT8TiLorvN4A08kmOjbLIBl1J4hEml2YqvYQwWsx2rLcsLI3jU714GcdmnFX3ZFkklpahobJGwtIGoBuqfgsM0NS3O57mjhdH8FxfJtg/CwRlFLmdr/Uvcj5W+apxtWibyXafEui9dMGU3Xt4rLR5Y+HL2dMhyWDdY2EDI4ypUTO1dsAlNeAuSBsca0KtdIMBlwGcDkLqyh4QvaSIVOGSR8nC3zC6StUbB1JHztWNtvr2HAoTBDmqKaAcb3I+6OYtGY6hzHXBsR5odhjB/EJJTwhhc77LzVo9HsUJhv5QNGXyDloAhWLH2naKaTg1jGn/5CfnlLXiP4jG8+ZH+1EqvenmvYSyBg7SBxRI4lULwY5dScpa0+Qv9SuTRyNlYbfDc+a9RR5aami13lS4zOHY3kjopWyOOncgbpjErVEfDavJZpuD3qw01W0jigctBkdoFKoaGV5AbcrLTD2iwQytPAovhhaXgkiyBS4bJQ4NWYlPMWxUkLpS21y63LzVYoOkemEkcfsc4c5wbxbYXKKMG9oGWRLTNnw+SLflrrWHM8gs92Yxwv28fiDn6S1jjf+1xLfpZQNpNpq8Vj8KjLImTROD3tdd/MW7rgeOqEYS7JXxub8bWvHjp9wiboBex9L63slNBTOFTiswulqecsTXHxtr6qVeytWzz2qdHWBOBNhy7nstRhBfOm/aRfimyxx4JBp3ErG2ZRJbU96bqpN7TSMvqRp4pDady77O9Y3I0xLbWn3ONvFrB7y77/qgkMWSirHAdaWQRD/EC5+pWg9KmCyCBtfEy+7NnkcgeaomIyNp8MY+3vZyO8k2+yjnGpFkHaK9UOHtuliZXhgPYLW9SUoUgknYyRw3cLet4ldpmfjskNiWWDR2njdKxHPnFLCDvJHWNuAbzK5jEP4dKKisnrCA2JlmMHgrJhjc4F7G6rbN3AyGlY4WJLvEDS/mbqyYVdoalsYmHBhjZm3A1tzT+H0RhfZzD5KXhjw4AHmikcADwQtijHIqvSjM6l6Pq1rA4GaSKI+Bdc/RYS0XcO9b/ANLMG92Drb/03xv+Th+qwuigzSZyOqzUqiGkSz3IIYS8U1fByGa5+it9EzdSUbhrZ74+HYTZUWBxfNn4FzwBr3rQKZh9lonE6+0E/VKyj8WzedjJS/ZynF75C5vr/tGAblAdgDvNnIyb33jvqrE1irh8oiyfTPNC7lTrWABdyhMSAIga1eyBdyrtloJ4MXd1deanQdFtGWC8WwuOupZIZWhzJGlrgvnnb+H2CvjwkEnJ7x7jr9PqvpOqqIaeIyVEjY426kuNgvmjbSrbW7QV1e65D5C1l+y9h6WU+dJJFPj22wbRDNIXvsGZrNvpdQpKoz4gGxE5Rd8j+btdB4XTrpXBrzxyMs3uvzUbDGEzkjV563y4etlL/pWQcTryzHXEHqRWjbbu4+t1e9n6kTQscDcEcVm9YzfEyfFxKNbF422hqxT1ZO5ebB3Ye9MlH1tC4SqVM1zC5MpAVlpiHsv2KtYfHnaHN1BFwjuGvsQ1yVEYwb0jRGbYnFWtFz7OXAeBB+ywY2bRZWfGbL6VxOkZV0M9M8XbNG6M+Ysvnqvw2SlMsBYQ6J9yPA2KataFNWDsNZvMQiZbqgjRX6CUONLED/LcqThrMkpmPw3sjuG1OSpMjtWwtLz3lLy7ehmLSNx6IcZjrocQoWuBNNLYfLX1utA4L526KcVOB7cOge+0VcOqSeN9R9Vv++JVeF+tEmZe1ksEdq6CFGYSU824TrEkcFKDghzZnFLa9xPFdyQNE8OC6XgDtPJQZqhlLTSVFQ/JFEwve7sAFyVVMR2zdJA/2Wn3cT2kbyR3WIPMBPxYp5flCMuaGH7YM6Qq/e105e5ssdMzqWN7Ot+qyrHoQyenYTfq5neJ4KzY5ibH0u4jFgXi5ve6p2J1e9Mk5ObXMPLRo/fah86CT4r8QzwJtx5v+mDqmbI57WjM91hbuXqZ3szotbvlOYnnl7fM/RMlojP4p5ZnnsTMNQaiV8puNQ1o7B2LzErPTk6GcRj3OJTR8A7rt89VDyWdcafZFdo4yPZqlvZkJ9Qh3GxA0IumLqxb7NS6LsfFRGMNq3DeMH4TjzH5f0WhbsxvzAL55wyqloqmOencWyRkEW581umzeKfxrCYKuKQEuFnjsdzQOOxqlosDnCSmzN94BUTazBaWeqFTlcx0mrnNFxfvCubd9FwsQeSiVdI6VpDmXY7iOxa0cmjHcbwd2G1ERhtJDLexHIgXsRyQkzeyQsjd700lie4an1Potvfs3S11K+CaBr3HVj+DmnkQVl+MbNyxPmpKuJzaiF7wQRxF7gjyWcTm1+Eenc99FBW03/lYbIL24lnEelwvozZfEW4xglJWwuDmzRh3nbVfNOCzy4ZiAZU9aFwyPJHFvae8fRbF0P4iKOWr2feTkH/IpSTxYeLfIrcepUxeRXGzUYWdpUgAKE15Tsbyq+iU/9k=",
  "p5": "data:image/jpeg;base64,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",
  "p6": "data:image/jpeg;base64,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",
  "p7": "data:image/jpeg;base64,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",
  "p8": "data:image/jpeg;base64,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",
};

/**
 * A face for a name, drawn from the name.
 *
 * These are not photographs and are not pretending to be. Real headshots would
 * mean either inventing likenesses of people who do not exist, or holding image
 * files this prototype has no business holding. A stable mark derived from the
 * name gives the roster the thing a photo actually provides here - a fast way
 * to tell nine rows apart - without either problem.
 */
const AVATAR_TINTS = [
  ["#E1F5EE", "#0F6E56"], ["#FAECE7", "#993C1D"], ["#EEEDFE", "#534AB7"],
  ["#E6F1FB", "#185FA5"], ["#FBEAF0", "#993556"], ["#FAEEDA", "#854F0B"],
  ["#EAF3DE", "#3B6D11"], ["#F1EFE8", "#5F5E5A"],
];
const hashName = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const initialsOf = (name) => String(name).trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

function Avatar({ name, photo, size = 36, height, square, className = "" }) {
  const [bg, fg] = AVATAR_TINTS[hashName(name) % AVATAR_TINTS.length];
  const src = photo && SAMPLE_FACES[photo];
  if (src) {
    return (
      <img src={src} alt="" aria-hidden="true" className={`shrink-0 object-cover ${className}`}
        style={{ width: size, height: height ?? size, border: 0,
          borderRadius: square ? 14 : 9999 }} />
    );
  }
  // Someone the coordinator added has no photo, and inventing one for them
  // would be the only dishonest thing in here.
  return (
    <span className={`shrink-0 inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: height ?? size, borderRadius: square ? 14 : 9999,
        background: bg, color: fg,
        fontSize: Math.round(size * 0.36), fontWeight: 500, letterSpacing: "0.01em" }}
      aria-hidden="true">{initialsOf(name)}</span>
  );
}

/**
 * Filling the library with placeholder footage.
 *
 * One search per room the gaps actually ask for, so the shelf looks like this
 * spa rather than like a stock site. Every row it writes carries
 * `sample: true` and the photographer's name, which is what keeps a stranger's
 * sauna from being mistaken later for footage somebody shot at San Jose.
 *
 * No description is written. The rows arrive unread, and the same Read button
 * that reads real clips reads these - through the same function, the same
 * matcher and the same privacy rule.
 */
async function fillLibraryFromStock({ gaps, creators, collabs, onProgress, signal }) {
  const rooms = [...new Set(gaps.flatMap((g) => g.room_type))].slice(0, 8);
  if (!rooms.length) return { ok: false, kind: "no_rooms", title: "No gaps to fill against",
    detail: "Write a gap first; the search follows what the gaps ask for.", retryable: false };

  const out = [];
  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i];
    onProgress?.({ done: i, total: rooms.length, room: label(room) });
    const r = await findMedia({ kind: "photos", query: `${label(room).toLowerCase()} spa interior`,
      per_page: 3, orientation: "portrait", signal });
    if (!r.ok) return r;

    for (const item of r.items) {
      // The library is a view over accepted clips JOINED to a collab, so a
      // clip with no collab is invisible there however it is marked. It also
      // takes its rights from that collab, which is why an unattached row
      // showed "Rights not recorded".
      const collab = collabs.find((c) => c.rights?.entered_by) ?? collabs[0];
      const branch = collab?.branch_id ?? BRANCHES[out.length % BRANCHES.length].id;
      out.push({
        ...makeClip({
          branch_id: branch, collab_id: collab?.id ?? null,
          filename: `${item.id}.jpg`,
          thumbs: [item.portrait ?? item.small, item.small, item.large].filter(Boolean),
          frame_count: 3, clip_status: "accepted",
          system: { duration: 8 + (out.length % 14), width: 1080, height: 1350,
            aspect_native: "vertical_9_16", duration_bucket: "under_15s", capture_source: "phone" },
        }),
        accepted_by: "Sample data", accepted_at: now(),
        // The creator and the rights are not stored here: the library view
        // reads them from the collab this clip is attached to.
        sample: { source: "pexels", credit: item.credit, page: item.source, alt: item.alt },
      });
    }
  }
  onProgress?.({ done: rooms.length, total: rooms.length, room: null });
  return { ok: true, rows: out };
}

/**
 * Loads a sample visit: real video files, pulled from Pexels and put through
 * exactly the path an uploaded file takes.
 *
 * The important word is "exactly". The file is fetched into a Blob, wrapped in
 * a File, and handed to the same extractor - so it is probed, decoded, framed
 * on a canvas, and uploaded to storage the way anything else is. If decoding
 * is going to fail on this machine, it fails here too, which is the only way a
 * demo tells you anything true about the product.
 *
 * Every clip it creates is marked as sample, and the mark travels with it into
 * the library.
 */
async function fetchSampleVideos({ rooms, per_room = 2, onStep, signal }) {
  const out = [];
  for (const room of rooms) {
    const r = await findMedia({ kind: "videos", query: `${label(room).toLowerCase()} spa`,
      per_page: per_room, orientation: "portrait", signal });
    if (!r.ok) return r;
    for (const item of r.items) out.push({ ...item, room });
  }
  if (!out.length) {
    return { ok: false, kind: "nothing_found", title: "Pexels had nothing for these rooms",
      detail: "Try a gap with a more common room in it.", retryable: false };
  }

  const files = [];
  for (let i = 0; i < out.length; i++) {
    const v = out[i];
    onStep?.({ done: i, total: out.length, name: `${label(v.room)} clip` });
    try {
      const res = await fetch(v.file, { signal });
      if (!res.ok) continue;
      const blob = await res.blob();
      // A File, not a Blob: the extractor reads .name and .size, and the whole
      // point is that this takes the same road as a real upload.
      files.push(Object.assign(
        new File([blob], `${v.id}.mp4`, { type: blob.type || "video/mp4" }),
        { sample: { source: "pexels", credit: v.credit, page: v.source, alt: v.alt } },
      ));
    } catch (e) {
      if (e?.name === "AbortError") return { ok: false, kind: "cancelled", title: "Stopped",
        detail: "You stopped the download.", retryable: false };
      // One file failing is not the run failing. It is left out and said so.
    }
  }

  if (!files.length) {
    return { ok: false, kind: "download_failed", title: "None of the sample files would download",
      detail: "Pexels answered, but the video files themselves could not be fetched from this browser.",
      retryable: true };
  }
  return { ok: true, files, asked: out.length };
}

/**
 * A self-test you can read and photograph.
 *
 * Every question that has cost a round in this build - is this the current
 * build, is the database reachable, does the model answer, does the picture
 * search answer, are there any pictures at all - answered on one screen in one
 * press, with the failure text in full rather than a status code.
 */
function SelfTest({ counts }) {
  const [rows, setRows] = useState(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    const out = [];
    const add = (name, ok, detail) => out.push({ name, ok, detail });

    add("This build", true, BUILD);

    const conn = getConnection();
    add("Database connection", !!conn, conn ? `${conn.url} · from the ${conn.source}` : "none saved in this browser");

    if (conn) {
      try {
        const r = await fetch(`${conn.url}/rest/v1/settings?select=key&limit=1`,
          { headers: { apikey: conn.key, Authorization: `Bearer ${conn.key}` } });
        add("Database answers", r.ok, `HTTP ${r.status}`);
      } catch (e) { add("Database answers", false, String(e.message ?? e)); }

      const ai = await callAi({ task: "search", input: { text: "sauna" } });
      add("The reader answers", ai.ok, ai.ok ? `${ai.ms} ms` : `${ai.title} — ${ai.detail}`);

      const media = await findMedia({ kind: "photos", query: "sauna", per_page: 1 });
      add("The picture search answers", media.ok,
        media.ok ? `${media.items.length} of ${media.total} results in ${media.ms} ms`
                 : `${media.title} — ${media.detail}`);

      const video = await findMedia({ kind: "videos", query: "sauna", per_page: 1 });
      add("Video search answers", video.ok,
        video.ok ? (video.items[0]?.file ? "a playable file came back" : "answered, but with no usable file")
                 : `${video.title} — ${video.detail}`);
    }

    add("Creators with a portrait", counts.creatorsWithPhoto > 0,
      `${counts.creatorsWithPhoto} of ${counts.creators}`);
    add("Clips with frames", counts.clipsWithFrames > 0,
      `${counts.clipsWithFrames} of ${counts.clips}`);
    add("Clips accepted into the library", counts.library > 0,
      counts.library > 0 ? `${counts.library}` : "none yet - the library only shows accepted clips");

    setRows(out);
    setRunning(false);
  };

  return (
    <div style={{ marginTop: 16, paddingTop: 14, boxShadow: "inset 0 0.5px 0 var(--hairline)" }}>
      <Button size="sm" variant="outline" onClick={run} disabled={running}>
        {running ? "Checking…" : "Check what is working"}
      </Button>
      {rows && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 9 }}>
          {rows.map((r) => (
            <div key={r.name} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
              <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 999, flex: "none",
                marginTop: 6, background: r.ok ? "var(--accent)" : "var(--blocked)" }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, color: "var(--text)" }}>{r.name}</span>
                <span style={{ display: "block", fontSize: 12, color: r.ok ? "var(--text-meta)" : "var(--blocked-text)",
                  lineHeight: 1.45, wordBreak: "break-word" }}>{r.detail}</span>
              </span>
            </div>
          ))}
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-meta)" }}>
            A red dot with its line is the whole answer. Photograph this and send it.
          </p>
        </div>
      )}
    </div>
  );
}

/* ==================================================== CLIP VIEWER ======= */
/**
 * Watching the clip.
 *
 * A still cannot answer the question this stage asks. The coordinator is
 * deciding whether footage is usable, and usable is about movement: whether it
 * is steady, whether the pan is smooth, whether someone walks into frame at
 * eleven seconds. A single frame hides all of it.
 *
 * The original is in storage, so it plays from a signed URL. When there is no
 * original - a clip taken in before storage, or one whose file failed to save
 * - it falls back to stepping through the frames we do have, and says so
 * rather than showing an empty player.
 */
function ClipViewer({ clip, thumbs, onClose }) {
  const [url, setUrl] = useState(null);
  const [failure, setFailure] = useState(null);
  const [i, setI] = useState(0);

  useEffect(() => {
    if (!clip?.video_path) return;
    let alive = true;
    (async () => {
      const r = await signVideo(clip.video_path);
      if (!alive) return;
      if (r.ok) setUrl(r.data); else setFailure(r);
    })();
    return () => { alive = false; };
  }, [clip?.id]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (!url && thumbs.length > 1) {
        if (e.key === "ArrowRight") setI((n) => (n + 1) % thumbs.length);
        if (e.key === "ArrowLeft") setI((n) => (n - 1 + thumbs.length) % thumbs.length);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, url, thumbs.length]);

  if (!clip) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true"
      aria-label={`Watching ${clip.filename}`}>
      <button className="absolute inset-0 cursor-default" aria-label="Close"
        style={{ background: "rgba(12,10,9,0.72)" }} onClick={onClose} />
      <div className="relative bg-white rounded-xl overflow-hidden flex flex-col"
        style={{ maxWidth: 520, width: "100%", maxHeight: "90vh" }}>
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200">
          <span className="text-sm font-medium text-slate-900 flex-1 truncate">{clipSentence(clip)}</span>
          <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-900 cursor-pointer">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div style={{ background: "var(--hairline)" }} className="flex items-center justify-center">
          {url ? (
            <video src={url} controls autoPlay loop playsInline
              style={{ maxHeight: "62vh", width: "100%", objectFit: "contain", background: "#000" }} />
          ) : failure ? (
            <div className="p-8 text-center">
              <p className="text-sm text-slate-700 leading-relaxed">{failure.detail}</p>
              {thumbs.length > 0 && <p className="text-sm text-slate-500 mt-2">The frames are below.</p>}
            </div>
          ) : clip.video_path ? (
            <div className="p-10 text-center">
              <Loader2 size={18} className="animate-spin mx-auto text-slate-500" aria-hidden="true" />
              <p className="text-sm text-slate-500 mt-2" role="status">Fetching the file…</p>
            </div>
          ) : thumbs.length ? (
            <img src={thumbs[i]} alt={`Frame ${i + 1} of ${thumbs.length}`}
              style={{ maxHeight: "62vh", width: "100%", objectFit: "contain" }} />
          ) : (
            <p className="p-10 text-sm text-slate-500">There are no frames for this clip.</p>
          )}
        </div>

        {!url && thumbs.length > 1 && (
          <div className="flex items-center gap-2 px-4 py-2.5 border-t border-slate-200">
            <span className="text-xs text-slate-500 flex-1">
              {clip.video_path ? "Stepping through the frames" : "No original file was kept, so these frames are all there is"}
              <span className="text-slate-500"> · frame <span className="cc-num">{i + 1}</span> of <span className="cc-num">{thumbs.length}</span></span>
            </span>
            <Button size="sm" variant="ghost" onClick={() => setI((n) => (n - 1 + thumbs.length) % thumbs.length)}>Back</Button>
            <Button size="sm" variant="outline" onClick={() => setI((n) => (n + 1) % thumbs.length)}>Next</Button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ========================================================= FIND ========== */
/**
 * One search across gaps, creators and clips.
 *
 * It reuses parseSearch, which already matches free text against the taxonomy
 * in code. Nothing is sent to a model - "empty sauna at San Jose" resolves to
 * a room, a scene and a branch by lookup, and the words it could not place are
 * reported rather than quietly dropped.
 */
function crossSearch(text, { gaps, creators, clips }) {
  const q = String(text ?? "").trim();
  if (q.length < 2) return null;
  const parsed = parseSearch(q);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = (hay) => words.every((w) => hay.includes(w));

  const gapHits = gaps.filter((g) => {
    if (hits(gapSentence(g).toLowerCase())) return true;
    const rooms = parsed.matched.room_type ?? [];
    return rooms.length > 0 && rooms.some((r) => g.room_type.includes(r));
  });
  const creatorHits = creators.filter((c) =>
    hits(`${c.display_name} ${c.handle} ${c.creator_vertical.map(label).join(" ")}`.toLowerCase()));
  const clipHits = clips.filter((c) => hits(`${clipSentence(c)} ${c.filename}`.toLowerCase()));

  return { q, gaps: gapHits, creators: creatorHits, clips: clipHits, ignored: parsed.ignored,
    total: gapHits.length + creatorHits.length + clipHits.length };
}

function FindBar({ value, onChange, results, onGo, thumbUrls }) {
  return (
    <div className="relative mb-5">
      <label htmlFor="cc-find" className="sr-only">Search gaps, creators and clips</label>
      <Search size={16} className="absolute text-slate-500 pointer-events-none" style={{ left: 12, top: 11 }} aria-hidden="true" />
      <input id="cc-find" value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}
        style={{ paddingLeft: 36 }} placeholder="Search gaps, creators and clips" autoComplete="off" />
      {value && (
        <button onClick={() => onChange("")} aria-label="Clear the search"
          className="absolute text-slate-500 hover:text-slate-700 cursor-pointer" style={{ right: 12, top: 11 }}>
          <X size={15} aria-hidden="true" />
        </button>
      )}

      {results && (
        <div className="border border-slate-200 rounded-xl bg-white mt-2 overflow-hidden">
          {results.total === 0 ? (
            <p className="text-sm text-slate-600 px-4 py-3.5 leading-relaxed">
              Nothing matches that.
              {results.ignored.length > 0 && <> These words are not in the taxonomy, so nothing was matched on them: {results.ignored.join(", ")}.</>}
            </p>
          ) : (
            <>
              {results.gaps.length > 0 && (
                <div className="px-4 py-3 border-b border-slate-100">
                  <p className="text-xs text-slate-500 mb-1.5">Gaps · {results.gaps.length}</p>
                  {results.gaps.slice(0, 4).map((g) => (
                    <button key={g.id} onClick={() => onGo("gaps", { gapIds: [g.id], why: `matching "${results.q}"` })}
                      className="block w-full text-left text-sm text-slate-800 py-1 hover:text-slate-950 cursor-pointer truncate">
                      {gapSentence(g)}
                    </button>
                  ))}
                </div>
              )}
              {results.creators.length > 0 && (
                <div className="px-4 py-3 border-b border-slate-100">
                  <p className="text-xs text-slate-500 mb-1.5">Creators · {results.creators.length}</p>
                  {results.creators.slice(0, 4).map((c) => (
                    <button key={c.id} onClick={() => onGo("creators")}
                      className="flex items-center gap-2 w-full text-left text-sm text-slate-800 py-1 hover:text-slate-950 cursor-pointer">
                      <Avatar name={c.display_name} photo={c.photo} size={22} /> {c.display_name}
                      <span className="text-slate-500">{c.handle}</span>
                    </button>
                  ))}
                </div>
              )}
              {results.clips.length > 0 && (
                <div className="px-4 py-3">
                  <p className="text-xs text-slate-500 mb-2">Clips · {results.clips.length}</p>
                  <div className="flex gap-2 flex-wrap">
                    {results.clips.slice(0, 8).map((c) => (
                      <button key={c.id} onClick={() => onGo("library")} title={clipSentence(c)}
                        className="rounded-lg overflow-hidden border border-slate-200 cursor-pointer" style={{ width: 48 }}>
                        <Thumb thumbs={thumbsFor(c, thumbUrls)} alt={clipSentence(c)} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ====================================================== EMPTY STATES ===== */
/**
 * An empty screen is the first thing anyone sees, so it is built rather than
 * left over. Three parts:
 *
 *   the skeleton   the real layout at low opacity, so you can see the shape of
 *                  what will be here - a brief card, a 4:5 frame grid - rather
 *                  than a blank page with a sentence floating in it
 *   the chain      when a screen is empty because something upstream is
 *                  missing, the whole chain is shown with what already exists
 *                  ticked off. One unmet condition is a sentence, not a list:
 *                  a checklist of one item is noise
 *   the next line  what happens after the button, in one line, because the
 *                  question after "what do I press" is always "and then what"
 */
function Skeleton({ kind }) {
  const bar = (w, mt) => (
    <span className="block rounded" style={{ height: 9, width: w, marginTop: mt, background: "var(--page)" }} />
  );
  const card = (rows, key) => (
    <div key={key} className="border border-slate-200 rounded-xl bg-white px-4 py-3.5 mb-2">
      <div className="flex items-center gap-2.5 mb-3">
        <span className="rounded-full shrink-0" style={{ width: 28, height: 28, background: "var(--page)" }} />
        {bar(110, 0)}<span className="flex-1" />{bar(60, 0)}
      </div>
      {rows.map((w, i) => <div key={i} className="flex gap-2 mt-1.5">{bar(32, 0)}{bar(w, 0)}</div>)}
    </div>
  );

  if (kind === "grid") {
    return (
      <div className="grid gap-2" aria-hidden="true"
        style={{ gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", maxWidth: 5 * 178, opacity: 0.34 }}>
        {["88%", "70%", "92%", "64%", "80%", "74%", "86%", "60%", "90%", "68%"].map((w, i) => (
          <div key={i} className="border border-slate-200 rounded-xl bg-white overflow-hidden">
            <div style={{ aspectRatio: "4/5", background: "var(--page)" }} />
            <div className="px-2.5 py-2">{bar(w, 0)}{bar("50%", 5)}</div>
          </div>
        ))}
      </div>
    );
  }
  if (kind === "rows") {
    return (
      <div aria-hidden="true" style={{ opacity: 0.34 }}>
        {[["100%", "60%"], ["100%"], ["78%", "45%"]].map((r, i) => card(r, i))}
      </div>
    );
  }
  return (
    <div className="grid gap-2" aria-hidden="true"
      style={{ gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))", opacity: 0.34 }}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="border border-slate-200 rounded-xl bg-white px-3 py-3">
          {bar(52, 0)}{bar("92%", 8)}{bar("64%", 5)}
        </div>
      ))}
    </div>
  );
}

/** Quiet line drawings. Flat, one colour, no fill - they set a tone without
 *  pretending to be an illustration of anything in particular. */
function EmptyMark({ kind }) {
  const c = { stroke: "currentColor", fill: "none", strokeWidth: 1 };
  if (kind === "grid") {
    return (
      <svg viewBox="0 0 104 56" width="104" height="56" role="img" className="text-slate-500 mx-auto">
        <title>Clips coming to rest on a shelf</title>
        <rect x="6" y="6" width="22" height="28" rx="3" {...c} opacity=".3" />
        <rect x="33" y="12" width="22" height="28" rx="3" {...c} opacity=".42" />
        <rect x="60" y="4" width="22" height="28" rx="3" {...c} strokeWidth="1.25" opacity=".6" />
        <path d="M67 18 l8 5 -8 5 z" fill="currentColor" opacity=".45" />
        <path d="M4 48 H100" {...c} strokeWidth="1.25" opacity=".45" />
      </svg>
    );
  }
  if (kind === "rows") {
    return (
      <svg viewBox="0 0 96 60" width="96" height="60" role="img" className="text-slate-500 mx-auto">
        <title>A gap and a creator joining into one brief</title>
        <rect x="2" y="8" width="30" height="20" rx="4" {...c} opacity=".38" />
        <rect x="2" y="32" width="30" height="20" rx="4" {...c} opacity=".38" />
        <path d="M32 18 H46 Q52 18 52 24 V30" {...c} opacity=".3" />
        <path d="M32 42 H46 Q52 42 52 36 V30" {...c} opacity=".3" />
        <rect x="60" y="16" width="34" height="28" rx="4" {...c} strokeWidth="1.25" opacity=".6" />
        <path d="M66 25 H88 M66 30 H88 M66 35 H80" {...c} opacity=".45" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 96 56" width="96" height="56" role="img" className="text-slate-500 mx-auto">
      <title>An outline waiting to be filled</title>
      <rect x="8" y="10" width="34" height="24" rx="4" {...c} opacity=".35" />
      <rect x="54" y="10" width="34" height="24" rx="4" {...c} opacity=".55" />
      <path d="M14 44 H82" {...c} opacity=".3" />
    </svg>
  );
}

function EmptyState({ icon: Icon, title, body, missing, action, secondary, skeleton = "cards", then }) {
  const chain = (missing ?? []).length > 1 ? missing : null;
  const oneMissing = (missing ?? []).length === 1 ? missing[0] : null;
  return (
    <div className="relative" style={{ minHeight: 420 }}>
      <Skeleton kind={skeleton} />
      <div className="absolute left-1/2 border border-slate-200 rounded-xl bg-white px-6 pt-6 pb-5 text-center"
        style={{ top: skeleton === "grid" ? 150 : 120, transform: "translateX(-50%)", width: "min(430px, 90%)" }}>
        <EmptyMark kind={skeleton} />
        <h3 className="text-lg font-medium text-slate-900 mt-2">{title}</h3>
        <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">{body}</p>

        {oneMissing && !oneMissing.done && (
          <p className="text-sm text-slate-600 mt-3 leading-relaxed">{oneMissing.label} first.</p>
        )}

        {chain && (
          <ul className="inline-flex flex-col gap-1.5 text-left mt-4">
            {chain.map((m) => (
              <li key={m.label} className="flex items-center gap-2 text-sm">
                {m.done ? <Check size={15} className="text-emerald-600 shrink-0" aria-hidden="true" />
                        : <X size={15} className="text-slate-500 shrink-0" aria-hidden="true" />}
                <span className={m.done ? "text-slate-500 line-through" : "text-slate-700"}>{m.label}</span>
              </li>
            ))}
          </ul>
        )}

        {action && <div className="mt-5 flex items-center justify-center gap-2 flex-wrap">{action}{secondary}</div>}
        {then && <p className="text-xs text-slate-500 mt-3 leading-relaxed">{then}</p>}
      </div>
    </div>
  );
}

/** One line under a disabled control saying what is missing. A grey button
 *  with no reason is the same problem as a field with no source. */
function WhyDisabled({ children }) {
  if (!children) return null;
  return <span className="text-xs text-slate-500 leading-relaxed">{children}</span>;
}

/**
 * Every screen opens with one plain sentence answering "what am I doing here".
 * Not a label. A sentence.
 */
/**
 * The frames we already pulled, finally on screen. Hovering runs them, so the
 * still becomes a moving clip without loading anything new. 4:5 because most
 * of this footage is vertical and 16:9 would crop it into uselessness.
 */
function Thumb({ thumbs, alt, ratio = "4/5", badge, muted, className = "", pending, onPlay }) {
  const [i, setI] = useState(0);
  const timer = React.useRef(null);
  const start = () => {
    if (!thumbs || thumbs.length < 2 || timer.current) return;
    timer.current = setInterval(() => setI((n) => (n + 1) % thumbs.length), 420);
  };
  const stop = () => { clearInterval(timer.current); timer.current = null; setI(0); };
  useEffect(() => () => clearInterval(timer.current), []);
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ aspectRatio: ratio, background: "var(--page)" }}
      onMouseEnter={start} onMouseLeave={stop} onFocus={start} onBlur={stop}>
      {thumbs && thumbs.length ? (
        <img src={thumbs[i]} alt={alt} className="w-full h-full object-cover" style={{ border: 0 }} />
      ) : pending ? (
        <div className="w-full h-full flex items-center justify-center" role="status">
          <Loader2 size={16} className="animate-spin" style={{ color: "var(--text-meta)" }} aria-hidden="true" />
          <span className="sr-only">Loading the frames</span>
        </div>
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-1 px-2 text-center">
          <ImageOff size={18} style={{ color: "var(--text-meta)" }} aria-hidden="true" />
          <span className="text-xs" style={{ color: "var(--text-meta)" }}>No frames</span>
        </div>
      )}
      {badge}
      {onPlay && (
        <button onClick={(e) => { e.stopPropagation(); onPlay(); }} aria-label="Watch this clip"
          className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 focus:opacity-100 transition-opacity cursor-pointer"
          style={{ background: "rgba(12,10,9,0.28)" }}>
          <span className="rounded-full flex items-center justify-center"
            style={{ width: 38, height: 38, background: "rgba(255,255,255,0.94)" }}>
            <Play size={16} style={{ color: "var(--text)", marginLeft: 2 }} aria-hidden="true" />
          </span>
        </button>
      )}
      {thumbs && thumbs.length > 1 && (
        <span className="absolute bottom-1.5 right-1.5 text-xs px-1.5 py-0.5 rounded pointer-events-none"
          style={{ background: "rgba(12,10,9,0.6)", color: "#fff" }}>{thumbs.length} frames</span>
      )}
      {muted && <div className="absolute inset-0" style={{ background: "var(--surface)", opacity: 0.45 }} />}
    </div>
  );
}

/** The one-line grey note beside a title. The full text lives behind the mark. */
function IntentNote({ children }) {
  const [open, setOpen] = useState(false);
  const full = String(children);
  // The first sentence is the instruction; the rest is the reason. Someone
  // arriving needs the instruction without a click.
  const short = full.split(". ")[0] + ".";
  return (
    <span className="inline-flex items-start gap-1.5">
      <button onClick={() => setOpen(!open)} aria-label="What is this screen for?" aria-expanded={open}
        className="shrink-0 mt-0.5 rounded-full cursor-pointer"
        style={{ width: 16, height: 16, border: "0.5px solid var(--hairline-2)", color: "var(--text-meta)", fontSize: 11, lineHeight: "15px" }}>?</button>
      <span className="text-base text-slate-600 leading-relaxed">{open ? full : short}</span>
    </span>
  );
}

/**
 * The head of a screen: a title, the counts, and one action.
 *
 * No explanatory paragraph. If a screen needs explaining, the structure is
 * wrong, and the four screens rebuilt from the design do not have one.
 */
function ScreenIntro({ eyebrow, title, intent, stats, action, onHome }) {
  return (
    <header style={{ marginBottom: 26 }}>
      {onHome && (
        <button onClick={onHome} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13,
          color: "var(--text-meta)", background: "none", border: 0, cursor: "pointer", padding: 0, marginBottom: 14 }}>
          Today <span aria-hidden="true">›</span>
          <span style={{ color: "var(--text)" }}>{title}</span>
        </button>
      )}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between",
        gap: 20, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 32, lineHeight: 1.1, letterSpacing: "-0.03em", fontWeight: 500 }}>
          {title}
        </h1>
        {action}
      </div>

      {stats && stats.length > 0 && (
        <div style={{ display: "flex", gap: 30, flexWrap: "wrap", marginTop: 20, paddingBottom: 20,
          boxShadow: "inset 0 -0.5px 0 var(--hairline)" }}>
          {stats.map((x) => (
            <div key={x.k}>
              <div className="cc-num" style={{ fontSize: 24, letterSpacing: "-0.02em", lineHeight: 1,
                color: x.tone === "rose" && x.v > 0 ? "var(--blocked)" : "var(--text)" }}>{x.v}</div>
              <div style={{ marginTop: 4, fontSize: 12, color: "var(--text-meta)" }}>{x.k}</div>
            </div>
          ))}
        </div>
      )}
    </header>
  );
}

/** Shown when a screen was opened from a task, filtered to just those items. */
function FocusBanner({ count, why, onClear }) {
  return (
    <div className="border border-slate-900 bg-slate-900 rounded-xl px-4 py-3 mb-5 flex items-center gap-3 flex-wrap">
      <span className="text-sm text-white flex-1 min-w-0 leading-relaxed">
        Showing the {count} item{count === 1 ? "" : "s"} {why}.
      </span>
      <button onClick={onClear} className="text-sm font-medium text-white underline underline-offset-2 cursor-pointer">
        Show everything
      </button>
    </div>
  );
}

/** What happens after the thing you just did on this screen. */
function NextStep({ children, onGo, goLabel }) {
  return (
    <div className="mt-12 pt-5 border-t border-slate-200 flex items-center gap-3 flex-wrap">
      <CornerDownRight size={14} className="text-slate-500 shrink-0" />
      <span className="text-sm text-slate-500 flex-1 leading-relaxed">{children}</span>
      {onGo && <Button variant="outline" size="sm" onClick={onGo}>{goLabel} <ChevronRight size={13} /></Button>}
    </div>
  );
}

function StubScreen({ stage, icon: Icon, title, blurb, needs, slice }) {
  return (
    <>
      <ScreenHeader eyebrow={`Stage ${stage}`} title={title} blurb={blurb} />
      <div className="border border-dashed border-slate-300 rounded-lg bg-white p-8">
        <div className="flex items-center gap-2 mb-4">
          <Icon size={18} className="text-slate-500" />
          <span className="text-xs text-slate-500 uppercase">Not built yet</span>
        </div>
        <p className="text-sm font-semibold text-slate-800 mb-3">What this screen needs before it can exist</p>
        <ul className="space-y-2">
          {needs.map((n) => <li key={n} className="flex gap-2 text-sm text-slate-600"><ChevronRight size={15} className="text-slate-500 shrink-0 mt-0.5" /><span>{n}</span></li>)}
        </ul>
      </div>
    </>
  );
}

/* ==================================================== PLAIN LANGUAGE ===== */
/**
 * The taxonomy is the truth, but nobody thinks in enums at 9am. Every list in
 * the product leads with a sentence and keeps the controlled values underneath.
 */
const ASPECT_WORD = { vertical_9_16: "vertical", square_1_1: "square", horizontal_16_9: "widescreen", other_ratio: "" };
const SCENE_WORD = {
  ambience_no_people: "with nobody in frame",
  detail_texture: "close on the materials",
  treatment_in_progress: "during a treatment",
  treatment_prep: "as the room is set up",
  product_application: "as product goes on",
  product_closeup: "close on the product",
  arrival_checkin: "arriving and checking in",
  transition_walking: "walking through",
  resting_relaxing: "resting afterwards",
  social_conversation: "with people talking",
  food_beverage: "of food and drink",
  water_immersion: "in the water",
  heat_exposure: "in the heat",
  movement_fitness: "moving and training",
  staff_at_work: "with staff at work",
  reaction_face: "catching the reaction",
  talking_head: "talking to camera",
  voiceover_walkthrough: "as a walkthrough",
  before_after: "before and after",
};

function gapSentence(gap) {
  const n = gap.quantity_needed;
  const aspect = ASPECT_WORD[gap.aspect[0]] ?? "";
  const rooms = (gap.room_type.length ? gap.room_type : ["other_room"]).map((r) => label(r).toLowerCase()).join(" or ");
  const where = gap.branch_id.length ? ` at ${gap.branch_id.map((b) => branchById(b)?.name).filter(Boolean).join(" or ")}` : "";
  const scene = gap.scene[0] ? (SCENE_WORD[gap.scene[0]] ?? `showing ${label(gap.scene[0]).toLowerCase()}`) : "";
  const head = `${n} ${aspect ? aspect + " " : ""}clip${n === 1 ? "" : "s"} of the ${rooms}${where}`;
  return scene ? `${head}, ${scene}.` : `${head}.`;
}

/** Days between now and a deadline, or null when none is set. */
const daysUntil = (deadline) =>
  deadline ? Math.ceil((new Date(deadline) - new Date()) / 86400000) : null;

function deadlineSentence(gap) {
  if (!gap.deadline) return "No deadline.";
  const d = daysUntil(gap.deadline);
  if (d < 0) return `Overdue by ${Math.abs(d)} days.`;
  if (d === 0) return "Due today.";
  if (d === 1) return "Due tomorrow.";
  return `Due in ${d} days.`;
}

/**
 * One sentence about what is in a clip.
 *
 * A clip whose ai_status is "sample" was described by hand for a demonstration
 * and no model has looked at it. It reads the same but it is marked
 * differently everywhere, because the violet mark in this product means one
 * thing - a model touched this - and it has to keep meaning it.
 */
function clipSentence(clip) {
  const room = clip.ai?.room_type?.value;
  const scene = clip.ai?.scene?.value?.[0];
  if (!room) return "Not read yet";
  const s = scene ? (SCENE_WORD[scene] ?? `showing ${label(scene).toLowerCase()}`) : "";
  const a = ASPECT_WORD[clip.system?.aspect_native] ?? "";
  return `${a ? a.charAt(0).toUpperCase() + a.slice(1) + " clip" : "Clip"} in the ${label(room).toLowerCase()}${s ? ", " + s : ""}.`;
}

/* ========================================================= TASK INBOX ==== */
/**
 * Everything here is derived from state that already exists. A task is a
 * sentence, a count, and a way into the exact items it is about, never into a
 * screen where those items happen to live.
 */
function buildTasks({ gaps, creators, collabs, clips }) {
  const t = [];
  const openGaps = gaps.filter((g) => g.status === "open");
  const approved = collabs.filter((c) => c.brief_approved_by);

  /* ---------------------------------------------------- needs you now -- */
  const privacyClips = clips.filter((c) => c.clip_status !== "rejected" && clipPrivacyState(c).blocked && c.ai);
  if (privacyClips.length) {
    t.push({
      id: "privacy", urgency: "now", icon: ShieldAlert, tone: "rose",
      sentence: `${privacyClips.length} clip${privacyClips.length === 1 ? "" : "s"} ${privacyClips.length === 1 ? "is" : "are"} waiting on a privacy decision. Only a person can clear ${privacyClips.length === 1 ? "it" : "them"}.`,
      cta: privacyClips.length === 1 ? "Review it" : "Review them",
      clips: privacyClips,
      target: { stage: "intake", focus: { collabId: privacyClips[0].collab_id, clipIds: privacyClips.map((c) => c.id), why: "waiting on a privacy decision" } },
    });
  }

  const soon = openGaps.filter((g) => g.deadline && (new Date(g.deadline) - new Date()) / 86400000 < 7);
  const soonNoCollab = soon.filter((g) => !collabs.some((c) => c.gap_ids.includes(g.id)));
  if (soonNoCollab.length) {
    t.push({
      id: "deadline", urgency: "now", icon: Clock, tone: "rose",
      sentence: `${soonNoCollab.length} gap${soonNoCollab.length === 1 ? " has" : "s have"} a deadline inside a week and nobody booked to shoot ${soonNoCollab.length === 1 ? "it" : "them"}.`,
      cta: "Find a creator",
      target: { stage: "gaps", focus: { gapIds: soonNoCollab.map((g) => g.id), why: "due inside a week with nobody booked" } },
    });
  }

  const unreadable = clips.filter((c) => c.clip_status === "unreadable_file" && c.resend_request?.status === "none");
  if (unreadable.length) {
    t.push({
      id: "unreadable", urgency: "now", icon: AlertTriangle, tone: "amber",
      sentence: `${unreadable.length} file${unreadable.length === 1 ? "" : "s"} the browser cannot open. Describe ${unreadable.length === 1 ? "it" : "them"} yourself, or ask her to send ${unreadable.length === 1 ? "it" : "them"} again.`,
      cta: "Deal with them", clips: unreadable,
      target: { stage: "intake", focus: { collabId: unreadable[0].collab_id, clipIds: unreadable.map((c) => c.id), why: "the browser cannot open" } },
    });
  }

  const reupload = clips.filter((c) => c.clip_status === "requires_human_review");
  if (reupload.length) {
    t.push({
      id: "reupload", urgency: "now", icon: ImageOff, tone: "amber",
      sentence: `${reupload.length} clip${reupload.length === 1 ? " lost its" : "s lost their"} full resolution frames. Upload the file again, or describe it yourself.`,
      cta: "Open the clips",
      clips: reupload,
      target: { stage: "intake", focus: { collabId: reupload[0].collab_id, clipIds: reupload.map((c) => c.id), why: "missing their full resolution frames" } },
    });
  }

  const ready = clips.filter((c) => c.ai && !["accepted", "rejected", "requires_human_review"].includes(c.clip_status)
    && !clipPrivacyState(c).blocked && c.match?.level !== "unmatched");
  if (ready.length) {
    t.push({
      id: "decide", urgency: "now", icon: Check, tone: "slate",
      sentence: `${ready.length} clip${ready.length === 1 ? " is" : "s are"} described, clear on privacy, and waiting for you to accept or reject.`,
      cta: "Decide on them",
      clips: ready,
      target: { stage: "intake", focus: { collabId: ready[0].collab_id, clipIds: ready.map((c) => c.id), why: "ready for your decision" } },
    });
  }

  const unmatched = clips.filter((c) => c.match?.level === "unmatched" && c.clip_status !== "rejected" && !c.unmatched_keep);
  if (unmatched.length) {
    t.push({
      id: "unmatched_clips", urgency: "now", icon: CornerDownRight, tone: "blue",
      sentence: `${unmatched.length} clip${unmatched.length === 1 ? " matches" : "s match"} nothing anyone asked for. Good footage nobody thought to request is where a new gap comes from.`,
      cta: "Look at them",
      clips: unmatched,
      target: { stage: "intake", focus: { collabId: unmatched[0].collab_id, clipIds: unmatched.map((c) => c.id), why: "matching nothing in the brief" } },
    });
  }

  const drafts = collabs.filter((c) => !c.brief_approved_by);
  if (drafts.length) {
    const d = drafts[0];
    const dg = d.gap_ids.map((id) => gaps.find((g) => g.id === id)).filter(Boolean);
    const missing = !d.rights.entered_by ? "the rights have not been entered yet"
      : uncoveredChannels(dg, d.rights).length && !d.channel_override ? "the rights do not cover the channel the gap was created for"
      : "it is ready to approve";
    t.push({
      id: "brief", urgency: "now", icon: FileText, tone: "amber",
      sentence: `${drafts.length} brief${drafts.length === 1 ? " is" : "s are"} still a draft. On the first one, ${missing}.`,
      cta: "Open the brief",
      target: { stage: "briefs", focus: { collabId: d.id } },
    });
  }

  const declined = approved.filter((c) => visitState(c) === "needs_new_date");
  if (declined.length) {
    const c = declined[0];
    const last = [...c.visit_proposals].reverse().find((p) => p.status === "declined");
    t.push({
      id: "declined", urgency: "now", icon: CalendarPlus, tone: "amber",
      sentence: `${branchById(c.branch_id)?.name} turned down the date you asked for${last?.decline_reason ? ` because ${label(last.decline_reason).toLowerCase()}` : ""}. Pick another one.`,
      cta: "Propose a date",
      target: { stage: "visits", focus: { collabId: c.id } },
    });
  }

  const noDate = approved.filter((c) => visitState(c) === "not_proposed");
  if (noDate.length) {
    t.push({
      id: "propose", urgency: "now", icon: CalendarCheck, tone: "slate",
      sentence: `${noDate.length} approved brief${noDate.length === 1 ? " has" : "s have"} no date yet. The branch has to agree before anyone turns up.`,
      cta: "Ask the branch",
      target: { stage: "visits", focus: { collabId: noDate[0].id } },
    });
  }

  const toAnalyse = clips.filter((c) => c.clip_status === "uploaded");
  if (toAnalyse.length) {
    t.push({
      id: "analyse", urgency: "now", icon: Sparkles, tone: "violet",
      sentence: `${toAnalyse.length} clip${toAnalyse.length === 1 ? " has" : "s have"} been uploaded but not read yet.`,
      cta: "Run the analysis",
      clips: toAnalyse,
      target: { stage: "intake", focus: { collabId: toAnalyse[0].collab_id, clipIds: toAnalyse.map((c) => c.id), why: "uploaded but not analysed" } },
    });
  }

  /* ------------------------------------------- waiting on someone else -- */
  const awaiting = approved.filter((c) => visitState(c) === "awaiting_branch");
  if (awaiting.length) {
    t.push({
      id: "awaiting", urgency: "waiting", icon: Clock, tone: "slate",
      sentence: `${awaiting.length} date${awaiting.length === 1 ? " is" : "s are"} sitting with a branch manager. Nothing for you to do until they answer.`,
      cta: "See what was asked",
      target: { stage: "visits", focus: { collabId: awaiting[0].id } },
    });
  }

  /* ------------------------------------------------------- housekeeping -- */
  const filled = openGaps.filter((g) => computeFilled(g.id, clips) >= g.quantity_needed);
  if (filled.length) {
    t.push({
      id: "close", urgency: "house", icon: Check, tone: "emerald",
      sentence: `${filled.length} gap${filled.length === 1 ? " has" : "s have"} all the clips ${filled.length === 1 ? "it" : "they"} asked for. Close ${filled.length === 1 ? "it" : "them"} when you agree.`,
      cta: "Review them",
      target: { stage: "gaps", focus: { gapIds: filled.map((g) => g.id), why: "filled and still open" } },
    });
  }

  const stale = collabs.filter((c) => c.brief_fingerprint !== briefFingerprint(c.gap_ids.map((id) => gaps.find((g) => g.id === id)).filter(Boolean)));
  if (stale.length) {
    t.push({
      id: "stale", urgency: "house", icon: AlertTriangle, tone: "amber",
      sentence: `${stale.length} brief${stale.length === 1 ? " describes" : "s describe"} something that is no longer what is missing, because a gap changed underneath ${stale.length === 1 ? "it" : "them"}.`,
      cta: "Rebuild it",
      target: { stage: "briefs", focus: { collabId: stale[0].id } },
    });
  }

  const orphanGaps = openGaps.filter((g) => !collabs.some((c) => c.gap_ids.includes(g.id)) && !soonNoCollab.includes(g));
  if (orphanGaps.length) {
    t.push({
      id: "orphan", urgency: "house", icon: Target, tone: "slate",
      sentence: `${orphanGaps.length} open gap${orphanGaps.length === 1 ? " has" : "s have"} nobody shooting ${orphanGaps.length === 1 ? "it" : "them"} yet.`,
      cta: "Pick a creator",
      target: { stage: "creators", focus: null },
    });
  }

  if (!creators.length) {
    t.push({
      id: "noCreators", urgency: "house", icon: Users, tone: "slate",
      sentence: "There is nobody on the roster yet. Add the creators you already work with.",
      cta: "Add a creator", target: { stage: "creators", focus: null },
    });
  }
  if (!openGaps.length) {
    t.push({
      id: "noGaps", urgency: "house", icon: Target, tone: "slate",
      sentence: "Nothing is written down as missing. A gap is where everything else starts.",
      cta: "Write a gap", target: { stage: "gaps", focus: null },
    });
  }
  return t;
}

function TaskRow({ task, onGo, thumbUrls = {} }) {
  const Icon = task.icon;
  // Only a privacy block earns a filled surface. Everything else is a hairline.
  const ring = task.id === "privacy" ? "cc-blocked border-rose-200" : "border-slate-200 bg-white";
  const ic = { rose: "text-rose-700", amber: "text-amber-700", violet: "text-violet-700",
    emerald: "text-emerald-700", blue: "text-blue-700", slate: "text-slate-500" }[task.tone] ?? "text-slate-500";
  return (
    <li>
      <button onClick={() => onGo(task.target.stage, task.target.focus)}
        className={`w-full text-left border rounded-xl px-4 py-4 cursor-pointer transition-colors hover:border-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${ring}`}>
        <span className="flex items-start gap-3">
          <Icon size={18} className={`${ic} shrink-0 mt-0.5`} aria-hidden="true" />
          <span className="flex-1 min-w-0 text-base text-slate-800 leading-relaxed">{task.sentence}</span>
          <span className="shrink-0 inline-flex items-center gap-1 text-sm font-medium text-slate-900 mt-0.5">
            {task.cta} <ChevronRight size={15} aria-hidden="true" />
          </span>
        </span>
        {task.clips && task.clips.length > 0 && (
          <span className="flex gap-2 mt-3 pl-7">
            {task.clips.slice(0, 6).map((c) => (
              <span key={c.id} className="block rounded-lg overflow-hidden border border-slate-200" style={{ width: 56 }}>
                <Thumb thumbs={thumbsFor(c, thumbUrls)} pending={!!c.thumb_paths?.length && !thumbsFor(c, thumbUrls).length} alt={`Frame from ${c.filename}`} />
              </span>
            ))}
            {task.clips.length > 6 && (
              <span className="text-xs text-slate-500 self-end pb-1">+{task.clips.length - 6} more</span>
            )}
          </span>
        )}
      </button>
    </li>
  );
}

/** Four counts, and one small quiet tile each. Numbers are tabular so a column
 *  of them lines up, and the label is what you read, not the digit. */
function Tile({ n, label, tone }) {
  return (
    <div>
      <div className="text-3xl font-medium cc-num leading-none"
        style={{ letterSpacing: "-0.03em", color: tone === "rose" && n > 0 ? "var(--blocked)" : "var(--text)" }}>{n}</div>
      <div className="text-xs text-slate-500 uppercase mt-2">{label}</div>
    </div>
  );
}

/**
 * Today.
 *
 * A dashboard, not a to-do list. The old screen was a stack of sentences and a
 * person had to read all of them to work out whether the month was going well.
 *
 * Two things are measured here and nothing else: how much of what we said we
 * needed we actually have, and where work is stuck. Both are counted from rows
 * that exist, and every figure says what it was counted from - a dashboard
 * whose numbers cannot be traced is decoration.
 */
function HomeScreen({ gaps, creators, collabs, clips, library = [], edits = [], editClips = [],
  onGo, onLoadExample, hasExample, thumbUrls = {}, identity, myRole }) {
  const tasks = useMemo(() => buildTasks({ gaps, creators, collabs, clips }), [gaps, creators, collabs, clips]);
  const now = tasks.filter((t) => t.urgency === "now");
  const waiting = tasks.filter((t) => t.urgency === "waiting");
  const house = tasks.filter((t) => t.urgency === "house");
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const open = gaps.filter((g) => g.status === "open");
  const wanted = open.reduce((n, g) => n + g.quantity_needed, 0);
  const inHand = library.filter((c) => c.gap_id_closed).length;
  const covered = wanted > 0 ? Math.min(100, Math.round((inHand / wanted) * 100)) : 0;

  // Where the work actually sits. One bar, five segments, because "how many
  // gaps have got as far as what" is the question a coordinator asks and the
  // one nothing on this screen answered.
  const booked = collabs.filter((c) => (c.visit_proposals ?? []).some((p) => p.status === "accepted"));
  const pipeline = [
    { k: "Nobody booked", n: open.filter((g) => !collabs.some((c) => (c.gap_ids ?? []).includes(g.id))).length, c: "var(--hairline-2)" },
    { k: "Brief being written", n: collabs.filter((c) => !c.brief_approved_by).length, c: "#A8A29E" },
    { k: "Waiting on a date", n: collabs.filter((c) => c.brief_approved_by && !acceptedProposal(c)).length, c: "var(--warn)" },
    { k: "Visit booked", n: booked.filter((c) => !clips.some((k) => k.collab_id === c.id)).length, c: "var(--text)" },
    { k: "Footage in", n: booked.filter((c) => clips.some((k) => k.collab_id === c.id)).length, c: "var(--accent)" },
  ].filter((x) => x.n > 0);
  const pipelineTotal = pipeline.reduce((n, x) => n + x.n, 0);

  const undecided = clips.filter((c) => !["accepted", "rejected"].includes(c.clip_status));
  const blocked = clips.filter((c) => clipPrivacyState(c).blocked);
  const expiring = library.filter((c) => (c.rights_status ?? deriveRightsStatus(c.rights)) === "expiring_60d");
  const unused = library.filter((c) => !editClips.some((e) => e.library_id === c.id));
  const dueSoon = open.filter((g) => g.due_date
    && (new Date(g.due_date) - new Date()) / 86400000 <= 7).length;

  const CARD = { background: "var(--surface)", borderRadius: 18, padding: 20,
    boxShadow: "0 0 0 0.5px var(--hairline), 0 1px 2px rgba(28,25,23,0.03)" };

  /** A figure, what it means, and where it was counted from. */
  const Stat = ({ n, k, from, tone, onClick }) => (
    <button onClick={onClick} disabled={!onClick}
      style={{ ...CARD, textAlign: "left", border: 0, cursor: onClick ? "pointer" : "default",
        display: "flex", flexDirection: "column", gap: 4 }}
      className={onClick ? "cc-lift" : undefined}>
      <span className="cc-num" style={{ fontSize: 30, lineHeight: 1, letterSpacing: "-0.025em",
        color: tone ?? "var(--text)" }}>{n}</span>
      <span style={{ fontSize: 14, color: "var(--text)" }}>{k}</span>
      <span style={{ fontSize: 12, color: "var(--text-meta)", lineHeight: 1.45 }}>{from}</span>
    </button>
  );

  return (
    <div style={{ maxWidth: 1180, display: "flex", flexDirection: "column", gap: 22 }}>
      <div>
        <div style={{ fontSize: 13, color: "var(--text-meta)" }}>{today}</div>
        <h1 style={{ margin: "7px 0 0", fontSize: 32, lineHeight: 1.1, letterSpacing: "-0.03em", fontWeight: 500 }}>
          {now.length === 0
            ? "Nothing is waiting on you."
            : `${now.length} thing${now.length === 1 ? "" : "s"} need${now.length === 1 ? "s" : ""} you.`}
        </h1>
      </div>

      {/* How much of what we said we needed we actually have. One number, and
          the bar under it is the same number - the figure and the picture
          cannot disagree because they are the same value. */}
      <section style={{ ...CARD, display: "flex", gap: 26, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px", minWidth: "min(100%, 240px)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span className="cc-num" style={{ fontSize: 44, lineHeight: 1, letterSpacing: "-0.03em" }}>
              {covered}%
            </span>
            <span style={{ fontSize: 14, color: "var(--text-body)" }}>of what we asked for is in hand</span>
          </div>
          <div style={{ marginTop: 14, height: 8, borderRadius: 999, background: "var(--hairline)", overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", borderRadius: 999, background: "var(--accent)",
              width: `${covered}%`, transition: "width 300ms" }} />
          </div>
          <div className="cc-num" style={{ marginTop: 9, fontSize: 12, color: "var(--text-meta)" }}>
            {inHand} of {wanted} clips · counted from clips accepted against an open gap
          </div>
        </div>

        <div style={{ flex: "1 1 320px", minWidth: "min(100%, 280px)" }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>Where the work is sitting</div>
          {pipelineTotal === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-meta)" }}>Nothing has been started yet.</p>
          ) : (
            <>
              <div style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden", gap: 2 }}>
                {pipeline.map((x) => (
                  <span key={x.k} title={`${x.k}: ${x.n}`} aria-hidden="true"
                    style={{ flex: x.n, background: x.c }} />
                ))}
              </div>
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 7 }}>
                {pipeline.map((x) => (
                  <div key={x.k} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13 }}>
                    <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 999,
                      flex: "none", background: x.c }} />
                    <span style={{ flex: 1, color: "var(--text-body)" }}>{x.k}</span>
                    <span className="cc-num" style={{ color: "var(--text-meta)" }}>{x.n}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 16 }}>
        <Stat n={undecided.length} k="Waiting on your decision"
          from="Clips read but not accepted or rejected"
          tone={undecided.length ? "var(--warn-text)" : undefined}
          onClick={() => onGo("intake")} />
        <Stat n={dueSoon} k="Gaps due within a week"
          from="Open gaps with a deadline inside seven days"
          tone={dueSoon ? "var(--blocked-text)" : undefined}
          onClick={() => onGo("gaps")} />
        <Stat n={expiring.length} k="Losing their rights"
          from="Library clips whose agreement ends within sixty days"
          tone={expiring.length ? "var(--warn-text)" : undefined}
          onClick={() => onGo("library")} />
        <Stat n={unused.length} k="Nobody has used"
          from="Cleared clips that are in no edit"
          onClick={() => onGo("library")} />
      </div>

      {blocked.length > 0 && (
        <div role="alert" style={{ background: "var(--blocked-tint)", borderRadius: 12, padding: "13px 15px",
          boxShadow: "inset 3px 0 0 var(--blocked)", display: "flex", alignItems: "flex-start", gap: 11 }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--blocked-text)" strokeWidth="1.8"
            style={{ flex: "none", marginTop: 1 }} aria-hidden="true">
            <path d="M12 8v5M12 16.5v.5" /><circle cx="12" cy="12" r="9" />
          </svg>
          <div style={{ fontSize: 13, color: "var(--blocked-text)", lineHeight: 1.55 }}>
            <span className="cc-num">{blocked.length}</span> clip{blocked.length === 1 ? "" : "s"} cannot be
            released because a guest is recognisable. They stay in the library and nobody may publish them.
          </div>
        </div>
      )}

      {[["Waiting on you right now", now], ["Sitting with someone else", waiting],
        ["Worth doing when you have a minute", house]]
        .filter(([, list]) => list.length > 0).map(([heading, list]) => (
        <section key={heading}>
          <h2 style={{ margin: "0 0 13px", fontSize: 18, fontWeight: 500, letterSpacing: "-0.015em" }}>
            {heading}
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {list.map((t) => (
              <button key={t.id} onClick={() => onGo(t.target.stage, t.target.focus)} className="cc-lift"
                style={{ ...CARD, borderRadius: 16, display: "flex", alignItems: "flex-start", gap: 13,
                  border: 0, cursor: "pointer", textAlign: "left" }}>
                <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 999, flex: "none",
                  marginTop: 7,
                  background: t.urgency === "now" ? "var(--warn)" : t.urgency === "waiting" ? "var(--text-meta)" : "var(--hairline-2)" }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 14, color: "var(--text)", lineHeight: 1.5 }}>
                    {t.sentence}
                  </span>
                  {(t.clips ?? []).length > 0 && (
                    <span style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                      {t.clips.slice(0, 6).map((c) => {
                        const f = thumbsFor(c, thumbUrls)[0];
                        return (
                          <span key={c.id} aria-hidden="true"
                            style={{ width: 44, height: 55, borderRadius: 8, display: "block",
                              background: "var(--hairline) center/cover no-repeat",
                              backgroundImage: f ? `url(${f})` : "none" }} />
                        );
                      })}
                      {t.clips.length > 6 && (
                        <span className="cc-num" style={{ alignSelf: "flex-end", fontSize: 12, color: "var(--text-meta)" }}>
                          +{t.clips.length - 6} more
                        </span>
                      )}
                    </span>
                  )}
                </span>
                <span style={{ flex: "none", fontSize: 13, color: "var(--accent)", marginTop: 2 }}>{t.cta}</span>
              </button>
            ))}
          </div>
        </section>
      ))}

      {!hasExample && onLoadExample && (
        <Button variant="ghost" size="sm" onClick={onLoadExample} style={{ alignSelf: "flex-start" }}>
          Load a worked example
        </Button>
      )}
    </div>
  );
}

/* ============================================================= LIBRARY === */
/**
 * Deliberately small. Search, rights as a filter, and the one thing that closes
 * the argument the whole product makes: a search that finds nothing becomes the
 * gap that fills it.
 *
 * The search is parsed in code against the taxonomy. A question with one right
 * answer never goes to a model, and "does this word name a room" is one of those.
 */
const SEARCH_FIELDS = [
  ["room_type", ROOM_TYPE], ["scene", SCENE], ["aspect", ASPECT_NATIVE],
  ["shot_size", SHOT_SIZE], ["lighting_condition", LIGHTING_CONDITION],
];

function parseSearch(text) {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const matched = {}; const used = new Set(); const branches = [];
  for (const b of BRANCHES) {
    const bw = b.name.toLowerCase().split(" ");
    if (bw.every((w) => words.includes(w))) { branches.push(b.id); bw.forEach((w) => used.add(w)); }
  }
  for (const [field, list] of SEARCH_FIELDS) {
    for (const value of list) {
      const parts = value.split("_").filter((p) => p.length > 2);
      if (parts.length && parts.every((p) => words.some((w) => w === p || w.startsWith(p) || p.startsWith(w)))) {
        (matched[field] ??= []).push(value);
        parts.forEach((p) => words.forEach((w) => { if (w === p || w.startsWith(p) || p.startsWith(w)) used.add(w); }));
      }
    }
  }
  return { matched, branches, ignored: words.filter((w) => !used.has(w)) };
}

const ASPECT_SHORT = { vertical_9_16: "9:16", square_1_1: "1:1", horizontal_16_9: "16:9", other_ratio: "other" };
const fmtDuration = (sec) => {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  const m = Math.floor(sec / 60), r = Math.round(sec % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
};

/**
 * The library.
 *
 * Rebuilt from Library.dc.html. Two sections: what editors are cutting, and
 * the footage itself. A clip card carries the one thing that decides whether
 * it can be used at all - what the rights say today - and, on the right, the
 * one thing the library could never say before: whether anybody has actually
 * used it.
 */
function LibraryScreen({ library = [], edits = [], editClips = [], creators = [], gaps = [],
  onGo, onNewGap, showTechnical, thumbUrls = {}, onReadAll, reading, readDone, onFillFromStock, filling }) {
  const [watching, setWatching] = useState(null);
  const [text, setText] = useState("");
  const [shelf, setShelf] = useState("all");
  const parsed = useMemo(() => parseSearch(text), [text]);
  const searching = text.trim().length > 0;

  const usedIn = useMemo(() => {
    const m = new Map();
    for (const ec of editClips) m.set(ec.library_id, (m.get(ec.library_id) ?? 0) + 1);
    return m;
  }, [editClips]);

    // rights_status is computed in the database and travels on the row. Working
  // it out again here would mean two answers to one question, and the one on
  // screen would be the one nobody could check.
  const rows = library.map((r) => ({
    ...r,
    _rights: r.rights_status ?? deriveRightsStatus(r.rights),
    _edits: usedIn.get(r.id) ?? 0,
  }));

  const counts = {
    all: rows.length,
    never: rows.filter((r) => r._edits === 0).length,
    expiring: rows.filter((r) => r._rights === "expiring_60d").length,
    blocked: rows.filter((r) => clipPrivacyState(r).blocked).length,
  };

  const results = rows.filter((r) => {
    for (const [field, values] of Object.entries(parsed.matched)) {
      const v = r.ai?.[field]?.value ?? r.system?.[field];
      const have = Array.isArray(v) ? v : [v];
      if (!values.some((x) => have.includes(x))) return false;
    }
    return true;
  });

  const shown = results.filter((r) =>
    shelf === "never" ? r._edits === 0
    : shelf === "expiring" ? r._rights === "expiring_60d"
    : shelf === "blocked" ? clipPrivacyState(r).blocked
    : true);

  const unread = rows.filter((r) => !r.ai);

  const RIGHTS = {
    active: ["var(--accent)", (r) => `Cleared to ${String(r.rights?.expires_at ?? "").slice(0, 4) || "further notice"}`],
    expiring_60d: ["var(--warn)", (r) => `Expires ${r.rights?.expires_at ? `on ${r.rights.expires_at}` : "soon"}`],
    expired: ["var(--blocked)", () => "Expired"],
    unknown: ["var(--text-meta)", () => "Rights not recorded"],
  };

  const EDIT_STATE = {
    in_edit: ["var(--text)", "In edit"],
    waiting_on_you: ["var(--warn)", "Waiting on you"],
    published: ["var(--accent)", "Published"],
  };

  return (
    <div style={{ maxWidth: 1180, display: "flex", flexDirection: "column", gap: 26 }}>
      {watching && <ClipViewer clip={watching} thumbs={thumbsFor(watching, thumbUrls)} onClose={() => setWatching(null)} />}

      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 32, lineHeight: 1.1, letterSpacing: "-0.03em", fontWeight: 500 }}>
            Everything we're cleared to use
          </h1>
          <div style={{ marginTop: 9, fontSize: 14, color: "var(--text-body)" }}>
            <span className="cc-num">{counts.all}</span> clip{counts.all === 1 ? "" : "s"}
            {counts.expiring > 0 && <> · <span className="cc-num">{counts.expiring}</span> lose their rights within the month</>}
            {counts.blocked > 0 && <> · <span className="cc-num">{counts.blocked}</span> blocked and cannot be released</>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 9, flex: "none", flexWrap: "wrap" }}>
        {unread.length > 0 && (
          <button onClick={onReadAll} disabled={reading}
            style={{ background: "var(--model)", color: "#fff", border: 0, borderRadius: 11, height: 44,
              padding: "0 18px", fontSize: 14, fontWeight: 500, cursor: reading ? "progress" : "pointer" }}>
            {reading ? `Reading ${readDone} of ${unread.length}…` : `Read ${unread.length} clips`}
          </button>
        )}
        </div>
      </div>

      {/* First on the page, because it is the only thing here with a deadline.
          After the date the clip does not disappear - it stays, and nobody may
          publish it, which is a worse surprise than losing it would be. */}
      {counts.expiring > 0 && (
        <section style={{ background: "var(--surface)", borderRadius: 18, padding: 20,
          boxShadow: "0 0 0 0.5px var(--hairline), 0 1px 2px rgba(28,25,23,0.03)" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between",
            gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 500, letterSpacing: "-0.015em" }}>
                Use these before the rights run out
              </h2>
              <div style={{ marginTop: 4, fontSize: 13, color: "var(--text-body)" }}>
                After the date, the clip stays here but nobody may publish it.
              </div>
            </div>
            <button onClick={() => setShelf("expiring")}
              style={{ background: "none", border: 0, fontSize: 13, color: "var(--accent)", cursor: "pointer" }}>
              All {counts.expiring}
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
            {rows.filter((r) => r._rights === "expiring_60d").slice(0, 12).map((r) => {
              const frame = thumbsFor(r, thumbUrls)[0];
              const days = r.rights?.expires_at
                ? Math.max(0, Math.round((new Date(r.rights.expires_at) - new Date()) / 86400000))
                : null;
              return (
                <button key={r.id} onClick={() => setWatching(r)} className="cc-expiring"
                  style={{ borderRadius: 13, overflow: "hidden", background: "var(--page)", border: 0,
                    padding: 0, cursor: "pointer", textAlign: "left",
                    boxShadow: "inset 0 0 0 0.5px var(--hairline)" }}>
                  <span style={{ position: "relative", display: "block", width: "100%",
                    aspectRatio: "1/1", background: "var(--hairline)" }}>
                    <span role="img" aria-label={clipSentence(r)}
                      style={{ position: "absolute", inset: 0, display: "block",
                        background: "var(--hairline) center/cover no-repeat",
                        backgroundImage: frame ? `url(${frame})` : "none" }} />
                  </span>
                  <span style={{ display: "block", padding: "10px 11px" }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 500, overflow: "hidden",
                      textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.ai?.room_type?.value ? label(r.ai.room_type.value) : "Not read yet"}
                    </span>
                    <span style={{ marginTop: 4, display: "inline-flex", alignItems: "center", gap: 6,
                      fontSize: 12, color: "var(--warn-text)" }}>
                      <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 999,
                        flex: "none", background: "var(--warn)" }} />
                      {days !== null ? `${days} days left` : "Expiring"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {edits.length > 0 && (
        <section>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between",
            gap: 16, marginBottom: 13 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 500, letterSpacing: "-0.015em" }}>
                What the editors are cutting
              </h2>
              <div style={{ marginTop: 4, fontSize: 13, color: "var(--text-body)" }}>
                {edits.some((e) => e.status === "waiting_on_you")
                  ? "One of these is waiting on you to look at it."
                  : "Nothing here needs you right now."}
              </div>
            </div>
            <span className="cc-num" style={{ fontSize: 13, color: "var(--text-meta)" }}>{edits.length}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
            {edits.map((e) => {
              const members = editClips.filter((m) => m.edit_id === e.id);
              const frames = members
                .map((m) => thumbsFor(rows.find((r) => r.id === m.library_id) ?? {}, thumbUrls)[0])
                .filter(Boolean).slice(0, 3);
              const [dot, word] = EDIT_STATE[e.status] ?? EDIT_STATE.in_edit;
              const placed = members.length;
              return (
                <article key={e.id} className="cc-lift"
                  style={{ background: "var(--surface)", borderRadius: 16, overflow: "hidden",
                    boxShadow: "0 0 0 0.5px var(--hairline), 0 1px 2px rgba(28,25,23,0.03)",
                    display: "flex", flexDirection: "column" }}>
                  {/* The row height is pinned and the overflow clipped. With only
                      a height the implicit row is auto-sized, the images resolve
                      against their own aspect and paint over the card body. */}
                  {frames.length > 0 ? (
                    <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr",
                      gridTemplateRows: "132px", height: 132, gap: 2, overflow: "hidden", background: "var(--hairline)" }}>
                      {[0, 1, 2].map((i) => (
                        <span key={i} style={{ display: "block", minHeight: 0, background: "var(--hairline)",
                          backgroundImage: frames[i] ? `url(${frames[i]})` : "none",
                          backgroundSize: "cover", backgroundPosition: "center" }} />
                      ))}
                    </div>
                  ) : (
                    <div style={{ height: 132, background: "var(--page)", display: "flex",
                      alignItems: "center", justifyContent: "center", fontSize: 13, color: "var(--text-meta)" }}>
                      Nothing placed in it yet
                    </div>
                  )}
                  <div style={{ padding: 15, display: "flex", flexDirection: "column", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 500, letterSpacing: "-0.012em", lineHeight: 1.35 }}>
                        {e.title}
                      </div>
                      {e.purpose && <div style={{ marginTop: 4, fontSize: 12, color: "var(--text-meta)" }}>{e.purpose}</div>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--text-body)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.editor}</span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-body)" }}>
                        <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 999, background: dot }} />
                        {word}
                      </span>
                    </div>
                    <div>
                      <div style={{ height: 4, borderRadius: 999, background: "var(--hairline)", overflow: "hidden" }}>
                        <span style={{ display: "block", height: "100%", borderRadius: 999, background: "var(--text)",
                          width: `${Math.min(100, placed * 8)}%` }} />
                      </div>
                      <div style={{ marginTop: 7, display: "flex", justifyContent: "space-between",
                        fontSize: 12, color: "var(--text-meta)" }}>
                        <span className="cc-num">
                          {placed > 0 ? `${placed} clip${placed === 1 ? "" : "s"} placed` : "no clips yet"}
                        </span>
                        <span>{e.due_at ? `Due ${e.due_at}` : "no date"}</span>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 6, background: "var(--surface)", borderRadius: 12, padding: 4,
            boxShadow: "0 0 0 0.5px var(--hairline)", flexWrap: "wrap" }}>
            {[["all", `All ${counts.all}`], ["never", `Nobody has used ${counts.never}`],
              ["expiring", `Expiring ${counts.expiring}`], ["blocked", `Blocked ${counts.blocked}`]]
              .filter(([k]) => k === "all" || counts[k] > 0).map(([k, name]) => (
              <button key={k} onClick={() => setShelf(k)}
                style={{ fontSize: 13, fontWeight: shelf === k ? 500 : 400, border: 0, cursor: "pointer",
                  color: shelf === k ? "var(--text)" : "var(--text-body)",
                  background: shelf === k ? "var(--page)" : "transparent", borderRadius: 9, padding: "7px 13px" }}>
                {name}
              </button>
            ))}
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--surface)",
            borderRadius: 12, padding: "10px 13px", boxShadow: "0 0 0 0.5px var(--hairline)",
            flex: "1 1 260px", minWidth: "min(100%, 240px)" }}>
            <Search size={16} style={{ color: "var(--text-meta)", flex: "none" }} aria-hidden="true" />
            <span className="sr-only">Search the library</span>
            <input value={text} onChange={(e) => setText(e.target.value)}
              placeholder="Search by room, creator or what happens in the clip"
              style={{ flex: 1, fontSize: 14, border: 0, outline: "none", background: "transparent" }} />
          </label>
        </div>

        {shown.length === 0 ? (
          <EmptyState skeleton="grid"
            title={searching ? "Nothing matches that" : "Nothing in the library yet"}
            body={searching
              ? "No clip in the library matches what you described. That is what a gap is."
              : "Clips land here when you accept them in intake, each with what it shows and what you may do with it."}
            then={searching ? null : "Accepting a clip closes the gap it was shot for, and it appears here with its rights attached."}
            action={searching
              ? <Button variant="primary" onClick={() => onNewGap(parsed)}><Plus size={14} aria-hidden="true" /> Make this a gap</Button>
              : <Button variant="primary" onClick={() => onGo("intake")}><Upload size={14} aria-hidden="true" /> Go to intake</Button>}
            secondary={!searching && onFillFromStock && (
              <Button variant="outline" onClick={onFillFromStock} disabled={!!filling}>
                {filling ? `Fetching ${filling.room ?? "pictures"}…` : "Fill it with placeholder footage"}
              </Button>
            )} />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(196px, 1fr))", gap: 16 }}>
            {shown.map((r) => {
              const [fg, word] = RIGHTS[r._rights] ?? RIGHTS.unknown;
              const blocked = clipPrivacyState(r).blocked;
              const creator = creators.find((c) => c.id === r.creator_id);
              const frames = thumbsFor(r, thumbUrls);
              return (
                <article key={r.id} className="cc-lift" onClick={() => setWatching(r)}
                  style={{ background: "var(--surface)", borderRadius: 16, overflow: "hidden", cursor: "pointer",
                    display: "flex", flexDirection: "column",
                    boxShadow: "0 0 0 0.5px var(--hairline), 0 1px 2px rgba(28,25,23,0.03)" }}>
                  <div style={{ position: "relative", width: "100%", aspectRatio: "4/5", background: "var(--hairline)" }}>
                    <Thumb thumbs={frames} alt={clipSentence(r)} onPlay={() => setWatching(r)} />
                    <span className="cc-num" style={{ position: "absolute", left: 9, bottom: 9, fontSize: 11,
                      color: "#fff", background: "rgba(28,25,23,0.62)", borderRadius: 6, padding: "2px 6px" }}>
                      {fmtDuration(r.system?.duration)}
                    </span>
                    <span style={{ position: "absolute", right: 9, bottom: 9, fontSize: 11, color: "#fff",
                      background: "rgba(28,25,23,0.62)", borderRadius: 6, padding: "2px 6px" }}>
                      {ASPECT_SHORT[r.system?.aspect_native] ?? "—"}
                    </span>
                  </div>
                  <div style={{ padding: 13, display: "flex", flexDirection: "column", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.35 }}>
                        {r.ai?.room_type?.value ? label(r.ai.room_type.value) : "Not read yet"}
                      </div>
                      <div style={{ marginTop: 3, fontSize: 12, color: "var(--text-meta)", lineHeight: 1.45, minHeight: 34 }}>
                        {r.ai ? clipSentence(r) : "Nobody has looked at this one yet."}
                      </div>
                      {r.ai_status === "sample" && (
                        <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-meta)" }}>
                          Sample text, not read by the model
                        </div>
                      )}
                    </div>
                    {creator && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Avatar name={creator.display_name} photo={creator.photo} size={22} />
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text-body)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {creator.display_name}
                        </span>
                      </div>
                    )}
                    <div style={{ paddingTop: 10, boxShadow: "inset 0 0.5px 0 var(--hairline)", display: "flex",
                      alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12,
                        color: blocked ? "var(--blocked-text)" : "var(--text-meta)" }}>
                        <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 999, flex: "none",
                          background: blocked ? "var(--blocked)" : fg }} />
                        {blocked ? "Blocked — guest in frame" : word(r)}
                      </span>
                      <span className="cc-num" style={{ fontSize: 12, color: "var(--text-meta)", whiteSpace: "nowrap" }}>
                        {r.sample
                          ? "Placeholder"
                          : r._edits > 0 ? `In ${r._edits} edit${r._edits === 1 ? "" : "s"}` : "Never used"}
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {rows.some((r) => r.sample) && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--text-meta)", lineHeight: 1.5 }}>
          Rows marked placeholder are stock photography from Pexels, standing in until real footage
          arrives. Credit: {[...new Set(rows.filter((r) => r.sample?.credit).map((r) => r.sample.credit))]
            .slice(0, 6).join(", ")}.
        </p>
      )}

      {showTechnical && <div style={{ fontSize: 12, color: "var(--text-meta)" }}>{shown.length} of {rows.length} shown</div>}
    </div>
  );
}

function stageStates({ gaps, creators, scores, collabs, clips }) {
  const openGaps = gaps.filter((g) => g.status === "open");
  const scored = Object.keys(scores).length;
  const approved = collabs.filter((c) => c.brief_approved_by);
  const scheduled = approved.filter((c) => acceptedProposal(c));
  const st = (state, why = null) => ({ state, why });
  return {
    home: st("ready"),
    gaps: openGaps.length ? st("done") : st("ready"),
    creators: creators.length ? (scored ? st("done") : st("ready")) : st("ready"),
    briefs: collabs.length
      ? (approved.length ? st("done") : st("ready"))
      : (creators.length && openGaps.length ? st("ready") : st("locked", "Needs at least one open gap and one creator.")),
    visits: approved.length
      ? (scheduled.length ? st("done") : st("ready"))
      : st("locked", "Needs a brief that has been approved in stage 3."),
    intake: approved.length
      ? (clips.length ? st("done") : st("ready"))
      : st("locked", "Needs a brief that has been approved in stage 3."),
    library: clips.some((c) => c.clip_status === "accepted") ? st("done") : st("locked", "Fills up as you accept clips in stage 5."),
  };
}

/* ================================================================ APP ==== */
const STAGES = [
  { id: "home", n: 0, name: "Today", icon: Zap, built: true },
  { id: "gaps", n: 1, name: "Gaps", icon: Target, built: true },
  { id: "creators", n: 2, name: "Creators", icon: Users, built: true },
  { id: "briefs", n: 3, name: "Briefs", icon: FileText, built: true },
  { id: "visits", n: 4, name: "Visits", icon: CalendarCheck, built: true },
  { id: "intake", n: 5, name: "Intake", icon: Inbox, built: true },
  { id: "library", n: 6, name: "Library", icon: Library, built: true },
];


/* ==================================================== CONNECT SCREEN ===== */
/**
 * The first thing anyone sees on a fresh machine.
 *
 * The details go from the clipboard into this browser and stop there. They are
 * not in the code of this page, they were not in the build, and nobody else's
 * computer has them. Rotating the key is a paste, not a redeployment.
 *
 * The shape check runs before any request, because the two keys on the
 * Supabase page look alike and only one of them is safe to put in a browser.
 * "That is the secret key, go back and copy the other one" is a better answer
 * than a raw 401 from the network.
 */
function ConnectScreen({ onConnected }) {
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [problems, setProblems] = useState([]);
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState(null);

  const connect = async () => {
    const p = checkConnectionShape({ url, key });
    setProblems(p); setFailure(null);
    if (p.length) return;
    setChecking(true);
    saveConnection({ url, key });
    const probe = await gapsRepo.all();
    setChecking(false);
    if (probe.ok) onConnected();
    else { forgetConnection(); setFailure(probe); }
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--page)" }}>
      <div className="max-w-xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-semibold text-slate-900 tracking-tight">Connect to your database</h1>
        <p className="text-base text-slate-600 leading-relaxed mt-2">
          Paste two values from Supabase. They are kept in this browser, on this computer, and
          nowhere else. They are not part of this page and were never sent to anyone.
        </p>

        <details className="mt-5 border border-slate-200 rounded-xl bg-white p-4">
          <summary className="text-base font-medium text-slate-900 cursor-pointer">Where to find them</summary>
          <ol className="text-sm text-slate-700 leading-relaxed mt-3 pl-5 space-y-2" style={{ listStyle: "decimal" }}>
            <li>Open <a className="underline" href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">supabase.com/dashboard</a> and click your project.</li>
            <li>In the left sidebar, scroll to the bottom and click <b>Project Settings</b>.</li>
            <li>Click <b>API Keys</b>.</li>
            <li>Copy the <b>Project URL</b> from the top of that page.</li>
            <li>Copy the key labelled <b>publishable</b>. It starts with <span className="cc-mono">sb_publishable_</span>.</li>
          </ol>
          <p className="text-sm mt-3 leading-relaxed" style={{ color: "var(--warn-text)" }}>
            The same page has a key labelled <b>secret</b>. Do not copy that one. It ignores every rule
            in the project and must never sit in a browser.
          </p>
        </details>

        <label htmlFor="cc-url" className="block text-sm font-medium text-slate-800 mt-6 mb-1.5">Project URL</label>
        <input id="cc-url" className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="https://something.supabase.co" autoComplete="off" spellCheck="false" />

        <label htmlFor="cc-key" className="block text-sm font-medium text-slate-800 mt-4 mb-1.5">Publishable key</label>
        <input id="cc-key" className={inputCls} value={key} onChange={(e) => setKey(e.target.value)}
          placeholder="sb_publishable_…" autoComplete="off" spellCheck="false" />

        {problems.map((p, i) => (
          <div key={i} role="alert" className={`text-sm leading-relaxed rounded-lg p-3 mt-3 ${p.danger ? "cc-blocked" : ""}`}
            style={p.danger ? {} : { background: "var(--warn-bg)", color: "var(--warn-text)" }}>
            {p.text}
          </div>
        ))}

        {failure && <div className="mt-4"><Failure failure={failure} /></div>}

        <div className="mt-6">
          <Button variant="primary" onClick={connect} disabled={checking}>
            {checking ? "Checking…" : "Connect"}
          </Button>
        </div>

        <p className="text-sm text-slate-500 leading-relaxed mt-8">
          Opening this page from a file on your computer will not work. Browsers block network
          requests from a local file, so every check comes back unreachable even when everything is
          correct. It has to be served over http, which is what dragging it onto a host does.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const [stage, setStage] = useState("home");
  const [focus, setFocus] = useState(null);
  const [showTechnical, setShowTechnical] = useState(false);
  const [theme, setTheme] = useState("auto");
  const [creatorTab, setCreatorTab] = useState("roster");
  const [focusGapId, setFocusGapId] = useState(null);
  const [selectedCollabId, setSelectedCollabId] = useState(null);
  const [gaps, setGapsState] = useState([]);
  const [creators, setCreatorsState] = useState([]);
  const [scores, setScoresState] = useState({});
  const [collabs, setCollabsState] = useState([]);
  const [clips, setClipsState] = useState([]);
  const [identity, setIdentity] = useState(null);
  const [myRole, setMyRole] = useState(null);
  const [myPhoto, setMyPhoto] = useState(null);
  const [identityDraft, setIdentityDraft] = useState("");
  const [roleDraft, setRoleDraft] = useState("");
  const [photoDraft, setPhotoDraft] = useState("");
  const [identityOpen, setIdentityOpen] = useState(false);
  const [persona, setPersona] = useState("coordinator");
  const [personaBranch, setPersonaBranch] = useState(BRANCHES[0].id);
  const [startCollab, setStartCollab] = useState(null);
  const [connected, setConnected] = useState(() => getConnection());
  const [boot, setBoot] = useState({ status: "loading", failures: {} });
  const [thumbUrls, setThumbUrls] = useState({});
  const [find, setFind] = useState("");
  const [library, setLibrary] = useState([]);
  const [edits, setEdits] = useState([]);
  const [editClips, setEditClips] = useState([]);
  const [filling, setFilling] = useState(null);

  /**
   * Fills an empty library with stock, so the screens can be looked at with
   * pictures in them. Every row it writes is marked, and the library says so
   * on the card.
   */
  const fillFromStock = useCallback(async () => {
    setFilling({ done: 0, total: 0, room: null });
    const r = await fillLibraryFromStock({ gaps, creators, collabs, onProgress: setFilling });
    if (!r.ok) { setSaveFailure(r); setFilling(null); return; }
    const written = [];
    for (const row of r.rows) {
      const made = await clipsRepo.create(row, []);
      if (!made.ok) { setSaveFailure(made); break; }
      written.push(row);
    }
    setClipsState((c) => [...written, ...c]);
    setLibrary((l) => [...written, ...l]);
    setFilling(null);
  }, [gaps, creators, collabs]);

  const [libReading, setLibReading] = useState(false);
  const [libDone, setLibDone] = useState(0);

  /**
   * Reads every unread clip in the library, in place, with a live count.
   *
   * The frames are in the record, so this is the real path: the same two
   * requests per clip that intake makes, the same validation, the same refusal
   * to accept a privacy answer it could not read. Nothing here is simulated,
   * which is why it takes as long as it takes.
   */
  const readLibrary = useCallback(async () => {
    const todo = library.filter((c) => !c.ai);
    if (!todo.length) return;
    setLibReading(true); setLibDone(0);
    let current = library;
    for (let i = 0; i < todo.length; i++) {
      const clip = todo[i];
      try {
        // The stored frames are what there is. They go through the same call
        // and the same validation intake uses - no shortcut exists here that
        // does not exist there.
        const frames = { analysis: clip.thumbs ?? [] };
        if (!frames.analysis.length) continue;
        const r = await readClip(frames);
        const patch = {
          ai: r.described.fields, quality_flags: r.described.quality_flags,
          overconfidence: r.described.overconfidence, ai_issues: r.described.issues,
          privacy_flags: r.privacy.privacy_flags, privacy_issues: r.privacy.issues,
        };
        // Privacy failing is not description failing. A clip whose privacy
        // could not be read is held, exactly as it is in intake.
        if (r.privacy.review_required) {
          patch.clip_status = "requires_human_review";
          patch.privacy_reason = r.privacy.review_reason;
        }
        const saved = await clipsRepo.patch(clip.id, patch);
        if (!saved.ok) { setSaveFailure(saved); break; }
        current = current.map((c) => (c.id === clip.id ? { ...c, ...patch } : c));
        setLibrary(current);
      } catch (e) {
        setSaveFailure({ ok: false, title: "Reading stopped", detail: e.message, retryable: true, kind: e.kind ?? "model_failed" });
        break;
      }
      setLibDone(i + 1);
    }
    setLibReading(false);
  }, [library]);
  const [navOpen, setNavOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gapFormOpen, setGapFormOpen] = useState(false);
  const [gapSeed, setGapSeed] = useState(null);

  /** The count the design shows beside each stage. Null where a number would
   *  be noise rather than information. */
  const stageCount = (id) =>
    id === "home" ? (buildTasks({ gaps, creators, collabs, clips }).filter((t) => t.urgency === "now").length || null)
    : id === "gaps" ? gaps.filter((g) => g.status === "open").length || null
    : id === "creators" ? creators.length || null
    : id === "briefs" ? collabs.length || null
    : id === "visits" ? collabs.filter((c) => c.brief_approved_by).length || null
    : id === "intake" ? clips.filter((c) => c.clip_status !== "accepted" && c.clip_status !== "rejected").length || null
    : id === "library" ? clips.filter((c) => c.clip_status === "accepted").length || null
    : null;
  const [thumbFailure, setThumbFailure] = useState(null);

  useEffect(() => {
    const el = document.createElement("style"); el.textContent = CSS;
    document.head.appendChild(el); return () => el.remove();
  }, []);

  // Follows the operating system unless someone says otherwise. One less
  // decision to make on the first morning, still overridable on any morning.
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");

    /* "auto" is not a third palette, it is whichever of the two the machine is
       already using - and it has to keep following if that changes while the
       app is open, which a one-off read would not. */
    const apply = () => {
      const wanted = theme === "auto" ? (media?.matches ? "dark" : "light") : theme;
      root.setAttribute("data-theme", wanted);
    };
    apply();
    media?.addEventListener?.("change", apply);
    return () => {
      media?.removeEventListener?.("change", apply);
      root.removeAttribute("data-theme");
    };
  }, [theme]);

  /**
   * Cold start.
   *
   * Six reads go out together and each one's outcome is kept separate. If the
   * clips table is refused and the rest succeed, five screens work and one
   * says exactly why it cannot - rather than the whole app showing nothing, or
   * worse, showing "no clips yet".
   */
  const runBoot = useCallback(async () => {
    setBoot({ status: "loading", failures: {} });
    const { data, failures, anyFailed } = await loadEverything();

    if (failures.gaps || failures.creators) {
      // Without these two nothing else can be read against anything.
      setBoot({ status: "failed", failures, fatal: failures.gaps ?? failures.creators });
      return;
    }

    const settings = Object.fromEntries((data.settings ?? []).map((r) => [r.key, r.value]));

    // An empty database is a first run, not an error. Seeding is a write, so
    // it is only claimed once the server has taken it.
    if ((data.gaps ?? []).length === 0 && (data.creators ?? []).length === 0 && !settings.seeded) {
      setBoot({ status: "seeding", failures: {} });
      const g = SEED_GAPS.map(makeGap), c = SEED_CREATORS.map(makeCreator);
      const rg = await applyDiff(gapsRepo, { added: g, changed: [], removed: [] });
      const rc = rg.ok ? await applyDiff(creatorsRepo, { added: c, changed: [], removed: [] }) : { ok: true };
      if (!rg.ok || !rc.ok) {
        const f = rg.ok ? rc : rg;
        setBoot({ status: "failed", failures: {},
          fatal: { ...f, detail: `${f.detail} This happened while putting the sample data in for the first time, `
            + `which means the app and the database disagree about what a record looks like rather than anything `
            + `being wrong with your connection.` } });
        // Nothing half-seeded is left behind to confuse the next attempt.
        await applyDiff(gapsRepo, { added: [], changed: [], removed: g.map((x) => x.id) });
        return;
      }
      // Three collabs at three points in the flow, so Briefs, Visits and Today
      // all have something real on them the first time they are opened.
      const sample = buildSampleCollabs(g, c);
      const rs = await syncCollabs([], sample, { collabsRepo, shotsRepo, visitsRepo });
      const sampleClips = rs.ok ? buildSampleClips(g, c, sample) : [];
      for (const clip of sampleClips) await saveClipRecord(clip);

      await settingsRepo.set("seeded", { at: now(), taxonomy_version: TAXONOMY_VERSION });
      setGapsState(g); setCreatorsState(c); setScoresState({});
      setCollabsState(rs.ok ? sample : []); setClipsState(sampleClips);
      if (!rs.ok) setSaveFailure(rs);
      setIdentityOpen(true);
      setBoot({ status: "ready", failures: {} });
      return;
    }

    setGapsState(data.gaps ?? []);
    setCreatorsState(data.creators ?? []);
    setCollabsState(data.collabs ?? []);
    setClipsState(data.clips ?? []);
    setScoresState(Object.fromEntries((data.scores ?? []).map((s) => [`${s.creator_id}|${s.gap_id}`, s])));
    setLibrary(data.library ?? []);
    setEdits(data.edits ?? []);
    setEditClips(data.editClips ?? []);
    setIdentity(settings.identity ?? null);
    setMyRole(settings.identity_role ?? null);
    setMyPhoto(settings.identity_photo ?? null);
    setIdentityDraft(settings.identity ?? "");
    setRoleDraft(settings.identity_role ?? "");
    setPhotoDraft(settings.identity_photo ?? "");
    setPersona(settings.persona ?? "coordinator");
    setPersonaBranch(settings.persona_branch ?? BRANCHES[0].id);
    setShowTechnical(!!settings.show_technical);
    setTheme(settings.theme ?? "auto");
    if (!settings.identity) setIdentityOpen(true);
    setBoot({ status: "ready", failures });
  }, []);

  useEffect(() => {
    document.title = `Creator Collabs · ${BUILD.slice(5, 16)}`;
  }, []);

  useEffect(() => { if (connected) runBoot(); }, [connected, runBoot]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e) => { if (e.key === "Escape") setNavOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  /**
   * The thumbnails live in a private bucket, so a reloaded clip has paths and
   * no pictures until they are signed. Signing happens in one batch for the
   * whole set rather than one request per frame.
   */
  useEffect(() => {
    const paths = clips.flatMap((c) => c.thumb_paths ?? []);
    if (!paths.length) return;
    let alive = true;
    (async () => {
      const r = await signThumbs(paths);
      if (alive && r.ok) setThumbUrls(r.data);
      else if (alive && !r.ok) setThumbFailure(r);
    })();
    return () => { alive = false; };
  }, [clips]);

  /**
   * The setters the screens already call, now backed by a database.
   *
   * Each one shows the new array immediately, marks itself as saving, and puts
   * the previous array back if the server refuses. Reverting is the honest
   * ending: leaving rejected rows on screen would mean the app is displaying
   * something the database does not have.
   */
  const [pending, setPending] = useState(0);
  const [saveFailure, setSaveFailure] = useState(null);

  const synced = useCallback((current, setState, run) => async (next) => {
    const previous = current;
    setState(next);
    setPending((p) => p + 1);
    const r = await run(previous, next);
    setPending((p) => p - 1);
    if (!r.ok) { setState(previous); setSaveFailure(r); }
    else setSaveFailure(null);
    return r;
  }, []);

  const setGaps = useCallback((n) => synced(gaps, setGapsState,
    (prev, next) => applyDiff(gapsRepo, diffRows(prev, next)))(n), [gaps, synced]);

  const setCreators = useCallback((n) => synced(creators, setCreatorsState,
    (prev, next) => applyDiff(creatorsRepo, diffRows(prev, next)))(n), [creators, synced]);

  const setCollabs = useCallback((n) => synced(collabs, setCollabsState,
    (prev, next) => syncCollabs(prev, next, { collabsRepo, shotsRepo, visitsRepo }))(n), [collabs, synced]);

  const setScores = useCallback((n) => synced(scores, setScoresState,
    (prev, next) => syncScores(prev, next, scoresRepo))(n), [scores, synced]);

  // Clips save themselves one at a time, as they always did: they are the only
  // heavy write here and one failing must not take the rest of the batch down.
  const setClips = useCallback((n) => { setClipsState(n); }, []);

  const patchMeta = async (p) => {
    for (const [k, v] of Object.entries(p)) {
      const r = await settingsRepo.set(k, v);
      if (!r.ok) setSaveFailure(r);
    }
  };
  const saveIdentity = async (name, role, photo) => {
    setIdentity(name);
    if (role !== undefined) setMyRole(role);
    if (photo !== undefined) setMyPhoto(photo);
    await patchMeta({ identity: name,
      ...(role !== undefined ? { identity_role: role } : {}),
      ...(photo !== undefined ? { identity_photo: photo } : {}) });
    setIdentityOpen(false);
  };
  const switchPersona = async (p) => { setPersona(p); await patchMeta({ persona: p }); };
  const toggleTechnical = async () => { const v = !showTechnical; setShowTechnical(v); await patchMeta({ show_technical: v }); };
  const changeTheme = async (v) => { setTheme(v); await patchMeta({ theme: v }); };
  const changePersonaBranch = async (b) => { setPersonaBranch(b); await patchMeta({ persona_branch: b }); };

  /**
   * Replacing everything is a write like any other, so it does not claim to
   * have happened until the database says it did. Clearing first matters:
   * seeding on top of existing rows would collide on the primary key and half
   * of it would silently not land.
   */
  const replaceAll = async ({ gaps: g, creators: c, seeded, withSample }) => {
    setPending((p) => p + 1);
    const steps = [
      applyDiff(clipsRepo, { added: [], changed: [], removed: clips.map((x) => x.id) }),
      applyDiff(collabsRepo, { added: [], changed: [], removed: collabs.map((x) => x.id) }),
      applyDiff(gapsRepo, { added: g, changed: [], removed: gaps.map((x) => x.id) }),
      applyDiff(creatorsRepo, { added: c, changed: [], removed: creators.map((x) => x.id) }),
    ];
    for (const step of steps) {
      const r = await step;
      if (!r.ok) { setPending((p) => p - 1); setSaveFailure(r); return r; }
    }
    const sample = withSample ? buildSampleCollabs(g, c) : [];
    if (sample.length) await syncCollabs([], sample, { collabsRepo, shotsRepo, visitsRepo });
    const sampleClips = sample.length ? buildSampleClips(g, c, sample) : [];
    for (const clip of sampleClips) await saveClipRecord(clip);
    await settingsRepo.set("seeded", seeded ? { at: now(), taxonomy_version: TAXONOMY_VERSION } : null);
    setGapsState(g); setCreatorsState(c); setScoresState({}); setCollabsState(sample);
    setClipsState(sampleClips); setSelectedCollabId(null); sessionFrames.clear();
    setPending((p) => p - 1); setSaveFailure(null);
    return ok(null);
  };

  const reseed = () => replaceAll({ gaps: SEED_GAPS.map(makeGap), creators: SEED_CREATORS.map(makeCreator), seeded: true, withSample: true });
  const startEmpty = () => replaceAll({ gaps: [], creators: [], seeded: false });

  const createCollab = ({ branchId, gapIds, note }) => {
    const { creator, score } = startCollab;
    const chosen = gapIds.map((id) => gaps.find((g) => g.id === id)).filter(Boolean);
    const measuredOnly = !!score && score.ai_status !== "ok";
    const rec = makeCollab({
      creator_id: creator.id, branch_id: branchId, gap_ids: gapIds, created_by: identity,
      brief_shot_list: deriveShotList(chosen), brief_fingerprint: briefFingerprint(chosen),
      started_without_score: !score,
      selection_note: measuredOnly && note.trim()
        ? { text: note.trim(), by: identity, at: now(),
            score_snapshot: { measured_score: score.measured_score, total: score.total, ai_status: score.ai_status,
              branch_fit: score.branch_fit.value, format_fit: score.format_fit.value, audience_fit: score.audience_fit.value } }
        : null,
    });
    setCollabs([rec, ...collabs]); setStartCollab(null); setSelectedCollabId(rec.id); setStage("briefs");
  };

  const openP0 = useMemo(() => gaps.filter((g) => g.status === "open" && g.priority === "p0").length, [gaps]);
  const pendingScores = useMemo(() => {
    let n = 0;
    gaps.filter((g) => g.status === "open").forEach((g) => creators.forEach((c) => {
      if (scoreFreshness(scores[pairId(c, g)], c, g) !== "fresh") n += 1;
    }));
    return n;
  }, [gaps, creators, scores]);
  const draftBriefs = collabs.filter((c) => !c.brief_approved_by).length;
  const needDate = collabs.filter((c) => c.brief_approved_by && visitState(c) !== "scheduled" && visitState(c) !== "awaiting_branch").length;
  const privacyOpen = clips.filter((c) => c.clip_status !== "rejected" && clipPrivacyState(c).blocked).length;
  /** Opening the gap form, optionally seeded from something on screen. */
  const openGapForm = (seed) => { setGapSeed(seed ?? null); setGapFormOpen(true); };

  const states = useMemo(() => stageStates({ gaps, creators, scores, collabs, clips }), [gaps, creators, scores, collabs, clips]);
  const go = useCallback((next, f = null) => {
    setStage(next);
    setFocus(f);
    if (next === "briefs") setSelectedCollabId(f?.collabId ?? null);
  }, []);
  const hasExample = collabs.some((c) => c.created_by === "Sample data");
  const findResults = useMemo(() => crossSearch(find, { gaps, creators, clips }), [find, gaps, creators, clips]);

  const loadWorkedExample = async () => {
    let g = gaps, c = creators;
    if (!g.length || !c.length) {
      g = SEED_GAPS.map(makeGap); c = SEED_CREATORS.map(makeCreator);
      const r = await replaceAll({ gaps: g, creators: c, seeded: true });
      if (!r.ok) return;
    }
    const ex = buildWorkedExample(g, c);
    if (!ex) return;
    const r = await setCollabs([ex, ...collabs]);
    if (!r.ok) return;
    setSelectedCollabId(null);
    go("intake", null);
  };

  if (!connected) return <ConnectScreen onConnected={() => setConnected(getConnection())} />;

  if (boot.status === "loading" || boot.status === "seeding") {
    return (
      <div className="flex items-center justify-center" style={{ minHeight: "100vh", background: "var(--page)" }}>
        <div className="text-center">
          <Loader2 className="animate-spin mx-auto text-slate-500" size={20} aria-hidden="true" />
          <p className="text-sm text-slate-500 mt-3" role="status" aria-live="polite">
            {boot.status === "seeding" ? "Putting the sample gaps and creators in the database…" : "Reading everything from the database…"}
          </p>
        </div>
      </div>
    );
  }

  if (boot.status === "failed") {
    return (
      <div className="p-6" style={{ minHeight: "100vh", background: "var(--page)" }}>
        <div className="max-w-xl mx-auto pt-16">
          <h1 className="text-2xl font-semibold text-slate-900 mb-1">This could not open</h1>
          <p className="text-sm text-slate-600 mb-5">
            Nothing is broken on your side. Here is exactly what the database said.
          </p>
          <Failure failure={boot.fatal} onRetry={runBoot} />
          <button onClick={() => { forgetConnection(); setConnected(null); }}
            className="text-sm text-slate-600 underline mt-5 cursor-pointer">
            Connect to a different database
          </button>
        </div>
      </div>
    );
  }

  if (persona === "branch_manager") {
    return (
      <>
        <BranchManagerApp collabs={collabs} setCollabs={setCollabs} creators={creators}
          identity={identity ?? "unsigned"} branchId={personaBranch} setBranchId={changePersonaBranch}
          onSwitchPersona={() => switchPersona("coordinator")}
          onEditIdentity={() => { setIdentityDraft(identity ?? ""); setIdentityOpen(true); }} />
        <Modal open={identityOpen} title="Who is using this?" dismissable={!!identity} onClose={() => setIdentityOpen(false)}
          footer={<>{identity && <Button variant="outline" onClick={() => setIdentityOpen(false)}>Cancel</Button>}
            <Button variant="primary" disabled={identityDraft.trim().length < 2} onClick={() => saveIdentity(identityDraft.trim())}>Continue</Button></>}>
          <p className="text-sm text-slate-600 leading-relaxed mb-3">
            Answers are stored with a name. This is a declaration, not a login, and it protects nothing.
          </p>
          <input className={inputCls} value={identityDraft} onChange={(e) => setIdentityDraft(e.target.value)} placeholder="Your name" autoFocus />
        </Modal>
      </>
    );
  }

  /* The same sidebar in both places. Two copies would drift apart by the
     second change, and the phone one would be the one that rots. */
  const SidebarBody = ({ onNavigate, withStages = true }) => (
    <>
        {/* Who you are, at the top, where a person expects it - rather than a
            field halfway down a settings list. It is still a declaration and
            the line under the name keeps saying so. */}
        <div className="px-3.5 py-3.5 border-b border-slate-200">
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-sm font-medium">Creator Collabs</span>
            <span className="text-xs text-slate-500 cc-num" title="When this build was made. If this is not the newest one, you are on an older address.">{BUILD.slice(5, 16)}</span>
          </div>
          <button onClick={() => setIdentityOpen(true)}
            className="w-full flex items-center gap-2.5 text-left rounded-lg px-1.5 py-1.5 -mx-1.5 hover:bg-slate-50 transition-colors cursor-pointer"
            title="A declaration, not a login. Nothing here is protected.">
            <Avatar name={identity ?? "??"} size={34} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-slate-900 truncate">{identity ?? "Not signed"}</span>
              <span className="block text-xs text-slate-500">
                {persona === "coordinator" ? "Coordinator" : `${branchById(personaBranch)?.name ?? "Branch"} manager`}
              </span>
            </span>
            <PenLine size={13} className="text-slate-500 shrink-0" aria-hidden="true" />
          </button>
        </div>

        {withStages && (
        <ul className="flex-1 py-3 overflow-y-auto cc-scroll">
          <li className="px-4 pb-1.5 text-xs text-slate-500" style={{ letterSpacing: "0.04em" }}>STAGES</li>
          {STAGES.map((s) => {
            const active = stage === s.id;
            const st = states[s.id] ?? { state: "ready", why: null };
            const locked = st.state === "locked";
            const badge =
              s.id === "gaps" && openP0 > 0 ? { n: openP0, cls: "bg-rose-600" }
              : s.id === "briefs" && draftBriefs > 0 ? { n: draftBriefs, cls: "bg-amber-500" }
              : s.id === "visits" && needDate > 0 ? { n: needDate, cls: "bg-amber-500" }
              : s.id === "intake" && privacyOpen > 0 ? { n: privacyOpen, cls: "bg-rose-600" }
              : null;
            return (
              <li key={s.id}>
                <button onClick={() => { setStage(s.id); if (s.id === "briefs") setSelectedCollabId(null); onNavigate?.(); }}
                  title={st.why ?? undefined}
                  className={`w-full text-left px-2.5 py-2 mx-2 rounded-lg flex items-center gap-2.5 text-sm transition-colors ${
                    active ? "bg-slate-900 text-white" : locked ? "text-slate-500 hover:bg-slate-50" : "text-slate-700 hover:bg-slate-50"}`}
                  style={{ width: "calc(100% - 16px)" }}>
                  <s.icon size={16} className={active ? "text-white" : locked ? "text-slate-500" : "text-slate-500"} />
                  <span className="flex-1">{s.name}</span>
                  {badge && <span className={`cc-num text-xs ${badge.cls} text-white rounded px-1.5`}>{badge.n}</span>}
                  {!badge && !active && st.state === "done" && <Check size={12} className="text-emerald-600" />}
                  {!badge && !active && st.state === "ready" && s.id !== "start" && <span className="w-1.5 h-1.5 rounded-full bg-slate-900" />}
                  {!badge && locked && <Lock size={11} className={active ? "text-slate-500" : "text-slate-500"} />}
                </button>

              </li>
            );
          })}
        </ul>
        )}

        <div className="border-t border-slate-200 p-3 space-y-1">
          <div className="px-2 pb-2">
            <div className="text-xs text-slate-500 mb-1.5">Viewing as</div>
            <div className="flex gap-1">
              {PERSONA.map((p) => (
                <button key={p} onClick={() => switchPersona(p)}
                  className={`flex-1 text-xs px-2 py-1.5 rounded font-medium ${persona === p ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                  {p === "coordinator" ? "Coordinator" : "Branch"}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">A mode, not a login. Nothing here is protected.</p>
          </div>

          <button onClick={() => { setIdentityDraft(identity ?? ""); setIdentityOpen(true); }}
            className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-50 mb-1">
            <div className="text-xs text-slate-500">Decisions signed as</div>
            <div className="text-sm font-medium text-slate-900 flex items-center gap-1.5">{identity ?? "not set"} <PenLine size={11} className="text-slate-500" /></div>
          </button>

          <div className="flex items-center gap-2 px-2 pb-2">
            <Ruler size={11} aria-hidden="true" style={{ color: "var(--text-meta)" }} /><span className="text-xs text-slate-600">measured</span>
            <Sparkles size={11} className="ml-2" aria-hidden="true" style={{ color: "var(--model)" }} />
            <span className="text-xs" style={{ color: "var(--model-text)" }}>judged</span>
          </div>
          <label className="flex items-center gap-2 px-2 pb-2 cursor-pointer">
            <input type="checkbox" checked={showTechnical} onChange={toggleTechnical} className="cursor-pointer" />
            <span className="text-xs text-slate-600">Show record IDs</span>
          </label>
          <div className="px-2 pb-3">
            <div className="text-xs text-slate-500 mb-1.5">Appearance</div>
            <div className="flex gap-1" role="group" aria-label="Appearance">
              {[["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]].map(([v, l]) => (
                <button key={v} onClick={() => changeTheme(v)} aria-pressed={theme === v}
                  className={`flex-1 text-xs px-2 py-1.5 rounded font-medium transition-colors ${
                    theme === v ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{l}</button>
              ))}
            </div>
          </div>
          <SelfTest counts={{
            creators: creators.length,
            creatorsWithPhoto: creators.filter((c) => c.photo).length,
            clips: clips.length,
            clipsWithFrames: clips.filter((c) => (c.thumbs ?? []).length || (c.thumb_paths ?? []).length).length,
            library: library.length,
          }} />

          <Button size="sm" variant="ghost" className="w-full justify-start" onClick={loadWorkedExample} disabled={hasExample}>
            <Zap size={13} /> Load a worked example
          </Button>
          <Button size="sm" variant="ghost" className="w-full justify-start" onClick={reseed}><RotateCcw size={13} /> Reset to sample data</Button>
          <Button size="sm" variant="ghost" className="w-full justify-start" onClick={startEmpty}><Trash2 size={13} /> Start empty</Button>
        </div>
    </>
  );

  return (
    <div className="lg:flex" style={{ minHeight: "100vh", background: "var(--page)", color: "var(--text)" }}>
      {/* On a phone the sidebar is a drawer. 240px of navigation against a
          390px screen leaves no room for the thing being navigated to. */}
      <header className="lg:hidden sticky top-0 z-30 flex items-center gap-3 px-4 py-2.5 bg-white border-b border-slate-200">
        <button onClick={() => setNavOpen(true)} aria-label="Open the stages"
          className="p-1.5 -ml-1.5 rounded-lg hover:bg-slate-100 cursor-pointer">
          <Menu size={20} aria-hidden="true" />
        </button>
        <span className="text-sm font-medium flex-1 truncate">
          {STAGES.find((x) => x.id === stage)?.name ?? "Creator Collabs"}
        </span>
        <Avatar name={identity ?? "??"} size={28} />
      </header>

      {navOpen && (
        <div className="lg:hidden fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Stages">
          <button className="absolute inset-0 cursor-default" aria-label="Close the stages"
            style={{ background: "rgba(12,10,9,0.45)" }} onClick={() => setNavOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64 bg-white flex flex-col" style={{ maxWidth: "82vw" }}>
            <SidebarBody stages={STAGES} stage={stage} setStage={setStage}
              stageCount={stageCount} states={states} onNavigate={() => setNavOpen(false)} />
          </div>
        </div>
      )}

      {/* An icon rail, not a labelled sidebar.
          A panel spends 240px telling you where you are. Someone who opens
          this every morning knows. The width goes to the work instead, and
          the name of each stage is one hover away. */}
      {/* The shell, to the handoff: 248px, border-box, inset hairline, sticky. */}
      <nav className="hidden lg:flex" aria-label="Stages"
        style={{ width: 248, boxSizing: "border-box", flex: "none", background: "var(--surface)",
          boxShadow: "inset -0.5px 0 0 var(--hairline)", padding: "20px 16px",
          flexDirection: "column", gap: 22, position: "sticky", top: 0, height: "100vh" }}>

        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 4px" }}>
          <span aria-hidden="true" style={{ width: 30, height: 30, borderRadius: 9, background: "var(--accent)",
            display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
            <Library size={16} strokeWidth={1.8} style={{ color: "#fff" }} />
          </span>
          <span style={{ fontSize: 16, fontWeight: 500, letterSpacing: "-0.02em", flex: 1 }}>Creator Collabs</span>
          <span style={{ fontSize: 11, color: "var(--text-meta)" }} className="cc-num" title={`Built ${BUILD}`}>
            {BUILD.slice(11, 16)}
          </span>
        </div>

        <button onClick={() => setSettingsOpen(true)}
          style={{ display: "flex", alignItems: "center", gap: 11, background: "var(--page)",
            borderRadius: 12, padding: "10px 11px", boxShadow: "0 0 0 0.5px var(--hairline)",
            cursor: "pointer", border: 0, textAlign: "left", width: "100%" }}>
          <Avatar name={identity ?? "??"} photo={myPhoto} size={36} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 14, fontWeight: 500, lineHeight: 1.3 }}>
              {identity ?? "Not signed"}
            </span>
            <span style={{ display: "block", fontSize: 12, color: "var(--text-meta)", lineHeight: 1.4 }}>
              {myRole || (persona === "coordinator" ? "Marketing coordinator"
                : `${branchById(personaBranch)?.name ?? "Branch"} manager`)}
            </span>
          </span>
          <ChevronRight size={14} aria-hidden="true"
            style={{ color: "var(--text-meta)", transform: "rotate(90deg)", flex: "none" }} />
        </button>

        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.09em",
            color: "var(--text-meta)", padding: "0 10px 6px" }}>Stages</div>
          {STAGES.map((st) => {
            const active = stage === st.id;
            const sState = states[st.id] ?? { state: "ready", why: null };
            const locked = sState.state === "locked";
            const n = stageCount(st.id);
            return (
              <button key={st.id} onClick={() => { setStage(st.id); if (st.id === "briefs") setSelectedCollabId(null); }}
                title={sState.why ?? undefined} aria-current={active ? "page" : undefined}
                className="cc-nav"
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px",
                  borderRadius: 11, border: 0, cursor: "pointer", textAlign: "left", width: "100%",
                  background: active ? "var(--text)" : "transparent",
                  color: active ? "var(--on-dark)" : locked ? "var(--text-meta)" : "var(--text-body)" }}>
                <st.icon size={17} strokeWidth={1.7} aria-hidden="true" style={{ flex: "none" }} />
                <span style={{ flex: 1, fontSize: 14, fontWeight: active ? 500 : 400 }}>{st.name}</span>
                {n !== null && (
                  <span className="cc-num" style={{ fontSize: 12, color: active ? "var(--hairline-2)" : "var(--text-meta)" }}>{n}</span>
                )}
                {locked && <Lock size={11} aria-hidden="true" style={{ color: "var(--text-meta)" }} />}
              </button>
            );
          })}
        </div>

        <span style={{ flex: 1 }} />
      </nav>

      <Drawer open={settingsOpen} title="You, and how this is set up"
        subtitle="Everything here lives on this computer only" onClose={() => setSettingsOpen(false)}>
        <SidebarBody withStages={false} />
      </Drawer>

      <main style={{ flex: 1, minWidth: 0, padding: "26px 32px 64px" }}>
        <div style={{ maxWidth: 1180 }}>

        {/* Failures belong on the page, not in a drawer. This banner used to
            live inside the settings panel, which is shut, so every failed
            action looked like a button that did nothing at all. */}
        {saveFailure && (
          <div role="alert" style={{ background: "var(--blocked-tint)", borderRadius: 12, padding: "13px 15px",
            marginBottom: 22, boxShadow: "inset 3px 0 0 var(--blocked)", display: "flex",
            alignItems: "flex-start", gap: 11 }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--blocked-text)" strokeWidth="1.8"
              style={{ flex: "none", marginTop: 1 }} aria-hidden="true">
              <path d="M12 8v5M12 16.5v.5" /><circle cx="12" cy="12" r="9" />
            </svg>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: "var(--blocked-text)" }}>{saveFailure.title}</p>
              <p style={{ margin: "3px 0 0", fontSize: 13, color: "var(--blocked-text)", lineHeight: 1.55 }}>
                {saveFailure.detail}
              </p>
              {saveFailure.kind && (
                <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--blocked-text)", opacity: 0.75 }}>{saveFailure.kind}</p>
              )}
            </div>
            <button onClick={() => setSaveFailure(null)} aria-label="Dismiss this message"
              style={{ background: "none", border: 0, color: "var(--blocked-text)", cursor: "pointer", flex: "none" }}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}

        {/* One search, above every screen, because looking something up is the
            thing a person does most and it should not depend on which stage
            they happen to be standing in. */}
        <FindBar value={find} onChange={setFind} results={findResults} thumbUrls={thumbUrls}
          onGo={(st, f) => { setFind(""); go(st, f); }} />

        {stage === "home" && (
          <HomeScreen thumbUrls={thumbUrls} gaps={gaps} creators={creators} collabs={collabs} clips={clips}
            library={library} edits={edits} editClips={editClips} identity={identity} myRole={myRole}
            onGo={go} onLoadExample={loadWorkedExample} hasExample={hasExample} />
        )}
        {stage === "gaps" && (
          <GapsScreen thumbsFor={thumbsFor} label={label} branchById={branchById}
            gapSentence={gapSentence} ScreenIntro={ScreenIntro} EmptyState={EmptyState}
            NextStep={NextStep} thumbUrls={thumbUrls} onNewGap={(seed) => openGapForm(seed)}
            gaps={gaps} setGaps={setGaps} clips={clips} creators={creators} scores={scores} collabs={collabs}
            onGo={go} focus={focus} onClearFocus={() => setFocus(null)} showTechnical={showTechnical}
            onOpenMatching={(gid) => { setStage("creators"); setCreatorTab("matching"); setFocusGapId(gid); }} />
        )}
        {stage === "creators" && (
          <CreatorsScreen onScoreCreator={async (creator, openGaps) => {
              try { return await scoreChunk(creator, openGaps); }
              catch (e) { return { failed: true, title: "Scoring stopped",
                detail: String(e.message ?? e).slice(0, 300) }; }
            }} ScreenIntro={ScreenIntro} EmptyState={EmptyState} NextStep={NextStep}
            CreatorCard={CreatorCard} CreatorProfile={CreatorProfile} creatorRecord={creatorRecord}
            Avatar={Avatar} Thumb={Thumb} thumbsFor={thumbsFor} label={label}
            branchById={branchById} clipSentence={clipSentence} Speciality={Speciality}
            Recommendation={Recommendation} thumbUrls={thumbUrls}
            creators={creators} setCreators={setCreators} gaps={gaps} scores={scores} setScores={setScores}
            focusGapId={focusGapId} setFocusGapId={setFocusGapId} tab={creatorTab} setTab={setCreatorTab} onGo={go}
            showTechnical={showTechnical} collabs={collabs} clips={clips}
            onOpenCollab={(id) => go("briefs", { collabId: id })} identity={identity}
            onStartCollab={({ creator, gap, score }) => setStartCollab({ creator, gap, score })} />
        )}
        {stage === "briefs" && (
          <BriefsScreen label={label} branchById={branchById} fmtDate={fmtDate}
            acceptedProposal={acceptedProposal} now={now} CollabDetail={CollabDetail} briefFingerprint={briefFingerprint} uncoveredChannels={uncoveredChannels} draftShotNotes={draftShotNotes}
            EmptyState={EmptyState} NextStep={NextStep} SCENE_WORD={SCENE_WORD}
            clips={clips} collabs={collabs} setCollabs={setCollabs} gaps={gaps} creators={creators} onGo={go}
            showTechnical={showTechnical}
            identity={identity ?? "unsigned"} selectedId={selectedCollabId} setSelectedId={setSelectedCollabId} />
        )}
        {stage === "visits" && (
          <VisitsScreen label={label} branchById={branchById} fmtDate={fmtDate}
            acceptedProposal={acceptedProposal} now={now} ProposeDate={ProposeDate} TIME_OF_DAY={TIME_OF_DAY} VISIT_DURATION={VISIT_DURATION} NextStep={NextStep}
            clips={clips} collabs={collabs} setCollabs={setCollabs} gaps={gaps} creators={creators}
            identity={identity ?? "unsigned"} onGo={go} focus={focus} onClearFocus={() => setFocus(null)} />
        )}
        {stage === "intake" && (
          <IntakeScreen onLibraryAdded={(row) => setLibrary((l) => [row, ...l])} thumbUrls={thumbUrls} setSaveFailure={setSaveFailure} collabs={collabs} gaps={gaps} creators={creators} clips={clips} setClips={setClips}
            identity={identity ?? "unsigned"} onGo={go} focus={focus} onClearFocus={() => setFocus(null)}
            showTechnical={showTechnical}
            onNewGap={(seed) => {
              const rec = makeGap(seed);
              setGaps([rec, ...gaps]);
              go("gaps", { gapIds: [rec.id], why: "you just created from a clip" });
            }} />
        )}
        {stage === "library" && (
          <LibraryScreen library={library} edits={edits} editClips={editClips} creators={creators}
            onFillFromStock={fillFromStock} filling={filling}
            onReadAll={readLibrary} reading={libReading} readDone={libDone} thumbUrls={thumbUrls} gaps={gaps} onGo={go} showTechnical={showTechnical}
            onNewGap={(seed) => {
              const rec = makeGap(seed);
              setGaps([rec, ...gaps]);
              go("gaps", { gapIds: [rec.id], why: "you just created from an empty search" });
            }} />
        )}
        </div>
      </main>

      {startCollab && (
        <StartCollabDrawer label={label} branchById={branchById} BRANCHES={BRANCHES}
            gapSentence={gapSentence} open={!!startCollab} onClose={() => setStartCollab(null)}
          creator={startCollab.creator} originGap={startCollab.gap} originScore={startCollab.score}
          gaps={gaps} onCreate={createCollab} identity={identity ?? "unsigned"} />
      )}

      <Modal open={identityOpen} title="Who is using this?" dismissable={!!identity} onClose={() => setIdentityOpen(false)}
        footer={<>{identity && <Button variant="outline" onClick={() => setIdentityOpen(false)}>Cancel</Button>}
          <Button variant="primary" disabled={identityDraft.trim().length < 2}
            onClick={() => saveIdentity(identityDraft.trim(), roleDraft.trim(), photoDraft.trim() || null)}>
            Save
          </Button></>}>
        <p className="text-sm leading-relaxed mb-4" style={{ color: "var(--text-body)" }}>
          Approvals, rights entries, overrides, visit answers and privacy clearances are stored with a name.
          This is a declaration, not a login, and it protects nothing. It just means that in six months, every
          decision in here has someone attached to it.
        </p>

        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          <Avatar name={identityDraft || "??"} photo={photoDraft || null} size={72} square />
          <div style={{ flex: "1 1 260px", minWidth: "min(100%, 240px)", display: "flex",
            flexDirection: "column", gap: 12 }}>
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: 12, color: "var(--text-meta)", marginBottom: 5 }}>Your name</span>
              <input className={inputCls} value={identityDraft} onChange={(e) => setIdentityDraft(e.target.value)}
                placeholder="Yarden Lerer" autoFocus />
            </label>
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: 12, color: "var(--text-meta)", marginBottom: 5 }}>
                Your role, as it should read next to a decision
              </span>
              <input className={inputCls} value={roleDraft} onChange={(e) => setRoleDraft(e.target.value)}
                placeholder="Marketing coordinator" />
            </label>
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: 12, color: "var(--text-meta)", marginBottom: 5 }}>
                A picture, if you want one
              </span>
              <input className={inputCls} value={photoDraft} onChange={(e) => setPhotoDraft(e.target.value)}
                placeholder="https://…" />
              <span style={{ display: "block", marginTop: 5, fontSize: 12, color: "var(--text-meta)" }}>
                A link to an image. Leave it empty and your initials are used instead.
              </span>
            </label>
          </div>
        </div>
      </Modal>
    </div>
  );
}


/* ============================================================ TEST SEAM ==== */
/* The screens take their helpers as props, so a test that renders one has to
   supply them. Exporting the real ones - rather than letting the test invent
   stubs - is what keeps the test honest: a stub that renders a div would pass
   while the real card was broken. */
export {
  label, branchById, fmtDate, now, acceptedProposal, thumbsFor, clipSentence,
  gapSentence, creatorRecord, briefFingerprint, uncoveredChannels,
  ScreenIntro, EmptyState, NextStep, Thumb, Speciality, Recommendation,
  BRANCHES, TIME_OF_DAY, VISIT_DURATION, SCENE_WORD,
};


/* ========================================================== VALIDATION ==== */
/**
 * The vocabulary and the rules that check answers against it.
 *
 * These are exported rather than copied into a second file. There used to be
 * a standalone validation.js that the tests ran against, and nine of its
 * fourteen functions had drifted from the ones the app actually used - so the
 * suite was green against code nobody shipped. One copy, and the test imports
 * this one.
 */
export {
  TAXONOMY, ALL_TAXONOMY_VALUES, validateDescription, validatePrivacy,
  privacyBlocks, extractJson, canAnalyse, framePlan, matchClipToShots,
};
