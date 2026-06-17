import type { Metadata } from "next";
import { Newsreader } from "next/font/google";
import "./globals.css";

// Editorial serif — Obsidian-meets-Claude. Newsreader carries the whole UI; Georgia is the fallback.
const newsreader = Newsreader({
  variable: "--font-serif",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "MarketBrain",
  description: "A private stock-market research knowledge graph.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${newsreader.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
