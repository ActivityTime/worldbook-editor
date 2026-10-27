// lib/validate.js
// 世界书校验：结构 / 触发词冲突 / LLM 可见性铁律
// 铁律：LLM 只能看见 content；keys/comment/标题均不可见。从 comment 提取主体名词，
// 若未出现在 content 中则报错（否则条目永远不会被模型感知到）。

'use strict';

const { FIELD_ORDER } = require('./schema.js');

const KNOWN_KEYS = new Set(FIELD_ORDER);

// 从 comment 中提取“主体名词”：去掉引导词/描述词，取第一个名词性短语
function extractSubject(comment) {
  if (!comment || typeof comment !== 'string') return null;
  const s = comment.trim();
  if (!s) return null;
  // 常见引导词去掉
  const lead = s.match(/^(关于|针对|介绍|资料|设定|信息|关于的|的简介|相关|背景|身份|人物|角色|地点|组织|物品|技能|法术|种族|国家|城市|事件|书籍|传说|神话|科技|历史|文化|礼仪|习惯|习俗|规则|系统|机制|条目|词条|定义|说明|描述|记录|档案|情报|知识|常识|世界|大陆|星球|位面|副本|章节|故事|剧情|主线|支线|任务|线索|道具|装备|武器|防具|药剂|魔法|咒文|秘术|仪式|神术|德鲁伊|术士|法师|牧师|战士|盗贼|游侠|吟游诗人|武僧|野蛮人|圣武士|契术师)(的|之|：|:)?/);
  const trimmed = lead ? s.slice(lead[0].length).trim() : s;
  // 去末尾标点与描述词
  return trimmed.replace(/[。，,、！!？?；;：:\s]+$/, '').trim() || s;
}

function validate(wb) {
  const errors = [];
  const warnings = [];
  if (!wb || typeof wb !== 'object') {
    return { ok: false, errors: [{ message: '世界书数据不是对象' }], warnings };
  }
  if (!wb.entries || typeof wb.entries !== 'object' || Array.isArray(wb.entries)) {
    return { ok: false, errors: [{ message: 'entries 必须是对象（经典格式）' }], warnings };
  }
  const entries = wb.entries;
  const ids = Object.keys(entries);
  if (ids.length === 0) {
    warnings.push({ message: '世界书没有任何条目（空书）', field: 'entries' });
  }
  // uid 冲突
  const seen = new Set();
  for (const id of ids) {
    const e = entries[id];
    if (!e || typeof e !== 'object') {
      errors.push({ message: '条目 #' + id + ' 不是对象', field: id });
      continue;
    }
    if (typeof e.uid !== 'number') errors.push({ message: '条目 #' + id + ' 缺少数字 uid', field: 'uid' });
    else if (seen.has(e.uid)) errors.push({ message: 'uid 冲突：#' + e.uid + ' 被多个条目使用', field: 'uid' });
    seen.add(e.uid);
    // 字段类型
    for (const k of Object.keys(e)) {
      if (!KNOWN_KEYS.has(k)) continue;
      const v = e[k];
      if (k === 'characterFilter') {
        if (v && typeof v !== 'object') errors.push({ message: '条目 #' + id + ' 的 characterFilter 应为对象', field: k });
        continue;
      }
      if (Array.isArray(v)) {
        if (k !== 'key' && k !== 'keysecondary' && k !== 'triggers' && k !== 'names' && k !== 'tags') {
          errors.push({ message: '条目 #' + id + ' 的 ' + k + ' 不应是数组', field: k });
        }
        continue;
      }
      if (typeof v === 'object' && v !== null) {
        errors.push({ message: '条目 #' + id + ' 的 ' + k + ' 不应是对象', field: k });
      }
    }
    // 内容铁律
    if (typeof e.content !== 'string' || e.content.trim() === '') {
      errors.push({ message: '条目 #' + id + ' content 为空（LLM 看不到任何信息）', field: 'content' });
    }
    // 触发词
    const keys = Array.isArray(e.key) ? e.key : [];
    if (!e.constant && keys.length === 0) {
      warnings.push({ message: '条目 #' + id + ' 非常驻且无触发词（永远不会被召回）', field: 'key' });
    }
    // LLM 可见性铁律：comment 主体名词必须出现在 content
    if (e.comment && e.content) {
      const subj = extractSubject(e.comment);
      if (subj && subj.length >= 2) {
        const content = e.content;
        const found = content.includes(subj) || (keys.some(k => content.includes(k)) && subj.length <= 6);
        if (!found) {
          errors.push({ message: 'LLM 可见性铁律：comment「' + e.comment + '」的主体名词「' + subj + '」未出现在 content 中——LLM 看不见 comment/key，条目将永远不会被感知', field: 'content' });
        }
      }
    }
  }
  // 触发词冲突：同一 key 被多个条目使用
  const keyOwner = new Map();
  for (const id of ids) {
    const e = entries[id];
    const keys = Array.isArray(e?.key) ? e.key : [];
    for (const k of keys) {
      const norm = String(k).toLowerCase();
      if (!norm) continue;
      if (keyOwner.has(norm)) {
        const other = keyOwner.get(norm);
        if (other !== id) errors.push({ message: '触发词「' + k + '」被 2 个条目共用（#' + other + ' / #' + id + '），召回顺序不确定', field: 'key' });
      } else keyOwner.set(norm, id);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

module.exports = { validate, extractSubject };
