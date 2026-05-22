import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  // The realtime SSE route must use the Node.js runtime, not Edge.
  // We document the per-route runtime in the route file itself.
};

export default nextConfig;
