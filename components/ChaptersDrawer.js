"use client";

import { useEffect, useState } from "react";

export default function ChaptersDrawer({ book, currentTurnId, turnStart, onJump, onClose, onSave }) {
  const [list, setList] = useState(() =>
    (book.chapters || []).map((c) => ({ ...c })).sort((a, b) => a.startTurn - b.startTurn)
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const turns = book.turns || [];
  const turnIndexOf = (id) => turns.findIndex((t) => t.id === id);
  const pageOf = (startTurn) => {
    const t = turns[startTurn];
    return t ? turnStart[t.id] ?? 0 : 0;
  };
  const currentIdx = currentTurnId != null ? turnIndexOf(currentTurnId) : -1;
  const canAddHere = currentIdx >= 0 && !list.some((c) => c.startTurn === currentIdx);

  const sort = (l) => [...l].sort((a, b) => a.startTurn - b.startTurn);
  function setTitle(i, v) {
    setList((l) => l.map((c, idx) => (idx === i ? { ...c, title: v } : c)));
  }
  function remove(i) {
    setList((l) => l.filter((_, idx) => idx !== i));
  }
  function addHere() {
    if (!canAddHere) return;
    setList((l) => sort([...l, { startTurn: currentIdx, title: "" }]));
  }
  async function save() {
    setSaving(true);
    await onSave({ chapters: list });
    setSaving(false);
    onClose();
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog" aria-modal="true" aria-label="Chapters">
        <div className="drawer-head">
          <h2>Chapters</h2>
          <button className="btn btn-ghost x" onClick={onClose} aria-label="Close chapters">
            Close
          </button>
        </div>

        <p className="drawer-hint">
          Chapters open on a fresh page. Mark one at the current page, then name them
          here — names can be changed any time.
        </p>

        <button className="btn chap-add" onClick={addHere} disabled={!canAddHere}>
          {currentIdx < 0
            ? "Open a page to add a chapter there"
            : canAddHere
            ? "＋ New chapter at the current page"
            : "A chapter already starts here"}
        </button>

        {list.length === 0 ? (
          <div className="chap-empty">No chapters yet — the book reads as one continuous piece.</div>
        ) : (
          <ol className="chapter-list">
            {list.map((c, i) => (
              <li className="chapter-item" key={c.id || c.startTurn}>
                <div className="chapter-num">Ch. {i + 1}</div>
                <div className="chapter-body">
                  <input
                    className="text-input"
                    value={c.title}
                    placeholder="Untitled chapter"
                    onChange={(e) => setTitle(i, e.target.value)}
                  />
                  <div className="chapter-meta">
                    <button className="linkish" onClick={() => onJump(pageOf(c.startTurn))}>
                      Go to page {pageOf(c.startTurn) + 1}
                    </button>
                    <button className="linkish danger" onClick={() => remove(i)}>
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}

        <div className="continue-row" style={{ marginTop: 26, justifyContent: "stretch" }}>
          <button className="btn btn-primary" style={{ width: "100%" }} onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save chapters"}
          </button>
        </div>
      </div>
    </div>
  );
}
