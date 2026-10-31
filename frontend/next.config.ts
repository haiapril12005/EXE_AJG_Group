import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.PLAYWRIGHT_TEST ? ".next-playwright" : ".next",
};

export default nextConfig;
