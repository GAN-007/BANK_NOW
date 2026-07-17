import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BANK NOW",
    short_name: "BANK NOW",
    description: "Secure, mobile-first money management.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f7faf9",
    theme_color: "#083344",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
