// One-shot migration: MkDocs docs/ -> Starlight src/content/docs/
// - splits en (root) / uk locales
// - injects `title` frontmatter from the first H1
// - converts MkDocs admonitions (!!! type "Title") to Starlight asides (:::type[Title])
// - rewrites internal .md links to relative slug URLs
import { promises as fs } from 'node:fs';
import path from 'node:path';

const SRC = 'docs';
const OUT = 'src/content/docs';

// MkDocs admonition type -> Starlight aside type
const ASIDE_TYPES = {
  note: 'note',
  info: 'note',
  tip: 'tip',
  hint: 'tip',
  warning: 'caution',
  caution: 'caution',
  danger: 'danger',
  error: 'danger',
};

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(full)));
    else if (e.name.endsWith('.md')) files.push(full);
  }
  return files;
}

// docs/foo.md -> { locale:'en', slug:'foo' }; docs/adr/README.uk.md -> { locale:'uk', slug:'adr' }
function classify(file) {
  let rel = path.relative(SRC, file).replace(/\\/g, '/'); // e.g. adr/README.uk.md
  const isUk = rel.endsWith('.uk.md');
  rel = rel.replace(/\.uk\.md$/, '').replace(/\.md$/, ''); // adr/README
  // README -> directory index (slug = parent dir, or '' at root)
  if (/(^|\/)README$/i.test(rel)) {
    rel = rel.replace(/(^|\/)README$/i, '');
  }
  const slug = rel; // '' means site index for that locale
  return { locale: isUk ? 'uk' : 'en', slug };
}

function destPath(locale, slug) {
  const fileSlug = slug === '' ? 'index' : slug;
  return locale === 'uk'
    ? path.join(OUT, 'uk', `${fileSlug}.md`)
    : path.join(OUT, `${fileSlug}.md`);
}

// Resolve a link target like "architecture.md#x" relative to the current page slug.
function rewriteLink(target, sourceSlug) {
  const m = target.match(/^([^#]*?)\.md(#.*)?$/);
  if (!m) return null;
  let targetRel = m[1]; // may contain '/'
  const hash = m[2] || '';
  if (/(^|\/)README$/i.test(targetRel)) {
    targetRel = targetRel.replace(/(^|\/)README$/i, '');
  }
  // Relative URL from the source page directory (its slug) to the target slug dir.
  const fromDir = sourceSlug === '' ? '.' : sourceSlug;
  const toDir = targetRel === '' ? '.' : targetRel;
  let relative = path.posix.relative(fromDir, toDir);
  if (relative === '') relative = '.';
  // Ensure trailing slash so it resolves as a directory URL.
  return `${relative}/`.replace(/\/+$/, '/') + hash;
}

function convertAdmonitions(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^!!!\s+(\w+)(?:\s+"([^"]*)")?\s*$/);
    if (!m) {
      out.push(lines[i]);
      continue;
    }
    const type = ASIDE_TYPES[m[1].toLowerCase()] || 'note';
    const title = m[2];
    // Collect indented (>=4 spaces) / blank body lines.
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === '') {
        body.push('');
        continue;
      }
      if (/^ {4}/.test(l)) {
        body.push(l.slice(4));
        continue;
      }
      break;
    }
    // Trim leading/trailing blank lines of the body.
    while (body.length && body[0] === '') body.shift();
    while (body.length && body[body.length - 1] === '') body.pop();
    out.push(`:::${type}${title ? `[${title}]` : ''}`);
    out.push(...body);
    out.push(':::');
    i = j - 1;
  }
  return out.join('\n');
}

function extractTitle(text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#\s+(.*\S)\s*$/);
    if (m) {
      lines.splice(i, 1);
      // drop a single trailing blank line left behind
      if (lines[i] === '') lines.splice(i, 1);
      return { title: m[1], body: lines.join('\n') };
    }
  }
  return { title: null, body: text };
}

function yamlQuote(s) {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function main() {
  const files = await walk(SRC);
  let count = 0;
  for (const file of files) {
    const { locale, slug } = classify(file);
    let text = await fs.readFile(file, 'utf8');

    const { title, body } = extractTitle(text);
    let content = convertAdmonitions(body);

    // Rewrite internal .md links.
    content = content.replace(/\]\(([^)]+?\.md(?:#[^)]*)?)\)/g, (full, tgt) => {
      // skip absolute URLs
      if (/^[a-z]+:\/\//i.test(tgt) || tgt.startsWith('/')) return full;
      const rewritten = rewriteLink(tgt, slug);
      return rewritten ? `](${rewritten})` : full;
    });

    const finalTitle = title || (slug === '' ? 'Home' : slug);
    const frontmatter = `---\ntitle: ${yamlQuote(finalTitle)}\n---\n\n`;
    const dest = destPath(locale, slug);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, frontmatter + content.replace(/^\n+/, ''), 'utf8');
    count++;
  }
  console.log(`Migrated ${count} files into ${OUT}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
