// Parses every ```mermaid block under src/content/docs as the browser will.
// astro-mermaid renders diagrams in the browser, not at build time, so a
// broken one passes `npm run build` and shows on the page as a red box of
// parser tokens. In a sequence diagram, `;` ends a statement: never put one
// in a message's text.
//
//   npm run check:diagrams
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const modules = join(root, "node_modules");
// Mermaid sanitizes with DOMPurify, which needs a DOM: in Node, a stand-in.
const purify = (await import(join(modules, "dompurify/dist/purify.es.mjs"))).default;
for (const k of ["addHook", "removeHook", "removeHooks", "removeAllHooks", "setConfig", "clearConfig"]) purify[k] = () => {};
purify.sanitize = (x) => x;
const mermaid = (await import(join(modules, "mermaid/dist/mermaid.core.mjs"))).default;

const files = [];
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.mdx?$/.test(f)) files.push(p);
  }
};
walk(join(root, "src/content/docs"));

let count = 0;
let broken = 0;
for (const file of files.sort()) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/```mermaid\n([\s\S]*?)```/g)) {
    count++;
    const line = text.slice(0, m.index).split("\n").length;
    try {
      await mermaid.parse(m[1]);
    } catch (e) {
      broken++;
      console.log(`${relative(root, file)}:${line}: ${String(e.message ?? e).split("\n")[0]}`);
    }
  }
}
console.log(`${count} diagrams, ${broken} broken`);
process.exit(broken > 0 ? 1 : 0);
