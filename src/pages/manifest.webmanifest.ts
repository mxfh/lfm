import { appContent } from "../app-content";

export const GET = (): Response => new Response(JSON.stringify({
  name: appContent.meta.title,
  short_name: appContent.meta.applicationName,
  description: appContent.meta.description,
  start_url: ".",
  scope: ".",
  display: "standalone",
  orientation: "portrait",
  background_color: appContent.meta.themeColorLight,
  theme_color: appContent.meta.themeColor,
  lang: "de",
  icons: [
    { src: "favicon.svg", type: "image/svg+xml", sizes: "any", purpose: "any maskable" },
    { src: "apple-touch-icon.png", type: "image/png", sizes: "180x180", purpose: "any" },
  ],
}), {
  headers: { "content-type": "application/manifest+json; charset=utf-8" },
});
