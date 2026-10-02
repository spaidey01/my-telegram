import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "storage.c2.liara.space",
        port: "",
        pathname: "/tlgrm/**",
      },
    ],
  },
  productionBrowserSourceMaps: false,
};

export default nextConfig;
