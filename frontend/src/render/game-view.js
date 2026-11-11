// The 3D scene: reads the simulation each frame and draws it. It never changes the simulation.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SITE, BUILD } from '../sim/config/index.js';
import { terrainState } from '../sim/terrain.js';
import { u } from '../sim/units.js';
import { buildWorldView, drapedRing, groundU, makeHillshade } from './terrain-view.js';
import { createLabels } from './labels.js';
import { createStructureViews } from './structure-view.js';
import { createPeopleViews } from './people-view.js';
import { createDroneViews } from './drone-view.js';
import { createBeliefViews } from './belief-view.js';
import { createEffects } from './effects.js';
import { createZoneView } from './zone-view.js';
import { createEyeView } from './eye-view.js';
import { createMapTexture } from './map-texture.js';
import { setModelEnv } from './paint.js';
import { sizeWideLines } from './wide-lines.js';
import { createCameraKeys, fitDistance, framing } from './camera-moves.js';
import { FOV, view } from './view.js';

const FLIGHT_SECONDS = 0.7;
const FIT_LEAST = u(300); // framing a single system still shows the ground around it
// How the scene looks in the run's conditions: sky and fog colour, fog distance (m) and light. The look only; the physics is in sim/conditions.js.
const LOOKS = {
  day: { sky: 0x0b1220, fog: [12000, 30000], hemi: 0.9, sun: 1.1, sunColour: 0xffffff },
  dusk: { sky: 0x2b1d2f, fog: [9000, 26000], hemi: 0.55, sun: 0.6, sunColour: 0xffb27a },
  night: { sky: 0x03060c, fog: [6000, 18000], hemi: 0.3, sun: 0.15, sunColour: 0x9fb4ff },
  rain: { sky: 0x2f3742, fog: [2500, 9000], hemi: 0.6, sun: 0.35, sunColour: 0xd0d8e0 },
};

// The sun casts shadows only within this camera distance (scene units), where models are drawn near true size: farther out
// they are drawn far larger than life (drawnUnit, drawScale), so their shadows would mislead, and one map would spread too thin.
export const SHADOW_ZOOM = u(300);
const SUN_FROM = new THREE.Vector3(60, 120, 40).normalize();
// Half the width of the ground the sun's shadows cover, about what is in view, or nothing when too far out to cast them.
export const shadowReach = (zoom, eye) => (eye ? u(150) : zoom < SHADOW_ZOOM ? Math.max(zoom * 1.2, u(25)) : 0);

// getMapSource(world): the pictures, roads and names for a real world. The simulation never sees them. onProblem(text) tells the player.
const WHEEL_ZOOM = 2, PINCH_ZOOM = 8; // OrbitControls zoom speeds, against its default of 1

export function createGameView(canvas, labelLayer, sim, getMapSource = () => null, onProblem = () => {}) {
  // logarithmic depth: the camera goes from metres to kilometres away. high-performance: on a laptop with two graphics cards, a hint
  // to use the faster one (a browser may ignore it): London's buildings ran at 18 frames a second on integrated graphics.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  // A faint studio reflection on the models only: scene.environment stays unset, so the map keeps its true colours.
  const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment(renderer);
  setModelEnv(pmrem.fromScene(room, 0.04).texture);
  room.dispose(); pmrem.dispose();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(0); // colours, distances and light come from LOOKS on the first update
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.02, 8000); // 160 km: the far side of a 25 km ring, seen from right out
  camera.position.set(0, 300, 380);
  const controls = new OrbitControls(camera, canvas);
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 0.25; // 5 m: close enough to see a small quadcopter or a person, drawn at true size up close
  controls.zoomToCursor = true; // so the camera can close in on a drone in the air, not only on the ground it looks at
  controls.maxDistance = 3000; // 60 km out, so a 25 km NASAMS or Sky Sabre ring fits on screen at its true size
  controls.enableDamping = true;
  // Map-style, which suits a trackpad: drag slides the map over the ground, right-drag or Shift, Ctrl or Cmd with a drag turns
  // the view, and the wheel, a two-finger scroll or a pinch zooms. One finger pans a touch screen and two zoom and turn it.
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.screenSpacePanning = false; // a drag moves across the ground, not up the screen into the sky
  // A pinch arrives as many tiny wheel steps with Ctrl held, so it zooms far more per step than a wheel notch. Both are tuned by hand.
  canvas.addEventListener('wheel', (e) => { controls.zoomSpeed = e.ctrlKey ? PINCH_ZOOM : WHEEL_ZOOM; }, { capture: true, passive: true });

  const sky = new THREE.HemisphereLight(0xbcd4ff, 0x203020);
  scene.add(sky);
  const sun = new THREE.DirectionalLight();
  sun.position.copy(SUN_FROM);
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun, sun.target);
  // The sun's shadow box follows what the camera looks at (from a mast, the camera itself), sized to the view.
  function shade() {
    const half = shadowReach(view.zoom, view.eye);
    sun.castShadow = half > 0;
    if (!half) return;
    const at = view.eye ? camera.position : controls.target, c = sun.shadow.camera;
    sun.target.position.copy(at);
    sun.position.copy(at).addScaledVector(SUN_FROM, half * 4);
    c.left = c.bottom = -half; c.right = c.top = half; c.near = half; c.far = half * 8;
    c.updateProjectionMatrix();
  }
  let lit = null, fogBase = null;
  function light(name) {
    const look = LOOKS[name] ?? LOOKS.day;
    lit = name;
    scene.background.setHex(look.sky);
    scene.fog.color.setHex(look.sky);
    fogBase = look.fog.map(u);
    sky.intensity = look.hemi;
    sun.intensity = look.sun; sun.color.setHex(look.sunColour);
  }

  // ---------- terrain and the protected site ----------
  const siteMat = new THREE.MeshStandardMaterial({ color: 0x8aa0b4, roughness: 0.7, emissive: 0xff0000, emissiveIntensity: 0 });
  const siteRing = drapedRing(u(SITE.radius), 0.8, 0xff5252, 0.6);
  const buildRing = drapedRing(u(BUILD.maxDist), 1.2, 0x5c7bb0, 0.4);
  scene.add(siteRing.mesh, buildRing.mesh);
  let worldView = null, flash = 0, ownMaterial = null, relief = null, siteOpacity = 0.6;
  const map = createMapTexture(renderer, () => relief);
  // Paint the chosen picture onto a real world. Resolves with how a live map's tiles went.
  function refreshMap() {
    const data = terrainState.data, source = data.geo && getMapSource(sim.state.terrainSeed);
    if (!source) return Promise.resolve(null);
    if (['satellite', 'hybrid'].includes(view.baseMap) && !source.pictures.some((p) => p.layer === 'satellite')) view.baseMap = 'os'; // the last world had it, this one doesn't
    return map.paint(data, source, { baseMap: view.baseMap, roads: view.mapRoads, grid: view.mapGrid, contours: view.mapContours }).then((result) => {
      if (terrainState.data === data && !result.stale) { view.hillshade = map.small; worldView.mesh.material = map.material; } // back on the ground, if the last paint failed
      return result;
    });
  }
  function loadWorld() {
    if (worldView) { worldView.mesh.material = ownMaterial; worldView.dispose(); }
    relief = makeHillshade(terrainState.data);
    view.hillshade = relief;
    worldView = buildWorldView(scene, terrainState.data, siteMat);
    for (const m of [worldView.mesh, ...worldView.scenery]) m.receiveShadow = true;
    ownMaterial = worldView.mesh.material;
    if (terrainState.data.geo) {
      const { mesh } = worldView;
      mesh.material = map.material;
      // A picture that fails would leave the ground wearing the last world's, so the ground goes back to its own colours.
      refreshMap().catch(() => { if (worldView.mesh === mesh) { mesh.material = ownMaterial; onProblem('The map could not be drawn, so the ground is shown without it'); } });
    }
    siteRing.update(0, 0);
    buildRing.update(0, 0);
    siteRing.mesh.position.y = buildRing.mesh.position.y = groundU(0, 0); // a draped ring's heights are from the ground at its centre
    siteOpacity = terrainState.data.geo ? 0.9 : 0.6; // a real map is bright, so these need more to show
    buildRing.mesh.material.opacity = terrainState.data.geo ? 0.9 : 0.4;
  }
  // Plan view is the same camera looking straight down, as the minimap reads its field of view and placement raycasts through it.
  let beforePlan = null;
  function viewFromAbove(on) {
    if (on && !beforePlan) {
      beforePlan = { position: camera.position.clone(), target: controls.target.clone() };
      camera.position.set(controls.target.x, Math.max(camera.position.y, 500), controls.target.z + 0.01);
    } else if (!on && beforePlan) {
      camera.position.copy(beforePlan.position); controls.target.copy(beforePlan.target);
      beforePlan = null;
    }
    controls.enableRotate = !on;
  }
  // Glide the camera to look at a point, from a new distance or compass angle (azimuth) if given, else its own. It turns the short way round.
  let flight = null;
  const _offset = new THREE.Vector3(), _at = new THREE.Spherical();
  function glide(x, z, { distance, azimuth } = {}) {
    const from = new THREE.Spherical().setFromVector3(_offset.subVectors(camera.position, controls.target)), to = from.clone();
    if (distance != null) to.radius = THREE.MathUtils.clamp(distance, controls.minDistance, controls.maxDistance);
    if (azimuth != null) to.theta = from.theta + THREE.MathUtils.euclideanModulo(azimuth - from.theta + Math.PI, Math.PI * 2) - Math.PI;
    flight = { t: 0, fromTarget: controls.target.clone(), toTarget: new THREE.Vector3(x, groundU(x, z), z), from, to };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) flight.t = 1;
  }
  // Glide over a point, keeping the camera's angle, and coming in to `closest` if it is further out than that.
  const centreOn = (x, z, closest = Infinity) => glide(x, z, { distance: Math.min(camera.position.distanceTo(controls.target), closest) });
  controls.addEventListener('start', () => { flight = null; }); // the player has taken over
  // Keep the followed drone in the middle of the view: the camera keeps its angle and distance, and catches up smoothly.
  const _shift = new THREE.Vector3();
  function follow(real) {
    const d = view.drone;
    if (!view.truth || !view.follow || !d || d.dead || view.eye) return;
    flight = null;
    _shift.subVectors(d.pos, controls.target).multiplyScalar(1 - Math.exp(-real * 6));
    controls.target.add(_shift); camera.position.add(_shift);
  }
  function fly(real) {
    if (!flight) return;
    flight.t = Math.min(flight.t + real / FLIGHT_SECONDS, 1);
    const ease = flight.t * flight.t * (3 - 2 * flight.t), { from, to } = flight;
    controls.target.lerpVectors(flight.fromTarget, flight.toTarget, ease);
    _at.set(from.radius + (to.radius - from.radius) * ease, from.phi + (to.phi - from.phi) * ease, from.theta + (to.theta - from.theta) * ease);
    camera.position.copy(controls.target).add(_offset.setFromSpherical(_at));
    if (flight.t === 1) flight = null;
  }
  const keys = createCameraKeys(camera, controls);
  // From a mast the camera is the mast's, so these leave it alone.
  function northUp() { if (!view.eye) glide(controls.target.x, controls.target.z, { azimuth: 0 }); }
  // Frame every system, group of people and the area defended, keeping the camera's angle. With nothing placed, the build ring.
  function fitLaydown() {
    if (view.eye) return;
    const points = [
      ...sim.structures.map((s) => ({ x: s.pos.x, z: s.pos.z, r: 0 })),
      ...sim.people.map((g) => ({ x: g.x, z: g.z, r: 0 })),
      ...(view.zone?.points ?? sim.state.zone ?? []).map(([x, z]) => ({ x, z, r: 0 })),
    ];
    if (!sim.siteIsFree()) points.push({ x: 0, z: 0, r: u(points.length ? SITE.radius : BUILD.maxDist) });
    const f = framing(points);
    if (f) glide(f.x, f.z, { distance: fitDistance(Math.max(f.radius, FIT_LEAST), camera) });
  }
  // A double-click glides to the spot and closes in by half.
  const zoomInOn = (x, z) => { if (!view.eye) centreOn(x, z, camera.position.distanceTo(controls.target) / 2); };
  const mePin = new THREE.Mesh(new THREE.CylinderGeometry(3, 0.4, 14, 12).translate(0, 7, 0), new THREE.MeshBasicMaterial({ color: 0x2979ff, depthTest: false, transparent: true }));
  mePin.renderOrder = 15; mePin.visible = false;
  scene.add(mePin);
  let meRing = null, meRingFor = null; // how far off the fix may be, redrawn when a new one arrives
  function showMe() {
    mePin.visible = !!view.me;
    if (meRingFor !== view.me) {
      if (meRing) { scene.remove(meRing.mesh); meRing.dispose(); meRing = null; }
      meRingFor = view.me;
      if (view.me) {
        meRing = drapedRing(view.me.accuracy, Math.max(0.4, view.me.accuracy * 0.03), 0x2979ff, 0.75, 64);
        meRing.update(view.me.x, view.me.z);
        meRing.mesh.position.set(view.me.x, groundU(view.me.x, view.me.z), view.me.z);
        scene.add(meRing.mesh);
        mePin.position.set(view.me.x, groundU(view.me.x, view.me.z), view.me.z);
      }
    }
  }

  // Small pictures of each map for the switcher. They are worked out once for each world.
  let previews = { world: null };
  function mapPreviews(ids) {
    const world = sim.state.terrainSeed;
    if (previews.world === world) return previews.found;
    const data = terrainState.data, source = data.geo && getMapSource(world);
    const found = source ? map.previews(data, source, ids) : Promise.resolve({ generated: relief.toDataURL('image/jpeg', 0.8) });
    previews = { world, found };
    found.catch(() => { if (previews.found === found) previews = { world: null }; }); // a failure is not kept: the next look tries again
    return found;
  }

  loadWorld();
  sim.on('terrain', loadWorld);
  sim.on('siteHit', () => { flash = 0.4; });

  const labels = createLabels(labelLayer, camera);
  const structures = createStructureViews(scene, sim, labels);
  const people = createPeopleViews(scene, sim, labels);
  const drones = createDroneViews(scene, sim, labels, camera);
  const beliefs = createBeliefViews(scene, sim.net, labels);
  const effects = createEffects(scene, sim, camera);
  const eyeView = createEyeView(camera, controls, sim, canvas);
  const zone = createZoneView(scene, sim);
  sim.on('terrain', zone.redraw);

  // Show the live state of the simulation. Replay runs after this and hides what it replaces.
  function update(real) {
    if (sim.state.conditions !== lit) light(sim.state.conditions);
    effects.update(real);
    structures.sync(real);
    people.sync();
    drones.sync(real);
    beliefs.update();
    structures.updateLabels(sim.net);
    drones.updateLabels();
    zone.sync();
    showMe();
    for (const m of worldView.scenery) m.visible = view.scenery || !terrainState.data.geo; // the switch is only offered on a real map
    if (!view.eye && keys.step(real)) flight = null; // a held key takes over from a glide, as a drag does
    fly(real);
    follow(real);
    flash = Math.max(0, flash - real);
    siteMat.emissiveIntensity = flash > 0 ? flash * 1.5 : 0;
    siteRing.mesh.material.opacity = flash > 0 ? 1 : siteOpacity; // a real site has no station to light up
    siteRing.mesh.visible = buildRing.mesh.visible = !sim.siteIsFree(); // a drawn area is the site, and you can build anywhere
  }

  function resize() {
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); // browser zoom, or another monitor's scale, changes it and fires this
    renderer.setSize(innerWidth, innerHeight, false);
    sizeWideLines(innerWidth, innerHeight); // beams and tracer are drawn so many pixels wide
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  return {
    scene, camera, controls, labels, structures, update, refreshMap, mapPreviews, viewFromAbove, centreOn, keys, northUp, fitLaydown, zoomInOn,
    draw() {
      if (eyeView.update()) view.zoom = u(20); // from a mast, what is near is drawn true size
      else { controls.update(); view.zoom = camera.position.distanceTo(controls.target); }
      // the haze starts beyond what the camera is looking at, so zoomed right out the map stays clear and only the horizon fades
      scene.fog.near = Math.max(fogBase[0], view.zoom * 1.25); scene.fog.far = scene.fog.near + fogBase[1] - fogBase[0];
      shade();
      labels.declutter();
      renderer.render(scene, camera);
    },
    start(frame) { renderer.setAnimationLoop(frame); },
    clear() { effects.clear(); beliefs.clear(); },
    // While rewinding, the live objects are hidden and the replay view is shown instead.
    hideLive() { drones.hide(); beliefs.hide(); effects.hide(); structures.hideBeams(); },
  };
}
