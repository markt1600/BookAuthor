"use client";

import { CHOICES } from "@/lib/book";
import CoverArt, { LABELS } from "@/components/CoverArt";

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
    </>
  );
}
