import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { applyOperations, createNode, emptyBoard, practiceBoard, seedBoard, validateBoard } from '../lib/board.mjs';
import { BoardStore } from '../lib/store.mjs';
import { startServer } from '../server.mjs';
import { checkDesign } from '../public/design-checks.js';
import { scopeLayout, stepChanges } from '../public/editor-tools.js';
const exec = promisify(execFile), cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
async function fixture(t) {
  const root = fileURLToPath(new URL('../.test-output/', import.meta.url)); await fs.mkdir(root, { recursive: true });
  const folder = await fs.mkdtemp(path.join(root, 'review-')); t.after(() => fs.rm(folder, { recursive: true, force: true })); return path.join(folder, 'board.json');
}
test('design checks review static offscreen content and unreachable screens without changing the board', () => {
  const { board } = applyOperations(emptyBoard(), [
    { type: 'screen.add', screen: { id: 'main', width: 390, height: 844 } },
    { type: 'screen.add', screen: { id: 'detail', x: 600 } },
    { type: 'screen.add', screen: { id: 'alternative', x: 2000 } },
    { type: 'node.add', screenId: 'main', node: { id: 'region', type: 'card', width: 200, height: 120 } },
    { type: 'node.add', screenId: 'main', node: { id: 'reachable', type: 'button', parentId: 'region', x: 16, y: 1000, width: 80, targetScreenId: 'detail' } },
    { type: 'node.add', screenId: 'main', node: { id: 'outside', type: 'button', parentId: 'region', x: 500, y: 16, width: 80 } },
    { type: 'node.add', screenId: 'main', node: { id: 'negative', type: 'button', parentId: 'region', y: -100, height: 36 } },
  ]);
  const before = JSON.stringify(board), result = checkDesign(board);
  assert.ok(result.issues.some(issue => issue.code === 'outside-owner' && issue.itemId === 'outside'));
  assert.ok(result.issues.some(issue => issue.itemId === 'negative'));
  assert.ok(result.issues.some(issue => issue.itemId === 'reachable'));
  assert.ok(!result.issues.some(issue => issue.itemId === 'detail'));
  assert.ok(result.issues.some(issue => issue.code === 'unreachable-screen' && issue.itemId === 'alternative'));
  assert.equal(JSON.stringify(board), before); assert.deepEqual(checkDesign(board), result);
  assert.ok(result.issues.every(issue => issue.severity === 'review'));
});
test('legacy fixed and scroll metadata do not change static design checking', () => {
  const board = practiceBoard(), region = board.screens[0].nodes.find(node => node.id === 'practice_region');
  const child = board.screens[0].nodes.find(node => node.id === 'practice_shop_1');
  child.y = 2000;
  const plain = checkDesign(board);
  region.scroll = 'vertical'; region.collapsible = true; region.collapsed = true; child.fixed = 'bottom';
  validateBoard(board);
  const before = JSON.stringify(board), result = checkDesign(board);
  assert.deepEqual(result, plain); assert.equal(JSON.stringify(board), before);
  assert.ok(result.issues.some(issue => issue.itemId === child.id && issue.code === 'outside-owner'));
});
test('large check results retain total counts while limiting output for the UI and agents', () => {
  const board = seedBoard(); board.screens = [board.screens[0]]; board.screens[0].nodes = Array.from({ length: 250 }, (_, index) => createNode('button', { id: `outside_${index}`, x: 2000, width: 100 }));
  validateBoard(board); const result = checkDesign(board);
  assert.equal(result.issueCount, 250); assert.equal(result.issues.length, 200); assert.equal(result.truncated, true); assert.equal(result.byCode['outside-owner'], 250);
});
test('isolated editing exposes distant and negative members without changing their saved coordinates', () => {
  const board = practiceBoard(), child = board.screens[0].nodes.find(node => node.id === 'practice_shop_1');
  child.x = 2000; child.y = -100;
  const before = JSON.stringify(board), view = scopeLayout(board, { ownerId: 'practice_region', screenId: 'practice_list' });
  assert.ok(view.nodes.some(node => node.id === child.id)); assert.ok(view.width >= child.x + child.width);
  assert.ok(view.offset.y + child.y >= 0); assert.equal(JSON.stringify(board), before);
  const moved = applyOperations(board, [{ type: 'node.update', id: child.id, changes: stepChanges(child, 'node', 'left') }]).board;
  assert.equal(moved.screens[0].nodes.find(node => node.id === child.id).x, 1992);
  assert.equal(moved.screens[0].nodes.find(node => node.id === child.id).parentId, 'practice_region');
});
test('button geometry changes share validation and undo while respecting the limits of regions', async t => {
  const store = await new BoardStore(await fixture(t)).open(practiceBoard()); t.after(() => store.close());
  const region = store.state.board.screens[0].nodes.find(node => node.id === 'practice_region');
  const changes = stepChanges(region, 'node', 'wider', { region: true });
  await store.mutate({ baseRevision: 0, operations: [{ type: 'node.update', id: region.id, changes }] });
  assert.equal(store.state.board.screens[0].nodes.find(node => node.id === region.id).width, region.width + 8);
  await store.mutate({ baseRevision: 1, action: 'undo' }); assert.equal(store.state.board.screens[0].nodes.find(node => node.id === region.id).width, region.width);
  assert.equal(stepChanges({ ...region, height: 33 }, 'node', 'shorter', { region: true }), null);
  assert.equal(stepChanges({ ...region, width: 2400 }, 'node', 'wider'), null);
  assert.deepEqual(stepChanges({ ...region, height: 4 }, 'node', 'shorter'), { height: 2 });
});
test('archive and restore preserve history across restart; inactive archiving preserves presence', async t => {
  const file = await fixture(t); let store = await new BoardStore(file).open();
  const first = store.state.documentId;
  await store.mutate({ baseRevision: 0, operations: [{ type: 'node.update', id: 'home_brand', changes: { label: '残す編集' } }] });
  const second = (await store.manageDocuments({ documentId: first, baseRevision: 1, action: 'create', title: '別のボード' })).documentId;
  await store.manageDocuments({ documentId: second, baseRevision: 0, action: 'open', targetId: first });
  store.setPresence({ source: 'ui', actor: '人間', id: 'home_brand' });
  await store.manageDocuments({ documentId: first, baseRevision: 1, action: 'archive', targetId: second });
  assert.equal(store.presence.human.selection.nodeId, 'home_brand'); assert.equal(store.listDocuments().boards.length, 1);
  await store.manageDocuments({ documentId: first, baseRevision: 1, action: 'restore', targetId: second });
  await store.manageDocuments({ documentId: first, baseRevision: 1, action: 'archive', targetId: first });
  assert.equal(store.state.documentId, second); assert.equal(store.presence.human, null);
  await assert.rejects(store.mutate({ documentId: first, baseRevision: 1, operations: [{ type: 'board.update', changes: { title: 'stale' } }] }), error => error.status === 409);
  await store.close(); store = await new BoardStore(file).open(); t.after(() => store.close());
  assert.equal(store.listDocuments({ archived: true }).boards[0].documentId, first);
  await store.manageDocuments({ documentId: second, baseRevision: 0, action: 'restore', targetId: first });
  await store.manageDocuments({ documentId: second, baseRevision: 0, action: 'open', targetId: first });
  assert.equal(store.state.board.screens[0].nodes[0].label, '残す編集'); assert.equal(store.state.history.length, 1);
  await store.mutate({ baseRevision: 1, action: 'undo' }); assert.equal(store.state.board.screens[0].nodes[0].label, 'michi');
});
test('archiving the last board keeps it recoverable but read-only and permits a new normal board', async t => {
  const store = await new BoardStore(await fixture(t)).open(); t.after(() => store.close()); const id = store.state.documentId;
  const original = JSON.stringify(store.state.board);
  const archived = await store.manageDocuments({ documentId: id, baseRevision: 0, action: 'archive', targetId: id });
  assert.equal(archived.archived, true); assert.equal(store.listDocuments().boards.length, 0); assert.equal(store.listDocuments({ archived: true }).boards.length, 1);
  await assert.rejects(store.mutate({ documentId: id, baseRevision: 0, operations: [{ type: 'board.update', changes: { title: 'not allowed' } }] }), /archived/);
  assert.throws(() => store.setPresence({ source: 'cli', actor: 'Codex', id: 'home_brand' }), /archived/);
  const fresh = await store.manageDocuments({ documentId: id, baseRevision: 0, action: 'create', title: '次の作戦' });
  assert.equal(fresh.archived, false); assert.notEqual(fresh.documentId, id);
  await store.manageDocuments({ documentId: fresh.documentId, baseRevision: 0, action: 'restore', targetId: id });
  await store.manageDocuments({ documentId: fresh.documentId, baseRevision: 0, action: 'open', targetId: id });
  assert.equal(JSON.stringify(store.state.board), original);
});
test('API and CLI share check results, scope presence and archive protection without changing design', async t => {
  const file = await fixture(t), app = await startServer({ port: 0, data: file }); t.after(() => app.close());
  const run = async (...args) => JSON.parse((await exec(process.execPath, [cli, ...args, '--url', app.url])).stdout);
  const before = await fs.readFile(file, 'utf8'), result = await run('check'), context = await run('context');
  assert.deepEqual(result.issues, context.checks.issues); assert.equal(result.revision, context.board.revision); assert.equal(await fs.readFile(file, 'utf8'), before);
  const doc = context.documentId;
  const response = await fetch(app.url + '/api/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId: doc, source: 'ui', actor: '人間', id: null, viewport: { x: 1, y: 2, width: 500, height: 600, zoom: 1, scopeId: 'screen_home' } }) });
  assert.equal(response.status, 200); assert.equal((await run('context')).presence.human.viewport.scopeId, 'screen_home');
  await run('archive', doc); assert.equal((await run('boards')).boards.length, 0); assert.equal((await run('boards', '--archived')).boards.length, 1);
  await assert.rejects(run('set', 'home_brand', '--label', '古い操作', '--board', doc), error => /archived/.test(error.stderr));
  await run('restore', doc); assert.equal((await run('context')).archived, false); assert.equal((await run('boards')).boards.length, 1);
});
