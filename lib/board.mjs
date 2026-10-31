import { randomUUID } from 'node:crypto';
import { NODE_STYLES, SCREEN_BACKGROUND, SCREEN_PRESETS, withFixedAppearance } from '../public/board-rules.js';
import { isRegion, nodePosition, REGION_HEADER, scrollMode, legacyBehaviorNotes } from '../public/regions.js';

export const NODE_TYPES = ['text', 'button', 'input', 'card', 'image', 'badge', 'divider'];
export const STATUSES = ['draft', 'discuss', 'confirmed'];
export class BoardError extends Error {
  constructor(message, status = 400, details = {}) { super(message); this.status = status; this.details = details; }
}
const fail = message => { throw new BoardError(message); };
const id = prefix => `${prefix}_${randomUUID().slice(0, 8)}`;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, name, max = 4000) => {
  if (typeof value !== 'string' || value.length > max) fail(`${name} must be a string of at most ${max} characters`);
  return value;
};
const number = (value, name, min, max) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${name} must be between ${min} and ${max}`);
  return value;
};
const color = (value, name) => {
  if (typeof value !== 'string' || !/^(#[\da-f]{3,8}|transparent)$/i.test(value) || (value !== 'transparent' && ![4, 5, 7, 9].includes(value.length))) fail(`${name} must be a hex color or transparent`);
  return value;
};
const keys = (value, allowed, name) => {
  if (!isObject(value)) fail(`${name} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`Unknown ${name} field: ${key}`);
};
export function nodeDefaults(type) {
  if (!NODE_TYPES.includes(type)) fail(`Unknown node type: ${type}`);
  const defaults = {
    text: { label: 'テキスト', width: 260, height: 36, fill: 'transparent', color: '#26312c', fontSize: 20, radius: 0 },
    button: { label: 'ボタン', width: 280, height: 48, fill: '#4d6655', color: '#ffffff', fontSize: 14, radius: 10 },
    input: { label: '入力してください', width: 280, height: 44, fill: '#ffffff', color: '#8b938e', fontSize: 13, radius: 8 },
    card: { label: 'カード', width: 280, height: 120, fill: '#f0f1eb', color: '#3e4e43', fontSize: 15, radius: 12 },
    image: { label: '画像', width: 280, height: 150, fill: '#e6eadd', color: '#75876b', fontSize: 13, radius: 12 },
    badge: { label: 'ラベル', width: 100, height: 28, fill: '#edf1e6', color: '#58713e', fontSize: 11, radius: 14 },
    divider: { label: '', width: 280, height: 2, fill: '#e4e7e0', color: '#26312c', fontSize: 12, radius: 0 },
  };
  return { ...structuredClone(defaults[type]), ...NODE_STYLES[type] };
}
export function createNode(type, changes = {}) {
  return { id: id('node'), type, x: 24, y: 80, note: '', status: 'draft', targetScreenId: null, ...nodeDefaults(type), ...changes, ...NODE_STYLES[type] };
}
export function createScreen(changes = {}) {
  return { id: id('screen'), name: '新しい画面', x: 80, y: 100, width: SCREEN_PRESETS.pc.width, height: SCREEN_PRESETS.pc.height, note: '', status: 'draft', nodes: [], ...changes, background: SCREEN_BACKGROUND };
}
export function emptyBoard(title = '新しい作戦ボード') {
  return { schemaVersion: 1, id: id('board'), title, revision: 0, updatedAt: new Date().toISOString(), screens: [] };
}
export function seedBoard() {
  const board = emptyBoard('カフェ予約の作戦ボード');
  const home = createScreen({ width: SCREEN_PRESETS.mobile.width, height: SCREEN_PRESETS.mobile.height, id: 'screen_home', name: 'お店を探す', x: 64, y: 100, note: '最初の画面。迷わずお店を探せるように。', status: 'discuss' });
  const detail = createScreen({ width: SCREEN_PRESETS.mobile.width, height: SCREEN_PRESETS.mobile.height, id: 'screen_detail', name: 'お店の詳細', x: 564, y: 100, note: '写真と情報を見て、予約へ進む。' });
  const done = createScreen({ width: SCREEN_PRESETS.mobile.width, height: SCREEN_PRESETS.mobile.height, id: 'screen_done', name: '予約完了', x: 1064, y: 100, note: '予約内容と次にすることを伝える。' });
  home.nodes = [
    createNode('text', { id: 'home_brand', label: 'michi', x: 26, y: 24, width: 110, height: 32, fontSize: 24 }),
    createNode('badge', { id: 'home_badge', label: 'CAFE GUIDE', x: 238, y: 28, width: 96 }),
    createNode('text', { id: 'home_title', label: 'ひと息つける、\nお気に入りの場所。', x: 26, y: 86, width: 310, height: 80, fontSize: 28 }),
    createNode('text', { id: 'home_intro', label: '今日の気分で、カフェを探そう。', x: 26, y: 176, width: 310, height: 28, fontSize: 12, color: '#8a928a' }),
    createNode('input', { id: 'home_search', label: 'エリアやお店の名前で探す', x: 26, y: 226, width: 308 }),
    createNode('image', { id: 'home_photo', label: 'お店の写真', x: 26, y: 290, width: 308, height: 120 }),
    createNode('text', { id: 'home_cafe', label: '木漏れ日コーヒー', x: 26, y: 426, width: 280, height: 30, fontSize: 18 }),
    createNode('text', { id: 'home_info', label: '中目黒  ·  徒歩5分  ·  自家焙煎', x: 26, y: 461, width: 308, height: 24, fontSize: 11, color: '#899187' }),
    createNode('button', { id: 'home_details', label: 'お店を見る  →', x: 26, y: 499, width: 308, height: 40, targetScreenId: 'screen_detail', note: 'このボタンから詳細画面へ。', status: 'confirmed' }),
  ];
  detail.nodes = [
    createNode('text', { id: 'detail_back', label: '←  お店を探す', x: 26, y: 24, width: 240, height: 28, fontSize: 12, targetScreenId: 'screen_home' }),
    createNode('image', { id: 'detail_photo', label: '店内の写真', x: 26, y: 76, width: 308, height: 164, fill: '#e9e2d4', color: '#a19379' }),
    createNode('badge', { id: 'detail_badge', label: '本日予約OK', x: 26, y: 258, width: 105 }),
    createNode('text', { id: 'detail_name', label: '木漏れ日コーヒー', x: 26, y: 301, width: 308, height: 38, fontSize: 24 }),
    createNode('text', { id: 'detail_intro', label: '窓際の席で、ゆっくり過ごす。\n丁寧に淹れたコーヒーと季節のお菓子。', x: 26, y: 353, width: 308, height: 56, fontSize: 12, color: '#848c82' }),
    createNode('input', { id: 'detail_date', label: '日時を選択  ▾', x: 26, y: 432, width: 308 }),
    createNode('button', { id: 'detail_book', label: 'このお店を予約する  →', x: 26, y: 499, width: 308, height: 40, targetScreenId: 'screen_done', note: '実際の予約処理はせず、完了画面への動線を試す。', status: 'discuss' }),
  ];
  done.nodes = [
    createNode('badge', { id: 'done_check', label: '✓', x: 152, y: 110, width: 56, height: 56, radius: 28, fontSize: 26 }),
    createNode('text', { id: 'done_title', label: '予約できました。', x: 40, y: 202, width: 280, height: 42, fontSize: 26 }),
    createNode('text', { id: 'done_subtitle', label: 'あなたのひと息を、お待ちしています。', x: 40, y: 255, width: 286, height: 28, fontSize: 12, color: '#8a928a' }),
    createNode('card', { id: 'done_receipt', label: '木漏れ日コーヒー\n\n11月3日  14:00  /  2名', x: 26, y: 318, width: 308, height: 115, fontSize: 14 }),
    createNode('button', { id: 'done_home', label: 'お店探しに戻る', x: 26, y: 499, width: 308, height: 40, targetScreenId: 'screen_home', fill: '#f0f2ec', color: '#526549' }),
  ];
  board.screens = [home, detail, done];
  return board;
}
export function locate(board, targetId) {
  for (const screen of board.screens) {
    if (screen.id === targetId) return { kind: 'screen', screen, item: screen };
    const item = screen.nodes.find(node => node.id === targetId);
    if (item) return { kind: 'node', screen, item };
  }
  throw new BoardError(`Item not found: ${targetId}`, 404);
}
export function practiceBoard() {
  const board = emptyBoard('練習用ボード');
  const first = createScreen({ id: 'practice_list', name: 'お店を探す', x: 64, y: 100, width: SCREEN_PRESETS.mobile.width, height: SCREEN_PRESETS.mobile.height, note: '部品を置いて備考を書く練習。ボタンを押すと詳細画面へ移動する。' });
  const next = createScreen({ id: 'practice_detail', name: '詳細を見る', x: 600, y: 100, note: 'PCサイズの画面。ボタンから元の画面へ戻る。' });
  first.nodes = [
    createNode('text', { id: 'practice_heading', label: 'お店を探そう', x: 26, y: 18, width: 338, height: 46, fontSize: 24 }),
    createNode('card', { id: 'practice_region', label: 'おすすめのお店', x: 26, y: 110, width: 338, height: 320, note: '実装時は、お店が増えたらこの枠の中を縦スクロールできるようにする。' }),
    ...Array.from({ length: 3 }, (_, index) => createNode('button', { id: `practice_shop_${index + 1}`, label: `カフェ ${index + 1} の詳細を見る`, x: 16, y: 32 + index * 72, width: 306, height: 44, parentId: 'practice_region', targetScreenId: next.id })),
    createNode('text', { id: 'practice_hint', label: '部品を選んで、備考に意図を書こう。', x: 26, y: 470, width: 338, height: 80, fontSize: 16, note: '見た目と動きの希望は備考に書く。例：右上のボタンに応じて、この枠に素材一覧・効果一覧・設定項目を表示する。' }),
  ];
  next.nodes = [createNode('text', { label: 'お店の詳細', x: 50, y: 50, width: 500, height: 60, fontSize: 32 }), createNode('button', { label: 'お店探しへ戻る', x: 50, y: 160, targetScreenId: first.id })];
  board.screens = [first, next]; board.startScreenId = first.id; return board;
}
const nodeFields = ['id', 'type', 'label', 'x', 'y', 'width', 'height', 'fill', 'color', 'fontSize', 'radius', 'note', 'status', 'targetScreenId', 'parentId', 'scroll', 'collapsible', 'collapsed', 'fixed'];
const screenFields = ['id', 'name', 'x', 'y', 'width', 'height', 'background', 'note', 'status', 'nodes', 'scroll'];
function checkBehaviorChanges(changes = {}) {
  if (['scroll', 'fixed', 'collapsible', 'collapsed'].some(key => Object.hasOwn(changes, key))) fail('Describe scrolling, folding and fixed positioning in note (備考); these behaviors are not simulated.');
}
function checkFixedAppearance(changes, style) {
  for (const [key, value] of Object.entries(style)) {
    if (Object.hasOwn(changes, key) && changes[key] !== value) fail('Board appearance is fixed. Describe implementation colors and shapes in note (備考).');
  }
}
export function validateBoard(board) {
  keys(board, ['schemaVersion', 'id', 'title', 'revision', 'updatedAt', 'screens', 'startScreenId'], 'board');
  if (board.schemaVersion !== 1) fail('Unsupported schemaVersion');
  text(board.id, 'board.id', 100); text(board.title, 'title', 200);
  number(board.revision, 'revision', 0, Number.MAX_SAFE_INTEGER);
  if (!Number.isInteger(board.revision)) fail('revision must be an integer');
  text(board.updatedAt, 'updatedAt', 100);
  if (!Array.isArray(board.screens) || board.screens.length > 100) fail('A board can contain at most 100 screens');
  const ids = new Set();
  function checkId(itemId) {
    if (typeof itemId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(itemId) || ids.has(itemId)) fail(`Invalid or duplicate item id: ${itemId}`);
    ids.add(itemId);
  }
  for (const screen of board.screens) {
    keys(screen, screenFields, 'screen'); checkId(screen.id); text(screen.name, 'screen.name', 200);
    number(screen.x, 'screen.x', -20000, 20000); number(screen.y, 'screen.y', -20000, 20000);
    number(screen.width, 'screen.width', 160, 2400); number(screen.height, 'screen.height', 160, 4000);
    color(screen.background, 'background'); text(screen.note, 'note');
    if (!['none', 'vertical', 'horizontal'].includes(scrollMode(screen))) fail('Invalid screen scroll');
    if (!STATUSES.includes(screen.status)) fail('Invalid screen status');
    if (!Array.isArray(screen.nodes) || screen.nodes.length > 500) fail('A screen can contain at most 500 nodes');
    for (const node of screen.nodes) {
      keys(node, nodeFields, 'node'); checkId(node.id);
      if (!NODE_TYPES.includes(node.type)) fail(`Invalid node type: ${node.type}`);
      text(node.label, 'label', 2000); text(node.note, 'note');
      number(node.x, 'node.x', -2400, 4800); number(node.y, 'node.y', -4000, 8000);
      number(node.width, 'node.width', 2, 2400); number(node.height, 'node.height', 2, 4000);
      number(node.fontSize, 'fontSize', 8, 120); number(node.radius, 'radius', 0, 2000);
      color(node.fill, 'fill'); color(node.color, 'color');
      if (!STATUSES.includes(node.status)) fail('Invalid node status');
      if (node.targetScreenId !== null && typeof node.targetScreenId !== 'string') fail('targetScreenId must be a screen id or null');
      if (node.parentId !== undefined && node.parentId !== null && typeof node.parentId !== 'string') fail('parentId must be a region id or null');
      if (!['none', 'vertical', 'horizontal'].includes(scrollMode(node))) fail('Invalid region scroll');
      if (!['none', 'top', 'bottom'].includes(node.fixed ?? 'none')) fail('Invalid fixed position');
      for (const field of ['collapsible', 'collapsed']) if (node[field] !== undefined && typeof node[field] !== 'boolean') fail(`${field} must be a boolean`);
      if (node.type !== 'card' && (scrollMode(node) !== 'none' || node.collapsible || node.collapsed)) fail('Only a card can be a region');
      if (node.collapsed && !node.collapsible) fail('collapsed requires collapsible');
    }
    for (const node of screen.nodes) {
      const parent = node.parentId ? screen.nodes.find(candidate => candidate.id === node.parentId) : null;
      if (node.parentId && (!parent || parent.type !== 'card' || parent.parentId || node.type === 'card')) fail('A member must belong to a root card in the same screen; nested regions are not supported');
      if (isRegion(screen, node) && (node.height <= REGION_HEADER || node.targetScreenId !== null)) fail('A region needs a content area and cannot navigate; link a child button instead');
      if ((node.fixed ?? 'none') !== 'none' && scrollMode(parent ?? screen) === 'none') fail('Fixed parts require a scrolling screen or region');
    }
  }
  const screenIds = new Set(board.screens.map(screen => screen.id));
  if (board.startScreenId !== undefined && board.startScreenId !== null && !screenIds.has(board.startScreenId)) fail('Start screen not found');
  for (const screen of board.screens) for (const node of screen.nodes) {
    if (node.targetScreenId !== null && !screenIds.has(node.targetScreenId)) fail(`Target screen not found: ${node.targetScreenId}`);
  }
  return board;
}
export function applyOperations(current, operations) {
  if (!Array.isArray(operations) || !operations.length || operations.length > 200) fail('operations must contain 1 to 200 operations');
  let board = structuredClone(current);
  const summaries = [];
  const created = [];
  for (const op of operations) {
    if (!isObject(op)) fail('Each operation must be an object');
    switch (op.type) {
      case 'board.update':
        keys(op, ['type', 'changes'], 'operation'); keys(op.changes, ['title', 'startScreenId'], 'board changes');
        Object.assign(board, op.changes); summaries.push(Object.hasOwn(op.changes, 'startScreenId') ? '開始画面を変更' : 'ボード名を変更'); break;
      case 'board.reset':
        keys(op, ['type', 'title', 'sample'], 'operation');
        if (op.sample !== undefined && typeof op.sample !== 'boolean') fail('sample must be a boolean');
        board = op.sample ? seedBoard() : emptyBoard(op.title ?? '新しい作戦ボード');
        if (op.title !== undefined) board.title = op.title;
        summaries.push(op.sample ? 'サンプルを読み込み' : '新しいボードを作成'); break;
      case 'board.import': {
        keys(op, ['type', 'board'], 'operation');
        board = structuredClone(validateBoard(op.board));
        summaries.push('ボードを読み込み'); break;
      }
      case 'screen.add': {
        keys(op, ['type', 'screen'], 'operation'); keys(op.screen ?? {}, screenFields, 'screen');
        checkBehaviorChanges(op.screen);
        if (Array.isArray(op.screen?.nodes)) op.screen.nodes.forEach(checkBehaviorChanges);
        checkFixedAppearance(op.screen ?? {}, { background: SCREEN_BACKGROUND });
        const screen = createScreen(op.screen); board.screens.push(screen); created.push(screen.id);
        if (board.screens.length === 1) board.startScreenId = screen.id;
        summaries.push(`「${screen.name}」を追加`); break;
      }
      case 'screen.update': {
        keys(op, ['type', 'id', 'changes'], 'operation'); keys(op.changes, screenFields.filter(key => !['id', 'nodes'].includes(key)), 'screen changes');
        const found = locate(board, op.id); if (found.kind !== 'screen') fail('Expected screen id');
        checkBehaviorChanges(op.changes);
        checkFixedAppearance(op.changes, { background: SCREEN_BACKGROUND });
        Object.assign(found.item, op.changes); summaries.push(`画面「${found.item.name}」を更新`); break;
      }
      case 'node.add': {
        keys(op, ['type', 'screenId', 'node'], 'operation'); keys(op.node, nodeFields, 'node');
        checkBehaviorChanges(op.node);
        checkFixedAppearance(op.node, NODE_STYLES[op.node.type] ?? {});
        const found = locate(board, op.screenId); if (found.kind !== 'screen') fail('Expected screen id');
        const node = createNode(op.node.type, op.node); found.screen.nodes.push(node); created.push(node.id);
        summaries.push(`「${node.label.slice(0, 24) || node.type}」を追加`); break;
      }
      case 'node.update': {
        keys(op, ['type', 'id', 'changes'], 'operation'); keys(op.changes, nodeFields.filter(key => !['id', 'type'].includes(key)), 'node changes');
        const found = locate(board, op.id); if (found.kind !== 'node') fail('Expected node id');
        checkBehaviorChanges(op.changes);
        checkFixedAppearance(op.changes, NODE_STYLES[found.item.type]);
        Object.assign(found.item, op.changes); summaries.push(`「${found.item.label.slice(0, 24) || found.item.type}」を更新`); break;
      }
      case 'node.reparent': {
        keys(op, ['type', 'id', 'parentId'], 'operation');
        const found = locate(board, op.id); if (found.kind !== 'node' || found.item.type === 'card') fail('Choose a non-card part');
        const position = nodePosition(found.screen, found.item);
        const parent = op.parentId === null ? null : found.screen.nodes.find(node => node.id === op.parentId);
        if (op.parentId !== null && (!parent || parent.type !== 'card' || parent.parentId)) fail('Choose a root card in the same screen');
        Object.assign(found.item, { parentId: op.parentId, x: position.x - (parent?.x ?? 0), y: position.y - (parent ? parent.y + REGION_HEADER : 0), fixed: 'none' });
        summaries.push('部品の所属先を変更'); break;
      }
      case 'item.duplicate': {
        keys(op, ['type', 'id', 'name'], 'operation');
        const found = locate(board, op.id);
        if (found.kind === 'screen') {
          const copy = structuredClone(found.screen), previousId = copy.id;
          copy.id = id('screen'); copy.name = op.name ?? `${copy.name} のコピー`;
          copy.x = Math.max(...board.screens.map(screen => screen.x + screen.width)) + 110;
          const nodeIds = new Map(copy.nodes.map(node => [node.id, id('node')]));
          copy.nodes.forEach(node => { node.id = nodeIds.get(node.id); if (node.parentId) node.parentId = nodeIds.get(node.parentId); if (node.targetScreenId === previousId) node.targetScreenId = copy.id; });
          board.screens.push(copy); created.push(copy.id, ...copy.nodes.map(node => node.id));
        } else {
          if (op.name !== undefined) fail('name applies to screens only');
          const copy = { ...found.item, id: id('node'), x: found.item.x + 16, y: found.item.y + 16 };
          found.screen.nodes.push(copy); created.push(copy.id);
          if (found.item.type === 'card') for (const child of found.screen.nodes.filter(node => node.parentId === found.item.id)) { const duplicate = { ...child, id: id('node'), parentId: copy.id }; found.screen.nodes.push(duplicate); created.push(duplicate.id); }
        }
        summaries.push('選択した項目を複製'); break;
      }
      case 'node.layer': {
        keys(op, ['type', 'id', 'position'], 'operation');
        if (!['front', 'back'].includes(op.position)) fail('position must be front or back');
        const found = locate(board, op.id); if (found.kind !== 'node') fail('Expected node id');
        found.screen.nodes = found.screen.nodes.filter(node => node.id !== op.id);
        found.screen.nodes[op.position === 'front' ? 'push' : 'unshift'](found.item);
        summaries.push(op.position === 'front' ? '部品を前面へ移動' : '部品を背面へ移動'); break;
      }
      case 'nodes.layout': {
        keys(op, ['type', 'ids', 'mode'], 'operation');
        if (!Array.isArray(op.ids) || op.ids.length < 2 || new Set(op.ids).size !== op.ids.length) fail('Select at least two distinct nodes');
        const found = op.ids.map(itemId => locate(board, itemId));
        if (found.some(item => item.kind !== 'node' || item.screen.id !== found[0].screen.id)) fail('Nodes must belong to the same screen');
        if (found.some(item => (item.item.parentId ?? null) !== (found[0].item.parentId ?? null))) fail('Nodes must belong to the same region');
        const nodes = found.map(item => item.item);
        const left = Math.min(...nodes.map(node => node.x)), right = Math.max(...nodes.map(node => node.x + node.width));
        const top = Math.min(...nodes.map(node => node.y)), bottom = Math.max(...nodes.map(node => node.y + node.height));
        if (['left', 'center', 'right', 'top', 'middle', 'bottom'].includes(op.mode)) {
          for (const node of nodes) Object.assign(node, op.mode === 'left' ? { x: left } : op.mode === 'center' ? { x: (left + right - node.width) / 2 } : op.mode === 'right' ? { x: right - node.width } : op.mode === 'top' ? { y: top } : op.mode === 'middle' ? { y: (top + bottom - node.height) / 2 } : { y: bottom - node.height });
        } else if (['horizontal', 'vertical'].includes(op.mode)) {
          if (nodes.length < 3) fail('Spacing requires at least three nodes');
          const axis = op.mode === 'horizontal' ? 'x' : 'y', size = axis === 'x' ? 'width' : 'height';
          nodes.sort((a, b) => a[axis] - b[axis]);
          const end = nodes.at(-1)[axis] + nodes.at(-1)[size];
          const gap = (end - nodes[0][axis] - nodes.reduce((total, node) => total + node[size], 0)) / (nodes.length - 1);
          let position = nodes[0][axis]; for (const node of nodes) { node[axis] = position; position += node[size] + gap; }
        } else fail('Unknown layout mode');
        summaries.push('部品を整列'); break;
      }
      case 'item.remove': {
        keys(op, ['type', 'id'], 'operation');
        const found = locate(board, op.id);
        if (found.kind === 'screen') {
          board.screens = board.screens.filter(screen => screen.id !== op.id);
          if (board.startScreenId === op.id) board.startScreenId = board.screens[0]?.id ?? null;
          for (const screen of board.screens) for (const node of screen.nodes) if (node.targetScreenId === op.id) node.targetScreenId = null;
        } else found.screen.nodes = found.screen.nodes.filter(node => node.id !== op.id && node.parentId !== op.id);
        summaries.push(`「${found.item.name ?? found.item.label ?? op.id}」を削除`); break;
      }
      default: fail(`Unknown operation: ${op.type}`);
    }
  }
  board.revision = current.revision;
  validateBoard(board);
  return { board: withFixedAppearance(board), created, summary: summaries.join(' / ') };
}
export function describeBoard(board) {
  return {
    id: board.id, title: board.title, revision: board.revision, startScreenId: board.startScreenId ?? board.screens[0]?.id ?? null,
    screens: board.screens.map(screen => ({
      id: screen.id, name: screen.name, x: screen.x, y: screen.y, width: screen.width, height: screen.height, note: screen.note, status: screen.status,
      legacyBehaviorNote: legacyBehaviorNotes(screen),
      nodes: screen.nodes.map(node => ({ id: node.id, type: node.type, label: node.label, note: node.note, status: node.status, targetScreenId: node.targetScreenId, parentId: node.parentId ?? null, legacyBehaviorNote: legacyBehaviorNotes(node) })),
    })),
  };
}
