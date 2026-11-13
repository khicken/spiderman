import type { MetadataRoute } from "next";

// basePath is not applied to manifest URLs, so every path here carries /minecraft.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/minecraft",
    name: "Minecraft",
    short_name: "Minecraft",
    description: "A block game in the browser",
    start_url: "/minecraft",
    scope: "/minecraft",
    display: "fullscreen",
    display_override: ["fullscreen", "standalone"],
    orientation: "landscape",
    background_color: "#000000",
    theme_color: "#000000",
    categories: ["games"],
    icons: [
      { src: "/minecraft/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/minecraft/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/minecraft/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/minecraft/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
