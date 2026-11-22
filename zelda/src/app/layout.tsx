import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Manrope } from "next/font/google";
import "./globals.css";

const display = Cormorant_Garamond({ style: ["normal", "italic"], subsets: ["latin"], variable: "--font-display" });
const ui = Manrope({ weight: ["400", "500", "600", "700"], subsets: ["latin"], variable: "--font-ui" });

const title = "HOLLOWMERE";
const description = "Wake the four beacons. An open-world lantern adventure in your browser.";

export const metadata: Metadata = {
  title,
  description,
  metadataBase: new URL("https://kalebkim.com"),
  alternates: { canonical: "/zelda" },
  openGraph: { type: "website", url: "https://kalebkim.com/zelda", siteName: "Kaleb Kim", title, description },
  twitter: { card: "summary", title, description },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0f2e33",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable}`}>
      <body className="bg-night text-parchment antialiased">{children}</body>
    </html>
  );
}
