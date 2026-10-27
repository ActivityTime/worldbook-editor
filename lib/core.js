// lib/core.js
// 世界书读写 / CRUD / 搜索 / 批量操作。原子写入：先写临时文件再 rename。

'use strict';

const fs = require('fs');
const path = require('path');
const schema = require('./schema.js');

// ---------- 读写 ----------

function load(file) {
  const raw = fs.readFileSync(file, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error('JSON 解析失败（' + file + '）：' + e.message + '。文件可能被写坏。');
  }
  if (data && data.character_book && typeof data.character_book === 'object') {
    // 角色卡 JSON：取其世界书部分
    return schema.normalizeWorldbook(data.character_book, 'st3');
  }
  const wb = schema.normalizeWorldbook(data, 'classic');
  // 文件本身就是 ST3 character_book 形态（entries 数组）时重新按 st3 处理
  if (data && Array.isArray(data.entries) && !data.character_book) {
    return schema.normalizeWorldbook(data, 'st3');
  }
  return wb;
}

// 原子保存：临时文件 + rename
function save(file, wb) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, '.wb-tmp-' + process.pid + '-' + Date.now() + '.json');
  const body = serializeWorldbook(wb);
  fs.writeFileSync(tmp, body, 'utf8');
  fs.renameSync(tmp, file);
}

// 序列化：顶层 name 在前，entries 内部按 uid 升序，条目字段按 FIELD_ORDER
function serializeWorldbook(wb) {
  const out = {};
  if (wb.name) out.name = wb.name;
  if (wb.description) out.description = wb.description;
  if (wb.scan_depth !== undefined) out.scan_depth = wb.scan_depth;
  if (wb.token_budget !== undefined) out.token_budget = wb.token_budget;
  if (wb.recursive_scaling !== undefined) out.recursive_scaling = wb.recursive_scaling;
  const entries = {};
  const ids = Object.keys(wb.entries).map(Number).sort((a, b) => a - b);
  for (const id of ids) {
    const e = wb.entries[String(id)];
    const obj = {};
    for (const k of schema.FIELD_ORDER) {
      if (e[k] !== undefined) obj[k] = clone(e[k]);
    }
    // 未知字段保留（原样，保持顺序在最后）
    for (const k of Object.keys(e)) {
      if (!(k in schema.ENTRY_FIELDS)) obj[k] = clone(e[k]);
    }
    entries[String(id)] = obj;
  }
  out.entries = entries;
  return JSON.stringify(out, null, 2) + '\n';
}

function clone(v) {
  if (v === undefined) return undefined;
  return JSON.parse(JSON.stringify(v));
}

// ---------- 查询 ----------

function listEntries(wb) {
  return Object.keys(wb.entries)
    .map(id => {
      const e = wb.entries[id];
      return {
        uid: e.uid,
        comment: e.comment || '',
        key: e.key || [],
        constant: !!e.constant,
        disable: !!e.disable,
        order: e.order || 0,
        position: e.position || 0,
        group: e.group || '',
      };
    })
    .sort((a, b) => (a.order - b.order) || (a.uid - b.uid));
}

function getEntry(wb, uid) {
  const key = String(uid);
  if (!wb.entries[key]) throw new Error('条目 #' + uid + ' 不存在');
  return clone(wb.entries[key]);
}

// ---------- 写操作 ----------

function nextUid(wb) {
  let max = -1;
  for (const id of Object.keys(wb.entries)) max = Math.max(max, wb.entries[id].uid);
  return max + 1;
}

function addEntry(wb, fields) {
  const uid = nextUid(wb);
  const e = schema.normalizeEntry(fields || {}, uid);
  wb.entries[String(uid)] = e;
  return { uid };
}

function updateEntry(wb, uid, fields) {
  const key = String(uid);
  if (!wb.entries[key]) throw new Error('条目 #' + uid + ' 不存在');
  const cur = wb.entries[key];
  for (const k of Object.keys(fields || {})) {
    const v = fields[k];
    if (k.includes('.')) {
      // 点路径：如 characterFilter.isExclude
      const parts = k.split('.');
      let target = cur;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        if (typeof target[p] !== 'object' || target[p] === null) target[p] = {};
        target = target[p];
      }
      target[parts[parts.length - 1]] = schema.normalizeValue(parts[0], v);
      continue;
    }
    if (k in schema.ENTRY_FIELDS) cur[k] = schema.normalizeValue(k, v);
    else cur[k] = v; // 未知字段原样
  }
  return { uid };
}

function removeEntry(wb, uid) {
  const key = String(uid);
  if (!wb.entries[key]) throw new Error('条目 #' + uid + ' 不存在');
  delete wb.entries[key];
  return { uid };
}

// 批量：ids 数组 + action（disable/enable/toggle/remove/constant/set）
function batchOp(wb, ids, action, setVal) {
  const results = [];
  for (const uid of ids) {
    const key = String(uid);
    if (!wb.entries[key]) { results.push({ uid, ok: false, error: '条目不存在' }); continue; }
    const e = wb.entries[key];
    switch (action) {
      case 'disable': e.disable = true; break;
      case 'enable': e.disable = false; break;
      case 'toggle': e.disable = !e.disable; break;
      case 'remove': delete wb.entries[key]; break;
      case 'constant': e.constant = setVal !== undefined ? !!setVal : !e.constant; break;
      case 'set': {
        const [k, v] = String(setVal).split('=');
        if (!k) { results.push({ uid, ok: false, error: 'set 需要 k=v' }); continue; }
        e[k.trim()] = schema.normalizeValue(k.trim(), v);
        break;
      }
      default: results.push({ uid, ok: false, error: '未知操作 ' + action }); continue;
    }
    results.push({ uid, ok: true });
  }
  return results;
}

// ---------- 搜索 ----------

function search(wb, query, exact = false) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const id of Object.keys(wb.entries)) {
    const e = wb.entries[id];
    const hay = [
      e.comment || '',
      e.content || '',
      (e.key || []).join(' '),
      (e.keysecondary || []).join(' '),
      e.group || '',
    ].join(' ').toLowerCase();
    if (exact ? hay.includes(q) : hay.includes(q)) out.push({ uid: e.uid, comment: e.comment, key: e.key });
  }
  return out;
}

// 按触发词精确查找（用于冲突检测）
function findByKey(wb, key) {
  const k = String(key).toLowerCase();
  const out = [];
  for (const id of Object.keys(wb.entries)) {
    const e = wb.entries[id];
    if ((e.key || []).some(x => String(x).toLowerCase() === k)) out.push(e.uid);
  }
  return out;
}

module.exports = {
  load, save, serializeWorldbook,
  listEntries, getEntry,
  addEntry, updateEntry, removeEntry, batchOp,
  search, findByKey,
};
