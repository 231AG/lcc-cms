import type { Metadata } from "next";
import { Geist_Mono, Playfair_Display, Source_Sans_3 } from "next/font/google";
import "./globals.css";

// Brand typography: Playfair Display for headings, Source Sans 3 for body
// (applied globally in globals.css, not per-component). Geist Mono stays
// for the monospace code/ID display used throughout the admin tables.
const headingFont = Playfair_Display({
  variable: "--font-heading",
  weight: "variable",
  subsets: ["latin"],
});

const bodyFont = Source_Sans_3({
  variable: "--font-body",
  weight: "variable",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    template: "%s — LCC E-Portal",
    default: "LCC E-Portal",
  },
  description: "Liberia Christian College academic information system.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${headingFont.variable} ${bodyFont.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-fg">
        {/* Applies a stored light/dark preference to <html> before any styled
            markup is parsed, so someone who opted into dark never sees a flash
            of the light default. Render-blocking and
            deliberately not inline: the app's CSP is `script-src 'self'` with
            no nonce (src/proxy.ts), which refuses inline scripts but allows
            this same-origin file. Plain <script> rather than next/script so it
            is guaranteed to run synchronously at this point in the document.
            With no stored preference it writes nothing and the light default
            in CSS applies on its own. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts -- blocking is
            the point: the theme must be on <html> before the first paint, and
            an async/deferred load would show the wrong theme first. The file is
            ~1 KB, same-origin and cached. */}
        <script src="/theme.js" />
        {children}
      </body>
    </html>
  );
}
