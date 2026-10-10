import type { NextConfig } from "next";

// kalebkim.com rewrites /cars to this app
const nextConfig: NextConfig = {
  basePath: "/cars",
  devIndicators: false,
};

export default nextConfig;
