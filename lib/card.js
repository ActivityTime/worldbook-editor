// lib/card.js
// 角色卡结构化编辑核心（SillyTavern V3 / DSH-Tavern 工作副本 / V2 顶层卡）
//
// 设计铁律（与世界书编辑器一致）：
//  1. 禁止裸改 JSON：条目 CRUD 一律经 core.js（addEntry/updateEntry/removeEntry/batch）。
//  2. 写盘走原子写（临时文件 + rename）+ 自动备份，复用 core.backupCurrent。
//  3. 保留未知字段与原有包装（spec / meta / revisionHistory / extensions 原样不动）。
//  4. 卡内 character_book.entries 是 V3 数组；编辑时转成经典 worldbook 交给 core，
//     写回时以「原 V3 条目」为基底做字段映射，不重建、不膨胀、不丢 uid。

'use strict';

const fs = require('fs');
const path = require('path');
const io = require('./io.js');
const core = require('./core.js');
const schema = require('./schema.js');
const { validate } = require('./validate.js');

// 页面可编辑的基础字段（白名单，避免误写未知字段）
const TEXT_FIELDS = [
  'name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example',
  'system_prompt', 'post_history_instructions', 'creator_notes', 'creator', 'character_version',
];
const LIST_FIELDS = ['tags', 'alternate_greetings', 'group_only_greetings'];
const BOOK_FIELDS = ['name', 'description', 'scan_depth', 'token_budget', 'recursive_scaling'];

// V3 字段（在经典条目里属于未知字段，写回时不参与同名覆盖，统一走显式映射）
const V3_ONLY = new Set(['keys', 'secondary_keys', 'insertion_order', 'enabled']);
const SKIP_IN_SYNC = new Set([
  'uid', 'displayIndex', 'key', 'keysecondary', 'order', 'disable',
  'keys', 'secondary_keys', 'insertion_order', 'enabled',
]);

function clone(v) { return JSON.parse(JSON.stringify(v)); }

// ---------- 卡体定位（兼容多种包装） ----------

function cardData(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('角色卡 JSON 无效');
  if (raw.data && typeof raw.data === 'object') return raw.data;                       // V3 标准
  if (raw.raw && raw.raw.data && typeof raw.raw.data === 'object') return raw.raw.data; // DSH 工作副本
  if (raw.character_book || raw.first_mes !== undefined || raw.name !== undefined) return raw; // V2 顶层卡
  throw new Error('无法识别角色卡结构：缺少 data / character_book');
}

function ensureBook(data) {
  if (!data.character_book || typeof data.character_book !== 'object') data.character_book = { entries: [] };
  if (!Array.isArray(data.character_book.entries)) data.character_book.entries = [];
  return data.character_book;
}

function loadCard(filePath) {
  const ext = filePath.toLowerCase().split('.').pop();
  let raw;
  if (ext === 'png') {
    // 角色卡 PNG：从 tEXt(ccv3)/chara 文本块提取角色卡 JSON（已读侧修复，支持 base64 与明文）
    const { data } = io.extractCardFromPng(filePath);
    raw = data; // data 已是角色卡 JSON（V3 {spec,data} 或 V2 顶层卡）
  } else {
    let text;
    try { text = fs.readFileSync(filePath, 'utf8'); }
    catch (e) { throw new Error(`无法读取文件 ${filePath}: ${e.message}`); }
    try { raw = JSON.parse(text); }
    catch (e) { throw new Error(`JSON 解析失败 ${filePath}: ${e.message}（文件可能被写坏）`); }
  }
  const data = cardData(raw);
  const book = ensureBook(data);
  return { file: filePath, raw, data, book, isPng: ext === 'png' };
}

// ---------- V3 数组 <-> 经典 worldbook ----------

function defaultV3Entry() {
  return {
    uid: 0,
    keys: [],
    secondary_keys: [],
    comment: '',
    content: '',
    enabled: true,
    constant: false,
    selective: false,
    insertion_order: 100,
    position: 0,
    extensions: { display_index: 0, position: 'before_char' },
  };
}

// V3 条目 -> 经典条目（补 42 字段，保留未知字段）
// 注意：不少卡（含 DSH 双写条目）的 key 与 keys、order 与 insertion_order 是两套不同内容。
// 只有条目本身缺少经典字段时才用 V3 字段回填，绝不覆盖原有值 —— 否则仅改 content 也会改动触发词。
function v3ToClassic(e, uid) {
  const raw = Object.assign({}, e);
  if (!Array.isArray(e.key) && Array.isArray(e.keys)) raw.key = e.keys.slice();
  if (!Array.isArray(e.keysecondary) && Array.isArray(e.secondary_keys)) raw.keysecondary = e.secondary_keys.slice();
  if (typeof e.disable !== 'boolean' && typeof e.enabled === 'boolean') raw.disable = !e.enabled;
  if (e.order === undefined && e.insertion_order !== undefined) raw.order = e.insertion_order;
  raw.uid = uid;
  return schema.normalizeEntry(raw, uid);
}

function toClassic(book) {
  const wb = { entries: {} };
  for (const k of ['name', 'description', 'scan_depth', 'token_budget', 'recursive_scaling']) {
    if (book[k] !== undefined) wb[k] = book[k];
  }
  (book.entries || []).forEach((e, i) => {
    const uid = Number.isFinite(Number(e.uid)) ? Number(e.uid) : i;
    let u = uid;
    while (wb.entries[String(u)]) u++; // uid 冲突顺延，保证经典 worldbook 唯一
    const classic = v3ToClassic(e, u);
    classic.uid = u;
    wb.entries[String(u)] = classic;
  });
  return wb;
}

// 经典条目 -> V3 条目：以原条目为基底，只覆盖映射字段，绝不重建整个对象
// changed：本次操作真正改动的别名字段（key/keysecondary/order/disable）。
// 未改动的别名原样保留，避免 key 与 keys 内容不同的双写条目被「同步」掉。
function classicToV3(classic, base, uid, changed) {
  const out = Object.assign({}, base, { uid });
  const c = changed || { key: true, keysecondary: true, order: true, disable: true };
  // 同名字段：仅当原条目已有该字段才覆盖（避免把精简条目膨胀成 42 字段）
  for (const k of Object.keys(classic)) {
    if (SKIP_IN_SYNC.has(k) || V3_ONLY.has(k)) continue;
    if (k in base) out[k] = clone(classic[k]);
  }
  // 经典别名 -> V3 命名，仅对实际改动的字段做映射与双写同步
  if (c.key && Array.isArray(classic.key)) {
    out.keys = classic.key.slice();
    if ('key' in base) out.key = classic.key.slice();
  }
  if (c.keysecondary && Array.isArray(classic.keysecondary)) {
    out.secondary_keys = classic.keysecondary.slice();
    if ('keysecondary' in base) out.keysecondary = classic.keysecondary.slice();
  }
  if (c.order && classic.order !== undefined) {
    out.insertion_order = classic.order;
    if ('order' in base) out.order = classic.order;
  }
  if (c.disable && typeof classic.disable === 'boolean') {
    out.enabled = !classic.disable;
    if ('disable' in base) out.disable = classic.disable;
  }
  return out;
}

function applyClassic(book, wb, origById, changedById) {
  const uids = Object.keys(wb.entries).map(Number).sort((a, b) => a - b);
  book.entries = uids.map(uid => {
    const base = origById.get(uid) || defaultV3Entry();
    return classicToV3(wb.entries[String(uid)], base, uid, changedById ? changedById.get(uid) : undefined);
  });
}

// ---------- 原子写 + 备份 ----------

function saveCard(filePath, raw) {
  const out = JSON.stringify(raw, null, 2) + '\n';
  let prev = null;
  if (fs.existsSync(filePath)) {
    prev = fs.readFileSync(filePath, 'utf8');
    if (prev === out) return { unchanged: true, backupPath: null };
  }
  let backupPath = null;
  if (prev !== null && !process.env.WBEDIT_NO_BACKUP) {
    backupPath = core.backupCurrent(filePath, prev);
  }
  const tmp = filePath + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, out, 'utf8');
  fs.renameSync(tmp, filePath);
  return { unchanged: false, backupPath };
}

// ---------- 高层操作 ----------

function withBook(filePath, fn) {
  const c = loadCard(filePath);
  const wb = toClassic(c.book);
  const origById = new Map();
  c.book.entries.forEach(e => {
    if (Number.isFinite(Number(e.uid))) origById.set(Number(e.uid), e);
  });
  // 记录别名类字段的操作前快照，用于写回时只同步「真正被改动」的项
  const before = new Map();
  for (const [id, e] of Object.entries(wb.entries)) {
    before.set(id, {
      key: clone(e.key || []), keysecondary: clone(e.keysecondary || []),
      order: e.order, disable: e.disable,
    });
  }
  const result = fn(wb) || {};
  const changedById = new Map();
  for (const [id, e] of Object.entries(wb.entries)) {
    const b = before.get(id);
    changedById.set(Number(id), {
      key: !b || JSON.stringify(b.key) !== JSON.stringify(e.key || []),
      keysecondary: !b || JSON.stringify(b.keysecondary) !== JSON.stringify(e.keysecondary || []),
      order: !b || b.order !== e.order,
      disable: !b || b.disable !== e.disable,
    });
  }
  applyClassic(c.book, wb, origById, changedById);
  const saved = saveCard(filePath, c.raw);
  return Object.assign({}, result, { backupPath: saved.backupPath, unchanged: saved.unchanged });
}

function sortedEntries(wb) {
  return Object.values(wb.entries).sort((a, b) =>
    (a.order || 0) - (b.order || 0) || (a.uid || 0) - (b.uid || 0));
}

function open(filePath) {
  const c = loadCard(filePath);
  // PNG 源：提取出的卡写入同目录 JSON 工作副本，后续编辑落到副本，源 PNG 全程只读、不被破坏
  let workFile = filePath;
  let sourcePng = null;
  if (c.isPng) {
    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath, '.png');
    workFile = path.join(dir, baseName + '_work.json');
    fs.writeFileSync(workFile, JSON.stringify(c.raw, null, 2) + '\n', 'utf8');
    sourcePng = filePath;
  }
  const wb = toClassic(c.book);
  const fields = {};
  for (const k of TEXT_FIELDS) fields[k] = c.data[k] === undefined || c.data[k] === null ? '' : String(c.data[k]);
  for (const k of LIST_FIELDS) fields[k] = Array.isArray(c.data[k]) ? clone(c.data[k]) : [];
  fields.book = {};
  for (const k of BOOK_FIELDS) {
    fields.book[k] = c.book[k] === undefined || c.book[k] === null ? '' : c.book[k];
  }
  const r = validate(wb);
  return {
    file: workFile,
    sourcePng,
    spec: c.raw.spec || '(顶层/V2)',
    specVersion: c.raw.spec_version || '',
    wrapper: c.raw.kind || '',
    fields,
    entries: sortedEntries(wb),
    count: Object.keys(wb.entries).length,
    valid: r.ok,
    errors: r.errors,
    warnings: r.warnings,
    extraDataKeys: Object.keys(c.data).filter(k =>
      !TEXT_FIELDS.includes(k) && !LIST_FIELDS.includes(k) && k !== 'character_book'),
  };
}

function saveFields(filePath, fields = {}) {
  const c = loadCard(filePath);
  for (const k of TEXT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(fields, k)) c.data[k] = String(fields[k] ?? '');
  }
  for (const k of LIST_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(fields, k)) {
      c.data[k] = Array.isArray(fields[k]) ? fields[k].map(v => String(v)) : [];
    }
  }
  if (fields.book && typeof fields.book === 'object') {
    for (const k of BOOK_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(fields.book, k)) c.book[k] = fields.book[k];
    }
  }
  return saveCard(filePath, c.raw);
}

function addEntry(filePath, fields = {}) {
  return withBook(filePath, wb => {
    const e = core.addEntry(wb, fields);
    return { uid: e.uid, entry: e };
  });
}

function updateEntry(filePath, uid, fields = {}) {
  return withBook(filePath, wb => {
    const e = core.updateEntry(wb, uid, fields);
    return { uid: e.uid, entry: e };
  });
}

function removeEntry(filePath, uid) {
  return withBook(filePath, wb => {
    core.removeEntry(wb, uid);
    return { removed: uid };
  });
}

function batch(filePath, ids, action, value) {
  return withBook(filePath, wb => core.batch(wb, ids || [], action, value));
}

function validateCard(filePath) {
  const c = loadCard(filePath);
  const r = validate(toClassic(c.book));
  return { file: filePath, valid: r.ok, errors: r.errors, warnings: r.warnings };
}

function createEmpty(filePath, name = '新角色卡') {
  if (fs.existsSync(filePath)) throw new Error(`文件已存在: ${filePath}`);
  const raw = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name,
      description: '',
      personality: '',
      scenario: '',
      first_mes: '',
      mes_example: '',
      system_prompt: '',
      post_history_instructions: '',
      creator_notes: '',
      tags: [],
      alternate_greetings: [],
      group_only_greetings: [],
      creator: '',
      character_version: '1.0',
      character_book: { name: name + ' 世界书', entries: [] },
      extensions: {},
    },
  };
  return Object.assign({ file: filePath }, saveCard(filePath, raw));
}

// 把工作副本 JSON 角色卡合成 PNG 角色卡（保留封面图）。
// workFile：工作副本 JSON 路径（可由 open(png) 得到）；imagePath：封面底图路径，缺省沿用源 PNG，再缺省空白底图。
function exportPng(workFile, imagePath) {
  const c = loadCard(workFile);
  const buf = io.cardToPng(c.raw, imagePath || null);
  return { size: buf.length, buffer: buf };
}

module.exports = {
  TEXT_FIELDS, LIST_FIELDS, BOOK_FIELDS,
  loadCard, saveCard, toClassic, applyClassic,
  open, saveFields, addEntry, updateEntry, removeEntry, batch,
  validateCard, createEmpty, exportPng,
};
