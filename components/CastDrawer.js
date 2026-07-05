"use client";

import { useEffect, useState } from "react";
import { MAX_CHARACTERS } from "@/lib/book";

const newId = () => `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

// The cast sheet: author-confirmed character entries the AI must stay
// consistent with. The AI can propose entries from the manuscript; nothing
// lands on the sheet without appearing here first, where every field is
// editable — same philosophy as the arc's one-tap confirms.
export default function CastDrawer({ book, onSave, onClose }) {
  const [items, setItems] = useState(() => (Array.isArray(book.characters) ? book.characters : []));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const clean = (list) => list.filter((c) => c.name && c.name.trim());
  const commit = (next) => {
    setItems(next);
    onSave(clean(next));
  };
  const setField = (i, k, v) => setItems(items.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
  const blurSave = () => onSave(clean(items));
  const remove = (i) => commit(items.filter((_, idx) => idx !== i));
  const add = () => {
    if (items.length >= MAX_CHARACTERS) return;
    setItems([...items, { id: newId(), name: "", role: "", voice: "", notes: "" }]);
  };

  async function suggest() {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/books/${book.id}/cast/suggest`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(d.error || "Couldn't read the manuscript for characters.");
        return;
      }
      const have = new Set(items.map((c) => (c.name || "").trim().toLowerCase()));
      const fresh = (d.suggestions || [])
        .filter((s) => s.name && !have.has(s.name.trim().toLowerCase()))
        .slice(0, Math.max(0, MAX_CHARACTERS - items.length))
        .map((s) => ({ id: newId(), ...s }));
      if (!fresh.length) {
        setMsg("No new characters found — the sheet already covers the cast.");
        return;
      }
      commit([...items, ...fresh]);
      setMsg(`Added ${fresh.length} — review and edit each entry below.`);
    } catch {
      setMsg("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog" aria-modal="true" aria-label="Cast sheet">
        <div className="drawer-head">
          <h3>Cast</h3>
          <button className="btn btn-ghost x" onClick={onClose} aria-label="Close">
            Done
          </button>
        </div>

        <p className="arc-help">
          The characters the AI must keep straight — names, roles, and how each one talks. The sheet is
          authoritative: it's sent with every section, rewrite, and consistency check. Let the AI propose
          entries from the manuscript, then edit them into shape.
        </p>

        <div className="cast-actions">
          <button className="btn btn-primary" onClick={suggest} disabled={busy || (book.turns || []).length === 0}>
            {busy ? "Reading the manuscript…" : "✦ Suggest from the manuscript"}
          </button>
          {msg && <div className="cast-msg">{msg}</div>}
        </div>

        <div className="arc-list">
          {items.length === 0 && <div className="arc-empty">No characters on the sheet yet.</div>}
          {items.map((c, i) => (
            <div className="arc-item cast-item" key={c.id}>
              <div className="cast-row">
                <input
                  className="text-input cast-name"
                  value={c.name}
                  maxLength={80}
                  placeholder="Name"
                  onChange={(e) => setField(i, "name", e.target.value)}
                  onBlur={blurSave}
                />
                <input
                  className="text-input cast-role"
                  value={c.role}
                  maxLength={160}
                  placeholder="Role — who they are"
                  onChange={(e) => setField(i, "role", e.target.value)}
                  onBlur={blurSave}
                />
              </div>
              <input
                className="text-input cast-voice"
                value={c.voice}
                maxLength={200}
                placeholder="Voice — how they talk"
                onChange={(e) => setField(i, "voice", e.target.value)}
                onBlur={blurSave}
              />
              <textarea
                className="arc-text"
                rows={2}
                maxLength={400}
                value={c.notes}
                placeholder="Notes — goals, secrets, facts to keep straight"
                onChange={(e) => setField(i, "notes", e.target.value)}
                onBlur={blurSave}
              />
              <div className="arc-item-foot">
                <span className="arc-pace-hint" />
                <button className="arc-remove" onClick={() => remove(i)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>

        {items.length < MAX_CHARACTERS && (
          <button className="arc-add" onClick={add}>
            + Add a character
          </button>
        )}
      </div>
    </div>
  );
}
