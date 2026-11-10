// Checks .sgmap files as the game does when it opens one: the header, every grid, the features, and whether a world fits round
// the middle. Nothing is changed. Usage: node tools/check-pack.mjs <file.sgmap> [...]
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parsePack, siteProblem } from '../src/sim/world-pack.js';

const MAX_FEATURES = 32 * 1024 * 1024; // as frontend/src/api/pack-store.js

for (const file of process.argv.slice(2)) {
  try {
    const data = readFileSync(file);
    if (data.subarray(0, 5).toString() !== 'SGMAP') throw new Error('not a map pack');
    const length = data.readUInt32LE(6), header = JSON.parse(data.subarray(10, 10 + length).toString()), body = 10 + length;
    const section = (name) => { const s = header.sections.find((x) => x.name === name); return { s, raw: gunzipSync(data.subarray(body + s.offset, body + s.offset + s.length)) }; };
    const grids = {};
    for (const name of ['ground', 'canopy', 'bldg', 'cover']) {
      const { raw } = section(name);
      grids[name] = name === 'ground' ? new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4) : new Uint8Array(raw);
    }
    const { raw: text } = section('features');
    if (text.byteLength > MAX_FEATURES) throw new Error(`features are ${(text.byteLength / 1e6).toFixed(1)} MB, over what the game reads`);
    const pack = parsePack(header, grids, JSON.parse(text.toString()));
    const middle = siteProblem(pack, header.east, header.north);
    const lidarPosts = grids.ground.length; // shown for scale only
    console.log(`OK  ${file}\n    "${header.name}", ${((header.N - 1) * 20) / 1000} km across, tier ${header.tier}, ${pack.features.buildings.length} buildings drawn, features ${(text.byteLength / 1e6).toFixed(1)} MB, ${lidarPosts} posts`);
    console.log(`    a world at the middle: ${middle || 'fits'}`);
  } catch (e) {
    console.log(`BAD ${file}: ${e.message}`);
  }
}
