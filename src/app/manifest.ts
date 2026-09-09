import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "바이크투어 라이딩 기록",
    short_name: "바이크투어",
    description: "GPS로 주행 경로, 거리, 시간과 속도를 기록합니다.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#07110f",
    theme_color: "#07110f",
    orientation: "portrait-primary",
    categories: ["sports", "health", "navigation"],
    icons: [
      {
        src: "/app-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/app-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
