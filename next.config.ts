import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Evita que Next infiera la raíz del workspace por lockfiles externos
    root: __dirname,
  },
  images: {
    // Imágenes servidas directo desde el CDN de Shopify (patrón headless
    // oficial). Transformaciones por URL: ?width=&height=&crop=&format=auto
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.shopify.com",
      },
    ],
  },
};

export default nextConfig;
