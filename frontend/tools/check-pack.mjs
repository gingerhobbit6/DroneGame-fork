// Checks .sgmap files with the game's own reader (decodePack: the header, the limits, every grid against its fingerprint, the
// features), and whether a world fits round the middle. Nothing is changed. Usage: node tools/check-pack.mjs <file.sgmap> [...]
import { readFileSync } from 'node:fs';
import { decodePack } from '../src/api/pack-store.js';
import { siteProblem } from '../src/sim/world-pack.js';

for (const file of process.argv.slice(2)) {
  try {
    const data = readFileSync(file);
    const { pack } = await decodePack(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)); // a Buffer can share its memory, so copy out its own bytes
    const { header } = pack, middle = siteProblem(pack, header.east, header.north);
    const featureBytes = header.sections.find((s) => s.name === 'features').rawLength;
    console.log(`OK  ${file}\n    "${header.name}", ${((header.N - 1) * 20) / 1000} km across, tier ${header.tier}, ${pack.features.buildings.length} buildings drawn, features ${(featureBytes / 1e6).toFixed(1)} MB, ${pack.grids.ground.length} posts`);
    console.log(`    a world at the middle: ${middle || 'fits'}`);
  } catch (e) {
    console.log(`BAD ${file}: ${e.message}`);
  }
}
