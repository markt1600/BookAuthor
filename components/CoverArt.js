export const LABELS = {
  cover: {
    classic: "Classic",
    minimal: "Minimal",
    noir: "Noir",
    parchment: "Parchment",
    botanical: "Botanical",
    blueprint: "Blueprint",
  },
  format: {
    portrait: "Portrait",
    square: "Square",
    landscape: "Landscape",
  },
  material: {
    paper: "Paper",
    parchment: "Parchment",
    linen: "Linen",
    newsprint: "Newsprint",
    midnight: "Midnight",
  },
  font: {
    serif: "Serif",
    sans: "Sans",
    mono: "Mono",
    storybook: "Storybook",
  },
};

export default function CoverArt({ cover }) {
  return <div className={`cover-art cover-${cover}`} aria-hidden="true" />;
}
