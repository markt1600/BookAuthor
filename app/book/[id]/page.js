"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { countWords, isUsersMove, totalWords } from "@/lib/book";
import SettingsDrawer from "@/components/SettingsDrawer";
import ChaptersDrawer from "@/components/ChaptersDrawer";

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
  const [currentPage, setCurrentPage] = useState(0);
  const [draft, setDraft] = useState("");
  const [generating, setGenerating] = useState(false);
  const [banner, setBanner] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [newChapter, setNewChapter] = useState(false);
  const [nav, setNav] = useState(null); // 'next' | 'prev' | null — page-turn direction
  const [copied, setCopied] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  const [pages, setPages] = useState([]); // [[run,...], ...]
  const [turnStart, setTurnStart] = useState({}); // turnId -> page index
  const [scale, setScale] = useState(1);
  const [fontsReady, setFontsReady] = useState(false);
  const [animTurn, setAnimTurn] = useState(null);

  const textareaRef = useRef(null);
  const measureRef = useRef(null);
  const vpRef = useRef(null);
  const pendingJump = useRef(null);
  const prefilledRef = useRef(null); // guide mode: which turns-count we've pre-filled a suggestion for

  // ---- load ----
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/books/${id}`);
        if (res.status === 404) return alive && setStatus("notfound");
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
  const geom = (s && PAGE_GEOM[s.format]) || PAGE_GEOM.portrait;
  const contentW = geom.w - geom.padX * 2;
  const contentH = geom.h - geom.padY * 2 - 26; // leave room for the folio
  const fontFamily = (s && FONT[s.font]) || FONT.serif;
  const paraGap = s ? Math.round(s.fontSize * 0.95) : 16;

  // ---- paginate: flow the manuscript into fixed-height pages, box-aware ----
  useEffect(() => {
    if (!book || !measureRef.current) return;
    const m = measureRef.current;
    const measure = (t, w) => {
      m.style.width = `${w}px`;
      m.textContent = t;
      return m.offsetHeight;
    };
    const boxed = (author) => author === "claude" && !guideMode;
    const widthFor = (author) => (boxed(author) ? contentW - AI_HRED : contentW);
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
        runs.push({ author: turn.author, turnId: turn.id, turnStart: ts, paras: [text] });
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
      const paras = String(turn.text).split(/\n{2,}/).filter((p) => p.length);
      if (!paras.length) paras.push("");
      let firstOfTurn = true;
      starts[turn.id] = out.length;
      for (let pi = 0; pi < paras.length; pi++) {
        let text = paras[pi];
        while (true) {
          if (++guard > 2e6) throw new Error("pagination loop");
          const last = runs[runs.length - 1];
          const extend = last && last.author === turn.author && last.turnId === turn.id;
          const gapPart = extend ? paraGap : runs.length > 0 ? paraGap : 0;
          const chrome = !extend && boxed(turn.author) ? AI_VCHROME : 0;
          const fixed = gapPart + chrome;
          const w = widthFor(turn.author);
          const availText = contentH - base - fixed;

          if (availText < oneLine && runs.length > 0) {
            flush();
            if (firstOfTurn) starts[turn.id] = out.length;
            continue;
          }
          const fullH = measure(text, w);
          if (fullH <= availText) {
            place(turn, text, !extend);
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
          place(turn, head, !extend);
          base += fixed + measure(head, w);
          firstOfTurn = false;
          flush();
          text = words.slice(best).join(" ");
        }
      }
    }
    flush();

    setPages(out);
    setTurnStart(starts);
    if (pendingJump.current != null) {
      const target = starts[pendingJump.current];
      if (target != null) setCurrentPage(target);
      pendingJump.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, fontsReady, s?.font, s?.fontSize, s?.format]);

  // ---- scale the page to fit the viewport (does not repaginate) ----
  useLayoutEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const apply = () => {
      const avail = el.clientWidth - 10;
      setScale(Math.max(0.3, Math.min(1, avail / geom.w)));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [geom.w, status]);

  // ---- draft persistence ----
  const draftKey = book ? `loom-draft-${id}-${book.turns.length}` : null;
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
  const pageCount = pages.length + (usersMove ? 1 : 0);
  const onWritingPage = usersMove && currentPage >= writingIndex;

  useEffect(() => {
    if (currentPage > pageCount - 1) setCurrentPage(Math.max(0, pageCount - 1));
    if (currentPage < 0) setCurrentPage(0);
  }, [pageCount, currentPage]);

  useEffect(() => {
    if (animTurn == null) return;
    const t = setTimeout(() => setAnimTurn(null), 1600);
    return () => clearTimeout(t);
  }, [animTurn]);

  const draftWords = useMemo(() => countWords(draft), [draft]);
  const committedWords = book ? totalWords(book) : 0;

  const currentRuns = !onWritingPage && pages[currentPage] ? pages[currentPage] : [];
  const pageWords = useMemo(
    () =>
      currentRuns.reduce(
        (n, r) => n + (r.paras ? r.paras.reduce((m, p) => m + countWords(p), 0) : 0),
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
    async (patch) => {
      const res = await fetch(`/api/books/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const { book } = await res.json();
        setBook(book);
      }
    },
    [id]
  );

  const submitTurn = useCallback(async () => {
    if (!draft.trim() || generating) return;
    setGenerating(true);
    setBanner("");
    try {
      const res = await fetch(`/api/books/${id}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: draft }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner(data.error || "The AI author could not continue. Try again.");
        setGenerating(false);
        return;
      }
      const aiTurn = data.book.turns[data.book.turns.length - 1];
      pendingJump.current = aiTurn ? aiTurn.id : null;
      setAnimTurn(aiTurn ? aiTurn.id : null);
      setDraft("");
      setBook(data.book);
      if (newChapter) {
        const startTurn = guideMode
          ? Math.max(0, data.book.turns.length - 1) // the section just written
          : Math.max(0, data.book.turns.length - 2); // the user turn just written
        save({ chapters: [...(data.book.chapters || []), { startTurn, title: "" }] });
        setNewChapter(false);
      }
    } catch {
      setBanner("Network error — your text is still here. Try again.");
    } finally {
      setGenerating(false);
    }
  }, [draft, generating, id, newChapter, save, guideMode]);

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
    if (guideMode && book.turns.length > 0 && prefilledRef.current !== book.turns.length) {
      const sug = book.analysis && book.analysis.nextDirection;
      if (sug && draft.trim() === "") setDraft(sug);
      prefilledRef.current = book.turns.length;
    }
    turnTo(writingIndex);
  };
  function turnTo(t) {
    setNav(t > currentPage ? "next" : t < currentPage ? "prev" : null);
    setCurrentPage(t);
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
  const perWord = 26;
  const flipClass = nav === "next" ? "flip-next" : nav === "prev" ? "flip-prev" : "";
  const turnLabel = guideMode ? "Section" : "Turn";
  const suggestion = guideMode && book.analysis ? book.analysis.nextDirection || "" : "";
  const draftIsSuggestion = !!suggestion && draft.trim() === suggestion.trim();

  const proseStyle = {
    fontFamily,
    fontSize: s.fontSize,
    lineHeight: LINE_H,
    height: contentH,
    color: s.inkColor || undefined,
    "--para-gap": `${paraGap}px`,
  };

  return (
    <div className={`studio${isMobile ? " is-mobile" : ""}`}>
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
              {!generating && usersMove && (
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
          {isMobile && (
            <button className="btn btn-ghost" onClick={() => setNotesOpen((v) => !v)}>
              Notes
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => setChaptersOpen(true)}>
            Chapters
          </button>
          <button className="btn btn-ghost" onClick={exportPdf}>
            Export PDF
          </button>
          <button className="btn" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </div>
      </header>

      <div className="work">
        <div className="stage">
          <div className="stage-col">
            {banner && <div className="banner">{banner}</div>}

            {guideMode && !onWritingPage && currentTurn && currentTurn.prompt && (
              <div className="section-direction" title="Your direction for this section">
                <span className="sd-mark">▸ your direction</span>
                {currentTurn.prompt}
              </div>
            )}

            <div className="page-viewport" ref={vpRef}>
              <div className="page-scaler" style={{ width: geom.w * scale, height: geom.h * scale }}>
                <div className="page-shell" style={{ width: geom.w, height: geom.h, transform: `scale(${scale})` }}>
                  <div className="page-stack" aria-hidden="true">
                    <i /><i /><i />
                  </div>

                  {onWritingPage ? (
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
                      {guideMode && draftIsSuggestion && (
                        <div className="suggest-hint">
                          ✎ Suggested next direction — accept it as is, or rewrite it to steer your own way.
                        </div>
                      )}
                      <textarea
                        ref={textareaRef}
                        className="write-area"
                        style={{ ...proseStyle, height: contentH }}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={onKeyDown}
                        disabled={generating}
                        placeholder={
                          guideMode
                            ? book.turns.length === 0
                              ? "Describe how the story opens — the character, the place, the moment. A line or a paragraph is plenty; the AI will write ~275 words from it."
                              : "Describe what happens next in this section. Steer the characters, the turn, the tone — the AI writes ~275 words from your direction."
                            : book.turns.length === 0
                            ? "Begin your story. Write as much or as little as you like — the AI author will answer with about the same length, in your voice."
                            : "Write the next passage…"
                        }
                        autoFocus
                      />
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
                          const isAI = run.author === "claude" && !guideMode;
                          const animating = run.turnId === animTurn;
                          let wcount = 0;
                          return (
                            <div
                              key={ri}
                              className={`ink-run${isAI ? " ink-run--ai" : ""}${animating ? " is-fresh" : ""}`}
                              data-author={run.author}
                            >
                              {run.turnStart && !guideMode && (
                                <div className="run-tab" data-author={run.author}>
                                  {authorName(run.author, book.author)}
                                </div>
                              )}
                              {run.paras.map((p, pi) =>
                                animating ? (
                                  <RevealParagraph
                                    key={pi}
                                    text={p}
                                    delayStart={wcount}
                                    perWord={perWord}
                                    onWordCount={(n) => (wcount = n)}
                                  />
                                ) : (
                                  <p key={pi}>{p}</p>
                                )
                              )}
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
                {guideMode
                  ? "The AI author is writing the next section…"
                  : `The AI author is writing about ${draftWords} words in your voice…`}
              </div>
            )}

            <div className="dock">
              <div className="nav">
                <button
                  className="icon-btn"
                  onClick={() => turnTo(Math.max(0, currentPage - 1))}
                  disabled={currentPage <= 0}
                  aria-label="Previous page"
                >
                  ‹
                </button>
                <button
                  className="icon-btn"
                  onClick={() => turnTo(Math.min(pageCount - 1, currentPage + 1))}
                  disabled={currentPage >= pageCount - 1}
                  aria-label="Next page"
                >
                  ›
                </button>
              </div>
              <span className="pageno">
                {onWritingPage ? "Writing" : `Page ${currentPage + 1}`}
                {" / "}
                {pageCount}
              </span>
              <div className="dock-spacer" />
              <div className="counters">
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
              </div>
              {onWritingPage ? (
                <button className="btn btn-primary" onClick={submitTurn} disabled={generating || !draft.trim()}>
                  {generating ? "Weaving…" : guideMode ? "Write this section →" : "Hand to the AI author →"}
                </button>
              ) : usersMove ? (
                <button className="btn btn-primary" onClick={goWrite}>
                  {guideMode ? "Direct the next section →" : "Continue writing →"}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <aside className={`notes${isMobile ? (notesOpen ? " notes-open" : " notes-closed") : ""}`}>
          <div className="notes-head">
            <h2>Reader’s notes</h2>
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
            <div className="k">Synopsis so far</div>
            <div className={`v${a.synopsis ? "" : " muted"}`}>{a.synopsis || "Nothing written yet."}</div>
          </div>
          <div className="note-card">
            <div className="k">Craft</div>
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
            {a.quality && (
              <div className="v" style={{ marginTop: 10 }}>
                {a.quality}
              </div>
            )}
          </div>
          {a.continuity && (
            <div className="note-card">
              <div className="k">Story memory</div>
              <div className="v continuity-note">{a.continuity}</div>
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

      {settingsOpen && <SettingsDrawer book={book} onClose={() => setSettingsOpen(false)} onSave={save} />}
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
    </div>
  );
}
