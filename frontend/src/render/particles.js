// A fixed pool of soft round particles drawn as one THREE.Points. Each one moves, slows, rises or falls, spreads and fades on its
// own, and when the pool is full the oldest is reused. Sizes are diameters in scene units.

import * as THREE from 'three';

const S = 10; // numbers kept per particle: velocity (3), age, life, size from and to, alpha, lift, drag

// A soft round spot, worked out here as tests have no canvas.
function softDot(n = 32) {
  const data = new Uint8Array(n * n * 4).fill(255);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[(j * n + i) * 4 + 3] = 255 * Math.max(0, 1 - Math.hypot(i + 0.5 - n / 2, j + 0.5 - n / 2) / (n / 2)) ** 1.5;
  const t = new THREE.DataTexture(data, n, n);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
export const SOFT_DOT = softDot();

// The scene uses a logarithmic depth buffer, so the logdepthbuf chunks keep particles behind hills and buildings.
// sized as a true diameter: the projection's focal length times half the screen's height in pixels, over the distance
const vertexShader = `#include <common>
attribute float size;
attribute vec4 tint;
uniform float halfHeight;
varying vec4 vTint;
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
  vTint = tint;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * projectionMatrix[1][1] * halfHeight / -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;
// fading into the haze, rather than taking its colour, suits light added as well as smoke
const fragmentShader = `uniform sampler2D map;
varying vec4 vTint;
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  gl_FragColor = vTint * texture2D(map, gl_PointCoord);
  #if defined(USE_FOG) && !defined(FOG_EXP2)
  gl_FragColor.a *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  #include <colorspace_fragment>
}`;

// blending: THREE.AdditiveBlending for fire and flashes, THREE.NormalBlending for smoke and dust. lifeScale shortens them all.
export function createParticles(scene, name, count, blending, lifeScale = 1) {
  const pos = new Float32Array(count * 3), tint = new Float32Array(count * 4), size = new Float32Array(count), st = new Float32Array(count * S);
  const geo = new THREE.BufferGeometry();
  const attr = (key, array, n) => { const a = new THREE.BufferAttribute(array, n).setUsage(THREE.DynamicDrawUsage); geo.setAttribute(key, a); return a; };
  const aPos = attr('position', pos, 3), aTint = attr('tint', tint, 4), aSize = attr('size', size, 1);
  const material = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), map: { value: SOFT_DOT }, halfHeight: { value: 400 } },
    vertexShader, fragmentShader, blending, transparent: true, depthWrite: false, fog: true,
  });
  const points = new THREE.Points(geo, material), _px = new THREE.Vector2();
  points.onBeforeRender = (renderer) => { material.uniforms.halfHeight.value = renderer.getDrawingBufferSize(_px).y / 2; };
  points.name = name;
  points.frustumCulled = false; // the pool is spread over the whole map
  scene.add(points);
  let next = 0, live = 0;

  // One particle at (x, y, z) moving at (vx, vy, vz) a second. look: { life, from, to, alpha, lift, drag, colour }; k scales its sizes, speeds and lift.
  function spawn(look, x, y, z, vx, vy, vz, k, colour = look.colour) {
    const i = next, j = i * S, vary = 0.8 + Math.random() * 0.4;
    next = (next + 1) % count;
    if (!st[j + 4]) live++;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    tint[i * 4] = colour.r; tint[i * 4 + 1] = colour.g; tint[i * 4 + 2] = colour.b; tint[i * 4 + 3] = 0;
    st[j] = vx * k; st[j + 1] = vy * k; st[j + 2] = vz * k; st[j + 3] = 0; st[j + 4] = look.life * lifeScale * vary;
    st[j + 5] = size[i] = look.from * k * vary; st[j + 6] = look.to * k * vary;
    st[j + 7] = look.alpha; st[j + 8] = (look.lift || 0) * k; st[j + 9] = look.drag || 0;
  }

  function update(dt) {
    if (!live) return;
    for (let i = 0; i < count; i++) {
      const j = i * S, life = st[j + 4];
      if (!life) continue;
      const a = (st[j + 3] += dt) / life;
      if (a >= 1) { st[j + 4] = size[i] = tint[i * 4 + 3] = 0; live--; continue; }
      const keep = Math.max(0, 1 - st[j + 9] * dt);
      st[j] *= keep; st[j + 1] = st[j + 1] * keep + st[j + 8] * dt; st[j + 2] *= keep;
      pos[i * 3] += st[j] * dt; pos[i * 3 + 1] += st[j + 1] * dt; pos[i * 3 + 2] += st[j + 2] * dt;
      size[i] = st[j + 5] + (st[j + 6] - st[j + 5]) * (1 - (1 - a) ** 2); // spreads fast, then slowly
      tint[i * 4 + 3] = st[j + 7] * (1 - a) * Math.min(1, a * 10); // a moment to appear, then fades away
    }
    aPos.needsUpdate = aTint.needsUpdate = aSize.needsUpdate = true;
  }

  function clear() {
    st.fill(0); size.fill(0); tint.fill(0);
    live = 0;
    aTint.needsUpdate = aSize.needsUpdate = true;
  }

  return { points, spawn, update, clear };
}
