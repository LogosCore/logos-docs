// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import mermaid from "astro-mermaid";
import tailwindcss from "@tailwindcss/vite";

// Deployed to GitHub Pages at https://logos.github.io/logos-docs/
export default defineConfig({
  site: "https://logos.github.io",
  base: "/logos-docs/",
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [
    // astro-mermaid must run before Starlight so it can transform ```mermaid fences.
    mermaid({
      theme: "default",
      autoTheme: true,
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
          label: "Home",
          link: "/",
        },
        {
          label: "Foundations",
          items: [
            { slug: "project-scope" },
            { slug: "tech-requirements" },
            { slug: "architecture" },
            { slug: "core-infrastructure" },
            { slug: "core-responsibilities" },
            { slug: "module-types" },
            { slug: "message-flow-full" },
            { slug: "future-steps" },
          ],
        },
        {
          label: "Channels",
          items: [
            { slug: "message-flow" },
            { slug: "channel-transposition-profiles" },
            { slug: "channel-transposition-yaml-reference" },
            { slug: "channel-transposition-examples" },
            { slug: "channel-authoring-15min" },
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
            { slug: "contracts/channel-core-rpc" },
          ],
        },
        {
          label: "ADR",
          items: [
            { slug: "adr" },
            { slug: "adr/0001-golang-channel-core-foundation" },
            { slug: "adr/0002-amqp-contract-conventions" },
            { slug: "adr/0003-module-registration-lifecycle" },
            { slug: "adr/0004-distributed-tracing-minion-data-plane" },
            { slug: "adr/0005-oidc-authentication" },
          ],
        },
      ],
    }),
  ],
});
