import type { MetadataRoute } from "next";

import { siteConfig } from "@/config/site";

const routes = ["", "/clubs", "/coaches", "/athletes", "/features", "/sports", "/pricing", "/trust", "/contact"];

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((path) => ({ url: `${siteConfig.url}${path}`, changeFrequency: "monthly", priority: path === "" ? 1 : 0.7 }));
}
