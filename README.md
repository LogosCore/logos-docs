# logos-docs

The documentation site for **Logos**: how it works, the contracts between core
and its modules, and guides for building modules and contributing. Published
at <https://logoscore.github.io/logos-docs/>.

## Stack

- [Astro](https://astro.build/) + [Starlight](https://starlight.astro.build/)
- [Tailwind CSS v4](https://tailwindcss.com/) for the site's own styling
  (monochrome: Tailwind's neutral scale)
- [Mermaid](https://mermaid.js.org/) diagrams through `astro-mermaid`, which
  renders them **in the browser**: the build does not check them
- Full-text search by Pagefind, built into Starlight
- GitHub Actions and GitHub Pages

## Working on the docs

```bash
npm install
npm run dev               # http://localhost:4321/logos-docs/
npm run check:diagrams    # every Mermaid diagram parses
npm run build             # the static site, in ./dist
npm run check:links       # every internal link and anchor in ./dist resolves
```

Do not run `npm run build` while the dev server runs: it deletes `.astro/`
under it. If you did, run `npx astro sync` and touch the pages you edited.

Conventions (page anatomy, status notes, links, diagrams, what to keep in
step) are on the site: [Writing the Docs](https://logoscore.github.io/logos-docs/contributing/writing-the-docs/).

## Structure

- `src/content/docs/`: the pages, in Markdown. Every page needs a `title` in
  its frontmatter.
- `astro.config.mjs`: the site's configuration: base path, the sidebar
  (update it when you add, move or rename a page), and redirects from retired
  pages.
- `src/styles/`: the theme (`global.css`) and the grayscale code theme.
- `src/overrides/`: Starlight components the site replaces.
- `scripts/`: the diagram and link checks.
- `.github/workflows/deploy-docs.yml`: on every push to `main`, the checks,
  the build, and the deploy to GitHub Pages.
