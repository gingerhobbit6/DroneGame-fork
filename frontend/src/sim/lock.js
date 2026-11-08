// Once the first wave starts the design is locked: systems, people, the patrol, the area and the network stay as they were.
// A leaf module, so people.js can use it without importing laydown.js, which imports people.js.

import { BUILD } from './config/index.js';

export const LAYDOWN_LOCKED = 'The laydown is locked once the first wave starts';
export const designLocked = (w) => BUILD.lockAfterStart && w.state.wave > 0;
