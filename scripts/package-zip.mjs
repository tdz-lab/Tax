#!/usr/bin/env node
// Creates release/au-tax-trading-ledger-<version>.zip with the complete project (source, tests, docs,
// pre-built dist/) and without node_modules, caches, test output, secrets or personal data.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const name = `au-tax-trading-ledger-${pkg.version}`;
const outDir = resolve(root, 'release');
const zipPath = resolve(outDir, `${name}.zip`);
if (!existsSync(resolve(root, 'dist/index.html'))) {
  console.error('Run "npm run build" first so the ZIP contains the ready-to-run application.');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
rmSync(zipPath, { force: true });
const exclude = ['node_modules/*', '*/node_modules/*', '.git/*', 'release/*', 'test-results/*', 'playwright-report/*', 'dev-dist/*', '*.log', '.DS_Store', '*/.DS_Store', '.vite/*', 'node_modules/.tmp/*', '.env', '.env.*'];
execFileSync('zip', ['-r', '-q', '-X', zipPath, '.', '-x', ...exclude], { cwd: root, stdio: 'inherit' });
console.log(`Created ${zipPath}`);
