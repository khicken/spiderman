import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import "./globals.css";

const barlow = Barlow({ weight: ["400", "500", "600", "700"], subsets: ["latin"], variable: "--font-barlow" });
const cond = Barlow_Condensed({ weight: ["500", "600", "700", "800"], style: ["normal", "italic"], subsets: ["latin"], variable: "--font-cond" });

const title = "Cars";
const description = "Race real roads with friends";

export const metadata: Metadata = {
  title,
  description,
  metadataBase: new URL("https://kalebkim.com"),
  alternates: { canonical: "/cars" },
  openGraph: { type: "website", url: "https://kalebkim.com/cars", siteName: "Kaleb Kim", title, description },
  twitter: { card: "summary", title, description },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#07080a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${barlow.variable} ${cond.variable}`}>
      <body className="bg-night text-white antialiased">{children}</body>
    </html>
  );
}
