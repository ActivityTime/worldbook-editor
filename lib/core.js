// lib/core.js
// 世界书核心库：读写文件、CRUD、搜索、批量。所有写操作走结构化 API，防破坏结构。

'use strict';

const fs = require('fs');
const path = require('path');
const {
  ENTRY_FIELDS, FIELD_ORDER, normalizeWorldbook, normalizeEntry, defaultEntry, toCharacterBook,
} = require('./schema.js');

// ---------- 读写 ----------

// 读取世界书文件（自动兼容：经典 entries 对象 / ST3 character_book 数组）
function load(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new Error(`无法读取文件 ${filePath}: ${e.message}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON 解析失败 ${filePath}: ${e.message}（文件可能被写坏）`);
  }
  // 判断格式
  if (data && Array.isArray(data.entries)) {
    // ST3 character_book（entries 是数组）
    return normalizeWorldbook(data, 'st3');
  }
  if (data && typeof data.entries === 'object') {
    return normalizeWorldbook(data, 'classic');
  }
  throw new Error(`无法识别世界书格式 ${filePath}：缺少 entries 字段`);
}

// 保存世界书（保持 name 等顶层字段；JSON 2 空格缩进 + 保序）
function save(filePath, wb) {
  const out = {};
  if (wb.name) out.name = wb.name;
  if (wb.description !== undefined) out.description = wb.description;
  if (wb.scan_depth !== undefined) out.scan_depth = wb.scan_depth;
  if (wb.token_budget !== undefined) out.token_budget = wb.token_budget;
  if (wb.recursive_scaling !== undefined) out.recursive_scaling = wb.recursive_scaling;
  out.entries = wb.entries;
  // 原子写入：先写临时文件再替换，避免中断写坏
  const tmp = filePath + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, filePath);
  return { filePath, entries: Object.keys(wb.entries).length };
}

// 新建空世界书
function create(filePath, name = '新世界书') {
  if (fs.existsSync(filePath)) throw new Error(`文件已存在: ${filePath}`);
  const wb = { name, entries: {} };
  return save(filePath, wb);
}

// 更新世界书元信息（顶层字段：name / description / scan_depth / token_budget / recursive_scaling）
// 传空对象仅返回当前值；name/description 允许为空字符串（清空）。
function updateMeta(wb, fields = {}) {
  const keep = ['scan_depth', 'token_budget', 'recursive_scaling'];
  for (const k of Object.keys(fields)) {
    if (k === 'entries' || k === 'uid') continue;
    if (k === 'name') wb.name = String(fields[k] ?? '');
    else if (k === 'description') wb.description = String(fields[k] ?? '');
    else if (keep.includes(k)) wb[k] = fields[k];
  }
  return wb;
}

// ---------- CRUD ----------

// 计算下一个可用 uid
function nextUid(wb) {
  let max = -1;
  for (const id of Object.keys(wb.entries)) {
    const n = Number(id);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

// 添加条目。fields: { key, comment, content, constant, position, order, depth, ... }（任意字段）
function addEntry(wb, fields = {}) {
  const uid = nextUid(wb);
  const e = normalizeEntry(null, uid);
  // 应用传入字段
  for (const k of Object.keys(fields)) {
    if (k === 'uid') continue;
    if (k in ENTRY_FIELDS) e[k] = require('./schema.js').normalizeValue(k, fields[k]);
    else e[k] = fields[k]; // 未知字段保留
  }
  // key 默认：constant 条目允许空；否则至少给 comment 作提示
  if (!fields.key && !e.constant && e.key.length === 0 && e.comment) {
    // 不自动造 key，留给用户
  }
  wb.entries[String(uid)] = e;
  return e;
}

// 更新条目。fields: 任意字段。支持点路径（如 characterFilter.isExclude）
function updateEntry(wb, uid, fields = {}) {
  const id = String(uid);
  if (!wb.entries[id]) throw new Error(`条目 ${uid} 不存在`);
  const e = wb.entries[id];
  for (const k of Object.keys(fields)) {
    if (k === 'uid') continue;
    if (k.includes('.')) {
      const parts = k.split('.');
      let obj = e;
      for (let i = 0; i < parts.length - 1; i++) {
        obj[parts[i]] = obj[parts[i]] && typeof obj[parts[i]] === 'object' ? obj[parts[i]] : {};
        obj = obj[parts[i]];
      }
      const leaf = parts[parts.length - 1];
      if (leaf in ENTRY_FIELDS) obj[leaf] = require('./schema.js').normalizeValue(leaf, fields[k]);
      else obj[leaf] = fields[k];
    } else if (k in ENTRY_FIELDS) {
      e[k] = require('./schema.js').normalizeValue(k, fields[k]);
    } else {
      e[k] = fields[k];
    }
  }
  return e;
}

// 删除条目
function removeEntry(wb, uid) {
  const id = String(uid);
  if (!wb.entries[id]) throw new Error(`条目 ${uid} 不存在`);
  delete wb.entries[id];
  return true;
}

// 批量启用/禁用/删除/设置字段
function batch(wb, ids, action, value) {
  const result = { ok: [], missing: [] };
  for (const uid of ids) {
    const id = String(uid);
    if (!wb.entries[id]) { result.missing.push(uid); continue; }
    if (action === 'disable') wb.entries[id].disable = true;
    else if (action === 'enable') wb.entries[id].disable = false;
    else if (action === 'toggle') wb.entries[id].disable = !wb.entries[id].disable;
    else if (action === 'constant') wb.entries[id].constant = !!value;
    else if (action === 'remove') { delete wb.entries[id]; }
    else if (action === 'set') {
      for (const k of Object.keys(value)) {
        if (k === 'uid') continue;
        if (k in ENTRY_FIELDS) wb.entries[id][k] = require('./schema.js').normalizeValue(k, value[k]);
        else wb.entries[id][k] = value[k];
      }
    }
    result.ok.push(uid);
  }
  return result;
}

// ---------- 搜索 ----------

// 搜索条目。query 可匹配 comment/content/key。返回按 order 排序的条目列表
function search(wb, query, opts = {}) {
  const q = String(query || '').toLowerCase().trim();
  const results = [];
  const ids = Object.keys(wb.entries).map(Number).sort((a, b) => {
    const ea = wb.entries[String(a)], eb = wb.entries[String(b)];
    return (ea.order || 0) - (eb.order || 0) || a - b;
  });
  for (const id of ids) {
    const e = wb.entries[String(id)];
    if (!q) { results.push(e); continue; }
    const hay = [
      e.comment || '', e.content || '',
      ...(e.key || []), ...(e.keysecondary || []),
      e.group || '',
    ].join('\n').toLowerCase();
    const hit = opts.exact ? hay.includes(q) : (hay.includes(q) || fuzzyHit(q, hay));
    if (hit) results.push(e);
  }
  return results;
}

function fuzzyHit(q, hay) {
  // 简单分词：所有查询字符按顺序出现（忽略空白）
  const chars = q.replace(/\s+/g, '');
  let idx = 0;
  for (const ch of chars) {
    idx = hay.indexOf(ch, idx);
    if (idx < 0) return false;
    idx++;
  }
  return true;
}

// 按触发词精确匹配
function findByKey(wb, trigger) {
  const t = String(trigger);
  const out = [];
  for (const id of Object.keys(wb.entries)) {
    const e = wb.entries[id];
    if ((e.key || []).includes(t) || (e.keysecondary || []).includes(t)) out.push(e);
  }
  return out;
}

module.exports = {
  load, save, create, updateMeta,
  addEntry, updateEntry, removeEntry, batch, nextUid,
  search, findByKey,
};
