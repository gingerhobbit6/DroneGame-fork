// Shares the lab's report and saved laydowns, read-only, with other devices on your Tailscale network.
//
//   node tools/lab/share.mjs [--host 100.x.y.z] [--port 8300]
//
// It listens on the Tailscale address only (found with `tailscale ip -4`, or give --host), so it is not reachable from the ordinary
// network, and it serves nothing but the report page and the laydown files in lab-results/. It changes no Tailscale or Windows setting.
// Open http://<that address>:8300/ on another device; the laydown links download files to open with "Open a laydown file" in the Saved tab.

import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { OUT_DIR, parseArgs } from './lab.mjs';

const args = parseArgs(['share', ...process.argv.slice(2)]);
const port = Number(args.port || 8300);
function tailscaleAddress() {
  for (const exe of ['tailscale', 'C:\\Program Files\\Tailscale\\tailscale.exe']) {
    try { const ip = execFileSync(exe, ['ip', '-4'], { encoding: 'utf8' }).trim().split(/\s+/)[0]; if (ip) return ip; } catch { /* try the next */ }
  }
  return null;
}
const host = args.host || tailscaleAddress();
if (!host) { console.error('Could not find a Tailscale address. Is Tailscale running? Or pass --host <address>.'); process.exit(1); }

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const LAYDOWN = /^[\w.-]+\.json$/;

function laydowns() {
  const dir = resolve(OUT_DIR, 'laydowns');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => LAYDOWN.test(f)).sort().map((file) => {
    let n = 0, name = file;
    try { const j = JSON.parse(readFileSync(resolve(dir, file), 'utf8')); n = j.spec?.structures?.length ?? 0; name = j.name || file; } catch { /* leave as is */ }
    return { file, name, n };
  });
}

function index() {
  const rows = laydowns().map((l) => `<tr><td><a href="/laydowns/${encodeURIComponent(l.file)}" download>${esc(l.name)}</a></td><td>${l.n} systems</td></tr>`).join('');
  const report = existsSync(resolve(OUT_DIR, 'report.html')) ? '<p><a href="/report.html">Open the convergence report</a></p>' : '<p>No report has been built yet.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Site Guard lab</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:720px;margin:0 auto;padding:16px;background:#0e1420;color:#e4eaf2}a{color:#6a9bff}table{border-collapse:collapse;width:100%}td{padding:8px 4px;border-bottom:1px solid #2a3445}td+td{color:#97a3b4;text-align:right}h1{font-size:22px}p.note{color:#97a3b4;font-size:14px}</style></head><body>
<h1>Site Guard lab</h1>${report}<h2>Laydowns</h2>
<p class="note">Download one, then in the game open the Saved tab and use &ldquo;Open a laydown file&rdquo;. It loads the layout without saving it to your account.</p>
<table>${rows || '<tr><td>No laydowns exported yet.</td></tr>'}</table></body></html>`;
}

const send = (res, code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(body); };

createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'text/plain', 'read-only');
  const path = decodeURIComponent((req.url || '/').split('?')[0]);
  if (path === '/' || path === '/index.html') return send(res, 200, 'text/html; charset=utf-8', index());
  if (path === '/report.html') { const f = resolve(OUT_DIR, 'report.html'); return existsSync(f) ? send(res, 200, 'text/html; charset=utf-8', readFileSync(f)) : send(res, 404, 'text/plain', 'no report yet'); }
  const m = /^\/laydowns\/([\w.-]+\.json)$/.exec(path);
  if (m) { const f = resolve(OUT_DIR, 'laydowns', m[1]); if (existsSync(f) && statSync(f).isFile()) return send(res, 200, 'application/json', readFileSync(f)); }
  send(res, 404, 'text/plain', 'not found');
}).listen(port, host, () => console.log(`sharing lab-results on http://${host}:${port}/ (Tailscale only, read-only)`));
