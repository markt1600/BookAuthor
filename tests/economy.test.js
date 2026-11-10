import test from "node:test";
import assert from "node:assert/strict";

// Economy and proportion: the deterministic halves of "less overwriting, more
// room for the moments that matter". The beat plan's WEIGHT label sets the
// section's word budget; the overwriting lint feeds the polish pass.
const { sectionWeight, weightedTarget, lengthRule, lintOverwriting, lintProse, pacingSteer } = await import(
  "../lib/craft.js"
);

test("sectionWeight reads the planner's WEIGHT line, tolerating markdown and case", () => {
  assert.equal(sectionWeight("WEIGHT: PIVOTAL — the confession\nWANT: to be believed"), "PIVOTAL");
  assert.equal(sectionWeight("WANT: a lift\n- **WEIGHT:** connective"), "CONNECTIVE");
  assert.equal(sectionWeight("Weight — Standard"), "STANDARD");
});

test("sectionWeight defaults to STANDARD with no plan or no label", () => {
  assert.equal(sectionWeight(""), "STANDARD");
  assert.equal(sectionWeight(null), "STANDARD");
  assert.equal(sectionWeight("WANT: x\nCHANGE: the weight of the bag shifts"), "STANDARD");
  assert.equal(sectionWeight("WEIGHT: ENORMOUS"), "STANDARD");
});

test("weightedTarget gives a turning point room and shortens connective sections", () => {
  assert.equal(weightedTarget(500, "STANDARD"), 500);
  assert.ok(weightedTarget(500, "PIVOTAL") > 600);
  assert.ok(weightedTarget(500, "CONNECTIVE") <= 300);
  // A small section is never shrunk to nothing, and never grown by CONNECTIVE.
  assert.equal(weightedTarget(150, "CONNECTIVE"), 100);
  assert.equal(weightedTarget(60, "CONNECTIVE"), 60);
});

test("lengthRule is a ceiling, not a quota, and names the weighted budget", () => {
  const std = lengthRule(500, "STANDARD");
  assert.ok(std.includes("500") && /ceiling, not a quota/.test(std));
  const piv = lengthRule(500, "PIVOTAL");
  assert.ok(piv.includes(String(weightedTarget(500, "PIVOTAL"))) && /turning point/.test(piv));
  const con = lengthRule(500, "CONNECTIVE");
  assert.ok(con.includes("no more than") && con.includes(String(weightedTarget(500, "CONNECTIVE"))));
});

test("lintOverwriting flags stacked similes, filtered perception, and a scenic opening", () => {
  const scenic =
    "The sky over the town was grey and the light fell across the street in sheets, and the wind moved through the trees along the river, while the cold air settled on every window and wall of the house that morning and stayed there.";
  const body =
    "She saw the door was open. He felt the cold on his neck. She seemed to hesitate. He began to speak like a man underwater. She noticed the cup on the sill. It was as if nothing had happened. He heard the clock like a hammer. ".repeat(
      3
    );
  const out = lintOverwriting(`${scenic}\n\n${body}`);
  assert.ok(out.some((f) => /similes/.test(f)), "similes");
  assert.ok(out.some((f) => /filtered or hedged/.test(f)), "filters");
  assert.ok(out.some((f) => /scene-setting/.test(f)), "scenic opening");
  // …and the findings reach the polish pass through the main linter.
  assert.ok(lintProse(`${scenic}\n\n${body}`).some((f) => /similes/.test(f)));
});

test("lintOverwriting leaves spare prose alone", () => {
  const spare =
    "He set two cups on the table. She kept her coat on. Outside, someone was scraping ice off a windshield. The coffee was too hot to drink. ".repeat(
      8
    );
  assert.deepEqual(lintOverwriting(spare), []);
  assert.deepEqual(lintOverwriting("Too short to judge."), []);
});

test("a TOO FAST steer deepens the scene instead of adding description", () => {
  const out = pacingSteer({ pacing: "TOO FAST — the confrontation is over in two lines" });
  assert.ok(/beat by beat/.test(out));
  assert.ok(/Do NOT slow it with scenery/.test(out));
  assert.ok(!/add texture/.test(out));
});

test("a TOO SLOW steer still protects the turning point", () => {
  const out = pacingSteer({ pacing: "TOO SLOW — two sections of travel" });
  assert.ok(/compress/.test(out) && /turning point, it still gets its full scene/.test(out));
});
