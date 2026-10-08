import type { Metadata, Viewport } from "next";
import { Anton, Noto_Serif_JP, Oswald, Yuji_Syuku } from "next/font/google";
import "./globals.css";

const anton = Anton({ weight: "400", subsets: ["latin"], variable: "--font-anton" });
const oswald = Oswald({ weight: ["400", "500", "600", "700"], subsets: ["latin"], variable: "--font-oswald" });
const serifJp = Noto_Serif_JP({ weight: ["700", "900"], subsets: ["latin"], variable: "--font-serif-jp", preload: false });
const brush = Yuji_Syuku({ weight: "400", subsets: ["latin"], variable: "--font-yuji", preload: false });

const title = "Attack on Titan";
const description = "Fly with ODM gear and cut titan napes";

export const metadata: Metadata = {
  title,
  description,
  metadataBase: new URL("https://kalebkim.com"),
  alternates: { canonical: "/aot" },
  openGraph: {
    type: "website",
    url: "https://kalebkim.com/aot",
    siteName: "Kaleb Kim",
    title,
    description,
  },
  twitter: { card: "summary", title, description },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0b0807",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${anton.variable} ${oswald.variable} ${serifJp.variable} ${brush.variable}`}>
      <body className="bg-ink text-bone antialiased">{children}</body>
    </html>
  );
}
