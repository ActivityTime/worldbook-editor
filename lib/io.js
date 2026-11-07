// lib/io.js
// 导入导出：世界书 JSON（经典 / ST3）、PNG 角色卡（ccv3/chara chunk）提取、生成 PNG。
// 纯 Node 实现，零依赖。PNG 解析：8 字节签名 + chunk[4长度|4类型|数据|4CRC]。

'use strict';

const fs = require('fs');
const zlib = require('zlib');
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

// 解析 PNG 文本块（tEXt / zTXt / iTXt），返回 [{ keyword, text }]
// 标准 SillyTavern / DSHT 卡把角色卡 JSON 写在 tEXt（或 iTXt/zTXt）文本块里，
// keyword 为 'ccv3'（V3 JSON 字符串）或 'chara'（V2 base64 JSON），而非独立 chunk 类型。
function parseTextChunks(chunks) {
  const out = [];
  for (const c of chunks) {
    const d = c.data;
    if (c.type === 'tEXt') {
      const nul = d.indexOf(0);
      if (nul < 0) continue;
      out.push({ keyword: d.subarray(0, nul).toString('latin1'), text: d.subarray(nul + 1).toString('latin1') });
    } else if (c.type === 'zTXt') {
      const nul = d.indexOf(0);
      if (nul < 0) continue;
      const kw = d.subarray(0, nul).toString('latin1');
      if (d[nul + 1] !== 0) continue; // 仅支持无压缩
      try { out.push({ keyword: kw, text: zlib.inflateSync(d.subarray(nul + 2)).toString('latin1') }); } catch (e) { /* 跳过损坏块 */ }
    } else if (c.type === 'iTXt') {
      const nul = d.indexOf(0);
      if (nul < 0) continue;
      const kw = d.subarray(0, nul).toString('latin1');
      let p = nul + 1;
      if (p + 1 >= d.length) continue;
      const compressed = d[p]; p += 2; // 跳过 压缩标志(1B) + 压缩方法(1B)
      const langEnd = d.indexOf(0, p); if (langEnd < 0) continue; p = langEnd + 1;
      const transEnd = d.indexOf(0, p); if (transEnd < 0) continue; p = transEnd + 1;
      const textBytes = d.subarray(p);
      if (compressed === 0) out.push({ keyword: kw, text: textBytes.toString('utf8') });
      else { try { out.push({ keyword: kw, text: zlib.inflateSync(textBytes).toString('utf8') }); } catch (e) { /* 跳过 */ } }
    }
  }
  return out;
}

// 角色卡数据解码：兼容「原文 JSON」与「base64(JSON)」两种存储
// - 标准 SillyTavern / DSHT 文本块（tEXt/iTXt ccv3、chara）通常为 base64(JSON)
// - 本工具 export 写入的私有 ccv3 chunk 为原文 JSON
function tryDecodeCard(text) {
  if (typeof text !== 'string') text = text.toString('utf8');
  // 1) 直接 JSON
  try { return JSON.parse(text); } catch (e) { /* 非原文 JSON，继续 */ }
  // 2) base64 -> utf8 -> JSON
  try {
    return JSON.parse(Buffer.from(text.trim(), 'base64').toString('utf8'));
  } catch (e) { /* 回退失败 */ }
  throw new Error('既不是合法 JSON，也不是 base64(JSON)');
}

// 从 PNG 提取角色卡 JSON：优先 ccv3（V3 JSON），回退 chara（V2 base64 JSON）
// 兼容两种存储：标准 tEXt/iTXt/zTXt 文本块（keyword=ccv3/chara），
// 以及本工具 export 早期写入的私有 ccv3/chara chunk（防御性兼容）。
function extractCardFromPng(pngPath) {
  const buf = fs.readFileSync(pngPath);
  const chunks = readPngChunks(buf);

  // 1) 标准文本块（SillyTavern / DSHT 常用）
  const texts = parseTextChunks(chunks);
  const tCcv3 = texts.find(t => t.keyword === 'ccv3');
  const tChara = texts.find(t => t.keyword === 'chara');
  // 2) 防御：私有 ccv3/chara chunk（本工具旧版 export 格式）
  const pCcv3 = chunks.find(c => c.type === 'ccv3');
  const pChara = chunks.find(c => c.type === 'chara');

  const ccv3 = tCcv3 || (pCcv3 ? { text: pCcv3.data.toString('utf8') } : null);
  const chara = tChara || (pChara ? { text: pChara.data.toString('utf8') } : null);

  if (!ccv3 && !chara) {
    throw new Error('PNG 中未找到 ccv3/chara 数据（可能不是角色卡，或未使用标准 tEXt/iTXt 存储）');
  }
  if (ccv3) {
    try {
      return { format: 'st3', data: tryDecodeCard(ccv3.text) };
    } catch (e) {
      throw new Error('ccv3 数据解析失败: ' + e.message);
    }
  }
  try {
    return { format: 'v2', data: tryDecodeCard(chara.text) };
  } catch (e) {
    throw new Error('chara 数据解析失败: ' + e.message);
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

// 空白底图（1x1 透明 PNG，无 ccv3/APNG），用于不指定封面时的世界书 PNG 导出
const BLANK_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// 构造 tEXt 文本块：keyword(latin1) + 0x00 + text(latin1)
function makeTextChunk(keyword, text) {
  const data = Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0]),
    Buffer.from(text, 'latin1'),
  ]);
  return makeChunk('tEXt', data);
}

// 核心：把角色卡 JSON 以标准 tEXt(ccv3 = base64(JSON)) 注入底图，紧跟 IHDR（或 APNG 的 acTL）之后。
// 同时清掉旧的 ccv3/chara 数据（两种存储都清：私有 chunk 类型 + tEXt 文本块 keyword），避免残留冲突。
// 保留 APNG 帧块（acTL/fcTL/fdAT）与全部图像数据，导出图仍是合法 APNG。
function assemblePng(baseBuf, cardJson) {
  const chunks = readPngChunks(baseBuf);
  const hasAcTL = chunks.some(c => c.type === 'acTL');
  // 清理旧 ccv3/chara：私有 chunk（type 即 ccv3/chara）+ tEXt 文本块 keyword=ccv3/chara
  const cleaned = [];
  for (const c of chunks) {
    if (c.type === 'ccv3' || c.type === 'chara') continue;
    if (c.type === 'tEXt') {
      const nul = c.data.indexOf(0);
      const kw = nul >= 0 ? c.data.subarray(0, nul).toString('latin1') : '';
      if (kw === 'ccv3' || kw === 'chara') continue;
    }
    cleaned.push(c);
  }
  const b64 = Buffer.from(JSON.stringify(cardJson), 'utf8').toString('base64');
  const ccv3Chunk = makeTextChunk('ccv3', b64);
  const parts = [baseBuf.subarray(0, 8)];
  let inserted = false;
  for (const c of cleaned) {
    parts.push(makeChunk(c.type, c.data));
    if (!inserted && (c.type === 'acTL' || (c.type === 'IHDR' && !hasAcTL))) {
      parts.push(ccv3Chunk); // 紧跟 IHDR 之后；若含 acTL 则放 acTL 之后（APNG 规范：acTL 须在 IDAT 前）
      inserted = true;
    }
  }
  if (!inserted) parts.push(ccv3Chunk); // 兜底（极少见：无 IHDR/acTL）
  return Buffer.concat(parts);
}

// 生成 PNG 角色卡：把已包装好的 cardJson 写入底图 PNG（移除旧 ccv3/chara）
function buildPngWithCard(basePngPath, cardJson, outPath) {
  const png = assemblePng(fs.readFileSync(basePngPath), cardJson);
  fs.writeFileSync(outPath, png);
  return outPath;
}

// 世界书 -> 角色卡 PNG Buffer（SillyTavern 规范：tEXt ccv3 = base64(chara_card_v3 JSON)）
// imagePath 可选：指定封面底图；缺省使用 1x1 透明空白底图（无封面预览）。
function toPng(wb, imagePath) {
  const card = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: { character_book: toCharacterBook(wb) },
  };
  const base = imagePath ? fs.readFileSync(imagePath) : Buffer.from(BLANK_PNG_B64, 'base64');
  return assemblePng(base, card);
}

// 完整角色卡（raw JSON）-> 角色卡 PNG Buffer（SillyTavern 规范：tEXt ccv3 = base64(cardJson)）
// 与 toPng 的区别：toPng 接受「世界书」并自动包成 chara_card_v3；本函数接受「已成型角色卡」原样写入。
// imagePath 可选：指定封面底图（PNG/APNG）；缺省使用 1x1 透明空白底图（无封面预览）。
function cardToPng(cardJson, imagePath) {
  const base = imagePath ? fs.readFileSync(imagePath) : Buffer.from(BLANK_PNG_B64, 'base64');
  return assemblePng(base, cardJson);
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
  importWorldbook, exportWorldbook, buildPngWithCard, toPng, cardToPng,
};
