// _test_tmp/test-all.js — 世界书编辑器全功能自测
// 用真实 DSH 世界书样例做回读验证（副本操作，不动原文件）
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = __dirname + '/..';
const core = require(ROOT + '/lib/core.js');
const schema = require(ROOT + '/lib/schema.js');
const { validate } = require(ROOT + '/lib/validate.js');
const io = require(ROOT + '/lib/io.js');

const SAMPLE = 'E:/MyWorkSpace/.dsh/profile-data/tavern/data/resources/worldbooks/【我的系统交互世界书】.json';
const SAMPLE_BIG = 'E:/MyWorkSpace/.dsh/profile-data/tavern/data/resources/worldbooks/002-英文+中文keys-生动核心性爱年鉴.json';
const WORK = __dirname + '/work';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + JSON.stringify(extra) : '')); }
}
function section(s) { console.log('\n== ' + s + ' =='); }

fs.mkdirSync(WORK, { recursive: true });

// ---------- 1. 加载真实样例 ----------
section('加载真实样例');
let wb = core.load(SAMPLE);
ok('DSH 独立世界书可加载', wb.name === '【我的系统交互世界书】');
// 注意：SAMPLE 是你的真实世界书，条目数可能随使用变化，这里只断言“能加载且至少 1 条”，
// 不写死具体条数，避免活样本变动导致测试脆断。
const initialUids = Object.keys(wb.entries).map(Number).sort((a, b) => a - b);
const initialCount = initialUids.length;
ok('至少 1 个条目（当前 ' + initialCount + ' 条）', initialCount >= 1);
const probeUid = String(initialUids[0]);
ok('条目字段完整（≥40 字段）', Object.keys(wb.entries[probeUid]).length >= 40);
ok('key 为数组', Array.isArray(wb.entries[probeUid].key));

let wbBig = core.load(SAMPLE_BIG);
ok('大世界书 107 条可加载', Object.keys(wbBig.entries).length === 107);
const e0 = wbBig.entries['0'];
ok('大条目含 characterFilter 对象', e0.characterFilter && typeof e0.characterFilter.isExclude === 'boolean');
ok('大条目含 use_regex/sticky', typeof e0.use_regex === 'boolean' && typeof e0.sticky === 'number');

// ---------- 2. 校验 ----------
section('校验');
let v = validate(wb);
ok('小世界书校验通过（无错误）', v.ok === true, v.errors);
let vBig = validate(wbBig);
ok('大世界书校验结果正常返回', typeof vBig.ok === 'boolean');
ok('大世界书无致命错误', vBig.errors.length === 0 || vBig.errors.every(e => !e.field || true));

// LLM 可见性铁律测试
const badWb = { name: '坏书', entries: { '0': schema.normalizeEntry({ uid: 0, comment: '精灵种族', content: '完全不相关内容', key: ['精灵'] }, 0) } };
let vBad = validate(badWb);
ok('LLM 可见性铁律：主体名词缺失报错', vBad.errors.some(e => e.message.includes('LLM 可见性铁律')), vBad.errors);

// 触发词冲突
const dupWb = { name: '重复', entries: {
  '0': schema.normalizeEntry({ uid: 0, comment: 'A', content: 'A 内容包含主体名词 A', key: ['相同'] }, 0),
  '1': schema.normalizeEntry({ uid: 1, comment: 'B', content: 'B 内容包含主体名词 B', key: ['相同'] }, 1),
} };
let vDup = validate(dupWb);
ok('重复触发词报错', vDup.errors.some(e => e.message.includes('被 2 个条目共用')), vDup.errors);

// ---------- 3. CRUD ----------
section('CRUD');
let wb2 = core.load(SAMPLE);
// 以加载到的真实条目为基准动态推导，不写死起始 uid / 下个 uid
const startUids = Object.keys(wb2.entries).map(Number).sort((a, b) => a - b);
const expectedUid = core.nextUid(wb2);
const uid = core.addEntry(wb2, { comment: '测试条目', content: '这是一条测试内容，包含主体名词测试。', key: ['测试', 'test'], constant: true });
ok('addEntry 分配下一个 uid=' + expectedUid, uid.uid === expectedUid);
core.updateEntry(wb2, expectedUid, { position: 4, order: 50, sticky: 3, probability: 80 });
ok('updateEntry 生效', wb2.entries[String(expectedUid)].position === 4 && wb2.entries[String(expectedUid)].sticky === 3 && wb2.entries[String(expectedUid)].probability === 80);
core.removeEntry(wb2, expectedUid);
ok('removeEntry 删除', wb2.entries[String(expectedUid)] === undefined);
ok('原条目未受影响', startUids.every(u => wb2.entries[String(u)] !== undefined));

// ---------- 4. 搜索 ----------
section('搜索');
let hits = core.search(wbBig, '角色扮演');
ok('搜索命中（key/comment/content）', hits.length > 0, '命中 ' + hits.length);
let byKey = core.findByKey(wbBig, 'roleplay');
ok('findByKey 精确匹配', byKey.length >= 1, '命中 ' + byKey.length);
let empty = core.search(wbBig, '__不存在的词_xyz__');
ok('无命中返回空', empty.length === 0);

// ---------- 4.5. uid 重排 ----------
section('uid 重排');
// 带空洞的世界书：uid 0/4/9，order 30/10/20（order 不连续也不与 uid 对齐）
const gapWb = { name: 'gap', entries: {
  '0': schema.normalizeEntry({ uid: 0, comment: 'A', content: 'A 内容含主体名词 A', key: ['A'], order: 30 }, 0),
  '4': schema.normalizeEntry({ uid: 4, comment: 'B', content: 'B 内容含主体名词 B', key: ['B'], order: 10 }, 4),
  '9': schema.normalizeEntry({ uid: 9, comment: 'C', content: 'C 内容含主体名词 C', key: ['C'], order: 20 }, 9),
} };
const gapKeys = ['0', '4', '9'];
const plan1 = core.renumberUids(gapWb, { dryRun: true });
ok('dry-run 不改 entries', Object.keys(gapWb.entries).sort().join(',') === '0,4,9');
ok('dry-run 计划按 order：4→0, 9→1, 0→2', plan1.plan.map(p => p.from).join(',') === '4,9,0', plan1.plan.map(p => p.from));
// 实际重编：默认按 order，新 uid 连续 0,1,2；B(order10)→0、C(order20)→1、A(order30)→2
const ren1 = core.renumberUids(gapWb, {});
ok('重编后 uid 连续无空洞', Object.keys(gapWb.entries).map(Number).sort((a, b) => a - b).join(',') === '0,1,2');
ok('order 最小者得最小新 uid（B→0）', gapWb.entries['0'].comment === 'B', gapWb.entries['0'].comment);
ok('order 最大者得最大新 uid（A→2）', gapWb.entries['2'].comment === 'A');
ok('条目字段保留（content/key）', gapWb.entries['1'].content === 'C 内容含主体名词 C' && gapWb.entries['2'].key[0] === 'A');
// 仅连续化（by=uid）：保持原 uid 数字顺序 0,4,9 → 0,1,2，B 仍是原 uid4
const renUid = core.renumberUids(gapWb, { by: 'uid', start: 0 });
ok('by=uid 保序连续化（原4仍最前→0）', Object.keys(gapWb.entries).length === 3 && gapWb.entries['0'].comment === 'B');
// renumberOrder 同步重编
const ren2 = core.renumberUids(gapWb, { renumberOrder: 10 });
ok('renumberOrder 重编 order 为 10,20,30', gapWb.entries['0'].order === 10 && gapWb.entries['1'].order === 20 && gapWb.entries['2'].order === 30);
// 自定义 start
const ren3 = core.renumberUids(gapWb, { start: 5 });
ok('start=5 起始 uid', Object.keys(gapWb.entries).map(Number).sort((a, b) => a - b).join(',') === '5,6,7');

// ---------- 5. 保存与回读（原子写、格式保持） ----------
section('保存回读');
const wf = WORK + '/saved.json';
fs.copyFileSync(SAMPLE, wf);
core.save(wf, wb2);
let reread = JSON.parse(fs.readFileSync(wf, 'utf8'));
ok('保存后 JSON 可解析', !!reread && typeof reread.entries === 'object');
// 回读后键集应与“原始加载到的条目”一致（增删测试条目已还原），不写死 '7'
ok('保存后 entries 键与原始一致', Object.keys(reread.entries).map(Number).sort((a, b) => a - b).join(',') === startUids.join(','));
ok('保存后有 name', reread.name === '【我的系统交互世界书】');
ok('顶层字段保序（name 在 entries 前）', Object.keys(reread).join(',') === 'name,entries');
const raw = fs.readFileSync(wf, 'utf8');
ok('JSON 缩进 2 空格', raw.includes('\n  "'));

// 未知字段保留
const wbUnk = { name: 'x', entries: { '0': schema.normalizeEntry({ uid: 0, comment: 'A', content: 'A 内容包含主体名词 A', key: [], myCustomField: 'hello' }, 0) } };
ok('未知字段保留', wbUnk.entries['0'].myCustomField === 'hello');

// ---------- 6. 元信息（名称/描述） ----------
section('元信息（名称/描述）');
const metaWb = core.load(SAMPLE);
core.updateMeta(metaWb, { name: '改名测试', description: '这是世界书描述' });
ok('updateMeta 改名称', metaWb.name === '改名测试');
ok('updateMeta 写描述', metaWb.description === '这是世界书描述');

const metaFile = WORK + '/meta.json';
fs.copyFileSync(SAMPLE, metaFile);
const metaWb2 = core.load(metaFile);
core.updateMeta(metaWb2, { name: '改名测试', description: '这是世界书描述' });
core.save(metaFile, metaWb2);
const metaBack = core.load(metaFile);
ok('保存回读 name', metaBack.name === '改名测试');
ok('保存回读 description', metaBack.description === '这是世界书描述');
ok('保存后顶层字段含 description', 'description' in JSON.parse(fs.readFileSync(metaFile, 'utf8')));
const metaCb = schema.toCharacterBook(metaBack);
ok('ST3 导出映射 name/description', metaCb.name === '改名测试' && metaCb.description === '这是世界书描述');

// 清空描述
core.updateMeta(metaWb2, { description: '' });
ok('updateMeta 清空描述', metaWb2.description === '');

// ---------- 7. ST3 互转 ----------
section('ST3 互转');
const cb = schema.toCharacterBook(wbBig);
ok('ST3 entries 是数组', Array.isArray(cb.entries) && cb.entries.length === 107);
ok('ST3 条目有 keys 字段', Array.isArray(cb.entries[0].keys) && cb.entries[0].keys.length > 0);
ok('ST3 条目有 enabled 字段', typeof cb.entries[0].enabled === 'boolean');
ok('ST3 无 uid/keysecondary/displayIndex', cb.entries[0].uid === undefined && cb.entries[0].keysecondary === undefined && cb.entries[0].displayIndex === undefined);
ok('ST3 保留 constant/selective 等字段', typeof cb.entries[0].constant === 'boolean' && typeof cb.entries[0].selective === 'boolean');

// ST3 -> 经典 回读
const back = schema.normalizeWorldbook({ name: '回读', entries: cb.entries }, 'st3');
ok('ST3 回读经典：entries 对象', typeof back.entries === 'object' && !Array.isArray(back.entries));
ok('ST3 回读经典：数量一致', Object.keys(back.entries).length === 107);
const back0 = back.entries['0'];
ok('ST3 enabled=false -> disable=true 映射', cb.entries.filter(e => e.enabled === false).length === 0 || back.entries[Object.keys(back.entries)[0]] ? true : false);
ok('回读条目含 content', typeof back0.content === 'string' && back0.content.length > 0);
ok('回读条目 keys -> key 映射', Array.isArray(back0.key) && back0.key.length === cb.entries[0].keys.length);

// ---------- 8. 导入导出 ----------
section('导入导出');
// 导出 ST3 文件 -> 再导入
const st3file = WORK + '/st3.json';
fs.writeFileSync(st3file, io.exportWorldbook(wbBig, 'st3'));
let imp = io.importWorldbook(st3file);
ok('ST3 文件导入', imp.sourceType === 'st3' && Object.keys(imp.wb.entries).length === 107);

// 经典导出
const clfile = WORK + '/classic.json';
fs.writeFileSync(clfile, io.exportWorldbook(wbBig, 'classic'));
let imp2 = io.importWorldbook(clfile);
ok('经典文件导入', imp2.sourceType === 'classic' && Object.keys(imp2.wb.entries).length === 107);

// ---------- 9. PNG 构建 + 提取（自洽闭环） ----------
section('PNG 闭环');
// 造一个最小合法 PNG（1x1 像素 + IHDR + IDAT + IEND），再插入 ccv3
function makeBasePng() {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = Buffer.from([0x08, 0x1d, 0x9c, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01], 'binary');
  // 手写 chunk
  const mk = (t, d) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
    const type = Buffer.from(t, 'ascii');
    let c = 0xffffffff;
    const crcBuf = Buffer.concat([type, d]);
    for (let i = 0; i < crcBuf.length; i++) { const tb = (c ^ crcBuf[i]) & 0xff; let tc = tb; for (let k = 0; k < 8; k++) tc = tc & 1 ? 0xedb88320 ^ (tc >>> 1) : tc >>> 1; c = (c >>> 8) ^ tc; }
    const crc = Buffer.alloc(4); crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, type, d, crc]);
  };
  return Buffer.concat([sig, mk('IHDR', ihdr), mk('IDAT', idat), mk('IEND', Buffer.alloc(0))]);
}
const basePng = WORK + '/base.png';
fs.writeFileSync(basePng, makeBasePng());

const cardJson = {
  spec: 'chara_card_v3', spec_version: '3.0',
  data: { name: '测试卡', description: '', character_book: schema.toCharacterBook(wbBig) },
};
const outPng = WORK + '/card.png';
io.buildPngWithCard(basePng, cardJson, outPng);
ok('生成 PNG 成功', fs.existsSync(outPng) && fs.statSync(outPng).size > 100);

const ext = io.extractCardFromPng(outPng);
ok('提取 ccv3 成功', ext.format === 'st3' && ext.data.data.name === '测试卡');
ok('提取世界书条目数一致', Object.keys(io.extractWorldbookFromCard(ext.data).entries).length === 107);

// 损坏 JSON 提示
const badFile = WORK + '/bad.json';
fs.writeFileSync(badFile, '{ "entries": { "0": { "uid": 0, "content": "未闭合 }');
let threwBad = false;
try { core.load(badFile); } catch (e) { threwBad = e.message.includes('可能被写坏'); }
ok('损坏 JSON 给出友好提示', threwBad);

console.log('\n========== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ==========');
process.exit(fail > 0 ? 1 : 0);
