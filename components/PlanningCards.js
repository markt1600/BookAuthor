"use client";

import { useState } from "react";
import { currentChapterNum, finishOutlook, latestAudit, totalWords } from "@/lib/book";
import { BRIEF_FIELDS, ENDGAME_MAX, OUTLINE_MAX, briefConfirmed, briefProposed, lengthPosition, outlineLastNum } from "@/lib/storyplan";

// The planning layer of the reader's notes: THE BRIEF (what the book is trying
// to be), THE OUTLINE (the next few chapters), and THE CHAPTER AUDIT (the deep
// read made each time a chapter closes) — and FINISH THE BOOK, which plans the
// outline to the last chapter and writes it. `save(patch)` is the page's normal
// PUT; `onBook(book)` replaces the book after a server-side redraw; `finishRun`
// is the page's handle on the run ({ running, stopping, busy, start, stop }).
export default function PlanningCards({ book, id, ended, save, onBook, finishRun }) {
  return (
    <>
      <BriefCard book={book} id={id} save={save} />
      {!ended && <OutlineCard book={book} id={id} save={save} onBook={onBook} locked={Boolean(finishRun && finishRun.running)} />}
      {!ended && book.mode === "guide" && finishRun && <FinishCard book={book} id={id} onBook={onBook} run={finishRun} />}
      <AuditCard book={book} />
    </>
  );
}

const emptyBrief = () => ({ premise: "", promise: "", ending: "", themes: "", avoid: "", targetWords: "" });

function BriefCard({ book, id, save }) {
  const brief = book.brief;
  const confirmed = briefConfirmed(brief);
  const proposed = briefProposed(brief);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(emptyBrief());
  const [busy, setBusy] = useState(""); // "" | "drafting" | "saving"
  const [err, setErr] = useState("");

  const open = (from) => {
    setDraft({ ...emptyBrief(), ...(from || {}), targetWords: from && from.targetWords ? String(from.targetWords) : "" });
    setErr("");
    setEditing(true);
  };

  async function draftFromStory() {
    setBusy("drafting");
    setErr("");
    try {
      const res = await fetch(`/api/books/${id}/brief`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.brief) setErr(data.error || "Couldn't draft a brief — try again.");
      else open(data.brief);
    } catch {
      setErr("Network error — try again.");
    }
    setBusy("");
  }

  async function commit(patch) {
    setBusy("saving");
    const ok = await save(patch);
    setBusy("");
    if (ok) setEditing(false);
    else setErr("Couldn't save the brief — try again.");
  }

  const total = totalWords(book);
  return (
    <div className="note-card">
      <div className="k">
        The brief{proposed && !editing ? " — proposed" : ""}
        {confirmed && !editing ? <span className="plan-tag">in use</span> : null}
      </div>
      {editing ? (
        <>
          {BRIEF_FIELDS.map((f) => (
            <label className="brief-field" key={f.key}>
              <span>{f.label}</span>
              <textarea
                className="arc-text bible-edit"
                rows={f.key === "premise" ? 3 : 2}
                maxLength={f.max}
                value={draft[f.key] || ""}
                placeholder={f.hint}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              />
            </label>
          ))}
          <label className="brief-field">
            <span>Target length (words)</span>
            <input
              className="arc-text"
              inputMode="numeric"
              value={draft.targetWords}
              placeholder="e.g. 80000 — leave empty for no target"
              onChange={(e) => setDraft((d) => ({ ...d, targetWords: e.target.value.replace(/[^\d,]/g, "") }))}
            />
          </label>
          <div className="bible-actions">
            <button className="btn btn-primary" onClick={() => commit({ brief: draft })} disabled={!!busy}>
              {busy === "saving" ? "Saving…" : "Save brief"}
            </button>
            <button className="btn btn-ghost" onClick={() => setEditing(false)} disabled={!!busy}>
              Cancel
            </button>
          </div>
          <div className="tells-hint">
            Saving confirms the brief. From then on every closed chapter is audited against it, the outline
            steers toward its ending, and the next-section suggestions aim at the book it describes.
          </div>
        </>
      ) : confirmed || proposed ? (
        <>
          <dl className="brief-view">
            {BRIEF_FIELDS.filter((f) => brief[f.key]).map((f) => (
              <div key={f.key}>
                <dt>{f.label}</dt>
                <dd>{brief[f.key]}</dd>
              </div>
            ))}
          </dl>
          {brief.targetWords > 0 && (
            <div className="v brief-length">
              {lengthPosition(brief, total) || `Target length: about ${brief.targetWords.toLocaleString()} words.`}
            </div>
          )}
          {proposed ? (
            <>
              <div className="tells-hint">
                The AI drafted this from the story so far. It is not used anywhere until you confirm it —
                correct anything it got wrong first.
              </div>
              <div className="bible-actions">
                <button className="btn btn-primary" onClick={() => commit({ brief })} disabled={!!busy}>
                  {busy === "saving" ? "Saving…" : "✓ Use this brief"}
                </button>
                <button className="btn btn-ghost" onClick={() => open(brief)} disabled={!!busy}>
                  Edit
                </button>
                <button className="btn btn-ghost" onClick={() => commit({ brief: null })} disabled={!!busy}>
                  Dismiss
                </button>
              </div>
            </>
          ) : (
            <button className="bible-edit-btn" onClick={() => open(brief)}>
              Edit brief
            </button>
          )}
        </>
      ) : (
        <>
          <div className="v muted">
            Say what this book is trying to be — its premise, its promise to the reader, the shape of the
            ending, how long it should run. Each chapter is then audited against it and the outline steers
            toward it.
          </div>
          <div className="bible-actions">
            {(book.turns || []).length > 0 && (
              <button className="bible-edit-btn" onClick={draftFromStory} disabled={!!busy}>
                {busy === "drafting" ? "Reading the story…" : "✦ Draft it from the story"}
              </button>
            )}
            <button className="bible-edit-btn" onClick={() => open(null)} disabled={!!busy}>
              ＋ Write it myself
            </button>
          </div>
        </>
      )}
      {err && <div className="pw-err" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}

// Finish the book: plan every remaining chapter, then let the AI write them.
function FinishCard({ book, id, onBook, run }) {
  const [busy, setBusy] = useState(""); // "" | "planning" | "cancelling"
  const [err, setErr] = useState("");
  const f = book.finish;
  const last = outlineLastNum(book.outline);
  const planned = Boolean(f && last && f.status !== "done");
  const look = finishOutlook(book);
  const hasBrief = briefConfirmed(book.brief);
  const canPlan = (book.turns || []).length > 0 || hasBrief;

  async function call(action) {
    setBusy(action === "cancel" ? "cancelling" : "planning");
    setErr("");
    try {
      const res = await fetch(`/api/books/${id}/finish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.book) setErr(data.error || "Couldn't draw up a plan to the end — try again.");
      else onBook(data.book);
    } catch {
      setErr("Network error — try again.");
    }
    setBusy("");
  }

  const c = f && f.chapter;
  const midChapter = c && c.done < c.directions.length;
  const now = midChapter
    ? `chapter ${c.num}${last ? ` of ${last}` : ""}, section ${c.done + 1} of ${c.directions.length}`
    : last
      ? `chapter ${Math.min(last, look.cur + (c ? 1 : 0))} of ${last}`
      : "";
  const resumed = Boolean(f && f.sections > 0);
  return (
    <div className="note-card">
      <div className="k">
        Finish the book
        {run.running ? <span className="plan-tag">writing</span> : planned ? <span className="plan-tag">{resumed ? "paused" : "planned"}</span> : null}
      </div>
      {planned ? (
        <>
          <div className="v">
            {run.running ? "Writing " : resumed ? "Paused at " : "Starts at "}
            {now}. About {look.chaptersLeft} chapter{look.chaptersLeft === 1 ? "" : "s"}, {look.sectionsLeft} section
            {look.sectionsLeft === 1 ? "" : "s"} and {look.wordsLeft.toLocaleString()} words to go
            {look.targetWords ? ` — the brief plans ${look.targetWords.toLocaleString()} in all` : ""}.
          </div>
          {midChapter && (
            <ol className="finish-steps">
              {c.directions.map((d, i) => (
                <li key={i} data-state={i < c.done ? "done" : i === c.done ? "now" : undefined}>
                  {d}
                </li>
              ))}
            </ol>
          )}
          <div className="bible-actions">
            {run.running ? (
              <button className="btn btn-ghost" onClick={run.stop} disabled={run.stopping}>
                {run.stopping ? "Stopping after this section…" : "⏸ Stop after this section"}
              </button>
            ) : (
              <>
                <button className="btn btn-primary" onClick={run.start} disabled={!!busy || run.busy}>
                  {resumed ? "▶ Resume" : "▶ Write it to the end"}
                </button>
                <button className="bible-edit-btn" onClick={() => call("plan")} disabled={!!busy || run.busy}>
                  {busy === "planning" ? "Replanning…" : "↻ Replan"}
                </button>
                <button className="bible-edit-btn" onClick={() => call("cancel")} disabled={!!busy || run.busy}>
                  Discard plan
                </button>
              </>
            )}
          </div>
          <div className="tells-hint">
            {run.running
              ? "Each chapter is audited against the brief and the outline as it closes, and the chapters still to come are redrawn from what it actually did. Keep this page open; stop at any time and the section in flight still lands."
              : "The outline above now runs to the last chapter — read it, and edit anything you want changed (your edits are pinned) before you start. The run writes one section at a time through the normal pipeline, opens each chapter itself, and marks the book ended after the final one."}
          </div>
        </>
      ) : (
        <>
          <div className="v muted">
            Let the AI write the rest: it plans every remaining chapter through to the ending, shows you the
            plan, then writes it chapter by chapter — consistent with the brief, the outline, the canon and
            everything still open in the story.
          </div>
          {!hasBrief && (
            <div className="tells-hint">
              No brief is confirmed, so the plan will follow where the story itself is pointing. Confirm a
              brief first to fix the destination and the length.
            </div>
          )}
          <div className="bible-actions">
            <button className="bible-edit-btn" onClick={() => call("plan")} disabled={!!busy || run.busy || !canPlan}>
              {busy === "planning" ? "Planning to the end…" : "✦ Plan the rest of the book"}
            </button>
          </div>
        </>
      )}
      {err && <div className="pw-err" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}

function OutlineCard({ book, id, save, onBook, locked }) {
  const outline = book.outline;
  const last = outlineLastNum(outline);
  const cur = currentChapterNum(book);
  const ahead = ((outline && outline.chapters) || []).filter((e) => e.num >= cur);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ through: "", chapters: [] });
  const [busy, setBusy] = useState(""); // "" | "drawing" | "saving"
  const [err, setErr] = useState("");
  const hasText = (book.turns || []).length > 0;

  const open = () => {
    setDraft({
      through: (outline && outline.through) || "",
      chapters: ahead.length ? ahead.map((e) => ({ ...e })) : [{ num: cur, title: "", summary: "", pinned: true }],
    });
    setErr("");
    setEditing(true);
  };
  const setEntry = (i, patch) =>
    setDraft((d) => ({ ...d, chapters: d.chapters.map((e, j) => (j === i ? { ...e, ...patch } : e)) }));
  const addEntry = () =>
    setDraft((d) => {
      const next = d.chapters.length ? Math.max(...d.chapters.map((e) => e.num)) + 1 : cur;
      return { ...d, chapters: [...d.chapters, { num: next, title: "", summary: "", pinned: true }] };
    });

  async function redraw() {
    setBusy("drawing");
    setErr("");
    try {
      const res = await fetch(`/api/books/${id}/outline`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.book) setErr(data.error || "Couldn't draw up an outline — try again.");
      else onBook(data.book);
    } catch {
      setErr("Network error — try again.");
    }
    setBusy("");
  }

  async function commit() {
    setBusy("saving");
    const chapters = draft.chapters.filter((e) => (e.summary || "").trim());
    const ok = await save({ outline: chapters.length || draft.through.trim() ? { through: draft.through, chapters } : null });
    setBusy("");
    if (ok) setEditing(false);
    else setErr("Couldn't save the outline — try again.");
  }

  if (!hasText && !outline) return null;
  return (
    <div className="note-card">
      <div className="k">
        {last ? "The outline — to the end" : "The outline — next chapters"}
        {last ? <span className="plan-tag">{ahead.length} to go</span> : null}
      </div>
      {editing ? (
        <>
          <label className="brief-field">
            <span>Through-line to the ending</span>
            <textarea
              className="arc-text bible-edit"
              rows={2}
              maxLength={400}
              value={draft.through}
              placeholder="What the rest of the book has to accomplish."
              onChange={(e) => setDraft((d) => ({ ...d, through: e.target.value }))}
            />
          </label>
          {draft.chapters.map((e, i) => (
            <div className="outline-edit" key={i}>
              <div className="outline-edit-head">
                <span className="ledger-ch">ch {e.num}</span>
                <input
                  className="arc-text"
                  value={e.title || ""}
                  maxLength={80}
                  placeholder="Working title"
                  onChange={(ev) => setEntry(i, { title: ev.target.value })}
                />
                <button
                  className="outline-x"
                  title="Remove this chapter from the outline"
                  onClick={() => setDraft((d) => ({ ...d, chapters: d.chapters.filter((_, j) => j !== i) }))}
                >
                  ✕
                </button>
              </div>
              <textarea
                className="arc-text bible-edit"
                rows={2}
                maxLength={360}
                value={e.summary || ""}
                placeholder="What happens, and what it changes."
                onChange={(ev) => setEntry(i, { summary: ev.target.value })}
              />
            </div>
          ))}
          {draft.chapters.length < (last ? ENDGAME_MAX : OUTLINE_MAX) && (
            <button className="bible-edit-btn" onClick={addEntry}>
              ＋ Add a chapter
            </button>
          )}
          <div className="bible-actions">
            <button className="btn btn-primary" onClick={commit} disabled={!!busy}>
              {busy === "saving" ? "Saving…" : "Save outline"}
            </button>
            <button className="btn btn-ghost" onClick={() => setEditing(false)} disabled={!!busy}>
              Cancel
            </button>
          </div>
          <div className="tells-hint">
            Any chapter you write or change here is pinned: the AI keeps it as written and redraws the others
            around it.
          </div>
        </>
      ) : ahead.length || (outline && outline.through) ? (
        <>
          {outline.through && <div className="v outline-through">{outline.through}</div>}
          <div className="outline-list">
            {ahead.map((e) => (
              <div className="outline-row" data-now={e.num === cur ? "1" : undefined} key={e.id || e.num}>
                <div className="outline-head">
                  <span className="ledger-ch">ch {e.num}</span>
                  {e.title && <span className="outline-title">{e.title}</span>}
                  {e.num === cur && <span className="plan-tag">writing now</span>}
                  {last > 0 && e.num === last && <span className="plan-tag">final chapter</span>}
                  {e.pinned && <span className="plan-tag plan-tag-pin" title="Set by you — kept when the outline is redrawn">pinned</span>}
                </div>
                <div className="outline-sum">{e.summary}</div>
              </div>
            ))}
          </div>
          <div className="bible-actions">
            <button className="bible-edit-btn" onClick={open} disabled={!!busy || locked}>
              Edit outline
            </button>
            <button className="bible-edit-btn" onClick={redraw} disabled={!!busy || locked}>
              {busy === "drawing" ? "Redrawing…" : "↻ Redraw"}
            </button>
          </div>
          <div className="tells-hint">
            A working plan, redrawn each time a chapter closes from where the story actually stands. The
            planner works toward it, but your direction for a section always wins.
          </div>
        </>
      ) : (
        <>
          <div className="v muted">
            A plan for the next few chapters. It draws itself when the first chapter closes — or draw one
            up now.
          </div>
          <div className="bible-actions">
            <button className="bible-edit-btn" onClick={redraw} disabled={!!busy}>
              {busy === "drawing" ? "Reading the story…" : "✦ Draw up an outline"}
            </button>
            <button className="bible-edit-btn" onClick={open} disabled={!!busy}>
              ＋ Write it myself
            </button>
          </div>
        </>
      )}
      {err && <div className="pw-err" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}

const VERDICT_TONE = {
  "ON COURSE": "good",
  DELIVERED: "good",
  DRIFTING: "warn",
  PARTLY: "warn",
  "OFF COURSE": "bad",
  DIVERGED: "warn",
};

function AuditCard({ book }) {
  const note = latestAudit(book);
  if (!note) return null;
  const a = note.audit;
  const rulings = [...(a.holes || []), ...(a.newHoles || []).map((line) => ({ line, status: "new", note: "" }))];
  return (
    <div className="note-card">
      <div className="k">
        Chapter audit — chapter {note.num}
        {note.title ? ` · ${note.title}` : ""}
      </div>
      {a.accomplished && <div className="v">{a.accomplished}</div>}
      {[
        ["Against the brief", a.aims],
        ["Against the outline", a.outline],
      ]
        .filter(([, v]) => v && v.verdict)
        .map(([label, v]) => (
          <div className="audit-verdict" key={label}>
            <span className="audit-verdict-k">{label}</span>
            <span className="audit-badge" data-tone={VERDICT_TONE[v.verdict] || "warn"}>
              {v.verdict}
            </span>
            {v.note && <span className="audit-verdict-note">{v.note}</span>}
          </div>
        ))}
      {a.position && (
        <>
          <div className="critique-h audit-h">Where the book stands</div>
          <div className="v">{a.position}</div>
        </>
      )}
      {a.carry && (
        <>
          <div className="critique-h audit-h">Carries into the next chapter</div>
          <div className="v" style={{ whiteSpace: "pre-line" }}>
            {a.carry}
          </div>
        </>
      )}
      {rulings.length > 0 && (
        <>
          <div className="critique-h audit-h">Plot holes — the ruling</div>
          <div className="ledger-list">
            {rulings.map((h, i) => (
              <div
                className="ledger-row audit-hole"
                data-kind={h.status === "repaired" || h.status === "dismissed" ? "paid" : "stale"}
                key={i}
              >
                <span className="ledger-text" title={h.note || undefined}>
                  {h.line}
                </span>
                <span className="ledger-status">{h.status}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="tells-hint">
        A deep read of the whole chapter, made once when it closed. Gaps it found repaired or not real are
        struck from the open list; the ones it confirmed stay until the text fixes them.
      </div>
    </div>
  );
}
