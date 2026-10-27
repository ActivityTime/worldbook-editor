#!/usr/bin/env node
// bin/wbedit.js — 世界书编辑器 CLI
// 结构化命令编辑世界书 JSON，防止外部 AI / 手工直接改 JSON 把结构写坏。
// 所有写操作经 core.js 规范化 + 原子写入。

'use strict';

const fs = require('fs');
const path = require('path');
const core = require('../lib/core.js');
const schema = require('../lib/schema.js');
const { validate } = require('../lib/validate.js');
const io = require('../lib/io.js');

// ---------- 参数解析 ----------

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function fail(msg) {
  console.error('错误: ' + msg);
  process.exit(1);
}

function help() {
  console.log(`世界书编辑器 CLI
用法: node wbedit.js <命令> [参数]

命令:
  create <文件> [名称]                    新建空世界书
  list <文件> [--search 关键词]           列出条目
  get <文件> <uid>                        查看条目详情
  add <文件> --key "a,b" --content "..."  新增条目
      [--comment 注释] [--constant] [--position 0-5] [--order N]
      [--depth N] [--probability N] [--group 分组] [--sticky N]
      [--selective] [--use_regex] [--role 0|1|2] [--caseSensitive] [--matchWholeWords]
      [--keysecondary "x,y"] [--disable]
  update <文件> <uid> --字段 值 [--字段2 值2 ...]
      字段: key/keysecondary/comment/content/constant/disable/position/order/depth/
            probability/useProbability/group/sticky/cooldown/delay/selective/
            use_regex/selectiveLogic/role/caseSensitive/matchWholeWords/...
      值规范: constant/disable/... 接受 true/false; key 接受逗号分隔
  remove <文件> <uid>                     删除条目
  batch <文件> <uid,uid,...> --disable|--enable|--toggle|--remove|--constant true|--set k=v
  search <文件> <关键词> [--exact]        搜索条目
  validate <文件>                         校验世界书（结构/冲突/LLM可见性）
  import <来源文件> [--out 目标.json]      导入（来源可为 .json/.png 角色卡）
  export <文件> [--type classic|st3] [--out 目标.json]   导出
  export-card <文件> --image 底图.png --out 卡.png       世界书打包成角色卡 PNG
  serve [--port 8080] [--open]            启动 Web 编辑界面

示例:
  node wbedit.js add wb.json --key "精灵,elf" --content "精灵是长寿种族..." --comment 种族设定 --constant
  node wbedit.js update wb.json 3 --constant true --position 4
  node wbedit.js import 角色卡.png --out wb.json
`);
}

function getWb(file) {
  return core.load(file);
}

function posName(p) {
  return ['@', '#', '@#', '#@', '末尾', '开头'][p] || String(p);
}

function fmtEntry(e) {
  const tag = [];
  if (e.constant) tag.push('常驻');
  if (e.disable) tag.push('禁用');
  const keyStr = (e.key || []).join(',');
  return '#' + e.uid + '\t[' + tag.join('') + ']\t' + (e.order || 0) + '/' + posName(e.position) + '\t' + (e.comment || '') + (keyStr ? '  ⟦' + keyStr.slice(0, 40) + '⟧' : '');
}

// ---------- 命令实现 ----------

function cmdCreate(file, name) {
  const r = core.create(file, name || '新世界书');
  console.log('已创建 ' + r.filePath + '（' + r.entries + ' 个条目）');
}

function cmdList(file, flags) {
  const wb = getWb(file);
  let list = Object.values(wb.entries);
  if (flags.search) list = core.search(wb, flags.search);
  list.sort((a, b) => (a.order || 0) - (b.order || 0) || (a.uid || 0) - (b.uid || 0));
  console.log('世界书: ' + (wb.name || file) + '（共 ' + list.length + ' 条）');
  for (const e of list) console.log(fmtEntry(e));
}

function cmdGet(file, uid) {
  const wb = getWb(file);
  const e = wb.entries[String(uid)];
  if (!e) fail('条目 #' + uid + ' 不存在');
  console.log(JSON.stringify(e, null, 2));
}

function cmdAdd(file, flags) {
  const wb = getWb(file);
  const fields = {};
  for (const k of Object.keys(flags)) {
    if (k in schema.ENTRY_FIELDS) fields[k] = flags[k];
  }
  const e = core.addEntry(wb, fields);
  core.save(file, wb);
  console.log('已添加条目 #' + e.uid + '（' + (e.comment || '无注释') + '）');
}

function cmdUpdate(file, uid, flags) {
  const wb = getWb(file);
  const fields = {};
  for (const k of Object.keys(flags)) {
    if (k in schema.ENTRY_FIELDS || k.includes('.')) fields[k] = flags[k];
  }
  if (Object.keys(fields).length === 0) fail('没有可更新的字段（--字段 值）');
  const e = core.updateEntry(wb, uid, fields);
  core.save(file, wb);
  console.log('已更新条目 #' + uid + '：' + Object.keys(fields).join(', '));
}

function cmdRemove(file, uid) {
  const wb = getWb(file);
  core.removeEntry(wb, uid);
  core.save(file, wb);
  console.log('已删除条目 #' + uid);
}

function cmdBatch(file, idsStr, flags) {
  const wb = getWb(file);
  const ids = String(idsStr).split(',').map(s => s.trim()).filter(Boolean);
  let action = null;
  let value;
  for (const a of ['disable', 'enable', 'toggle', 'remove', 'constant', 'set']) {
    if (flags[a] !== undefined) { action = a; value = flags[a]; break; }
  }
  if (!action) fail('需要指定 --disable / --enable / --toggle / --remove / --constant / --set');
  if (action === 'set' && typeof value === 'string') {
    const v = {};
    for (const kv of value.split(';')) {
      const [k, val] = kv.split('=');
      if (k.trim()) v[k.trim()] = val === undefined ? true : val.trim();
    }
    value = v;
  }
  const r = core.batch(wb, ids, action, value);
  core.save(file, wb);
  console.log('批量' + action + ': 成功 ' + r.ok.length + (r.missing.length ? '，不存在 ' + r.missing.join(',') : ''));
}

function cmdSearch(file, q, flags) {
  const wb = getWb(file);
  const list = core.search(wb, q, { exact: !!flags.exact });
  list.sort((a, b) => (a.order || 0) - (b.order || 0) || (a.uid || 0) - (b.uid || 0));
  console.log('命中 ' + list.length + ' 条：');
  for (const e of list) console.log(fmtEntry(e));
}

function cmdValidate(file) {
  const wb = getWb(file);
  const r = validate(wb);
  console.log('校验结果: ' + (r.ok ? '通过' : r.errors.length + ' 个错误') + '（' + r.warnings.length + ' 个警告）');
  for (const e of r.errors) console.log('  [错误] ' + e.message);
  for (const w of r.warnings) console.log('  [警告] ' + w.message);
  process.exitCode = r.ok ? 0 : 1;
}

function cmdImport(src, out) {
  const r = io.importWorldbook(src);
  if (out) {
    core.save(out, r.wb);
    console.log(r.note + ' → 已保存 ' + out + '（' + Object.keys(r.wb.entries).length + ' 条）');
  } else {
    console.log(r.note);
    console.log(JSON.stringify(r.wb, null, 2));
  }
}

function cmdExport(file, type, out) {
  const wb = getWb(file);
  const text = io.exportWorldbook(wb, type || 'classic');
  if (out) {
    fs.writeFileSync(out, text, 'utf8');
    console.log('已导出（' + (type || 'classic') + '）→ ' + out);
  } else {
    console.log(text);
  }
}

function cmdExportCard(file, image, out) {
  const wb = getWb(file);
  const v3card = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: wb.name || '世界书',
      description: wb.description || '',
      character_book: schema.toCharacterBook(wb),
    },
  };
  io.buildPngWithCard(image, v3card, out);
  console.log('已生成角色卡 PNG → ' + out);
}

function cmdServe(flags) {
  const port = Number(flags.port) || 8080;
  const server = require('../lib/server.js');
  server.start(port, !!flags.open, path.dirname(process.argv[1]) + '/..');
}

// ---------- 主入口 ----------

function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const cmd = positional[0];
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { help(); return; }

  try {
    switch (cmd) {
      case 'create': {
        if (!positional[1]) fail('缺少文件路径');
        cmdCreate(positional[1], positional[2]);
        break;
      }
      case 'list': {
        if (!positional[1]) fail('缺少文件路径');
        cmdList(positional[1], flags);
        break;
      }
      case 'get': {
        if (!positional[1] || positional[2] === undefined) fail('用法: get <文件> <uid>');
        cmdGet(positional[1], positional[2]);
        break;
      }
      case 'add': {
        if (!positional[1]) fail('缺少文件路径');
        cmdAdd(positional[1], flags);
        break;
      }
      case 'update': {
        if (!positional[1] || positional[2] === undefined) fail('用法: update <文件> <uid> --字段 值');
        cmdUpdate(positional[1], positional[2], flags);
        break;
      }
      case 'remove': {
        if (!positional[1] || positional[2] === undefined) fail('用法: remove <文件> <uid>');
        cmdRemove(positional[1], positional[2]);
        break;
      }
      case 'batch': {
        if (!positional[1] || !positional[2]) fail('用法: batch <文件> <uid,uid,...> --disable');
        cmdBatch(positional[1], positional[2], flags);
        break;
      }
      case 'search': {
        if (!positional[1] || positional[2] === undefined) fail('用法: search <文件> <关键词>');
        cmdSearch(positional[1], positional[2], flags);
        break;
      }
      case 'validate': {
        if (!positional[1]) fail('缺少文件路径');
        cmdValidate(positional[1]);
        break;
      }
      case 'import': {
        if (!positional[1]) fail('缺少来源文件');
        cmdImport(positional[1], typeof flags.out === 'string' ? flags.out : null);
        break;
      }
      case 'export': {
        if (!positional[1]) fail('缺少文件路径');
        cmdExport(positional[1], flags.type, typeof flags.out === 'string' ? flags.out : null);
        break;
      }
      case 'export-card': {
        if (!positional[1] || !flags.image || !flags.out) fail('用法: export-card <文件> --image 底图.png --out 卡.png');
        cmdExportCard(positional[1], flags.image, flags.out);
        break;
      }
      case 'serve': {
        cmdServe(flags);
        break;
      }
      default:
        fail('未知命令: ' + cmd + '（用 help 查看用法）');
    }
  } catch (e) {
    fail(e.message);
  }
}

main();
