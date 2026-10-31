import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { applyOperations, practiceBoard, seedBoard, validateBoard } from '../lib/board.mjs';
import { exportBrief, exportSvg } from '../lib/export.mjs';
import { BoardStore } from '../lib/store.mjs';
import { startServer } from '../server.mjs';
import { legacyBehaviorNotes, nodePosition } from '../public/regions.js';
import { getConnectionRoutes } from '../public/connections.js';
const exec = promisify(execFile), cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
async function fixture(t) {
  const root = fileURLToPath(new URL('../.test-output/', import.meta.url)); await fs.mkdir(root, { recursive: true });
  const folder = await fs.mkdtemp(path.join(root, 'regions-')); t.after(() => fs.rm(folder, { recursive: true, force: true })); return path.join(folder, 'board.json');
}
test('practice board teaches notes and keeps every grouped part within the frame', () => {
  const board = validateBoard(practiceBoard()), screen = board.screens[0], region = screen.nodes.find(node => node.id === 'practice_region');
  const members = screen.nodes.filter(node => node.parentId === region.id);
  assert.equal(board.startScreenId, screen.id); assert.equal(members.length, 3);
  assert.match(region.note, /縦スクロール/);
  assert.ok(members.every(node => node.x >= 0 && node.y >= 0 && node.x + node.width <= region.width && node.y + node.height <= region.height - 32));
  assert.ok([screen, ...screen.nodes].every(item => !item.scroll && !item.fixed && !item.collapsible && !item.collapsed));
});
test('membership and removed behavior settings are rejected atomically', () => {
  const original = seedBoard(), before = JSON.stringify(original);
  for (const changes of [{ parentId: 'done_receipt' }, { parentId: 'home_title' }, { parentId: 'missing' }, { fixed: 'top' }]) {
    assert.throws(() => applyOperations(original, [{ type: 'node.update', id: 'home_details', changes }]));
  }
  assert.throws(() => applyOperations(original, [{ type: 'node.add', screenId: 'screen_done', node: { type: 'card', parentId: 'done_receipt' } }]), /nested/);
  assert.throws(() => applyOperations(original, [{ type: 'node.update', id: 'done_receipt', changes: { collapsed: true } }]), /備考/);
  assert.throws(() => applyOperations(original, [{ type: 'screen.add', screen: { nodes: [{ type: 'button', fixed: 'top' }] } }]), /備考/);
  assert.equal(JSON.stringify(original), before);
});
test('reparent preserves absolute position, parent movement moves children, and export and connector anchors agree', () => {
  const board = practiceBoard(), original = board.screens[0], child = original.nodes.find(node => node.id === 'practice_shop_1');
  const point = nodePosition(original, child);
  const detached = applyOperations(board, [{ type: 'node.reparent', id: child.id, parentId: null }]).board;
  assert.deepEqual(nodePosition(detached.screens[0], detached.screens[0].nodes.find(node => node.id === child.id)), point);
  const attached = applyOperations(detached, [{ type: 'node.reparent', id: child.id, parentId: 'practice_region' }, { type: 'node.update', id: 'practice_region', changes: { x: 80, y: 150 } }]).board;
  const moved = nodePosition(attached.screens[0], attached.screens[0].nodes.find(node => node.id === child.id));
  assert.deepEqual(moved, { x: point.x + 54, y: point.y + 40 });
  const route = getConnectionRoutes(attached).find(route => route.sourceId === child.id);
  assert.equal(route.start.x, original.x + moved.x + child.width); assert.equal(route.start.y, original.y + moved.y + child.height / 2);
  assert.ok(exportSvg(attached).includes(`x="${original.x + moved.x}" y="${original.y + moved.y}"`));
  assert.match(exportBrief(attached), /所属する枠: practice_region/);
});
test('duplicate and deletion preserve region membership and undo recovers the group', async t => {
  const board = practiceBoard();
  const cloned = applyOperations(board, [{ type: 'item.duplicate', id: 'practice_region' }]);
  const region = cloned.board.screens[0].nodes.find(node => node.id === cloned.created[0]);
  assert.equal(cloned.board.screens[0].nodes.filter(node => node.parentId === region.id).length, 3);
  const screenCopy = applyOperations(board, [{ type: 'item.duplicate', id: 'practice_list' }]).board.screens.at(-1);
  assert.ok(screenCopy.nodes.filter(node => node.parentId).every(node => screenCopy.nodes.some(parent => parent.id === node.parentId)));
  const store = await new BoardStore(await fixture(t)).open(board); t.after(() => store.close());
  await store.mutate({ baseRevision: 0, operations: [{ type: 'item.remove', id: 'practice_region' }] });
  assert.equal(store.state.board.screens[0].nodes.filter(node => node.parentId).length, 0);
  await store.mutate({ baseRevision: 1, action: 'undo' }); assert.equal(store.state.board.screens[0].nodes.filter(node => node.parentId).length, 3);
});
test('start screen changes, deletion fallback and board imports do not overwrite another saved document', async t => {
  const store = await new BoardStore(await fixture(t)).open(); t.after(() => store.close());
  const first = store.state.documentId;
  await store.mutate({ baseRevision: 0, operations: [{ type: 'board.update', changes: { startScreenId: 'screen_detail' } }] });
  await assert.rejects(store.mutate({ baseRevision: 1, operations: [{ type: 'board.update', changes: { startScreenId: 'missing' } }] }));
  await store.mutate({ baseRevision: 1, operations: [{ type: 'item.remove', id: 'screen_detail' }] }); assert.equal(store.state.board.startScreenId, 'screen_home');
  const imported = await store.manageDocuments({ documentId: first, baseRevision: 2, action: 'import', board: practiceBoard() });
  assert.notEqual(imported.documentId, first); assert.equal(store.listDocuments().boards.length, 2);
  await store.manageDocuments({ documentId: imported.documentId, baseRevision: 0, action: 'open', targetId: first }); assert.equal(store.state.board.screens.length, 2); assert.equal(store.state.board.revision, 2);
});
test('tutorial names the real CLI and target; its region commands work through CLI and appear in context', async t => {
  const app = await startServer({ port: 0, data: await fixture(t) }); t.after(() => app.close());
  const tutorial = await (await fetch(app.url + '/api/tutorial')).json();
  assert.equal(tutorial.cliPath, cli); assert.equal(tutorial.url, app.url); assert.equal(tutorial.documentId, app.store.state.documentId);
  assert.ok(tutorial.prompt.includes(`--board ${tutorial.documentId}`)); assert.match(tutorial.prompt, /409/); assert.match(tutorial.prompt, /保存ファイルを直接書き換えず/);
  const run = async (...args) => JSON.parse((await exec(process.execPath, [cli, ...args, '--url', app.url, '--board', tutorial.documentId])).stdout);
  await run('add', 'screen_home', 'card', '--id', 'test_region', '--remarks', '右上のボタンで中身を切り替える。初期表示は素材。', '--height', '300');
  await run('add', 'screen_home', 'button', '--id', 'test_child', '--parent', 'test_region', '--x', '30', '--remarks', 'このボタンは枠の下に固定する');
  await assert.rejects(run('set', 'test_region', '--scroll', 'vertical'), error => /備考/.test(error.stderr));
  await assert.rejects(run('duplicate', 'screen_home', '--variant', 'error'), error => /duplicate/.test(error.stderr));
  await run('start-screen', 'screen_done');
  const context = await run('context'); assert.equal(context.board.startScreenId, 'screen_done');
  assert.equal(context.board.screens[0].nodes.find(node => node.id === 'test_child').parentId, 'test_region');
  await run('reparent', 'test_child', 'none'); assert.equal((await run('inspect', 'test_child')).item.fixed, 'none');
  const practice = await fetch(app.url + '/api/boards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId: tutorial.documentId, baseRevision: app.store.state.board.revision, action: 'practice' }) });
  assert.equal(practice.status, 200); assert.equal((await practice.json()).board.startScreenId, 'practice_list');
});

test('legacy behavior remains readable through restart, context, exports and undo without being reconfigured', async t => {
  const board = practiceBoard(), region = board.screens[0].nodes.find(node => node.id === 'practice_region');
  Object.assign(region, { scroll: 'vertical', collapsible: true, collapsed: true });
  board.screens[0].nodes.find(node => node.id === 'practice_shop_1').fixed = 'bottom';
  validateBoard(board);
  assert.match(legacyBehaviorNotes(region), /縦スクロール.*閉じる/);
  const file = await fixture(t); let store = await new BoardStore(file).open(board);
  const before = JSON.stringify(store.state.board);
  await store.close(); store = await new BoardStore(file).open();
  assert.equal(JSON.stringify(store.state.board), before);
  await store.mutate({ baseRevision: 0, operations: [{ type: 'node.update', id: region.id, changes: { note: '追加の説明' } }] });
  await store.mutate({ baseRevision: 1, action: 'undo' });
  assert.equal(store.state.board.screens[0].nodes.find(node => node.id === region.id).collapsed, true);
  assert.match(exportBrief(store.state.board), /以前の動作指定（備考として参照）.*縦スクロール/);
  assert.doesNotMatch(exportSvg(store.state.board), /↕|↔/);
  await store.close();
  const app = await startServer({ port: 0, data: file }); t.after(() => app.close());
  const context = await (await fetch(app.url + '/api/context')).json();
  assert.match(context.board.screens[0].nodes.find(node => node.id === region.id).legacyBehaviorNote, /縦スクロール/);
  const inspected = await (await fetch(app.url + '/api/items/' + region.id)).json();
  assert.equal(inspected.item.collapsed, true); assert.match(inspected.legacyBehaviorNote, /閉じる/);
  const response = await fetch(app.url + '/api/mutate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId: context.documentId, baseRevision: context.board.revision, operations: [{ type: 'node.update', id: region.id, changes: { scroll: 'horizontal' } }] }) });
  assert.equal(response.status, 400); assert.match((await response.json()).error, /備考/);
});
