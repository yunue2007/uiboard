import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { applyOperations, seedBoard } from '../lib/board.mjs';
import { BoardStore } from '../lib/store.mjs';
import { exportBundle } from '../lib/bundle.mjs';
import { startServer } from '../server.mjs';
const exec = promisify(execFile), cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
async function fixture(t) {
  const root = fileURLToPath(new URL('../.test-output/', import.meta.url)); await fs.mkdir(root, { recursive: true });
  const folder = await fs.mkdtemp(path.join(root, 'features-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true })); return path.join(folder, 'board.json');
}
test('screen duplicate remaps its IDs and self links, preserves external links, notes and original', () => {
  const original = seedBoard(); original.screens[0].nodes[0].targetScreenId = original.screens[0].id;
  const before = JSON.stringify(original);
  const result = applyOperations(original, [{ type: 'item.duplicate', id: 'screen_home' }]);
  const copy = result.board.screens.at(-1);
  assert.equal(JSON.stringify(original), before); assert.notEqual(copy.id, 'screen_home');
  assert.equal(copy.nodes[0].targetScreenId, copy.id); assert.equal(copy.nodes.at(-1).targetScreenId, 'screen_detail');
  assert.equal(copy.nodes.at(-1).note, original.screens[0].nodes.at(-1).note);
  assert.equal(copy.note, original.screens[0].note); assert.match(copy.name, /のコピー/);
  assert.throws(() => applyOperations(original, [{ type: 'item.duplicate', id: 'screen_home', variant: 'error' }]), /variant/);
  assert.ok(copy.nodes.every(node => !original.screens.flatMap(screen => screen.nodes).some(old => old.id === node.id)));
  assert.equal(result.created[0], copy.id);
});
test('layer and layout change structure atomically and reject mixed screens', () => {
  const original = seedBoard(), ids = ['home_brand', 'home_badge', 'home_title'];
  const result = applyOperations(original, [{ type: 'node.layer', id: 'home_details', position: 'back' }, { type: 'nodes.layout', ids, mode: 'left' }]);
  assert.equal(result.board.screens[0].nodes[0].id, 'home_details');
  const selected = result.board.screens[0].nodes.filter(node => ids.includes(node.id));
  assert.equal(new Set(selected.map(node => node.x)).size, 1);
  const spaced = applyOperations(original, [{ type: 'nodes.layout', ids, mode: 'vertical' }]).board.screens[0].nodes.filter(node => ids.includes(node.id)).sort((a, b) => a.y - b.y);
  assert.ok(Math.abs((spaced[1].y - spaced[0].y - spaced[0].height) - (spaced[2].y - spaced[1].y - spaced[1].height)) < .001);
  assert.throws(() => applyOperations(original, [{ type: 'nodes.layout', ids: ['home_brand', 'detail_book'], mode: 'top' }]), /same screen/);
  assert.throws(() => applyOperations(original, [{ type: 'nodes.layout', ids: ['home_brand', 'home_badge'], mode: 'horizontal' }]), /three/);
});
test('board library preserves per-board history and undo across switching and restart; stale document rejected', async t => {
  const file = await fixture(t), store = await new BoardStore(file).open();
  const first = store.state.documentId;
  await store.mutate({ documentId: first, baseRevision: 0, operations: [{ type: 'node.update', id: 'home_brand', changes: { label: '保存される編集' } }] });
  store.setPresence({ source: 'ui', actor: '人間', id: 'home_brand' });
  const second = await store.manageDocuments({ documentId: first, baseRevision: 1, action: 'create', title: '別のボード' });
  assert.equal(second.board.screens.length, 0); assert.equal(store.listDocuments().boards.length, 2); assert.equal(second.presence.human, null);
  await assert.rejects(store.mutate({ documentId: first, baseRevision: 0, operations: [{ type: 'board.update', changes: { title: 'wrong' } }] }), error => error.status === 409);
  await store.manageDocuments({ documentId: second.documentId, baseRevision: 0, action: 'open', targetId: first });
  assert.equal(store.state.history.length, 1); assert.equal(store.state.board.screens[0].nodes[0].label, '保存される編集');
  await store.mutate({ documentId: first, baseRevision: 1, action: 'undo' }); assert.equal(store.state.board.screens[0].nodes[0].label, 'michi');
  const copied = await store.manageDocuments({ documentId: first, baseRevision: 2, action: 'copy', title: 'コピー' });
  assert.equal(copied.board.screens.length, 3); assert.equal(copied.history.length, 0); assert.equal(copied.canUndo, false);
  await store.close(); const reopened = await new BoardStore(file).open(); t.after(() => reopened.close());
  assert.equal(reopened.state.documentId, copied.documentId); assert.equal(reopened.listDocuments().boards.length, 3);
  await reopened.manageDocuments({ documentId: copied.documentId, baseRevision: 0, action: 'open', targetId: first });
  assert.equal(reopened.snapshot().canRedo, true); assert.equal(reopened.state.board.revision, 2);
});
test('HTTP requires document guard, CLI board commands share state, viewport reaches context', async t => {
  const app = await startServer({ port: 0, data: await fixture(t) }); t.after(() => app.close());
  const run = async (...args) => JSON.parse((await exec(process.execPath, [cli, ...args, '--url', app.url])).stdout);
  const first = (await run('context')).documentId;
  const post = (route, body) => fetch(app.url + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post('/api/mutate', { baseRevision: 0, operations: [{ type: 'board.update', changes: { title: 'bad' } }] })).status, 409);
  const viewport = { x: 10, y: 20, width: 900, height: 700, zoom: .8 };
  assert.equal((await post('/api/presence', { documentId: first, source: 'ui', actor: '人間', id: 'home_brand', viewport })).status, 200);
  assert.deepEqual((await run('context')).presence.human.viewport, viewport);
  const duplicate = await run('duplicate', 'screen_home', '--name', '読み込み中の案', '--board', first);
  assert.equal((await run('inspect', duplicate.created[0])).item.name, '読み込み中の案');
  const second = await run('new-board', '--title', '新規'); assert.notEqual(second.documentId, first);
  await assert.rejects(run('set', 'home_brand', '--label', '誤編集', '--board', first));
  assert.equal((await run('boards')).boards.length, 2);
  await run('open', first); assert.equal((await run('context')).board.screens.length, 4);
  assert.equal((await post('/api/presence', { documentId: first, source: 'ui', actor: '人間', id: null, viewport: { ...viewport, width: -1 } })).status, 400);
});
test('handoff ZIP includes image, structure and notes from the same revision', () => {
  const board = seedBoard(); board.revision = 17;
  const archive = exportBundle(board, 'document_test'), files = new Map(); let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const size = archive.readUInt32LE(offset + 18), nameLength = archive.readUInt16LE(offset + 26), extraLength = archive.readUInt16LE(offset + 28);
    const name = archive.subarray(offset + 30, offset + 30 + nameLength).toString();
    const start = offset + 30 + nameLength + extraLength; files.set(name, archive.subarray(start, start + size).toString()); offset = start + size;
  }
  assert.deepEqual([...files.keys()], ['manifest.json', 'board.json', 'board.svg', 'brief.md', 'checks.json']);
  assert.equal(JSON.parse(files.get('manifest.json')).documentId, 'document_test');
  assert.equal(JSON.parse(files.get('board.json')).revision, 17); assert.match(files.get('board.svg'), /rev 17/); assert.match(files.get('brief.md'), /Revision: 17/);
  const checks = JSON.parse(files.get('checks.json'));
  assert.equal(checks.documentId, 'document_test'); assert.equal(checks.revision, 17); assert.equal(checks.boardId, board.id);
  assert.deepEqual(JSON.parse(files.get('manifest.json')).files, ['board.json', 'board.svg', 'brief.md', 'checks.json']);
  assert.equal(archive.readUInt32LE(offset), 0x02014b50); assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50);
});
