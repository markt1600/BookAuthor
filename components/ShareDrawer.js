"use client";

import { useEffect, useState } from "react";

export default function ShareDrawer({ book, onClose, onSetShared }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const shared = Boolean(book.shared);

  const link =
    typeof window !== "undefined" ? `${window.location.origin}/read/${book.id}` : `/read/${book.id}`;

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function toggle(next) {
    if (busy) return;
    setBusy(true);
    await onSetShared(next);
    setBusy(false);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog" aria-modal="true" aria-label="Share">
        <div className="drawer-head">
          <h2>Share</h2>
          <button className="btn btn-ghost x" onClick={onClose} aria-label="Close share">
            Close
          </button>
        </div>

        <p className="drawer-hint">
          Publish a read-only link to this book. Anyone with the link can read it in its book form —
          no editing, no controls. Turn it off any time to revoke access.
        </p>

        <label className="share-toggle">
          <input type="checkbox" checked={shared} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
          <span>{shared ? "Public read-only link is on" : "Sharing is off"}</span>
        </label>

        {shared && (
          <div className="share-link-row">
            <input className="text-input share-link" readOnly value={link} onFocus={(e) => e.target.select()} />
            <button className="btn btn-primary" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
        {shared && (
          <a className="linkish" href={link} target="_blank" rel="noreferrer" style={{ marginTop: 12, display: "inline-block" }}>
            Open the reader →
          </a>
        )}
      </div>
    </div>
  );
}
