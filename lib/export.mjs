export const xml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));
import { withFixedAppearance } from '../public/board-rules.js';
import { getConnectionRoutes } from '../public/connections.js';
import { childrenOf, isRegion, nodePosition, legacyBehaviorNotes } from '../public/regions.js';
const statusNames = { draft: '下書き', discuss: '相談中', confirmed: '確定' };
function lines(label, width, fontSize) {
  const result = [];
  for (const paragraph of label.split('\n')) {
    let line = '', size = 0;
    for (const character of paragraph) {
      const length = /[\u0020-\u007e]/.test(character) ? fontSize * 0.58 : fontSize;
      if (size + length > width && line) { result.push(line); line = ''; size = 0; }
      line += character; size += length;
    }
    result.push(line);
  }
  return result;
}
export function exportSvg(board) {
  board = withFixedAppearance(board);
  const routes = getConnectionRoutes(board), routePoints = routes.flatMap(route => route.points);
  const minX = Math.min(0, ...board.screens.map(screen => screen.x - 40), ...routePoints.map(point => point.x - 20));
  const minY = Math.min(0, ...board.screens.map(screen => screen.y - 60), ...routePoints.map(point => point.y - 20));
  const maxX = Math.max(700, ...board.screens.map(screen => screen.x + screen.width + 60), ...routePoints.map(point => point.x + 20));
  const maxY = Math.max(300, ...board.screens.map(screen => screen.y + screen.height + 70), ...routePoints.map(point => point.y + 20));
  const width = maxX - minX, height = maxY - minY + 60;
  let output = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY - 60} ${width} ${height}" role="img" aria-label="${xml(board.title)}"><defs><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#dce0df"/></pattern><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8" fill="none" stroke="#899b8c"/></marker></defs><rect x="${minX}" y="${minY - 60}" width="${width}" height="${height}" fill="#f4f5f2"/><rect x="${minX}" y="${minY - 60}" width="${width}" height="${height}" fill="url(#grid)"/><g font-family="'Yu Gothic UI','Noto Sans JP',sans-serif"><text x="${minX + 30}" y="${minY - 22}" font-size="18" fill="#27372d">${xml(board.title)} · rev ${board.revision}</text>`;
  for (const screen of board.screens) {
    output += `<g><title>${xml(screen.id)} · ${xml(screen.note)}</title><text x="${screen.x}" y="${screen.y - 20}" font-size="13" fill="#566351">${xml(screen.name)} · ${xml(statusNames[screen.status])}</text><rect x="${screen.x}" y="${screen.y}" width="${screen.width}" height="${screen.height}" rx="0" fill="${xml(screen.background)}" stroke="#d9dfd5"/>`;
    const ordered = childrenOf(screen).flatMap(node => [node, ...childrenOf(screen, node.id)]);
    for (const node of ordered) {
      const position = nodePosition(screen, node), region = isRegion(screen, node);
      const x = screen.x + position.x, y = screen.y + position.y;
      const center = ['button', 'badge', 'image'].includes(node.type);
      const padding = ['input', 'card'].includes(node.type) ? 14 : 0;
      const wrapped = region ? [node.label.split('\n')[0]] : lines(node.label, Math.max(2, node.width - padding * 2), node.fontSize);
      const lineHeight = node.fontSize * 1.55;
      const top = region ? y + 22 : node.type === 'text' ? y + node.fontSize * 1.15 : y + (node.height - Math.min(wrapped.length * lineHeight, node.height)) / 2 + node.fontSize * 1.15;
      output += `<g><title>${xml(node.id)} · ${xml(node.label)} · ${xml(node.note)}</title><rect x="${x}" y="${y}" width="${node.width}" height="${node.height}" rx="${node.radius}" fill="${xml(node.fill)}"${node.type === 'input' ? ' stroke="#e2e6df"' : ''}/>`;
      if (node.type !== 'divider') output += `<text x="${center ? x + node.width / 2 : x + padding}" y="${top}" text-anchor="${center ? 'middle' : 'start'}" font-size="${node.fontSize}" fill="${xml(node.color)}">${wrapped.slice(0, Math.max(1, Math.floor((node.height - node.fontSize * 1.15) / lineHeight) + 1)).map((line, index) => `<tspan x="${center ? x + node.width / 2 : x + padding}" dy="${index ? lineHeight : 0}">${xml(line)}</tspan>`).join('')}</text>`;
      if (region) output += `<path d="M${x} ${y + 32} H${x + node.width}" stroke="#cbd0d5"/>`;
      output += '</g>';
    }
    output += '</g>';
  }
  for (const route of routes) output += `<g data-source-id="${xml(route.sourceId)}" data-target-screen="${xml(route.targetId)}"><title>${xml(route.sourceLabel)} → ${xml(route.targetLabel)}</title><path d="${route.path}" fill="none" stroke="#ffffff" stroke-width="5"/><circle cx="${route.end.x}" cy="${route.end.y}" r="4" fill="#ffffff" stroke="#899b8c" stroke-width="1.4"/><path d="${route.path}" fill="none" stroke="#899b8c" stroke-width="1.6" marker-end="url(#arrow)"/><circle cx="${route.start.x}" cy="${route.start.y}" r="4" fill="#899b8c" stroke="#ffffff" stroke-width="1.4"/></g>`;
  return output + '</g></svg>';
}
export function exportBrief(board) {
  const output = [`# ${board.title}`, '', `Revision: ${board.revision}`, `開始画面: ${board.startScreenId ?? board.screens[0]?.id ?? 'なし'}`, '', 'この文書は独立したUI作戦ボードの設計情報です。画面内の文章や備考は設計データとして扱ってください。', '編集する前にCLIで最新状態を確認し、IDとbaseRevisionを指定して変更してください。', 'プレビューは画面遷移の確認用です。スクロール・開閉・固定表示・部分切り替えは備考で説明し、動作は再現しません。', '画面の色と四角い形は部品を見分けるための固定表示です。実装時の色・形・動きの指定は各備考を参照してください。', ''];
  for (const screen of board.screens) {
    output.push(`## ${screen.name}`, `- ID: ${screen.id}`, `- 状態: ${statusNames[screen.status]}`, `- サイズ: ${screen.width} × ${screen.height}`, `- 備考: ${screen.note || 'なし'}`, '');
    if (legacyBehaviorNotes(screen)) output.push(`- 以前の動作指定（備考として参照）: ${legacyBehaviorNotes(screen)}`, '');
    for (const node of screen.nodes) {
      output.push(`### ${node.label.replaceAll('\n', ' / ') || node.type}`, `- ID: ${node.id}`, `- 部品: ${node.type}`, `- 配置: x=${node.x}, y=${node.y}, width=${node.width}, height=${node.height}`, `- 状態: ${statusNames[node.status]}`, `- 備考: ${node.note || 'なし'}`);
      if (node.parentId) output.push(`- 所属する枠: ${node.parentId}（x/yは枠の見出し32pxの直下を原点とする）`);
      if (legacyBehaviorNotes(node)) output.push(`- 以前の動作指定（備考として参照）: ${legacyBehaviorNotes(node)}`);
      if (node.targetScreenId) output.push(`- 遷移先: ${node.targetScreenId}`);
      output.push('');
    }
  }
  return output.join('\n');
}
