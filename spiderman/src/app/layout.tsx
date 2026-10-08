import type { Metadata } from "next";
import "./globals.css";

const title = "spiderman";
const description = "swing through a snowy city at dusk";

export const metadata: Metadata = {
  title,
  description,
  metadataBase: new URL("https://kalebkim.com"),
  alternates: { canonical: "/spiderman" },
  openGraph: {
    type: "website",
    url: "https://kalebkim.com/spiderman",
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
