import type { NextConfig } from "next";

// kalebkim.com rewrites /2k to this app
const nextConfig: NextConfig = {
  basePath: "/2k",
  devIndicators: false,
};

export default nextConfig;
