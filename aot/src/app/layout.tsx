import type { Metadata } from "next";
import "./globals.css";

const title = "aot";
const description = "slay titans with ODM gear";

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-black text-white antialiased">{children}</body>
    </html>
  );
}
