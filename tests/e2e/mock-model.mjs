// A scripted stand-in for the model: an OpenAI-compatible /chat/completions
// endpoint that recognizes which of the app's prompts it is being sent, logs
// the full prompt, and answers with a canned, well-formed reply. Lets the whole
// pipeline be driven end to end and every prompt inspected.
import { createServer } from "node:http";
import { appendFileSync, writeFileSync } from "node:fs";

const LOG = process.argv[2];
const PORT = Number(process.argv[3] || 18555);
writeFileSync(LOG, "");

const kinds = [
  ["planner", /planning voice and the editor's desk/],
  ["writer", /You are the sole author of a novel/],
  ["analysis", /perceptive editor maintaining notes/],
  ["summary", /keeping the working memory/],
  ["coldread", /sharp, honest reader/],
  ["audit", /auditing ONE chapter/],
  ["outline", /keeping the ROLLING OUTLINE/],
  ["endgame", /drawing up the ENDGAME OUTLINE/],
  ["chapterplan", /Break ONE chapter of that outline/],
  ["brief", /writing the one-page brief/],
];

let n = 0;
function reply(kind, system, user) {
  n++;
  switch (kind) {
    case "planner":
      return [
        "WEIGHT: STANDARD — the exchange at the door gets the words",
        "WANT: Mara wants the keeper to admit he read the letter.",
        "OBSTACLE: He answers every question with a chore.",
        "CHANGE: trust → doubt; she stops believing him.",
        "WITHHELD: who the letter was meant for.",
        "ENDING: the lamp going out mid-sentence.",
        "CUT: the walk up the stairs.",
        "LOGIC: nothing needs bridging.",
        "PRIORITIES:",
        "1. MUST — close the gap about the key: show him pocketing it at the door.",
        "2. AVOID — another paragraph describing the lighthouse; the book has shown it twice.",
        "3. KEEP — the storm setup stays open; do not pay it off here.",
      ].join("\n");
    case "writer":
      return `Section ${n}. Mara stood at the door with the letter in her coat. "You read it," she said. The keeper went on trimming the wick. He did not look up. Somewhere below them the tide turned over on the rocks.`;
    case "analysis": {
      const first = !/Prior open logic gaps/.test(user);
      return JSON.stringify({
        style: "Plain, close third person.",
        genre: "Literary mystery",
        synopsis: "Mara finds a letter in a lighthouse and suspects the keeper.",
        quality: "A steady start with a clear question.",
        qualityScore: 71,
        critique: "The keeper has no visible want of his own yet.\nThe stakes are still abstract.",
        pacing: "TOO SLOW — lingers on the lamp room and the plot stalls",
        nextDirection: "Mara confronts the keeper about the letter.",
        suggestions: "She searches his room.\nA boat arrives early.",
        ...(first ? { holes: "Mara knows the door code without being told\nThe brass key vanished after the first scene" } : {}),
        balance: "SLACK — the walk along the shore ran long",
        motifs: "the lamp like an eye\nsalt on the glass",
        voices: "Mara: short questions.\nKeeper: answers with chores.",
        ledger: "ch 1 · the unopened letter · open\nch 1 · the storm warning · open",
        continuity: "Mara — visitor. The keeper — unnamed. The lighthouse on the north rock.",
      });
    }
    case "summary":
      return "Mara arrives at the lighthouse, finds a letter under the floorboard, and begins to suspect the keeper read it first. The chapter ends with her hiding the letter in her coat.";
    case "coldread":
      return "Confused: Nothing.\nSkimmed: the walk along the shore.\nWanted: to know who the letter is for.\nGrip: 6";
    case "audit":
      return JSON.stringify({
        accomplished: "Mara finds the letter and decides not to tell the keeper — the first lie between them.",
        aims: /The author's brief/.test(user) ? "ON COURSE — the secret is driving the chapter" : "",
        outline: /What the outline planned/.test(user) ? "PARTLY — the letter was found, the boat did not come" : "",
        position: "Early: the question is planted; the first open confrontation should come next.",
        carry: "The keeper saw her on the stairs\nShe still has the letter on her",
        holes: [
          { n: 1, status: "dismissed", note: "the code is chalked on the lintel in the second scene" },
          { n: 2, status: "confirmed", note: "never seen again" },
        ],
        newHoles: ["The lamp burns all night though the oil was said to be gone"],
      });
    case "outline": {
      const m = user.match(/The chapter now being written is chapter (\d+)/);
      const cur = m ? Number(m[1]) : 1;
      return JSON.stringify({
        through: "Mara must learn who the letter was for before the supply boat takes the keeper away.",
        chapters: [0, 1, 2, 3].map((i) => ({
          num: cur + i,
          title: ["The Wick", "The Boat", "The Log", "The Rock"][i],
          summary: [`AI plan for chapter ${cur + i}: she confronts him and he lies.`, `AI plan for chapter ${cur + i}: the boat comes early.`, `AI plan for chapter ${cur + i}: she reads the log.`, `AI plan for chapter ${cur + i}: the truth costs her the letter.`][i],
        })),
      });
    }
    case "endgame": {
      // The plan to the end: three chapters on a first plan, never past the
      // agreed last chapter on a redraw.
      const m = user.match(/The chapter now being written is chapter (\d+)/);
      const cur = m ? Number(m[1]) : 1;
      const cap = system.match(/ends the book at chapter (\d+)/);
      // A first answer that stops after the current chapter — what a weak model
      // does — so the run proves the planner asks again and gets the whole plan.
      const retried = /Your previous answer planned only/.test(user);
      const lastNum = cap ? Number(cap[1]) : retried ? cur + 2 : cur;
      const chapters = [];
      for (let k = cur; k <= lastNum; k++) {
        chapters.push({
          num: k,
          title: k === lastNum ? "The Rock" : `Endgame ${k}`,
          summary: k === lastNum ? `Endgame plan for chapter ${k}: she burns the letter and the book ends.` : `Endgame plan for chapter ${k}: the keeper's story cracks a little further.`,
        });
      }
      return JSON.stringify({ through: "Mara learns who the letter was for, and chooses to keep it.", chapters });
    }
    case "chapterplan": {
      const want = Number((user.match(/Return exactly (\d+) direction/) || [])[1] || 2);
      const num = Number((user.match(/THE CHAPTER TO BREAK DOWN — chapter (\d+)/) || [])[1] || 0);
      return JSON.stringify({ sections: Array.from({ length: want }, (_, i) => `Ch ${num} step ${i + 1}: Mara presses the keeper and something gives.`) });
    }
    case "brief":
      return JSON.stringify({
        premise: "Mara, sent to close a lighthouse, finds a letter that proves its keeper is hiding a deserter.",
        promise: "A slow, closed-room mystery where every answer costs trust.",
        ending: "She learns the truth and chooses to keep it.",
        themes: "Loyalty against duty.",
        avoid: "A chase thriller.",
        targetWords: 40000,
      });
    default:
      return "OK.";
  }
}

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (!req.url.endsWith("/chat/completions")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "mock" }] }));
    }
    const p = JSON.parse(body);
    const system = (p.messages.find((m) => m.role === "system") || {}).content || "";
    const user = p.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    const kind = (kinds.find(([, re]) => re.test(system)) || ["other"])[0];
    const text = reply(kind, system, user);
    appendFileSync(LOG, JSON.stringify({ kind, system, user, reply: text }) + "\n");
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
}).listen(PORT, "127.0.0.1", () => console.log("mock model on", PORT));
