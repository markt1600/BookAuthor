"use client";

import { useEffect, useState } from "react";
import DesignControls from "@/components/DesignControls";
import GuideControls from "@/components/GuideControls";
import BookPreview from "@/components/BookPreview";
import { DEFAULT_GUIDE, applyStyleProfile } from "@/lib/book";

export default function SettingsDrawer({ book, onClose, onSave, onSetPassword }) {
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);
  const [settings, setSettings] = useState(book.settings);
  const [voiceSample, setVoiceSample] = useState(book.voiceSample || "");
  const [guide, setGuide] = useState({ ...DEFAULT_GUIDE, ...(book.guide || {}) });
  const [saving, setSaving] = useState(false);
  const [pw, setPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [ended, setEnded] = useState(Boolean(book.ended));
  const guideMode = book.mode === "guide";
  const isProtected = Boolean(book.protected);
  const wasEnded = Boolean(book.ended);
  const hasText = (book.turns || []).length > 0;

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
    setGuide((g) => (field === "style" ? applyStyleProfile(g, value) : { ...g, [field]: value }));
  }

  async function save() {
    setSaving(true);
    const base = guideMode ? { title, author, settings, guide } : { title, author, settings };
    await onSave({ ...base, voiceSample, ended });
    setSaving(false);
    onClose();
  }

  async function applyPassword(value) {
    if (!onSetPassword || pwBusy) return;
    setPwBusy(true);
    setPwMsg("");
    setPwErr("");
    const r = await onSetPassword(value);
    setPwBusy(false);
    if (!r || !r.ok) {
      setPwErr((r && r.error) || "Could not update the password.");
      return;
    }
    setPw("");
    setPwMsg(r.protected ? "Password set — this book is now locked." : "Protection removed.");
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
          <div className="setup-label">Voice sample</div>
          <textarea
            className="text-input voice-sample"
            rows={5}
            maxLength={3000}
            value={voiceSample}
            onChange={(e) => setVoiceSample(e.target.value)}
            placeholder="Optional — paste a short passage whose voice the AI should match (your own writing, or a public-domain excerpt). It anchors rhythm and diction far better than a style label. Style only: its content is never reused."
          />
        </div>

        <div className="setup-row">
          <div className="setup-label">Second take</div>
          <label className="drawer-toggle">
            <input
              type="checkbox"
              checked={!!settings.bestOfTwo}
              onChange={(e) => change("bestOfTwo", e.target.checked)}
            />
            <span className="toggle-track" aria-hidden="true">
              <span className="toggle-knob" />
            </span>
            <span className="toggle-text">
              <strong>Draft each section twice, keep the better take</strong>
              <em>
                The AI writes the section a second time from a different angle, and an editor
                model keeps whichever take reads more human. Doubles drafting time and cost,
                so it’s off by default.
              </em>
            </span>
          </label>
        </div>

        <div className="setup-row">
          <div className="setup-label">Polish pass</div>
          <label className="drawer-toggle">
            <input
              type="checkbox"
              checked={!!settings.selfEdit}
              onChange={(e) => change("selfEdit", e.target.checked)}
            />
            <span className="toggle-track" aria-hidden="true">
              <span className="toggle-knob" />
            </span>
            <span className="toggle-text">
              <strong>Line-edit each new section before it lands</strong>
              <em>
                After drafting a section, the AI gives it one careful polishing pass — tighter
                sentences, varied rhythm, no recycled imagery. Roughly doubles each section’s
                time and cost, so it’s off by default.
              </em>
            </span>
          </label>
        </div>

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

        {hasText && (
          <div className="setup-row" style={{ marginTop: 22 }}>
            <div className="setup-label">The end</div>
            <div className="pw-section">
              <div className="pw-status">
                {wasEnded
                  ? "✓ This book is marked as ended — “The End” is shown and the notes assess the finished work."
                  : "Mark the book as finished when you’re done. This appends “The End” and re-reads the whole manuscript for a final assessment."}
              </div>
              <div className="pw-actions">
                <button
                  className={ended ? "btn btn-ghost" : "btn btn-primary"}
                  onClick={() => setEnded((v) => !v)}
                >
                  {ended ? "Reopen the book" : "Mark as ended"}
                </button>
              </div>
              {ended !== wasEnded ? (
                <div className="pw-msg">
                  {ended
                    ? "Will be marked as ended when you click “Save changes” below."
                    : "Will reopen when you click “Save changes” below."}
                </div>
              ) : (
                <div className="pw-hint">
                  {wasEnded
                    ? "Reopening restores the forward-looking notes and removes “The End”."
                    : "You can undo this any time — nothing is deleted."}
                </div>
              )}
            </div>
          </div>
        )}

        {onSetPassword && (
          <div className="setup-row" style={{ marginTop: 22 }}>
            <div className="setup-label">Protection</div>
            <div className="pw-section">
              <div className="pw-status">
                {isProtected ? "🔒 This book is password-protected." : "This book is open — anyone with the link can read it."}
              </div>
              <input
                className="text-input"
                type="password"
                value={pw}
                onChange={(e) => {
                  setPw(e.target.value);
                  setPwMsg("");
                  setPwErr("");
                }}
                placeholder={isProtected ? "New password" : "Set a password"}
                autoComplete="new-password"
              />
              <div className="pw-actions">
                <button
                  className="btn btn-primary"
                  onClick={() => applyPassword(pw)}
                  disabled={pwBusy || !pw.trim()}
                >
                  {pwBusy ? "Saving…" : isProtected ? "Change password" : "Lock book"}
                </button>
                {isProtected && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => applyPassword("")}
                    disabled={pwBusy}
                  >
                    Remove protection
                  </button>
                )}
              </div>
              {pwMsg && <div className="pw-msg">{pwMsg}</div>}
              {pwErr && <div className="pw-err">{pwErr}</div>}
              <div className="pw-hint">
                Readers will need this password to open the book’s link. You can change or remove it
                here any time.
              </div>
            </div>
          </div>
        )}

        <div className="continue-row" style={{ marginTop: 28, justifyContent: "stretch" }}>
          <button className="btn btn-primary" style={{ width: "100%" }} onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
