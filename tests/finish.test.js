import test from "node:test";
import assert from "node:assert/strict";

// Finish the book: the pure arithmetic and state handling behind the run — the
// outline that runs to the end, the room each chapter gets, the fallback
// section directions, and deciding where the next section goes.
const {
  OUTLINE_MAX,
  ENDGAME_MAX,
  ENDGAME_MIN,
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
  sectionPlacement,
  openSetupLines,
  criticismLines,
  liveSteerNote,
  cleanSectionReport,
  STEER_MAX,
  renumberOutline,
  moveOutlineEntry,
  sectionRecap,
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
  assert.equal(suggestedChaptersLeft({ targetWords: 60000, totalWords: 61000, avgChapterWords: 3000 }), ENDGAME_MIN, "past the target: still a real run-in");
  assert.equal(suggestedChaptersLeft({ targetWords: 60000, totalWords: 30000, avgChapterWords: 30000, sectionWords: 500 }), 8, "one long unbroken chapter does not shrink the plan");
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

test("a plan to the end keeps each chapter's overview; an author's edit drops a stale one and takes the model's next", () => {
  const withDetail = entries(1, 3).map((e) => ({ ...e, detail: `Overview ${e.num}.` }));
  const plan = sanitizeOutline({ toEnd: true, chapters: withDetail });
  assert.equal(plan.chapters[1].detail, "Overview 2.");
  assert.equal("detail" in sanitizeOutline({ chapters: entries(1, 2) }).chapters[0], false);
  const edited = authorOutline({ chapters: plan.chapters.map((e) => (e.num === 2 ? { ...e, summary: "AUTHOR: the boat comes early." } : e)) }, plan);
  assert.equal(edited.chapters[1].pinned, true);
  assert.equal(edited.chapters[1].detail, undefined, "the old overview no longer fits");
  assert.equal(edited.chapters[0].detail, "Overview 1.");
  const merged = mergeOutline({ chapters: withDetail.map((e) => ({ ...e, detail: `New overview ${e.num}.` })) }, edited, 1, { toEnd: true });
  assert.equal(merged.chapters[1].summary, "AUTHOR: the boat comes early.");
  assert.equal(merged.chapters[1].detail, "New overview 2.");
  assert.ok(/How this chapter is planned to go \(a high-level sketch[^)]*\): New overview 1\./.test(outlineBlock(merged, 1)));
  assert.ok(!outlineBlock(merged, 1).includes("New overview 2."), "only the chapter being written carries its overview into the prompt");
});

test("a section is told what its chapter already put on the page and what is held for later", () => {
  const directions = ["Mara finds the key.", "She confronts the keeper.", "He confesses.", "She burns the letter."];
  const first = sectionPlacement({ num: 4, directions, done: 0 });
  assert.ok(first.includes("section 1 of 4 in chapter 4") && !first.includes("ALREADY ON THE PAGE"));
  assert.ok(first.includes("  2. She confronts the keeper.") && first.includes("do not wrap the chapter up"));
  const recap = sectionRecap({ prompt: "Mara finds the key.", plan: "WANT: x\n**CHANGE:** trust → doubt\nENDING: the lamp going out" });
  assert.equal(recap, "Mara finds the key. — it changed: trust → doubt — it ended on: the lamp going out");
  assert.equal(sectionRecap({ prompt: "Just this." }), "Just this.");
  const third = sectionPlacement({ num: 4, directions, done: 2, landed: [recap, "She confronts the keeper."] });
  assert.ok(third.includes("ALREADY ON THE PAGE") && third.includes("  1. Mara finds the key. — it changed: trust → doubt"));
  assert.ok(third.includes("  2. She confronts the keeper.") && third.includes("STILL TO COME") && third.includes("  4. She burns the letter."));
  assert.ok(!third.includes("  3. He confesses."), "its own direction is not listed as done or as later");
  const last = sectionPlacement({ num: 4, directions, done: 3, final: true, landed: ["a", "b", "c"] });
  assert.ok(last.includes("LAST section of the book") && !last.includes("STILL TO COME"));
});

test("a section is shown what the book still has open, so it can close what its events allow", () => {
  const directions = ["a", "b"];
  assert.ok(!sectionPlacement({ num: 2, directions, done: 0 }).includes("OPENINGS"));
  const setups = openSetupLines("- the spare key under the lamp\n- the storm warning (paid off ch 3)\n- the keeper's limp ✓");
  assert.deepEqual(setups, ["the spare key under the lamp"]);
  const note = sectionPlacement({ num: 2, directions, done: 0, gaps: ["How did Mara get the key?"], setups });
  assert.ok(note.includes("OPENINGS") && note.includes("  logic gap: How did Mara get the key?") && note.includes("  planted, awaiting payoff: the spare key under the lamp"));
  assert.ok(note.includes("never by explanation or coincidence") && note.includes("leave alone anything the outline keeps for a later chapter"));
  const end = sectionPlacement({ num: 3, directions, done: 1, final: true, gaps: ["g"], landed: ["x"] });
  assert.ok(end.includes("this is its last chapter") && end.includes("  logic gap: g"));
});

test("a section is shown the editor's criticism, to answer in what happens", () => {
  const directions = ["a", "b"];
  assert.ok(!sectionPlacement({ num: 2, directions, done: 0 }).includes("HOLDING THE BOOK BACK"));
  const concerns = criticismLines("• The keeper wants nothing.\n\n- The stakes are abstract.\nnone\nThird.\nFourth.\nFifth.", 3);
  assert.deepEqual(concerns, ["The keeper wants nothing.", "The stakes are abstract.", "Third."]);
  const note = sectionPlacement({ num: 2, directions, done: 0, concerns });
  assert.ok(note.includes("HOLDING THE BOOK BACK") && note.includes("  - The keeper wants nothing.") && note.includes("  - Third."));
  assert.ok(note.includes("never by explaining it") && note.includes("One point answered properly"));
  assert.ok(note.includes("ACTION FIRST") && note.includes("Keep inner monologue to a line or two"), "every autopilot section leans on action over interior monologue");
  const end = sectionPlacement({ num: 3, directions, done: 1, final: true, concerns, landed: ["x"] });
  assert.ok(end.includes("the last chapter in which to answer it") && end.trim().endsWith(")"));
});

test("deleting or moving an outline chapter renumbers the rest and keeps each chapter's overview", () => {
  const prev = {
    toEnd: true,
    through: "t",
    chapters: [
      { id: "a", num: 5, title: "A", summary: "sa", detail: "da", pinned: false },
      { id: "b", num: 6, title: "B", summary: "sb", detail: "db", pinned: false },
      { id: "c", num: 7, title: "C", summary: "sc", detail: "dc", pinned: false },
    ],
  };
  // delete chapter 6: chapter 7 becomes 6, unpinned, overview intact
  const cut = authorOutline({ through: "t", chapters: renumberOutline([prev.chapters[0], prev.chapters[2]], 5) }, prev);
  assert.deepEqual(cut.chapters.map((e) => [e.num, e.id, e.detail, e.pinned]), [[5, "a", "da", false], [6, "c", "dc", false]]);
  assert.equal(outlineLastNum(cut), 6);
  // move chapter 7 earlier: it trades places with 6, both pinned, overviews follow
  const moved = authorOutline({ through: "t", chapters: moveOutlineEntry(prev.chapters, 2, -1, 5) }, prev);
  assert.deepEqual(moved.chapters.map((e) => [e.num, e.id, e.detail, e.pinned]), [[5, "a", "da", false], [6, "c", "dc", true], [7, "b", "db", true]]);
  // a move off either end changes nothing
  assert.deepEqual(moveOutlineEntry(prev.chapters, 0, -1, 5).map((e) => e.id), ["a", "b", "c"]);
  // an edited line still loses its overview and is pinned
  const edited = authorOutline({ through: "t", chapters: prev.chapters.map((e) => (e.id === "b" ? { ...e, summary: "new" } : e)) }, prev);
  assert.deepEqual(edited.chapters.map((e) => [e.detail || "", e.pinned]), [["da", false], ["", true], ["dc", false]]);
});

test("a live note from the author rides on the direction as a strong suggestion, not an override", () => {
  assert.equal(liveSteerNote(""), "");
  assert.equal(liveSteerNote("   \n "), "");
  const note = liveSteerNote("  Have the keeper\nlie about the boat.  ");
  assert.ok(note.includes('"Have the keeper lie about the boat."'));
  assert.ok(note.includes("strong suggestion") && note.includes("It does NOT replace the direction above") && note.includes("you are still the author"));
  assert.ok(liveSteerNote("x".repeat(5000)).length < STEER_MAX + 900);
});

test("a section report keeps its three short lines, and the suggestion line only when a note was sent", () => {
  assert.equal(cleanSectionReport(null), null);
  assert.equal(cleanSectionReport({ plot: "  ", criticism: "" }), null);
  const plain = cleanSectionReport({ suggestion: "TAKEN UP — x", plot: " Mara\nknows. ", criticism: "none answered" });
  assert.deepEqual(plain, { steer: "", suggestion: "", plot: "Mara knows.", criticism: "none answered" });
  const steered = cleanSectionReport({ suggestion: "TAKEN UP — he lies.", plot: "p".repeat(900) }, { steer: " lie about the boat " });
  assert.equal(steered.steer, "lie about the boat");
  assert.equal(steered.suggestion, "TAKEN UP — he lies.");
  assert.equal(steered.plot.length, 360);
});

test("chapter markers in a full text being edited are found with their offsets and numbers", async () => {
  const { chapterMarkers } = await import("../lib/book.js");
  const text = "Opening prose.\n\n## Chapter: The Boat\n\nMore.\n\n  ## chapter\n\nEnd. ## Chapter not a marker";
  const marks = chapterMarkers(text);
  assert.deepEqual(marks.map((m) => [m.num, m.title]), [[2, "The Boat"], [3, ""]]);
  assert.ok(text.slice(marks[0].index).startsWith("## Chapter: The Boat"));
  assert.deepEqual(chapterMarkers("## Chapter: One\n\nText.").map((m) => m.num), [1], "a marker at the very top is chapter 1");
  assert.deepEqual(chapterMarkers("No chapters here."), []);
});

test("the planners are told what kind of book this is", async () => {
  const { storyKindBlock, storyKindRule, isEroticaKind } = await import("../lib/storyplan.js");
  assert.equal(storyKindBlock({}), "");
  const spy = storyKindBlock({ genre: "Spy thriller", style: "Terse and declarative.", audience: "Audience: adults.", scenes: ["Dead drop", "Interrogation"] });
  assert.match(spy, /^WHAT KIND OF BOOK THIS IS/);
  assert.match(spy, /Genre, as the editor reads the pages: Spy thriller/);
  assert.match(spy, /The style the author chose: Terse and declarative\./);
  assert.match(spy, /come for: Dead drop; Interrogation\./);
  assert.doesNotMatch(spy, /erotica/);

  // The book's own setting counts even when the genre label says otherwise.
  assert.equal(isEroticaKind({ genre: "Literary drama", erotica: true }), true);
  assert.equal(isEroticaKind({ genre: "Erotic romance" }), true);
  assert.equal(isEroticaKind({ genre: "Spy thriller" }), false);
  assert.match(storyKindBlock({ genre: "Literary drama", erotica: true }), /set this book up as adult erotica/);

  const outline = storyKindRule({ unit: "chapter", genre: "Spy thriller" });
  assert.match(outline, /Every chapter you plan must be unmistakably a chapter of that kind of book/);
  assert.match(outline, /tradecraft/);
  assert.doesNotMatch(outline, /This book is adult erotica/);
  const chapter = storyKindRule({ unit: "section", genre: "Erotica" });
  assert.match(chapter, /at least one direction stages/);
  assert.match(chapter, /At least one direction in this chapter IS an erotic, intimate encounter/);
  assert.match(storyKindRule({ unit: "chapter", erotica: true }), /EVERY chapter includes at least one erotic, intimate encounter/);
});

test("the pairing rule rides on every audience instruction", async () => {
  const { maturityText, PAIRING_RULE } = await import("../lib/maturity.js");
  assert.match(PAIRING_RULE, /no romance, attraction, or intimate or sexual scenes between two men/);
  for (const g of [null, { adult: false }, { adult: true, sexual: 3, erotica: true, violence: 1, language: 1 }]) {
    assert.ok(maturityText(g).endsWith(PAIRING_RULE));
  }
});

test("a section that costs the book points gets one weighted rewrite", async () => {
  const { SCORE_DROP, scoreFell, keepRevision, dropRevisionNote } = await import("../lib/storyplan.js");
  assert.equal(SCORE_DROP, 5);
  assert.equal(scoreFell(71, 66), false); // exactly 5 is not "more than 5"
  assert.equal(scoreFell(71, 65), true);
  assert.equal(scoreFell(71, 80), false);
  assert.equal(scoreFell(null, 60), false);
  // The revision is kept on a tie or better, against the FIRST attempt.
  assert.equal(keepRevision(62, 62), true);
  assert.equal(keepRevision(62, 64), true);
  assert.equal(keepRevision(62, 61), false);
  assert.equal(keepRevision(62, null), false);
  const note = dropRevisionNote({ direction: "She confronts him.", critique: "No visible want.\nStakes abstract.", scoreFrom: 71, scoreTo: 62 });
  assert.match(note, /scored the book 71 before this section and 62 after/);
  assert.match(note, /"She confronts him\."/);
  assert.match(note, /criticism comes FIRST/);
  assert.match(note, /1\. No visible want\.\n2\. Stakes abstract\./);
});

test("the whole-book revision is cut into parts a model can hold", async () => {
  const { reviseParts, countWords } = await import("../lib/book.js");
  const para = (n, tag) => Array.from({ length: n }, (_, i) => `${tag}${i}`).join(" ");
  // One very long section (as an earlier revision leaves) plus a second chapter.
  const book = {
    turns: [
      { text: [para(400, "a"), para(400, "b"), para(400, "c")].join("\n\n") },
      { text: para(300, "d") },
      { text: para(100, "e") },
    ],
    chapters: [{ startTurn: 0, title: "" }, { startTurn: 1, title: "Two" }],
  };
  const parts = reviseParts(book, 900);
  assert.ok(parts.length >= 2);
  for (const p of parts) assert.ok(countWords(p.replace(/^##.*$/gm, "")) <= 900);
  // Nothing is lost or reordered; the chapter marker travels with the text.
  assert.equal(parts.join("\n\n"), [book.turns[0].text, "## Chapter: Two", book.turns[1].text, book.turns[2].text].join("\n\n"));
  // A part that is already reasonably full ends at a chapter marker.
  assert.ok(reviseParts(book, 1300)[1].startsWith("## Chapter: Two"));
  assert.deepEqual(reviseParts({ turns: [{ text: "Short." }], chapters: [] }, 900), ["Short."]);
});

test("each revision part knows the chapters around it", async () => {
  const { partChapters, revisionSurround, splitPart } = await import("../lib/book.js");
  const spans = partChapters(["one a", "one b\n\n## Chapter: Two\n\ntwo a", "two b", "## Chapter\n\nthree"]);
  assert.deepEqual(spans, [{ from: 1, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 2 }, { from: 3, to: 3 }]);
  const digest = [1, 2, 3, 4].map((num) => ({ num, title: `T${num}`, summary: `What happens in chapter ${num}.` }));
  const s = revisionSurround(digest, { from: 2, to: 2 });
  assert.equal(s.behind, "Chapter 1 — T1: What happens in chapter 1.");
  assert.equal(s.here, "Chapter 2 — T2: What happens in chapter 2.");
  assert.equal(s.ahead, "Chapter 3 — T3: What happens in chapter 3.\nChapter 4 — T4: What happens in chapter 4.");
  assert.equal(revisionSurround(digest, { from: 4, to: 4 }).ahead, "");
  assert.deepEqual(revisionSurround(null, { from: 1, to: 1 }), { behind: "", here: "", ahead: "" });
  // Long summaries are clipped to keep the outline brief.
  const long = revisionSurround([{ num: 2, title: "", summary: "word ".repeat(2000) }], { from: 1, to: 1 }, { maxChars: 600 });
  assert.ok(long.ahead.length < 700 && long.ahead.endsWith("…"));

  const w = (n, tag) => Array.from({ length: n }, (_, i) => `${tag}${i}`).join(" ");
  const halves = splitPart([w(200, "a"), w(200, "b"), "## Chapter: Two", w(200, "c")].join("\n\n"));
  assert.equal(halves.length, 2);
  assert.ok(halves[1].startsWith("## Chapter: Two") || halves[0].endsWith(w(200, "b")));
  assert.ok(!/## Chapter: Two$/.test(halves[0]));
  assert.equal(splitPart(w(900, "x")), null); // one paragraph: nothing to cut at
  assert.equal(splitPart("a\n\nb"), null); // already short
});
