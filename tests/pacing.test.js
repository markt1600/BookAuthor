import test from "node:test";
import assert from "node:assert/strict";

// The pacing steer is the closed loop between the analyzer's pacing verdict and
// the next section: TOO FAST -> slow the plot down, TOO SLOW -> speed it up,
// STEADY/none -> no steer (byte-identical to before). It lives in the shared,
// dependency-free craft module so it is unit-testable without the model client.
const { pacingSteer } = await import("../lib/craft.js");

test("pacingSteer tells the writer to slow the plot down when it is TOO FAST", () => {
  const out = pacingSteer({
    pacing: "TOO FAST — events pile up and scenes get no room to breathe",
  });
  assert.ok(out.startsWith("PACING STEER"), "is a pacing steer");
  assert.ok(out.includes("TOO FAST"), "names the verdict");
  assert.ok(out.includes("slow the plot DOWN"), "directs a slowdown");
  assert.ok(out.includes("events pile up and scenes get no room to breathe"), "preserves the editor's reason");
});

test("pacingSteer tells the writer to speed the plot up when it is TOO SLOW", () => {
  const out = pacingSteer({ pacing: "TOO SLOW: lingers on one conversation and the plot stalls" });
  assert.ok(out.startsWith("PACING STEER"), "is a pacing steer");
  assert.ok(out.includes("TOO SLOW"), "names the verdict");
  assert.ok(out.includes("speed the plot UP"), "directs a speedup");
  assert.ok(out.includes("lingers on one conversation and the plot stalls"), "preserves the editor's reason");
});

test("pacingSteer is case- and separator-insensitive on the label", () => {
  assert.ok(pacingSteer({ pacing: "too fast - racing through three chapters a page" }).includes("slow the plot DOWN"));
  assert.ok(pacingSteer({ pacing: "Too Slow — dragging in the middle" }).includes("speed the plot UP"));
  // The model often uses a comma after the label; the reason must come out clean.
  const comma = pacingSteer({ pacing: "TOO FAST, events pile up in a single morning without room to breathe." });
  assert.ok(comma.includes("slow the plot DOWN"), "comma-separated label still steers");
  assert.ok(comma.includes("(events pile up in a single morning"), "comma is stripped from the reason");
  assert.ok(!comma.includes("(,"), "no stray comma inside the parenthetical");
});

test("pacingSteer stays silent on STEADY so a healthy book is untouched", () => {
  assert.equal(pacingSteer({ pacing: "STEADY — momentum is on track" }), "");
});

test("pacingSteer stays silent with no analysis yet (byte-identical legacy path)", () => {
  assert.equal(pacingSteer(null), "");
  assert.equal(pacingSteer({}), "");
  assert.equal(pacingSteer({ pacing: "" }), "");
  assert.equal(pacingSteer({ pacing: "   " }), "");
});

test("pacingSteer ignores a label buried mid-sentence rather than at the front", () => {
  // Only a leading label is a verdict; "pacing feels too fast later" is a reason, not a label.
  assert.equal(pacingSteer({ pacing: "pacing feels too fast in the second half" }), "");
});