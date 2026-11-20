#!/usr/bin/env node
/**
 * Citizen bundle budget gate — docs/11 §1, AC-24.3.
 *
 * Measures the *initial* JS graph the browser must download before the citizen
 * shell is interactive: the entry <script type="module"> plus every
 * <link rel="modulepreload"> emitted into dist/index.html. Lazy route chunks
 * (staff/admin/auditor/wizard) are deliberately excluded — they are fetched on
 * demand and precached by Workbox for offline use.
 *
 * Fails the build if the initial graph exceeds 150 KB gzipped, or if any
 * staff/admin/auditor chunk leaks into the initial graph.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_BYTES = 150 * 1024;
const DIST = resolve(process.cwd(), 'dist');
const FORBIDDEN_IN_ENTRY = /(staff|admin|auditor)/i;

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function gzipSize(path) {
  return gzipSync(readFileSync(path)).length;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

let html;
try {
  html = readFileSync(join(DIST, 'index.html'), 'utf8');
} catch {
  console.error('budget: dist/index.html not found — run `npm run build` first.');
  process.exit(1);
}

const initial = new Set();
for (const match of html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)) initial.add(match[1]);
for (const match of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+\.js)"/g)) initial.add(match[1]);
for (const match of html.matchAll(/<link[^>]+href="([^"]+\.js)"[^>]+rel="modulepreload"/g)) initial.add(match[1]);

if (initial.size === 0) {
  console.error('budget: no initial JS found in dist/index.html — build output looks wrong.');
  process.exit(1);
}

const rows = [];
let total = 0;
let leaked = [];
for (const href of [...initial].sort()) {
  const file = join(DIST, href.replace(/^\//, ''));
  const gz = gzipSize(file);
  total += gz;
  rows.push({ file: href, gz });
  if (FORBIDDEN_IN_ENTRY.test(href)) leaked.push(href);
}

const allFiles = walk(DIST).filter((f) => f.endsWith('.js'));
const lazy = allFiles
  .map((f) => ({ file: f.slice(DIST.length + 1).replace(/\\/g, '/'), gz: gzipSize(f) }))
  .filter((f) => ![...initial].some((href) => href.replace(/^\//, '') === f.file))
  .sort((a, b) => b.gz - a.gz);

console.log('\nCitizen initial JS graph (gzipped):');
for (const row of rows) console.log(`  ${kb(row.gz).padStart(9)}  ${row.file}`);
console.log(`  ${'-'.repeat(9)}`);
console.log(`  ${kb(total).padStart(9)}  TOTAL  (budget ${kb(BUDGET_BYTES)})`);

if (lazy.length) {
  console.log('\nLazy chunks (not in initial graph):');
  for (const row of lazy.slice(0, 12)) console.log(`  ${kb(row.gz).padStart(9)}  ${row.file}`);
}

let failed = false;
if (total > BUDGET_BYTES) {
  console.error(`\nFAIL budget: initial citizen JS is ${kb(total)}, over the ${kb(BUDGET_BYTES)} limit by ${kb(total - BUDGET_BYTES)}.`);
  failed = true;
}
if (leaked.length) {
  console.error(`\nFAIL budget: staff/admin/auditor chunk leaked into the citizen entry graph: ${leaked.join(', ')}`);
  failed = true;
}

if (failed) process.exit(1);
console.log(`\nPASS budget: ${kb(total)} / ${kb(BUDGET_BYTES)} (${((total / BUDGET_BYTES) * 100).toFixed(1)}% used).\n`);
