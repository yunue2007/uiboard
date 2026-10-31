#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';
import { emptyBoard } from './lib/board.mjs';
import { SCREEN_PRESETS } from './public/board-rules.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const usage = `UIBOARD — 人間とCLIエージェントのUI作戦ボード

Usage: node cli.mjs <command> [options]

  serve [--port 4317] [--data file] [--empty]  ローカルUIとAPIを起動
  context                                    人間の選択とボードの概要
  get                                        ボード全体のJSON
  list                                       画面と部品の一覧
  boards                                     保存したボード一覧
  boards --archived                           アーカイブ済みのボード一覧
  archive <document-id> / restore <document-id> ボードを退避・復元
  check                                      設計上の要確認箇所（読み取りのみ）
  new-board --title 名前 / save-as --title 名前  ボード新規作成・コピー保存
  open <document-id>                         保存したボードを開く
  inspect <id>                               部品または画面の詳細
  focus <id>                                 UIでその部品に注目する
  add-screen --name 名前 [--preset pc|mobile] 画面を追加
  add <screen-id> <type> --label 文字          部品を追加
  set <id> --label 文字 --remarks 備考        指定した項目を変更
  link <node-id> <screen-id|none>              画面遷移を設定・解除
  remove <id>                                部品・画面を削除
  duplicate <id> [--name 名前] 画面・部品の複製
  layer <node-id> front|back                  前面へ・背面へ
  reparent <part-id> <region-id|none>         所属先を変更（表示位置を保持）
  start-screen <screen-id>                   試すときの開始画面
  tutorial                                   AI向け説明を取得
  layout left|center|right|top|middle|bottom|horizontal|vertical <id> <id> ...
  apply --file patch.json [--dry-run]         操作を一括適用（- で標準入力）
  import --file board.json                    書き出したボードを読み込み
  history [--since revision]                 UI・CLIの変更履歴
  undo / redo                               直前の操作を取り消し・やり直し
  export --format json|svg|brief|bundle [--out file] 設計を保存（bundleはZIP）
  reset [--title 名前] [--sample]             空のボード・サンプルを作成

Common: --url http://127.0.0.1:4317 --actor Codex --board document-id --revision N
Environment: UIBOARD_URL, UIBOARD_ACTOR
Node types: text, button, input, card, image, badge, divider
Status: draft, discuss, confirmed
Screen presets: pc (1280x800), mobile (390x844); set <screen-id> --preset ...
Implementation styling and behavior belong in --remarks / --note. Board colors and corners are fixed.
All successful reads/edits return JSON, except export without --out.
Edits use revision checks. On a conflict, read the board again; do not blindly retry.
`;
function parse(args) {
  const positional = [], options = {};
  const flags = new Set(['empty', 'sample', 'dry-run', 'help', 'archived']);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const key = arg.slice(2);
    if (flags.has(key)) { options[key] = true; continue; }
    if (index + 1 >= args.length || args[index + 1].startsWith('--')) throw new Error(`Missing value for --${key}`);
    options[key] = args[++index];
  }
  return { positional, options };
}
const numeric = new Set(['x', 'y', 'width', 'height', 'fontSize', 'radius']);
const optionFields = { 'font-size': 'fontSize', target: 'targetScreenId', remarks: 'note', parent: 'parentId' };
function changesFrom(options) {
  const changes = {};
  const common = ['url', 'actor', 'board', 'revision', 'file', 'out', 'format', 'since', 'dry-run', 'help', 'archived'];
  for (const [raw, value] of Object.entries(options)) {
    if (common.includes(raw)) continue;
    const key = optionFields[raw] ?? raw;
    if (['scroll', 'fixed', 'collapsible', 'collapsed'].includes(key)) throw new Error('Describe this behavior in --remarks / --note (備考); it is not simulated.');
    changes[key] = numeric.has(key) ? Number(value) : ['targetScreenId', 'parentId'].includes(key) && value === 'none' ? null : value;
  }
  return changes;
}
function required(value, name) { if (!value) throw new Error(`${name} is required`); return value; }
function screenChanges(options) {
  const { preset, ...changes } = changesFrom(options);
  if (preset !== undefined) {
    if (!Object.hasOwn(SCREEN_PRESETS, preset)) throw new Error('preset must be pc or mobile');
    Object.assign(changes, { width: SCREEN_PRESETS[preset].width, height: SCREEN_PRESETS[preset].height });
  }
  return changes;
}
async function readFile(filename) {
  if (filename !== '-') return fs.readFile(required(filename, '--file'), 'utf8');
  const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk); return Buffer.concat(chunks).toString('utf8');
}
async function main() {
  const { positional, options } = parse(process.argv.slice(2));
  const [command, targetId, type] = positional;
  if (options.variant !== undefined) throw new Error('Use duplicate, then describe the state in its name and --remarks / --note (備考).');
  if (!command || command === 'help' || options.help) { process.stdout.write(usage); return; }
  if (command === 'serve') {
    const port = Number(options.port ?? 4317);
    if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('port must be between 0 and 65535');
    const app = await startServer({ port, data: path.resolve(options.data ?? path.join(root, 'data', 'board.json')), initialBoard: options.empty ? emptyBoard() : undefined });
    console.log(`UIBOARD ready\nLocal: ${app.url}\nData: ${path.resolve(options.data ?? path.join(root, 'data', 'board.json'))}\nCLI: node cli.mjs context\nPress Ctrl+C to stop.`);
    let stopping = false;
    const shutdown = async () => { if (stopping) return; stopping = true; await app.close(); process.exit(0); };
    process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown); return;
  }
  const baseUrl = (options.url ?? process.env.UIBOARD_URL ?? 'http://127.0.0.1:4317').replace(/\/$/, '');
  const actor = options.actor ?? process.env.UIBOARD_ACTOR ?? 'AI';
  async function request(route, body) {
    let response;
    if (options.board) route += `${route.includes('?') ? '&' : '?'}documentId=${encodeURIComponent(options.board)}`;
    try { response = await fetch(baseUrl + route, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) } : { signal: AbortSignal.timeout(15000) }); }
    catch (error) { throw new Error(`Cannot reach UIBOARD at ${baseUrl}. Start it with: node cli.mjs serve (${error.cause?.code ?? error.name})`); }
    if (!response.ok) { const payload = await response.json(); const error = new Error(payload.error); error.details = payload; error.status = response.status; throw error; }
    return response;
  }
  const get = async route => (await request(route)).json();
  async function mutate(operations, extra = {}) {
    const { board, documentId } = await get('/api/state');
    const baseRevision = options.revision !== undefined ? Number(options.revision) : extra.baseRevision ?? board.revision;
    return (await request('/api/mutate', { documentId, ...extra, baseRevision, operations, actor, source: 'cli', dryRun: Boolean(options['dry-run']) })).json();
  }
  let result;
  switch (command) {
    case 'get': result = await get('/api/board'); break;
    case 'list': result = (await get('/api/context')).board; break;
    case 'context': result = await get('/api/context'); break;
    case 'boards': result = await get(`/api/boards${options.archived ? '?archived=true' : ''}`); break;
    case 'check': result = await get('/api/check'); break;
    case 'tutorial': result = await get('/api/tutorial'); break;
    case 'new-board': case 'save-as': case 'open': case 'archive': case 'restore': {
      if (options['dry-run']) throw new Error('Board switching does not support --dry-run');
      const current = await get('/api/state');
      result = await (await request('/api/boards', { documentId: current.documentId, baseRevision: options.revision === undefined ? current.board.revision : Number(options.revision), action: ['open', 'archive', 'restore'].includes(command) ? command : command === 'save-as' ? 'copy' : 'create', title: options.title, targetId: ['open', 'archive', 'restore'].includes(command) ? required(targetId, 'document-id') : undefined })).json(); break;
    }
    case 'inspect': result = await get(`/api/items/${encodeURIComponent(required(targetId, 'id'))}`); break;
    case 'focus': { const current = await get('/api/state'); result = await (await request('/api/presence', { documentId: current.documentId, source: 'cli', actor, id: required(targetId, 'id') })).json(); break; }
    case 'history': result = await get(`/api/history?since=${encodeURIComponent(options.since ?? '0')}`); break;
    case 'add-screen': result = await mutate([{ type: 'screen.add', screen: screenChanges(options) }]); break;
    case 'add': result = await mutate([{ type: 'node.add', screenId: required(targetId, 'screen-id'), node: { type: required(type, 'node type'), ...changesFrom(options) } }]); break;
    case 'set': {
      const current = await get(`/api/items/${encodeURIComponent(required(targetId, 'id'))}`);
      result = await mutate([{ type: `${current.kind}.update`, id: targetId, changes: current.kind === 'screen' ? screenChanges(options) : changesFrom(options) }], { documentId: current.documentId, baseRevision: current.revision }); break;
    }
    case 'link': {
      required(type, 'target screen id or none'); result = await mutate([{ type: 'node.update', id: required(targetId, 'node-id'), changes: { targetScreenId: type === 'none' ? null : type } }]); break;
    }
    case 'remove': result = await mutate([{ type: 'item.remove', id: required(targetId, 'id') }]); break;
    case 'duplicate': result = await mutate([{ type: 'item.duplicate', id: required(targetId, 'id'), ...(options.name ? { name: options.name } : {}) }]); break;
    case 'layer': result = await mutate([{ type: 'node.layer', id: required(targetId, 'id'), position: required(type, 'front or back') }]); break;
    case 'reparent': result = await mutate([{ type: 'node.reparent', id: required(targetId, 'part-id'), parentId: required(type, 'region-id or none') === 'none' ? null : type }]); break;
    case 'start-screen': result = await mutate([{ type: 'board.update', changes: { startScreenId: required(targetId, 'screen-id') } }]); break;
    case 'layout': result = await mutate([{ type: 'nodes.layout', mode: required(targetId, 'layout mode'), ids: positional.slice(2) }]); break;
    case 'apply': {
      const patch = JSON.parse(await readFile(options.file));
      if (!Array.isArray(patch) && !Array.isArray(patch.operations)) throw new Error('Patch must be an operations array or {baseRevision, operations}');
      result = await mutate(Array.isArray(patch) ? patch : patch.operations, Array.isArray(patch) ? {} : { ...(patch.documentId ? { documentId: patch.documentId } : {}), baseRevision: patch.baseRevision }); break;
    }
    case 'import': result = await mutate([{ type: 'board.import', board: JSON.parse(await readFile(options.file)) }]); break;
    case 'undo': case 'redo': result = await mutate(undefined, { action: command }); break;
    case 'reset': result = await mutate([{ type: 'board.reset', title: options.title, sample: Boolean(options.sample) }]); break;
    case 'export': {
      const response = await request(`/api/export?format=${encodeURIComponent(options.format ?? 'json')}`);
      const content = options.format === 'bundle' ? Buffer.from(await response.arrayBuffer()) : await response.text();
      if (options.out) { await fs.writeFile(path.resolve(options.out), content); result = { saved: path.resolve(options.out), format: options.format ?? 'json' }; }
      else if (options.format === 'bundle') { process.stdout.write(content); return; }
      else { process.stdout.write(content + '\n'); return; }
      break;
    }
    default: throw new Error(`Unknown command: ${command}. Run node cli.mjs help`);
  }
  if (result?.board && result?.event && !result.dryRun) result = { documentId: result.documentId, revision: result.board.revision, dryRun: false, created: result.created, event: result.event };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
main().catch(error => {
  process.stderr.write(JSON.stringify({ error: error.message, ...(error.details ?? {}), ...(error.status ? { status: error.status } : {}) }) + '\n');
  process.exitCode = 1;
});
