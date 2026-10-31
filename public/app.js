import { NODE_STYLES, SCREEN_BACKGROUND, SCREEN_PRESETS, screenPresetKey } from '/board-rules.js';
import { getConnectionRoutes } from '/connections.js';
import { childrenOf, isRegion, nodePosition, REGION_HEADER, legacyBehaviorNotes } from '/regions.js';
import { checkDesign } from '/design-checks.js';
import { scopeLayout, stepChanges } from '/editor-tools.js';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const shapes = {
  home: '<path d="m3 10 9-7 9 7v11h-6v-7H9v7H3V10Z"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/>', history: '<path d="M3 11a9 9 0 1 1 2.5 7M3 4v7h7M12 7v5l3 2"/>',
  terminal: '<path d="m5 7 5 5-5 5M13 17h6"/>', help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4.2 1.8c-1.5.8-1.7 1-1.7 2.7M12 17h.01"/>',
  cloud: '<path d="M7 18a5 5 0 1 1 .5-10A6 6 0 0 1 19 9a4.5 4.5 0 0 1-.5 9M9 14l2 2 4-4"/>', undo: '<path d="M3 10h10a6 6 0 0 1 0 12M3 10l6-6M3 10l6 6" transform="translate(0 -2)"/>',
  redo: '<path d="M21 8H11a6 6 0 0 0 0 12M21 8l-6-6M21 8l-6 6"/>', export: '<path d="M12 16V3m-4 4 4-4 4 4M5 13v7h14v-7"/>', play: '<path d="m8 4 12 8-12 8V4Z"/>',
  cursor: '<path d="m5 3 15 10-7 1-3 7L5 3Z"/>', hand: '<path d="M8 11V6a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-4a2 2 0 0 1 4 0v7c0 5-3 7-7 7-3 0-5-1-7-4l-3-5a2 2 0 0 1 3-2l2 3"/>',
  component: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17.5h7M17.5 14v7"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>', screen: '<rect x="4" y="2" width="16" height="20" rx="3"/><path d="M9 18h6"/>', route: '<circle cx="5" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M7 5h8a4 4 0 0 1 0 8H9a4 4 0 0 0 0 8h8"/>',
  fit: '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/>', note: '<path d="M4 3h16v13l-5 5H4V3Zm11 18v-5h5M8 8h8M8 12h6"/>', arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  text: '<path d="M4 5h16M12 5v15M8 20h8"/>', button: '<rect x="3" y="6" width="18" height="12" rx="4"/><path d="M9 12h6"/>', input: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M7 9v6"/>',
  card: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 14h10M7 17h6M3 10h18"/>', image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  badge: '<rect x="2" y="7" width="20" height="10" rx="5"/><path d="M8 12h8"/>', divider: '<path d="M3 12h18"/>', copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>', trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>', code: '<path d="m7 6-6 6 6 6M17 6l6 6-6 6M14 3l-4 18"/>', check: '<path d="m5 12 4 4L19 6"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] ?? shapes.component}</svg>`;
function hydrateIcons(container = document) { container.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); element.removeAttribute('data-icon'); }); }
hydrateIcons();
const typeNames = { text: 'テキスト', button: 'ボタン', input: '入力欄', card: '枠', image: '画像', badge: 'ラベル', divider: '区切り線' };

const state = { board: null, history: [], presence: {}, selection: null, online: false, zoom: .7, pan: { x: 35, y: 25 }, tool: 'select', space: false, showConnections: true, canUndo: false, canRedo: false, preview: [], pending: 0 };
let toastTimer, drag;
Object.assign(state, { documentId: null, selectedIds: [], changedIds: new Set() });
state.editScope = null; state.archived = false;
state.page = location.hash === '#board' ? 'board' : 'home';
let highlightTimer, viewportTimer;
const views = new Map();
function rememberView() {
  if (!state.documentId) return;
  const view = { pan: { ...state.pan }, zoom: state.zoom, selection: state.selection, scope: state.editScope };
  views.set(state.documentId, view);
  try { sessionStorage.setItem(`uiboard-view:${state.documentId}`, JSON.stringify(view)); } catch { /* Storage may be disabled. */ }
}
function restoreView() {
  if (state.page !== 'board') return;
  let view = views.get(state.documentId);
  try { view ??= JSON.parse(sessionStorage.getItem(`uiboard-view:${state.documentId}`)); } catch { /* Use fit instead. */ }
  if (view && Number.isFinite(view.pan?.x) && Number.isFinite(view.pan?.y) && view.zoom >= .15 && view.zoom <= 2) {
    state.pan = view.pan; state.zoom = view.zoom; state.selection = findItem(view.selection) ? view.selection : null;
    state.editScope = scopeLayout(state.board, view.scope) ? view.scope : null;
    state.selectedIds = state.selection ? [state.selection] : []; renderCanvas(); renderInspector(true);
  } else fitBoard(true);
  publishSelection();
}
function toast(message, error = false) {
  clearTimeout(toastTimer); const element = $('#toast'); element.textContent = message; element.classList.toggle('error', error); element.hidden = false;
  toastTimer = setTimeout(() => { element.hidden = true; }, error ? 6500 : 3500);
}
async function request(route, body) {
  let response;
  try { response = await fetch(route, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new Error('サーバーに接続できません。起動状態を確認してください。'); }
  const payload = await response.json();
  if (!response.ok) {
    const message = payload.archived ? 'このボードはアーカイブされています。ホームから復元してください。' : response.status === 409 && payload.currentRevision !== undefined ? 'ほかの操作でボードが更新されました。最新の内容を確認して、もう一度変更してください。' : payload.error;
    const error = new Error(message); error.status = response.status; throw error;
  }
  return payload;
}
function findItem(id = state.selection) {
  for (const screen of state.board?.screens ?? []) {
    if (screen.id === id) return { kind: 'screen', screen, item: screen };
    const item = screen.nodes.find(node => node.id === id); if (item) return { kind: 'node', screen, item };
  }
  return null;
}
function acceptSnapshot(snapshot, notify = false) {
  const oldBoard = state.board, switched = state.documentId !== snapshot.documentId;
  if (switched) {
    rememberView(); clearTimeout(viewportTimer); clearTimeout(highlightTimer); drag = null;
    $$('#inspector [data-field]').forEach(input => clearTimeout(input._saveTimer));
    state.selection = null; state.selectedIds = []; state.changedIds.clear(); state.editScope = null;
    $('#dialog').close(); $('#preview-dialog').close();
  }
  const oldRevision = state.board?.revision;
  Object.assign(state, { documentId: snapshot.documentId, board: snapshot.board, history: snapshot.history ?? state.history, presence: snapshot.presence ?? state.presence, canUndo: snapshot.canUndo, canRedo: snapshot.canRedo });
  state.archived = Boolean(snapshot.archived);
  if (state.archived) { state.page = 'home'; state.editScope = null; state.selection = null; state.selectedIds = []; drag = null; $('#dialog').close(); $('#preview-dialog').close(); location.hash = ''; }
  if (state.editScope && !scopeLayout(state.board, state.editScope)) state.editScope = null;
  if (!switched && notify && snapshot.event?.source === 'cli' && oldRevision !== snapshot.board.revision) {
    const before = new Map(oldBoard.screens.flatMap(screen => [[screen.id, screen], ...screen.nodes.map(node => [node.id, node])]));
    state.changedIds = new Set(snapshot.board.screens.flatMap(screen => [screen, ...screen.nodes]).filter(item => JSON.stringify(before.get(item.id)) !== JSON.stringify(item)).map(item => item.id));
    clearTimeout(highlightTimer); highlightTimer = setTimeout(() => { state.changedIds.clear(); renderCanvas(); }, 5000);
  }
  if (state.selection && !findItem()) state.selection = null;
  state.selectedIds = state.selectedIds.filter(id => findItem(id));
  render();
  if ($('#check-summary') && oldRevision !== snapshot.board.revision) showChecks();
  if (switched) restoreView();
  if (notify && snapshot.event?.source === 'cli' && oldRevision !== snapshot.board.revision) toast(`${snapshot.event.actor}：${snapshot.event.summary}`);
  if ($('#preview-dialog').open) renderPreview();
}
async function mutate(operations, { baseRevision = state.board.revision, documentId = state.documentId, action = 'apply' } = {}) {
  if (!state.online) { toast('再接続を待ってから編集してください。', true); return null; }
  state.pending++; renderStatus();
  try {
    const result = await request('/api/mutate', { documentId, baseRevision, operations, action, actor: '人間', source: 'ui' });
    if (result.documentId !== state.documentId) return null;
    if (result.board.revision >= state.board.revision) acceptSnapshot(result); return result;
  } catch (error) {
    toast(error.message, true);
    try { acceptSnapshot(await request('/api/state')); } catch { /* SSE will reconnect. */ }
    renderInspector(true); return null;
  } finally { state.pending--; renderStatus(); }
}
async function publishSelection(id = state.selection) {
  if (!state.board || state.page !== 'board' || state.archived) return;
  rememberView();
  const viewport = $('#viewport');
  const scope = scopeLayout(state.board, state.editScope);
  try { await request('/api/presence', { documentId: state.documentId, source: 'ui', actor: '人間', id, viewport: { x: -state.pan.x / state.zoom + (scope ? scope.worldOrigin.x - scope.x - scope.offset.x : 0), y: -state.pan.y / state.zoom + (scope ? scope.worldOrigin.y - scope.y - scope.offset.y : 0), width: viewport.clientWidth / state.zoom, height: viewport.clientHeight / state.zoom, zoom: state.zoom, ...(scope ? { scopeId: state.editScope.ownerId } : {}) } }); }
  catch { /* Selection is ephemeral. Edits still use revision checks. */ }
}
function publishViewport() {
  const selection = state.presence.human?.selection;
  return publishSelection(selection?.nodeId ?? selection?.screenId ?? null);
}
function selectItem(id, { publish = true, center = false, multiple = false } = {}) {
  if (id !== state.selection) {
    $$('#inspector [data-field]').filter(input => input._dirty).forEach(input => commitField(input));
  }
  const found = findItem(id);
  if (multiple && found?.kind === 'node') {
    const previous = state.selectedIds.filter(itemId => findItem(itemId)?.kind === 'node' && findItem(itemId).screen.id === found.screen.id && (findItem(itemId).item.parentId ?? null) === (found.item.parentId ?? null));
    state.selectedIds = previous.includes(id) ? previous.filter(itemId => itemId !== id) : [...previous, id];
    state.selection = state.selectedIds.at(-1) ?? null;
  } else { state.selection = id; state.selectedIds = id ? [id] : []; }
  renderCanvas(); renderInspector(true); renderStatus();
  if (publish) publishSelection(); if (center) centerItem(id);
}
function render() {
  $('#board-title').textContent = state.board.title;
  document.title = state.page === 'home' ? '作戦ボード' : `${state.board.title} — 作戦ボード`;
  $('#home').hidden = state.page !== 'home'; $('#editor').hidden = state.page !== 'board';
  renderHistory();
  if (state.page === 'board') { renderCanvas(); renderInspector(); } else renderHome();
  renderStatus();
}
function renderHistory() {
  const list = $('#history-list'); if (!list) return;
  list.innerHTML = state.history.length ? [...state.history].reverse().map(event => `<article class="history-entry"><div class="history-entry-top">${esc(event.actor)}</div><p>${esc(event.summary)}</p><small>${new Date(event.timestamp).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</small></article>`).join('') : '<p>まだ変更はありません。</p>';
}
function nodeHtml(node, { preview = false, screen, offset = { x: 0, y: 0 } } = {}) {
  const paint = NODE_STYLES[node.type];
  const style = `left:${node.x + offset.x}px;top:${node.y + offset.y}px;width:${node.width}px;height:${node.height}px;background-color:${paint.fill};color:${paint.color};font-size:${node.fontSize}px;border-radius:0;`;
  if (preview && node.type === 'input' && !node.targetScreenId) return `<input class="board-node node-input" style="${style}" placeholder="${esc(node.label)}" aria-label="${esc(node.label)}">`;
  const linked = node.targetScreenId ? ` data-target="${node.targetScreenId}"` : '';
  const selected = !preview && state.selectedIds.includes(node.id);
  if (screen && isRegion(screen, node)) {
    const children = childrenOf(screen, node.id);
    const header = `<div class="region-header" ${preview ? '' : 'role="button" tabindex="0"'} aria-label="枠 ${esc(node.label)}"><span>${esc(node.label)}</span></div>`;
    return `<div class="board-node node-card region-node ${selected ? 'selected' : ''}" data-node-id="${node.id}" style="${style}" role="group" aria-label="${esc(node.label)}">${header}<div class="region-body">${children.map(child => nodeHtml(child, { preview, screen })).join('')}</div>${selected ? `<span class="resize-handle" data-resize="${node.id}"></span>` : ''}</div>`;
  }
  return `<div class="board-node node-${node.type} ${selected ? 'selected' : ''}" data-node-id="${node.id}" style="${style}" tabindex="0" role="${preview && !linked ? 'group' : 'button'}" aria-label="${esc(node.label || typeNames[node.type])}"${linked}>${node.type === 'image' ? icon('image') : ''}<span class="node-label">${esc(node.label)}</span>${selected ? `<span class="resize-handle" data-resize="${node.id}"></span>` : ''}</div>`;
}
function renderCanvas() {
  const scope = scopeLayout(state.board, state.editScope);
  $('#scope-bar').hidden = !scope;
  if (scope) {
    $('#scope-title').textContent = scope.title; $('#empty-board').hidden = true;
    $('#screen-canvas').innerHTML = `<article class="artboard scope-artboard" data-screen-id="${scope.screen.id}" style="left:${scope.x}px;top:${scope.y}px;width:${scope.width}px"><div class="screen-bar"><strong>${esc(scope.title)}</strong></div><div class="screen-surface" data-surface="${scope.screen.id}" style="width:${scope.width}px;height:${scope.height}px;background:${SCREEN_BACKGROUND}">${scope.nodes.map(node => nodeHtml(node, { screen: scope.screen, offset: scope.offset })).join('')}</div></article>`;
    renderConnections(); transformWorld(); return;
  }
  $('#empty-board').hidden = state.board.screens.length > 0;
  const selected = findItem();
  $('#screen-canvas').innerHTML = state.board.screens.map(screen => `<article class="artboard ${selected?.screen.id === screen.id ? 'selected-screen' : ''}" data-screen-id="${screen.id}" style="left:${screen.x}px;top:${screen.y}px;width:${screen.width}px"><div class="screen-bar" data-drag-screen="${screen.id}" tabindex="0" role="button" aria-label="画面 ${esc(screen.name)}">${icon('screen')}<strong>${esc(screen.name)}${(state.board.startScreenId ?? state.board.screens[0]?.id) === screen.id ? ' · 開始' : ''}</strong></div><div class="screen-surface" data-surface="${screen.id}" style="width:${screen.width}px;height:${screen.height}px;background:${SCREEN_BACKGROUND}">${childrenOf(screen).map(node => nodeHtml(node, { screen })).join('')}</div>${screen.note ? `<div class="screen-caption">${icon('note')}<span>${esc(screen.note)}</span></div>` : ''}</article>`).join('');
  for (const id of state.changedIds) $(`[data-node-id="${id}"]`)?.classList.add('ai-changed');
  for (const id of state.changedIds) $(`[data-screen-id="${id}"]`)?.classList.add('ai-changed');
  renderConnections(); transformWorld();
}
function renderConnections(board = state.board) {
  const svg = $('#connections'); svg.toggleAttribute('hidden', !state.showConnections || Boolean(state.editScope));
  if (state.editScope) { svg.innerHTML = ''; return; }
  const routes = getConnectionRoutes(board), radius = 4 / state.zoom;
  let paths = `<defs>${[['normal', '#8e9d85'], ['active', '#526f3f']].map(([name, color]) => `<marker id="route-arrow-${name}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${8 / state.zoom}" markerHeight="${8 / state.zoom}" markerUnits="userSpaceOnUse" orient="auto"><path d="M1 1 L9 5 L1 9" fill="none" stroke="${color}" stroke-width="1.6"/></marker>`).join('')}</defs>`;
  const active = routes.find(route => route.sourceId === state.selection);
  if (active) {
    const target = board.screens.find(screen => screen.id === active.targetId);
    paths += `<rect class="connection-target" x="${target.x}" y="${target.y}" width="${target.width}" height="${target.height}" fill="none" stroke="#829b6d" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
  }
  paths += routes.map(route => {
    const selected = route.sourceId === state.selection, color = selected ? '#526f3f' : '#8e9d85';
    const description = `${route.sourceLabel.replaceAll('\n', ' ').replace(/\s*→\s*$/, '')} → ${route.targetLabel}`;
    return `<g class="connection-route ${selected ? 'active' : ''}" data-route-node="${route.sourceId}" data-route-target="${route.targetId}"><title>${esc(description)}</title><path d="${route.path}" fill="none" stroke="#ffffff" stroke-width="6" vector-effect="non-scaling-stroke"/><circle data-endpoint="target" cx="${route.end.x}" cy="${route.end.y}" r="${radius}" fill="#ffffff" stroke="${color}" stroke-width="1.5" vector-effect="non-scaling-stroke"/><path class="connection-line" d="${route.path}" fill="none" stroke="${color}" stroke-width="${selected ? 2.5 : 1.5}" vector-effect="non-scaling-stroke" marker-end="url(#route-arrow-${selected ? 'active' : 'normal'})"/><circle data-endpoint="source" cx="${route.start.x}" cy="${route.start.y}" r="${radius}" fill="${color}" stroke="#ffffff" stroke-width="1.5" vector-effect="non-scaling-stroke"/><path class="connection-hit" d="${route.path}" fill="none" stroke="transparent" stroke-width="14" vector-effect="non-scaling-stroke" tabindex="0" role="button" aria-label="遷移: ${esc(description)}"/></g>`;
  }).join('');
  svg.setAttribute('viewBox', '-20000 -20000 40000 40000'); svg.innerHTML = paths;
}
function transformWorld() {
  $('#world').style.transform = `translate(${state.pan.x}px,${state.pan.y}px) scale(${state.zoom})`;
  $('#world').style.setProperty('--handle-scale', String(1 / state.zoom));
  $('#viewport').style.backgroundSize = `${20 * state.zoom}px ${20 * state.zoom}px`;
  $('#viewport').style.backgroundPosition = `${state.pan.x}px ${state.pan.y}px`;
  clearTimeout(viewportTimer); viewportTimer = setTimeout(publishViewport, 200);
}
function setZoom(zoom, point) {
  const viewport = $('#viewport'); const anchor = point ?? { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
  const next = Math.max(.15, Math.min(2, zoom));
  state.pan.x = anchor.x - (anchor.x - state.pan.x) * next / state.zoom;
  state.pan.y = anchor.y - (anchor.y - state.pan.y) * next / state.zoom;
  state.zoom = next; transformWorld(); renderConnections();
}
function fitBoard(initial = false, targetId = null) {
  if (!state.board.screens.length) return;
  const viewport = $('#viewport');
  const scope = scopeLayout(state.board, state.editScope);
  if (scope) {
    const found = targetId ? findItem(targetId) : null;
    const pos = found?.kind === 'node' ? (scope.region ? found.item : nodePosition(scope.screen, found.item)) : null;
    const box = pos ? { x: scope.x + scope.offset.x + pos.x - 32, y: scope.y + scope.offset.y + pos.y - 40, width: found.item.width + 64, height: found.item.height + 80 } : scope;
    const usableWidth = viewport.clientWidth - (viewport.clientWidth > 700 && findItem() ? 300 : 0);
    state.zoom = Math.max(.15, Math.min(.9, (usableWidth - 80) / box.width, (viewport.clientHeight - 140) / box.height));
    state.pan = { x: usableWidth / 2 - (box.x + box.width / 2) * state.zoom, y: viewport.clientHeight / 2 - (box.y + box.height / 2) * state.zoom };
    transformWorld(); return;
  }
  const screens = targetId && findItem(targetId) ? [findItem(targetId).screen] : initial && viewport.clientWidth < 520 ? [findItem()?.screen ?? state.board.screens[0]] : state.board.screens;
  const bounds = { x: Math.min(...screens.map(screen => screen.x)), y: Math.min(...screens.map(screen => screen.y)) - 75 };
  bounds.width = Math.max(...screens.map(screen => screen.x + screen.width)) - bounds.x;
  bounds.height = Math.max(...screens.map(screen => screen.y + screen.height + 35)) - bounds.y;
  state.zoom = Math.max(.15, Math.min(.9, (viewport.clientWidth - 50) / bounds.width, (viewport.clientHeight - 100) / bounds.height));
  state.pan = { x: (viewport.clientWidth - bounds.width * state.zoom) / 2 - bounds.x * state.zoom, y: (viewport.clientHeight - bounds.height * state.zoom) / 2 - bounds.y * state.zoom - 15 };
  transformWorld(); renderConnections();
}
function centerItem(id) {
  const found = findItem(id); if (!found) return;
  const viewport = $('#viewport'); const { screen, item, kind } = found;
  if (state.editScope && kind === 'node') { fitBoard(false, id); return; }
  const position = kind === 'node' ? nodePosition(screen, item) : { x: 0, y: 0 };
  const x = screen.x + (kind === 'node' ? position.x + item.width / 2 : screen.width / 2);
  const y = screen.y + (kind === 'node' ? position.y + item.height / 2 : screen.height / 2);
  state.pan = { x: viewport.clientWidth / 2 - x * state.zoom, y: viewport.clientHeight / 2 - y * state.zoom }; transformWorld();
}
function renderInspector(force = false) {
  const inspector = $('#inspector');
  const found = findItem();
  inspector.hidden = !found;
  if (!found) { inspector.innerHTML = ''; return; }
  if (state.selectedIds.length > 1) {
    inspector.innerHTML = `<div class="inspector-heading"><span>${state.selectedIds.length}個の部品</span><button class="icon-button" data-action="close-inspector" aria-label="編集を閉じる">${icon('close')}</button></div><div class="layout-options">${[['left', '左揃え'], ['center', '左右中央'], ['right', '右揃え'], ['top', '上揃え'], ['middle', '上下中央'], ['bottom', '下揃え'], ['horizontal', '横に等間隔'], ['vertical', '縦に等間隔']].map(([mode, label]) => `<button class="button subtle" data-layout="${mode}" ${['horizontal', 'vertical'].includes(mode) && state.selectedIds.length < 3 ? 'disabled' : ''}>${label}</button>`).join('')}</div><button class="button subtle" data-action="delete">選択した部品を削除</button>`;
    return;
  }
  if (!force && inspector.dataset.itemId === found.item.id && inspector.contains(document.activeElement)) {
    inspector.querySelectorAll('[data-field]').forEach(input => {
      if (input._dirty || input._saving) return;
      input.value = input.dataset.field === 'preset' ? screenPresetKey(found.item) : found.item[input.dataset.field] ?? '';
      input._baseRevision = state.board.revision;
    });
    return;
  }
  const { kind, item } = found;
  const openSections = inspector.dataset.itemId === item.id ? [...inspector.querySelectorAll('details[open] summary')].map(summary => summary.textContent) : [];
  inspector.dataset.itemId = item.id;
  inspector.innerHTML = `<div class="inspector-heading"><span>${kind === 'node' ? typeNames[item.type] : '画面'}</span><button class="icon-button" data-action="duplicate" aria-label="複製" title="複製 Ctrl+D">${icon('copy')}</button><button class="icon-button" data-action="delete" aria-label="${kind === 'node' ? '部品' : '画面'}を削除" title="削除">${icon('trash')}</button><button class="icon-button" data-action="close-inspector" aria-label="編集を閉じる">${icon('close')}</button></div>
    <label for="item-label">${kind === 'node' ? '文字' : '画面の名前'}</label>${kind === 'node' ? `<textarea id="item-label" data-field="label" aria-label="文字" rows="2" maxlength="2000">${esc(item.label)}</textarea>` : `<input id="item-label" data-field="name" aria-label="画面の名前" value="${esc(item.name)}" maxlength="200">`}
    ${kind === 'screen' ? `<label for="item-preset">画面サイズ</label><select id="item-preset" data-field="preset" aria-label="画面サイズ">${!screenPresetKey(item) ? '<option value="" disabled selected>サイズを選択</option>' : ''}${Object.entries(SCREEN_PRESETS).map(([key, preset]) => `<option value="${key}" ${screenPresetKey(item) === key ? 'selected' : ''}>${preset.label}</option>`).join('')}</select>` : ''}
    <label for="item-note">備考</label><textarea id="item-note" class="note-field" data-field="note" aria-label="備考" placeholder="表示する内容、押したときの変化など&#10;色・スクロール・固定表示の希望もここへ" rows="4" maxlength="4000">${esc(item.note)}</textarea>
    ${kind === 'node' ? `${item.type === 'card' && isRegion(found.screen, item) ? '' : `<label for="item-target">押したら</label><select id="item-target" data-field="targetScreenId" aria-label="押したら"><option value="">移動しない</option>${state.board.screens.map(screen => `<option value="${screen.id}" ${item.targetScreenId === screen.id ? 'selected' : ''}>${esc(screen.name)}へ</option>`).join('')}</select>`}<details class="extra-options"><summary>重なり順</summary><button class="button subtle" data-layer="front">前面へ</button><button class="button subtle" data-layer="back">背面へ</button></details>` : ''}`;
  const legacy = legacyBehaviorNotes(item);
  if (legacy) inspector.insertAdjacentHTML('beforeend', `<p class="inspector-hint">以前の指定（備考として参照）：${esc(legacy)}。動作の再現は行いません。</p>`);
  inspector.insertAdjacentHTML('beforeend', behaviorInspector(found));
  inspector.insertAdjacentHTML('beforeend', itemTools(found));
  inspector.querySelectorAll('details').forEach(details => { details.open = openSections.includes(details.querySelector('summary').textContent); });
}
function behaviorInspector({ kind, screen, item }) {
  if (kind === 'screen') return `<button class="button subtle parts-entry" data-action="start-here" ${(state.board.startScreenId ?? state.board.screens[0]?.id) === item.id ? 'disabled' : ''}>${(state.board.startScreenId ?? state.board.screens[0]?.id) === item.id ? 'ここから開始します' : 'ここから始める'}</button>`;
  if (item.type === 'card') return '';
  return `<details class="extra-options"><summary>所属する枠</summary><label for="item-parent">所属する枠</label><select id="item-parent" data-field="parentId" aria-label="所属する枠"><option value="">画面に直接置く</option>${screen.nodes.filter(node => node.type === 'card' && !node.parentId && node.height > REGION_HEADER).map(node => `<option value="${node.id}" ${item.parentId === node.id ? 'selected' : ''}>${esc(node.label || '枠')}</option>`).join('')}</select></details>`;
}
function itemTools({ kind, screen, item }) {
  const count = kind === 'screen' ? screen.nodes.length : item.type === 'card' ? childrenOf(screen, item.id).length : null;
  const movement = [['left', '←', '左へ移動'], ['up', '↑', '上へ移動'], ['down', '↓', '下へ移動'], ['right', '→', '右へ移動']].map(([action, text, label]) => `<button class="button subtle" data-adjust="${action}" aria-label="${label}">${text}</button>`).join('');
  const size = [['narrower', '幅を狭める'], ['wider', '幅を広げる'], ['shorter', '高さを減らす'], ['taller', '高さを増やす']].map(([action, label]) => `<button class="button subtle" data-adjust="${action}">${label}</button>`).join('');
  return `${count !== null ? `<button class="button subtle parts-entry" data-action="parts-list">${kind === 'screen' ? '部品一覧' : '中身'} ${count}件</button>` : ''}<details class="extra-options"><summary>${kind === 'screen' ? '移動' : '移動・大きさ'}</summary><div class="step-controls">${movement}</div>${kind === 'node' ? `<div class="layout-options">${size}</div>` : ''}</details>`;
}
async function adjustSelected(action) {
  await flushEditor(); const found = findItem(); if (!found) return;
  if (state.editScope?.ownerId === found.item.id) await leaveScope();
  const changes = stepChanges(found.item, found.kind, action, { region: found.kind === 'node' && isRegion(found.screen, found.item) }); if (!changes) return;
  await mutate([{ type: `${found.kind}.update`, id: found.item.id, changes }]);
}
function enterScope(ownerId) {
  const owner = findItem(ownerId); if (!owner) return;
  const previousView = state.editScope?.previousView ?? { pan: { ...state.pan }, zoom: state.zoom };
  const scope = { ownerId, screenId: owner.screen.id, previousView };
  const layout = scopeLayout(state.board, scope); if (!layout) return;
  scope.offset = layout.offset; state.editScope = scope;
}
async function navigateToItem(id, { publish = true } = {}) {
  await flushEditor(); const found = findItem(id); if (!found || state.archived) return;
  closeDialog();
  if (found.kind === 'node') enterScope(found.item.parentId ?? found.screen.id);
  else state.editScope = null;
  selectItem(id, { publish, center: true });
}
async function leaveScope() {
  await flushEditor(); const scope = state.editScope; if (!scope) return;
  state.editScope = null;
  if (scope.previousView) { state.pan = scope.previousView.pan; state.zoom = scope.previousView.zoom; }
  selectItem(findItem(scope.ownerId)?.item.id ?? null);
}
function showParts(ownerId = null) {
  const owner = ownerId ? findItem(ownerId) : null;
  const screens = owner ? [owner.screen] : state.board.screens;
  const rows = screens.flatMap(screen => {
    const nodes = owner?.kind === 'node' && owner.item.type === 'card' ? childrenOf(screen, owner.item.id) : childrenOf(screen).flatMap(node => [node, ...childrenOf(screen, node.id)]);
    return nodes.map(node => { const parent = screen.nodes.find(parent => parent.id === node.parentId); return `<button type="button" class="part-row" data-select-part="${node.id}" data-search="${esc(`${node.label} ${typeNames[node.type]} ${screen.name} ${node.id}`.toLocaleLowerCase())}"><span><strong>${esc(node.label.replaceAll('\n', ' ') || typeNames[node.type])}</strong><small>${esc(screen.name)}${parent ? ` / ${esc(parent.label || '枠')}` : ''} · ${typeNames[node.type]}</small></span>${icon('arrow')}</button>`; });
  });
  openDialog(owner?.kind === 'node' ? `${owner.item.label || '枠'}の中身` : '部品一覧', `<label for="part-search">部品を探す</label><input id="part-search" type="search" placeholder="名前で絞り込む"><div class="part-list">${rows.join('') || '<p>まだ部品がありません。「追加」から置けます。</p>'}</div><p id="parts-empty-filter" hidden>一致する部品がありません。</p>`, owner ? `<button type="button" class="button subtle" data-edit-owner="${owner.kind === 'node' && owner.item.type === 'card' ? owner.item.id : owner.screen.id}">中身だけ表示する</button><button type="button" class="button subtle" data-action="close-dialog">閉じる</button>` : '');
  $('#part-search').addEventListener('input', event => { const query = event.target.value.toLocaleLowerCase(); let shown = 0; $$('.part-row').forEach(row => { row.hidden = !row.dataset.search.includes(query); if (!row.hidden) shown++; }); $('#parts-empty-filter').hidden = shown > 0 || rows.length === 0; });
}
function showChecks() {
  const result = checkDesign(state.board);
  openDialog('設計をチェック', `<p>設計を変更せず、確認したい候補を表示します。別案や意図的な重なりなら、そのままで構いません。</p><div id="check-summary">${result.issueCount ? `要確認 ${result.issueCount}件${result.truncated ? '（先頭200件を表示）' : ''}` : '今回の点検項目では、要確認の候補はありません。'}</div><div class="check-list">${result.issues.map(issue => { const found = findItem(issue.itemId); return `<button type="button" class="check-entry" data-select-part="${issue.itemId}"><strong>${esc(found?.item.name ?? found?.item.label ?? '部品')}</strong><span>${esc(issue.reason)}</span></button>`; }).join('')}</div><p class="inspector-hint">すべての動作や見た目の正しさを保証する検査ではありません。</p>`);
}
function renderStatus() {
  const dirty = $$('#inspector [data-field]').some(input => input._dirty);
  const status = $('#saved-state');
  status.textContent = !state.online ? '未接続' : state.pending ? '保存中…' : dirty ? '編集中…' : '';
  status.classList.toggle('error', !state.online);
  $('#undo-button').disabled = !state.canUndo || !state.online;
  $$('[data-adjust]').forEach(button => { button.disabled = Boolean(state.pending || !state.online); });
  $('#home-status').textContent = state.online ? '' : '接続待ち…';
}
function setTool(tool) {
  state.tool = tool; $$('[data-tool]').forEach(button => button.classList.toggle('active', button.dataset.tool === tool));
  $('#viewport').classList.toggle('pan-mode', tool === 'pan' || state.space);
}
function closeDialog() { $('#dialog').close(); }
function openDialog(title, body, footer = '', onSubmit) {
  const dialog = $('#dialog');
  dialog.classList.remove('wide');
  if (dialog.open) dialog.close();
  $('#dialog-content').innerHTML = `<form id="dialog-form"><div class="dialog-header"><h2>${esc(title)}</h2><button type="button" class="icon-button" data-action="close-dialog" aria-label="閉じる">${icon('close')}</button></div><div class="dialog-body">${body}</div>${footer ? `<div class="dialog-footer">${footer}</div>` : ''}</form>`;
  $('#dialog-form').addEventListener('submit', async event => { event.preventDefault(); try { if (onSubmit) await onSubmit(new FormData(event.target)); } catch (error) { toast(error.message, true); } });
  dialog.showModal();
}
const cancelButton = '<button type="button" class="button subtle" data-action="close-dialog">キャンセル</button>';
function showNewBoard() {
  openDialog('新しい作戦ボード', '<p>今のボードは保存され、いつでも開き直せます。</p><label for="new-title">ボード名</label><input id="new-title" name="title" value="新しい作戦ボード" required maxlength="200" autofocus>', `${cancelButton}<button class="button primary" type="submit">ボードを作る</button>`, async form => {
    await manageBoard('create', { title: form.get('title') });
  });
}
async function flushEditor() {
  await Promise.all($$('#inspector [data-field]').filter(input => input._dirty).map(commitField));
  if (state.pending || $$('#inspector [data-field]').some(input => input._dirty)) throw new Error('入力の保存が終わってから、もう一度操作してください。');
}
async function manageBoard(action, extra = {}) {
  await flushEditor();
  if (action === 'open' && extra.targetId === state.documentId) { closeDialog(); showEditor(); return; }
  await request('/api/boards', { documentId: state.documentId, baseRevision: state.board.revision, action, ...extra });
  acceptSnapshot(await request('/api/state'));
  closeDialog(); showEditor();
}
async function showBoards() {
  const library = await request('/api/boards');
  openDialog('ボードを開く', `<div class="board-list">${library.boards.map(board => `<button type="button" class="export-option" data-open-board="${esc(board.documentId)}" ${board.documentId === state.documentId && state.page === 'board' ? 'disabled' : ''}><span><strong>${esc(board.title)}</strong><small>${board.screenCount}画面${board.documentId === state.documentId && state.page === 'board' ? ' · 開いています' : ''}</small></span></button>`).join('')}</div>`, '<button type="button" class="button subtle" data-action="save-as">別名で保存</button><button type="button" class="button primary" data-action="new-board">新しいボード</button>');
}
function showSaveAs() {
  openDialog('別名で保存', `<label for="copy-title">ボード名</label><input id="copy-title" name="title" value="${esc(state.board.title)} のコピー" required maxlength="200" autofocus>`, `${cancelButton}<button class="button primary" type="submit">保存</button>`, form => manageBoard('copy', { title: form.get('title') }));
}
async function renderHome() {
  try {
    const library = await request('/api/boards');
    $('#home-board-list').innerHTML = library.boards.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(board => `<article class="home-board-row"><button class="home-board" data-open-board="${esc(board.documentId)}"><span class="home-board-icon">${icon('screen')}</span><span><strong>${esc(board.title)}</strong><small>${board.screenCount}画面 · ${new Date(board.updatedAt).toLocaleDateString('ja-JP')}</small></span>${icon('arrow')}</button><details class="board-row-menu"><summary aria-label="${esc(board.title)}の操作">${icon('more')}</summary><button type="button" data-archive-board="${esc(board.documentId)}">アーカイブ</button></details></article>`).join('') || '<p>保存したボードはありません。「新規作成」か「アーカイブ済み」から始められます。</p>';
  } catch { $('#home-board-list').innerHTML = '<p>ボードに接続できません。サーバーの起動を確認してください。</p>'; }
}
async function showHome() {
  await flushEditor(); rememberView(); closeMenus(); $('#preview-dialog').close();
  state.page = 'home'; location.hash = ''; render();
}
function showEditor() {
  if (state.archived) { state.page = 'home'; location.hash = ''; render(); return; }
  const changed = state.page !== 'board'; state.page = 'board'; location.hash = 'board';
  render(); if (changed) restoreView();
}
async function manageLibrary(action, targetId) {
  await flushEditor();
  await request('/api/boards', { documentId: state.documentId, baseRevision: state.board.revision, action, targetId });
  acceptSnapshot(await request('/api/state'));
  if (action === 'restore') await showArchives();
  else { closeDialog(); state.page = 'home'; location.hash = ''; render(); toast('アーカイブしました。「アーカイブ済み」から戻せます。'); }
}
async function showArchives() {
  const library = await request('/api/boards?archived=true');
  openDialog('アーカイブ済み', `<p>設計と履歴を残して退避したボードです。復元すると通常の一覧へ戻ります。</p><div class="archive-list">${library.boards.map(board => `<article class="archive-row"><span><strong>${esc(board.title)}</strong><small>${board.screenCount}画面</small></span><button type="button" class="button subtle" data-restore-board="${esc(board.documentId)}" aria-label="${esc(board.title)}を復元">復元</button></article>`).join('') || '<p>アーカイブ済みのボードはありません。</p>'}</div>`, '<button type="button" class="button subtle" data-action="close-dialog">閉じる</button>');
}
window.addEventListener('hashchange', () => {
  const page = location.hash === '#board' ? 'board' : 'home';
  if (page === state.page || !state.board) return;
  if (page === 'board') showEditor(); else showHome().catch(error => { location.hash = 'board'; toast(error.message, true); });
});
function showHumanTutorial() {
  openDialog('人間向けチュートリアル', `<div class="tutorial-intro">まずは練習用ボードで試せます。今のボードは保存したまま残ります。</div><ol class="tutorial-steps"><li><strong>画面を置く</strong><p>「追加 → 画面」でPCかスマホを選びます。</p></li><li><strong>部品を並べる</strong><p>文字・ボタン・画像などを追加。ドラッグか「移動・大きさ」のボタンで調整します。見えない部品は「その他 → 部品一覧」から選べます。Shift+クリックで複数選択。</p></li><li><strong>備考で意図を書く</strong><p>色や形の希望は備考へ。動作は「操作：送信を押す／条件：未入力／結果：エラー表示」のように書けます。</p></li><li><strong>枠にまとめる</strong><p>部品の「所属する枠」を選ぶと、枠と一緒に移動・複製できます。枠の「中身」から一覧を開き、中身だけを表示して編集できます。スクロール・開閉・固定表示の希望は備考に書きます。</p></li><li><strong>つないで試す</strong><p>部品の「押したら」で遷移先を選びます。開始する画面で「ここから始める」を押してから「試す」。「試す」は画面遷移の確認用です。部分的な表示切り替えは、ボタン名と表示内容の対応を備考に書きます。「その他 → 設計をチェック」で見切れやつながりも確認できます。</p></li><li><strong>AIと一緒に直す</strong><p>ホームのAI向けチュートリアルから説明をコピーし、CodexやClaudeに依頼を添えて渡します。変更箇所は一時的に強調され、取り消しも使えます。使わなくなったボードはホームの「… → アーカイブ」で退避し、後から復元できます。</p></li></ol>`, '<button type="button" class="button subtle" data-action="close-dialog">閉じる</button><button type="button" class="button primary" data-action="practice">練習用ボードを作る</button>');
  $('#dialog').classList.add('wide');
}
async function showAiTutorial() {
  const tutorial = await request('/api/tutorial');
  openDialog('AI向けチュートリアル', `<p>この説明をCodexやClaudeのチャットへ貼り、末尾に変更したい内容を書いてください。CLIを実行できる同じPCのAI環境で使えます。</p><ol class="tutorial-steps compact"><li><strong>説明をコピー</strong><p>CLIの絶対パス・接続先・対象ボードを含めています。</p></li><li><strong>AIへ依頼を添えて渡す</strong><p>例：「選択した枠に素材一覧を置き、右上のボタンで効果一覧へ切り替わることを備考に書いて」</p></li><li><strong>画面で結果を確かめる</strong><p>AIのCLI編集が反映されます。画面遷移は「試す」、見た目や動きの意図は備考で確認します。</p></li></ol><label for="agent-prompt">AIに渡す説明</label><textarea id="agent-prompt" class="agent-prompt" readonly>${esc(tutorial.prompt)}</textarea>`, '<button type="button" class="button subtle" data-action="close-dialog">閉じる</button><button type="button" class="button primary" data-action="copy-agent-prompt">説明をコピー</button>');
  $('#dialog').classList.add('wide');
}
async function copyAgentPrompt() {
  const field = $('#agent-prompt');
  const button = $('#dialog [data-action="copy-agent-prompt"]');
  try { await navigator.clipboard.writeText(field.value); button.textContent = 'コピーしました'; }
  catch { field.focus(); field.select(); button.textContent = 'Ctrl / ⌘ + Cでコピー'; }
}
async function setStartScreen() {
  await flushEditor(); const screen = findItem()?.screen; if (!screen) return;
  if (await mutate([{ type: 'board.update', changes: { startScreenId: screen.id } }])) renderInspector(true);
}
function showImportBoard() {
  openDialog('JSONから開く', '<p>書き出したJSONを、新しいボードとして開きます。今のボードも残ります。</p><label for="home-import">ボードのJSONファイル</label><input type="file" id="home-import" accept=".json,application/json">');
  $('#home-import').addEventListener('change', async event => { const file = event.target.files[0]; if (!file) return; try { await manageBoard('import', { board: JSON.parse(await file.text()) }); } catch (error) { toast(error.message, true); } });
}
function showAddScreen() {
  openDialog('画面を追加', `<label for="screen-name">画面の名前</label><input id="screen-name" name="name" value="画面 ${state.board.screens.length + 1}" required maxlength="200" autofocus><fieldset class="screen-presets"><legend>画面サイズ</legend>${Object.entries(SCREEN_PRESETS).map(([key, preset], index) => `<label class="preset-option"><input type="radio" name="preset" value="${key}" ${index === 0 ? 'checked' : ''}><span>${preset.label}<small>${preset.width} × ${preset.height}</small></span></label>`).join('')}</fieldset>`, `${cancelButton}<button class="button primary" type="submit">追加</button>`, async form => {
    const x = state.board.screens.length ? Math.max(...state.board.screens.map(screen => screen.x + screen.width)) + 110 : 64;
    const preset = SCREEN_PRESETS[form.get('preset')];
    const result = await mutate([{ type: 'screen.add', screen: { name: form.get('name'), width: preset.width, height: preset.height, x, y: 100 } }]);
    if (result) { closeDialog(); state.editScope = null; selectItem(result.created[0]); fitBoard(false, result.created[0]); }
  });
}
async function addNode(type) {
  $('#parts-menu').hidden = true;
  if (type === 'card' && scopeLayout(state.board, state.editScope)?.region) { toast('枠の中に枠は置けません。ボードに戻って追加してください。'); return; }
  let screen = findItem()?.screen ?? state.board.screens[0];
  const operations = [];
  if (!screen) { screen = { id: `screen_${crypto.randomUUID().slice(0, 8)}`, height: SCREEN_PRESETS.pc.height, nodes: [] }; operations.push({ type: 'screen.add', screen: { id: screen.id, name: '画面 1', x: 64, y: 100 } }); }
  const selected = findItem();
  const parent = type !== 'card' && scopeLayout(state.board, state.editScope)?.region ? scopeLayout(state.board, state.editScope).region : type !== 'card' && selected?.kind === 'node' ? selected.item.type === 'card' ? selected.item : screen.nodes.find(node => node.id === selected.item.parentId) : null;
  operations.push({ type: 'node.add', screenId: screen.id, node: { type, ...(parent ? { parentId: parent.id, x: 16, y: 16 + childrenOf(screen, parent.id).length * 56, width: Math.max(2, Math.min(280, parent.width - 32)) } : { x: 26, y: Math.min(screen.height - 75, 80 + screen.nodes.length * 32) }) } });
  const result = await mutate(operations);
  if (result) { selectItem(result.created.at(-1)); if (operations.length > 1) fitBoard(); }
}
async function duplicate() {
  const found = findItem(); if (!found) return;
  await flushEditor();
  const result = await mutate([{ type: 'item.duplicate', id: found.item.id }]);
  if (result) { selectItem(result.created[0]); if (found.kind === 'screen') fitBoard(false, result.created[0]); }
}
function showExport() {
  openDialog('ボードを書き出す', `<p>今の設計をほかのAIやプロジェクトに渡せます。</p>${[['bundle', 'export', 'まとめて渡す', 'ZIP · 同じ版の画像・JSON・備考'], ['svg', 'image', 'ボードの画像', 'SVG · 配置と画面遷移を1枚に'], ['json', 'code', '編集用データ', 'JSON · 読み込みで復元できます'], ['brief', 'note', '設計メモ', 'Markdown · 部品ID、意図、画面遷移']].map(([format, symbol, title, description]) => `<a class="export-option" href="/api/export?format=${format}&amp;documentId=${state.documentId}" download>${icon(symbol)}<span><strong>${title}</strong><small>${description}</small></span></a>`).join('')}<button type="button" class="export-option" data-action="import">${icon('layers')}<span><strong>ボードを読み込む</strong><small>書き出したJSONファイルを開く</small></span></button><input type="file" id="import-file" accept=".json,application/json" hidden>`);
  $('#import-file').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try { const board = JSON.parse(await file.text()); const result = await mutate([{ type: 'board.import', board }]); if (result) { closeDialog(); selectItem(null); fitBoard(); toast('ボードを読み込みました。取り消しで戻せます。'); } }
    catch { toast('有効なボードJSONを選んでください。', true); }
  });
}
function showHistory() {
  openDialog('変更履歴', '<div id="history-list"></div>'); renderHistory();
}
function showShortcuts() {
  openDialog('使い方', `<p>部品を選んで、文字と備考を書く。移動や大きさはドラッグで決められます。</p>${[['ボードを移動', '余白をドラッグ'], ['部品の大きさ', '右下をドラッグ'], ['取り消す', 'Ctrl / ⌘ + Z'], ['複製する', 'Ctrl / ⌘ + D'], ['複数選択・整列', 'Shift + クリック'], ['削除する', 'Delete']].map(([name, key]) => `<div class="shortcut-row"><span>${name}</span><kbd>${key}</kbd></div>`).join('')}`);
}
function openPreview() {
  const first = state.board.screens.find(screen => screen.id === state.board.startScreenId) ?? state.board.screens[0];
  if (!first) { toast('プレビューする画面を追加してください。'); return; }
  state.preview = [first.id]; $('#preview-dialog').showModal(); renderPreview();
}
function renderPreview() {
  const screen = state.board.screens.find(candidate => candidate.id === state.preview.at(-1));
  if (!screen) { $('#preview-dialog').close(); return; }
  $('#preview-name').textContent = screen.name;
  const element = $('#preview-screen');
  element.style.width = `${screen.width}px`; element.style.height = `${screen.height}px`; element.style.background = SCREEN_BACKGROUND;
  element.innerHTML = childrenOf(screen).map(node => nodeHtml(node, { screen, preview: true })).join('');
  const stage = $('.preview-stage');
  const scale = Math.min(1, (stage.clientWidth - 40) / screen.width, (stage.clientHeight - 40) / screen.height);
  element.style.zoom = scale;
}
function closeMenus() {
  for (const name of ['parts', 'more']) { $(`#${name}-menu`).hidden = true; $(`#${name}-button`).setAttribute('aria-expanded', 'false'); }
}
const actions = {
  'new-board': showNewBoard, boards: showBoards, 'open-boards': showBoards, 'save-as': showSaveAs, 'add-screen': showAddScreen, home: showHome, 'human-tutorial': showHumanTutorial, 'ai-tutorial': showAiTutorial, 'copy-agent-prompt': copyAgentPrompt, practice: () => manageBoard('practice'), 'import-board': showImportBoard, 'start-here': setStartScreen, 'parts-list': () => showParts(findItem()?.kind === 'node' && findItem().item.type !== 'card' ? findItem().screen.id : state.selection), 'board-parts': () => showParts(), checks: showChecks, 'leave-scope': leaveScope, archives: showArchives,
  'rename-board': () => openDialog('ボード名', `<input name="title" aria-label="ボード名" value="${esc(state.board.title)}" maxlength="200" required autofocus>`, `${cancelButton}<button class="button primary" type="submit">保存</button>`, async form => { const result = await mutate([{ type: 'board.update', changes: { title: form.get('title') } }]); if (result) closeDialog(); }),
  undo: () => mutate(undefined, { action: 'undo' }), redo: () => mutate(undefined, { action: 'redo' }),
  history: showHistory, 'cli-help': showAiTutorial, shortcuts: showShortcuts, export: showExport,
  import: () => $('#import-file').click(),
  preview: openPreview, 'close-preview': () => $('#preview-dialog').close(), 'preview-back': () => { if (state.preview.length > 1) { state.preview.pop(); renderPreview(); } },
  'close-dialog': closeDialog, 'close-inspector': () => selectItem(null),
  parts: () => {
    const open = $('#parts-menu').hidden; closeMenus();
    $('#parts-menu').innerHTML = `<button data-action="add-screen">${icon('screen')}画面</button><div class="menu-divider"></div>${[['text', '文字'], ['button', 'ボタン'], ['input', '入力欄'], ['image', '画像'], ['card', '枠']].map(([type, name]) => `<button data-add-type="${type}">${icon(type)}${name}</button>`).join('')}`;
    $('#parts-menu').hidden = !open; $('#parts-button').setAttribute('aria-expanded', String(open));
  },
  more: () => {
    const open = $('#more-menu').hidden; closeMenus();
    $('#more-menu').innerHTML = [['board-parts', 'layers', '部品一覧'], ['checks', 'check', '設計をチェック'], ['boards', 'layers', 'ボードを開く'], ['rename-board', 'text', 'ボード名を変更'], ['history', 'history', '変更履歴'], ['export', 'export', '書き出す'], ['cli-help', 'terminal', 'AIとの接続'], ['shortcuts', 'help', '使い方']].map(([action, symbol, name]) => `<button data-action="${action}">${icon(symbol)}${name}</button>`).join('') + `<div class="menu-divider"></div><button data-action="redo" ${!state.canRedo ? 'disabled' : ''}>${icon('redo')}やり直す</button>`;
    $('#more-menu').hidden = !open; $('#more-button').setAttribute('aria-expanded', String(open));
  },
  fit: fitBoard, 'zoom-in': () => setZoom(state.zoom * 1.2), 'zoom-out': () => setZoom(state.zoom / 1.2),
  delete: async () => { if (state.selectedIds.length) await mutate(state.selectedIds.map(id => ({ type: 'item.remove', id }))); }, duplicate: () => duplicate(),
};
document.addEventListener('click', event => {
  for (const menu of $$('.board-row-menu[open]')) if (!menu.contains(event.target)) menu.open = false;
  const action = event.target.closest('[data-action]');
  if (action) {
    if (!['parts', 'more'].includes(action.dataset.action)) closeMenus();
    Promise.resolve(actions[action.dataset.action]?.()).catch(error => toast(error.message, true)); return;
  }
  const pick = event.target.closest('[data-select-part]'); if (pick) { navigateToItem(pick.dataset.selectPart).catch(error => toast(error.message, true)); return; }
  const editOwner = event.target.closest('[data-edit-owner]'); if (editOwner) { flushEditor().then(() => { closeDialog(); enterScope(editOwner.dataset.editOwner); selectItem(editOwner.dataset.editOwner); fitBoard(); }).catch(error => toast(error.message, true)); return; }
  const adjust = event.target.closest('[data-adjust]'); if (adjust) { adjustSelected(adjust.dataset.adjust).catch(error => toast(error.message, true)); return; }
  const archive = event.target.closest('[data-archive-board]'); if (archive) { manageLibrary('archive', archive.dataset.archiveBoard).catch(error => toast(error.message, true)); return; }
  const restore = event.target.closest('[data-restore-board]'); if (restore) { manageLibrary('restore', restore.dataset.restoreBoard).catch(error => toast(error.message, true)); return; }
  const board = event.target.closest('[data-open-board]'); if (board) { manageBoard('open', { targetId: board.dataset.openBoard }).catch(error => toast(error.message, true)); return; }
  const layer = event.target.closest('[data-layer]'); if (layer) { mutate([{ type: 'node.layer', id: state.selection, position: layer.dataset.layer }]); return; }
  const layout = event.target.closest('[data-layout]'); if (layout) { mutate([{ type: 'nodes.layout', ids: state.selectedIds, mode: layout.dataset.layout }]); return; }
  const part = event.target.closest('[data-add-type]'); if (part) { closeMenus(); addNode(part.dataset.addType); return; }
  if (!event.target.closest('.popover-wrap')) closeMenus();
});
$('#inspector').addEventListener('focusin', event => {
  if (event.target.matches('[data-field]')) { event.target._baseRevision = state.board.revision; event.target._documentId = state.documentId; event.target._itemId = state.selection; }
});
async function commitField(input) {
  if (!input.matches('[data-field]') || input._saving) return;
  clearTimeout(input._saveTimer);
  const found = findItem(input._itemId ?? state.selection); if (!found) return;
  const key = input.dataset.field;
  let value = input.dataset.valueType === 'boolean' ? input.value === 'true' : input.type === 'number' ? Number(input.value) : input.value;
  if (['targetScreenId', 'parentId'].includes(key) && value === '') value = null;
  const oldValue = found.item[key] ?? (key === 'parentId' ? null : undefined);
  const unchanged = key === 'preset' ? value === screenPresetKey(found.item) : value === oldValue;
  if (unchanged) { input._dirty = false; renderStatus(); return; }
  if (input.type === 'number' && input.value === '') return;
  const preset = key === 'preset' ? SCREEN_PRESETS[value] : null;
  if (key === 'preset' && (!preset || found.kind !== 'screen')) return;
  const changes = preset ? { width: preset.width, height: preset.height } : { [key]: value };
  const operations = key === 'parentId' ? [{ type: 'node.reparent', id: found.item.id, parentId: value }] : [{ type: `${found.kind}.update`, id: found.item.id, changes }];
  input._saving = true;
  const result = await mutate(operations, { baseRevision: input._baseRevision ?? state.board.revision, documentId: input._documentId ?? state.documentId });
  input._saving = false;
  if (result) { input._baseRevision = result.board.revision; input._dirty = input.value !== String(value ?? ''); renderInspector(key === 'parentId'); renderStatus(); if (preset) fitBoard(false, found.item.id); }
}
$('#inspector').addEventListener('change', event => commitField(event.target));
$('#inspector').addEventListener('focusout', event => commitField(event.target));
$('#inspector').addEventListener('input', event => {
  const input = event.target; if (!input.matches('[data-field]')) return;
  input._itemId ??= state.selection; input._baseRevision ??= state.board.revision; input._documentId ??= state.documentId;
  input._dirty = true; renderStatus();
  clearTimeout(input._saveTimer); input._saveTimer = setTimeout(() => commitField(input), 600);
});
$('#preview-screen').addEventListener('click', event => {
  const target = event.target.closest('[data-target]'); if (target) { state.preview.push(target.dataset.target); renderPreview(); }
});
$('#preview-screen').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { const target = event.target.closest('[data-target]'); if (target) { event.preventDefault(); state.preview.push(target.dataset.target); renderPreview(); } } });
$('#dialog').addEventListener('click', event => { if (event.target === $('#dialog')) closeDialog(); });
$('#viewport').addEventListener('pointerdown', event => {
  if (!state.board || ![0, 1].includes(event.button)) return;
  if (event.target.closest('[data-action]')) return;
  const connection = event.target.closest('[data-route-node]');
  if (connection && !state.space && state.tool !== 'pan' && event.button !== 1) { event.preventDefault(); selectItem(connection.dataset.routeNode); return; }
  const viewport = $('#viewport'); const nodeElement = event.target.closest('[data-node-id]'); const screenBar = event.target.closest('[data-drag-screen]');
  if (state.tool === 'pan' || state.space || event.button === 1) {
    drag = { kind: 'pan', startX: event.clientX, startY: event.clientY, x: state.pan.x, y: state.pan.y }; viewport.classList.add('dragging-pan');
  } else if (nodeElement || screenBar) {
    const targetId = nodeElement?.dataset.nodeId ?? screenBar.dataset.dragScreen;
    const found = findItem(targetId); const resize = Boolean(event.target.closest('[data-resize]'));
    drag = { kind: resize ? 'resize' : found.kind, id: targetId, original: { ...found.item }, revision: state.board.revision, startX: event.clientX, startY: event.clientY, moved: false };
    if (event.shiftKey && found.kind === 'node') { drag = null; selectItem(targetId, { multiple: true }); event.preventDefault(); return; }
    if (!state.selectedIds.includes(targetId)) selectItem(targetId);
    drag.documentId = state.documentId;
    drag.items = !resize && found.kind === 'node' ? state.selectedIds.map(id => ({ ...findItem(id).item })) : [];
  } else {
    const surface = event.target.closest('[data-surface]');
    selectItem(state.editScope ? null : surface?.dataset.surface ?? null);
    if (surface) return;
    drag = { kind: 'pan', startX: event.clientX, startY: event.clientY, x: state.pan.x, y: state.pan.y };
    viewport.classList.add('dragging-pan');
  }
  event.preventDefault(); viewport.setPointerCapture(event.pointerId);
});
function dragOffset(item) {
  const scope = scopeLayout(state.board, state.editScope);
  return scope && (scope.region ? item.parentId === scope.region.id : !item.parentId) ? scope.offset : { x: 0, y: 0 };
}
function updateDrag(event) {
  if (!drag) return;
  const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
  if (drag.kind === 'pan') { state.pan = { x: drag.x + dx, y: drag.y + dy }; transformWorld(); return; }
  if (Math.abs(dx) + Math.abs(dy) < 3 && !drag.moved) return;
  drag.moved = true;
  const snap = value => event.altKey ? Math.round(value) : Math.round(value / 4) * 4;
  const node = drag.kind === 'screen' ? $(`[data-screen-id="${drag.id}"]`) : $(`[data-node-id="${drag.id}"]`);
  if (!node) return;
  if (drag.kind === 'resize') {
    drag.changes = { width: Math.max(2, Math.min(2400, snap(drag.original.width + dx / state.zoom))), height: Math.max(2, Math.min(4000, snap(drag.original.height + dy / state.zoom))) };
    node.style.width = `${drag.changes.width}px`; node.style.height = `${drag.changes.height}px`;
  } else {
    const limit = drag.kind === 'screen' ? 20000 : 4800;
    drag.changes = { x: Math.max(-limit / (drag.kind === 'screen' ? 1 : 2), Math.min(limit, snap(drag.original.x + dx / state.zoom))), y: Math.max(drag.kind === 'screen' ? -20000 : -4000, Math.min(drag.kind === 'screen' ? 20000 : 8000, snap(drag.original.y + dy / state.zoom))) };
    const offset = dragOffset(drag.original);
    node.style.left = `${drag.changes.x + offset.x}px`; node.style.top = `${drag.changes.y + offset.y}px`;
  }
  const preview = structuredClone(state.board);
  const frame = preview.screens.find(screen => screen.id === (drag.kind === 'screen' ? drag.id : findItem(drag.id)?.screen.id));
  const item = drag.kind === 'screen' ? frame : frame?.nodes.find(node => node.id === drag.id);
  if (item) { Object.assign(item, drag.changes); renderConnections(preview); }
  if (drag.kind === 'node' && drag.items?.length > 1) {
    const deltaX = drag.changes.x - drag.original.x, deltaY = drag.changes.y - drag.original.y;
    for (const original of drag.items) {
      const item = frame.nodes.find(node => node.id === original.id);
      item.x = original.x + deltaX; item.y = original.y + deltaY;
      const element = $(`[data-node-id="${original.id}"]`), offset = dragOffset(original); element.style.left = `${item.x + offset.x}px`; element.style.top = `${item.y + offset.y}px`;
    }
    renderConnections(preview);
  }
}
$('#viewport').addEventListener('pointermove', updateDrag);
$('#viewport').addEventListener('pointerup', async event => {
  if (!drag) return;
  updateDrag(event); const finished = drag; drag = null; $('#viewport').classList.remove('dragging-pan');
  if ($('#viewport').hasPointerCapture(event.pointerId)) $('#viewport').releasePointerCapture(event.pointerId);
  if (finished.changes) {
    const operations = finished.kind === 'node' && finished.items?.length > 1 ? finished.items.map(item => ({ type: 'node.update', id: item.id, changes: { x: item.x + finished.changes.x - finished.original.x, y: item.y + finished.changes.y - finished.original.y } })) : [{ type: `${finished.kind === 'screen' ? 'screen' : 'node'}.update`, id: finished.id, changes: finished.changes }];
    await mutate(operations, { baseRevision: finished.revision, documentId: finished.documentId });
  } else if (finished.kind === 'node' && state.selectedIds.length > 1) selectItem(finished.id);
});
$('#viewport').addEventListener('pointercancel', () => { drag = null; $('#viewport').classList.remove('dragging-pan'); renderCanvas(); });
$('#viewport').addEventListener('dblclick', event => {
  const node = event.target.closest('[data-node-id]'); if (!node) return; selectItem(node.dataset.nodeId);
  const field = $('#inspector [data-field="label"]'); field?.focus(); field?.select();
});
$('#viewport').addEventListener('wheel', event => {
  event.preventDefault();
  if (event.ctrlKey || event.metaKey) { const rect = $('#viewport').getBoundingClientRect(); setZoom(state.zoom * Math.exp(-event.deltaY * .005), { x: event.clientX - rect.left, y: event.clientY - rect.top }); }
  else { state.pan.x -= event.shiftKey ? event.deltaY : event.deltaX; state.pan.y -= event.shiftKey ? 0 : event.deltaY; transformWorld(); }
}, { passive: false });
$('#viewport').addEventListener('keydown', event => {
  const connection = event.target.closest('[data-route-node]');
  if (connection && ['Enter', ' '].includes(event.key)) { event.preventDefault(); selectItem(connection.dataset.routeNode); return; }
  if (event.key === 'Enter') { const node = event.target.closest('[data-node-id]'); const screen = event.target.closest('[data-drag-screen]'); if (node || screen) { event.preventDefault(); selectItem(node?.dataset.nodeId ?? screen.dataset.dragScreen); } }
});
document.addEventListener('keydown', event => {
  if (event.defaultPrevented) return;
  const editing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable;
  if (state.page !== 'board' || editing || $('#dialog').open || $('#preview-dialog').open || !state.board) return;
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); actions[event.shiftKey ? 'redo' : 'undo'](); }
  else if (modifier && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicate().catch(error => toast(error.message, true)); }
  else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); actions.delete(); }
  else if (event.code === 'Space') { event.preventDefault(); state.space = true; setTool(state.tool); }
  else if (event.key.toLowerCase() === 'v' && !modifier) setTool('select');
  else if (event.key.toLowerCase() === 'h' && !modifier) setTool('pan');
  else if (event.key.startsWith('Arrow') && state.selection) {
    event.preventDefault(); const found = findItem(); const amount = event.shiftKey ? 8 : 1;
    const changes = event.key === 'ArrowLeft' ? { x: found.item.x - amount } : event.key === 'ArrowRight' ? { x: found.item.x + amount } : event.key === 'ArrowUp' ? { y: found.item.y - amount } : { y: found.item.y + amount };
    const delta = { x: (changes.x ?? found.item.x) - found.item.x, y: (changes.y ?? found.item.y) - found.item.y };
    mutate(state.selectedIds.map(id => { const item = findItem(id); return { type: `${item.kind}.update`, id, changes: { x: item.item.x + delta.x, y: item.item.y + delta.y } }; }));
  }
});
document.addEventListener('keyup', event => { if (event.code === 'Space') { state.space = false; setTool(state.tool); } });
window.addEventListener('blur', () => { state.space = false; setTool(state.tool); });
const events = new EventSource('/api/events');
events.onopen = () => { state.online = true; renderStatus(); };
events.onerror = () => { state.online = false; renderStatus(); };
events.addEventListener('sync', event => {
  acceptSnapshot(JSON.parse(event.data));
});
window.addEventListener('resize', () => { if ($('#preview-dialog').open) renderPreview(); publishViewport(); });
events.addEventListener('board', event => { acceptSnapshot(JSON.parse(event.data), true); });
events.addEventListener('presence', event => {
  const payload = JSON.parse(event.data); state.presence = payload.presence;
  if (state.page === 'board' && payload.source === 'cli' && payload.presence.ai?.selection) {
    const selection = payload.presence.ai.selection;
    navigateToItem(selection.nodeId ?? selection.screenId, { publish: false }).catch(error => toast(error.message, true));
    toast(`${payload.presence.ai.actor} がこの${selection.nodeId ? '部品' : '画面'}に注目しています。`);
  }
});
