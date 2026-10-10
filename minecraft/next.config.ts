import type { NextConfig } from "next";

// kalebkim.com rewrites /minecraft to this app
const nextConfig: NextConfig = {
  basePath: "/minecraft",
  devIndicators: false,
};

export default nextConfig;
