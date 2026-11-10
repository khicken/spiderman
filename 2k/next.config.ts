import type { NextConfig } from "next";

// kalebkim.com rewrites /2k to this app
const nextConfig: NextConfig = {
  basePath: "/2k",
  devIndicators: false,
  // parallel agents: each dev server gets its own build dir (NEXT_DIST_DIR=.next-3110), so the .next/dev lock never collides
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
