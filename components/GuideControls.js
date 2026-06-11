"use client";

import { GUIDE_CHOICES, GUIDE_LABELS } from "@/lib/book";

function Chips({ field, value, onChange }) {
  return (
    <div className="chip-row">
      {GUIDE_CHOICES[field].map((opt) => (
        <button
          key={opt}
          type="button"
          className="chip"
          aria-pressed={value === opt}
          onClick={() => onChange(field, opt)}
        >
          {GUIDE_LABELS[field][opt]}
        </button>
      ))}
    </div>
  );
}

const SLIDERS = [
  { key: "violence", label: "Violence & gore" },
  { key: "sexual", label: "Explicitness" },
  { key: "language", label: "Strong language" },
];

export default function GuideControls({ guide, onChange }) {
  return (
    <>
      <div className="setup-row">
        <div className="setup-label">Writing style</div>
        <Chips field="style" value={guide.style} onChange={onChange} />
      </div>

      <div className="setup-row">
        <div className="setup-label">Point of view</div>
        <Chips field="pov" value={guide.pov} onChange={onChange} />
      </div>

      <div className="setup-row">
        <div className="setup-label">Tense</div>
        <Chips field="tense" value={guide.tense} onChange={onChange} />
      </div>

      <div className="setup-row">
        <div className="setup-label">Creative latitude</div>
        <Chips field="latitude" value={guide.latitude} onChange={onChange} />
      </div>

      <div className="setup-row">
        <div className="setup-label">Section length</div>
        <div className="range-row">
          <input
            type="range"
            min="150"
            max="400"
            step="25"
            value={guide.sectionWords}
            onChange={(e) => onChange("sectionWords", Number(e.target.value))}
          />
          <span className="range-val">{guide.sectionWords} words</span>
        </div>
      </div>

      <div className="setup-row">
        <div className="setup-label">Audience</div>
        <label className="drawer-toggle">
          <input
            type="checkbox"
            checked={!!guide.adult}
            onChange={(e) => onChange("adult", e.target.checked)}
          />
          <span className="toggle-track" aria-hidden="true">
            <span className="toggle-knob" />
          </span>
          <span className="toggle-text">
            <strong>This book is for adult audiences (18+)</strong>
            <em>Enables the maturity controls below. All characters are written as adults.</em>
          </span>
        </label>
      </div>

      {guide.adult && (
        <div className="setup-row">
          <div className="setup-label">Maturity</div>
          <div className="maturity">
            {SLIDERS.map((s) => (
              <div className="intensity-row" key={s.key}>
                <span className="intensity-label">{s.label}</span>
                <input
                  type="range"
                  min="0"
                  max="3"
                  step="1"
                  value={guide[s.key]}
                  onChange={(e) => onChange(s.key, Number(e.target.value))}
                />
                <span className="intensity-val">{GUIDE_LABELS.intensity[guide[s.key]]}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
