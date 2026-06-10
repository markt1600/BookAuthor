"use client";

import { useEffect, useState } from "react";
import DesignControls from "@/components/DesignControls";

export default function SettingsDrawer({ book, onClose, onSave }) {
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);
  const [settings, setSettings] = useState(book.settings);
  const [saving, setSaving] = useState(false);

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

  async function save() {
    setSaving(true);
    await onSave({ title, author, settings });
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

        <DesignControls settings={settings} onChange={change} />

        <div className="continue-row" style={{ marginTop: 28, justifyContent: "stretch" }}>
          <button className="btn btn-primary" style={{ width: "100%" }} onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
