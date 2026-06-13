"use client";

import { useEffect, useState } from "react";

function ago(ts) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export default function HistoryDrawer({ bookId, onClose, onRestore }) {
  const [snaps, setSnaps] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/books/${bookId}/history`);
        const data = await res.json();
        if (alive) setSnaps(res.ok ? data.snapshots || [] : []);
      } catch {
        if (alive) setSnaps([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [bookId]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function restore(id) {
    if (busy) return;
    if (!window.confirm("Restore this version? Your current version is saved to history first, so you can undo this.")) {
      return;
    }
    setBusy(id);
    setErr("");
    try {
      const res = await fetch(`/api/books/${bookId}/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restore: id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || "Could not restore that version.");
        setBusy("");
        return;
      }
      onRestore(data.book);
      onClose();
    } catch {
      setErr("Network error — try again.");
      setBusy("");
    }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog" aria-modal="true" aria-label="Revision history">
        <div className="drawer-head">
          <h2>History</h2>
          <button className="btn btn-ghost x" onClick={onClose} aria-label="Close history">
            Close
          </button>
        </div>

        <p className="drawer-hint">
          Loom keeps recent versions before risky changes — full-text edits, regenerations, chapter
          changes, and restores. Roll back to any of them; the current version is saved first.
        </p>

        {err && <div className="banner" style={{ marginBottom: 12 }}>{err}</div>}

        {snaps == null ? (
          <div className="chap-empty">Loading…</div>
        ) : snaps.length === 0 ? (
          <div className="chap-empty">No saved versions yet — they appear here after edits.</div>
        ) : (
          <ol className="hist-list">
            {snaps.map((s) => (
              <li className="hist-item" key={s.id}>
                <div className="hist-body">
                  <div className="hist-reason">{s.reason}</div>
                  <div className="hist-meta">
                    {ago(s.at)} · {s.words.toLocaleString()} words · {s.turns} passage
                    {s.turns === 1 ? "" : "s"}
                    {s.chapters ? ` · ${s.chapters} ch.` : ""}
                  </div>
                </div>
                <button
                  className="btn btn-ghost"
                  onClick={() => restore(s.id)}
                  disabled={Boolean(busy)}
                >
                  {busy === s.id ? "Restoring…" : "Restore"}
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
