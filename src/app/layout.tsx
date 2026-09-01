import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getCurrentActor } from "@/lib/auth/session";
import { Header } from "@/components/layout/Header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-brand-700 focus:shadow-md"
        >
          Skip to main content
        </a>
        <Header actor={actor} />
        {children}
      </body>
    </html>
  );
}
