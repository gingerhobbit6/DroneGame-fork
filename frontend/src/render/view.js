// View settings shared between the 3D scene and the dock.
// The camera's distance from what it looks at in the opening view (game-view.js puts it at (0, 300, 380)), in scene units.
export const OPENING_ZOOM = Math.hypot(300, 380);
export const FOV = 55; // the camera's vertical field of view, degrees
export const VIEW_HEIGHT = 2 * Math.tan((FOV / 2) * (Math.PI / 180)); // how tall the view is per unit of distance from the camera
export const view = {
  zoom: OPENING_ZOOM, // the camera's distance from what it looks at, scene units, kept by game-view.js each frame
  truth: true, // truth overlay: show every drone where it really is (grey if no sensor has it)
  labels: true, // name tags on every system and drone
  rings: true, // range rings on every system
  trackHi: false, // colour tracks by classification instead of drawing them faint and grey
  trails: false, // a line behind each drone of where it has flown: the real drone with the truth overlay, its track without
  baseMap: 'os', // a real world's picture: 'os', 'light', 'dark', 'satellite', 'hybrid', 'topo', 'relief' or 'live'
  mapRoads: false, // roads and names on the map: with satellite, this is the hybrid view
  mapGrid: 'national', // the grid on the map: 'national' (the OS or Estonian grid), 'mgrs', or false for none
  mapContours: false, // height lines on the map
  scenery: true, // the 3D trees and buildings on a real map. Hiding them only changes the picture, not the rules
  mapPanel: false, // the map switcher is open
  mapLoading: false, // a new map picture is on its way
  startAt: null, // a real place the start screen should open on: { e, n, note }
  planView: false, // the camera looks straight down
  me: null, // the player's own position, once asked for: { x, z, accuracy } in scene units
  replayT: null, // simulated time being reviewed while rewinding, or null when live
  people: { count: 10, protection: 'open', role: 'civilian' }, // the next group the People tool will place
  replayCasualties: null, // how many in each group were down at the moment being reviewed, or null when live
  selected: null, // the system the Unit panel is showing
  eye: null, // the system whose mast the camera is on, for the ground view, or null for the map view
  osm: false, // demo: OpenStreetMap tiles as the picture on the ground
  zone: null, // the area to defend as it is drawn: { points: [[x, z]...], closed }. game.js gives the simulation a closed one
  route: null, // a patrol route while it is being drawn, in the same shape. Once closed it goes to the simulation, which draws it from there
  spot: null, // a spot the wizard is suggesting: { x, z }
  wizard: 'closed', // 'open', 'collapsed' or 'closed'
  coverageOn: false, // the plan map shows sensor coverage
  coverageThreat: null, // for this drone type, or the first one
  threat: null, // the drone type the wizard plans against, or null for every type
};
