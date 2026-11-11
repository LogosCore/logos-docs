// Checks the built site (dist/): every link from a page's content to a page
// of the site reaches a built page, and its #anchor an id on that page.
// Starlight's own navigation is left out (the sidebar repeats every page).
//
//   npm run build && npm run check:links
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const dist = join(process.cwd(), "dist");
const base = "/logos-docs/";
const entities = { amp: "&", quot: '"', "#39": "'", lt: "<", gt: ">" };
const decode = (s) => s.replace(/&(amp|quot|#39|lt|gt);/g, (_, e) => entities[e]);

const pages = new Map();
const ids = new Map();
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      walk(p);
    } else if (f.endsWith(".html")) {
      const rel = relative(dist, p).split("\\").join("/");
      const url = base + (rel.endsWith("index.html") ? rel.slice(0, -"index.html".length) : rel);
      const html = readFileSync(p, "utf8");
      pages.set(url, html);
      ids.set(url, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => decode(m[1]))));
    }
  }
};
walk(dist);

let checked = 0;
const broken = [];
for (const [url, html] of pages) {
  if (url.startsWith(`${base}pagefind`) || url.includes("/_astro/")) continue;
  const main = html.match(/<main[^>]*>([\s\S]*)<\/main>/);
  for (const m of (main ? main[1] : html).matchAll(/<a\s[^>]*href="([^"]+)"/g)) {
    const href = decode(m[1]);
    if (/^(https?:|mailto:|javascript:)/.test(href)) continue;
    const target = new URL(href, `https://docs${url}`);
    let path = target.pathname;
    if (/\.(css|js|svg|png|jpe?g|ico|xml|txt|json)$/.test(path)) continue;
    if (!path.endsWith("/") && !path.endsWith(".html")) path += "/";
    checked++;
    const anchor = decodeURIComponent(target.hash.slice(1));
    if (!pages.has(path)) broken.push(`${url}: ${href} (no such page)`);
    else if (anchor && !ids.get(path).has(anchor)) broken.push(`${url}: ${href} (no such anchor)`);
  }
}
for (const b of [...new Set(broken)].sort()) console.log(b);
console.log(`${pages.size} pages, ${checked} internal links, ${broken.length} broken`);
process.exit(broken.length > 0 ? 1 : 0);
