// Ember Yard — the entry program (Node 22, standard library only).
// It hands the game in: every file of game/ and screenshots/ is copied
// from beside this file into the output directory, and dossier.json is
// written with the kit's own buildDossier. The output is deterministic:
// the same input files always produce the same output bytes, because
// entries are walked in sorted order and the dossier is a pure function
// of the files it reads.
//
//   Run it with MAKEFUN_OUTPUT_DIR=out node main.ts (after mkdir -p out).
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output.
// Serve the game locally with `node serve.ts` (http://localhost:8080).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else if (entry.isFile()) fs.copyFileSync(src, dst);
  }
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
copyTree(path.join(repoRoot, 'game'), path.join(outDir, 'game'));
fs.mkdirSync(path.join(outDir, 'screenshots'), { recursive: true });
if (fs.existsSync(path.join(repoRoot, 'screenshots'))) {
  copyTree(path.join(repoRoot, 'screenshots'), path.join(outDir, 'screenshots'));
}

const dossierText = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
fs.writeFileSync(path.join(outDir, 'dossier.json'), dossierText);
