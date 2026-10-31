import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BoardStore } from '../lib/store.mjs';
import { applyOperations, seedBoard, validateBoard, emptyBoard } from '../lib/board.mjs';
import { exportBrief, exportSvg } from '../lib/export.mjs';
import { startServer } from '../server.mjs';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
async function fixture(t) {
  const testRoot = fileURLToPath(new URL('../.test-output/', import.meta.url));
  await fs.mkdir(testRoot, { recursive: true });
  const directory = await fs.mkdtemp(path.join(testRoot, 'run-'));
  t.after(async () => { await fs.rm(directory, { recursive: true, force: true }); });
  return path.join(directory, 'board.json');
}
test('sample has valid unique IDs and resolvable screen transitions', () => {
  const board = validateBoard(seedBoard());
  assert.equal(board.screens.length, 3);
  assert.equal(board.screens[0].nodes.find(node => node.id === 'home_details').targetScreenId, 'screen_detail');
});
test('batch can create a screen and linked nodes with explicit IDs', () => {
  const result = applyOperations(emptyBoard(), [
    { type: 'screen.add', screen: { id: 'first', name: 'First' } },
    { type: 'screen.add', screen: { id: 'second', name: 'Second' } },
    { type: 'node.add', screenId: 'first', node: { id: 'go', type: 'button', targetScreenId: 'second' } },
  ]);
  assert.deepEqual(result.created, ['first', 'second', 'go']);
  assert.equal(result.board.screens[0].nodes[0].targetScreenId, 'second');
});
test('invalid batch cannot modify original; malformed fields and dangling links are rejected', () => {
  const board = seedBoard(); const original = JSON.stringify(board);
  assert.throws(() => applyOperations(board, [
    { type: 'node.update', id: 'home_details', changes: { label: 'changed' } },
    { type: 'node.update', id: 'home_details', changes: { targetScreenId: 'missing' } },
  ]), /Target screen not found/);
  assert.equal(JSON.stringify(board), original);
  for (const changes of [{ fill: 'url(https://bad)' }, { x: Infinity }, { typo: 123 }, { width: -1 }]) {
    assert.throws(() => applyOperations(board, [{ type: 'node.update', id: 'home_details', changes }]));
  }
  assert.throws(() => applyOperations(board, [{ type: 'screen.add', screen: { id: 'home_details' } }]), /duplicate/);
});
test('deleting a screen clears every incoming transition', () => {
  const { board } = applyOperations(seedBoard(), [{ type: 'item.remove', id: 'screen_detail' }]);
  assert.equal(board.screens[0].nodes.find(node => node.id === 'home_details').targetScreenId, null);
  assert.equal(board.screens.length, 2);
});
test('revision conflict stops concurrent writes; persistence and history remain consistent', async t => {
  const file = await fixture(t); const store = await new BoardStore(file).open();
  t.after(() => store.close());
  const results = await Promise.allSettled([
    store.mutate({ baseRevision: 0, actor: '人間', source: 'ui', operations: [{ type: 'board.update', changes: { title: 'human' } }] }),
    store.mutate({ baseRevision: 0, actor: 'Codex', source: 'cli', operations: [{ type: 'board.update', changes: { title: 'agent' } }] }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results[0].status, 'fulfilled', results[0].reason?.stack);
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.status, 409);
  assert.equal(store.state.board.title, 'human');
  await store.close();
  const restored = await new BoardStore(file).open();
  assert.equal(restored.state.board.title, 'human'); assert.equal(restored.state.board.revision, 1);
  assert.equal(restored.state.history[0].actor, '人間'); await restored.close();
});
test('dry-run validates without changing disk or history, failed batches are atomic', async t => {
  const file = await fixture(t); const store = await new BoardStore(file).open();
  const before = await fs.readFile(file, 'utf8');
  const result = await store.mutate({ baseRevision: 0, dryRun: true, operations: [{ type: 'board.update', changes: { title: 'candidate' } }] });
  assert.equal(result.board.title, 'candidate'); assert.equal(store.state.board.revision, 0);
  assert.equal(await fs.readFile(file, 'utf8'), before);
  await assert.rejects(store.mutate({ baseRevision: 0, operations: [{ type: 'board.update', changes: { title: 'bad batch' } }, { type: 'node.update', id: 'missing', changes: { x: 4 } }] }));
  assert.equal(await fs.readFile(file, 'utf8'), before); await store.close();
});
test('undo and redo traverse edits with monotonic revisions; new edits clear redo', async t => {
  const store = await new BoardStore(await fixture(t)).open();
  for (const title of ['A', 'B']) await store.mutate({ baseRevision: store.state.board.revision, operations: [{ type: 'board.update', changes: { title } }] });
  await store.mutate({ baseRevision: 2, action: 'undo' }); assert.equal(store.state.board.title, 'A');
  await store.mutate({ baseRevision: 3, action: 'undo' }); assert.equal(store.state.board.title, seedBoard().title);
  await store.mutate({ baseRevision: 4, action: 'redo' }); assert.equal(store.state.board.title, 'A');
  await store.mutate({ baseRevision: 5, operations: [{ type: 'board.update', changes: { title: 'C' } }] });
  await assert.rejects(store.mutate({ baseRevision: 6, action: 'redo' }), /Nothing to redo/);
  assert.equal(store.state.board.revision, 6); await store.close();
});
test('two servers cannot acquire the same data file', async t => {
  const file = await fixture(t); const first = await new BoardStore(file).open();
  await assert.rejects(new BoardStore(file).open(), /Another server/);
  assert.equal(first.state.board.revision, 0); await first.close();
});
test('context shares human selection and agent focus; deletion clears obsolete selection', async t => {
  const app = await startServer({ port: 0, data: await fixture(t) }); t.after(() => app.close());
  const post = (route, body) => fetch(app.url + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId: app.store.state.documentId, ...body }) });
  await post('/api/presence', { source: 'ui', actor: '人間', id: 'home_details' });
  const context = await (await fetch(app.url + '/api/context')).json();
  assert.equal(context.selected.item.id, 'home_details');
  await post('/api/presence', { source: 'cli', actor: 'Claude', id: 'detail_book' });
  assert.equal(app.store.presence.ai.selection.nodeId, 'detail_book');
  await post('/api/mutate', { baseRevision: 0, operations: [{ type: 'item.remove', id: 'home_details' }] });
  assert.equal(app.store.presence.human.selection, null);
});
test('CLI edits broadcast through SSE, stale CLI edits fail, external cwd works', async t => {
  const app = await startServer({ port: 0, data: await fixture(t) }); t.after(() => app.close());
  const controller = new AbortController();
  const stream = await fetch(app.url + '/api/events', { signal: controller.signal });
  const reader = stream.body.getReader(); const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /event: sync/);
  const { stdout } = await exec(process.execPath, [cli, 'set', 'home_details', '--label', 'CLIから変更', '--actor', 'Codex', '--url', app.url, '--revision', '0'], { cwd: os.tmpdir(), encoding: 'utf8' });
  const output = JSON.parse(stdout); assert.equal(output.revision, 1); assert.equal(output.event.actor, 'Codex');
  const event = new TextDecoder().decode((await reader.read()).value);
  assert.match(event, /event: board/); assert.match(event, /CLIから変更/);
  await assert.rejects(exec(process.execPath, [cli, 'set', 'home_details', '--label', 'stale', '--url', app.url, '--revision', '0']), error => JSON.parse(error.stderr).status === 409);
  assert.equal(app.store.state.board.screens[0].nodes.find(node => node.id === 'home_details').label, 'CLIから変更');
  controller.abort(); await reader.cancel().catch(() => {});
});
test('API rejects cross-origin writes, non-JSON bodies, invalid exports; static UI serves', async t => {
  const app = await startServer({ port: 0, data: await fixture(t) }); t.after(() => app.close());
  const blocked = await fetch(app.url + '/api/mutate', { method: 'POST', headers: { Origin: 'https://external.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(blocked.status, 403);
  assert.equal((await fetch(app.url + '/api/mutate', { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await fetch(app.url + '/api/export?format=__proto__')).status, 400);
  assert.equal((await fetch(app.url + '/api/mutate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  const page = await fetch(app.url); assert.equal(page.status, 200); assert.match(await page.text(), /作戦ボード/);
});
test('CLI dry-run returns the full candidate without saving, and JSON export round-trips', async t => {
  const file = await fixture(t); const app = await startServer({ port: 0, data: file }); t.after(() => app.close());
  const patch = path.join(path.dirname(file), 'patch.json');
  await fs.writeFile(patch, JSON.stringify({ baseRevision: 0, operations: [{ type: 'node.update', id: 'home_details', changes: { label: 'candidate' } }] }));
  const { stdout } = await exec(process.execPath, [cli, 'apply', '--file', patch, '--dry-run', '--url', app.url]);
  const candidate = JSON.parse(stdout);
  assert.equal(candidate.dryRun, true); assert.equal(candidate.board.screens[0].nodes.at(-1).label, 'candidate');
  assert.equal(app.store.state.board.revision, 0);
  const exported = path.join(path.dirname(file), 'export.json');
  await exec(process.execPath, [cli, 'export', '--format', 'json', '--out', exported, '--url', app.url]);
  const original = JSON.parse(await fs.readFile(exported, 'utf8'));
  await exec(process.execPath, [cli, 'set', 'home_details', '--label', 'changed', '--url', app.url]);
  await exec(process.execPath, [cli, 'import', '--file', exported, '--url', app.url]);
  assert.deepEqual(app.store.state.board.screens, original.screens);
});
test('export/import preserves design, SVG escapes labels, brief includes IDs and notes', () => {
  const board = seedBoard(); board.screens[0].nodes[0].label = '<script>&"';
  const svg = exportSvg(board); assert.match(svg, /&lt;script&gt;&amp;&quot;/); assert.doesNotMatch(svg, /<script>/);
  assert.match(exportBrief(board), /home_details/); assert.match(exportBrief(board), /このボタンから詳細画面へ/);
  const imported = applyOperations(emptyBoard(), [{ type: 'board.import', board: JSON.parse(JSON.stringify(board)) }]).board;
  assert.deepEqual(imported.screens, board.screens);
});

test('legacy colors and corners normalize on open and undo without losing dimensions, coordinates or remarks', async t => {
  const file = await fixture(t); const legacy = seedBoard();
  legacy.screens[0].width = 360; legacy.screens[0].height = 560; legacy.screens[0].background = '#cc0000';
  const original = legacy.screens[0].nodes.find(node => node.id === 'home_details');
  original.fill = '#ff0000'; original.color = '#ffffff'; original.radius = 24;
  original.note = '実装では青い角丸ボタンにする';
  await fs.writeFile(file, JSON.stringify({ board: legacy, history: [], undo: [], redo: [] }));
  const store = await new BoardStore(file).open();
  const read = () => store.state.board.screens[0].nodes.find(node => node.id === 'home_details');
  assert.deepEqual([store.state.board.screens[0].width, store.state.board.screens[0].height], [360, 560]);
  assert.deepEqual([read().x, read().y, read().width, read().height, read().note], [original.x, original.y, original.width, original.height, original.note]);
  assert.equal(read().fill, '#dde1e5'); assert.equal(read().radius, 0); assert.equal(store.state.board.screens[0].background, '#ffffff');
  await store.mutate({ baseRevision: 0, operations: [{ type: 'node.update', id: 'home_details', changes: { label: '変更' } }] });
  await store.mutate({ baseRevision: 1, action: 'undo' });
  assert.equal(read().fill, '#dde1e5'); assert.equal(read().radius, 0); assert.equal(read().note, original.note);
  const svg = exportSvg(legacy);
  assert.doesNotMatch(svg, /rx="(?:12|24)"/); assert.doesNotMatch(svg, /fill="#ff0000"/);
  assert.match(svg, /fill="#dde1e5"/); assert.match(svg, /実装では青い角丸ボタンにする/);
  await store.close();
});

test('style overrides fail atomically and direct agents toward remarks', () => {
  const board = seedBoard(); const before = JSON.stringify(board);
  assert.throws(() => applyOperations(board, [
    { type: 'node.update', id: 'home_details', changes: { note: '変更を残さない' } },
    { type: 'node.update', id: 'home_details', changes: { radius: 16 } },
  ]), /appearance is fixed.*note/);
  assert.equal(JSON.stringify(board), before);
  assert.throws(() => applyOperations(board, [{ type: 'screen.update', id: 'screen_home', changes: { background: '#ff0000' } }]), /appearance is fixed/);
  assert.throws(() => applyOperations(board, [{ type: 'node.add', screenId: 'screen_home', node: { type: 'button', fill: '#ff0000' } }]), /appearance is fixed/);
});

test('CLI selects PC or mobile and passes implementation remarks through context and brief', async t => {
  const app = await startServer({ port: 0, data: await fixture(t) }); t.after(() => app.close());
  const run = async (...args) => JSON.parse((await exec(process.execPath, [cli, ...args, '--url', app.url])).stdout);
  await run('add-screen', '--id', 'test_pc', '--name', 'PC画面', '--preset', 'pc', '--remarks', '本番は濃紺の背景にする');
  let screen = (await run('inspect', 'test_pc')).item;
  assert.deepEqual([screen.width, screen.height], [1280, 800]);
  assert.equal(screen.background, '#ffffff'); assert.equal(screen.note, '本番は濃紺の背景にする');
  await run('set', 'test_pc', '--preset', 'mobile');
  screen = (await run('inspect', 'test_pc')).item;
  assert.deepEqual([screen.width, screen.height], [390, 844]); assert.equal(screen.note, '本番は濃紺の背景にする');
  const context = await run('context'); assert.match(context.appearance, /implementation.*note/);
  const brief = await (await fetch(app.url + '/api/export?format=brief')).text();
  assert.match(brief, /備考: 本番は濃紺の背景にする/); assert.match(brief, /固定表示/);
  await assert.rejects(run('add-screen', '--preset', 'tablet'), /preset must be pc or mobile/);
});
