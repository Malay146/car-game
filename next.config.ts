import type { NextConfig } from "next";

// Static game assets keep their file names, so cache for a day and revalidate in the background (instead of Vercel's default no-cache for /public).
const assetCache = [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }];

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async headers() {
    return ["models", "tex", "hdr", "audio", "icons"].map((dir) => ({ source: `/${dir}/:path*`, headers: assetCache }));
  },
};

export default nextConfig;
