import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BoardStore } from './lib/store.mjs';
import { BoardError, describeBoard, locate } from './lib/board.mjs';
import { exportSvg, exportBrief } from './lib/export.mjs';
import { exportBundle } from './lib/bundle.mjs';
import { agentTutorial } from './lib/tutorial.mjs';
import { legacyBehaviorNotes } from './public/regions.js';
import { checkDesign } from './public/design-checks.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const staticFiles = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']], ['/board-rules.js', ['board-rules.js', 'text/javascript; charset=utf-8']], ['/connections.js', ['connections.js', 'text/javascript; charset=utf-8']], ['/regions.js', ['regions.js', 'text/javascript; charset=utf-8']], ['/design-checks.js', ['design-checks.js', 'text/javascript; charset=utf-8']], ['/editor-tools.js', ['editor-tools.js', 'text/javascript; charset=utf-8']], ['/styles.css', ['styles.css', 'text/css; charset=utf-8']]]);
function itemContext(found) {
  const { id, name, width, height, note, status } = found.screen;
  return { kind: found.kind, screen: { id, name, width, height, note, status, legacyBehaviorNote: legacyBehaviorNotes(found.screen) }, item: found.item, legacyBehaviorNote: legacyBehaviorNotes(found.item) };
}
function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
async function readJson(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw new BoardError('Use Content-Type: application/json', 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length; if (size > 2 * 1024 * 1024) throw new BoardError('Request body is too large', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new BoardError('Invalid JSON'); }
}
export async function startServer({ port = 4317, data = path.join(root, 'data', 'board.json'), initialBoard } = {}) {
  const store = await new BoardStore(data).open(initialBoard);
  const clients = new Set();
  const broadcast = (name, value) => { const message = `event: ${name}\ndata: ${JSON.stringify(value)}\n\n`; for (const res of clients) res.write(message); };
  store.on('board', value => broadcast('board', value)); store.on('presence', value => broadcast('presence', value));
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const localPort = server.address()?.port;
      const hosts = [`127.0.0.1:${localPort}`, `localhost:${localPort}`];
      if (!hosts.includes(req.headers.host)) throw new BoardError('Invalid host', 403);
      if (req.headers.origin && !hosts.map(host => `http://${host}`).includes(req.headers.origin)) throw new BoardError('Invalid origin', 403);
      const url = new URL(req.url, `http://127.0.0.1:${localPort}`);
      if (url.pathname.startsWith('/api/') && url.searchParams.has('documentId')) store.checkDocument(url.searchParams.get('documentId'), true);
      if (req.method === 'GET' && staticFiles.has(url.pathname)) {
        const [file, type] = staticFiles.get(url.pathname);
        const content = await fs.readFile(path.join(root, 'public', file));
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(content); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, version: '0.1.0', revision: store.state.board.revision });
      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, store.snapshot());
      if (req.method === 'GET' && url.pathname === '/api/board') return json(res, 200, store.state.board);
      if (req.method === 'GET' && url.pathname === '/api/boards') return json(res, 200, store.listDocuments({ archived: url.searchParams.get('archived') === 'true' }));
      if (req.method === 'GET' && url.pathname === '/api/check') return json(res, 200, { documentId: store.state.documentId, ...checkDesign(store.state.board) });
      if (req.method === 'GET' && url.pathname === '/api/tutorial') return json(res, 200, agentTutorial({ cliPath: path.join(root, 'cli.mjs'), url: `http://127.0.0.1:${localPort}`, documentId: store.state.documentId, revision: store.state.board.revision }));
      if (req.method === 'POST' && url.pathname === '/api/boards') return json(res, 200, await store.manageDocuments(await readJson(req)));
      if (req.method === 'GET' && url.pathname === '/api/context') {
        const snapshot = store.snapshot();
        const selection = snapshot.presence.human?.selection;
        const selected = selection ? itemContext(locate(snapshot.board, selection.nodeId ?? selection.screenId)) : null;
        return json(res, 200, { documentId: snapshot.documentId, archived: snapshot.archived, board: describeBoard(snapshot.board), checks: checkDesign(snapshot.board), appearance: 'Board colors and square corners identify component types. Desired implementation appearance and behavior are described in note (備考). Preview only follows screen links; legacyBehaviorNote describes retained older settings without simulating them.', presence: snapshot.presence, selected, canUndo: snapshot.canUndo, canRedo: snapshot.canRedo });
      }
      if (req.method === 'GET' && url.pathname === '/api/history') {
        const since = Number(url.searchParams.get('since') ?? 0);
        if (!Number.isSafeInteger(since) || since < 0) throw new BoardError('since must be a nonnegative integer');
        return json(res, 200, { revision: store.state.board.revision, history: store.state.history.filter(event => event.revision > since) });
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/items/')) {
        const found = locate(store.state.board, decodeURIComponent(url.pathname.slice('/api/items/'.length)));
        return json(res, 200, { documentId: store.state.documentId, revision: store.state.board.revision, ...itemContext(found) });
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
        res.write(`event: sync\ndata: ${JSON.stringify(store.snapshot())}\n\n`); clients.add(res);
        const timer = setInterval(() => res.write(': keepalive\n\n'), 20000); timer.unref();
        res.on('close', () => { clients.delete(res); clearInterval(timer); }); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/export') {
        const format = url.searchParams.get('format') ?? 'json';
        if (format === 'bundle') {
          const content = exportBundle(store.state.board, store.state.documentId);
          res.writeHead(200, { 'Content-Type': 'application/zip', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="uiboard-r${store.state.board.revision}.zip"` }); res.end(content); return;
        }
        const formats = { json: ['application/json; charset=utf-8', 'json', () => JSON.stringify(store.state.board, null, 2)], svg: ['image/svg+xml; charset=utf-8', 'svg', () => exportSvg(store.state.board)], brief: ['text/markdown; charset=utf-8', 'md', () => exportBrief(store.state.board)] };
        if (!Object.hasOwn(formats, format)) throw new BoardError('format must be json, svg, or brief');
        const [type, extension, render] = formats[format];
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="uiboard-r${store.state.board.revision}.${extension}"` }); res.end(render()); return;
      }
      if (req.method === 'POST' && ['/api/mutate', '/api/presence'].includes(url.pathname)) {
        const body = await readJson(req); store.checkDocument(body.documentId, true);
        return json(res, 200, url.pathname === '/api/mutate' ? await store.mutate(body) : store.setPresence(body));
      }
      if (req.method === 'GET' && url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      throw new BoardError('Not found', 404);
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      json(res, error.status ?? 500, { error: error.status ? error.message : 'The server could not complete the request.', ...error.details });
      if (!error.status) console.error('Server error:', error.message);
    }
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  } catch (error) { await store.close(); throw error; }
  const close = async () => {
    for (const res of clients) res.end(); clients.clear();
    await new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
    await store.close();
  };
  return { server, store, url: `http://127.0.0.1:${server.address().port}`, close };
}
