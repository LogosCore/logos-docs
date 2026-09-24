# logos-docs

Documentation project for defining early technical requirements and architecture for **Logos**.

## Stack

- [Astro](https://astro.build/) + [Starlight](https://starlight.astro.build/) (docs framework)
- [Tailwind CSS v4](https://tailwindcss.com/) (custom styling)
- [Mermaid](https://mermaid.js.org/) diagrams (build-time rendered via `astro-mermaid`)
- Full-text search via Pagefind (built in to Starlight)
- GitHub Actions + GitHub Pages

## Local Development

```bash
npm install
npm run dev      # http://localhost:4321/logos-docs/
```

Production build (what CI runs):

```bash
npm run build    # outputs static site to ./dist
npm run preview  # preview the production build locally
```

## Project Structure

- `astro.config.mjs`: site configuration — base path, i18n (en/uk), sidebar, integrations.
- `src/content/docs/`: Markdown content. English at the root, Ukrainian under `uk/`.
- `src/content.config.ts`: Starlight docs collection definition.
- `src/styles/global.css`: Tailwind + Starlight theme layer.
- `.github/workflows/deploy-docs.yml`: automated build + deploy to GitHub Pages.

## Internationalization

- English is the default locale and is served from the site root (`/`).
- Ukrainian lives under `/uk/`. Each English page `src/content/docs/<slug>.md` has a
  Ukrainian counterpart at `src/content/docs/uk/<slug>.md`.
- The language switcher in the header is provided automatically by Starlight.

## Publish on GitHub Pages

1. Create an empty GitHub repository named `logos-docs`.
2. Confirm `site` and `base` in `astro.config.mjs` match the Pages URL.
3. Commit and push to `main`.
4. In `Settings -> Pages`, ensure the source is `GitHub Actions`.

After the first successful workflow run, the site URL will be:

`https://logos.github.io/logos-docs/`
