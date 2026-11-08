// What a click on the map does next (the tool), and which list is open beside the toolbar. View state, not commands, so none of
// it is logged or can change a run. `changed` redraws the placement preview and the panels.

import { STRUCTURES, firstClass } from './sim/config/index.js';

export function createTools(changed) {
  let tool = null; // structure id | 'sell' | 'zone' | 'people' | 'patrol' | null
  let vehicle = null; // the vehicle the picked system is parked on, from the pack tray; any other pick clears it
  let catalogue = null; // the open list: a kind of system, 'unit' for the deployment pack tray, or null
  let beforeDrag; // the tool in use when a drag began, put back when it ends
  const last = {}; // kind -> the system last picked, which a hotkey offers next

  function use(t, v = null) {
    tool = t;
    vehicle = v;
    if (STRUCTURES[tool]) last[STRUCTURES[tool].kind] = tool;
    changed();
  }
  // Picking a system opens its kind's list, and switching it off closes the list.
  function set(t) {
    const next = tool === t ? null : t;
    if (next !== null) catalogue = STRUCTURES[next]?.kind ?? null; // putting a system down leaves its list, or the pack's tray, open
    use(next);
  }
  const choice = (group) => last[group.kind] || firstClass(group);

  return {
    get: () => tool,
    vehicle: () => vehicle,
    use,
    set,
    choice,
    catalogue: () => catalogue,
    // A toolbar row opens its list with nothing picked: a system is then dragged, or clicked and placed by clicking the map.
    openCatalogue(kind, open = catalogue !== kind) {
      catalogue = open ? kind : null;
      use(null);
    },
    // The pack tray stays open while one of its systems is picked, unlike the toolbar's lists.
    pickFromTray: (id, v = null) => (tool === id && vehicle === v ? use(null) : use(id, v)),
    // A hotkey: the first press picks the kind, and pressing it again moves to the next system. With only one, it switches off.
    cycle(group) {
      const at = group.classes.indexOf(tool);
      if (at < 0) set(choice(group));
      else set(group.classes.length > 1 ? group.classes[(at + 1) % group.classes.length] : tool);
    },
    // While a card is dragged, its system's preview follows the cursor over the map.
    dragging: () => beforeDrag !== undefined,
    startDrag(item) {
      beforeDrag = [tool, vehicle];
      if (item.system && (tool !== item.system || vehicle !== (item.vehicle ?? null))) use(item.system, item.vehicle);
    },
    endDrag() {
      if (beforeDrag === undefined) return;
      const [back, onVehicle] = beforeDrag;
      beforeDrag = undefined;
      if (tool !== back || vehicle !== onVehicle) use(back, onVehicle);
    },
  };
}
