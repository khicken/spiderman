import type { Metadata, Viewport } from "next";
import "./globals.css";

const title = "Minecraft";
const description = "A block game in the browser";

export const metadata: Metadata = {
  title,
  description,
  metadataBase: new URL("https://kalebkim.com"),
  alternates: { canonical: "/minecraft" },
  openGraph: { type: "website", url: "https://kalebkim.com/minecraft", siteName: "Kaleb Kim", title, description },
  twitter: { card: "summary", title, description },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#000000",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
