"use client";

import { useEffect, useState } from "react";

const PACES = [
  ["soon", "Soon", "actively steer toward this now"],
  ["gradually", "Gradually", "gentle, natural progress — develop, don't resolve"],
  ["eventually", "Eventually", "a distant horizon — only the faintest drift"],
];
const MAX = 3;
const newId = () => `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

export default function ArcDrawer({ arc, analysis, onSave, onClose }) {
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
          Up to three long-range headings. The AI works them in gently across many sections — at the pace you
          choose — instead of forcing them into the next one. Reader’s notes track progress toward each.
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
