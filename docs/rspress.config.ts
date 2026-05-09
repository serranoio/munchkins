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
    nav: [
      { text: "Changelog", link: "/changelog" },
      ...(isPublicBuild
        ? []
        : [
            {
              text: "Internal",
              items: [
                { text: "Diagnosis", link: "/internal/diagnosis" },
                { text: "PRD", link: "/internal/prd" },
                {
                  text: "Scenario testing strategy",
                  link: "/internal/scenario-testing-strategy",
                },
                {
                  text: "Technology decisions",
                  link: "/internal/technology-decisions",
                },
                { text: "Plan", link: "/internal/plan" },
              ],
            },
          ]),
    ],
  },
});
