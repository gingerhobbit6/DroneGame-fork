// @vitest-environment jsdom
// The camera's keys and the compass: held keys reach the camera, and N, H, F and the compass ask it to move.

import { cleanup, fireEvent, render } from '@testing-library/react';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { view } from '../src/render/view.js';
import { Compass } from '../src/ui/Compass.jsx';
import { GameContext } from '../src/ui/hooks.js';
import { useHotkeys } from '../src/ui/useHotkeys.js';

let game, camera;
beforeEach(() => {
  camera = { keys: { press: vi.fn(), release: vi.fn() }, northUp: vi.fn(), fitLaydown: vi.fn(), centreOn: vi.fn() };
  game = { getView: () => camera, getReplay: () => null, sim: { state: { terrainSeed: '1' } } };
});
afterEach(() => { cleanup(); view.selected = null; view.drone = null; });

const Keys = () => { useHotkeys(); return null; };
const show = (ui) => render(<GameContext.Provider value={game}>{ui}</GameContext.Provider>);

describe('the camera keys', () => {
  it('pass a held key to the camera by its position, and its release, even from a text box', () => {
    show(<Keys />);
    fireEvent.keyDown(window, { key: 'z', code: 'KeyW' }); // W's place on a French keyboard
    expect(camera.keys.press).toHaveBeenLastCalledWith('KeyW', true);
    const box = document.body.appendChild(document.createElement('input'));
    fireEvent.keyDown(box, { key: 'd', code: 'KeyD' });
    expect(camera.keys.press).not.toHaveBeenCalledWith('KeyD', true); // typing never moves the camera
    fireEvent.keyUp(box, { key: 'z', code: 'KeyW' });
    expect(camera.keys.press).toHaveBeenLastCalledWith('KeyW', false); // but letting go always stops it
    box.remove();
  });

  it('stop the camera when the window loses focus, or the keys are taken away', () => {
    const { unmount } = show(<Keys />);
    fireEvent.blur(window);
    expect(camera.keys.release).toHaveBeenCalledTimes(1);
    unmount();
    expect(camera.keys.release).toHaveBeenCalledTimes(2);
  });

  it('leave Ctrl and Cmd shortcuts to the browser', () => {
    show(<Keys />);
    fireEvent.keyDown(window, { key: '-', code: 'Minus', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'w', code: 'KeyW', metaKey: true });
    expect(camera.keys.press).not.toHaveBeenCalled();
  });

  it('N turns north up, H frames the laydown, and F goes to the selected system', () => {
    show(<Keys />);
    fireEvent.keyDown(window, { key: 'n', code: 'KeyN' });
    expect(camera.northUp).toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'H', code: 'KeyH' });
    expect(camera.fitLaydown).toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'f', code: 'KeyF' });
    expect(camera.centreOn).not.toHaveBeenCalled(); // nothing selected
    view.selected = { pos: { x: 12, z: -8 } };
    fireEvent.keyDown(window, { key: 'f', code: 'KeyF' });
    expect(camera.centreOn).toHaveBeenCalledWith(12, -8, 25);
    view.drone = { pos: { x: 40, z: 5 }, dead: false }; // a drone's panel open beside it
    fireEvent.keyDown(window, { key: 'f', code: 'KeyF' });
    expect(camera.centreOn).toHaveBeenLastCalledWith(40, 5, 25);
    view.drone.dead = true; // shot down: back to the system
    fireEvent.keyDown(window, { key: 'f', code: 'KeyF' });
    expect(camera.centreOn).toHaveBeenLastCalledWith(12, -8, 25);
  });
});

describe('the compass', () => {
  it('turns its needle against the way the view faces, and turns north up when pressed', () => {
    const cam = new THREE.PerspectiveCamera(50, 1);
    cam.position.set(-100, 100, 0); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); // looking east
    camera.camera = cam;
    game.onFrame = (fn) => { fn(0.016); return () => {}; };
    show(<Compass />);
    expect(document.querySelector('#map-compass g').getAttribute('transform')).toBe('rotate(-90 12 12)'); // north is to the left
    fireEvent.click(document.querySelector('#map-compass'));
    expect(camera.northUp).toHaveBeenCalled();
  });

  it('draws without a camera, as on the start screen', () => {
    show(<Compass />);
    expect(document.querySelector('#map-compass')).not.toBeNull();
  });
});
