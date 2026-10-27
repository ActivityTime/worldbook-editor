#!/usr/bin/env node
// bin/wbedit.js — 世界书编辑器 CLI
// 用法: wbedit <命令> [参数]

'use strict';

const fs = require('fs');
const path = require('path');
const core = require('../lib/core.js');
const schema = require('../lib/schema.js');
const io = require('../lib/io.js');
const { validate } = require('../lib/validate.js');

const args = process.argv.slice(2);
const cmd = (args[0] || '').toLowerCase();

function help() {
  console.log(`世界书编辑器 CLI (兼容 SillyTavern V2/V3 + DSH-Tavern)

用法:
  wbedit <命令> [参数]

命令:
  list <文件>                        查看世界书基本信息（名称/描述/条目数）
  meta <文件> [--name 名称] [--description 描述]   查看或修改世界书名称/描述（不传参数仅查看）
  entries <文件>                     列出所有条目（uid / 触发词 / 注释 / 启用）
  get <文件> <uid>                   查看单个条目
  add <文件> --key 触发词 [--comment 注释] [--content 正文] [--constant] [--order 100] [--position 0] [--depth 4]
                                     新增条目（--no-constant 表示非常驻）
  update <文件> <uid> <字段=值>...    更新条目字段（如 comment=新注释 content=正文 key=甲,乙 constant=true）
  remove <文件> <uid>...             删除条目
  batch <文件> --enable|--disable|--remove [--uid 1 --uid 2 ...]
                                     批量启用/禁用/删除（--uid 可多次）
  search <文件> <关键词>             搜索条目（匹配 comment/content/key）
  validate <文件>                    校验世界书（结构/重复 key/LLM 可见性）
  export <文件> [--type classic|st3|png] [--out 路径]
                                     导出（classic=原样 / st3=character_book / png=角色卡PNG）
  import <来源> [--out 路径]         导入世界书（JSON 或角色卡 PNG/JSON；--out 缺省 导入/<文件名>.json）
  web [--port 8099] [--no-browser]   启动 Web 界面
  help                                显示本帮助

示例:
  wbedit list 世界书.json
  wbedit meta 世界书.json --name 新名称 --description 说明文字
  wbedit add 世界书.json --key 精灵 --comment 种族设定 --content 精灵是… --constant --order 10
  wbedit export 世界书.json --type st3 --out 导出.json
`);
}

function fail(msg) {
  console.error('错误: ' + msg);
  process.exit(1);
}

function readArgs() {
  // 解析 --key value / --flag / 位置参数
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
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
  return { flags, positional };
}

function showEntry(e) {
  console.log(`#${e.uid}  ${e.comment || '(无注释)'}`);
  console.log(`  触发词: ${(e.key || []).join(', ') || '(无)'}`);
  console.log(`  状态: ${e.constant ? '常驻' : ''}${e.disable ? '禁用' : '启用'}  order=${e.order || 0} pos=${e.position ?? 0}`);
  console.log(`  内容: ${(e.content || '(空)').slice(0, 120)}${(e.content || '').length > 120 ? '…' : ''}`);
}

function showWorldbook(wb, filePath) {
  const entries = Object.values(wb.entries);
  console.log(`文件: ${filePath}`);
  console.log(`名称: ${wb.name || '(未命名)'}`);
  console.log(`描述: ${wb.description || '(无)'}`);
  console.log(`条目数: ${entries.length}`);
}

// ---------- 命令分发 ----------

async function main() {
  if (cmd === 'help' || cmd === '--help' || cmd === '-h' || cmd === '') {
    help();
    return;
  }

  const { flags, positional } = readArgs();

  switch (cmd) {
    case 'list': {
      if (!positional[1]) fail('用法: wbedit list <文件>');
      const wb = core.load(positional[1]);
      showWorldbook(wb, positional[1]);
      for (const e of Object.values(wb.entries)) {
        console.log(`  #${e.uid} ${(e.comment || '').slice(0, 30)} ${e.constant ? '[常驻]' : ''} ${e.disable ? '[禁用]' : ''}`);
      }
      return;
    }

    case 'meta': {
      if (!positional[1]) fail('用法: wbedit meta <文件> [--name 名称] [--description 描述]');
      const file = positional[1];
      const wb = core.load(file);
      const fields = {};
      if (flags.name !== undefined) fields.name = flags.name;
      if (flags.description !== undefined) fields.description = flags.description;
      if (Object.keys(fields).length > 0) {
        core.updateMeta(wb, fields);
        core.save(file, wb);
        console.log('已保存元信息');
      }
      showWorldbook(wb, file);
      return;
    }

    case 'entries': {
      if (!positional[1]) fail('用法: wbedit entries <文件>');
      const wb = core.load(positional[1]);
      for (const e of Object.values(wb.entries)) {
        showEntry(e);
        console.log('');
      }
      return;
    }

    case 'get': {
      if (!positional[2]) fail('用法: wbedit get <文件> <uid>');
      const wb = core.load(positional[1]);
      const e = wb.entries[String(positional[2])];
      if (!e) fail('条目 #' + positional[2] + ' 不存在');
      showEntry(e);
      return;
    }

    case 'add': {
      if (!positional[1]) fail('用法: wbedit add <文件> [--key …] [--comment …] …');
      const wb = core.load(positional[1]);
      const e = core.addEntry(wb, {
        key: flags.key || '',
        comment: flags.comment || '',
        content: flags.content || '',
        constant: flags.constant === true || flags.constant === 'true' || flags.constant === '1',
        order: flags.order !== undefined ? Number(flags.order) : 100,
        position: flags.position !== undefined ? Number(flags.position) : 0,
        depth: flags.depth !== undefined ? Number(flags.depth) : 4,
      });
      core.save(positional[1], wb);
      console.log('已新增 #' + e.uid);
      showEntry(e);
      return;
    }

    case 'update': {
      if (!positional[2]) fail('用法: wbedit update <文件> <uid> <字段=值>…');
      const file = positional[1];
      const uid = positional[2];
      const wb = core.load(file);
      const fields = {};
      for (const kv of positional.slice(3)) {
        const i = kv.indexOf('=');
        if (i < 0) fail('参数格式应为 字段=值: ' + kv);
        const k = kv.slice(0, i).trim();
        let v = kv.slice(i + 1).trim();
        if (v === 'true') v = true;
        else if (v === 'false') v = false;
        else if (v === 'null') v = null;
        else if (!isNaN(Number(v)) && v !== '') v = Number(v);
        fields[k] = v;
      }
      const e = core.updateEntry(wb, uid, fields);
      core.save(file, wb);
      console.log('已更新 #' + uid);
      showEntry(e);
      return;
    }

    case 'remove': {
      if (!positional[2]) fail('用法: wbedit remove <文件> <uid>…');
      const file = positional[1];
      const wb = core.load(file);
      for (const uid of positional.slice(2)) core.removeEntry(wb, uid);
      core.save(file, wb);
      console.log('已删除: ' + positional.slice(2).join(', '));
      return;
    }

    case 'batch': {
      if (!positional[1]) fail('用法: wbedit batch <文件> --enable|--disable|--remove [--uid N …]');
      const file = positional[1];
      const uids = Array.isArray(flags.uid) ? flags.uid : (flags.uid !== undefined ? [flags.uid] : []);
      if (uids.length === 0) fail('请用 --uid 指定至少一个条目');
      const action = flags.enable ? 'enable' : flags.disable ? 'disable' : flags.remove ? 'remove' : null;
      if (!action) fail('请指定 --enable / --disable / --remove');
      const wb = core.load(file);
      const r = core.batch(wb, uids, action);
      core.save(file, wb);
      console.log('成功: ' + r.ok.join(', ') + (r.missing.length ? ' 缺失: ' + r.missing.join(', ') : ''));
      return;
    }

    case 'search': {
      if (!positional[2]) fail('用法: wbedit search <文件> <关键词>');
      const wb = core.load(positional[1]);
      const list = core.search(wb, positional[2]);
      console.log('命中 ' + list.length + ' 条:');
      for (const e of list) { showEntry(e); console.log(''); }
      return;
    }

    case 'validate': {
      if (!positional[1]) fail('用法: wbedit validate <文件>');
      const wb = core.load(positional[1]);
      const r = validate(wb);
      for (const w of r.warnings) console.log('⚠ ' + w.message);
      for (const e of r.errors) console.log('✗ ' + e.message);
      if (r.ok) console.log('校验通过: 结构完整，无错误');
      else fail(r.errors.length + ' 个错误');
      return;
    }

    case 'export': {
      if (!positional[1]) fail('用法: wbedit export <文件> [--type classic|st3|png] [--out 路径]');
      const wb = core.load(positional[1]);
      const type = flags.type || 'classic';
      let out = flags.out;
      if (type === 'png') {
        out = out || path.join(path.dirname(positional[1]), (wb.name || '世界书') + '.png');
        const png = io.toPng(wb);
        fs.writeFileSync(out, png);
        console.log('已导出 PNG: ' + out);
      } else {
        const text = io.exportWorldbook(wb, type);
        if (out) { fs.writeFileSync(out, text, 'utf8'); console.log('已导出: ' + out); }
        else process.stdout.write(text);
      }
      return;
    }

    case 'import': {
      if (!positional[1]) fail('用法: wbedit import <来源> [--out 路径]');
      const r = io.importWorldbook(positional[1]);
      if (flags.out) {
        const out = path.resolve(flags.out);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        core.save(out, r.wb);
        console.log('已导入 ' + Object.keys(r.wb.entries).length + ' 条 → ' + out);
      } else {
        console.log('来源: ' + r.source + ' 格式: ' + r.format + ' 条目: ' + Object.keys(r.wb.entries).length);
        console.log('使用 --out 指定保存路径');
      }
      return;
    }

    case 'web': {
      const port = flags.port ? Number(flags.port) : 8099;
      const noBrowser = flags['no-browser'] === true;
      const server = require('../lib/server.js');
      server.start(port, !noBrowser);
      return;
    }

    default:
      fail('未知命令: ' + cmd + '（wbedit help 查看用法）');
  }
}

main().catch(e => fail(e.message));
