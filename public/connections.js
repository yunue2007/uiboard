// Shared, document-coordinate geometry for the board and its SVG export.
import { isRegion, nodePosition } from './regions.js';
const normals = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } };
const opposite = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const rect = (item, dx = 0, dy = 0, pad = 0) => ({ left: item.x + dx - pad, top: item.y + dy - pad, right: item.x + dx + item.width + pad, bottom: item.y + dy + item.height + pad });
const offset = (point, side, distance) => ({ x: point.x + normals[side].x * distance, y: point.y + normals[side].y * distance });
function anchor(box, side, fraction = .5) {
  if (side === 'left' || side === 'right') return { x: side === 'left' ? box.left : box.right, y: box.top + (box.bottom - box.top) * fraction };
  return { x: box.left + (box.right - box.left) * fraction, y: side === 'top' ? box.top : box.bottom };
}
function outgoingSide(source, target, node) {
  if (source.id === target.id) return node.x + node.width / 2 >= source.width / 2 ? 'right' : 'left';
  if (target.x >= source.x + source.width) return 'right';
  if (target.x + target.width <= source.x) return 'left';
  if (target.y >= source.y + source.height) return 'bottom';
  if (target.y + target.height <= source.y) return 'top';
  const dx = target.x + target.width / 2 - source.x - source.width / 2;
  const dy = target.y + target.height / 2 - source.y - source.height / 2;
  return Math.abs(dx) >= Math.abs(dy) ? dx >= 0 ? 'right' : 'left' : dy >= 0 ? 'bottom' : 'top';
}
function simplify(points) {
  const result = [];
  for (const point of points) {
    const last = result.at(-1), previous = result.at(-2);
    if (last && last.x === point.x && last.y === point.y) continue;
    if (previous && ((previous.x === last.x && last.x === point.x) || (previous.y === last.y && last.y === point.y)) && (last.x - previous.x) * (point.x - last.x) + (last.y - previous.y) * (point.y - last.y) >= 0) result.pop();
    result.push(point);
  }
  return result;
}
function intersectsBox(a, b, box) {
  if (a.x === b.x) return a.x > box.left && a.x < box.right && Math.max(a.y, b.y) > box.top && Math.min(a.y, b.y) < box.bottom;
  return a.y > box.top && a.y < box.bottom && Math.max(a.x, b.x) > box.left && Math.min(a.x, b.x) < box.right;
}
function crossings(a, b, prior) {
  let count = 0;
  for (const points of prior) for (let index = 1; index < points.length; index++) {
    const c = points[index - 1], d = points[index];
    if (a.x === b.x && c.y === d.y && a.x > Math.min(c.x, d.x) && a.x < Math.max(c.x, d.x) && c.y > Math.min(a.y, b.y) && c.y < Math.max(a.y, b.y)) count++;
    if (a.y === b.y && c.x === d.x && c.x > Math.min(a.x, b.x) && c.x < Math.max(a.x, b.x) && a.y > Math.min(c.y, d.y) && a.y < Math.max(c.y, d.y)) count++;
  }
  return count;
}
function routeBetween(start, end, obstacles, source, target, prior) {
  const candidates = [];
  const add = points => candidates.push(simplify(points));
  if (start.x === end.x || start.y === end.y) add([start, end]);
  add([start, { x: end.x, y: start.y }, end]);
  add([start, { x: start.x, y: end.y }, end]);
  const lanes = (values, middle) => [...new Set(values)].sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle)).slice(0, 28);
  const xLanes = lanes([start.x, end.x, (start.x + end.x) / 2, source.left - 36, source.right + 36, target.left - 36, target.right + 36, ...obstacles.flatMap(box => [box.left - 1, box.right + 1])], (start.x + end.x) / 2);
  const yLanes = lanes([start.y, end.y, (start.y + end.y) / 2, source.top - 60, source.bottom + 36, target.top - 60, target.bottom + 36, ...obstacles.flatMap(box => [box.top - 1, box.bottom + 1])], (start.y + end.y) / 2);
  for (const x of xLanes) add([start, { x, y: start.y }, { x, y: end.y }, end]);
  for (const y of yLanes) add([start, { x: start.x, y }, { x: end.x, y }, end]);
  const outerY = [Math.min(source.top, target.top, ...obstacles.map(box => box.top)) - 48, Math.max(source.bottom, target.bottom, ...obstacles.map(box => box.bottom)) + 36];
  const outerX = [Math.min(source.left, target.left, ...obstacles.map(box => box.left)) - 36, Math.max(source.right, target.right, ...obstacles.map(box => box.right)) + 36];
  for (const y of outerY) for (const x of [source.left - 36, source.right + 36]) add([start, { x, y: start.y }, { x, y }, { x: end.x, y }, end]);
  for (const x of outerX) for (const y of [source.top - 60, source.bottom + 36]) add([start, { x: start.x, y }, { x, y }, { x, y: end.y }, end]);
  let best = null, bestCost = Infinity;
  for (const points of candidates) {
    let cost = (points.length - 2) * 24;
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1], b = points[index];
      cost += Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + crossings(a, b, prior) * 80;
      for (const box of obstacles) if (intersectsBox(a, b, box)) cost += 1000000;
    }
    if (cost < bestCost) { best = points; bestCost = cost; }
  }
  return best;
}
export function getConnectionRoutes(board) {
  const screens = new Map(board.screens.map(screen => [screen.id, screen]));
  const links = [], groups = new Map();
  for (const screen of board.screens) for (const node of screen.nodes) {
    const target = screens.get(node.targetScreenId); if (!target) continue;
    const positioned = { ...node, ...nodePosition(screen, node) };
    const sourceSide = outgoingSide(screen, target, positioned);
    const targetSide = screen.id === target.id ? sourceSide : opposite[sourceSide];
    const key = `${target.id}:${targetSide}`;
    const group = groups.get(key) ?? []; const link = { screen, node: positioned, target, sourceSide, targetSide, group, index: group.length };
    group.push(link); groups.set(key, group); links.push(link);
  }
  const routes = [];
  for (const link of links) {
    const { screen, node, target, sourceSide, targetSide, group, index } = link;
    const sourceBox = rect(node, screen.x, screen.y), frame = rect(screen), targetBox = rect(target);
    const start = anchor(sourceBox, sourceSide);
    const end = anchor(targetBox, targetSide, (index + 1) / (group.length + 1));
    if (screen.id === target.id && Math.abs(end.y - start.y) < 48) end.y = clamp(start.y + (start.y < (targetBox.top + targetBox.bottom) / 2 ? 72 : -72), targetBox.top + 20, targetBox.bottom - 20);
    const from = offset(start, sourceSide, 18), to = offset(end, targetSide, 24);
    const obstacles = board.screens.filter(other => other.id !== screen.id).map(other => rect(other, 0, 0, 12));
    obstacles.push(...screen.nodes.filter(other => !isRegion(screen, other)).map(other => rect({ ...other, ...nodePosition(screen, other) }, screen.x, screen.y, 8)));
    const points = simplify([start, ...routeBetween(from, to, obstacles, frame, targetBox, routes.map(route => route.points)), end]);
    const path = points.map((point, pointIndex) => `${pointIndex ? 'L' : 'M'}${point.x} ${point.y}`).join(' ');
    routes.push({ sourceId: node.id, sourceScreenId: screen.id, targetId: target.id, sourceLabel: node.label || node.type, targetLabel: target.name, sourceSide, targetSide, start, end, points, path });
  }
  return routes;
}
