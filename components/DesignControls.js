"use client";

import { CHOICES } from "@/lib/book";
import CoverArt, { LABELS } from "@/components/CoverArt";

const INK_PRESETS = [
  { name: "Ink black", hex: "#1c1b18" },
  { name: "Sepia", hex: "#5b4636" },
  { name: "Walnut", hex: "#3a2a1a" },
  { name: "Oxblood", hex: "#6d2a2a" },
  { name: "Navy", hex: "#24314f" },
  { name: "Forest", hex: "#26402f" },
  { name: "Plum", hex: "#4a2747" },
  { name: "Slate", hex: "#3a4250" },
];

function ChipRow({ field, value, onChange }) {
  return (
    <div className="chips">
      {CHOICES[field].map((opt) => (
        <button
          key={opt}
          type="button"
          className="chip"
          aria-pressed={value === opt}
          onClick={() => onChange(field, opt)}
        >
          {LABELS[field][opt]}
        </button>
      ))}
    </div>
  );
}

export default function DesignControls({ settings, onChange }) {
  return (
    <>
      <div className="setup-row">
        <div className="setup-label">Cover</div>
        <div className="covers">
          {CHOICES.cover.map((opt) => (
            <button
              key={opt}
              type="button"
              className="cover-swatch"
              aria-pressed={settings.cover === opt}
              aria-label={`Cover: ${LABELS.cover[opt]}`}
              onClick={() => onChange("cover", opt)}
            >
              <CoverArt cover={opt} />
              <span className="cover-name">{LABELS.cover[opt]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="setup-row">
        <div className="setup-label">Page format</div>
        <ChipRow field="format" value={settings.format} onChange={onChange} />
      </div>

      <div className="setup-row">
        <div className="setup-label">Material</div>
        <ChipRow field="material" value={settings.material} onChange={onChange} />
      </div>

      <div className="setup-row">
        <div className="setup-label">Typeface</div>
        <ChipRow field="font" value={settings.font} onChange={onChange} />
      </div>

      <div className="setup-row">
        <div className="setup-label">Reading size</div>
        <div className="range-row">
          <input
            type="range"
            min="14"
            max="28"
            step="1"
            value={settings.fontSize}
            onChange={(e) => onChange("fontSize", Number(e.target.value))}
          />
          <span className="range-val">{settings.fontSize}px</span>
        </div>
      </div>

      <div className="setup-row">
        <div className="setup-label">Page size</div>
        <label className="drawer-toggle">
          <input
            type="checkbox"
            checked={!!settings.largePage}
            onChange={(e) => onChange("largePage", e.target.checked)}
          />
          <span className="toggle-track" aria-hidden="true">
            <span className="toggle-knob" />
          </span>
          <span className="toggle-text">
            <strong>Larger page</strong>
            <em>
              On desktop, enlarges the page (keeping the same shape) so more words fit on
              each page — fewer pages to turn. Also applies to the PDF export. No effect on
              phones, where the page already fills the screen.
            </em>
          </span>
        </label>
      </div>

      <div className="setup-row">
        <div className="setup-label">Ink color</div>
        <div className="ink-row">
          <button
            type="button"
            className="ink-swatch ink-default"
            aria-pressed={!settings.inkColor}
            title="Match the page material"
            onClick={() => onChange("inkColor", "")}
          >
            <span>Auto</span>
          </button>
          {INK_PRESETS.map((c) => (
            <button
              key={c.hex}
              type="button"
              className="ink-swatch"
              aria-pressed={settings.inkColor?.toLowerCase() === c.hex}
              title={c.name}
              onClick={() => onChange("inkColor", c.hex)}
              style={{ background: c.hex }}
            />
          ))}
          <label className="ink-swatch ink-custom" title="Custom color">
            <input
              type="color"
              value={settings.inkColor || "#1c1b18"}
              onChange={(e) => onChange("inkColor", e.target.value)}
            />
          </label>
        </div>
      </div>
    </>
  );
}
