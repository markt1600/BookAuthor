import "./globals.css";

export const metadata = {
  title: "Loom — write a book, turn by turn",
  description:
    "A turn-based co-writing studio. You write a passage, Claude answers in your voice. The book is woven from two hands.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,800&family=Inter:wght@400;500;600&family=Spectral:ital,wght@0,400;0,500;1,400&family=Spline+Sans+Mono:wght@400;500&family=Sorts+Mill+Goudy:ital@0;1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
