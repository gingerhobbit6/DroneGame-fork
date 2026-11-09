// @vitest-environment jsdom
// The Leaflet map on the start screen: where a click lands, and what is remembered.
import L from 'leaflet';
import { describe, expect, it, vi } from 'vitest';
import { createSiteMap } from '../src/ui/site-map.js';
import { createFakeStorage } from './support/fake-api.js';

const box = () => document.body.appendChild(document.createElement('div'));
const shapes = (map) => { const found = []; map.eachLayer((layer) => { if (layer instanceof L.Polygon) found.push(layer); }); return found; };
const dots = (map) => { let count = 0; map.eachLayer((layer) => { if (layer instanceof L.CircleMarker) count++; }); return count; };

describe('the start map', () => {
  it('turns a click into a national grid position', () => {
    const onPick = vi.fn();
    const { map, remove } = createSiteMap(box(), { onPick, storage: createFakeStorage() });
    map.fire('click', { latlng: L.latLng(51.4, -1.7) });
    const point = onPick.mock.calls[0][0];
    expect(Math.abs(point.e - 420900)).toBeLessThan(500);
    expect(Math.abs(point.n - 166800)).toBeLessThan(500);
    remove();
  });
  it('reads a click anywhere in the world, even on a copy of the world along the way', () => {
    const onPick = vi.fn();
    const { map, remove } = createSiteMap(box(), { onPick, storage: createFakeStorage() });
    map.fire('click', { latlng: L.latLng(35.7, 139.7 + 360) });
    expect(onPick.mock.calls[0][0].lon).toBeCloseTo(139.7);
    expect(onPick.mock.calls[0][0].e).toBeGreaterThan(700000);
    remove();
  });
  it('highlights what is on this computer, with lidar shown apart and names kept as text', () => {
    const container = box();
    const made = createSiteMap(container, { onPick: vi.fn(), storage: createFakeStorage() });
    const pack = (lidarHalf) => ({ pack: { header: { east: 422000, north: 166000, half: 15000, lidarHalf, name: '<img src=x>' } }, pictures: [] });
    const lidar = pack(7000);
    made.addPack(lidar);
    made.addPack(lidar);
    expect(shapes(made.map)).toHaveLength(2); // the pack and its lidar, once
    made.addPack(pack(0));
    expect(shapes(made.map)).toHaveLength(3); // no lidar, so only the pack
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(container.querySelector('.map-tag').textContent).toBe('<img src=x>');
    made.showDownloads({ squares: ['SU', 'TQ', 'not a square'] });
    expect(shapes(made.map)).toHaveLength(5);
    made.showDownloads({ squares: ['SU'] });
    expect(shapes(made.map)).toHaveLength(4);
    made.showDownloads({ squares: [], estonia: { heights: true } }); // the national files cover the whole country
    expect(shapes(made.map)).toHaveLength(4);
    made.showDownloads(null);
    expect(shapes(made.map)).toHaveLength(3);
    made.remove();
  });
  it('draws lightweight pack summaries once when the listing refreshes', () => {
    const made = createSiteMap(box(), { onPick: vi.fn(), storage: createFakeStorage() });
    const summary = { hash: 'a'.repeat(32), east: 422000, north: 166000, half: 15000, lidarHalf: 0, name: 'Savernake' };
    made.addPack(summary);
    made.addPack({ ...summary });
    expect(shapes(made.map)).toHaveLength(1);
    expect(dots(made.map)).toBe(1);
    const fit = vi.spyOn(made.map, 'fitBounds');
    made.showLoaded();
    expect(fit).toHaveBeenCalled();
    made.remove();
  });
  it('ignores malformed pack summaries before drawing or zooming to them', () => {
    const made = createSiteMap(box(), { onPick: vi.fn(), storage: createFakeStorage() });
    const fit = vi.spyOn(made.map, 'fitBounds');
    made.addPack({ hash: 'bad', east: 1e30, north: 166000, half: 15000, name: 'Bad' });
    made.addPack({ hash: 'too-wide', east: 422000, north: 166000, half: 1e9, name: 'Bad' });
    made.showLoaded();
    expect(shapes(made.map)).toHaveLength(0);
    expect(dots(made.map)).toBe(0);
    expect(fit).not.toHaveBeenCalled();
    made.remove();
  });
  it('marks a start point, the map a build would make, and a spot off the grid', () => {
    const made = createSiteMap(box(), { onPick: vi.fn(), storage: createFakeStorage() });
    made.show({ e: 422000, n: 166000 });
    expect([shapes(made.map).length, dots(made.map)]).toEqual([1, 1]);
    made.show({ e: 422000, n: 166000 }, { planned: true });
    expect([shapes(made.map).length, dots(made.map)]).toEqual([2, 1]);
    made.markElsewhere({ lat: 35.7, lon: 139.7 }); // the start point stays
    expect([shapes(made.map).length, dots(made.map)]).toEqual([2, 2]);
    made.markElsewhere({ lat: 40, lon: -100 });
    expect(dots(made.map)).toBe(2);
    made.markElsewhere(null);
    expect(dots(made.map)).toBe(1);
    made.show(null);
    expect([shapes(made.map).length, dots(made.map)]).toEqual([0, 0]);
    made.remove();
  });
  it('reads a click in Estonia on the Estonian grid, and draws an Estonian pack where it is', () => {
    const onPick = vi.fn();
    const made = createSiteMap(box(), { onPick, storage: createFakeStorage() });
    made.map.fire('click', { latlng: L.latLng(59.2606, 25.9587) });
    expect(Math.abs(onPick.mock.calls[0][0].e - 611708)).toBeLessThan(1);
    expect(Math.abs(onPick.mock.calls[0][0].n - 6570776)).toBeLessThan(1);
    made.addPack({ pack: { header: { east: 611000, north: 6570000, half: 15000, lidarHalf: 15000, name: 'Tapa' } }, pictures: [] });
    const bounds = shapes(made.map)[0].getBounds();
    expect(bounds.contains(L.latLng(59.2606, 25.9587))).toBe(true);
    expect(bounds.contains(L.latLng(59.37, 28.19))).toBe(false); // Narva is well outside it
    made.remove();
  });
  it('stays put for a choice the player did not make', () => {
    const made = createSiteMap(box(), { onPick: vi.fn(), storage: createFakeStorage() });
    const before = made.map.getZoom();
    const fit = vi.spyOn(made.map, 'fitBounds');
    made.show({ e: 422000, n: 166000 }, { move: false });
    expect(fit).not.toHaveBeenCalled();
    expect(made.map.getZoom()).toBe(before);
    made.show({ e: 422000, n: 166000 });
    expect(fit).toHaveBeenCalled();
    made.remove();
  });
  it('offers satellite and hybrid from EOX, with its credit, only once chosen', () => {
    const storage = createFakeStorage();
    const liveUrls = (map) => { const urls = []; map.eachLayer((layer) => { if (layer instanceof L.TileLayer) urls.push(layer._url); }); return urls; };
    const street = createSiteMap(box(), { onPick: vi.fn(), storage });
    expect(liveUrls(street.map).some((url) => url.includes('eox.at'))).toBe(false);
    street.remove();
    storage.setItem('site-guard-start-map', 'Hybrid');
    const hybrid = createSiteMap(box(), { onPick: vi.fn(), storage });
    const urls = liveUrls(hybrid.map);
    expect(urls).toHaveLength(2);
    expect(urls.every((url) => url.startsWith('https://tiles.maps.eox.at/'))).toBe(true);
    expect(hybrid.map.attributionControl.getContainer().textContent).toContain('EOxCloudless');
    hybrid.remove();
  });
  it('remembers the choice of no live map, and then asks OpenStreetMap for nothing', () => {
    const storage = createFakeStorage();
    const first = createSiteMap(box(), { onPick: vi.fn(), storage });
    first.setStyle('No live map');
    first.remove();
    const second = createSiteMap(box(), { onPick: vi.fn(), storage });
    const live = [];
    second.map.eachLayer((layer) => { if (layer instanceof L.TileLayer) live.push(layer); });
    expect(live).toHaveLength(0);
    expect(second.state().layers.osmap).toBe(true); // the packs' own pictures stand in
    second.remove();
  });
  it('opens on the world, and switches style and layers when asked, saying so each time', () => {
    const onChange = vi.fn(), storage = createFakeStorage();
    const made = createSiteMap(box(), { onPick: vi.fn(), onChange, storage });
    expect(made.map.getZoom()).toBe(2);
    expect(made.state()).toEqual({ style: 'Street', layers: { packs: true, lidar: true, downloads: true, osmap: false, satellite: false } });
    made.setStyle('Satellite');
    expect(onChange.mock.lastCall[0].style).toBe('Satellite');
    expect(storage.getItem('site-guard-start-map')).toBe('Satellite');
    made.setStyle('Not a style');
    expect(made.state().style).toBe('Satellite');
    made.setLayer('lidar', false);
    expect(onChange.mock.lastCall[0].layers.lidar).toBe(false);
    made.setLayer('satellite', true);
    expect(made.state().layers.satellite).toBe(true);
    made.remove();
  });
  it('falls back to the packs when live tiles fail, and says so', () => {
    const onChange = vi.fn();
    const made = createSiteMap(box(), { onPick: vi.fn(), onChange, storage: createFakeStorage() });
    made.map.eachLayer((layer) => { if (layer instanceof L.TileLayer) layer.fire('tileerror'); });
    expect(onChange.mock.lastCall[0].layers.osmap).toBe(true);
    made.remove();
  });
  it('marks a pack with a dot that goes there, and zooms between the world and the packs', () => {
    const onPick = vi.fn();
    const made = createSiteMap(box(), { onPick, storage: createFakeStorage() });
    const fit = vi.spyOn(made.map, 'fitBounds');
    made.showLoaded();
    expect(fit).not.toHaveBeenCalled(); // nothing to zoom to yet
    made.addPack({ pack: { header: { east: 422000, north: 166000, half: 15000, lidarHalf: 7000, name: 'Savernake' } }, pictures: [] });
    const dots = [];
    made.map.eachLayer((layer) => { if (layer instanceof L.CircleMarker) dots.push(layer); });
    expect(dots).toHaveLength(1);
    expect(dots[0].getTooltip().getContent().textContent).toBe('Savernake');
    dots[0].fire('click');
    expect(onPick).toHaveBeenCalledWith({ e: 422000, n: 166000 });
    made.showLoaded();
    expect(fit).toHaveBeenCalled();
    made.map.setZoom(9, { animate: false });
    made.showWorld();
    expect(made.map.getZoom()).toBe(2);
    made.remove();
  });
});
