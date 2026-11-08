// Saves every drone type's model as a .glb file (glTF, in metres, nose along +z) to open in Blender or any glTF viewer.
// Run from frontend/: npm run models -- [folder], default models/.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { DRONES } from '../src/sim/config/index.js';
import { buildDrone } from '../src/render/drone-models.js';

// the exporter reads its output back through the browser's FileReader, which Node does not have
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((b) => { this.result = b; this.onloadend?.(); }); }
};

const dir = process.argv[2] ?? 'models';
mkdirSync(dir, { recursive: true });
const dark = new THREE.MeshStandardMaterial({ color: 0x333840, roughness: 0.7, name: 'dark' });
const spin = new THREE.MeshBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.35, name: 'propeller' });
for (const [type, def] of Object.entries(DRONES)) {
  const body = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.5, name: 'body' });
  const model = buildDrone(def, { body, dark, spin });
  model.name = def.name;
  const glb = await new GLTFExporter().parseAsync(model, { binary: true });
  writeFileSync(join(dir, `${type}.glb`), Buffer.from(glb));
}
console.log(`${Object.keys(DRONES).length} models saved to ${dir}`);
