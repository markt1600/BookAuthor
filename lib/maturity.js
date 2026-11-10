// maturity.js — audience and maturity, shared by every build of the app.
//
// Holds the mild BASELINE (a general-audience default, plus the plain 18+
// sliders) and hands off to a content pack when one is installed. The adult
// pack (lib/adult.js) is optional: lib/content-packs.js decides whether it is
// loaded. Everything the rest of the app needs to know about maturity comes
// through the functions below, so no other file special-cases adult content.

import { adult as pack } from "./content-packs.js";

export const hasAdultPack = Boolean(pack);

// ---- Styles a pack adds -----------------------------------------------------
const packStyles = (pack && pack.styles) || {};
export const PACK_STYLE_KEYS = Object.keys(packStyles);
export const PACK_STYLE_LABELS = Object.fromEntries(PACK_STYLE_KEYS.map((k) => [k, packStyles[k].label || k]));
export const PACK_STYLE_PROFILES = Object.fromEntries(
  PACK_STYLE_KEYS.filter((k) => packStyles[k].profile).map((k) => [k, packStyles[k].profile])
);
export const PACK_STYLE_PROMPTS = Object.fromEntries(PACK_STYLE_KEYS.map((k) => [k, packStyles[k].prompt || ""]));

export const STYLE_HINT =
  (pack && pack.styleHint) ||
  "Hemingway, Murakami & Burdett also preset point of view, tense, and maturity to match the author — adjust anything below.";

// Creative latitude is fixed at "balanced" — it's no longer a user option.
export const LATITUDE_TEXT =
  (pack && pack.latitude) ||
  "Follow the director's instruction, using tasteful initiative on smaller details and texture.";

// ---- The writer's audience instruction --------------------------------------
function baselineMaturityText(g) {
  if (!g || !g.adult) {
    return "Audience: general. Keep content broadly suitable — no graphic violence, no explicit sexual content, no strong profanity.";
  }
  // Phrase each dimension as an ACTIVE instruction for the chosen level, not a
  // passive ceiling — otherwise the model treats "permitted" as "may" and stays
  // clean. Profanity especially must be directed, or it never appears.
  const violence = [
    "Avoid graphic violence.",
    "Mild violence is fine where the story calls for it.",
    "Depict moderate violence directly when a scene calls for it; don't shy away from it.",
    "Render strong, graphic violence unflinchingly where the story calls for it.",
  ];
  const sexual = [
    "Avoid explicit sexual content.",
    "Mild romantic/sexual content is fine, kept non-explicit.",
    "Write moderate sexual content directly when a scene calls for it.",
    "Write explicit sexual content where the story calls for it.",
  ];
  const language = [
    "Avoid profanity.",
    "Let characters use occasional mild profanity where it fits naturally.",
    "Let characters swear naturally — use realistic profanity in dialogue when the moment calls for it; do not sanitize it.",
    "Have characters use strong, unsanitized profanity wherever it fits them and the situation; do not soften, bleep, or avoid swearing.",
  ];
  const lvl = (n) => Math.min(3, Math.max(0, Number(n) || 0));
  const parts = [
    "Audience: adults (18+). All characters are adults.",
    violence[lvl(g.violence)],
    sexual[lvl(g.sexual)],
    language[lvl(g.language)],
  ];
  if (g.erotica && g.sexual === 3) {
    parts.push(
      "This is an adult erotica work: lean strongly into the erotica genre, with explicit, consensual intimacy between adults as a central and recurring element of the story."
    );
  }
  parts.push("Keep all of this in service of the story and true to the characters — never gratuitous.");
  return parts.join(" ");
}

export function maturityText(g) {
  const fromPack = pack && pack.maturityText ? pack.maturityText(g) : null;
  return fromPack || baselineMaturityText(g);
}

// ---- Guide settings ---------------------------------------------------------
// Applied at the end of clampGuide (lib/book.js).
export function clampMaturity(g) {
  return pack && pack.clampGuide ? pack.clampGuide(g) : g;
}
// True when the chosen style forces the adult switch on.
export function adultLocked(g) {
  return Boolean(pack && pack.locksAdult && pack.locksAdult(g));
}

// How the prose review should lean for this book. Baseline: only the erotica
// lean (adult + erotica with explicitness at max), guide books only.
export function reviewLean(book) {
  if (pack && pack.reviewLean) return pack.reviewLean(book);
  const g = book && book.guide;
  const eroticaLean = Boolean(book && book.mode === "guide" && g && g.adult && g.erotica && g.sexual === 3);
  return { adult: false, eroticaLean };
}

// ---- Hooks into the writing passes (all empty without a pack) ---------------
export const adultWriterRules = (guide) => (pack && pack.writerRules ? pack.writerRules(guide) : "");
export const economyNote = (guide) => (pack && pack.economyNote ? pack.economyNote(guide) : "");
export const polishException = (guide) => (pack && pack.polishException ? pack.polishException(guide) : "");
export const judgeNote = (opts) => (pack && pack.judgeNote ? pack.judgeNote(opts) : "");
export const textureNote = (book) => (pack && pack.textureNote ? pack.textureNote(book) : "");

// ---- Hooks into the review --------------------------------------------------
// The extra card the reader's notes show, or null.
export const REVIEW_CARD = (pack && pack.reviewCard) || null;

const NO_REVIEW = { key: "", field: "", critique: "", suggestionsLine: "", direct: "", lean: "" };
export function adultReview(opts = {}) {
  const fromPack = pack && pack.review ? pack.review(opts) : null;
  if (fromPack) return { ...NO_REVIEW, ...fromPack };
  return {
    ...NO_REVIEW,
    lean:
      !pack && opts.eroticaLean
        ? "This is an adult erotica work (all characters are adults): the genre should reflect that, and nextDirection should lean into intimate, erotic developments between adults."
        : "",
  };
}
