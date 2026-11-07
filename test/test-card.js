// test/test-card.js — 角色卡编辑器（lib/card.js）自测
// 全程使用 __dirname 派生的临时目录，不依赖任何外部样例或固定盘符。
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const card = require(path.join(ROOT, 'lib/card.js'));
const WORK = path.join(__dirname, 'work-card');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
}
function section(s) { console.log('\n== ' + s + ' =='); }
function read(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function write(p, o) { fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n', 'utf8'); }

try { fs.rmSync(WORK, { recursive: true, force: true }); } catch (e) { /* 老 Node 兜底 */ }
fs.mkdirSync(WORK, { recursive: true });

// ---------- 1. 新建 + 打开 ----------
section('新建与读取');
const f1 = path.join(WORK, 'new-card.json');
const created = card.createEmpty(f1, '测试角色卡');
ok('createEmpty 生成文件', fs.existsSync(f1) && created.file === f1);
let raw = read(f1);
ok('V3 顶层结构正确', raw.spec === 'chara_card_v3' && raw.spec_version === '3.0');
ok('data 基础字段齐全', ['name','description','first_mes','character_book','extensions'].every(k => k in raw.data));
let o = card.open(f1);
ok('open 返回 0 条', o.count === 0 && Array.isArray(o.entries));
ok('open 返回 spec', o.spec === 'chara_card_v3');
ok('open 字段默认值', o.fields.name === '测试角色卡' && o.fields.first_mes === '');

// ---------- 2. 基础字段保存 ----------
section('基础字段保存');
const fields = Object.assign({}, o.fields, {
  name: '露娜', first_mes: '开场正文', description: '身份钩子',
  tags: ['星灵', 'Astral-Elf'], alternate_greetings: ['开场A', '开场B'],
  book: { name: '内嵌世界书', description: '说明文字' },
});
const r1 = card.saveFields(f1, fields);
ok('saveFields 实际写盘', r1.unchanged === false);
raw = read(f1);
ok('文本字段写入', raw.data.name === '露娜' && raw.data.first_mes === '开场正文');
ok('数组字段写入', JSON.stringify(raw.data.tags) === JSON.stringify(['星灵','Astral-Elf']));
ok('备选开场写入', raw.data.alternate_greetings.length === 2);
ok('character_book 元数据写入', raw.data.character_book.name === '内嵌世界书');
ok('spec / extensions 未被破坏', raw.spec === 'chara_card_v3' && 'extensions' in raw.data);
const r2 = card.saveFields(f1, fields);
ok('无变化不写盘', r2.unchanged === true && r2.backupPath === null);

// ---------- 3. 条目 CRUD 与 V3 映射 ----------
section('条目 CRUD 与字段映射');
const a = card.addEntry(f1, { comment: '新条目', key: ['甲','乙'], content: '正文甲' });
ok('addEntry 返回 uid', Number.isFinite(a.uid));
o = card.open(f1);
ok('条目数 +1', o.count === 1);
const e0 = read(f1).data.character_book.entries[0];
ok('新条目为 V3 命名', Array.isArray(e0.keys) && JSON.stringify(e0.keys) === JSON.stringify(['甲','乙']) && e0.enabled === true);
ok('新条目带 uid', Number.isFinite(e0.uid));
card.updateEntry(f1, a.uid, { content: '正文乙', key: ['丙'], disable: true, order: 55 });
const e1 = read(f1).data.character_book.entries[0];
ok('content 已更新', e1.content === '正文乙');
ok('key -> keys 映射', JSON.stringify(e1.keys) === JSON.stringify(['丙']));
ok('disable -> enabled 映射', e1.enabled === false);
ok('order -> insertion_order 映射', e1.insertion_order === 55);
ok('uid 稳定', e1.uid === a.uid);
card.batch(f1, [a.uid], 'enable');
ok('batch enable 生效', read(f1).data.character_book.entries[0].enabled === true);
card.removeEntry(f1, a.uid);
ok('removeEntry 生效', card.open(f1).count === 0);

// ---------- 4. 核心：零膨胀 / 零丢失 / 双写不一致保持 ----------
section('零膨胀与零文本丢失（核心）');
const f2 = path.join(WORK, 'dual-card.json');
const dual = {
  uid: 7,
  key: ['经典A', '经典B'],
  keys: ['v3-A', 'v3-B', 'v3-C'],           // 故意与 key 不同
  keysecondary: ['经典次'],
  secondary_keys: ['v3-次'],
  comment: '双写条目',
  content: '原始正文 甲',
  disable: false,
  enabled: true,
  order: 30,
  insertion_order: 77,                       // 故意与 order 不同
  constant: true,
  selective: false,
  position: 1,
  depth: 4,
  custom_marker: 'KEEP-ME',                  // 未知字段
  extensions: { display_index: 0, position: 'after_char' },
};
write(f2, {
  spec: 'chara_card_v3', spec_version: '3.0',
  data: {
    name: '双写卡', character_book: { name: 'X', entries: [dual] },
    custom_top: 'TOP-KEEP',                  // 未知顶层字段
  },
  extensions: { foo: 1 },
});
const beforeEntry = JSON.parse(JSON.stringify(dual));
card.updateEntry(f2, 7, { content: '新正文 乙' });   // 只改一个 content
const raw2 = read(f2);
const afterEntry = raw2.data.character_book.entries[0];
ok('content 已改', afterEntry.content === '新正文 乙');
ok('key 原样（未被 keys 覆盖）', JSON.stringify(afterEntry.key) === JSON.stringify(beforeEntry.key));
ok('keys 原样（未被 key 同步）', JSON.stringify(afterEntry.keys) === JSON.stringify(beforeEntry.keys));
ok('keysecondary 原样', JSON.stringify(afterEntry.keysecondary) === JSON.stringify(beforeEntry.keysecondary));
ok('secondary_keys 原样', JSON.stringify(afterEntry.secondary_keys) === JSON.stringify(beforeEntry.secondary_keys));
ok('order / insertion_order 各自原样', afterEntry.order === 30 && afterEntry.insertion_order === 77);
ok('disable / enabled 原样', afterEntry.disable === false && afterEntry.enabled === true);
ok('uid 原样', afterEntry.uid === 7);
ok('条目未知字段保留', afterEntry.custom_marker === 'KEEP-ME');
ok('字段集合零膨胀零删减', JSON.stringify(Object.keys(afterEntry).sort()) === JSON.stringify(Object.keys(beforeEntry).sort()),
  { before: Object.keys(beforeEntry), after: Object.keys(afterEntry) });
const diffKeys = Object.keys(beforeEntry).filter(k => JSON.stringify(beforeEntry[k]) !== JSON.stringify(afterEntry[k]));
ok('除 content 外无任何字段变化', JSON.stringify(diffKeys) === JSON.stringify(['content']), diffKeys);
ok('data 未知字段保留', raw2.data.custom_top === 'TOP-KEEP');
ok('顶层 extensions 保留', raw2.extensions.foo === 1);

// ---------- 5. 备份与校验 ----------
section('备份与校验');
const backupsDir = path.join(WORK, 'backups');
ok('写入前自动备份', fs.existsSync(backupsDir) && fs.readdirSync(backupsDir).length > 0);
const v = card.validateCard(f2);
ok('validateCard 返回文件路径', v.file === f2);
ok('validateCard 检出 LLM 可见性铁律违规',
  v.valid === false && v.errors.some(e => (e.message || '').includes('LLM 可见性')), v.errors);
// 把主体名词补进 content 后应转绿（证明校验链路真的读到了 content）
card.updateEntry(f2, 7, { content: '双写条目 新正文 乙' });
ok('修正 content 后校验通过', card.validateCard(f2).valid === true, card.validateCard(f2).errors);

// ---------- 6. 多格式包装兼容 ----------
section('多格式包装兼容');
const f3 = path.join(WORK, 'workspace-card.json');
write(f3, {
  kind: 'dsh-tavern-character-workspace', version: 1,
  raw: {
    spec: 'chara_card_v3', spec_version: '3.0',
    data: { name: '工作副本卡', character_book: { name: 'X', entries: [] } },
  },
  meta: { id: 'card-xyz', revisionHistory: [{ r: 1 }] },
});
const o3 = card.open(f3);
ok('DSH 工作副本可打开', o3.fields.name === '工作副本卡' && o3.wrapper === 'dsh-tavern-character-workspace');
card.saveFields(f3, Object.assign({}, o3.fields, { description: '改过了' }));
const raw3 = read(f3);
ok('工作副本 meta 与历史保留', raw3.meta.id === 'card-xyz' && raw3.meta.revisionHistory.length === 1);
ok('工作副本 raw.data 已更新', raw3.raw.data.description === '改过了');

const f4 = path.join(WORK, 'v2-card.json');
write(f4, { name: 'V2卡', first_mes: 'V2开场', character_book: { name: 'X', entries: [] } });
const o4 = card.open(f4);
ok('V2 顶层卡可打开', o4.fields.name === 'V2卡' && o4.fields.first_mes === 'V2开场');
card.saveFields(f4, Object.assign({}, o4.fields, { personality: '温和' }));
ok('V2 顶层卡保存成功', read(f4).personality === '温和');

// ---------- 7. 错误处理 ----------
section('错误处理');
const f5 = path.join(WORK, 'broken.json');
fs.writeFileSync(f5, '{ "spec": "chara_card_v3", ', 'utf8');
let threw = false;
try { card.open(f5); } catch (e) { threw = e.message.includes('可能被写坏'); }
ok('损坏 JSON 给出友好提示', threw);
let threwMissing = false;
try { card.open(path.join(WORK, 'nope.json')); } catch (e) { threwMissing = e.message.includes('无法读取文件'); }
ok('缺失文件给出友好提示', threwMissing);

console.log('\n========== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ==========');
process.exit(fail > 0 ? 1 : 0);
