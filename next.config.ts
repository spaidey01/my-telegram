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
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
        ...(process.env.NODE_ENV === "production"
          ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
          : []),
      ],
    }];
  },
};

export default nextConfig;
