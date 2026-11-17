import test from "node:test";
import assert from "node:assert/strict";

// Finish the book: the pure arithmetic and state handling behind the run — the
// outline that runs to the end, the room each chapter gets, the fallback
// section directions, and deciding where the next section goes.
const {
  OUTLINE_MAX,
  ENDGAME_MAX,
  sanitizeOutline,
  authorOutline,
  mergeOutline,
  outlineBlock,
  outlineLastNum,
  chapterWordBudget,
  sectionsForChapter,
  suggestedChaptersLeft,
  cleanDirections,
  fallbackDirections,
  sanitizeFinish,
  nextFinishTarget,
} = await import("../lib/storyplan.js");

const entries = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => ({ num: from + i, title: `T${from + i}`, summary: `Plan ${from + i}.` }));

test("a rolling outline is capped short; an outline to the end keeps every chapter", () => {
  assert.equal(sanitizeOutline({ chapters: entries(1, 15) }).chapters.length, OUTLINE_MAX);
  const end = sanitizeOutline({ toEnd: true, chapters: entries(1, 15) });
  assert.equal(end.chapters.length, 15);
  assert.equal(end.toEnd, true);
  assert.equal(sanitizeOutline({ toEnd: true, chapters: entries(1, 40) }).chapters.length, ENDGAME_MAX);
  assert.equal(outlineLastNum(end), 15);
  assert.equal(outlineLastNum(sanitizeOutline({ chapters: entries(1, 4) })), 0, "a rolling outline does not know the last chapter");
});

test("the author's edit and a redraw both keep an outline running to the end", () => {
  const plan = sanitizeOutline({ toEnd: true, chapters: entries(3, 12) });
  const edited = authorOutline({ chapters: plan.chapters.map((e) => (e.num === 5 ? { ...e, summary: "Mine." } : e)) }, plan);
  assert.equal(edited.toEnd, true);
  assert.equal(edited.chapters.length, 10);
  assert.equal(edited.chapters.find((e) => e.num === 5).pinned, true);
  const redrawn = mergeOutline({ chapters: entries(4, 12) }, edited, 4);
  assert.equal(redrawn.toEnd, true);
  assert.equal(redrawn.chapters.length, 9);
  assert.equal(redrawn.chapters.find((e) => e.num === 5).summary, "Mine.");
  assert.equal(mergeOutline({ chapters: entries(4, 8) }, edited, 4, { toEnd: false }).toEnd, undefined);
});

test("the outline block names the final chapter and how many remain", () => {
  const plan = sanitizeOutline({ toEnd: true, through: "To the end.", chapters: entries(3, 5) });
  const mid = outlineBlock(plan, 3);
  assert.ok(mid.includes("The book ends with chapter 5 — 2 more chapters after this one"));
  assert.ok(mid.includes("Then ch 5, the FINAL chapter"));
  const fin = outlineBlock(plan, 5);
  assert.ok(fin.includes("THIS CHAPTER (ch 5, the FINAL chapter"));
  assert.ok(fin.includes("The book ENDS with this chapter"));
  assert.ok(!outlineBlock(sanitizeOutline({ chapters: entries(3, 5) }), 3).includes("FINAL"), "a rolling outline never claims an ending");
});

test("a chapter's word budget shares the brief's target, else follows the book's own chapters", () => {
  assert.equal(chapterWordBudget({ targetWords: 60000, totalWords: 40000, chaptersLeft: 8, sectionWords: 500 }), 2500);
  assert.equal(chapterWordBudget({ avgChapterWords: 3100, sectionWords: 500 }), 3100);
  assert.equal(chapterWordBudget({ sectionWords: 400 }), 1600, "no target and no history: four sections");
  assert.equal(chapterWordBudget({ targetWords: 60000, totalWords: 59900, chaptersLeft: 4, sectionWords: 500 }), 1000, "never under two sections");
  assert.equal(chapterWordBudget({ targetWords: 200000, totalWords: 0, chaptersLeft: 2, sectionWords: 500 }), 5000, "never over ten");
  assert.equal(chapterWordBudget({ targetWords: 50000, totalWords: 70000, chaptersLeft: 3, avgChapterWords: 3000, sectionWords: 500 }), 3000, "past the target: the book's own average");
});

test("sections left in a chapter follow what is already written", () => {
  assert.equal(sectionsForChapter(2500, 500, 0), 5);
  assert.equal(sectionsForChapter(2500, 500, 1000), 3);
  assert.equal(sectionsForChapter(2500, 500, 1900), 1);
  assert.equal(sectionsForChapter(2500, 500, 2200), 0, "a chapter that has had its room is closed");
  assert.equal(sectionsForChapter(900, 500, 0), 2, "a fresh chapter is at least two sections");
  assert.equal(sectionsForChapter(9000, 500, 0), 8, "and at most eight");
});

test("the chapter count to aim for comes from the target length, or is left to the story", () => {
  assert.equal(suggestedChaptersLeft({ targetWords: 0, totalWords: 20000 }), 0);
  assert.equal(suggestedChaptersLeft({ targetWords: 60000, totalWords: 30000, avgChapterWords: 3000 }), 10);
  assert.equal(suggestedChaptersLeft({ targetWords: 60000, totalWords: 61000, avgChapterWords: 3000 }), 1);
  assert.equal(suggestedChaptersLeft({ targetWords: 400000, totalWords: 0, avgChapterWords: 2000 }), ENDGAME_MAX);
});

test("a chapter breakdown is cleaned to the asked-for count; junk falls back", () => {
  assert.deepEqual(cleanDirections({ sections: ["a", " b ", "", "c"] }, 3), ["a", "b", "c"]);
  assert.deepEqual(cleanDirections({ sections: ["a", "b", "c", "end"] }, 3), ["a", "b", "end"], "extra lines are trimmed but the ending is kept");
  assert.deepEqual(cleanDirections({ sections: [{ direction: "x" }] }, 2), ["x"]);
  assert.equal(cleanDirections({ sections: [] }, 2), null);
  assert.equal(cleanDirections(null, 2), null);
  const fb = fallbackDirections({ title: "The Boat", summary: "The boat comes early." }, 3, { final: true });
  assert.equal(fb.length, 3);
  assert.ok(fb.every((d) => d.includes("The boat comes early.")));
  assert.ok(fb[0].includes("Open the chapter") && fb[1].includes("middle") && fb[2].includes("LAST section of the book"));
  assert.ok(fallbackDirections({ summary: "x" }, 1, { resumed: true })[0].includes("Bring this chapter to its close"));
});

test("the run state is normalised and survives bad input", () => {
  assert.equal(sanitizeFinish(null), null);
  const f = sanitizeFinish({ status: "nonsense", sections: "4", chapter: { num: 3, directions: ["a", "", "b"], done: 9, opens: 1, entry: "E" } });
  assert.equal(f.status, "planned");
  assert.equal(f.sections, 4);
  assert.deepEqual(f.chapter, { num: 3, directions: ["a", "b"], done: 2, opens: true, final: false, entry: "E" });
  assert.equal(sanitizeFinish({ chapter: { num: 2, directions: [] } }).chapter, null);
});

test("the next section goes where the stored breakdown says, while it still fits the page", () => {
  const summary = () => "E";
  const mid = { chapter: { num: 3, directions: ["a", "b"], done: 1, opens: false, entry: "E" } };
  assert.deepEqual(nextFinishTarget({ finish: mid, currentNum: 3, hasText: true, entrySummary: summary }), { num: 3, opens: false, reuse: true });
  // planned to OPEN chapter 4 while the page is still in chapter 3
  const opening = { chapter: { num: 4, directions: ["a", "b"], done: 0, opens: true, entry: "E" } };
  assert.deepEqual(nextFinishTarget({ finish: opening, currentNum: 3, hasText: true, entrySummary: summary }), { num: 4, opens: true, reuse: true });
});

test("a finished chapter opens the next; an edited or displaced plan is redone from the page", () => {
  const summary = () => "E";
  const done = { chapter: { num: 3, directions: ["a", "b"], done: 2, opens: false, entry: "E" } };
  assert.deepEqual(nextFinishTarget({ finish: done, currentNum: 3, hasText: true, entrySummary: summary }), { num: 4, opens: true, reuse: false });
  // the author changed the outline entry: break the chapter down again
  const mid = { chapter: { num: 3, directions: ["a", "b"], done: 1, opens: false, entry: "old" } };
  assert.deepEqual(nextFinishTarget({ finish: mid, currentNum: 3, hasText: true, chapterWords: 600, budget: 2500, entrySummary: summary }), { num: 3, opens: false, reuse: false });
  // the author opened a chapter by hand since: follow the page
  assert.deepEqual(nextFinishTarget({ finish: mid, currentNum: 5, hasText: true, chapterWords: 200, budget: 2500, entrySummary: summary }), { num: 5, opens: false, reuse: false });
  // no breakdown yet and the chapter in progress has had its room
  assert.deepEqual(nextFinishTarget({ finish: {}, currentNum: 2, hasText: true, chapterWords: 2400, budget: 2500, entrySummary: summary }), { num: 3, opens: true, reuse: false });
  // a blank book starts at chapter 1 without opening a second one
  assert.deepEqual(nextFinishTarget({ finish: {}, currentNum: 1, hasText: false, entrySummary: summary }), { num: 1, opens: false, reuse: false });
});
