"use client";

import CoverArt, { LABELS } from "@/components/CoverArt";

const MATERIAL = {
  paper: { bg: "#fbfaf8", ink: "#1c1b18" },
  parchment: { bg: "#f1e6cc", ink: "#3a2f1c" },
  linen: { bg: "#f5f4ef", ink: "#232323" },
  newsprint: { bg: "#e9e6dd", ink: "#26241f" },
  midnight: { bg: "#14171e", ink: "#d9dae0" },
};

const FONT = {
  serif: '"Spectral", Georgia, serif',
  sans: '"Inter", system-ui, sans-serif',
  mono: '"Spline Sans Mono", monospace',
  storybook: '"Sorts Mill Goudy", Georgia, serif',
};

// portrait 6×9, square 8×8, landscape 9×6 — width / height
const RATIO = { portrait: 6 / 9, square: 1, landscape: 9 / 6 };

const SAMPLE = [
  "The morning came in sideways, the way it always did here — low and gold and unhurried, spilling across the floorboards before anyone was awake to claim it.",
  "She had meant to leave a note. Three times she had started one, and three times the words had gone wrong in her hands, so in the end she left only the open window and the smell of rain that hadn't arrived yet.",
];

export default function BookPreview({ title, author, settings }) {
  const m = MATERIAL[settings.material] || MATERIAL.paper;
  const fam = FONT[settings.font] || FONT.serif;
  const ratio = RATIO[settings.format] || RATIO.portrait;

  // Scale the live reading size down for the mini page so relative changes show.
  const bodySize = Math.max(9, Math.round(settings.fontSize * 0.62));

  return (
    <div className="preview-pane" aria-hidden="true">
      <div className="preview-eyebrow">Live preview</div>

      <div className="preview-stage">
        <div className="preview-cover-wrap">
          <CoverArt cover={settings.cover} />
          <span className="preview-cover-label">{LABELS.cover[settings.cover]} cover</span>
        </div>

        <div
          className="preview-sheet paper"
          data-material={settings.material}
          style={{
            background: m.bg,
            color: m.ink,
            aspectRatio: String(ratio),
            fontFamily: fam,
          }}
        >
          <div className="preview-sheet-inner" style={{ fontSize: bodySize }}>
            <div
              className="preview-titleline"
              style={{ fontSize: Math.round(bodySize * 1.5) }}
            >
              {title?.trim() || "Untitled"}
            </div>
            <div className="preview-byline" style={{ opacity: 0.6 }}>
              {author?.trim() ? `by ${author.trim()}` : "by you"}
            </div>
            {SAMPLE.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </div>
      </div>

      <div className="preview-caption">
        {LABELS.format[settings.format]} · {LABELS.material[settings.material]} ·{" "}
        {LABELS.font[settings.font]} · {settings.fontSize}px
      </div>
    </div>
  );
}
