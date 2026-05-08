import * as path from "node:path";
import { defineConfig } from "@rspress/core";

const isPublicBuild = process.env.PUBLIC_DOCS === "true";

export default defineConfig({
  root: path.join(__dirname, "pages"),
  base: isPublicBuild ? "/munchkins/" : "/",
  outDir: path.join(__dirname, "doc_build"),
  title: "Munchkins",
  description: "Autonomous agent infrastructure docs.",
  route: {
    exclude: isPublicBuild ? ["**/internal/**"] : [],
  },
  themeConfig: {
    socialLinks: [],
    nav: [],
  },
});
