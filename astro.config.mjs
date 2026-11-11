// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import mermaid from "astro-mermaid";
import tailwindcss from "@tailwindcss/vite";
import { codeThemes } from "./src/styles/code-theme.mjs";

// Deployed to GitHub Pages at https://logoscore.github.io/logos-docs/
export default defineConfig({
  site: "https://logoscore.github.io",
  base: "/logos-docs/",
  // Retired pages: their URLs lead to where their content went.
  redirects: {
    "/message-flow/": "/logos-docs/guides/writing-a-channel/",
    "/message-flow-full/": "/logos-docs/contracts/minion-messages/",
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
        "How Logos works, the contracts between its parts, and how to build modules for it and contribute to it",
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
      // Code blocks in grayscale (src/styles/code-theme.mjs). Their frames keep
      // Starlight's UI colours, which global.css maps to neutral.
      expressiveCode: {
        themes: codeThemes,
        useStarlightUiThemeColors: true,
        styleOverrides: {
          // Line markers (mark, ins, del) without a hue.
          textMarkers: { defaultChroma: "0" },
          // "Copied!": inverted, like core's primary buttons, not green.
          frames: {
            tooltipSuccessBackground: "var(--sl-color-white)",
            tooltipSuccessForeground: "var(--sl-color-black)",
          },
        },
      },
      components: {
        // Full-width content + floating "On this page" overlay instead of a TOC column.
        TwoColumnContent: "./src/overrides/TwoColumnContent.astro",
      },
      sidebar: [
        {
          label: "Start here",
          items: [
            { slug: "index", label: "Welcome" },
            { slug: "architecture" },
            { slug: "module-types" },
            { slug: "core-responsibilities" },
            { slug: "core-infrastructure" },
            { slug: "glossary" },
          ],
        },
        {
          label: "Guides",
          items: [
            { slug: "implementing-a-module" },
            { slug: "guides/writing-a-channel" },
            { slug: "guides/writing-a-factory" },
            { slug: "guides/writing-a-minion" },
          ],
        },
        {
          label: "Contracts",
          items: [
            { slug: "contracts/overview" },
            { slug: "contracts/protocol-releases" },
            {
              label: "Modules and core",
              items: [
                { slug: "contracts/module-lifecycle" },
                { slug: "contracts/module-management" },
                { slug: "contracts/module-logs" },
                { slug: "contracts/amqp-envelope" },
                { slug: "contracts/amqp-conventions" },
              ],
            },
            {
              label: "Channels",
              items: [
                { slug: "contracts/minion-connection" },
                { slug: "contracts/channel-core-sync" },
                { slug: "contracts/channel-core-connections" },
                { slug: "contracts/agentless-channels" },
                { slug: "modules/ssh" },
              ],
            },
            {
              label: "Builds",
              items: [
                { slug: "contracts/minion-build" },
                { slug: "contracts/credentials" },
              ],
            },
            {
              label: "Minion Messages",
              items: [
                { slug: "contracts/minion-messages" },
                { slug: "contracts/minion-messages/wire-format" },
                { slug: "contracts/minion-messages/sessions" },
                { slug: "contracts/minion-messages/tasks-and-results" },
                { slug: "contracts/task-results-and-actions" },
                { slug: "contracts/minion-messages/file-transfers" },
                { slug: "contracts/file-browser" },
                { slug: "contracts/minion-messages/identity" },
                { slug: "contracts/minion-messages/tunnels" },
                { slug: "contracts/vpn-front" },
                { slug: "contracts/minion-messages/delegation" },
                { slug: "contracts/minion-messages/codecs" },
              ],
            },
          ],
        },
        {
          label: "Contributing",
          items: [
            { slug: "contributing/repositories" },
            { slug: "contributing/development-stack" },
            { slug: "contributing/testing-and-ci" },
            { slug: "contributing/changing-the-protocol" },
            { slug: "contributing/architecture-rules" },
            { slug: "contributing/writing-the-docs" },
          ],
        },
      ],
    }),
  ],
});
