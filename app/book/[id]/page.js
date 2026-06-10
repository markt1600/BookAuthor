"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { countWords, isUsersMove, totalWords } from "@/lib/book";
import SettingsDrawer from "@/components/SettingsDrawer";

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
};

const LINE_H = 1.62;

function authorName(author, bookAuthor) {
  if (author === "user") return bookAuthor?.trim() || "You";
  return "AI Author";
}

/* ---- word-reveal for the "freshly written" animation ---- */
function RevealParagraph({ text, active, delayStart, perWord, onWordCount }) {
  if (!active) return <p>{text}</p>;
  const words = text.split(/(\s+)/); // keep whitespace tokens
  let wi = delayStart;
  const nodes = words.map((tok, i) => {
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
  const [copied, setCopied] = useState(false);

  const [pages, setPages] = useState([]); // [[fragment,...], ...]
  const [turnStart, setTurnStart] = useState({}); // turnId -> page index
  const [scale, setScale] = useState(1);
  const [fontsReady, setFontsReady] = useState(false);
  const [animTurn, setAnimTurn] = useState(null);

  const textareaRef = useRef(null);
  const measureRef = useRef(null);
  const vpRef = useRef(null);
  const pendingJump = useRef(null);

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

  const s = book?.settings;
  const geom = (s && PAGE_GEOM[s.format]) || PAGE_GEOM.portrait;
  const contentW = geom.w - geom.padX * 2;
  const contentH = geom.h - geom.padY * 2 - 26; // folio space
  const fontFamily = (s && FONT[s.font]) || FONT.serif;
  const paraGap = s ? Math.round(s.fontSize * 0.95) : 16;

  // ---- paginate: flow the whole manuscript into fixed-height pages ----
  useEffect(() => {
    if (!book || !measureRef.current) return;
    const m = measureRef.current;
    const measure = (t) => {
      m.textContent = t;
      return m.offsetHeight;
    };
    const lineH = s.fontSize * LINE_H;
    const out = [];
    const starts = {};
    let page = [];
    let used = 0;
    const flush = () => {
      out.push(page);
      page = [];
      used = 0;
    };

    for (const turn of book.turns) {
      const paras = String(turn.text).split(/\n{2,}/).filter((p) => p.length);
      if (!paras.length) paras.push("");
      let firstFragOfTurn = true;
      starts[turn.id] = out.length; // page where this turn begins
      for (let pi = 0; pi < paras.length; pi++) {
        let text = paras[pi];
        while (true) {
          const isFirst = page.length === 0;
          const gap = isFirst ? 0 : paraGap;
          const avail = contentH - used - gap;
          if (avail < lineH && !isFirst) {
            flush();
            if (firstFragOfTurn) starts[turn.id] = out.length;
            continue;
          }
          const fullH = measure(text);
          if (fullH <= avail) {
            page.push({ turnId: turn.id, author: turn.author, text, turnStart: firstFragOfTurn });
            used += gap + fullH;
            firstFragOfTurn = false;
            break;
          }
          // split this paragraph by words to fill the page
          const words = text.split(/\s+/);
          let lo = 1,
            hi = words.length,
            best = 0;
          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const h = measure(words.slice(0, mid).join(" "));
            if (h <= avail) {
              best = mid;
              lo = mid + 1;
            } else hi = mid - 1;
          }
          if (best === 0) {
            if (!isFirst) {
              flush();
              if (firstFragOfTurn) starts[turn.id] = out.length;
              continue;
            }
            best = 1;
          }
          const head = words.slice(0, best).join(" ");
          page.push({ turnId: turn.id, author: turn.author, text: head, turnStart: firstFragOfTurn });
          firstFragOfTurn = false;
          flush();
          if (out.length && starts[turn.id] === undefined) starts[turn.id] = out.length;
          text = words.slice(best).join(" ");
        }
      }
    }
    if (page.length) flush();

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
      const sc = Math.max(0.3, Math.min(1, avail / geom.w));
      setScale(sc);
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
  const writingIndex = pages.length; // writing page sits after the last leaf
  const pageCount = pages.length + (usersMove ? 1 : 0);
  const onWritingPage = usersMove && currentPage >= writingIndex;

  // when a fresh turn lands we jump to where the AI began — keep page in range
  useEffect(() => {
    if (currentPage > pageCount - 1) setCurrentPage(Math.max(0, pageCount - 1));
    if (currentPage < 0) setCurrentPage(0);
  }, [pageCount, currentPage]);

  // clear the writing animation shortly after it plays
  useEffect(() => {
    if (animTurn == null) return;
    const t = setTimeout(() => setAnimTurn(null), 1600);
    return () => clearTimeout(t);
  }, [animTurn]);

  const draftWords = useMemo(() => countWords(draft), [draft]);
  const committedWords = book ? totalWords(book) : 0;

  const currentFrags = !onWritingPage && pages[currentPage] ? pages[currentPage] : [];
  const pageWords = useMemo(
    () => currentFrags.reduce((n, f) => n + countWords(f.text), 0),
    [currentFrags]
  );
  const currentTurn = currentFrags[0]
    ? book.turns.find((t) => t.id === currentFrags[0].turnId)
    : null;

  const counters = onWritingPage
    ? { page: draftWords, turn: draftWords, total: committedWords + draftWords }
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
      pendingJump.current = aiTurn ? aiTurn.id : null; // jump to where it began
      setAnimTurn(aiTurn ? aiTurn.id : null);
      setDraft("");
      setBook(data.book); // triggers repagination + the queued jump
    } catch {
      setBanner("Network error — your text is still here. Try again.");
    } finally {
      setGenerating(false);
    }
  }, [draft, generating, id]);

  const editFromHere = useCallback(
    async (turnId) => {
      if (!book) return;
      const idx = book.turns.findIndex((t) => t.id === turnId);
      if (idx < 0) return;
      const keepFrom = idx % 2 === 0 ? idx : idx - 1; // snap to a your-turn boundary
      const ok = window.confirm(
        "Editing from here discards this passage and everything after it — the book forks at this point. Continue?"
      );
      if (!ok) return;
      const recovered = book.turns[keepFrom] ? book.turns[keepFrom].text : "";
      await save({ truncateFrom: keepFrom });
      setDraft(recovered);
      setCurrentPage(Math.max(0, keepFrom));
      setBanner("");
      setTimeout(() => textareaRef.current && textareaRef.current.focus(), 60);
    },
    [book, save]
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
  const goWrite = () => setCurrentPage(writingIndex);

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
  const perWord = 26; // ms between revealed words (animation)

  // group a page's fragments into consecutive same-author runs (for ink boxes)
  function runsOf(frags) {
    const runs = [];
    for (const f of frags) {
      const last = runs[runs.length - 1];
      if (last && last.author === f.author && last.turnId === f.turnId) last.frags.push(f);
      else runs.push({ author: f.author, turnId: f.turnId, frags: [f] });
    }
    return runs;
  }

  const proseStyle = {
    fontFamily,
    fontSize: s.fontSize,
    lineHeight: LINE_H,
    height: contentH,
    "--para-gap": `${paraGap}px`,
  };

  return (
    <div className="studio">
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
                  onClick={() => setCurrentPage(turnStart[t.id] ?? 0)}
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

            <div className="page-viewport" ref={vpRef}>
              <div
                className="page-scaler"
                style={{ width: geom.w * scale, height: geom.h * scale }}
              >
                <div
                  className="page-shell"
                  style={{ width: geom.w, height: geom.h, transform: `scale(${scale})` }}
                >
                  <div className="page-stack" aria-hidden="true">
                    <i /><i /><i />
                  </div>

                  {onWritingPage ? (
                    <div
                      className={`book-page paper is-writing${generating ? " is-busy" : ""}`}
                      data-material={s.material}
                      style={{ padding: `${geom.padY}px ${geom.padX}px` }}
                    >
                      <div className="run-tab" data-author="user">
                        {book.turns.length === 0 ? "Open the book — your turn" : "Your turn"}
                      </div>
                      <textarea
                        ref={textareaRef}
                        className="write-area"
                        style={{ ...proseStyle, height: contentH }}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={onKeyDown}
                        disabled={generating}
                        placeholder={
                          book.turns.length === 0
                            ? "Begin your story. Write as much or as little as you like — the AI author will answer with about the same length, in your voice."
                            : "Write the next passage…"
                        }
                        autoFocus
                      />
                      <div className="folio">{pageCount ? writingIndex + 1 : 1}</div>
                    </div>
                  ) : (
                    <div
                      className="book-page paper"
                      data-material={s.material}
                      style={{ padding: `${geom.padY}px ${geom.padX}px` }}
                    >
                      <div className="page-prose" style={proseStyle}>
                        {runsOf(currentFrags).map((run, ri) => {
                          const isAI = run.author === "claude";
                          const animating = isAI && run.turnId === animTurn;
                          let wcount = 0;
                          return (
                            <div
                              key={ri}
                              className={`ink-run${isAI ? " ink-run--ai" : ""}${
                                animating ? " is-fresh" : ""
                              }`}
                              data-author={run.author}
                            >
                              {run.frags[0]?.turnStart && (
                                <div className="run-tab" data-author={run.author}>
                                  {authorName(run.author, book.author)}
                                </div>
                              )}
                              {run.frags.map((f, fi) =>
                                animating ? (
                                  <RevealParagraph
                                    key={fi}
                                    text={f.text}
                                    active
                                    delayStart={wcount}
                                    perWord={perWord}
                                    onWordCount={(n) => (wcount = n)}
                                  />
                                ) : (
                                  <p key={fi}>{f.text}</p>
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
                The AI author is writing about {draftWords} words in your voice…
              </div>
            )}

            <div className="dock">
              <div className="nav">
                <button
                  className="icon-btn"
                  onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                  disabled={currentPage <= 0}
                  aria-label="Previous page"
                >
                  ‹
                </button>
                <button
                  className="icon-btn"
                  onClick={() => setCurrentPage((p) => Math.min(pageCount - 1, p + 1))}
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
                  <div className="lab">Turn</div>
                </div>
                <div className="counter">
                  <div className="num">{counters.total}</div>
                  <div className="lab">Total</div>
                </div>
              </div>
              {onWritingPage ? (
                <button
                  className="btn btn-primary"
                  onClick={submitTurn}
                  disabled={generating || !draft.trim()}
                >
                  {generating ? "Weaving…" : "Hand to the AI author →"}
                </button>
              ) : usersMove ? (
                <button className="btn btn-primary" onClick={goWrite}>
                  Continue writing →
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <aside className="notes">
          <h2>Reader’s notes</h2>
          <div className="note-card">
            <div className="k">Genre</div>
            {a.genre ? (
              <span className="genre-tag">{a.genre}</span>
            ) : (
              <div className="v muted">Found after your first exchange</div>
            )}
          </div>
          <div className="note-card">
            <div className="k">Your writing style</div>
            <div className={`v${a.style ? "" : " muted"}`}>
              {a.style || "The AI author will describe your voice as the book grows."}
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
          <div className="notes-foot">
            <div>Your private link — return any time</div>
            <div className="share-row">
              <input
                readOnly
                value={shareUrl}
                aria-label="Shareable book link"
                onFocusCapture={(e) => e.target.select()}
              />
              <button className="btn" onClick={copyShare}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* offscreen measurer — same width + typography as a real page */}
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

      {settingsOpen && (
        <SettingsDrawer book={book} onClose={() => setSettingsOpen(false)} onSave={save} />
      )}
    </div>
  );
}
