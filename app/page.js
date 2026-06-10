"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_SETTINGS } from "@/lib/book";
import DesignControls from "@/components/DesignControls";

export default function Home() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

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
      <div className="landing-inner">
        <div className="mark">
          <span className="mark-weave" aria-hidden="true">
            <i /><i /><i /><i /><i />
          </span>
          <span className="mark-name">Loom</span>
        </div>

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
        </div>

        {error && (
          <div className="banner" style={{ margin: "20px auto 0", maxWidth: 520 }}>
            {error}
          </div>
        )}

        <div className="continue-row">
          <button className="btn btn-primary" onClick={start} disabled={creating}>
            {creating ? "Setting the press…" : "Continue"}
          </button>
        </div>
        <p className="landing-foot">
          Defaults are ready — you can change the title and every design choice later, on any page.
        </p>
      </div>
    </main>
  );
}
