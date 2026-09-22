import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Emits .next/standalone (a self-contained node server) so the Docker
  // image used on AWS doesn't need node_modules or the Next CLI at runtime.
  // Harmless on Vercel, which ignores it.
  output: "standalone",
};

export default nextConfig;
