export const REGION_HEADER = 32;
export const scrollMode = item => item.scroll ?? 'none';
export function isRegion(screen, node) {
  return node.type === 'card' && (node.collapsible || scrollMode(node) !== 'none' || screen.nodes.some(child => child.parentId === node.id));
}
export function nodePosition(screen, node) {
  const parent = node.parentId ? screen.nodes.find(candidate => candidate.id === node.parentId) : null;
  return { x: node.x + (parent?.x ?? 0), y: node.y + (parent ? parent.y + REGION_HEADER : 0) };
}
export function childrenOf(screen, parentId = null) {
  return screen.nodes.filter(node => (node.parentId ?? null) === parentId);
}
// Kept as readable design information for existing documents, never simulated.
export function legacyBehaviorNotes(item) {
  const notes = [];
  if (item.scroll === 'vertical') notes.push('縦スクロール');
  if (item.scroll === 'horizontal') notes.push('横スクロール');
  if (item.collapsible) notes.push(`見出しで折りたたみ（初期状態：${item.collapsed ? '閉じる' : '開く'}）`);
  if (item.fixed === 'top') notes.push('所属先の上に固定');
  if (item.fixed === 'bottom') notes.push('所属先の下に固定');
  return notes.join('／');
}
