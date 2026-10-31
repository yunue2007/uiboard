import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNode, createScreen, emptyBoard } from '../lib/board.mjs';
import { getConnectionRoutes } from '../public/connections.js';
import { exportSvg } from '../lib/export.mjs';

function example(targetPosition = { x: 800, y: 0 }) {
  const board = emptyBoard();
  const source = createScreen({ id: 'source', x: 0, y: 0, width: 300, height: 300 });
  const target = createScreen({ id: 'target', ...targetPosition, width: 300, height: 300 });
  source.nodes.push(createNode('button', { id: 'go', x: 80, y: 100, width: 120, height: 40, targetScreenId: target.id }));
  board.screens.push(source, target); return board;
}
function checkOrthogonal(route) {
  assert.deepEqual(route.points[0], route.start); assert.deepEqual(route.points.at(-1), route.end);
  for (let index = 1; index < route.points.length; index++) {
    const a = route.points[index - 1], b = route.points[index];
    assert.ok(a.x === b.x || a.y === b.y, 'Connections must have no diagonal segments');
  }
}
test('a forward transition starts at its actual block edge and ends on the target frame', () => {
  const [route] = getConnectionRoutes(example());
  assert.deepEqual(route.start, { x: 200, y: 120 });
  assert.deepEqual(route.end, { x: 800, y: 150 });
  assert.equal(route.sourceId, 'go'); assert.equal(route.targetId, 'target'); checkOrthogonal(route);
});
test('backward, upward and downward transitions stay attached to their corresponding edges', () => {
  for (const [position, sourceSide, expectedStart, expectedEnd] of [
    [{ x: -800, y: 0 }, 'left', { x: 80, y: 120 }, { x: -500, y: 150 }],
    [{ x: 0, y: 600 }, 'bottom', { x: 140, y: 140 }, { x: 150, y: 600 }],
    [{ x: 0, y: -600 }, 'top', { x: 140, y: 100 }, { x: 150, y: -300 }],
  ]) {
    const [route] = getConnectionRoutes(example(position));
    assert.equal(route.sourceSide, sourceSide); assert.deepEqual(route.start, expectedStart); assert.deepEqual(route.end, expectedEnd); checkOrthogonal(route);
  }
});
test('an intervening screen is avoided instead of being covered by the transition', () => {
  const board = example(); board.screens.push(createScreen({ id: 'blocker', x: 400, y: 0, width: 300, height: 300 }));
  const [route] = getConnectionRoutes(board); checkOrthogonal(route);
  for (let index = 1; index < route.points.length; index++) {
    const a = route.points[index - 1], b = route.points[index];
    const crossing = a.x === b.x ? a.x > 400 && a.x < 700 && Math.max(a.y, b.y) > 0 && Math.min(a.y, b.y) < 300 : a.y > 0 && a.y < 300 && Math.max(a.x, b.x) > 400 && Math.min(a.x, b.x) < 700;
    assert.equal(crossing, false, 'Route must not cross the unrelated screen');
  }
});
test('incoming links use distinct ports and self-transitions form an explicit loop', () => {
  const board = example();
  board.screens[0].nodes.push(createNode('button', { id: 'also_go', x: 80, y: 200, width: 120, height: 40, targetScreenId: 'target' }));
  const incoming = getConnectionRoutes(board); assert.notDeepEqual(incoming[0].end, incoming[1].end);
  const self = example(); self.screens[0].nodes[0].targetScreenId = 'source';
  const [loop] = getConnectionRoutes(self); assert.equal(loop.targetId, 'source');
  assert.ok(loop.points.length >= 4); assert.ok(loop.points.some(point => point.x < 0 || point.x > 300)); checkOrthogonal(loop);
});
test('moving a frame or resizing its source recomputes endpoints without mutating the document', () => {
  const board = example(); const before = JSON.stringify(board);
  getConnectionRoutes(board); assert.equal(JSON.stringify(board), before);
  board.screens[0].x = 30; board.screens[0].nodes[0].width = 150;
  board.screens[1].x = 950; board.screens[1].y = 40;
  const [route] = getConnectionRoutes(board);
  assert.deepEqual(route.start, { x: 260, y: 120 }); assert.deepEqual(route.end, { x: 950, y: 190 });
});
test('SVG uses the same attached route and draws its endpoints above the blocks', () => {
  const board = example(), [route] = getConnectionRoutes(board), svg = exportSvg(board);
  assert.ok(svg.includes(`d="${route.path}"`));
  assert.ok(svg.indexOf('data-source-id="go"') > svg.lastIndexOf('<rect '));
  assert.ok(svg.includes('cx="200" cy="120"')); assert.ok(svg.includes('cx="800" cy="150"'));
});
