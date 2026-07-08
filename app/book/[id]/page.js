"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { countWords, isUsersMove, totalWords, fullTextWithChapters, segmentQuotes, LARGE_PAGE_SCALE, STYLE_PROFILE } from "@/lib/book";
import { lintProse } from "@/lib/craft";
import SettingsDrawer from "@/components/SettingsDrawer";
import ChaptersDrawer from "@/components/ChaptersDrawer";
import HistoryDrawer from "@/components/HistoryDrawer";
import ArcDrawer from "@/components/ArcDrawer";
import { diffWords } from "diff";
import ShareDrawer from "@/components/ShareDrawer";
import CastDrawer from "@/components/CastDrawer";
import AudiobookDrawer from "@/components/AudiobookDrawer";

/* physical page geometry (px @96dpi) — real trim sizes */
const PAGE_GEOM = {
  portrait: { w: 576, h: 864, padX: 62, padY: 70 }, // 6 × 9 in
  square: { w: 672, h: 672, padX: 64, padY: 64 }, //   7 × 7 in
  landscape: { w: 792, h: 528, padX: 76, padY: 58 }, // 8.25 × 5.5 in
};

const FONT = {
  serif: '"Spectral", Georgia, serif',
  sans: '"Inter", system-ui, sans-serif',
  mono: '"Spline Sans Mono", monospace',
  storybook: '"Sorts Mill Goudy", Georgia, serif',
  cursive: '"Dancing Script", "Segoe Script", cursive',
};

const LINE_H = 1.62;

/* must match the .ink-run--ai box in globals.css (border-box):
   padding 14×18, 1px border all sides */
const AI_PAD_X = 18;
const AI_PAD_Y = 14;
const AI_BORDER = 1;
const AI_HRED = AI_PAD_X * 2 + AI_BORDER * 2; // width the AI text loses
const AI_VCHROME = AI_PAD_Y * 2 + AI_BORDER * 2; // height the AI box adds

function authorName(author, bookAuthor) {
  if (author === "user") return bookAuthor?.trim() || "You";
  return "AI Author";
}

// Whether an audit finding's verbatim quote can actually be located in the text
// (the model occasionally paraphrases despite instructions — hide dead links).
const normQuote = (s) =>
  String(s).replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
function jumpableQuote(book, quote) {
  const q = normQuote(quote);
  if (!q) return false;
  return (book.turns || []).some((t) => normQuote(t.text).includes(q));
}

/* ---- notes-panel mini charts (single series — the card heading names it, so
   no legend). Mark color #ba8c3c is the brand brass snapped into the validated
   dark-surface band; text wears ink tokens, never the series color. ---- */

function ScoreChart({ history }) {
  const W = 260,
    H = 88,
    padL = 22,
    padR = 30,
    padT = 8,
    padB = 10;
  const iw = W - padL - padR,
    ih = H - padT - padB;
  const n = history.length;
  const x = (i) => padL + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (s) => padT + (1 - Math.max(0, Math.min(100, s)) / 100) * ih;
  const pts = history.map((h, i) => [x(i), y(h.score)]);
  const path = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
  const last = history[n - 1];
  return (
    <svg
      className="mini-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Quality score over time: currently ${last.score} of 100, across ${n} readings.`}
    >
      {[50, 75, 90].map((g) => (
        <g key={g}>
          <line x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} className="mc-grid" />
          <text x={padL - 4} y={y(g) + 2.5} className="mc-tick" textAnchor="end">
            {g}
          </text>
        </g>
      ))}
      <path d={path} className="mc-line" />
      {pts.map(([px, py], i) => (
        <g key={i}>
          {(n <= 28 || i === n - 1) && (
            <circle cx={px} cy={py} r={i === n - 1 ? 3.5 : 2.2} className="mc-dot" />
          )}
          {/* oversized invisible hit target so hover works on a 2px line */}
          <circle cx={px} cy={py} r={9} fill="transparent">
            <title>
              {`After ${history[i].sections} section${history[i].sections === 1 ? "" : "s"} · score ${history[i].score}/100 · ${(history[i].words || 0).toLocaleString()} words`}
            </title>
          </circle>
        </g>
      ))}
      <text x={Math.min(pts[n - 1][0] + 6, W - 2)} y={pts[n - 1][1] + 3.5} className="mc-value">
        {last.score}
      </text>
    </svg>
  );
}

/* bars with a rounded data-end, flat at the baseline */
function roundedTopBar(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

function PacingBars({ rows }) {
  const W = 260,
    H = 72,
    padL = 6,
    padR = 6,
    padT = 6,
    padB = 13;
  const iw = W - padL - padR,
    ih = H - padT - padB;
  const n = rows.length;
  const gap = 2;
  const bw = Math.max(3, (iw - gap * (n - 1)) / n);
  const max = Math.max(1, ...rows.map((r) => r.words));
  return (
    <svg
      className="mini-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Words per chapter across ${n} chapters; the longest has ${max.toLocaleString()} words.`}
    >
      {rows.map((r, i) => {
        const h = Math.max(1.5, (r.words / max) * ih);
        const bx = padL + i * (bw + gap);
        const by = padT + (ih - h);
        return (
          <g key={i}>
            <path d={roundedTopBar(bx, by, bw, h, 2)} className="mc-bar" />
            <rect x={bx - gap / 2} y={0} width={bw + gap} height={H - padB} fill="transparent">
              <title>{`Chapter ${i + 1}${r.title ? ` — ${r.title}` : ""} · ${r.words.toLocaleString()} words`}</title>
            </rect>
            {(n <= 12 || i === 0 || i === n - 1) && (
              <text x={bx + bw / 2} y={H - 3} className="mc-tick" textAnchor="middle">
                {i + 1}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* word-reveal for the freshly-written animation */
function RevealParagraph({ text, delayStart, perWord, onWordCount }) {
  const tokens = text.split(/(\s+)/);
  let wi = delayStart;
  const nodes = tokens.map((tok, i) => {
    if (/^\s+$/.test(tok)) return tok;
    const delay = wi * perWord;
    wi += 1;
    return (
      <span key={i} className="rw" style={{ animationDelay: `${delay}ms` }}>
        {tok}
      </span>
    );
  });
  if (onWordCount) onWordCount(wi);
  return <p className="rw-p">{nodes}</p>;
}

export default function BookStudio() {
  const params = useParams();
  const id = params.id;

  const [book, setBook] = useState(null);
  const [status, setStatus] = useState("loading");
  const [lockTitle, setLockTitle] = useState("");
  const [unlockPw, setUnlockPw] = useState("");
  const [unlockErr, setUnlockErr] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [draft, setDraft] = useState("");
  const [generating, setGenerating] = useState(false);
  const [autoPilot, setAutoPilot] = useState(false); // guide: keep writing after this direction
  const [autoCount, setAutoCount] = useState(3); // 1..5 sections per autopilot run
  const [autoLeft, setAutoLeft] = useState(0); // sections still to write in the running batch
  const autoStopRef = useRef(false); // set to finish the current section and stop
  const [streamText, setStreamText] = useState(""); // live prose as it's written
  const [streamPhase, setStreamPhase] = useState("idle"); // 'idle' | 'writing' | 'finalizing'
  const [notesRefreshing, setNotesRefreshing] = useState(false); // notes re-reading after a section lands
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false); // mobile: expand the secondary action row
  const [banner, setBanner] = useState("");
  const [doneSuggestions, setDoneSuggestions] = useState([]); // headings the AI thinks are achieved (awaiting one-tap confirm)
  const [revising, setRevising] = useState(false); // fork-and-revise in progress
  const [reviseText, setReviseText] = useState(""); // live rewritten manuscript
  const [reviseErr, setReviseErr] = useState("");
  const [reviseProgress, setReviseProgress] = useState(null); // {done,total} across chunks
  const [reviseSource, setReviseSource] = useState(""); // original prose of the current chunk (for diff)
  const [reviseDiff, setReviseDiff] = useState(true); // show changes (diff) vs clean view
  const [reviseDiffSnap, setReviseDiffSnap] = useState(""); // throttled new-text snapshot for diffing
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [arcOpen, setArcOpen] = useState(false);
  const [rewriteFor, setRewriteFor] = useState(null); // { id, text } — passage open in the workbench
  const [rewriteText, setRewriteText] = useState(""); // the instruction being typed
  const [rewriteMode, setRewriteMode] = useState("ai"); // 'ai' | 'manual'
  const [rewriteLen, setRewriteLen] = useState("same"); // 'shorter' | 'same' | 'longer'
  const [rewriteScope, setRewriteScope] = useState("light"); // 'light' | 'free'
  const [rewriteManual, setRewriteManual] = useState(""); // hand-edited passage text
  const [manualSaving, setManualSaving] = useState(false);
  const [castOpen, setCastOpen] = useState(false);
  const [audiobookOpen, setAudiobookOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false); // search & bookmarks drawer
  const [findQuery, setFindQuery] = useState("");
  const [bookmarks, setBookmarks] = useState([]); // { id, turnId, snippet, at } — this device only
  const [splitFor, setSplitFor] = useState(null); // { id, paras } — passage awaiting a chapter split
  const [splitPara, setSplitPara] = useState(0);
  const [splitTitle, setSplitTitle] = useState("");
  const [splitSaving, setSplitSaving] = useState(false);
  const [auditBusy, setAuditBusy] = useState(false);
  const [audit, setAudit] = useState(null); // { findings, at } from the last consistency check
  const [auditErr, setAuditErr] = useState("");
  const [bibleEditing, setBibleEditing] = useState(false); // author's canon editor open
  const [bibleDraft, setBibleDraft] = useState("");
  const [bibleSaving, setBibleSaving] = useState(false);
  const [newChapter, setNewChapter] = useState(false);
  const [composing, setComposing] = useState(false); // intent to be on the composer, robust to page-count shifts
  const [nav, setNav] = useState(null); // 'next' | 'prev' | null — page-turn direction
  const [copied, setCopied] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  const [pages, setPages] = useState([]); // [[run,...], ...]
  const [turnStart, setTurnStart] = useState({}); // turnId -> page index
  const [scale, setScale] = useState(1);
  const [box, setBox] = useState({ w: 0, h: 0 }); // available area on mobile (responsive geometry)
  const [fontsReady, setFontsReady] = useState(false);
  const [animTurn, setAnimTurn] = useState(null);

  const [reading, setReading] = useState(false); // read-aloud active
  const [ttsBusy, setTtsBusy] = useState(false); // fetching audio
  const [speed, setSpeed] = useState(1); // playback rate
  const [voiceMode, setVoiceMode] = useState("natural"); // 'natural' (ElevenLabs) | 'device' (Web Speech)
  const [fullEditOpen, setFullEditOpen] = useState(false);
  const [fullEditText, setFullEditText] = useState("");
  const [fullEditSaving, setFullEditSaving] = useState(false);
  const audioElRef = useRef(null);
  const readingRef = useRef(false);
  const readIdxRef = useRef(0);
  const speedRef = useRef(1);
  const voiceModeRef = useRef("natural");
  const deviceVoiceRef = useRef(null);
  const deviceUttRef = useRef(null);
  const audioCacheRef = useRef(new Map()); // pageIndex -> object URL

  const textareaRef = useRef(null);
  const measureRef = useRef(null);
  const vpRef = useRef(null);
  const stageRef = useRef(null);
  const editScrimRef = useRef(null);
  const liveRef = useRef(null);
  const pendingJump = useRef(null);
  const seenDoneRef = useRef(new Set()); // heading ids already surfaced as "looks achieved"
  const reviseScrollRef = useRef(null);
  const lastDiffRef = useRef(0);

  // Keep the revision view pinned to the newest text as it streams in.
  useEffect(() => {
    const el = reviseScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [reviseText]);

  // Throttle the new-text snapshot used for the live diff (~5x/sec) so diffing
  // doesn't run on every streamed token.
  useEffect(() => {
    if (!revising || !reviseDiff) return;
    const wait = Math.max(0, 200 - (Date.now() - lastDiffRef.current));
    const t = setTimeout(() => {
      lastDiffRef.current = Date.now();
      setReviseDiffSnap(reviseText);
    }, wait);
    return () => clearTimeout(t);
  }, [reviseText, revising, reviseDiff]);

  // Word-level diff of the original chunk vs the rewritten-so-far text.
  const reviseDiffHtml = useMemo(() => {
    if (!reviseDiff || !reviseSource) return null;
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const stripMarkers = (t) =>
      String(t || "")
        .replace(/^[ \t]*##[ \t]+chapter\b.*$/gim, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    try {
      const parts = diffWords(reviseSource, stripMarkers(reviseDiffSnap));
      return parts
        .map((p) => {
          const cls = p.added ? "d-ins" : p.removed ? "d-del" : "d-eq";
          return `<span class="${cls}">${esc(p.value)}</span>`;
        })
        .join("");
    } catch {
      return null;
    }
  }, [reviseDiff, reviseSource, reviseDiffSnap]);

  // Surface newly-suggested-done headings as a one-tap confirm (never auto-removed).
  useEffect(() => {
    const ids = (book && book.analysis && book.analysis.arcDoneIds) || [];
    const arc = (book && book.arc) || [];
    if (!ids.length || !arc.length) return;
    const fresh = ids.filter((id) => !seenDoneRef.current.has(id) && arc.some((h) => h.id === id));
    if (!fresh.length) return;
    fresh.forEach((id) => seenDoneRef.current.add(id));
    const items = arc.filter((h) => fresh.includes(h.id)).map((h) => ({ id: h.id, text: h.text }));
    setDoneSuggestions((prev) => [...prev.filter((p) => arc.some((h) => h.id === p.id)), ...items]);
  }, [book]);

  // The suggestion prompt fades on its own; the same control also lives in the notes.
  useEffect(() => {
    if (!doneSuggestions.length) return;
    const t = setTimeout(() => setDoneSuggestions([]), 14000);
    return () => clearTimeout(t);
  }, [doneSuggestions]);

  // An ended book has no composer — leave it if the book was just finished.
  useEffect(() => {
    if (book && book.ended && composing) setComposing(false);
  }, [book, composing]);

  // Escape closes the inline overlays (find drawer, chapter-split dialog).
  useEffect(() => {
    if (!findOpen && !splitFor) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        setFindOpen(false);
        setSplitFor(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [findOpen, splitFor]);
  const prefilledRef = useRef(null); // guide mode: the last-turn id we've pre-filled a suggestion for

  // Blank guide book with an author style (Hemingway / Murakami / Burdett):
  // ask the model for a suggested opening idea in that author's territory
  // (honoring the maturity settings) and pre-fill the composer with it. A
  // style/maturity change on a still-blank book fetches a fresh idea, which
  // replaces the old suggestion only if the director hasn't edited it.
  const [openingSuggestion, setOpeningSuggestion] = useState("");
  const openingKeyRef = useRef(""); // the guide settings the current fetch was made for
  const openingPrevRef = useRef("");
  useEffect(() => {
    if (!book || book.mode !== "guide" || (book.turns || []).length || book.ended) return;
    const g = book.guide || {};
    if (!STYLE_PROFILE[g.style]) return;
    const key = [g.style, g.adult, g.violence, g.sexual, g.language, g.erotica].join("|");
    if (openingKeyRef.current === key) return;
    openingKeyRef.current = key;
    (async () => {
      try {
        const res = await fetch(`/api/books/${id}/suggest-opening`, { method: "POST" });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || !d.suggestion) throw new Error("no suggestion");
        if (openingKeyRef.current !== key) return; // settings changed again mid-flight
        const prev = openingPrevRef.current;
        openingPrevRef.current = d.suggestion;
        setOpeningSuggestion(d.suggestion);
        // Fill an empty composer, or replace a prior suggestion left untouched —
        // never clobber words the director typed themselves.
        setDraft((cur) => (!cur.trim() || cur.trim() === prev.trim() ? d.suggestion : cur));
      } catch {
        if (openingKeyRef.current === key) openingKeyRef.current = ""; // allow a retry
      }
    })();
  }, [book, id]);

  // ---- load ----
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/books/${id}`);
        if (res.status === 404) return alive && setStatus("notfound");
        if (res.status === 401) {
          const d = await res.json().catch(() => ({}));
          if (!alive) return;
          if (d && d.locked) {
            setLockTitle(d.title || "");
            return setStatus("locked");
          }
          return setStatus("error");
        }
        if (!res.ok) return alive && setStatus("error");
        const { book } = await res.json();
        if (!alive) return;
        setBook(book);
        setStatus("ready");
      } catch {
        if (alive) setStatus("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  // ---- wait for webfonts so measurement is accurate ----
  useEffect(() => {
    let alive = true;
    if (typeof document !== "undefined" && document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => alive && setFontsReady(true));
    } else {
      setFontsReady(true);
    }
    return () => {
      alive = false;
    };
  }, []);

  // ---- detect a phone / narrow viewport and adapt the layout ----
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 900px)");
    const update = () => setIsMobile(mq.matches);
    update();
    if (mq.addEventListener) mq.addEventListener("change", update);
    else mq.addListener(update);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", update);
      else mq.removeListener(update);
    };
  }, []);

  const s = book?.settings;
  // Desktop uses fixed book-trim geometry and scales it to fit. Mobile instead
  // paginates to the actual screen area (full text size, no shrinking).
  // "Larger page" enlarges the desktop trim (and its margins) while the font
  // size stays put, so more words flow onto each page. It's a no-op on mobile,
  // where the page already fills the screen.
  const rawGeom = (s && PAGE_GEOM[s.format]) || PAGE_GEOM.portrait;
  const baseGeom =
    s && s.largePage
      ? {
          w: Math.round(rawGeom.w * LARGE_PAGE_SCALE),
          h: Math.round(rawGeom.h * LARGE_PAGE_SCALE),
          padX: Math.round(rawGeom.padX * LARGE_PAGE_SCALE),
          padY: Math.round(rawGeom.padY * LARGE_PAGE_SCALE),
        }
      : rawGeom;
  const geom =
    isMobile && box.w > 0 && box.h > 0
      ? { w: box.w, h: box.h, padX: Math.round(Math.min(28, Math.max(16, box.w * 0.06))), padY: 24 }
      : baseGeom;
  const contentW = geom.w - geom.padX * 2;
  const contentH = geom.h - geom.padY * 2 - 26; // leave room for the folio
  const fontFamily = (s && FONT[s.font]) || FONT.serif;
  const paraGap = s ? Math.round(s.fontSize * 0.95) : 16;
  const quoteIndent = s ? Math.round(s.fontSize * 1.5) : 28; // left indent for ">" block quotes

  // ---- paginate: flow the manuscript into fixed-height pages, box-aware ----
  useEffect(() => {
    if (!book || !measureRef.current) return;
    const m = measureRef.current;
    const measure = (t, w) => {
      m.style.width = `${w}px`;
      m.textContent = t;
      return m.offsetHeight;
    };
    const boxed = (turn) => turn.author === "claude" && !guideMode && !turn.merged;
    const widthFor = (turn) => (boxed(turn) ? contentW - AI_HRED : contentW);
    const oneLine = s.fontSize * LINE_H;

    // chapter breaks, keyed by the turn index they begin at
    const chapterByStart = {};
    (book.chapters || []).forEach((c, i) => {
      chapterByStart[c.startTurn] = { num: i + 1, title: c.title || "" };
    });
    const headFont = Math.round(s.fontSize * 1.7);
    const measureHead = (title) => {
      m.style.width = `${contentW}px`;
      const pf = m.style.fontSize;
      m.style.fontSize = `${headFont}px`;
      m.textContent = title && title.trim() ? title : "Untitled";
      const th = m.offsetHeight;
      m.style.fontSize = pf;
      // title (measured larger than it renders) + eyebrow + rule + generous margins
      return th + Math.round(s.fontSize * 1.1) + 2 + paraGap * 3;
    };

    const out = [];
    const starts = {};
    const tabShown = new Set();
    let runs = []; // current page: [{author,turnId,turnStart,paras:[]} | {type:'chapter',...}]
    let base = 0; // exact rendered height of committed content on this page
    const flush = () => {
      if (runs.length) out.push(runs);
      runs = [];
      base = 0;
    };
    const place = (turn, text, isNewRun) => {
      if (isNewRun) {
        const ts = !tabShown.has(turn.id);
        if (ts) tabShown.add(turn.id);
        runs.push({ author: turn.author, turnId: turn.id, turnStart: ts, merged: turn.merged, paras: [text] });
      } else {
        runs[runs.length - 1].paras.push(text);
      }
    };

    let guard = 0;
    for (let ti = 0; ti < book.turns.length; ti++) {
      const turn = book.turns[ti];
      if (chapterByStart[ti]) {
        flush(); // chapters open on a fresh page, like a printed book
        const ch = chapterByStart[ti];
        runs.push({ type: "chapter", num: ch.num, title: ch.title });
        base += measureHead(ch.title);
      }
      const paras = segmentQuotes(turn.text);
      if (!paras.length) paras.push({ text: "", quote: false });
      let firstOfTurn = true;
      starts[turn.id] = out.length;
      for (let pi = 0; pi < paras.length; pi++) {
        const quote = paras[pi].quote;
        let text = paras[pi].text;
        while (true) {
          if (++guard > 2e6) throw new Error("pagination loop");
          const last = runs[runs.length - 1];
          const extend = last && last.author === turn.author && last.turnId === turn.id;
          const gapPart = extend ? paraGap : runs.length > 0 ? paraGap : 0;
          const chrome = !extend && boxed(turn) ? AI_VCHROME : 0;
          const fixed = gapPart + chrome;
          const w = widthFor(turn) - (quote ? quoteIndent : 0);
          const availText = contentH - base - fixed;

          if (availText < oneLine && runs.length > 0) {
            flush();
            if (firstOfTurn) starts[turn.id] = out.length;
            continue;
          }
          const fullH = measure(text, w);
          if (fullH <= availText) {
            place(turn, { text, quote }, !extend);
            base += fixed + fullH;
            firstOfTurn = false;
            break;
          }
          // split the paragraph by words to fill the remaining space
          const words = text.split(/\s+/);
          let lo = 1,
            hi = words.length,
            best = 0;
          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (measure(words.slice(0, mid).join(" "), w) <= availText) {
              best = mid;
              lo = mid + 1;
            } else hi = mid - 1;
          }
          if (best === 0) {
            if (runs.length > 0) {
              flush();
              if (firstOfTurn) starts[turn.id] = out.length;
              continue;
            }
            best = 1; // degenerate: force a word so we always progress
          }
          const head = words.slice(0, best).join(" ");
          place(turn, { text: head, quote }, !extend);
          base += fixed + measure(head, w);
          firstOfTurn = false;
          flush();
          text = words.slice(best).join(" ");
        }
      }
    }
    if (book.ended && book.turns.length) {
      // "The End" sits after the last turn, on a fresh page if it won't fit.
      const endH = Math.round(s.fontSize * 1.6) + paraGap * 4;
      if (base + endH > contentH && runs.length > 0) flush();
      runs.push({ type: "end" });
      base += endH;
    }
    flush();

    setPages(out);
    setTurnStart(starts);
    if (pendingJump.current != null) {
      const target = starts[pendingJump.current];
      if (target != null) {
        setComposing(false); // the new section is a reading page, not the composer
        setCurrentPage(target);
        pendingJump.current = null; // only clear once we've actually landed the jump
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, fontsReady, s?.font, s?.fontSize, s?.format, contentW, contentH]);

  // ---- fit the page to the viewport ----
  // Desktop: scale the fixed book-trim page down to fit the width.
  // Mobile: measure the available area and paginate to it (full text size).
  useLayoutEffect(() => {
    const measure = () => {
      const el = vpRef.current;
      if (!el) return;
      if (isMobile) {
        const w = Math.max(260, Math.round(el.clientWidth));
        const h = Math.max(340, Math.round(el.clientHeight));
        setScale(1);
        setBox((prev) => (Math.abs(prev.w - w) > 4 || Math.abs(prev.h - h) > 6 ? { w, h } : prev));
      } else {
        const avail = el.clientWidth - 10;
        setScale(Math.max(0.3, Math.min(1, avail / baseGeom.w)));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (vpRef.current) ro.observe(vpRef.current);
    let vv = null;
    if (isMobile && typeof window !== "undefined" && window.visualViewport) {
      vv = window.visualViewport;
      vv.addEventListener("resize", measure);
    }
    return () => {
      ro.disconnect();
      if (vv) vv.removeEventListener("resize", measure);
    };
  }, [isMobile, baseGeom.w, status]);

  // ---- keep the mobile layout sized to the visible viewport (handles the
  //      on-screen keyboard, which shrinks the visual viewport) ----
  useEffect(() => {
    if (!isMobile || typeof window === "undefined") return;
    const setH = () => {
      const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
      document.documentElement.style.setProperty("--app-h", `${Math.round(vh)}px`);
    };
    setH();
    window.addEventListener("resize", setH);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", setH);
    return () => {
      window.removeEventListener("resize", setH);
      if (window.visualViewport) window.visualViewport.removeEventListener("resize", setH);
      document.documentElement.style.removeProperty("--app-h");
    };
  }, [isMobile]);

  // Pin the full-text editor to the *visual* viewport on mobile so the footer
  // (Save) stays above the on-screen keyboard. iOS positions fixed elements
  // against the layout viewport, which doesn't shrink for the keyboard, so we
  // size/position the overlay from window.visualViewport directly.
  useEffect(() => {
    if (!fullEditOpen || !isMobile || typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;
    const fit = () => {
      const el = editScrimRef.current;
      if (!el) return;
      el.style.position = "fixed";
      el.style.top = `${vv.offsetTop}px`;
      el.style.left = `${vv.offsetLeft}px`;
      el.style.right = "auto";
      el.style.bottom = "auto";
      el.style.width = `${vv.width}px`;
      el.style.height = `${vv.height}px`;
    };
    fit();
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    return () => {
      vv.removeEventListener("resize", fit);
      vv.removeEventListener("scroll", fit);
      const el = editScrimRef.current;
      if (el) {
        el.style.top = el.style.left = el.style.right = el.style.bottom = "";
        el.style.width = el.style.height = el.style.position = "";
      }
    };
  }, [fullEditOpen, isMobile]);

  // ---- draft persistence ----
  // Keyed on the *last turn's id* (unique, never reused) rather than the turn
  // count — the count repeats after edits/regenerations/restores, which would
  // otherwise resurface a stale draft from an earlier book state.
  const lastTurnId = book && book.turns.length ? book.turns[book.turns.length - 1].id : "start";
  const draftKey = book ? `loom-draft-${id}-${lastTurnId}` : null;
  useEffect(() => {
    if (!draftKey) return;
    try {
      const saved = window.localStorage.getItem(draftKey);
      if (saved != null) setDraft(saved);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  useEffect(() => {
    if (!draftKey) return;
    try {
      if (draft) window.localStorage.setItem(draftKey, draft);
      else window.localStorage.removeItem(draftKey);
    } catch {}
  }, [draft, draftKey]);

  const usersMove = book ? isUsersMove(book) : true;
  const guideMode = book ? book.mode === "guide" : false;
  const writingIndex = pages.length;
  const pageCount = pages.length + (usersMove && !book?.ended ? 1 : 0);
  // Whether the composer is showing. Driven by an explicit `composing` intent
  // (not `currentPage >= writingIndex`): on mobile the composer's index shifts
  // when the keyboard opens and re-paginates, so a fixed currentPage would stop
  // pointing at it and snap back to a reading page. A brand-new book with no
  // sections always opens on the composer.
  const onWritingPage = usersMove && !book?.ended && (pages.length === 0 || composing);
  // On mobile, the composer scrolls (textarea + commit button in flow) instead
  // of pinning the button in the dock, where the keyboard would crowd it.
  const onComposerMobile = isMobile && onWritingPage;
  // Highest page reachable by next/prev/swipe. In guide mode the blank composer
  // is excluded — it's reached only via "Direct the next section" — unless it's
  // the only page (a brand-new book with no sections yet).
  const navMax = guideMode ? (pages.length === 0 ? 0 : pages.length - 1) : pageCount - 1;
  // Fast-nav (skip 10 / jump to ends) only earns its place on longer books.
  const showFastNav = navMax >= 10;
  const lastTurn = book && book.turns.length ? book.turns[book.turns.length - 1] : null;
  const canRegenerate =
    !generating && !!lastTurn && lastTurn.author === "claude" && (!guideMode || !!lastTurn.prompt);

  useEffect(() => {
    if (currentPage > pageCount - 1) setCurrentPage(Math.max(0, pageCount - 1));
    if (currentPage < 0) setCurrentPage(0);
  }, [pageCount, currentPage]);

  // While composing, keep currentPage pinned to the (possibly shifting) composer
  // index so the folio and back-navigation stay correct as pages re-flow.
  useEffect(() => {
    if (composing && currentPage !== writingIndex) setCurrentPage(writingIndex);
  }, [composing, writingIndex, currentPage]);

  useEffect(() => {
    if (animTurn == null) return;
    const t = setTimeout(() => setAnimTurn(null), 1600);
    return () => clearTimeout(t);
  }, [animTurn]);

  // keep the live, streaming prose scrolled to its newest line
  useEffect(() => {
    if (liveRef.current) liveRef.current.scrollTop = liveRef.current.scrollHeight;
  }, [streamText]);

  const draftWords = useMemo(() => countWords(draft), [draft]);
  const committedWords = book ? totalWords(book) : 0;

  // Mechanical tell-scan of the latest AI section, for the notes readout.
  const lastAiText = useMemo(() => {
    const turns = (book && book.turns) || [];
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].author === "claude" && turns[i].text) return turns[i].text;
    }
    return "";
  }, [book]);
  const proseTells = useMemo(() => (lastAiText ? lintProse(lastAiText) : []), [lastAiText]);

  // ---- bookmarks: device-local, anchored to turn ids (stable across edits) ----
  const bmKey = `loom-bookmarks-${id}`;
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(bmKey);
      if (raw) setBookmarks(JSON.parse(raw));
    } catch {}
  }, [bmKey]);
  useEffect(() => {
    try {
      if (bookmarks.length) window.localStorage.setItem(bmKey, JSON.stringify(bookmarks));
      else window.localStorage.removeItem(bmKey);
    } catch {}
  }, [bookmarks, bmKey]);
  // Drop bookmarks whose passage no longer exists (forks, restores).
  useEffect(() => {
    if (!book) return;
    const ids = new Set((book.turns || []).map((t) => t.id));
    setBookmarks((prev) => (prev.some((b) => !ids.has(b.turnId)) ? prev.filter((b) => ids.has(b.turnId)) : prev));
  }, [book]);

  // Full-book search over the PAGINATED text, so results jump to exact pages.
  const searchResults = useMemo(() => {
    const q = findQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const out = [];
    for (let pi = 0; pi < pages.length; pi++) {
      for (const run of pages[pi]) {
        if (!run.paras) continue;
        for (const p of run.paras) {
          const at = p.text.toLowerCase().indexOf(q);
          if (at < 0) continue;
          const start = Math.max(0, at - 40);
          out.push({
            page: pi,
            before: (start > 0 ? "…" : "") + p.text.slice(start, at),
            match: p.text.slice(at, at + q.length),
            after:
              p.text.slice(at + q.length, at + q.length + 60) +
              (at + q.length + 60 < p.text.length ? "…" : ""),
          });
          if (out.length >= 80) return out;
        }
      }
    }
    return out;
  }, [findQuery, pages]);

  // Words per chapter, for the pacing bars.
  const chapterRows = useMemo(() => {
    if (!book) return [];
    const turns = book.turns || [];
    const chapters = (book.chapters || []).length ? book.chapters : [{ title: "", startTurn: 0 }];
    return chapters.map((c, i) => {
      const start = c.startTurn;
      const end = chapters[i + 1] ? chapters[i + 1].startTurn : turns.length;
      const words = turns.slice(start, end).reduce((n, t) => n + (t.words || 0), 0);
      return { title: c.title || "", words };
    });
  }, [book]);

  const currentRuns = !onWritingPage && pages[currentPage] ? pages[currentPage] : [];
  const pageWords = useMemo(
    () =>
      currentRuns.reduce(
        (n, r) => n + (r.paras ? r.paras.reduce((m, p) => m + countWords(p.text), 0) : 0),
        0
      ),
    [currentRuns]
  );
  const firstAuthorRun = currentRuns.find((r) => r.turnId);
  const currentTurn = firstAuthorRun
    ? book.turns.find((t) => t.id === firstAuthorRun.turnId)
    : null;

  const counters = onWritingPage
    ? { page: draftWords, turn: draftWords, total: committedWords + (guideMode ? 0 : draftWords) }
    : { page: pageWords, turn: currentTurn ? currentTurn.words : pageWords, total: committedWords };

  const save = useCallback(
    async (patch, jumpTurnId) => {
      const res = await fetch(`/api/books/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const { book } = await res.json();
        // Re-arm the jump so the re-pagination this triggers (e.g. after a new
        // chapter shifts the section onto a fresh page) lands on the section.
        if (jumpTurnId != null) pendingJump.current = jumpTurnId;
        setBook(book);
      }
      return res.ok;
    },
    [id]
  );

  // Read a newline-delimited JSON generation stream, surfacing prose deltas as
  // they arrive and finalizing on the terminal event. Shared by submit + regen.
  const consumeStream = useCallback(
    async (url, payload, { onDone }) => {
      setBanner("");
      setStreamText("");
      setStreamPhase("writing");
      setGenerating(true);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload || {}),
        });
        if (!res.ok || !res.body) {
          let msg = "The AI author could not continue. Try again.";
          try {
            const j = await res.json();
            if (j && j.error) msg = j.error;
          } catch {}
          setBanner(msg);
          setStreamPhase("idle");
          setGenerating(false);
          return false;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let acc = "";
        let finished = false;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            let ev;
            try {
              ev = JSON.parse(line);
            } catch {
              continue;
            }
            if (ev.t === "delta") {
              acc += ev.d;
              setStreamText(acc);
            } else if (ev.t === "take") {
              // A second, independent take streams from the top; a judge keeps
              // the more human-sounding of the two.
              acc = "";
              setStreamText("");
              setStreamPhase("second-take");
            } else if (ev.t === "polish") {
              // A second pass rewrites the draft from the top — restart the live view.
              acc = "";
              setStreamText("");
              setStreamPhase("polishing");
            } else if (ev.t === "generated") {
              setStreamPhase("finalizing");
            } else if (ev.t === "error") {
              setBanner(ev.error || "The AI author could not continue. Try again.");
              setStreamPhase("idle");
              setGenerating(false);
              return false;
            } else if (ev.t === "done") {
              finished = true;
              if (onDone) onDone(ev.book);
              // The section is committed — reveal the page immediately and let the
              // notes refresh land as a follow-up event (it no longer gates this).
              setStreamPhase("idle");
              setStreamText("");
              setGenerating(false);
              setNotesRefreshing(true);
            } else if (ev.t === "analysis") {
              setBook((prev) => (prev ? { ...prev, analysis: ev.analysis } : prev));
              setNotesRefreshing(false);
            }
          }
        }
        if (!finished) {
          setBanner("The connection dropped before the passage finished. Try again.");
          setStreamPhase("idle");
          setGenerating(false);
          return false;
        }
        // The notes (score, suggestions, arc) are refreshed server-side AFTER the
        // section is delivered, and arrive via the in-stream "analysis" event. To
        // guarantee the displayed analysis is never a turn behind (in case that
        // event is missed), re-read the saved book once the stream closes — by
        // now the server has finished and persisted the current analysis.
        try {
          const r = await fetch(`/api/books/${id}`);
          if (r.ok) {
            const data = await r.json();
            const fresh = data && data.book;
            if (fresh && fresh.analysis) {
              setBook((prev) => {
                if (!prev) return prev;
                const cur = prev.analysis;
                if (cur && cur.updatedAt && cur.updatedAt === fresh.analysis.updatedAt) return prev;
                return { ...prev, analysis: fresh.analysis, arc: fresh.arc || prev.arc };
              });
            }
          }
        } catch {}
        return true;
      } catch {
        setBanner("Network error — your text is still here. Try again.");
        setStreamPhase("idle");
        setGenerating(false);
        return false;
      } finally {
        setStreamPhase("idle");
        setStreamText("");
        setGenerating(false);
        setNotesRefreshing(false);
      }
    },
    [id]
  );

  // The freshest suggested next direction, persisted server-side after each
  // section's analysis refresh — what autopilot feeds back in as the next prompt.
  const fetchNextDirection = useCallback(async () => {
    try {
      const r = await fetch(`/api/books/${id}`);
      if (!r.ok) return "";
      const d = await r.json();
      return (d.book && d.book.analysis && d.book.analysis.nextDirection) || "";
    } catch {
      return "";
    }
  }, [id]);

  const submitTurn = useCallback(async () => {
    if (!draft.trim() || generating) return;
    const wasNewChapter = newChapter;
    if (wasNewChapter) setNewChapter(false);
    const sendSection = (text, chapter) =>
      consumeStream(`/api/books/${id}/turn`, { text, newChapter: chapter }, {
        onDone: (b) => {
          // The book already includes the new chapter (added server-side), so a
          // single update paginates once and the jump lands on the right page.
          const aiTurn = b.turns[b.turns.length - 1];
          pendingJump.current = aiTurn ? aiTurn.id : null;
          setAnimTurn(aiTurn ? aiTurn.id : null);
          setComposing(false);
          setDraft("");
          setBook(b);
        },
      });
    // Autopilot (guide mode): after the directed section, keep going — one
    // section at a time, each driven by the AI's own suggested next direction.
    const total = guideMode && autoPilot ? Math.min(5, Math.max(1, autoCount)) : 1;
    autoStopRef.current = false;
    if (total > 1) setAutoLeft(total);
    try {
      if (!(await sendSection(draft, wasNewChapter))) return;
      for (let i = 1; i < total && !autoStopRef.current; i++) {
        setAutoLeft(total - i);
        const direction = await fetchNextDirection();
        if (!direction) {
          setBanner("Autopilot stopped — no suggested direction was available for the next section.");
          return;
        }
        if (autoStopRef.current) return;
        if (!(await sendSection(direction, false))) return;
      }
    } finally {
      setAutoLeft(0);
    }
  }, [draft, generating, id, newChapter, guideMode, autoPilot, autoCount, consumeStream, fetchNextDirection]);

  // Let the section being written finish, then stop the autopilot batch.
  const stopAutopilot = useCallback(() => {
    autoStopRef.current = true;
    setAutoLeft(0);
  }, []);

  const regenerate = useCallback(async () => {
    if (generating || !book) return;
    const last = book.turns[book.turns.length - 1];
    if (!last || last.author !== "claude") return;
    await consumeStream(`/api/books/${id}/regenerate`, {}, {
      onDone: (b) => {
        const aiTurn = b.turns[b.turns.length - 1];
        pendingJump.current = aiTurn ? aiTurn.id : null;
        setAnimTurn(aiTurn ? aiTurn.id : null);
        setComposing(false);
        setBook(b);
      },
    });
  }, [generating, book, id, consumeStream]);

  // Targeted rewrite: revise one passage in place per an instruction and/or the
  // length & scope controls. The rest of the book is untouched (unlike "edit
  // from here", which forks).
  const rewriteReady = !!rewriteText.trim() || rewriteLen !== "same" || rewriteScope !== "light";
  const submitRewrite = useCallback(async () => {
    if (generating || !rewriteFor) return;
    if (!rewriteText.trim() && rewriteLen === "same" && rewriteScope === "light") return;
    const turnId = rewriteFor.id;
    const payload = {
      turnId,
      instruction: rewriteText.trim(),
      length: rewriteLen,
      scope: rewriteScope,
    };
    setRewriteFor(null);
    setRewriteText("");
    await consumeStream(`/api/books/${id}/rewrite`, payload, {
      onDone: (b) => {
        pendingJump.current = turnId;
        setAnimTurn(turnId);
        setComposing(false);
        setBook(b);
      },
    });
  }, [generating, rewriteFor, rewriteText, rewriteLen, rewriteScope, id, consumeStream]);

  // Hand edit: replace the passage's text exactly as typed (snapshotted server-side).
  const saveManualEdit = useCallback(async () => {
    if (!rewriteFor || manualSaving || !rewriteManual.trim()) return;
    const turnId = rewriteFor.id;
    setManualSaving(true);
    const ok = await save({ editTurn: { turnId, text: rewriteManual } }, turnId);
    setManualSaving(false);
    if (!ok) {
      setBanner("Could not save the edit — try again.");
      return;
    }
    setRewriteFor(null);
    setAnimTurn(turnId);
    setBanner("");
  }, [rewriteFor, manualSaving, rewriteManual, save]);

  // One-tap tell fixing: line-edit the latest AI section with the linter's
  // findings as the repair list. In-place; the prior version goes to History.
  const fixTells = useCallback(async () => {
    if (generating || !proseTells.length) return;
    const turns = (book && book.turns) || [];
    let turnId = null;
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].author === "claude" && turns[i].text) {
        turnId = turns[i].id;
        break;
      }
    }
    if (!turnId) return;
    if (isMobile) setNotesOpen(false);
    await consumeStream(`/api/books/${id}/fix-tells`, {}, {
      onDone: (b) => {
        pendingJump.current = turnId;
        setAnimTurn(turnId);
        setComposing(false);
        setBook(b);
      },
    });
  }, [generating, proseTells, book, id, isMobile, consumeStream]);

  const saveBible = useCallback(async () => {
    setBibleSaving(true);
    await save({ bible: bibleDraft });
    setBibleSaving(false);
    setBibleEditing(false);
  }, [bibleDraft, save]);

  const editFromHere = useCallback(
    async (turnId) => {
      if (!book) return;
      const idx = book.turns.findIndex((t) => t.id === turnId);
      if (idx < 0) return;
      const keepFrom = guideMode ? idx : idx % 2 === 0 ? idx : idx - 1;
      const ok = window.confirm(
        "Editing from here discards this passage and everything after it — the book forks at this point. Continue?"
      );
      if (!ok) return;
      const recovered = guideMode
        ? (book.turns[keepFrom] && book.turns[keepFrom].prompt) || ""
        : book.turns[keepFrom]
        ? book.turns[keepFrom].text
        : "";
      await save({ truncateFrom: keepFrom });
      setDraft(recovered);
      setCurrentPage(Math.max(0, keepFrom));
      setBanner("");
      setTimeout(() => textareaRef.current && textareaRef.current.focus(), 60);
    },
    [book, save, guideMode]
  );

  // Bookmark the passage the current page belongs to (toggle).
  const pageMarked = !!currentTurn && bookmarks.some((b) => b.turnId === currentTurn.id);
  function toggleBookmark() {
    if (!currentTurn) return;
    if (pageMarked) {
      setBookmarks((prev) => prev.filter((b) => b.turnId !== currentTurn.id));
      return;
    }
    const firstPara = currentRuns.find((r) => r.paras && r.paras.length);
    const snippet = ((firstPara && firstPara.paras[0].text) || currentTurn.text).slice(0, 90);
    setBookmarks((prev) => [
      ...prev,
      { id: `b${Date.now().toString(36)}`, turnId: currentTurn.id, snippet, at: Date.now() },
    ]);
  }

  // Retroactive chapter split: pick the paragraph a new chapter opens with.
  function openSplit() {
    if (!currentTurn || generating) return;
    const paras = String(currentTurn.text)
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);
    setSplitPara(paras.length > 1 ? 1 : 0);
    setSplitTitle("");
    setSplitFor({ id: currentTurn.id, paras });
  }
  async function submitSplit() {
    if (!splitFor || splitSaving) return;
    setSplitSaving(true);
    try {
      const res = await fetch(`/api/books/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          splitChapter: { turnId: splitFor.id, paraIndex: splitPara, title: splitTitle },
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBanner(d.error || "Could not start the chapter here.");
        return;
      }
      const b = d.book;
      const oi = b.turns.findIndex((t) => t.id === splitFor.id);
      const target = splitPara > 0 && b.turns[oi + 1] ? b.turns[oi + 1].id : splitFor.id;
      pendingJump.current = target;
      setSplitFor(null);
      setBanner("");
      setBook(b);
    } catch {
      setBanner("Network error — try again.");
    } finally {
      setSplitSaving(false);
    }
  }

  // On-demand consistency audit (read-only — nothing on the book changes).
  async function runAudit() {
    if (auditBusy) return;
    setAuditBusy(true);
    setAuditErr("");
    try {
      const res = await fetch(`/api/books/${id}/audit`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAuditErr(d.error || "The consistency check failed — try again.");
        return;
      }
      setAudit(d);
    } catch {
      setAuditErr("Network error — try again.");
    } finally {
      setAuditBusy(false);
    }
  }

  // Jump to the passage containing an audit finding's verbatim quote.
  function jumpToQuote(quote) {
    if (!book || !quote) return;
    const q = normQuote(quote);
    if (!q) return;
    const turn = (book.turns || []).find((t) => normQuote(t.text).includes(q));
    if (!turn) return;
    const page = turnStart[turn.id];
    if (page == null) return;
    if (isMobile) setNotesOpen(false);
    turnTo(page);
  }

  const shareUrl = typeof window !== "undefined" ? window.location.href : "";
  function copyShare() {
    if (!shareUrl) return;
    navigator.clipboard?.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }
  function exportPdf() {
    window.open(`/book/${id}/print`, "_blank", "noopener");
  }
  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submitTurn();
    }
  }
  const goWrite = () => {
    if (guideMode && book.turns.length > 0 && prefilledRef.current !== lastTurnId) {
      const sug = book.analysis && book.analysis.nextDirection;
      if (sug && draft.trim() === "") setDraft(sug);
      prefilledRef.current = lastTurnId;
    }
    turnTo(writingIndex);
  };
  // One-tap confirm: retire a heading the author agrees is achieved.
  const markHeadingDone = (id) => {
    save({ arc: (book.arc || []).filter((h) => h.id !== id) });
    setDoneSuggestions((prev) => prev.filter((p) => p.id !== id));
    seenDoneRef.current.add(id);
  };
  // Keep the heading; just stop suggesting it.
  const dismissSuggestion = (id) => {
    setDoneSuggestions((prev) => prev.filter((p) => p.id !== id));
    seenDoneRef.current.add(id);
  };
  // Fork the (ended) book and rewrite it to address the critique, aiming higher.
  // Long books are rewritten in chunks (one streamed request each). Honest: the
  // new book is re-scored normally — nothing here fakes the number.
  const reviseBook = useCallback(async () => {
    if (revising) return;
    setRevising(true);
    setReviseText("");
    setReviseErr("");
    setReviseProgress(null);

    const streamStep = async (forkId) => {
      const res = await fetch(`/api/books/${forkId}/revise/step`, { method: "POST" });
      if (!res.ok || !res.body) {
        let msg = "The revision step failed. Try again.";
        try {
          const j = await res.json();
          if (j && j.error) msg = j.error;
        } catch {}
        setReviseErr(msg);
        return { ok: false };
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";
      let complete = false;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev;
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.t === "delta") {
            acc += ev.d;
            setReviseText(acc);
          } else if (ev.t === "source") {
            setReviseSource(ev.text || "");
            setReviseDiffSnap("");
          } else if (ev.t === "error") {
            setReviseErr(ev.error || "The revision failed. Try again.");
            return { ok: false };
          } else if (ev.t === "done") {
            complete = !!ev.complete;
          }
        }
      }
      return { ok: true, complete };
    };

    try {
      const startRes = await fetch(`/api/books/${id}/revise/start`, { method: "POST" });
      const startData = await startRes.json().catch(() => ({}));
      if (!startRes.ok || !startData.forkId) {
        setReviseErr(startData.error || "Couldn't start the revision. Try again.");
        setRevising(false);
        return;
      }
      const forkId = startData.forkId;
      const total = startData.total || 1;
      for (let i = 0; i < total; i++) {
        setReviseProgress({ done: i, total });
        setReviseText("");
        setReviseSource("");
        setReviseDiffSnap("");
        const r = await streamStep(forkId);
        if (!r.ok) {
          setRevising(false);
          return;
        }
        if (r.complete) break;
      }
      window.location.assign(`/book/${forkId}`); // open the finished revision
    } catch {
      setReviseErr("Network error during the revision. Try again.");
      setRevising(false);
    }
  }, [id, revising]);

  // Load a suggested next-segment direction into the composer and go there.
  const useSuggestion = (text) => {
    setDraft(text);
    prefilledRef.current = lastTurnId; // don't let the auto-suggestion overwrite it
    if (isMobile) setNotesOpen(false);
    turnTo(writingIndex);
  };
  function turnTo(t, fromRead = false) {
    if (!fromRead && readingRef.current) stopReading();
    // Reaching the composer (the page past the last committed one) sets the
    // `composing` intent so it survives the keyboard-driven re-pagination on
    // mobile; any other target is a reading page.
    setComposing(usersMove && t >= writingIndex);
    setNav(t > currentPage ? "next" : t < currentPage ? "prev" : null);
    setCurrentPage(t);
  }
  const jumpTo = (p) => turnTo(Math.max(0, Math.min(navMax, p)));
  const jumpBy = (delta) => turnTo(Math.max(0, Math.min(navMax, currentPage + delta)));

  // ---- Read aloud (ElevenLabs) ----
  // Reads the current page, then auto-advances through the manuscript until the
  // last page or the user stops. Composer page is never read.
  const stopReading = useCallback(() => {
    readingRef.current = false;
    setReading(false);
    setTtsBusy(false);
    const a = audioElRef.current;
    if (a) {
      try {
        a.pause();
        a.removeAttribute("src");
        a.load();
      } catch {}
    }
    try {
      if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    } catch {}
  }, []);

  function pageTextAt(index) {
    const runs = pages[index];
    if (!runs) return "";
    const out = [];
    for (const run of runs) {
      if (run.type === "chapter") {
        out.push(`Chapter ${run.num}${run.title ? `. ${run.title}` : ""}.`);
      } else if (run.paras) {
        out.push(run.paras.map((p) => p.text).join("\n"));
      }
    }
    return out.join("\n").trim();
  }

  async function fetchPageAudio(index) {
    const cache = audioCacheRef.current;
    if (cache.has(index)) return cache.get(index);
    const text = pageTextAt(index);
    if (!text) throw new Error("There's nothing to read on this page.");
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      let msg = "Read-aloud failed.";
      try {
        const j = await res.json();
        if (j && j.error) msg = j.error;
      } catch {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    cache.set(index, url);
    return url;
  }

  function prefetchAudio(index) {
    if (index < 0 || index >= pages.length) return;
    fetchPageAudio(index).catch(() => {});
  }

  async function playIndex(index) {
    if (!readingRef.current) return;
    if (index < 0 || index >= pages.length) {
      stopReading();
      return;
    }
    readIdxRef.current = index;
    turnTo(index, true); // flip to the page being read (without cancelling read-aloud)
    const text = pageTextAt(index);
    if (!text) {
      // empty page — skip ahead
      const next = index + 1;
      if (next >= pages.length) stopReading();
      else playIndex(next);
      return;
    }
    if (voiceModeRef.current === "device") {
      speakDevice(index, text);
    } else {
      await playNatural(index, text);
    }
  }

  // On-device narration via the browser's Web Speech API (no key, no network).
  function speakDevice(index, text) {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
    if (!synth) {
      setBanner("This browser doesn't support on-device speech — switch to the Natural voice.");
      stopReading();
      return;
    }
    setTtsBusy(false);
    try {
      synth.cancel();
    } catch {}
    const u = new SpeechSynthesisUtterance(text);
    u.rate = Math.min(2, Math.max(0.5, speedRef.current));
    if (deviceVoiceRef.current) u.voice = deviceVoiceRef.current;
    u.onend = () => {
      if (!readingRef.current || readIdxRef.current !== index) return;
      const next = index + 1;
      if (next >= pages.length) stopReading();
      else playIndex(next);
    };
    u.onerror = () => {
      if (!readingRef.current) return; // we cancelled it ourselves
      stopReading();
    };
    deviceUttRef.current = u;
    // Some browsers pause synthesis when backgrounded; resume defensively.
    try {
      synth.resume();
    } catch {}
    synth.speak(u);
  }

  // Premium narration via ElevenLabs (server-proxied). Falls back to device.
  async function playNatural(index, text) {
    setTtsBusy(true);
    let url;
    try {
      url = await fetchPageAudio(index);
    } catch (e) {
      setTtsBusy(false);
      const msg = e.message || "";
      if (/configured|ELEVENLABS|reach|service/i.test(msg)) {
        // ElevenLabs unavailable — fall back to on-device voice automatically.
        voiceModeRef.current = "device";
        setVoiceMode("device");
        if (readingRef.current && readIdxRef.current === index) speakDevice(index, text);
        return;
      }
      setBanner(msg || "Read-aloud failed.");
      stopReading();
      return;
    }
    setTtsBusy(false);
    if (!readingRef.current || readIdxRef.current !== index) return;
    const a = audioElRef.current;
    if (!a) return;
    a.src = url;
    try {
      a.preservesPitch = true;
      a.mozPreservesPitch = true;
      a.webkitPreservesPitch = true;
      a.playbackRate = speedRef.current;
    } catch {}
    try {
      await a.play();
    } catch {
      setBanner("Couldn't start audio — tap Read aloud again to begin.");
      stopReading();
      return;
    }
    prefetchAudio(index + 1); // smooth the gap to the next page
  }

  function onAudioEnded() {
    if (!readingRef.current) return;
    const next = readIdxRef.current + 1;
    if (next >= pages.length) {
      stopReading();
      return;
    }
    playIndex(next);
  }

  function openFullEdit() {
    if (readingRef.current) stopReading();
    setFullEditText(fullTextWithChapters(book));
    setFullEditOpen(true);
  }
  async function saveFullText() {
    setFullEditSaving(true);
    try {
      const res = await fetch(`/api/books/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullText: fullEditText }),
      });
      const data = await res.json();
      if (res.ok && data.book) {
        setBook(data.book);
        setDraft("");
        prefilledRef.current = null; // allow the refreshed suggestion to pre-fill
        setCurrentPage(0);
        setFullEditOpen(false);
        setBanner("");
      } else {
        setBanner((data && data.error) || "Could not save the edit.");
      }
    } catch {
      setBanner("Could not save the edit.");
    } finally {
      setFullEditSaving(false);
    }
  }

  function toggleReading() {
    if (readingRef.current) {
      stopReading();
      return;
    }
    if (pages.length === 0) return;
    let start = onWritingPage ? pages.length - 1 : Math.min(currentPage, pages.length - 1);
    start = Math.max(0, start);
    setBanner("");
    readingRef.current = true;
    setReading(true);
    playIndex(start);
  }

  const READ_SPEEDS = [1, 1.3, 1.5];
  function cycleSpeed() {
    setSpeed((s) => {
      const i = READ_SPEEDS.indexOf(s);
      return READ_SPEEDS[(i + 1) % READ_SPEEDS.length] || 1;
    });
  }

  function toggleVoiceMode() {
    const next = voiceModeRef.current === "natural" ? "device" : "natural";
    voiceModeRef.current = next;
    setVoiceMode(next);
    // If we're mid-read, restart the current page in the newly chosen voice.
    if (readingRef.current) {
      try {
        if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
      } catch {}
      const a = audioElRef.current;
      if (a) {
        try {
          a.pause();
        } catch {}
      }
      const idx = readIdxRef.current;
      setTimeout(() => {
        if (readingRef.current) playIndex(idx);
      }, 40);
    }
  }
  // Keep the live audio in sync with the chosen speed (pitch preserved).
  useEffect(() => {
    speedRef.current = speed;
    const a = audioElRef.current;
    if (a) {
      try {
        a.preservesPitch = true;
        a.mozPreservesPitch = true;
        a.webkitPreservesPitch = true;
        a.playbackRate = speed;
      } catch {}
    }
  }, [speed]);

  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);

  // Default to on-device voice when ElevenLabs isn't configured on the server.
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => {
        if (d && d.tts === false) {
          voiceModeRef.current = "device";
          setVoiceMode("device");
        }
      })
      .catch(() => {});
  }, []);

  // Load on-device voices (they populate asynchronously in most browsers).
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const pick = () => {
      const vs = window.speechSynthesis.getVoices();
      if (!vs || !vs.length) return;
      const en =
        vs.find((v) => /^en[-_]/i.test(v.lang) && v.default) ||
        vs.find((v) => /^en[-_]/i.test(v.lang)) ||
        vs[0];
      deviceVoiceRef.current = en || null;
    };
    pick();
    window.speechSynthesis.onvoiceschanged = pick;
    return () => {
      try {
        window.speechSynthesis.onvoiceschanged = null;
      } catch {}
    };
  }, []);

  // Re-pagination (new section, font/format change) invalidates cached audio
  // and stops playback, since page indices may have shifted.
  useEffect(() => {
    const cache = audioCacheRef.current;
    for (const url of cache.values()) URL.revokeObjectURL(url);
    cache.clear();
    readingRef.current = false;
    setReading(false);
    setTtsBusy(false);
    const a = audioElRef.current;
    if (a) {
      try {
        a.pause();
      } catch {}
    }
    try {
      if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages]);

  useEffect(
    () => () => {
      const cache = audioCacheRef.current;
      for (const url of cache.values()) URL.revokeObjectURL(url);
      cache.clear();
      readingRef.current = false;
      try {
        if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
      } catch {}
    },
    []
  );

  // Touch swipe: left = next page, right = previous. Respects navMax (won't
  // swipe into the guide composer) and ignores swipes that begin on controls.
  const touchRef = useRef(null);
  function onTouchStart(e) {
    if (!e.touches || e.touches.length !== 1) {
      touchRef.current = null;
      return;
    }
    const t = e.touches[0];
    const onControl =
      e.target && e.target.closest
        ? !!e.target.closest("textarea, input, button, a, .spine, .chapter-toggle")
        : false;
    touchRef.current = { x: t.clientX, y: t.clientY, onControl };
  }
  function onTouchEnd(e) {
    const s = touchRef.current;
    touchRef.current = null;
    if (!s || s.onControl || generating) return;
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) < 55 || Math.abs(dx) <= Math.abs(dy) * 1.2) return; // not a clear horizontal swipe
    if (dx < 0) {
      if (!onWritingPage && currentPage < navMax) turnTo(Math.min(navMax, currentPage + 1));
    } else {
      if (currentPage > 0) turnTo(Math.max(0, currentPage - 1));
    }
  }

  if (status === "loading")
    return (
      <div className="screen-center">
        <div>
          <p className="big">Opening the book…</p>
          <p className="sub">Fetching your manuscript.</p>
        </div>
      </div>
    );
  if (status === "locked") {
    const submitUnlock = async (e) => {
      e?.preventDefault?.();
      if (unlocking) return;
      setUnlocking(true);
      setUnlockErr("");
      try {
        const res = await fetch(`/api/books/${id}/unlock`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: unlockPw }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          setUnlockErr(d.error || "Incorrect password.");
          setUnlocking(false);
          return;
        }
        const data = await res.json();
        setBook(data.book);
        setUnlockPw("");
        setStatus("ready");
      } catch {
        setUnlockErr("Something went wrong. Try again.");
        setUnlocking(false);
      }
    };
    return (
      <div className="screen-center">
        <form className="lock-gate" onSubmit={submitUnlock}>
          <div className="lock-mark">🔒</div>
          <p className="big">{lockTitle || "This book"} is locked</p>
          <p className="sub">Enter the book’s password to read and write.</p>
          <input
            type="password"
            className="text-input lock-input"
            value={unlockPw}
            onChange={(e) => setUnlockPw(e.target.value)}
            placeholder="Password"
            autoFocus
            autoComplete="current-password"
          />
          {unlockErr && <div className="lock-err">{unlockErr}</div>}
          <button className="btn btn-primary" type="submit" disabled={unlocking || !unlockPw}>
            {unlocking ? "Unlocking…" : "Open the book"}
          </button>
        </form>
      </div>
    );
  }
  if (status === "notfound")
    return (
      <div className="screen-center">
        <div>
          <p className="big">No book at this address</p>
          <p className="sub">This link may be wrong, or the book was never created.</p>
          <a className="btn btn-primary" href="/">
            Start a new book
          </a>
        </div>
      </div>
    );
  if (status === "error" || !book)
    return (
      <div className="screen-center">
        <div>
          <p className="big">Something went wrong</p>
          <p className="sub">We couldn’t load this book. Refresh to try again.</p>
          <button className="btn" onClick={() => location.reload()}>
            Refresh
          </button>
        </div>
      </div>
    );

  const a = book.analysis || {};
  const ended = Boolean(book.ended);
  const perWord = 26;
  const flipClass = nav === "next" ? "flip-next" : nav === "prev" ? "flip-prev" : "";
  const turnLabel = guideMode ? "Section" : "Turn";
  const suggestion = guideMode
    ? book.turns.length === 0
      ? openingSuggestion
      : (book.analysis && book.analysis.nextDirection) || ""
    : "";
  const draftIsSuggestion = !!suggestion && draft.trim() === suggestion.trim();

  const proseStyle = {
    fontFamily,
    fontSize: s.fontSize,
    lineHeight: LINE_H,
    height: contentH,
    color: s.inkColor || undefined,
    "--para-gap": `${paraGap}px`,
    "--quote-indent": `${quoteIndent}px`,
  };

  return (
    <div className={`studio${isMobile ? " is-mobile" : ""}${onComposerMobile ? " composer-scroll" : ""}`}>
      <header className="topbar">
        <div className="topbar-title">
          <h1>{book.title}</h1>
          <span className="by">by {book.author}</span>
        </div>
        <div className="topbar-spacer" />
        <div className="ledger" title="The book so far — each band is one turn">
          {book.turns.length === 0 && !generating ? (
            <span className="ledger-empty">blank manuscript</span>
          ) : (
            <>
              {book.turns.map((t) => (
                <span
                  key={t.id}
                  className="ledger-band"
                  data-author={t.author}
                  data-current={!onWritingPage && turnStart[t.id] === currentPage}
                  onClick={() => turnTo(turnStart[t.id] ?? 0)}
                  style={{ flexGrow: Math.max(1, t.words) }}
                  title={`${authorName(t.author, book.author)} · ${t.words} words`}
                />
              ))}
              {generating && (
                <span className="ledger-band is-draft" style={{ flexGrow: Math.max(1, draftWords) }} />
              )}
              {!generating && usersMove && !book.ended && (
                <span
                  className="ledger-band is-draft"
                  data-current={onWritingPage}
                  onClick={goWrite}
                  style={{ flexGrow: Math.max(1, draftWords || 8) }}
                  title="Your turn in progress"
                />
              )}
            </>
          )}
        </div>
        <div className="topbar-actions">
          <div className="read-cluster">
            <label
              className="read-toggle"
              title={reading ? "Stop read aloud" : "Read the book aloud from the current page"}
            >
              <input
                type="checkbox"
                checked={reading}
                onChange={toggleReading}
                disabled={pages.length === 0}
              />
              <span className="toggle-track" aria-hidden="true">
                <span className="toggle-knob" />
              </span>
              <span className="read-toggle-text">{reading ? (ttsBusy ? "Loading…" : "Reading") : "Read aloud"}</span>
            </label>
            <button
              className="speed-btn"
              onClick={toggleVoiceMode}
              title="Voice source — Natural (ElevenLabs) or Device (on-device, free)"
            >
              {voiceMode === "natural" ? "Natural" : "Device"}
            </button>
            <button
              className="speed-btn"
              onClick={cycleSpeed}
              title="Reading speed — tap to change"
              aria-label={`Reading speed ${speed} times`}
            >
              {speed}×
            </button>
          </div>
          {isMobile && (
            <button
              className="btn btn-ghost more-toggle"
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
            >
              {moreOpen ? "Less ▴" : "More ▾"}
            </button>
          )}
          <div className={`topbar-more${moreOpen ? " open" : ""}`}>
            {isMobile && (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setNotesOpen((v) => !v);
                  setMoreOpen(false);
                }}
              >
                Notes
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => setFindOpen(true)}>
              Find{bookmarks.length ? ` (${bookmarks.length})` : ""}
            </button>
            <button className="btn btn-ghost" onClick={() => setChaptersOpen(true)}>
              Chapters
            </button>
            <button className="btn btn-ghost" onClick={() => setCastOpen(true)}>
              Cast{book.characters && book.characters.length ? ` (${book.characters.length})` : ""}
            </button>
            <button className="btn btn-ghost" onClick={() => setArcOpen(true)}>
              Heading{book.arc && book.arc.length ? ` (${book.arc.length})` : ""}
            </button>
            <button className="btn btn-ghost" onClick={() => setHistoryOpen(true)}>
              History
            </button>
            <button className="btn btn-ghost" onClick={() => setShareOpen(true)}>
              Share
            </button>
            <button className="btn btn-ghost" onClick={openFullEdit}>
              Edit text
            </button>
            <button className="btn btn-ghost" onClick={exportPdf}>
              Export PDF
            </button>
            <a className="btn btn-ghost" href={`/api/books/${id}/epub`} download>
              EPUB
            </a>
            <button className="btn btn-ghost" onClick={() => setAudiobookOpen(true)}>
              Audiobook
            </button>
            <button className="btn" onClick={() => setSettingsOpen(true)}>
              Settings
            </button>
          </div>
        </div>
      </header>

      <audio ref={audioElRef} onEnded={onAudioEnded} preload="auto" hidden />

      <div className="work">
        <div className="stage">
          <div className="stage-col">
            {banner && <div className="banner">{banner}</div>}
            {doneSuggestions.length > 0 && (
              <div className="arc-toast" role="status">
                {doneSuggestions.map((s) => (
                  <div className="arc-toast-row" key={s.id}>
                    <span className="arc-toast-text">✓ “{s.text}” looks achieved.</span>
                    <span className="arc-toast-actions">
                      <button className="arc-toast-yes" onClick={() => markHeadingDone(s.id)}>
                        Mark done
                      </button>
                      <button className="arc-toast-no" onClick={() => dismissSuggestion(s.id)}>
                        Keep
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {guideMode && !onWritingPage && (currentTurn?.prompt || isMobile) && (
              <div
                className={`section-direction${currentTurn?.prompt ? "" : " is-empty"}`}
                title="Your direction for this section"
              >
                {currentTurn?.prompt ? (
                  <>
                    <span className="sd-mark">▸ your direction</span>
                    {currentTurn.prompt}
                  </>
                ) : null}
              </div>
            )}

            <div className="page-viewport" ref={vpRef} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
              <div
                className={`page-scaler${onWritingPage ? " is-flat" : ""}`}
                style={{ width: geom.w * scale, height: onComposerMobile ? "auto" : geom.h * scale }}
              >
                <div
                  className="page-shell"
                  style={{
                    width: geom.w,
                    height: onComposerMobile ? "auto" : geom.h,
                    transform: onWritingPage && scale === 1 ? "none" : `scale(${scale})`,
                  }}
                >
                  <div className="page-stack" aria-hidden="true">
                    <i /><i /><i />
                  </div>

                  {generating ? (
                    <div
                      key="live"
                      className={`book-page paper is-writing is-live${guideMode ? " is-direction" : ""}`}
                      data-material={s.material}
                      style={{ padding: `${geom.padY}px ${geom.padX}px` }}
                    >
                      <div className="run-tab" data-author="claude">
                        {streamPhase === "finalizing"
                          ? "Binding the page…"
                          : streamPhase === "polishing"
                          ? "Polishing the prose…"
                          : streamPhase === "second-take"
                          ? "Writing a second take…"
                          : "The AI author is writing…"}
                        {autoLeft > 0 &&
                          ` · Autopilot — ${autoLeft} section${autoLeft > 1 ? "s" : ""} to go`}
                      </div>
                      <div
                        ref={liveRef}
                        className="page-prose live-prose"
                        style={{ ...proseStyle, height: onComposerMobile ? undefined : contentH }}
                      >
                        {streamText
                          ? segmentQuotes(streamText).map((p, i) =>
                              p.quote ? (
                                <blockquote key={i} className="prose-quote">
                                  <p>{p.text}</p>
                                </blockquote>
                              ) : (
                                <p key={i}>{p.text}</p>
                              )
                            )
                          : <p className="live-waiting">Gathering the first words…</p>}
                        {streamPhase !== "finalizing" && <span className="live-caret" aria-hidden="true" />}
                      </div>
                    </div>
                  ) : onWritingPage ? (
                    <div
                      key="writing"
                      className={`book-page paper is-writing ${flipClass}${generating ? " is-busy" : ""}${
                        guideMode ? " is-direction" : ""
                      }`}
                      data-material={s.material}
                      style={{ padding: `${geom.padY}px ${geom.padX}px` }}
                    >
                      <div className="run-tab" data-author="user">
                        {guideMode
                          ? book.turns.length === 0
                            ? "Open the book — your first direction"
                            : "Your direction"
                          : book.turns.length === 0
                          ? "Open the book — your turn"
                          : "Your turn"}
                      </div>
                      {book.turns.length > 0 && (
                        <label className="chapter-toggle" title="Start a new chapter with this passage">
                          <input
                            type="checkbox"
                            checked={newChapter}
                            onChange={(e) => setNewChapter(e.target.checked)}
                          />
                          <span>Begin a new chapter here</span>
                        </label>
                      )}
                      {guideMode && (
                        <div className="autopilot-row">
                          <label
                            className="chapter-toggle"
                            title="After this section, the AI keeps going on its own — each new section directed by its own suggested next direction, written one section at a time"
                          >
                            <input
                              type="checkbox"
                              checked={autoPilot}
                              onChange={(e) => setAutoPilot(e.target.checked)}
                            />
                            <span>Autopilot</span>
                          </label>
                          {autoPilot && (
                            <div className="autopilot-count">
                              <input
                                type="range"
                                min="1"
                                max="5"
                                step="1"
                                value={autoCount}
                                onChange={(e) => setAutoCount(Number(e.target.value))}
                                aria-label="How many sections autopilot writes"
                              />
                              <span className="range-val">
                                {autoCount} section{autoCount > 1 ? "s" : ""}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                      {guideMode && draftIsSuggestion && (
                        <div className="suggest-hint">
                          {book.turns.length === 0
                            ? "✎ A suggested opening in your chosen author's style — accept it as is, or rewrite it to steer your own way."
                            : "✎ Suggested next direction — accept it as is, or rewrite it to steer your own way."}
                        </div>
                      )}
                      <button
                        className={`arc-bar${book.arc && book.arc.length ? " has" : ""}`}
                        onClick={() => setArcOpen(true)}
                        type="button"
                        title="Where the story is heading"
                      >
                        {book.arc && book.arc.length ? (
                          <>
                            <span className="arc-bar-k">Heading toward</span>
                            {book.arc.map((h) => (
                              <span className="arc-bar-chip" key={h.id} data-pace={h.pace}>
                                {h.text}
                              </span>
                            ))}
                            <span className="arc-bar-edit">edit</span>
                          </>
                        ) : (
                          <span className="arc-bar-add">＋ Set where it’s heading (optional)</span>
                        )}
                      </button>
                      <textarea
                        ref={textareaRef}
                        className="write-area"
                        style={{ ...proseStyle, height: onComposerMobile ? undefined : contentH }}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={onKeyDown}
                        disabled={generating}
                        placeholder={
                          guideMode
                            ? book.turns.length === 0
                              ? "Describe how the story opens — the character, the place, the moment. A line or a paragraph is plenty; the AI will write ~500 words from it."
                              : "Describe what happens next in this section. Steer the characters, the turn, the tone — the AI writes ~500 words from your direction."
                            : book.turns.length === 0
                            ? "Begin your story. Write as much or as little as you like — the AI author will answer with about the same length, in your voice."
                            : "Write the next passage…"
                        }
                        autoFocus
                      />
                      {onComposerMobile && (
                        <div className="composer-actions-m">
                          <button
                            className="btn btn-primary"
                            onClick={submitTurn}
                            disabled={generating || !draft.trim()}
                          >
                            {generating ? "Weaving…" : guideMode ? "Write this section →" : "Hand to the AI author →"}
                          </button>
                          <button
                            className="btn btn-ghost"
                            onClick={() => turnTo(Math.max(0, writingIndex - 1))}
                            disabled={writingIndex === 0 || generating}
                          >
                            ← Back to the book
                          </button>
                        </div>
                      )}
                      <div className="folio">{writingIndex + 1}</div>
                    </div>
                  ) : (
                    <div
                      key={`p${currentPage}`}
                      className={`book-page paper ${flipClass}`}
                      data-material={s.material}
                      style={{ padding: `${geom.padY}px ${geom.padX}px` }}
                    >
                      <div className="page-prose" style={proseStyle}>
                        {currentRuns.map((run, ri) => {
                          if (run.type === "chapter") {
                            return (
                              <div className="chapter-head" key={ri}>
                                <div className="chapter-eyebrow">Chapter {run.num}</div>
                                {run.title?.trim() ? (
                                  <div className="chapter-title">{run.title}</div>
                                ) : (
                                  <div className="chapter-title chapter-untitled">Untitled</div>
                                )}
                                <div className="chapter-rule" />
                              </div>
                            );
                          }
                          if (run.type === "end") {
                            return (
                              <div className="the-end" key={ri}>
                                The End
                              </div>
                            );
                          }
                          const isAI = run.author === "claude" && !guideMode && !run.merged;
                          const animating = run.turnId === animTurn;
                          let wcount = 0;
                          return (
                            <div
                              key={ri}
                              className={`ink-run${isAI ? " ink-run--ai" : ""}${animating ? " is-fresh" : ""}`}
                              data-author={run.author}
                            >
                              {run.turnStart && !guideMode && !run.merged && (
                                <div className="run-tab" data-author={run.author}>
                                  {authorName(run.author, book.author)}
                                </div>
                              )}
                              {run.paras.map((p, pi) => {
                                const inner = animating ? (
                                  <RevealParagraph
                                    key={pi}
                                    text={p.text}
                                    delayStart={wcount}
                                    perWord={perWord}
                                    onWordCount={(n) => (wcount = n)}
                                  />
                                ) : (
                                  <p key={pi}>{p.text}</p>
                                );
                                return p.quote ? (
                                  <blockquote key={pi} className="prose-quote">
                                    {inner}
                                  </blockquote>
                                ) : (
                                  inner
                                );
                              })}
                              {animating && <span className="nib" aria-hidden="true" />}
                            </div>
                          );
                        })}
                      </div>
                      <div className="folio">{currentPage + 1}</div>
                      <button
                        className="edit-here-fab"
                        title="Edit from this passage onward"
                        onClick={() => currentTurn && editFromHere(currentTurn.id)}
                      >
                        Edit from here ↺
                      </button>
                      <button
                        className={`bm-ribbon${pageMarked ? " is-on" : ""}`}
                        title={pageMarked ? "Remove bookmark" : "Bookmark this passage (saved on this device)"}
                        aria-label={pageMarked ? "Remove bookmark" : "Bookmark this passage"}
                        onClick={toggleBookmark}
                      />
                      <button
                        className="edit-here-fab chapter-fab"
                        title="Begin a new chapter inside this passage — pick the paragraph it opens with"
                        onClick={openSplit}
                      >
                        ❡ Chapter here
                      </button>
                      <button
                        className="edit-here-fab rewrite-fab"
                        title="Rewrite just this passage with an instruction — the rest of the book stays put"
                        onClick={() => {
                          if (!currentTurn || generating) return;
                          setRewriteText("");
                          setRewriteMode("ai");
                          setRewriteLen("same");
                          setRewriteScope("light");
                          setRewriteManual(currentTurn.text);
                          setRewriteFor({ id: currentTurn.id, text: currentTurn.text });
                        }}
                      >
                        ✎ Rewrite this passage
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {generating && (
              <div className="thinking">
                <span className="pulse">
                  <i /><i /><i />
                </span>
                {streamPhase === "polishing"
                  ? "The AI author is giving the section a polishing pass…"
                  : streamPhase === "second-take"
                  ? "The AI author is writing a second take — the more human one will be kept…"
                  : guideMode
                  ? "The AI author is writing the next section…"
                  : `The AI author is writing about ${draftWords} words in your voice…`}
              </div>
            )}

            <div className="dock">
              <div className="nav">
                {showFastNav && (
                  <button
                    className="icon-btn"
                    onClick={() => jumpTo(0)}
                    disabled={currentPage <= 0}
                    aria-label="First page"
                    title="First page"
                  >
                    |‹
                  </button>
                )}
                {showFastNav && (
                  <button
                    className="icon-btn"
                    onClick={() => jumpBy(-10)}
                    disabled={currentPage <= 0}
                    aria-label="Back 10 pages"
                    title="Back 10 pages"
                  >
                    «
                  </button>
                )}
                <button
                  className="icon-btn"
                  onClick={() => jumpBy(-1)}
                  disabled={currentPage <= 0}
                  aria-label="Previous page"
                >
                  ‹
                </button>
                <button
                  className="icon-btn"
                  onClick={() => jumpBy(1)}
                  disabled={currentPage >= navMax}
                  aria-label="Next page"
                >
                  ›
                </button>
                {showFastNav && (
                  <button
                    className="icon-btn"
                    onClick={() => jumpBy(10)}
                    disabled={currentPage >= navMax}
                    aria-label="Forward 10 pages"
                    title="Forward 10 pages"
                  >
                    »
                  </button>
                )}
                {showFastNav && (
                  <button
                    className="icon-btn"
                    onClick={() => jumpTo(navMax)}
                    disabled={currentPage >= navMax}
                    aria-label="Last page"
                    title="Last page"
                  >
                    ›|
                  </button>
                )}
              </div>
              <span className="pageno">
                {onWritingPage ? "Writing" : `Page ${currentPage + 1}`}
                {" / "}
                {guideMode ? Math.max(pages.length, 1) : pageCount}
              </span>
              <div className="dock-spacer" />
              <div className="counters">
                {guideMode ? (
                  <div className="counter">
                    <div className="num">{committedWords}</div>
                    <div className="lab">Words</div>
                  </div>
                ) : (
                  <>
                    <div className={`counter${onWritingPage ? " live" : ""}`}>
                      <div className="num">{counters.page}</div>
                      <div className="lab">Page</div>
                    </div>
                    <div className={`counter${onWritingPage ? " live" : ""}`}>
                      <div className="num">{counters.turn}</div>
                      <div className="lab">{turnLabel}</div>
                    </div>
                    <div className="counter">
                      <div className="num">{counters.total}</div>
                      <div className="lab">Total</div>
                    </div>
                  </>
                )}
              </div>
              {autoLeft > 0 ? (
                <button
                  className="btn btn-ghost"
                  onClick={stopAutopilot}
                  title="Finish the section being written, then stop"
                >
                  ⏸ Stop autopilot · {autoLeft} to go
                </button>
              ) : onWritingPage ? (
                <button className="btn btn-primary" onClick={submitTurn} disabled={generating || !draft.trim()}>
                  {generating ? "Weaving…" : guideMode ? "Write this section →" : "Hand to the AI author →"}
                </button>
              ) : usersMove && !book.ended ? (
                <>
                  {canRegenerate && (
                    <button
                      className="btn btn-ghost dock-regen"
                      onClick={regenerate}
                      disabled={generating}
                      title="Discard the latest AI passage and write a fresh version"
                    >
                      ↻ Regenerate
                    </button>
                  )}
                  <button className="btn btn-primary" onClick={goWrite}>
                    {guideMode ? "Direct the next section →" : "Continue writing →"}
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <aside
          className={`notes${isMobile ? (notesOpen ? " notes-open" : " notes-closed") : ""}${
            notesRefreshing ? " is-refreshing" : ""
          }`}
        >
          <div className="notes-head">
            <h2>Reader’s notes</h2>
            {notesRefreshing && <span className="notes-refreshing">Re-reading…</span>}
            {isMobile && (
              <button className="btn btn-ghost x" onClick={() => setNotesOpen(false)} aria-label="Close notes">
                Close
              </button>
            )}
          </div>

          <div className="share-top">
            <div className="share-label">Your private link — return any time</div>
            <div className="share-row">
              <input
                readOnly
                value={shareUrl}
                aria-label="Shareable book link"
                onFocusCapture={(e) => e.target.select()}
              />
              <button className="btn btn-primary" onClick={copyShare}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          <div className="note-card">
            <div className="k">Genre</div>
            {a.genre ? (
              <span className="genre-tag">{a.genre}</span>
            ) : (
              <div className="v muted">Found after your first exchange</div>
            )}
          </div>
          <div className="note-card">
            <div className="k">{guideMode ? "Prose & voice" : "Your writing style"}</div>
            <div className={`v${a.style ? "" : " muted"}`}>
              {a.style ||
                (guideMode
                  ? "The AI author's voice will be described as the story grows."
                  : "The AI author will describe your voice as the book grows.")}
            </div>
          </div>
          <div className="note-card">
            <div className="k">{ended ? "Synopsis" : "Synopsis so far"}</div>
            <div className={`v${a.synopsis ? "" : " muted"}`}>{a.synopsis || "Nothing written yet."}</div>
          </div>
          <div className="note-card">
            <div className="k">{ended ? "Final assessment" : guideMode ? "Story & direction" : "Craft"}</div>
            {a.qualityScore != null ? (
              <div className="quality">
                <div className="score">
                  {a.qualityScore}
                  <small>/100</small>
                </div>
                <div className="meter">
                  <i style={{ width: `${a.qualityScore}%` }} />
                </div>
              </div>
            ) : (
              <div className="v muted">Unscored</div>
            )}
            {typeof book.revisedFromScore === "number" && a.qualityScore != null && (
              <div className="revised-from">
                Revised from {book.revisedFromScore}/100 ·{" "}
                {a.qualityScore > book.revisedFromScore
                  ? `+${a.qualityScore - book.revisedFromScore}`
                  : a.qualityScore < book.revisedFromScore
                  ? `${a.qualityScore - book.revisedFromScore}`
                  : "no change"}
              </div>
            )}
            {a.quality && (
              <div className="v" style={{ marginTop: 10 }}>
                {a.quality}
              </div>
            )}
            {a.critique && (
              <div className="critique">
                <div className="critique-h">What's holding it back</div>
                <ul className="critique-list">
                  {a.critique
                    .split(/\n+/)
                    .map((line) => line.replace(/^[\s•\-–*]+/, "").trim())
                    .filter(Boolean)
                    .map((line, ci) => (
                      <li key={ci}>{line}</li>
                    ))}
                </ul>
              </div>
            )}
            {ended && (
              <div className="revise-cta">
                <button className="btn btn-primary revise-btn" onClick={reviseBook} disabled={revising}>
                  {revising ? "Revising…" : "↑ Revise toward 90 — fork a stronger draft"}
                </button>
                <div className="revise-hint">
                  Creates a new book: the AI rewrites this one to address the critique above, then re-scores it
                  honestly. Your original is kept untouched.
                </div>
                {reviseErr && <div className="pw-err">{reviseErr}</div>}
              </div>
            )}
            {!ended && a.suggestions && (
              <div className="suggestions">
                <div className="critique-h">
                  {guideMode ? "Ways the next section could answer this" : "Ways to write into this next"}
                </div>
                <div className="suggestion-cards">
                  {a.suggestions
                    .split(/\n+/)
                    .map((line) => line.replace(/^[\s•\-–*]+/, "").trim())
                    .filter(Boolean)
                    .map((line, si) => (
                      <button
                        key={si}
                        className="suggestion-card"
                        onClick={() => useSuggestion(line)}
                        title="Use this as your next direction"
                      >
                        <span className="suggestion-text">{line}</span>
                        <span className="suggestion-cta">{guideMode ? "Direct this →" : "Write this →"}</span>
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>
          {(book.scoreHistory || []).length >= 2 && (
            <div className="note-card">
              <div className="k">Score over time</div>
              <ScoreChart history={book.scoreHistory} />
              {chapterRows.length >= 2 && (
                <>
                  <div className="k" style={{ marginTop: 14 }}>
                    Words per chapter
                  </div>
                  <PacingBars rows={chapterRows} />
                </>
              )}
            </div>
          )}
          {book.turns.length > 0 && (
            <div className="note-card">
              <div className="k">Consistency</div>
              {audit && audit.findings.length > 0 && (
                <div className="audit-findings">
                  {audit.findings.map((f, fi) => (
                    <div className="audit-finding" key={fi}>
                      <span className="audit-sev" data-sev={f.severity}>
                        {f.severity}
                      </span>
                      {f.issue}
                      {f.quote && jumpableQuote(book, f.quote) && (
                        <button className="audit-jump" onClick={() => jumpToQuote(f.quote)}>
                          find →
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {audit && audit.findings.length === 0 && (
                <div className="v tells-clean">✓ No contradictions found.</div>
              )}
              {!audit && (
                <div className="v muted">
                  Scan the whole book for contradictions — names, timelines, facts — checked against
                  your canon and cast sheet.
                </div>
              )}
              <button className="bible-edit-btn" onClick={runAudit} disabled={auditBusy}>
                {auditBusy ? "Reading the whole book…" : audit ? "↻ Check again" : "✦ Check the book"}
              </button>
              {auditErr && <div className="pw-err" style={{ marginTop: 8 }}>{auditErr}</div>}
            </div>
          )}
          {lastAiText && !ended && (
            <div className="note-card">
              <div className="k">Prose tells — latest section</div>
              {proseTells.length ? (
                <>
                  <ul className="critique-list tells-list">
                    {proseTells.map((f, ti) => (
                      <li key={ti}>{f}</li>
                    ))}
                  </ul>
                  <button className="bible-edit-btn" onClick={fixTells} disabled={generating}>
                    {generating ? "Working…" : "✦ Fix these — line-edit the section"}
                  </button>
                </>
              ) : (
                <div className="v tells-clean">✓ Reads clean — no mechanical tells detected.</div>
              )}
              <div className="tells-hint">
                A deterministic scan for machine-writing patterns (uniform rhythm, “not X, but Y”,
                stock phrases…). Fixing repairs exactly these findings in place — story events and
                length stay put, and the prior version is kept in History.
              </div>
            </div>
          )}
          {a.continuity && (
            <div className="note-card">
              <div className="k">Story memory</div>
              <div className="v continuity-note">{a.continuity}</div>
            </div>
          )}
          <div className="note-card">
            <div className="k">Author’s canon</div>
            {bibleEditing ? (
              <>
                <textarea
                  className="arc-text bible-edit"
                  rows={7}
                  maxLength={4000}
                  value={bibleDraft}
                  onChange={(e) => setBibleDraft(e.target.value)}
                  placeholder={
                    "One fact per line — e.g.\nMara’s eyes are green.\nThe manor burned down in 1911.\nTomas doesn’t know Edda is his sister."
                  }
                  autoFocus
                />
                <div className="bible-actions">
                  <button className="btn btn-primary" onClick={saveBible} disabled={bibleSaving}>
                    {bibleSaving ? "Saving…" : "Save canon"}
                  </button>
                  <button className="btn btn-ghost" onClick={() => setBibleEditing(false)} disabled={bibleSaving}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className={`v continuity-note${book.bible ? "" : " muted"}`}>
                  {book.bible ||
                    "Pin the facts the AI must never get wrong — names, dates, who knows what. Your canon outranks the AI’s own story memory."}
                </div>
                <button
                  className="bible-edit-btn"
                  onClick={() => {
                    setBibleDraft(book.bible || "");
                    setBibleEditing(true);
                  }}
                >
                  {book.bible ? "Edit canon" : "＋ Pin canon facts"}
                </button>
              </>
            )}
          </div>
          {book.arc && book.arc.length > 0 && (
            <div className="note-card">
              <div className="k">Where it’s heading</div>
              <div className="arc-notes">
                {(() => {
                  const prog = (a.arcProgress || "")
                    .split(/\n+/)
                    .map((l) => l.replace(/^[\s•\-–*\d.]+/, "").trim())
                    .filter(Boolean);
                  return book.arc.map((h, i) => (
                    <div className="arc-note" key={h.id}>
                      <div className="arc-note-goal">
                        <span className="arc-note-pace" data-pace={h.pace}>
                          {h.pace}
                        </span>
                        {h.text}
                      </div>
                      <div className="arc-note-prog">{prog[i] || "Not yet assessed."}</div>
                      {(a.arcDoneIds || []).includes(h.id) && (
                        <button className="arc-note-done" onClick={() => markHeadingDone(h.id)}>
                          ✓ Looks achieved — mark done
                        </button>
                      )}
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}
        </aside>
        {isMobile && notesOpen && <div className="notes-scrim" onClick={() => setNotesOpen(false)} />}
      </div>

      {/* offscreen measurer — typography matches a real page; width set per call */}
      <div
        ref={measureRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          left: -99999,
          top: 0,
          width: contentW,
          fontFamily,
          fontSize: s.fontSize,
          lineHeight: LINE_H,
          whiteSpace: "pre-wrap",
          visibility: "hidden",
          pointerEvents: "none",
        }}
      />

      {fullEditOpen && (
        <div className="fulledit-scrim" ref={editScrimRef} onClick={() => !fullEditSaving && setFullEditOpen(false)}>
          <div className="fulledit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fulledit-head">
              <div>
                <div className="fulledit-title">Edit the full text</div>
                <div className="fulledit-sub">
                  Revise the whole manuscript freely — add, delete, rewrite. Separate paragraphs with a
                  blank line. A line that starts with <code>## Chapter</code> (or <code>## Chapter: Title</code>)
                  marks where a chapter begins — move, add, or remove these to reshape the chapters. Saving
                  repaginates the book.
                </div>
              </div>
              <button className="btn btn-ghost" onClick={() => setFullEditOpen(false)} disabled={fullEditSaving}>
                Cancel
              </button>
            </div>
            <textarea
              className="fulledit-area"
              value={fullEditText}
              onChange={(e) => setFullEditText(e.target.value)}
              placeholder="The whole book's text…"
              autoFocus
              spellCheck
            />
            <div className="fulledit-foot">
              <span className="fulledit-count">{countWords(fullEditText).toLocaleString()} words</span>
              <button className="btn btn-primary" onClick={saveFullText} disabled={fullEditSaving}>
                {fullEditSaving ? "Saving…" : "Save & repaginate"}
              </button>
            </div>
          </div>
        </div>
      )}

      {rewriteFor && (
        <div className="fulledit-scrim" onClick={() => !manualSaving && setRewriteFor(null)}>
          <div className="fulledit-modal rewrite-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fulledit-head">
              <div>
                <div className="fulledit-title">Rework this passage</div>
                <div className="fulledit-sub">
                  Only this passage changes; everything before and after stays exactly as it is, and
                  the old version is kept in History.
                </div>
              </div>
              <button className="btn btn-ghost" onClick={() => setRewriteFor(null)} disabled={manualSaving}>
                Cancel
              </button>
            </div>

            <div className="rw-tabs" role="tablist">
              <button
                className={`rw-tab${rewriteMode === "ai" ? " is-on" : ""}`}
                role="tab"
                aria-selected={rewriteMode === "ai"}
                onClick={() => setRewriteMode("ai")}
              >
                ✎ AI rewrite
              </button>
              <button
                className={`rw-tab${rewriteMode === "manual" ? " is-on" : ""}`}
                role="tab"
                aria-selected={rewriteMode === "manual"}
                onClick={() => setRewriteMode("manual")}
              >
                ✍ Edit by hand
              </button>
            </div>

            {rewriteMode === "ai" ? (
              <>
                <div className="rewrite-excerpt">
                  {rewriteFor.text.length > 420
                    ? `${rewriteFor.text.slice(0, 280)} […] ${rewriteFor.text.slice(-120)}`
                    : rewriteFor.text}
                </div>
                <textarea
                  className="arc-text rewrite-instruction"
                  rows={3}
                  maxLength={600}
                  value={rewriteText}
                  onChange={(e) => setRewriteText(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      submitRewrite();
                    }
                  }}
                  placeholder="Optional with the controls below — e.g. Make this scene tenser, and end on the knock at the door."
                  autoFocus
                />
                <div className="rw-controls">
                  <div className="rw-control">
                    <span className="rw-control-k">Length</span>
                    {[
                      ["shorter", "Shorter"],
                      ["same", "About the same"],
                      ["longer", "Longer"],
                    ].map(([v, label]) => (
                      <button
                        key={v}
                        className={`rw-chip${rewriteLen === v ? " is-on" : ""}`}
                        onClick={() => setRewriteLen(v)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="rw-control">
                    <span className="rw-control-k">Scope</span>
                    <button
                      className={`rw-chip${rewriteScope === "light" ? " is-on" : ""}`}
                      onClick={() => setRewriteScope("light")}
                      title="Keep every event and the passage's structure — improve the telling"
                    >
                      Light touch
                    </button>
                    <button
                      className={`rw-chip${rewriteScope === "free" ? " is-on" : ""}`}
                      onClick={() => setRewriteScope("free")}
                      title="The AI may restructure the passage and change how its events unfold"
                    >
                      Free hand
                    </button>
                  </div>
                </div>
                <div className="fulledit-foot">
                  <span className="fulledit-count">{countWords(rewriteFor.text).toLocaleString()} words</span>
                  <button className="btn btn-primary" onClick={submitRewrite} disabled={!rewriteReady || generating}>
                    Rewrite it →
                  </button>
                </div>
              </>
            ) : (
              <>
                <textarea
                  className="rw-manual"
                  value={rewriteManual}
                  onChange={(e) => setRewriteManual(e.target.value)}
                  spellCheck
                  autoFocus
                />
                <div className="fulledit-foot">
                  <span className="fulledit-count">
                    {countWords(rewriteManual).toLocaleString()} words
                    {rewriteManual !== rewriteFor.text ? " · edited" : ""}
                  </span>
                  <button
                    className="btn btn-primary"
                    onClick={saveManualEdit}
                    disabled={manualSaving || !rewriteManual.trim() || rewriteManual === rewriteFor.text}
                  >
                    {manualSaving ? "Saving…" : "Save the passage"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {settingsOpen && (
        <SettingsDrawer
          book={book}
          onClose={() => setSettingsOpen(false)}
          onSave={save}
          onSetPassword={async (password) => {
            try {
              const res = await fetch(`/api/books/${id}/password`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password }),
              });
              const d = await res.json().catch(() => ({}));
              if (!res.ok) return { ok: false, error: d.error || "Could not update the password." };
              setBook((b) => (b ? { ...b, protected: !!d.protected } : b));
              return { ok: true, protected: !!d.protected };
            } catch {
              return { ok: false, error: "Network error — try again." };
            }
          }}
        />
      )}
      {revising && (
        <div className="revise-scrim">
          <div className="revise-modal">
            <div className="revise-modal-head">
              <span className="live-caret" aria-hidden="true" /> Revising toward a stronger draft…
              {reviseProgress && reviseProgress.total > 1 && (
                <span className="revise-prog">
                  part {reviseProgress.done + 1} of {reviseProgress.total}
                </span>
              )}
              <button
                className="revise-toggle"
                onClick={() => setReviseDiff((v) => !v)}
                title={reviseDiff ? "Show the clean new text" : "Show what changed"}
              >
                {reviseDiff ? "Clean view" : "Show changes"}
              </button>
            </div>
            <div className="revise-modal-body" ref={reviseScrollRef}>
              {reviseDiff && reviseDiffHtml !== null ? (
                <div className="revise-diff" dangerouslySetInnerHTML={{ __html: reviseDiffHtml }} />
              ) : reviseText ? (
                reviseText.split(/\n+/).map((line, i) => {
                  const m = line.match(/^[ \t]*##[ \t]+chapter\b[ \t]*[:.\-]?[ \t]*(.*)$/i);
                  if (m) {
                    return (
                      <div className="revise-chap" key={i}>
                        Chapter{m[1] ? ` · ${m[1]}` : ""}
                      </div>
                    );
                  }
                  return line.trim() ? <p key={i}>{line}</p> : null;
                })
              ) : (
                <p className="live-waiting">Reading the manuscript and planning the revision…</p>
              )}
            </div>
            <div className="revise-modal-foot">
              {reviseDiff ? (
                <span>
                  <span className="d-del">struck-through</span> = removed · <span className="d-ins">blue</span> = new.
                  The AI rewrites substantially, so expect a lot of change.{" "}
                </span>
              ) : null}
              {reviseProgress && reviseProgress.total > 1
                ? "Longer books are rewritten in parts — this can take several minutes. Your original is untouched."
                : "The new book opens automatically when it’s ready — your original is untouched."}
            </div>
          </div>
        </div>
      )}
      {chaptersOpen && (
        <ChaptersDrawer
          book={book}
          currentTurnId={currentTurn ? currentTurn.id : null}
          turnStart={turnStart}
          onJump={(pageIdx) => {
            turnTo(pageIdx);
            setChaptersOpen(false);
          }}
          onClose={() => setChaptersOpen(false)}
          onSave={save}
        />
      )}
      {arcOpen && (
        <ArcDrawer
          arc={book.arc || []}
          analysis={book.analysis}
          sections={(book.turns || []).filter((t) => t.author === "claude").length}
          onSave={(a) => save({ arc: a })}
          onClose={() => setArcOpen(false)}
        />
      )}
      {historyOpen && (
        <HistoryDrawer
          bookId={id}
          onClose={() => setHistoryOpen(false)}
          onRestore={(b) => {
            pendingJump.current = null;
            setComposing(false);
            setCurrentPage(0);
            setBook(b);
          }}
        />
      )}
      {findOpen && (
        <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && setFindOpen(false)}>
          <div className="drawer" role="dialog" aria-modal="true" aria-label="Find and bookmarks">
            <div className="drawer-head">
              <h3>Find</h3>
              <button className="btn btn-ghost x" onClick={() => setFindOpen(false)} aria-label="Close">
                Close
              </button>
            </div>
            <input
              className="text-input find-input"
              value={findQuery}
              onChange={(e) => setFindQuery(e.target.value)}
              placeholder="Search the whole book…"
              autoFocus
            />
            {findQuery.trim().length >= 2 && (
              <div className="find-results">
                <div className="find-count">
                  {searchResults.length === 0
                    ? "No matches."
                    : `${searchResults.length}${searchResults.length >= 80 ? "+" : ""} match${
                        searchResults.length === 1 ? "" : "es"
                      }`}
                </div>
                {searchResults.map((r, ri) => (
                  <button
                    key={ri}
                    className="find-result"
                    onClick={() => {
                      turnTo(r.page);
                      setFindOpen(false);
                    }}
                  >
                    <span className="fr-page">p.{r.page + 1}</span>
                    <span className="fr-snip">
                      {r.before}
                      <mark>{r.match}</mark>
                      {r.after}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="find-bm-head">Bookmarks</div>
            {bookmarks.length === 0 ? (
              <div className="find-bm-empty">
                None yet — use the ribbon in the top corner of any page. Bookmarks are saved on this
                device.
              </div>
            ) : (
              <div className="find-bm-list">
                {bookmarks.map((b) => (
                  <div className="find-bm" key={b.id}>
                    <button
                      className="find-result"
                      onClick={() => {
                        const p = turnStart[b.turnId];
                        if (p != null) turnTo(p);
                        setFindOpen(false);
                      }}
                    >
                      <span className="fr-page">p.{(turnStart[b.turnId] ?? 0) + 1}</span>
                      <span className="fr-snip">{b.snippet}…</span>
                    </button>
                    <button
                      className="arc-remove"
                      onClick={() => setBookmarks((prev) => prev.filter((x) => x.id !== b.id))}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {splitFor && (
        <div className="fulledit-scrim" onClick={() => !splitSaving && setSplitFor(null)}>
          <div className="fulledit-modal rewrite-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fulledit-head">
              <div>
                <div className="fulledit-title">New chapter inside this passage</div>
                <div className="fulledit-sub">
                  Pick the paragraph the chapter should open with — the passage is split at that
                  point and the chapter begins on a fresh page. Reversible from History.
                </div>
              </div>
              <button className="btn btn-ghost" onClick={() => setSplitFor(null)} disabled={splitSaving}>
                Cancel
              </button>
            </div>
            <div className="split-list">
              {splitFor.paras.map((p, pi) => (
                <button
                  key={pi}
                  className={`split-para${splitPara === pi ? " is-on" : ""}`}
                  onClick={() => setSplitPara(pi)}
                >
                  <span className="split-mark">{splitPara === pi ? "❡" : String(pi + 1)}</span>
                  <span className="split-text">{p.length > 180 ? `${p.slice(0, 180)}…` : p}</span>
                </button>
              ))}
            </div>
            <input
              className="text-input split-title"
              value={splitTitle}
              maxLength={120}
              onChange={(e) => setSplitTitle(e.target.value)}
              placeholder="Chapter title (optional)"
            />
            <div className="fulledit-foot">
              <span className="fulledit-count">
                opens with paragraph {splitPara + 1} of {splitFor.paras.length}
              </span>
              <button className="btn btn-primary" onClick={submitSplit} disabled={splitSaving}>
                {splitSaving ? "Splitting…" : "Begin chapter here →"}
              </button>
            </div>
          </div>
        </div>
      )}
      {castOpen && (
        <CastDrawer
          book={book}
          onSave={(characters) => save({ characters })}
          onClose={() => setCastOpen(false)}
        />
      )}
      {audiobookOpen && <AudiobookDrawer book={book} onClose={() => setAudiobookOpen(false)} />}
      {shareOpen && (
        <ShareDrawer
          book={book}
          onClose={() => setShareOpen(false)}
          onSetShared={async (next) => {
            await save({ shared: next });
          }}
        />
      )}
    </div>
  );
}
