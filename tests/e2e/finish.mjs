// Finish the book, end to end: plan the outline through to the last chapter,
// then drive the run one step at a time (exactly as the page does) until the
// server reports the book ended — asserting on the stored state and on the
// prompts each stage received. Run by tests/e2e/run.sh after drive.mjs.
import { readFileSync } from "node:fs";

const APP = process.argv[2];
const LOG = process.argv[3];
let fails = 0;
const ok = (c, m) => {
  console.log(`${c ? "PASS" : "FAIL"}: ${m}`);
  if (!c) fails++;
};
const start = readFileSync(LOG, "utf8").split("\n").filter(Boolean).length; // ignore the earlier driver's prompts
const prompts = () => readFileSync(LOG, "utf8").split("\n").filter(Boolean).slice(start).map((l) => JSON.parse(l));
const of = (kind) => prompts().filter((p) => p.kind === kind);
const last = (kind) => of(kind).pop();

async function j(method, path, body) {
  const res = await fetch(APP + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    return { status: res.status, data: null, text };
  }
}
async function stream(path, body) {
  const res = await fetch(APP + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const text = await res.text();
  if (!res.ok) return { status: res.status, events: [], error: (JSON.parse(text) || {}).error };
  return { status: res.status, events: text.split("\n").filter(Boolean).map((l) => JSON.parse(l)) };
}
const book = async (id) => (await j("GET", `/api/books/${id}`)).data.book;

console.log("\n---- finish the book ----");
const created = await j("POST", "/api/books", { title: "The North Rock II", author: "Mark", mode: "guide" });
const id = created.data.id;

let r = await stream(`/api/books/${id}/finish/step`);
ok(r.status === 400 && /plan the rest of the book first/.test(r.error), "a step without a plan is refused");
r = await j("POST", `/api/books/${id}/finish`, { action: "plan" });
ok(r.status === 400, "a blank book with no brief cannot be planned to the end");

await stream(`/api/books/${id}/turn`, { text: "Mara arrives and finds the letter." });
await stream(`/api/books/${id}/turn`, { text: "She hides it from the keeper." });
await j("PUT", `/api/books/${id}`, { brief: { premise: "Mara finds a letter the keeper is hiding.", ending: "She learns the truth and keeps it.", themes: "Loyalty against duty.", targetWords: 5000 } });

// ---- the plan ----
r = await j("POST", `/api/books/${id}/finish`, { action: "plan" });
let b = r.data.book;
ok(r.status === 200 && b.outline.toEnd === true && b.outline.chapters.length === 3, "planning draws an outline that runs to the end (3 chapters)");
ok(b.outline.chapters.every((e) => e.detail && e.detail.startsWith(`Overview of chapter ${e.num}`)), "every planned chapter carries a fuller overview");
ok(b.finish && b.finish.status === "planned" && b.finish.chapter.num === 1 && b.finish.chapter.opens === false, "the run is planned and starts inside the chapter in progress");
ok(b.turns.length === 2 && !b.ended, "planning writes nothing");
const eg = last("endgame");
ok(eg.system.includes("EVERY remaining chapter") && eg.system.includes("This plan must FINISH the book"), "the outline model was asked for a complete plan to the last page");
ok(eg.user.includes("The author's brief") && eg.system.includes("binding"), "…and bound to the confirmed brief");
const cp1 = last("chapterplan");
ok(cp1.system.includes("Part of this chapter is already written") && cp1.user.includes("Chapter 1 so far"), "the chapter in progress is broken down from where its prose stops");
ok(cp1.user.includes("The chapter after it (do NOT write this") && cp1.user.includes("ch 2"), "the breakdown is shown the next chapter for the hand-off");
const perChapter = b.finish.chapter.directions.length;
ok(perChapter >= 1 && perChapter <= 8, `chapter 1 has ${perChapter} section(s) left to write`);

// The author edits the plan before starting: the entry is pinned and survives.
const edited = b.outline.chapters.map((e) => (e.num === 2 ? { ...e, title: "The Boat", summary: "AUTHOR: the supply boat arrives a day early." } : e));
r = await j("PUT", `/api/books/${id}`, { outline: { through: b.outline.through, chapters: edited } });
ok(r.data.book.outline.toEnd === true && r.data.book.outline.chapters.find((e) => e.num === 2).pinned, "editing the plan keeps it a plan to the end and pins the entry");

// ---- the run ----
let steps = 0;
let ended = false;
let firstEvents = null;
while (!ended && steps < 60) {
  r = await stream(`/api/books/${id}/finish/step`);
  const err = r.events.find((e) => e.t === "error");
  if (r.status !== 200 || err) {
    ok(false, `step ${steps + 1} failed: ${r.error || (err && err.error)}`);
    break;
  }
  if (!firstEvents) firstEvents = r.events;
  steps++;
  const done = r.events.find((e) => e.t === "done");
  ended = Boolean(done && done.book && done.book.ended);
}
ok(firstEvents && firstEvents.some((e) => e.t === "delta") && firstEvents.some((e) => e.t === "analysis" && "finish" in e), "a step streams prose and then the notes with the run's state");
b = await book(id);
ok(ended && b.ended === true && b.finish.status === "done", `the run ended the book after ${steps} sections`);
ok(b.chapters.length === 3, "it opened every planned chapter (3 in all)");
ok(b.chapters[1].title === "The Boat" && b.chapters[2].title === "The Rock", "new chapters are titled from the outline");
ok(b.turns.length === 2 + steps && b.turns.slice(2).every((t) => t.auto && t.prompt && t.plan), "every section is stored with its direction and beat plan");
ok(b.turns[2].prompt.startsWith("Ch 1 step 1") && !b.turns[2].prompt.includes("Autopilot"), "the stored direction is the chapter breakdown's line");

const cps = of("chapterplan");
const cp2 = cps.find((p) => p.user.includes("THE CHAPTER TO BREAK DOWN — chapter 2"));
ok(cp2 && cp2.user.includes("AUTHOR: the supply boat arrives a day early."), "the author's pinned chapter is what gets written");
ok(cp2 && cp2.user.includes("Audit of chapter 1") && cp2.user.includes("Chapter 1 ("), "chapter 2 was broken down AFTER chapter 1 was audited and summarised");
ok(cp2 && cp2.user.includes("The agreed overview of this chapter") && cp2.user.includes("Overview of chapter 2:"), "the chapter is broken down from its overview, the author's pinned one included");
const cp3 = cps.find((p) => p.user.includes("THE CHAPTER TO BREAK DOWN — chapter 3 (the final chapter)"));
ok(cp3 && cp3.system.includes("This is the FINAL chapter of the book"), "the last chapter is broken down as the ending");
ok(of("audit").length === 3, "every chapter was audited as it closed, the final one included");
const plans = of("endgame");
ok(
  plans.length >= 2 && !plans[0].user.includes("Your previous answer covered only") && plans[1].user.includes("Your previous answer covered only 1 chapter"),
  "a plan that stopped after one chapter was sent back for the whole book"
);
const redraws = plans.slice(2);
ok(redraws.length === 2 && redraws.every((p) => p.system.includes("ends the book at chapter 3")), "the plan was redrawn at each chapter close and held to its last chapter");
ok(redraws[0].user.includes("FIXED entries set by the author:\nch 2"), "…around the author's pinned entry");

const second = of("writer").find((p) => p.user.includes("section 2 of") && p.user.includes("in chapter 2"));
ok(
  second && second.user.includes("ALREADY ON THE PAGE") && second.user.includes("1. Ch 2 step 1") && second.user.includes("it ended on: the lamp going out") && second.user.includes("STILL TO COME"),
  "a later section is told what the chapter already wrote and what is held back"
);
const opening = of("planner").find((p) => p.user.includes("section 1 of") && p.user.includes("in chapter 2"));
ok(opening && opening.user.includes("THIS CHAPTER (ch 2 — The Boat)") && opening.user.includes("Audit of chapter 1"), "the section that opens chapter 2 is planned against its entry and chapter 1's audit");
ok(opening && opening.user.includes("The book ends with chapter 3"), "the planner knows how many chapters remain");
const lastWriter = last("writer").user;
ok(lastWriter.includes("LAST section of the book"), "the final section is told it ends the book");
const middle = of("writer").find((p) => p.user.includes("The chapter continues after it"));
ok(perChapter < 2 || Boolean(middle), "a mid-chapter section is told not to close the chapter");
ok(b.analysis && b.analysis.qualityScore != null && Object.keys(b.chapterNotes).length === 3, "the finished book got its final review and notes for every chapter");

r = await stream(`/api/books/${id}/finish/step`);
ok(r.status === 400, "no further step once the book has ended");

// ---- discarding a plan ----
const c2 = await j("POST", "/api/books", { title: "Scrap", author: "Mark", mode: "guide" });
await stream(`/api/books/${c2.data.id}/turn`, { text: "An opening." });
await j("POST", `/api/books/${c2.data.id}/finish`, { action: "plan" });
r = await j("POST", `/api/books/${c2.data.id}/finish`, { action: "cancel" });
ok(r.status === 200 && r.data.book.finish === null && !r.data.book.outline.toEnd, "discarding the plan returns to the rolling outline");
const p2 = await j("POST", "/api/books", { title: "Co-written", author: "Mark", mode: "participate" });
r = await j("POST", `/api/books/${p2.data.id}/finish`, { action: "plan" });
ok(r.status === 400 && /guide mode/.test(r.data.error), "participate-mode books are told the run is for directed books");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
