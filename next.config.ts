import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tree-shake recharts' barrel imports so ChartsImpl only pulls the pieces it uses.
  experimental: {
    optimizePackageImports: ["recharts"],
  },
};

export default nextConfig;
