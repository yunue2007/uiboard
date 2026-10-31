import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { BoardError, applyOperations, emptyBoard, locate, practiceBoard, seedBoard, validateBoard } from './board.mjs';
import { withFixedAppearance } from '../public/board-rules.js';

export class BoardStore extends EventEmitter {
  constructor(file) {
    super(); this.file = path.resolve(file); this.lockFile = `${this.file}.lock`;
    this.queue = Promise.resolve(); this.presence = { human: null, ai: null };
  }
  async open(initialBoard = seedBoard()) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        this.lockHandle = await fs.open(this.lockFile, 'wx');
        await this.lockHandle.writeFile(JSON.stringify({ pid: process.pid })); break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let owner;
        try { owner = JSON.parse(await fs.readFile(this.lockFile, 'utf8')); }
        catch { throw new BoardError('The board is locked. Check the other server before removing its .lock file.', 409); }
        let alive = true;
        try { process.kill(owner.pid, 0); } catch (checkError) { if (checkError.code === 'ESRCH') alive = false; }
        if (alive || attempt) throw new BoardError('Another server already owns this board data. Use its URL or a different --data file.', 409);
        await fs.unlink(this.lockFile);
      }
    }
    try {
      try {
        this.state = JSON.parse(await fs.readFile(this.file, 'utf8'));
        this.state.board = withFixedAppearance(validateBoard(this.state.board));
        if (!Array.isArray(this.state.history) || !Array.isArray(this.state.undo) || !Array.isArray(this.state.redo)) throw new Error('Invalid store structure');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        this.state = { board: withFixedAppearance(validateBoard(initialBoard)), history: [], undo: [], redo: [] };
        await this.persist(this.state);
      }
      this.state.documentId ??= this.state.board.id;
      this.state.documents ??= {};
      for (const entry of Object.values(this.state.documents)) {
        entry.board = withFixedAppearance(validateBoard(entry.board));
        if (![entry.history, entry.undo, entry.redo].every(Array.isArray)) throw new Error('Invalid saved board');
      }
    } catch (error) { await this.release(); throw error; }
    return this;
  }
  async persist(state) {
    const temp = `${this.file}.${process.pid}.tmp`;
    try { await fs.writeFile(temp, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 }); await fs.rename(temp, this.file); }
    finally { await fs.rm(temp, { force: true }).catch(() => {}); }
  }
  snapshot() { return structuredClone({ documentId: this.state.documentId, archived: Boolean(this.state.archivedAt), board: this.state.board, history: this.state.history, presence: this.presence, canUndo: !this.state.archivedAt && this.state.undo.length > 0, canRedo: !this.state.archivedAt && this.state.redo.length > 0 }); }
  requireEditable() { if (this.state.archivedAt) throw new BoardError('This board is archived. Restore it or open another board before editing.', 409, { archived: true }); }
  checkDocument(documentId, required = false) {
    if ((required || documentId !== undefined) && documentId !== this.state.documentId) throw new BoardError('The active board changed. Read context again.', 409, { currentDocumentId: this.state.documentId });
  }
  listDocuments({ archived = false } = {}) {
    const entries = { ...this.state.documents, [this.state.documentId]: this.state };
    return { documentId: this.state.documentId, archivedCount: Object.values(entries).filter(entry => entry.archivedAt).length, boards: Object.entries(entries).filter(([, entry]) => Boolean(entry.archivedAt) === archived).map(([documentId, entry]) => ({ documentId, title: entry.board.title, revision: entry.board.revision, updatedAt: entry.board.updatedAt, screenCount: entry.board.screens.length, archived: Boolean(entry.archivedAt), ...(entry.archivedAt ? { archivedAt: entry.archivedAt } : {}) })) };
  }
  manageDocuments(request) {
    const task = this.queue.then(async () => {
      if (!request || typeof request !== 'object') throw new BoardError('A board action is required');
      const { documentId, baseRevision, action, targetId, title } = request;
      this.checkDocument(documentId, true);
      if (baseRevision !== this.state.board.revision) throw new BoardError('The board changed. Read it again.', 409, { currentRevision: this.state.board.revision });
      if (!['create', 'copy', 'open', 'practice', 'import', 'archive', 'restore'].includes(action)) throw new BoardError('Unknown board action');
      const next = structuredClone(this.state);
      const saved = Object.fromEntries(['board', 'history', 'undo', 'redo'].map(key => [key, next[key]]));
      if (next.archivedAt) saved.archivedAt = next.archivedAt;
      next.documents[next.documentId] = saved;
      const loadDocument = id => { delete next.archivedAt; Object.assign(next, next.documents[id]); next.documentId = id; };
      if (action === 'open') {
        if (typeof targetId !== 'string') throw new BoardError('targetId is required');
        if (!Object.hasOwn(next.documents, targetId)) throw new BoardError('Saved board not found', 404);
        if (next.documents[targetId].archivedAt) throw new BoardError('Restore the archived board before opening it.', 409);
        loadDocument(targetId);
      } else if (action === 'archive' || action === 'restore') {
        if (typeof targetId !== 'string' || !Object.hasOwn(next.documents, targetId)) throw new BoardError('Saved board not found', 404);
        const target = next.documents[targetId];
        if (action === 'archive') {
          if (target.archivedAt) throw new BoardError('Board is already archived', 409);
          target.archivedAt = new Date().toISOString();
          if (targetId === next.documentId) {
            const replacement = Object.entries(next.documents).filter(([, entry]) => !entry.archivedAt).sort((a, b) => b[1].board.updatedAt.localeCompare(a[1].board.updatedAt))[0];
            if (replacement) loadDocument(replacement[0]); else next.archivedAt = target.archivedAt;
          }
        } else {
          if (!target.archivedAt) throw new BoardError('Board is not archived', 409);
          delete target.archivedAt; if (targetId === next.documentId) delete next.archivedAt;
        }
      } else {
        if (Object.keys(next.documents).length >= 100) throw new BoardError('At most 100 boards can be saved');
        const fresh = action === 'practice' ? practiceBoard() : emptyBoard(title ?? (action === 'copy' ? `${next.board.title} のコピー` : '新しい作戦ボード'));
        if (action === 'import') { const imported = withFixedAppearance(validateBoard(request.board)); Object.assign(fresh, imported, { id: fresh.id, revision: 0, updatedAt: new Date().toISOString() }); }
        if (action === 'copy') { fresh.screens = structuredClone(next.board.screens); if (next.board.startScreenId !== undefined) fresh.startScreenId = next.board.startScreenId; }
        validateBoard(fresh); Object.assign(next, { documentId: fresh.id, board: fresh, history: [], undo: [], redo: [] });
        delete next.archivedAt;
      }
      delete next.documents[next.documentId];
      const resetPresence = next.documentId !== this.state.documentId || Boolean(next.archivedAt) !== Boolean(this.state.archivedAt);
      await this.persist(next); this.state = next; if (resetPresence) this.presence = { human: null, ai: null };
      const snapshot = this.snapshot(); this.emit('board', snapshot); return snapshot;
    });
    this.queue = task.catch(() => {}); return task;
  }
  mutate(request) {
    const task = this.queue.then(() => this.commit(request));
    this.queue = task.catch(() => {}); return task;
  }
  async commit(request) {
    if (!request || typeof request !== 'object') throw new BoardError('A mutation object is required');
    const { baseRevision, operations, action = 'apply', actor = 'AI', source = 'cli', dryRun = false } = request;
    this.checkDocument(request.documentId);
    this.requireEditable();
    if (!Number.isSafeInteger(baseRevision)) throw new BoardError('baseRevision is required. Read the current board first.');
    if (baseRevision !== this.state.board.revision) throw new BoardError('The board changed. Read it again before applying your edit.', 409, { currentRevision: this.state.board.revision });
    if (typeof actor !== 'string' || !actor.trim() || actor.length > 100) throw new BoardError('actor must contain 1 to 100 characters');
    if (!['ui', 'cli'].includes(source)) throw new BoardError('source must be ui or cli');
    if (!['apply', 'undo', 'redo'].includes(action)) throw new BoardError('Unknown action');
    if (typeof dryRun !== 'boolean') throw new BoardError('dryRun must be a boolean');
    const next = structuredClone(this.state);
    let result;
    if (action === 'apply') {
      result = applyOperations(next.board, operations);
      next.undo.push({ board: next.board, summary: result.summary }); next.undo = next.undo.slice(-100); next.redo = [];
    } else {
      const from = action === 'undo' ? next.undo : next.redo;
      const to = action === 'undo' ? next.redo : next.undo;
      const entry = from.pop(); if (!entry) throw new BoardError(`Nothing to ${action}`, 409);
      to.push({ board: next.board, summary: entry.summary });
      result = { board: entry.board, created: [], summary: `${action === 'undo' ? '取り消し' : 'やり直し'}：${entry.summary}` };
    }
    result.board.revision = this.state.board.revision + 1; result.board.updatedAt = new Date().toISOString();
    validateBoard(result.board); result.board = withFixedAppearance(result.board); next.board = result.board;
    const event = { revision: next.board.revision, actor, source, action, timestamp: next.board.updatedAt, summary: result.summary, operations: action === 'apply' ? operations : [] };
    next.history.push(event); next.history = next.history.slice(-200);
    if (dryRun) return { documentId: this.state.documentId, dryRun: true, baseRevision, board: result.board, created: result.created, event };
    await this.persist(next); this.state = next;
    this.cleanPresence();
    const output = { ...this.snapshot(), created: result.created, event };
    this.emit('board', output); return output;
  }
  setPresence({ source, actor, id, viewport, documentId }) {
    this.checkDocument(documentId);
    this.requireEditable();
    if (!['ui', 'cli'].includes(source)) throw new BoardError('Invalid presence source');
    if (typeof actor !== 'string' || !actor.trim() || actor.length > 100) throw new BoardError('Invalid presence actor');
    let selection = null;
    if (id !== null && id !== undefined) {
      const found = locate(this.state.board, id);
      selection = { screenId: found.screen.id, nodeId: found.kind === 'node' ? id : null };
    }
    if (viewport !== undefined && (!viewport || !['x', 'y', 'width', 'height', 'zoom'].every(key => Number.isFinite(viewport[key])) || viewport.width <= 0 || viewport.height <= 0 || viewport.zoom < .15 || viewport.zoom > 2)) throw new BoardError('Invalid viewport');
    if (viewport?.scopeId !== undefined) {
      if (typeof viewport.scopeId !== 'string') throw new BoardError('Invalid viewport scope');
      const owner = locate(this.state.board, viewport.scopeId);
      if (owner.kind !== 'screen' && owner.item.type !== 'card') throw new BoardError('Viewport scope must be a screen or a region');
    }
    const entry = { actor, selection, ...(viewport ? { viewport } : {}), timestamp: new Date().toISOString() };
    this.presence[source === 'ui' ? 'human' : 'ai'] = entry;
    this.emit('presence', { presence: structuredClone(this.presence), source });
    return entry;
  }
  cleanPresence() {
    for (const role of ['human', 'ai']) {
      const selection = this.presence[role]?.selection;
      if (!selection) continue;
      try { selection.screenId = locate(this.state.board, selection.nodeId ?? selection.screenId).screen.id; }
      catch { this.presence[role].selection = null; }
    }
  }
  async release() {
    if (this.lockHandle) { await this.lockHandle.close(); this.lockHandle = null; await fs.rm(this.lockFile, { force: true }); }
  }
  async close() { await this.queue; await this.release(); }
}
