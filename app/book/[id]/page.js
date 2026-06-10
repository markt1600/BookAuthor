"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { countWords, isUsersMove, totalWords } from "@/lib/book";
import SettingsDrawer from "@/components/SettingsDrawer";

function Paragraphs({ text }) {
  const parts = String(text).split(/\n{2,}/);
  return (
    <>
      {parts.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </>
  );
}

export default function BookStudio() {
  const params = useParams();
  const id = params.id;

  const [book, setBook] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | notfound | error
  const [currentPage, setCurrentPage] = useState(0);
  const [draft, setDraft] = useState("");
  const [generating, setGenerating] = useState(false);
  const [banner, setBanner] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const textareaRef = useRef(null);

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
        setCurrentPage(book.turns.length); // start at the writing tip
      } catch {
        if (alive) setStatus("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  // ---- restore an in-progress draft after a refresh ----
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
  const turnCount = book ? book.turns.length : 0;
  const writingIndex = turnCount;
  const pageCount = turnCount + (usersMove ? 1 : 0);
  const onWritingPage = usersMove && currentPage === writingIndex;

  // keep page index in range as the book changes
  useEffect(() => {
    if (!book) return;
    if (currentPage > pageCount - 1) setCurrentPage(pageCount - 1);
    if (currentPage < 0) setCurrentPage(0);
  }, [book, pageCount, currentPage]);

  const draftWords = useMemo(() => countWords(draft), [draft]);
  const committedWords = book ? totalWords(book) : 0;

  // counters for the page currently shown
  const counters = useMemo(() => {
    if (onWritingPage) {
      return { page: draftWords, turn: draftWords, total: committedWords + draftWords };
    }
    const t = book && book.turns[currentPage];
    const w = t ? t.words : 0;
    return { page: w, turn: w, total: committedWords };
  }, [onWritingPage, draftWords, committedWords, book, currentPage]);

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
        setBanner(data.error || "Claude could not continue. Try again.");
        setGenerating(false);
        return;
      }
      setBook(data.book);
      setDraft("");
      setCurrentPage(data.book.turns.length); // new writing tip
    } catch {
      setBanner("Network error — your text is still here. Try again.");
    } finally {
      setGenerating(false);
    }
  }, [draft, generating, id]);

  // Fork: pull the chosen turn (mapped to its user-turn boundary) back into the
  // editor and discard everything from there on.
  const editFromHere = useCallback(
    async (turnIndex) => {
      if (!book) return;
      const targetUser = turnIndex % 2 === 0 ? turnIndex : turnIndex - 1; // even = user turn
      const keepFrom = Math.max(0, targetUser);
      const ok = window.confirm(
        "Editing from here discards this passage and everything after it — the book forks at this point. Continue?"
      );
      if (!ok) return;
      const recoveredText = book.turns[keepFrom] ? book.turns[keepFrom].text : "";
      await save({ truncateFrom: keepFrom });
      setDraft(recoveredText);
      setCurrentPage(keepFrom);
      setBanner("");
      setTimeout(() => textareaRef.current && textareaRef.current.focus(), 50);
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

  // keyboard: Cmd/Ctrl+Enter hands the turn to Claude
  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submitTurn();
    }
  }

  if (status === "loading") {
    return (
      <div className="screen-center">
        <div>
          <p className="big">Opening the book…</p>
          <p className="sub">Fetching your manuscript.</p>
        </div>
      </div>
    );
  }
  if (status === "notfound") {
    return (
      <div className="screen-center">
        <div>
          <p className="big">No book at this address</p>
          <p className="sub">This link may be wrong, or the book was never created.</p>
          <a className="btn btn-primary" href="/">Start a new book</a>
        </div>
      </div>
    );
  }
  if (status === "error" || !book) {
    return (
      <div className="screen-center">
        <div>
          <p className="big">Something went wrong</p>
          <p className="sub">We couldn’t load this book. Refresh to try again.</p>
          <button className="btn" onClick={() => location.reload()}>Refresh</button>
        </div>
      </div>
    );
  }

  const s = book.settings;
  const sheetProps = {
    "data-material": s.material,
    "data-format": s.format,
    "data-font": s.font,
  };
  const a = book.analysis || {};

  return (
    <div className="studio">
      {/* ---------- top bar ---------- */}
      <header className="topbar">
        <div className="topbar-title">
          <h1>{book.title}</h1>
          <span className="by">by {book.author}</span>
        </div>

        <div className="topbar-spacer" />

        {/* spine ledger — the whole collaboration at a glance */}
        <div className="ledger" title="The book so far — each band is one turn">
          {turnCount === 0 && !generating ? (
            <span className="ledger-empty">blank manuscript</span>
          ) : (
            <>
              {book.turns.map((t, i) => (
                <span
                  key={t.id}
                  className="ledger-band"
                  data-author={t.author}
                  data-current={!onWritingPage && i === currentPage}
                  onClick={() => setCurrentPage(i)}
                  style={{ flexGrow: Math.max(1, t.words) }}
                  title={`${t.author === "user" ? "You" : "Claude"} · ${t.words} words`}
                />
              ))}
              {generating && <span className="ledger-band is-draft" style={{ flexGrow: Math.max(1, draftWords) }} />}
              {!generating && usersMove && (
                <span
                  className="ledger-band is-draft"
                  data-current={onWritingPage}
                  onClick={() => setCurrentPage(writingIndex)}
                  style={{ flexGrow: Math.max(1, draftWords || 8) }}
                  title="Your turn in progress"
                />
              )}
            </>
          )}
        </div>

        <div className="topbar-actions">
          <button className="btn btn-ghost" onClick={exportPdf}>Export PDF</button>
          <button className="btn" onClick={() => setSettingsOpen(true)}>Settings</button>
        </div>
      </header>

      <div className="work">
        {/* ---------- stage ---------- */}
        <div className="stage">
          <div className="stage-col">
            {banner && <div className="banner">{banner}</div>}

            <div
              className={`sheet${onWritingPage ? " is-writing" : ""}`}
              {...sheetProps}
              style={{ fontSize: s.fontSize }}
            >
              {onWritingPage ? (
                <>
                  <div className="write-prompt">
                    <span className="turn-rule" />
                    <span className="turn-label" style={{ color: "var(--brass)" }}>
                      {turnCount === 0 ? "Open the book — your turn" : "Your turn"}
                    </span>
                  </div>
                  <textarea
                    ref={textareaRef}
                    className="write-area sheet-prose"
                    style={{ fontSize: s.fontSize }}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onKeyDown}
                    disabled={generating}
                    placeholder={
                      turnCount === 0
                        ? "Begin your story. Write as much or as little as you like — Claude will answer with about the same length, in your voice."
                        : "Write the next passage…"
                    }
                    autoFocus
                  />
                </>
              ) : (
                <article className="sheet-prose">
                  <div className="turn-head">
                    <span className="turn-rule" data-author={book.turns[currentPage].author} />
                    <span className="turn-label" data-author={book.turns[currentPage].author}>
                      {book.turns[currentPage].author === "user" ? "Written by you" : "Written by Claude"}
                    </span>
                    <span className="turn-meta">{book.turns[currentPage].words} words</span>
                  </div>
                  <Paragraphs text={book.turns[currentPage].text} />
                  <div className="edit-here">
                    <button onClick={() => editFromHere(currentPage)}>Edit from here ↺</button>
                  </div>
                </article>
              )}
            </div>

            {generating && (
              <div className="thinking">
                <span className="pulse"><i /><i /><i /></span>
                Claude is writing about {draftWords} words in your voice…
              </div>
            )}

            {/* ---------- dock ---------- */}
            <div className="dock" style={{ "--measure": "33rem" }}>
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
                {onWritingPage ? "Writing" : `Page ${currentPage + 1}`} of {pageCount}
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
                <button className="btn btn-primary" onClick={submitTurn} disabled={generating || !draft.trim()}>
                  {generating ? "Weaving…" : "Hand to Claude →"}
                </button>
              ) : usersMove ? (
                <button className="btn btn-primary" onClick={() => setCurrentPage(writingIndex)}>
                  Continue writing →
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {/* ---------- reader's notes sidebar ---------- */}
        <aside className="notes">
          <h2>Reader’s notes</h2>

          <div className="note-card">
            <div className="k">Genre</div>
            {a.genre ? <span className="genre-tag">{a.genre}</span> : <div className="v muted">Found after your first exchange</div>}
          </div>

          <div className="note-card">
            <div className="k">Your writing style</div>
            <div className={`v${a.style ? "" : " muted"}`}>{a.style || "Claude will describe your voice as the book grows."}</div>
          </div>

          <div className="note-card">
            <div className="k">Synopsis so far</div>
            <div className={`v${a.synopsis ? "" : " muted"}`}>{a.synopsis || "Nothing written yet."}</div>
          </div>

          <div className="note-card">
            <div className="k">Craft</div>
            {a.qualityScore != null ? (
              <div className="quality">
                <div className="score">{a.qualityScore}<small>/100</small></div>
                <div className="meter"><i style={{ width: `${a.qualityScore}%` }} /></div>
              </div>
            ) : (
              <div className="v muted">Unscored</div>
            )}
            {a.quality && <div className="v" style={{ marginTop: 10 }}>{a.quality}</div>}
          </div>

          <div className="notes-foot">
            <div>Your private link — return any time</div>
            <div className="share-row">
              <input readOnly value={shareUrl} aria-label="Shareable book link" onFocusCapture={(e) => e.target.select()} />
              <button className="btn" onClick={copyShare}>{copied ? "Copied" : "Copy"}</button>
            </div>
          </div>
        </aside>
      </div>

      {settingsOpen && (
        <SettingsDrawer book={book} onClose={() => setSettingsOpen(false)} onSave={save} />
      )}
    </div>
  );
}
