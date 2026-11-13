import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaSupport } from "../pwa/pwa-support";

const title = "Minecraft";
const description = "A block game in the browser";

export const metadata: Metadata = {
  title,
  description,
  metadataBase: new URL("https://kalebkim.com"),
  alternates: { canonical: "/minecraft" },
  openGraph: { type: "website", url: "https://kalebkim.com/minecraft", siteName: "Kaleb Kim", title, description },
  twitter: { card: "summary", title, description },
  applicationName: title,
  appleWebApp: { capable: true, title, statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  other: { "apple-mobile-web-app-capable": "yes" },
  icons: {
    apple: "/minecraft/icons/apple-touch-icon.png",
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' shape-rendering='crispEdges'%3E%3Crect width='16' height='16' fill='%23866043'/%3E%3Crect width='16' height='5' fill='%235d9b3a'/%3E%3Crect y='5' width='3' height='2' fill='%235d9b3a'/%3E%3Crect x='9' y='5' width='4' height='1' fill='%235d9b3a'/%3E%3C/svg%3E",
  },
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
      <body className="antialiased">
        {children}
        <PwaSupport />
      </body>
    </html>
  );
}
