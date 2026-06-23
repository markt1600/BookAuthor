"use client";

import { useEffect, useState } from "react";

const PACES = [
  ["soon", "Soon (~2–3 sections)", "land it within about 2–3 sections"],
  ["gradually", "Gradually (~6–8 sections)", "gentle progress, landing over ~6–8 sections"],
  ["eventually", "Eventually (~12+ sections)", "a distant horizon, a dozen-plus sections out"],
];
const MAX = 3;
const newId = () => `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

export default function ArcDrawer({ arc, analysis, sections = 0, onSave, onClose }) {
  const [items, setItems] = useState(() => (Array.isArray(arc) ? arc : []));

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Progress lines from the latest analysis, aligned to headings by order.
  const progress = (analysis && analysis.arcProgress ? analysis.arcProgress : "")
    .split(/\n+/)
    .map((l) => l.replace(/^[\s•\-–*\d.]+/, "").trim())
    .filter(Boolean);

  const commit = (next) => {
    setItems(next);
    onSave(next.filter((i) => i.text.trim()));
  };
  const setText = (i, v) => setItems(items.map((it, idx) => (idx === i ? { ...it, text: v } : it)));
  const setPace = (i, v) => commit(items.map((it, idx) => (idx === i ? { ...it, pace: v } : it)));
  const remove = (i) => commit(items.filter((_, idx) => idx !== i));
  const add = () => {
    if (items.length >= MAX) return;
    setItems([...items, { id: newId(), text: "", pace: "gradually" }]);
  };
  const blurSave = () => onSave(items.filter((i) => i.text.trim()));

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog" aria-modal="true" aria-label="Where the story is heading">
        <div className="drawer-head">
          <h3>Where it’s heading</h3>
          <button className="btn btn-ghost x" onClick={onClose} aria-label="Close">
            Done
          </button>
        </div>

        <p className="arc-help">
          Up to three long-range headings — where the story is ultimately going, not what happens next. Unlike a
          section’s direction (which the AI fulfills now), a heading is paced in over many sections at the horizon you
          choose. Reader’s notes track progress, and the AI is told when one is coming due.
        </p>

        <div className="arc-list">
          {items.length === 0 && (
            <div className="arc-empty">No headings yet. Add where the story is ultimately going.</div>
          )}
          {items.map((it, i) => (
            <div className="arc-item" key={it.id}>
              <textarea
                className="arc-text"
                rows={2}
                maxLength={400}
                value={it.text}
                placeholder="e.g. Edda comes to suspect her sister faked the death"
                onChange={(e) => setText(i, e.target.value)}
                onBlur={blurSave}
              />
              <div className="arc-item-foot">
                <label className="arc-pace-label">
                  Pace
                  <select className="arc-pace" value={it.pace} onChange={(e) => setPace(i, e.target.value)}>
                    {PACES.map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="arc-pace-hint">{(PACES.find((p) => p[0] === it.pace) || PACES[1])[2]}</span>
                <button className="arc-remove" onClick={() => remove(i)}>
                  Remove
                </button>
              </div>
              {it.text.trim() && Number.isFinite(it.bornTurns) && (
                <div className="arc-elapsed">
                  running {Math.max(0, sections - it.bornTurns)} section
                  {Math.max(0, sections - it.bornTurns) === 1 ? "" : "s"}
                </div>
              )}
              {it.text.trim() && progress[i] && (
                <div className="arc-progress">
                  <span className="arc-progress-k">Progress</span> {progress[i]}
                </div>
              )}
            </div>
          ))}
        </div>

        {items.length < MAX && (
          <button className="arc-add" onClick={add}>
            + Add a heading
          </button>
        )}
      </div>
    </div>
  );
}
