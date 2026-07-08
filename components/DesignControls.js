"use client";

// The book's design (cover, page format, material, typeface, ink) is fixed to
// the defaults — only the reading comfort options remain adjustable.
export default function DesignControls({ settings, onChange }) {
  return (
    <>
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
    </>
  );
}
