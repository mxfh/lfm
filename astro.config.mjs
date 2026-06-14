import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

// Project GitHub Pages site lives at https://mxfh.github.io/lfm/.
// `base` is overridable via env so the same build can target a custom domain later.
// Defaults target a custom-domain root (e.g. programm.meissnerin.de). For a
// GitHub-Pages project site set BASE_PATH=/lfm/ at build time.
const site = process.env.SITE_URL ?? "https://programm.meissnerin.de";
const base = process.env.BASE_PATH ?? "/";

export default defineConfig({
  site,
  base,
  trailingSlash: "ignore",
  vite: {
    plugins: [tailwindcss()],
  },
});
