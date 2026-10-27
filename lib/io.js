// lib/io.js
// 导入导出：世界书 JSON（经典 / ST3）、PNG 角色卡（ccv3/chara chunk）提取、生成 PNG。
// 纯 Node 实现，零依赖。PNG 解析：8 字节签名 + chunk[4长度|4类型|数据|4CRC]。

'use strict';

const fs = require('fs');
const { normalizeWorldbook, toCharacterBook } = require('./schema.js');

// ---------- PNG chunk 解析 ----------

function readPngChunks(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) {
    throw new Error('不是有效的 PNG 文件（签名不符）');
  }
  const chunks = [];
  let off = 8;
  while (off < buf.length) {
    if (off + 8 > buf.length) break;
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (off + 8 + len + 4 > buf.length) break;
    const data = buf.subarray(off + 8, off + 8 + len);
    chunks.push({ type, data: Buffer.from(data) });
    off += 12 + len;
    if (type === 'IEND') break;
  }
  return chunks;
}

// 从 PNG 提取角色卡 JSON：ccv3（V3 JSON）或 chara（V2 base64 JSON）
function extractCardFromPng(pngPath) {
  const buf = fs.readFileSync(pngPath);
  const chunks = readPngChunks(buf);
  const ccv3 = chunks.find(c => c.type === 'ccv3');
  const chara = chunks.find(c => c.type === 'chara');
  if (!ccv3 && !chara) {
    throw new Error('PNG 中未找到 ccv3/chara chunk（可能不是角色卡）');
  }
  if (ccv3) {
    try {
      return { format: 'st3', data: JSON.parse(ccv3.data.toString('utf8')) };
    } catch (e) {
      throw new Error('ccv3 chunk JSON 解析失败: ' + e.message);
    }
  }
  try {
    return { format: 'v2', data: JSON.parse(Buffer.from(chara.data.toString('utf8'), 'base64').toString('utf8')) };
  } catch (e) {
    throw new Error('chara chunk 解析失败: ' + e.message);
  }
}

// 从角色卡 JSON 中取世界书（兼容 V3 character_book / V2 character_book）
function extractWorldbookFromCard(card) {
  if (!card || typeof card !== 'object') throw new Error('角色卡数据无效');
  const cb = card.character_book || (card.data && card.data.character_book);
  if (!cb) throw new Error('角色卡中未包含世界书（character_book）');
  return normalizeWorldbook(cb, 'st3');
}

// 从 PNG 直接提取世界书
function worldbookFromPng(pngPath) {
  const { data } = extractCardFromPng(pngPath);
  return extractWorldbookFromCard(data);
}

// ---------- 导入/导出 ----------

// 导入任意来源 -> 经典世界书对象
// source: 文件路径（.json / .png）
function importWorldbook(sourcePath) {
  const ext = sourcePath.toLowerCase().split('.').pop();
  if (ext === 'png') {
    const { format, data } = extractCardFromPng(sourcePath);
    const wb = extractWorldbookFromCard(data);
    return { wb, sourceType: 'png-' + format, note: '从角色卡 PNG（' + format + '）提取世界书 ' + (wb.name || '(无名)') };
  }
  if (ext === 'json') {
    const raw = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    if (raw.character_book && Array.isArray(raw.character_book.entries)) {
      const wb = extractWorldbookFromCard(raw);
      return { wb, sourceType: 'card-json', note: '从角色卡 JSON 提取世界书 ' + (wb.name || '(无名)') };
    }
    const isArr = Array.isArray(raw.entries);
    const wb = normalizeWorldbook(raw, isArr ? 'st3' : 'classic');
    return { wb, sourceType: isArr ? 'st3' : 'classic', note: '世界书 JSON（' + (isArr ? 'ST3' : '经典') + '格式）' };
  }
  throw new Error('不支持的导入格式: ' + ext + '（支持 json / png）');
}

// 导出经典世界书 -> 目标格式
function exportWorldbook(wb, type) {
  if (type === 'st3') return JSON.stringify(toCharacterBook(wb), null, 2) + '\n';
  return JSON.stringify(wb, null, 2) + '\n';
}

// 生成 PNG 角色卡：把 ccv3 chunk 写入底图 PNG（移除旧 ccv3/chara）
function buildPngWithCard(basePngPath, cardJson, outPath) {
  const base = fs.readFileSync(basePngPath);
  const chunks = readPngChunks(base).filter(c => c.type !== 'ccv3' && c.type !== 'chara');
  const ccv3Data = Buffer.from(JSON.stringify(cardJson), 'utf8');
  const ccv3Chunk = makeChunk('ccv3', ccv3Data);
  const parts = [base.subarray(0, 8)];
  for (const c of chunks) {
    if (c.type === 'IHDR') {
      parts.push(ccv3Chunk); // ccv3 紧跟 IHDR
    }
    parts.push(makeChunk(c.type, c.data));
  }
  fs.writeFileSync(outPath, Buffer.concat(parts));
  return outPath;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// CRC32（PNG chunk 校验）
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

module.exports = {
  readPngChunks, extractCardFromPng, extractWorldbookFromCard, worldbookFromPng,
  importWorldbook, exportWorldbook, buildPngWithCard,
};
