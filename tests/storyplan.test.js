import test from "node:test";
import assert from "node:assert/strict";

// Story planning: the brief (stated aims), the rolling outline, the chapter
// audit's ruling on plot holes, and the editor's desk that turns every note on
// the book into a short ranked brief for the writer. All pure, so testable
// without the model client.
const {
  clampBrief,
  briefConfirmed,
  briefProposed,
  briefBlock,
  lengthPosition,
  sanitizeOutline,
  authorOutline,
  mergeOutline,
  outlineNeedsRevision,
  outlineBlock,
  outlineEntryFor,
  normalizeAudit,
  reconcileHoles,
  dismissedHoles,
  auditBlock,
  splitPlan,
  prioritiesBlock,
  priorityKind,
} = await import("../lib/storyplan.js");

test("an empty brief is no brief; filled fields are clamped and the target length bounded", () => {
  assert.equal(clampBrief({}), null);
  assert.equal(clampBrief({ premise: "   " }), null);
  const b = clampBrief({ premise: "x".repeat(900), targetWords: "80,000", junk: "ignored" }, { confirmed: true });
  assert.equal(b.premise.length, 600);
  assert.equal(b.targetWords, 80000);
  assert.equal(b.confirmed, true);
  assert.equal(b.junk, undefined);
  assert.equal(clampBrief({ premise: "a", targetWords: 50 }).targetWords, 2000, "too-small target is raised to the floor");
});

test("only an author-confirmed brief ever reaches a prompt", () => {
  const proposal = clampBrief({ premise: "A lighthouse keeper hides a deserter." }, { confirmed: false });
  assert.equal(briefProposed(proposal), true);
  assert.equal(briefConfirmed(proposal), false);
  assert.equal(briefBlock(proposal, 5000), "", "an unconfirmed proposal produces no prompt text");
  const confirmed = clampBrief({ ...proposal, targetWords: 60000 }, { confirmed: true });
  const block = briefBlock(confirmed, 15000);
  assert.ok(block.includes("Premise: A lighthouse keeper hides a deserter."));
  assert.ok(block.includes("15,000 of a planned 60,000 words (25%)"), "states where the manuscript stands");
  assert.equal(briefBlock({ ...confirmed, dismissed: true }), "", "a dismissed brief is silent");
});

test("lengthPosition names the stretch of the book", () => {
  assert.ok(lengthPosition({ targetWords: 60000 }, 6000).includes("opening movement"));
  assert.ok(lengthPosition({ targetWords: 60000 }, 33000).includes("midpoint"));
  assert.ok(lengthPosition({ targetWords: 60000 }, 57000).includes("final stretch"));
  assert.equal(lengthPosition({ targetWords: 0 }, 5000), "");
});

test("sanitizeOutline drops broken entries, de-duplicates chapters, and sorts", () => {
  const o = sanitizeOutline({
    through: "Toward the trial.",
    chapters: [
      { num: 4, title: "B", summary: "second" },
      { num: 3, title: "A", summary: "first" },
      { num: 3, title: "dup", summary: "duplicate chapter" },
      { num: 5, title: "no summary" },
      { num: "x", summary: "bad number" },
    ],
  });
  assert.deepEqual(o.chapters.map((e) => e.num), [3, 4]);
  assert.equal(o.chapters[0].title, "A");
  assert.equal(sanitizeOutline({ chapters: [] }), null);
});

test("entries the author changes are pinned and survive an AI revision", () => {
  const ai = { ...sanitizeOutline({ chapters: [{ num: 2, title: "Arrival", summary: "She reaches the island." }, { num: 3, title: "Storm", summary: "The storm traps them." }] }), rev: 1, forChapter: 2 };
  const edited = authorOutline({ chapters: [ai.chapters[0], { ...ai.chapters[1], summary: "The storm passes; the real danger is the supply boat." }] }, ai);
  assert.equal(edited.chapters[0].pinned, false, "untouched entry stays unpinned");
  assert.equal(edited.chapters[1].pinned, true, "edited entry is pinned");
  assert.equal(edited.rev, 2);

  const merged = mergeOutline(
    { through: "T", chapters: [{ num: 2, summary: "stale — already written" }, { num: 3, summary: "AI rewrite of the storm" }, { num: 4, summary: "New chapter four." }] },
    edited,
    3
  );
  assert.deepEqual(merged.chapters.map((e) => e.num), [3, 4], "chapters already written fall away");
  assert.equal(merged.chapters[0].summary, "The storm passes; the real danger is the supply boat.", "the author's pinned entry wins");
  assert.equal(merged.chapters[1].pinned, false);
  assert.equal(merged.forChapter, 3);
  assert.equal(merged.rev, 3);
});

test("the outline is revised when the writing moves into a new chapter", () => {
  assert.equal(outlineNeedsRevision(null, 1), true);
  const o = { chapters: [{ num: 2, summary: "s" }], forChapter: 2 };
  assert.equal(outlineNeedsRevision(o, 2), false);
  assert.equal(outlineNeedsRevision(o, 3), true);
});

test("outlineBlock starts at the chapter being written and marks author entries", () => {
  const o = sanitizeOutline({ through: "Toward the trial.", chapters: [{ num: 1, summary: "done" }, { num: 2, title: "Arrival", summary: "She lands.", pinned: true }, { num: 3, summary: "Storm." }] });
  const block = outlineBlock(o, 2);
  assert.ok(!block.includes("done"), "chapters behind the writing are left out");
  assert.ok(block.includes("THIS CHAPTER (ch 2 — Arrival): She lands. [set by the author]"));
  assert.ok(block.includes("Then ch 3: Storm."));
  assert.equal(outlineEntryFor(o, 3).summary, "Storm.");
  assert.equal(outlineBlock(null, 1), "");
});

test("the audit rules on each suspected plot hole and the open list follows its ruling", () => {
  const prior = "Mara knows the code without being told\nThe key vanished after chapter 2\nTomas crosses the bay in an hour";
  const audit = normalizeAudit(
    {
      accomplished: "Mara learns the deserter's name.",
      aims: "DRIFTING — the feud is crowding out the keeper's secret",
      outline: "partly: the landing happened, the letter did not",
      position: "A quarter in; the first turn has landed.",
      carry: "- The keeper saw her read the log\n- none",
      holes: [
        { n: 1, status: "repaired", note: "she overhears it in ch 3" },
        { n: 2, status: "confirmed", note: "still unexplained" },
        { n: 3, status: "DISMISSED", note: "the tide table allows it" },
        { n: 9, status: "confirmed" },
        { n: 2, status: "bogus" },
      ],
      newHoles: ["The lamp is lit though the oil ran out", "", "x", "y", "z"],
    },
    prior
  );
  assert.equal(audit.aims.verdict, "DRIFTING");
  assert.equal(audit.aims.note, "the feud is crowding out the keeper's secret");
  assert.equal(audit.outline.verdict, "PARTLY");
  assert.equal(audit.carry, "The keeper saw her read the log", "an explicit 'none' line is dropped");
  assert.equal(audit.holes.length, 3, "out-of-range and invalid rulings are ignored");
  assert.equal(audit.newHoles.length, 3, "new holes are capped");

  const open = reconcileHoles(prior, audit).split("\n");
  assert.deepEqual(open.slice(0, 2), ["The key vanished after chapter 2", "The lamp is lit though the oil ran out"]);
  assert.ok(!open.includes("Mara knows the code without being told"), "repaired gap is gone");
  assert.ok(!open.includes("Tomas crosses the bay in an hour"), "dismissed gap is gone");
  assert.deepEqual(dismissedHoles(audit), ["Tomas crosses the bay in an hour"]);
  assert.equal(reconcileHoles(prior, null), prior, "no audit leaves the list untouched");

  const block = auditBlock({ num: 3, title: "The Log", audit });
  assert.ok(block.startsWith("Audit of chapter 3 (“The Log”)"));
  assert.ok(block.includes("Against the author's brief: DRIFTING"));
  assert.equal(normalizeAudit({}, []), null);
});

test("splitPlan separates the beats from the desk's ranked priorities and the scene tags", () => {
  const plan = [
    "WEIGHT: PIVOTAL — the confession gets the room",
    "WANT: Mara wants the name.",
    "CHANGE: trust → doubt",
    "",
    "**PRIORITIES:**",
    "1. MUST — close the gap about the code: she overhears it at the door.",
    "2) AVOID — a third lighthouse description.",
    "- KEEP — the storm setup stays open.",
    "SCENES: the_reveal, domestic_secrets",
  ].join("\n");
  const s = splitPlan(plan);
  assert.ok(s.beats.includes("WEIGHT: PIVOTAL"));
  assert.ok(!s.beats.includes("PRIORITIES"), "the ruling is not part of the beats");
  assert.ok(!s.beats.includes("SCENES"), "the scene tags are not part of the beats");
  assert.deepEqual(s.priorities, [
    "MUST — close the gap about the code: she overhears it at the door.",
    "AVOID — a third lighthouse description.",
    "KEEP — the storm setup stays open.",
  ]);
  assert.equal(s.scenes, "SCENES: the_reveal, domestic_secrets");
  assert.equal(priorityKind(s.priorities[1]), "AVOID");
});

test("a plan with no priorities leaves the old path untouched; the block is ranked and capped", () => {
  const old = splitPlan("WEIGHT: STANDARD\nWANT: a lift\nSCENES: none");
  assert.deepEqual(old.priorities, []);
  assert.equal(prioritiesBlock(old.priorities), "", "no ruling -> no block (the writer keeps its raw notes)");
  assert.equal(splitPlan("").beats, "");

  const many = splitPlan("WANT: x\nPRIORITIES:\n" + Array.from({ length: 9 }, (_, i) => `${i + 1}. MUST — item ${i + 1}`).join("\n"));
  assert.equal(many.priorities.length, 5, "never more than five lines reach the writer");
  const block = prioritiesBlock(many.priorities);
  assert.ok(block.includes("1. MUST — item 1"));
  assert.ok(block.includes("the earlier line wins"));
  assert.ok(!block.includes("item 6"));
});
