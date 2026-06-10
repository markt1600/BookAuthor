"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { DEFAULT_SETTINGS } from "@/lib/book";
import DesignControls from "@/components/DesignControls";
import BookPreview from "@/components/BookPreview";

export default function Home() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [ephemeral, setEphemeral] = useState(false);

  // Warn if the server has no persistent store configured — books created in
  // memory mode won't survive on Vercel (each request can hit a fresh worker),
  // which shows up as "Book not found" right after creating one.
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setEphemeral(d.storageMode === "memory"))
      .catch(() => {});
  }, []);

  function change(field, value) {
    setSettings((s) => ({ ...s, [field]: value }));
  }

  async function start() {
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, author, settings }),
      });
      if (!res.ok) throw new Error("Could not create the book.");
      const { id } = await res.json();
      router.push(`/book/${id}`);
    } catch (e) {
      setError(e.message || "Something went wrong.");
      setCreating(false);
    }
  }

  return (
    <main className="landing">
      <div className="landing-inner landing-wide">
        <div className="mark">
          <span className="mark-weave" aria-hidden="true">
            <i /><i /><i /><i /><i />
          </span>
          <span className="mark-name">Loom</span>
        </div>

        <div className="landing-lede">
          <h1 className="lede-title">A book written in two hands, read as one voice.</h1>
          <p className="lede-body">
            You write a passage; the AI author answers in your own voice — matching your
            style, tone, and length — then hands the page back. Turn by turn, the story
            grows from both of you, yet reads as if a single author set it down. Your
            effort, doubled; your voice, kept whole.
          </p>
        </div>

        {ephemeral && (
          <div className="banner warn-banner">
            Heads up: no persistent storage is configured, so books are kept only
            in memory and may vanish (you'll see “Book not found”). Connect an
            Upstash Redis store to save them — see the README.
          </div>
        )}

        <div className="landing-grid">
          <div className="title-plate">
            <div className="plate-eyebrow">A book written turn by turn</div>
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
              <DesignControls settings={settings} onChange={change} />
            </div>

            {error && (
              <div className="banner" style={{ marginTop: 20 }}>
                {error}
              </div>
            )}

            <div className="continue-row">
              <button className="btn btn-primary" onClick={start} disabled={creating}>
                {creating ? "Setting the press…" : "Continue"}
              </button>
            </div>
            <p className="landing-foot">
              Defaults are ready — you can change the title and every design choice
              later, on any page.
            </p>
          </div>

          <BookPreview title={title} author={author} settings={settings} />
        </div>

        <div className="landing-admin">
          <Link href="/admin">admin · all books</Link>
        </div>
      </div>
    </main>
  );
}
