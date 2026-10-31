import { childrenOf, nodePosition, REGION_HEADER } from './regions.js';

export function scopeLayout(board, scope) {
  if (!scope) return null;
  const screen = board.screens.find(screen => screen.id === scope.screenId);
  const region = screen?.nodes.find(node => node.id === scope.ownerId && node.type === 'card');
  if (!screen || (scope.ownerId !== screen.id && !region)) return null;
  const nodes = childrenOf(screen, region?.id ?? null);
  const positions = region ? nodes : screen.nodes.map(node => ({ ...node, ...nodePosition(screen, node) }));
  const offset = scope.offset ?? { x: 32 - Math.min(0, ...positions.map(node => node.x)), y: 32 - Math.min(0, ...positions.map(node => node.y)) };
  const width = Math.max((region ?? screen).width + 64, ...positions.map(node => node.x + node.width + offset.x + 32));
  const height = Math.max((region ? region.height - REGION_HEADER : screen.height) + 64, ...positions.map(node => node.y + node.height + offset.y + 32));
  return { screen, region, nodes, offset, x: 80, y: 100, width, height, title: `${region?.label || screen.name}の部品`, worldOrigin: { x: screen.x + (region?.x ?? 0), y: screen.y + (region ? region.y + REGION_HEADER : 0) } };
}
export function stepChanges(item, kind, action, { region = false } = {}) {
  const min = (field, value, lower, upper) => ({ [field]: Math.max(lower, Math.min(upper, value)) });
  const frame = kind === 'screen';
  const actions = {
    left: () => min('x', item.x - 8, frame ? -20000 : -2400, frame ? 20000 : 4800),
    right: () => min('x', item.x + 8, frame ? -20000 : -2400, frame ? 20000 : 4800),
    up: () => min('y', item.y - 8, frame ? -20000 : -4000, frame ? 20000 : 8000),
    down: () => min('y', item.y + 8, frame ? -20000 : -4000, frame ? 20000 : 8000),
    narrower: () => min('width', item.width - 8, frame ? 160 : 2, 2400),
    wider: () => min('width', item.width + 8, frame ? 160 : 2, 2400),
    shorter: () => min('height', item.height - 8, frame ? 160 : region ? 33 : 2, 4000),
    taller: () => min('height', item.height + 8, frame ? 160 : region ? 33 : 2, 4000),
  };
  if (!Object.hasOwn(actions, action)) throw new Error('Unknown adjustment');
  const result = actions[action](); return Object.entries(result).every(([key, value]) => item[key] === value) ? null : result;
}
