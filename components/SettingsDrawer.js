"use client";

import { useEffect, useState } from "react";
import DesignControls from "@/components/DesignControls";
import GuideControls from "@/components/GuideControls";
import BookPreview from "@/components/BookPreview";
import { DEFAULT_GUIDE } from "@/lib/book";

export default function SettingsDrawer({ book, onClose, onSave }) {
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);
  const [settings, setSettings] = useState(book.settings);
  const [guide, setGuide] = useState({ ...DEFAULT_GUIDE, ...(book.guide || {}) });
  const [saving, setSaving] = useState(false);
  const guideMode = book.mode === "guide";

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function change(field, value) {
    setSettings((s) => ({ ...s, [field]: value }));
  }
  function changeGuide(field, value) {
    setGuide((g) => ({ ...g, [field]: value }));
  }

  async function save() {
    setSaving(true);
    await onSave(guideMode ? { title, author, settings, guide } : { title, author, settings });
    setSaving(false);
    onClose();
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog" aria-modal="true" aria-label="Book settings">
        <div className="drawer-head">
          <h2>Book settings</h2>
          <button className="btn btn-ghost x" onClick={onClose} aria-label="Close settings">
            Close
          </button>
        </div>

        <div className="drawer-preview">
          <BookPreview title={title} author={author} settings={settings} />
        </div>

        <div className="setup-row">
          <div className="setup-label">Title</div>
          <input
            className="text-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled"
          />
        </div>

        <div className="setup-row">
          <div className="setup-label">Author</div>
          <input
            className="text-input"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Anonymous"
          />
        </div>

        {guideMode && (
          <>
            <GuideControls guide={guide} onChange={changeGuide} allowErotica />
            <div className="setup-subhead">Book design — how the pages look</div>
          </>
        )}

        <DesignControls settings={settings} onChange={change} />

        <div className="setup-row">
          <div className="setup-label">Continuity</div>
          <label className="drawer-toggle">
            <input
              type="checkbox"
              checked={!!settings.fullContext}
              onChange={(e) => change("fullContext", e.target.checked)}
            />
            <span className="toggle-track" aria-hidden="true">
              <span className="toggle-knob" />
            </span>
            <span className="toggle-text">
              <strong>Send the whole book each turn</strong>
              <em>
                Highest fidelity to earlier chapters, but costs more per turn and is
                best for shorter books. Off by default — Loom otherwise sends a running
                story-memory plus the opening and recent pages.
              </em>
            </span>
          </label>
        </div>

        <div className="continue-row" style={{ marginTop: 28, justifyContent: "stretch" }}>
          <button className="btn btn-primary" style={{ width: "100%" }} onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
