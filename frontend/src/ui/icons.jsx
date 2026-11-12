// Line icons for the game's buttons: one stroke path each, drawn in the button's own colour on a 24 x 24 grid.

export const ICONS = {
  me: 'M12 2v4M12 18v4M2 12h4M18 12h4M12 7a5 5 0 1 0 0 10a5 5 0 0 0 0-10z',
  site: 'M4 20V10l8-6l8 6v10M9 20v-6h6v6',
  zone: 'M5 8l7-4l7 5l-2 10l-10 1z',
  fit: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M9 12h6M12 9v6',
  patrol: 'M3 18h4l3-7l4 9l3-6h4M7 6a2 2 0 1 0 0.01 0',
  plan: 'M3 6l6-3l6 3l6-3v15l-6 3l-6-3l-6 3zM9 3v15M15 6v15',
  stats: 'M3 21h18M6 21V11M11 21V5M16 21v-7M21 21V9',
  nodes: 'M12 3a2 2 0 1 0 0.01 0M5 17a2 2 0 1 0 0.01 0M19 17a2 2 0 1 0 0.01 0M12 5v6M12 11l-6 5M12 11l6 5',
  spectrum: 'M2 12c2-7 4-7 6 0s4 7 6 0s4-7 6 0M22 12h0',
  engage: 'M12 2v5M12 17v5M2 12h5M17 12h5M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8z',
  lab: 'M9 3h6M10 3v6l-5.5 10a1.5 1.5 0 0 0 1.3 2.2h12.4a1.5 1.5 0 0 0 1.3-2.2L14 9V3M7 15h10',
  saved: 'M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7',
  max: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  legend: 'M4 6h2M4 12h2M4 18h2M9 6h11M9 12h11M9 18h11',
  pack: 'M8 6V4h8v2M5 8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v12H5zM9 13h6',
  radar: 'M12 21a9 9 0 1 1 9-9M12 17a5 5 0 1 1 5-5M12 12l7-7',
  rf: 'M12 21v-9M8.5 8.5a5 5 0 0 1 7 0M5.5 5.5a9 9 0 0 1 13 0M12 11a1 1 0 1 0 0.01 0',
  camera: 'M3 7h4l2-3h6l2 3h4v12H3zM12 10a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7z',
  acoustic: 'M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4',
  jammer: 'M13 2L4 14h7l-1 8l9-12h-7z',
  interceptor: 'M4 4l5 5M20 4l-5 5M4 20l5-5M20 20l-5-5M9 9h6v6H9z',
  missile: 'M5 19l4-4M13 5l6 6l-8 8l-6-6zM15 3h6v6',
  gun: 'M12 2v5M12 17v5M2 12h5M17 12h5M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8z',
  laser: 'M3 12h12M15 8l6 4l-6 4M5 7l2 2M5 17l2-2',
  vehicle: 'M2 16V9h11l3 3h5v4zM6 19a1.5 1.5 0 1 0 0.01 0M17 19a1.5 1.5 0 1 0 0.01 0',
  people: 'M9 8a3 3 0 1 0 0.01 0M3 20c0-4 3-6 6-6s6 2 6 6M16.5 10a2.5 2.5 0 1 0 0.01 0M17 14c2.5 0 4 2 4 5',
  conditions: 'M8 2v2M2.5 8h2M3.8 3.8l1.4 1.4M12.2 3.8l-1.4 1.4M11 8.5A3.5 3.5 0 1 0 5.5 11M9 21h9a4 4 0 0 0 0-8a5.5 5.5 0 0 0-10.4 2A3 3 0 0 0 9 21z',
  attack: 'M4 4l5 5M20 4l-5 5M4 20l5-5M20 20l-5-5M9 9h6v6H9z',
  sandbox: 'M3 8l9-5l9 5v8l-9 5l-9-5zM3 8l9 5l9-5M12 13v8',
  reset: 'M3 4v6h6M3.5 15a9 9 0 1 0 2.1-9.4L3 10',
  clear: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
};

export const Icon = ({ path, size = 22 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="icon"><path d={path} /></svg>
);
