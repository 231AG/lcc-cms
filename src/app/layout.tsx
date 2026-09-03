import type { Metadata } from "next";
import { Geist_Mono, Playfair_Display, Source_Sans_3 } from "next/font/google";
import { getCurrentActor } from "@/lib/auth/session";
import { Header } from "@/components/layout/Header";
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

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const actor = await getCurrentActor();

  return (
    <html
      lang="en"
      className={`${headingFont.variable} ${bodyFont.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-fg">
        {/* Applies a stored light/dark preference to <html> before any styled
            markup is parsed, so a user whose chosen theme differs from their OS
            setting never sees a flash of the other one. Render-blocking and
            deliberately not inline: the app's CSP is `script-src 'self'` with
            no nonce (src/proxy.ts), which refuses inline scripts but allows
            this same-origin file. Plain <script> rather than next/script so it
            is guaranteed to run synchronously at this point in the document.
            With no stored preference it writes nothing and CSS follows the OS
            preference instead. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts -- blocking is
            the point: the theme must be on <html> before the first paint, and
            an async/deferred load would show the wrong theme first. The file is
            ~1 KB, same-origin and cached. */}
        <script src="/theme.js" />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:border focus:border-line focus:bg-surface-raised focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-brand-fg focus:shadow-md"
        >
          Skip to main content
        </a>
        <Header actor={actor} />
        {children}
      </body>
    </html>
  );
}
