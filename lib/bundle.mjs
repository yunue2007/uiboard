import { exportSvg, exportBrief } from './export.mjs';
import { checkDesign } from '../public/design-checks.js';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
// Uncompressed ZIP works with built-in OS extractors without a runtime dependency.
export function exportBundle(board, documentId) {
  const snapshot = structuredClone(board);
  const files = {
    'manifest.json': JSON.stringify({ format: 'uiboard-handoff-v1', documentId, boardId: snapshot.id, revision: snapshot.revision, updatedAt: snapshot.updatedAt, files: ['board.json', 'board.svg', 'brief.md', 'checks.json'] }, null, 2),
    'board.json': JSON.stringify(snapshot, null, 2),
    'board.svg': exportSvg(snapshot),
    'brief.md': exportBrief(snapshot),
    'checks.json': JSON.stringify({ documentId, ...checkDesign(snapshot) }, null, 2),
  };
  const local = [], directory = []; let offset = 0;
  for (const [filename, content] of Object.entries(files)) {
    const name = Buffer.from(filename), data = Buffer.from(content), checksum = crc32(data);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(33, 12);
    header.writeUInt32LE(checksum, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x800, 8); entry.writeUInt16LE(33, 14);
    entry.writeUInt32LE(checksum, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    directory.push(entry, name); offset += header.length + name.length + data.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(directory.length / 2, 8); end.writeUInt16LE(directory.length / 2, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, central, end]);
}
