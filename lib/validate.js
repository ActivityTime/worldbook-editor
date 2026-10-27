// lib/validate.js
// 世界书格式校验。核心规则：
// 1. 结构完整（entries 对象、字段类型）
// 2. 触发词冲突检测（同一世界书内 key 重复）
// 3. LLM 可见性铁律：LLM 只能看见 content，看不见 keys/comment/标题
//    —— 条目主体名词必须出现在 content 中（comment/标题中的关键名词）
// 4. 空条目/无效字段检测

'use strict';

const { ENTRY_FIELDS } = require('./schema.js');

function validate(wb) {
  const errors = [];
  const warnings = [];
  const entries = wb.entries || {};

  if (typeof entries !== 'object' || Array.isArray(entries)) {
    return { ok: false, errors: [{ id: null, field: 'entries', message: 'entries 必须是对象（uid -> 条目）' }], warnings: [] };
  }

  // 1. uid 冲突 & 结构
  const uidSet = new Map();
  const keyMap = new Map(); // key -> [uid...]
  const constIds = [];

  for (const id of Object.keys(entries)) {
    const e = entries[id];
    const uid = e.uid !== undefined ? e.uid : Number(id);
    const label = `#${uid}${e.comment ? '「' + e.comment.slice(0, 20) + '」' : ''}`;

    if (uidSet.has(uid)) {
      errors.push({ id: uid, field: 'uid', message: `${label}: uid ${uid} 与条目 ${uidSet.get(uid)} 重复` });
    } else {
      uidSet.set(uid, id);
    }
    if (String(id) !== String(uid)) {
      warnings.push({ id: uid, field: 'uid', message: `${label}: 键 "${id}" 与 uid ${uid} 不一致` });
    }

    // 字段类型
    for (const [k, spec] of Object.entries(ENTRY_FIELDS)) {
      const v = e[k];
      if (v === undefined) {
        warnings.push({ id: uid, field: k, message: `${label}: 缺少字段 ${k}` });
        continue;
      }
      const okType = checkType(spec.type, v);
      if (!okType) {
        errors.push({ id: uid, field: k, message: `${label}: 字段 ${k} 类型错误（应为 ${spec.type}，实际 ${typeof v}）` });
      }
    }

    // 2. key 冲突
    const keys = e.key || [];
    for (const k of keys) {
      const norm = String(k).toLowerCase();
      if (!keyMap.has(norm)) keyMap.set(norm, []);
      keyMap.get(norm).push(uid);
    }

    // 3. LLM 可见性铁律
    if (!e.constant && keys.length === 0 && !e.disable) {
      warnings.push({ id: uid, field: 'key', message: `${label}: 非常驻条目没有触发词，永远不会被召回` });
    }
    const content = e.content || '';
    if (!content.trim()) {
      errors.push({ id: uid, field: 'content', message: `${label}: content 为空` });
    }
    // 主体名词必须出现在 content 中（从 comment 提取关键词）
    const comment = (e.comment || '').trim();
    if (comment && content.trim()) {
      const nouns = extractNouns(comment);
      const contentLow = content.toLowerCase();
      const missing = nouns.filter(n => n.length >= 2 && !contentLow.includes(n));
      if (missing.length > 0) {
        errors.push({
          id: uid, field: 'content',
          message: `${label}: LLM 可见性铁律违反——comment 中的主体名词 "${missing.slice(0, 5).join('、')}" 未出现在 content 中（LLM 只能看见 content，看不见 comment/keys）`,
        });
      }
    }

    if (e.constant) constIds.push(uid);
  }

  // 重复 key 报告
  for (const [k, uids] of keyMap.entries()) {
    if (uids.length > 1) {
      errors.push({ id: null, field: 'key', message: `触发词 "${k}" 被 ${uids.length} 个条目共用（#${uids.join('、#')}），召回顺序不确定` });
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function checkType(type, v) {
  switch (type) {
    case 'number': return typeof v === 'number';
    case 'number|null': return v === null || typeof v === 'number';
    case 'boolean': return typeof v === 'boolean';
    case 'string': return typeof v === 'string';
    case 'strarr': return Array.isArray(v) && v.every(x => typeof x === 'string');
    case 'charfilter':
      return v && typeof v === 'object' && typeof v.isExclude === 'boolean' &&
        Array.isArray(v.names) && Array.isArray(v.tags);
    default: return true;
  }
}

// 从 comment 提取主体名词：去常用虚词后按长度/首字符取词
function extractNouns(comment) {
  const stop = new Set(['的', '了', '是', '在', '和', '与', '或', '及', '等', '一个', '这个', '那个', '一些', '对', '从', '到', '为', '而', '之', '也', '都', '很', '不', '请', '用', '把', '被', '于', '以及', '相关', '介绍', '信息', '资料', '设定', '内容', '关于', '说明', '、', '，', '。', '：', '（', '）', '(', ')', '[', ']', '「', '」', '/', '·', 'the', 'a', 'an', 'of', 'in', 'on', 'for', 'to', 'and', 'or', 'with']);
  const tokens = [];
  // 中文字段（2-12 字）
  const cn = comment.match(/[\u4e00-\u9fff]{2,12}/g) || [];
  for (const t of cn) {
    if (!stop.has(t) && !stop.has(t.slice(0, 2))) tokens.push(t);
  }
  // 英文单词
  const en = comment.match(/[a-zA-Z][a-zA-Z0-9_-]{2,}/g) || [];
  for (const t of en) tokens.push(t.toLowerCase());
  // 去重
  return [...new Set(tokens)];
}

module.exports = { validate };
