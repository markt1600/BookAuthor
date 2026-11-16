// Drive the real app (offline mode, scripted model) through a book's first
// chapters and assert on the stored state and on the exact prompts each stage
// received.
import { readFileSync } from "node:fs";

const APP = process.argv[2];
const LOG = process.argv[3];
let fails = 0;
const ok = (c, m) => {
  console.log(`${c ? "PASS" : "FAIL"}: ${m}`);
  if (!c) fails++;
};
const prompts = () => readFileSync(LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const last = (kind) => prompts().filter((p) => p.kind === kind).pop();
const count = (kind) => prompts().filter((p) => p.kind === kind).length;

async function j(method, path, body) {
  const res = await fetch(APP + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    return { status: res.status, data: null, text };
  }
}
async function turn(id, text, extra = {}) {
  const res = await fetch(`${APP}/api/books/${id}/turn`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, ...extra }) });
  const events = (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const err = events.find((e) => e.t === "error");
  if (err) throw new Error("turn failed: " + err.error);
  return events;
}
const book = async (id) => (await j("GET", `/api/books/${id}`)).data.book;

const created = await j("POST", "/api/books", { title: "The North Rock", author: "Mark", mode: "guide" });
const id = created.data.id;
ok(created.data.book.settings.chapterAudit === true && created.data.book.brief === null && created.data.book.outline === null, "new book: audit on, no brief, no outline");

// ---- chapter 1: two sections ----
let ev = await turn(id, "Mara arrives and finds the letter.");
ok(ev.some((e) => e.t === "plan") && ev.some((e) => e.t === "analysis" && "outline" in e && "brief" in e), "stream carries the plan phase and the planning fields");
let b = await book(id);
ok(/PRIORITIES:/.test(b.turns[0].plan), "the stored plan carries the desk's ruling");
ok(b.analysis.holes.split("\n").length === 2, "the analyzer flagged two suspected holes");
await turn(id, "She hides it from the keeper.");

// The second section's WRITER prompt: ruled, so no raw advisory notes.
let w = last("writer").user;
ok(w.includes("What matters most in THIS section, in order"), "writer gets the ranked ruling");
ok(w.includes("1. MUST — close the gap about the key"), "…with the planner's priorities verbatim");
ok(!w.includes("PRIORITIES:"), "…and the beats block no longer contains the raw PRIORITIES header");
for (const [needle, what] of [
  ["Open logic gaps in the story so far", "raw open-holes list"],
  ["PACING STEER", "raw pacing steer"],
  ["Planted setups and promises", "raw setups ledger"],
  ["How recent sections spent their words", "raw balance note"],
  ["The editor's current concern", "raw critique concern"],
]) ok(!w.includes(needle), `writer is NOT given the ${what}`);
ok(w.includes("do NOT reuse or echo any of these") && w.includes("How each character talks"), "writer keeps the two reference lists (used phrasing, voices)");
ok(w.includes("Continuity notes") && w.includes("Most recent prose"), "writer keeps the facts (continuity, recent prose)");

// The PLANNER for that section saw the notes the writer did not.
let p = last("planner").user;
ok(p.includes("Open logic gaps flagged by the editor") && p.includes("Planted setups awaiting payoff") && p.includes("PACING STEER") && p.includes("The editor's current concern with the story"), "planner reads holes, setups, pacing, and the editor's concern");
ok(count("audit") === 0 && count("outline") === 0 && count("brief") === 0, "no audit / outline / brief before a chapter closes");

// ---- open chapter 2: chapter 1 closes ----
ev = await turn(id, "Morning. Mara confronts him.", { newChapter: true });
b = await book(id);
const c1 = Object.values(b.chapterNotes)[0];
ok(count("audit") === 1 && c1 && c1.audit && c1.audit.accomplished.startsWith("Mara finds the letter"), "closing chapter 1 ran exactly one audit and stored it");
const auditPrompt = last("audit").user;
ok(auditPrompt.includes("1. Mara knows the door code without being told") && auditPrompt.includes("2. The brass key vanished"), "the audit was asked to rule on each suspected hole");
ok(auditPrompt.includes("Mara stood at the door"), "the audit read the full chapter text");
const holes = b.analysis.holes.split("\n");
ok(!holes.some((h) => h.includes("door code")), "the DISMISSED hole left the open list");
ok(holes.some((h) => h.includes("brass key")), "the CONFIRMED hole stayed");
ok(holes.some((h) => h.includes("lamp burns all night")), "the NEW hole the audit found was added");
const an = last("analysis");
ok(an.user.includes("Dismissed in the audit — not real gaps, do not re-flag:\nMara knows the door code"), "the analyzer was told not to re-flag the dismissed hole");
ok(an.user.includes("Audit of chapter 1"), "the analyzer was given the audit");
ok(b.brief && b.brief.confirmed === false && b.brief.premise.startsWith("Mara, sent to close"), "a brief was PROPOSED (unconfirmed)");
ok(b.outline && b.outline.forChapter === 2 && b.outline.chapters[0].num === 2, "the outline was drawn for chapter 2 onward");
ok(ev.some((e) => e.t === "analysis" && e.outline && e.brief), "the client is sent the new outline and brief");

// ---- next section: planner sees outline + audit, but NOT the unconfirmed brief ----
await turn(id, "He denies it.");
p = last("planner").user;
ok(p.includes("The rolling outline") && p.includes("THIS CHAPTER (ch 2 — The Wick)"), "planner sees the outline with THIS CHAPTER = 2");
ok(p.includes("Audit of chapter 1") && p.includes("Consequences the next chapter must pick up"), "planner sees the audit's carry-forward");
ok(p.includes("A fresh reader given only chapter 1 reported"), "planner sees the cold read");
ok(!p.includes("The author's brief"), "an UNCONFIRMED brief is not used in any prompt");
ok(!last("writer").user.includes("The rolling outline") && !last("writer").user.includes("Audit of chapter"), "the writer is not given the outline or audit raw");

// ---- confirm the brief; pin an outline entry ----
let r = await j("PUT", `/api/books/${id}`, { brief: { ...b.brief, targetWords: 30000 } });
ok(r.data.book.brief.confirmed === true && r.data.book.brief.targetWords === 30000, "saving the brief confirms it");
const edited = b.outline.chapters.map((e) => (e.num === 3 ? { ...e, summary: "AUTHOR: the boat does not come at all." } : e));
r = await j("PUT", `/api/books/${id}`, { outline: { through: b.outline.through, chapters: edited } });
ok(r.data.book.outline.chapters.find((e) => e.num === 3).pinned === true && r.data.book.outline.chapters.find((e) => e.num === 2).pinned === false, "the edited outline entry is pinned; untouched ones are not");
await turn(id, "She searches his room.");
p = last("planner").user;
ok(p.includes("The author's brief — the stated aims") && p.includes("of a planned 30,000 words"), "a CONFIRMED brief reaches the planner, with the length position");
ok(p.includes("AUTHOR: the boat does not come at all. [set by the author]"), "the pinned entry is shown to the planner as the author's");
ok(last("analysis").system.includes("AUTHOR'S BRIEF") && last("analysis").user.includes("The author's brief"), "the analyzer judges against the confirmed brief");

// ---- open chapter 3: outline redrawn around the pinned entry; audit sees brief + outline entry ----
const outlinesBefore = count("outline");
await turn(id, "The next day the sea is flat.", { newChapter: true });
b = await book(id);
ok(count("outline") === outlinesBefore + 1 && b.outline.forChapter === 3, "closing chapter 2 redrew the outline for chapter 3");
ok(b.outline.chapters[0].num === 3 && b.outline.chapters[0].summary === "AUTHOR: the boat does not come at all." && b.outline.chapters[0].pinned, "the author's pinned chapter survived the redraw");
ok(b.outline.chapters.every((e) => e.num >= 3), "chapters already written fell out of the outline");
ok(last("outline").user.includes("FIXED entries set by the author:\nch 3"), "the outline model was told which entries are fixed");
const a2 = last("audit");
ok(a2.user.includes("The author's brief") && a2.user.includes("What the outline planned for this chapter: The Wick"), "chapter 2's audit was held against the brief and its outline entry");
const c2 = Object.values(b.chapterNotes).find((n) => n.num === 2);
ok(c2.audit.aims.verdict === "ON COURSE" && c2.audit.outline.verdict === "PARTLY", "audit verdicts against brief and outline are stored");
ok(count("audit") === 2, "one audit per closed chapter — not re-run on later sections");
ok(count("brief") === 1, "the brief was proposed once, never re-proposed after confirmation");
// the planner for the chapter-opening section read the outline entry for the chapter being OPENED
const openPlanner = prompts().filter((x) => x.kind === "planner").pop().user;
ok(openPlanner.includes("THIS CHAPTER (ch 3"), "a section that opens a chapter is planned against THAT chapter's outline entry");

// ---- on-demand routes ----
r = await j("POST", `/api/books/${id}/brief`);
ok(r.status === 200 && r.data.brief && r.data.brief.confirmed === false, "POST /brief returns a proposal and saves nothing");
ok((await book(id)).brief.confirmed === true, "…the confirmed brief is untouched");
r = await j("POST", `/api/books/${id}/outline`);
ok(r.status === 200 && r.data.book.outline.rev > b.outline.rev && r.data.book.outline.chapters[0].pinned, "POST /outline redraws on demand and keeps the pin");

// ---- plan off: the old path, raw notes straight to the writer ----
await j("PUT", `/api/books/${id}`, { settings: { planFirst: false } });
const plannersBefore = count("planner");
await turn(id, "She waits.");
w = last("writer").user;
ok(count("planner") === plannersBefore, "with planning off, no planner call is made");
ok(w.includes("Open logic gaps in the story so far") && w.includes("PACING STEER") && !w.includes("What matters most in THIS section"), "with planning off, the writer gets the raw notes exactly as before");

// ---- audit off ----
await j("PUT", `/api/books/${id}`, { settings: { planFirst: true, chapterAudit: false } });
const auditsBefore = count("audit");
await turn(id, "Night again.", { newChapter: true });
ok(count("audit") === auditsBefore, "with the chapter audit switched off, closing a chapter runs no audit");
ok(count("summary") >= 3, "…but chapter summaries still run");

// ---- dismissing a brief ----
r = await j("PUT", `/api/books/${id}`, { brief: null });
ok(r.data.book.brief.dismissed === true, "dismissing the brief is recorded");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
