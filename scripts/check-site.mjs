import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const ignored = new Set(['.git', 'node_modules', '.wrangler', 'coverage']);
const files = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else files.push(path);
  }
}

await walk(root);
const htmlFiles = files.filter(file => file.endsWith('.html'));
const failures = [];
for (const file of htmlFiles) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)) {
    const reference = match[1];
    if (!reference || /^(?:https?:|mailto:|tel:|#|data:|javascript:)/i.test(reference)) continue;
    const clean = reference.split(/[?#]/)[0];
    if (!clean) continue;
    const target = clean.startsWith('/') ? resolve(root, clean.slice(1)) : resolve(dirname(file), clean);
    try {
      const info = await stat(target);
      if (info.isDirectory()) await stat(join(target, 'index.html'));
    } catch {
      failures.push(`${relative(root, file)} -> ${reference}`);
    }
  }
}

if (failures.length) {
  console.error(`Broken local references:\n${failures.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`Checked ${htmlFiles.length} HTML files; all local links and assets resolve.`);
}
