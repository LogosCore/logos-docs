// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import mermaid from "astro-mermaid";
import tailwindcss from "@tailwindcss/vite";

// Deployed to GitHub Pages at https://logos.github.io/logos-docs/
export default defineConfig({
  site: "https://logos.github.io",
  base: "/logos-docs/",
  // There is no home page: the site root opens the first sidebar page.
  redirects: {
    "/": "/logos-docs/architecture/",
  },
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [
    // astro-mermaid must run before Starlight so it can transform ```mermaid fences.
    // Grayscale base theme; colours come from the site's own tokens in
    // src/styles/global.css, which follow light and dark mode. autoTheme is off
    // because it forces mermaid's violet "default" theme in light mode.
    mermaid({
      theme: "neutral",
      autoTheme: false,
    }),
    starlight({
      title: "Logos Docs",
      description:
        "Product and technical documentation for the Logos project",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/logoscore/logos-docs",
        },
      ],
      editLink: {
        baseUrl: "https://github.com/logoscore/logos-docs/edit/main/",
      },
      // English only.
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
      },
      customCss: ["./src/styles/global.css"],
      components: {
        // Full-width content + floating "On this page" overlay instead of a TOC column.
        TwoColumnContent: "./src/overrides/TwoColumnContent.astro",
      },
      sidebar: [
        {
          label: "Foundations",
          items: [
            { slug: "architecture" },
            { slug: "core-infrastructure" },
            { slug: "core-responsibilities" },
            { slug: "module-types" },
            { slug: "message-flow-full" },
          ],
        },
        {
          label: "Channels",
          items: [
            { slug: "message-flow" },
          ],
        },
        {
          label: "Contracts",
          items: [
            { slug: "contracts/overview" },
            { slug: "contracts/amqp-envelope" },
            { slug: "contracts/amqp-conventions" },
            { slug: "contracts/module-lifecycle" },
            { slug: "contracts/channel-core-sync" },
            { slug: "contracts/module-management" },
            { slug: "contracts/module-logs" },
            { slug: "contracts/minion-connection" },
            { slug: "implementing-a-module" },
          ],
        },
      ],
    }),
  ],
});
