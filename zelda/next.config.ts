import type { NextConfig } from "next";

// kalebkim.com rewrites /zelda to this app
const nextConfig: NextConfig = {
  basePath: "/zelda",
  devIndicators: false,
  // parallel agents: each dev server gets its own build dir (NEXT_DIST_DIR=.next-3301), so the .next/dev lock never collides
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
