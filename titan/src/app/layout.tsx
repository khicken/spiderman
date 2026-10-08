import type { Metadata } from "next";
import "./globals.css";

const title = "titan";
const description = "slay titans with ODM gear";

export const metadata: Metadata = {
  title,
  description,
  metadataBase: new URL("https://kalebkim.com"),
  alternates: { canonical: "/titan" },
  openGraph: {
    type: "website",
    url: "https://kalebkim.com/titan",
    siteName: "Kaleb Kim",
    title,
    description,
  },
  twitter: { card: "summary", title, description },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-black text-white antialiased">{children}</body>
    </html>
  );
}
