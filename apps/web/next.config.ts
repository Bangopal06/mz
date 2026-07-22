import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.60.101', '192.168.200.107'],
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
