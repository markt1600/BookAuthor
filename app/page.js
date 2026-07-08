"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { DEFAULT_SETTINGS, DEFAULT_GUIDE, applyStyleProfile } from "@/lib/book";
import DesignControls from "@/components/DesignControls";
import GuideControls from "@/components/GuideControls";
import BookPreview from "@/components/BookPreview";

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState(null); // null | 'participate' | 'guide'
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [guide, setGuide] = useState(DEFAULT_GUIDE);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [ephemeral, setEphemeral] = useState(false);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setEphemeral(d.storageMode === "memory"))
      .catch(() => {});
  }, []);

  const changeSetting = (field, value) => setSettings((s) => ({ ...s, [field]: value }));
  const changeGuide = (field, value) =>
    setGuide((g) => (field === "style" ? applyStyleProfile(g, value) : { ...g, [field]: value }));

  async function start() {
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, author, settings, mode, guide: mode === "guide" ? guide : undefined }),
      });
      if (!res.ok) throw new Error("Could not create the book.");
      const { id } = await res.json();
      router.push(`/book/${id}`);
    } catch (e) {
      setError(e.message || "Something went wrong.");
      setCreating(false);
    }
  }

  const Mark = (
    <div className="mark">
      <span className="mark-weave" aria-hidden="true">
        <i /><i /><i /><i /><i />
      </span>
      <span className="mark-name">Loom</span>
    </div>
  );

  // ---------- Step 1: choose how to make the book ----------
  if (mode === null) {
    return (
      <main className="landing">
        <div className="landing-inner landing-wide">
          {Mark}
          <div className="landing-lede">
            <h1 className="lede-title">A book written in two hands, read as one voice.</h1>
            <p className="lede-body">
              Choose how you want to make it. Take up the pen and trade passages with the AI
              author — or hand it over entirely and direct the story while the AI writes every line.
            </p>
          </div>

          {ephemeral && (
            <div className="banner warn-banner">
              Heads up: no persistent storage is configured, so books are kept only in memory and may
              vanish. Connect an Upstash Redis store to save them — see the README.
            </div>
          )}

          <div className="fork">
            <button className="fork-card" onClick={() => setMode("participate")}>
              <div className="fork-eyebrow">Write together</div>
              <div className="fork-title">Take up the pen</div>
              <p className="fork-body">
                You and the AI author trade passages, each answering the other in one shared voice.
                You write; it continues in your style and at your length; the book grows from both hands.
              </p>
              <span className="fork-go">Write together →</span>
            </button>

            <button className="fork-card" onClick={() => setMode("guide")}>
              <div className="fork-eyebrow">Guide the story</div>
              <div className="fork-title">Direct, and watch it unfold</div>
              <p className="fork-body">
                You hold the vision; the AI author holds the pen. Describe what should happen next —
                a line or a paragraph — and the prose appears, section by section, while you steer the
                characters, the turns, and the tone.
              </p>
              <span className="fork-go">Guide the story →</span>
            </button>
          </div>

          <div className="landing-admin">
            <Link href="/admin">admin · all books</Link>
          </div>
        </div>
      </main>
    );
  }

  // ---------- Step 2: set it up ----------
  const guideMode = mode === "guide";
  return (
    <main className="landing">
      <div className="landing-inner landing-wide">
        {Mark}

        <button className="back-link" onClick={() => setMode(null)}>
          ← Change how you make this book
        </button>

        {ephemeral && (
          <div className="banner warn-banner">
            Heads up: no persistent storage is configured, so books are kept only in memory and may
            vanish. Connect an Upstash Redis store to save them — see the README.
          </div>
        )}

        <div className="landing-grid">
          <div className="title-plate">
            <div className="plate-eyebrow">
              {guideMode ? "You direct · the AI writes" : "A book written turn by turn"}
            </div>
            <label className="field">
              <input
                className="input-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Your title"
                aria-label="Book title"
              />
            </label>
            <div className="byline">
              <span>by</span>
              <input
                className="input-author"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="your name"
                aria-label="Author"
              />
            </div>

            <div className="setup">
              {guideMode ? (
                <>
                  <GuideControls guide={guide} onChange={changeGuide} />
                  <div className="setup-subhead">Book design — how the pages look</div>
                  <DesignControls settings={settings} onChange={changeSetting} />
                </>
              ) : (
                <DesignControls settings={settings} onChange={changeSetting} />
              )}
            </div>

            {error && (
              <div className="banner" style={{ marginTop: 20 }}>
                {error}
              </div>
            )}

            <div className="continue-row">
              <button className="btn btn-primary" onClick={start} disabled={creating}>
                {creating ? "Setting the press…" : guideMode ? "Begin directing" : "Continue"}
              </button>
            </div>
            <p className="landing-foot">
              {guideMode
                ? "You'll describe each section; the AI writes ~500 words at a time. Every choice here is editable later."
                : "Defaults are ready — you can change the title and every design choice later, on any page."}
            </p>
          </div>

          <BookPreview title={title} author={author} settings={settings} />
        </div>
      </div>
    </main>
  );
}
