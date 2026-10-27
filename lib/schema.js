// lib/schema.js
// 世界书条目字段定义（SillyTavern V2 经典格式 = DSH-Tavern 独立世界书格式）
// 42 字段全集 + 默认值 + 类型。DSH 读取时对缺失字段宽容，这里保存时补全默认值但不丢未知字段。

'use strict';

// 经典条目字段：名 -> { type, def }
const ENTRY_FIELDS = {
  uid:                     { type: 'number',  def: 0 },
  key:                     { type: 'strarr', def: [] },       // 主触发词（可含 /正则/i 形式）
  keysecondary:            { type: 'strarr', def: [] },       // 次要触发词
  comment:                 { type: 'string', def: '' },
  content:                 { type: 'string', def: '' },
  constant:                { type: 'boolean', def: false },    // 常驻（始终注入）
  selective:               { type: 'boolean', def: false },
  use_regex:               { type: 'boolean', def: false },    // key 是否按正则解析（ST 旧字段）
  selectiveLogic:          { type: 'number',  def: 0 },        // 0=AND 1=OR 2=分叉
  order:                   { type: 'number',  def: 100 },      // 显示/扫描顺序
  position:                { type: 'number',  def: 0 },        // 注入位置：0=@ 1=# 2=@# 3=#@ 4=last 5=first
  disable:                 { type: 'boolean', def: false },
  excludeRecursion:        { type: 'boolean', def: false },
  preventRecursion:        { type: 'boolean', def: false },
  delayUntilRecursion:     { type: 'boolean', def: false },
  probability:             { type: 'number',  def: 100 },      // 触发概率 %
  useProbability:          { type: 'boolean', def: true },
  depth:                   { type: 'number',  def: 4 },        // 递归扫描深度
  role:                    { type: 'number',  def: 0 },        // 0=系统 1=用户 2=助手
  group:                   { type: 'string',  def: '' },       // 所属分组
  sticky:                  { type: 'number',  def: 0 },        // 注入后保持轮数
  cooldown:                { type: 'number',  def: 0 },
  delay:                   { type: 'number',  def: 0 },
  caseSensitive:           { type: 'boolean', def: false },
  matchWholeWords:         { type: 'boolean', def: false },
  scanDepth:               { type: 'number|null', def: null },
  groupWeight:             { type: 'number',  def: 100 },
  groupOverride:           { type: 'boolean', def: false },
  useGroupScoring:         { type: 'boolean', def: false },
  ignoreBudget:            { type: 'boolean', def: false },
  matchCharacterDescription:   { type: 'boolean', def: false },
  matchCharacterPersonality:   { type: 'boolean', def: false },
  matchScenario:               { type: 'boolean', def: false },
  matchPersonaDescription:     { type: 'boolean', def: false },
  matchCharacterDepthPrompt:   { type: 'boolean', def: false },
  matchCreatorNotes:           { type: 'boolean', def: false },
  characterFilter:         { type: 'charfilter', def: { isExclude: false, names: [], tags: [] } },
  triggers:                { type: 'strarr', def: [] },
  displayIndex:            { type: 'number',  def: 0 },
  vectorized:              { type: 'boolean', def: false },
};

// 字段顺序（保存时按此顺序输出，保证可读性）
const FIELD_ORDER = Object.keys(ENTRY_FIELDS);

// 顶层字段（世界书文件）
// { name?: string, entries: { "<uid>": entry } }

function defaultEntry(uid = null) {
  const e = {};
  for (const k of FIELD_ORDER) e[k] = cloneDefault(ENTRY_FIELDS[k].def);
  if (uid !== null) e.uid = uid;
  return e;
}

function cloneDefault(v) {
  if (Array.isArray(v)) return [...v];
  if (v && typeof v === 'object') return JSON.parse(JSON.stringify(v));
  return v;
}

// 规范化单个字段值（宽容转换）
function normalizeValue(field, value) {
  const spec = ENTRY_FIELDS[field];
  if (!spec) return value; // 未知字段：原样保留
  switch (spec.type) {
    case 'number': {
      if (value === null || value === undefined || value === '') return spec.def === null ? null : 0;
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    }
    case 'number|null': {
      if (value === null || value === undefined || value === '') return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === 1 || value === '1' || value === 'on') return true;
      if (value === 'false' || value === 0 || value === '0' || value === 'off') return false;
      return !!value;
    }
    case 'string': {
      if (value === null || value === undefined) return '';
      return String(value);
    }
    case 'strarr': {
      if (Array.isArray(value)) return value.map(v => String(v)).filter(v => v !== '');
      if (typeof value === 'string') return value.split(',').map(s => s.trim()).filter(s => s !== '');
      if (value === null || value === undefined) return [];
      return [String(value)];
    }
    case 'charfilter': {
      if (value && typeof value === 'object') {
        return {
          isExclude: normalizeValue('constant', value.isExclude),
          names: Array.isArray(value.names) ? value.names.map(String) : [],
          tags: Array.isArray(value.tags) ? value.tags.map(String) : [],
        };
      }
      return cloneDefault(spec.def);
    }
    default: return value;
  }
}

// 规范化整个条目：补默认值、纠正类型、保留未知字段
function normalizeEntry(raw, uid) {
  const out = {};
  for (const k of FIELD_ORDER) {
    out[k] = raw && raw[k] !== undefined ? normalizeValue(k, raw[k]) : cloneDefault(ENTRY_FIELDS[k].def);
  }
  // uid 强制
  if (typeof raw?.uid === 'number') out.uid = raw.uid;
  else if (uid !== undefined) out.uid = uid;
  else out.uid = 0;
  // 保留未知字段（避免破坏结构）
  if (raw) {
    for (const k of Object.keys(raw)) {
      if (!(k in ENTRY_FIELDS)) out[k] = raw[k];
    }
  }
  return out;
}

// 规范化整个世界书：{ name?, entries: { uid: entry } }
// mode: 'classic'（DSH 独立世界书）| 'st3'（character_book）
function normalizeWorldbook(data, mode = 'classic') {
  if (mode === 'st3') return normalizeCharacterBook(data);
  const out = { entries: {} };
  if (data && typeof data.name === 'string' && data.name) out.name = data.name;
  const rawEntries = data?.entries || {};
  if (!Array.isArray(rawEntries) && typeof rawEntries === 'object') {
    for (const id of Object.keys(rawEntries)) {
      const raw = rawEntries[id];
      const uid = (raw && typeof raw.uid === 'number') ? raw.uid : Number(id);
      out.entries[String(uid)] = normalizeEntry(raw, uid);
    }
  }
  // 排序输出（按 uid）
  const sorted = {};
  for (const id of Object.keys(out.entries).map(Number).sort((a, b) => a - b)) {
    sorted[String(id)] = out.entries[String(id)];
  }
  out.entries = sorted;
  return out;
}

// ST V3 character_book -> 经典格式（便于统一编辑）
function normalizeCharacterBook(cb) {
  const out = { entries: {} };
  if (cb?.name) out.name = String(cb.name);
  if (cb?.description) out.description = String(cb.description);
  if (cb?.scan_depth !== undefined) out.scan_depth = cb.scan_depth;
  if (cb?.token_budget !== undefined) out.token_budget = cb.token_budget;
  if (cb?.recursive_scaling !== undefined) out.recursive_scaling = cb.recursive_scaling;
  const list = Array.isArray(cb?.entries) ? cb.entries : [];
  let uid = 0;
  for (const raw of list) {
    const e = normalizeEntry(raw, raw.uid !== undefined ? raw.uid : uid);
    // V3 特有映射：keys -> key；enabled -> !disable；inserting -> position
    if (Array.isArray(raw?.keys)) e.key = raw.keys.map(String).filter(v => v !== '');
    if (raw?.enabled === false) e.disable = true;
    if (raw?.enabled === true && e.disable) e.disable = false;
    if (typeof raw?.inserting === 'number') e.position = raw.inserting;
    if (!(e.uid in out.entries)) out.entries[String(e.uid)] = e;
    else { // uid 冲突：重排
      let nu = e.uid + 1;
      while (nu in out.entries) nu++;
      e.uid = nu;
      out.entries[String(nu)] = e;
    }
    uid = Math.max(uid, e.uid) + 1;
  }
  return out;
}

// 经典 -> ST V3 character_book（导出用）
function toCharacterBook(wb) {
  const cb = { entries: [] };
  if (wb.name) cb.name = wb.name;
  if (wb.description) cb.description = wb.description;
  if (wb.scan_depth !== undefined) cb.scan_depth = wb.scan_depth;
  if (wb.token_budget !== undefined) cb.token_budget = wb.token_budget;
  if (wb.recursive_scaling !== undefined) cb.recursive_scaling = wb.recursive_scaling;
  const ids = Object.keys(wb.entries).map(Number).sort((a, b) => a - b);
  for (const id of ids) {
    const e = wb.entries[String(id)];
    const v3 = {};
    for (const k of Object.keys(e)) {
      if (k === 'disable') continue;
      if (k === 'key') { v3.keys = [...e.key]; continue; }
      if (k === 'uid' || k === 'keysecondary' || k === 'displayIndex') continue;
      v3[k] = JSON.parse(JSON.stringify(e[k]));
    }
    v3.enabled = !e.disable;
    cb.entries.push(v3);
  }
  return cb;
}

module.exports = {
  ENTRY_FIELDS,
  FIELD_ORDER,
  defaultEntry,
  normalizeEntry,
  normalizeValue,
  normalizeWorldbook,
  toCharacterBook,
  cloneDefault,
};
