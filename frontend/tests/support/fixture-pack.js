// A hand-made map pack: 56 km across, so a 54 km world fits with 1 km to spare, around SU 22 66, with a hill to the north, sea to the east, a wood and a building.

export const CENTRE = { east: 422000, north: 166000 };
const N = 2801, HALF = 28000;

export function fixtureParts() {
  const ground = new Float32Array(N * N), canopy = new Uint8Array(N * N), bldg = new Uint8Array(N * N), cover = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = -HALF + i * 20, z = -HALF + j * 20, k = j * N + i;
      ground[k] = 100 + Math.min(300, Math.max(0, -z - 3000) * 0.3);
      if (x >= 5000) { ground[k] = -2; cover[k] = 4; }
      if (x > 800 && x < 1600 && z > 500 && z < 1500) { canopy[k] = 18; cover[k] = 1; }
      if (x > -1020 && x < -960 && z > 960 && z < 1020) { bldg[k] = 9; cover[k] = 2; }
    }
  }
  const header = {
    name: 'Fixture', east: CENTRE.east, north: CENTRE.north, half: HALF, cell: 20, N, tier: 'lidar', lidarHalf: 7000,
    credits: { osmap: 'OS credit', satellite: 'Copernicus credit' },
    lonFit: [-1.72, 0.1436, 0.0005, 0, 0, 0], latFit: [51.41, -0.0005, 0.0899, 0, 0, 0], geoidSeparation: 48.5,
  };
  const features = {
    buildings: [[-1000, 1000, 40, 30, 9, 0.5], [27900, 27900, 10, 10, 8, 0]],
    lines: [[[0, 3000], [260, 3000], [520, 3000]]],
    roads: [['A Road', [[-100, 0], [100, 0]]]],
    names: [['Testville', 'Populated Place', 'Large', 10, 10]],
  };
  return { header, grids: { ground, canopy, bldg, cover }, features };
}

async function gzip(bytes) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
}
const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function gridsHash({ ground, canopy, bldg, cover }) {
  return hex(await crypto.subtle.digest('SHA-256', await new Blob([ground, canopy, bldg, cover]).arrayBuffer()));
}

// The same layout as tools/mapbuild/mapbuild/packfile.py. `change` can damage the header before it is written.
export async function encodePack({ change = () => {}, pictures = [] } = {}) {
  const { header, grids, features } = fixtureParts();
  const sections = [], blobs = [];
  let offset = 0;
  const add = (name, blob, rawLength, extra = {}) => { sections.push({ name, offset, length: blob.length, rawLength, ...extra }); blobs.push(blob); offset += blob.length; };
  for (const name of ['ground', 'canopy', 'bldg', 'cover']) {
    const raw = new Uint8Array(grids[name].buffer);
    add(name, await gzip(raw), raw.length);
  }
  const text = new TextEncoder().encode(JSON.stringify(features));
  add('features', await gzip(text), text.length);
  pictures.forEach((p, i) => add(`picture${i}`, p.data, p.data.length, { layer: p.layer, west: p.west, top: p.top, width: p.width, height: p.height, type: p.type }));
  const final = { ...header, gridsSha256: await gridsHash(grids), sections };
  change(final);
  const head = new TextEncoder().encode(JSON.stringify(final));
  const start = new Uint8Array(10);
  start.set(new TextEncoder().encode('SGMAP'));
  start[5] = 1;
  new DataView(start.buffer).setUint32(6, head.length, true);
  return new Blob([start, head, ...blobs]).arrayBuffer();
}
