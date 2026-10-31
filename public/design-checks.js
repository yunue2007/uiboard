import { childrenOf, isRegion, REGION_HEADER } from './regions.js';

// Advisory checks only: alternate screens and overlapping parts can be intentional.
export function checkDesign(board) {
  const issues = [], startScreenId = board.startScreenId ?? board.screens[0]?.id ?? null;
  const add = (code, screenId, itemId, reason, relatedIds = []) => issues.push({ id: `${code}:${itemId}`, severity: 'review', code, screenId, itemId, reason, relatedIds });
  const reached = new Set(), pending = startScreenId ? [startScreenId] : [];
  const screens = new Map(board.screens.map(screen => [screen.id, screen]));
  while (pending.length) {
    const id = pending.pop(); if (reached.has(id)) continue; reached.add(id);
    for (const node of screens.get(id)?.nodes ?? []) if (node.targetScreenId && !reached.has(node.targetScreenId)) pending.push(node.targetScreenId);
  }
  for (const screen of board.screens) {
    if (!reached.has(screen.id)) add('unreachable-screen', screen.id, screen.id, '開始画面から遷移をたどれません。別案の画面なら、そのままで構いません。');
    const owners = [screen, ...screen.nodes.filter(node => isRegion(screen, node))];
    for (const owner of owners) {
      const root = owner === screen, width = owner.width, height = owner.height - (root ? 0 : REGION_HEADER);
      for (const node of childrenOf(screen, root ? null : owner.id)) {
        if (node.x + node.width <= 0 || node.x >= width || node.y + node.height <= 0 || node.y >= height) {
          add('outside-owner', screen.id, node.id, '所属先の表示範囲から完全に外れています。意図した配置なら備考で説明してください。');
        }
      }
    }
  }
  const byCode = {}; for (const issue of issues) byCode[issue.code] = (byCode[issue.code] ?? 0) + 1;
  return { boardId: board.id, revision: board.revision, startScreenId, issueCount: issues.length, byCode, truncated: issues.length > 200, issues: issues.slice(0, 200) };
}
