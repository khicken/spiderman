import type { Metadata, Viewport } from "next";
import { Big_Shoulders, Inter_Tight } from "next/font/google";
import "./globals.css";

const display = Big_Shoulders({ weight: ["600", "700", "800", "900"], subsets: ["latin"], variable: "--font-display" });
const ui = Inter_Tight({ weight: ["400", "500", "600", "700"], style: ["normal", "italic"], subsets: ["latin"], variable: "--font-ui" });

const title = "HOOPS";
const description = "Five on five basketball with real rosters, in your browser";

export const metadata: Metadata = {
  title,
  description,
  metadataBase: new URL("https://kalebkim.com"),
  alternates: { canonical: "/2k" },
  openGraph: { type: "website", url: "https://kalebkim.com/2k", siteName: "Kaleb Kim", title, description },
  twitter: { card: "summary", title, description },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#05060a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable}`}>
      <body className="bg-night text-ink antialiased">{children}</body>
    </html>
  );
}
