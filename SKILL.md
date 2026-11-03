---
name: worldbook-editor
description: 世界书编辑器（Node.js 独立工具）使用指南。当需要编辑/创建/校验/导入导出 SillyTavern V3 或 DSH-Tavern 世界书（JSON 或 PNG 角色卡）时使用。提供结构化 CLI 与 Web 双模式，防止直接改 JSON 把结构写坏。适用于：新增/修改/删除/搜索世界书条目、批量启用禁用、格式校验（含 LLM 可见性铁律）、从角色卡导入世界书、把世界书打包成角色卡 PNG。
---

# 世界书编辑器（Worldbook Editor）

> 面向 AI 的世界书编辑工具。**禁止直接读写世界书 JSON**——必须通过本工具的 CLI / Web API 操作，
> 所有写操作都经 `core.js` 规范化 + 原子写入（临时文件 + rename），防止把结构写坏。

## 快速开始

```bash
# 项目根目录（Windows）
G:\Users\ACTIM\Downloads\工作目录\【DSH-Tavern】结构分析\世界书编辑器\

# 启动 Web 编辑界面（浏览器自动打开，端口 8080）
node bin\wbedit.js serve --open
# 或双击「启动世界书编辑器.bat」

# 查看帮助
node bin\wbedit.js help
```

## CLI 命令全集

| 命令 | 用法 | 说明 |
|---|---|---|
| `create` | `create <文件> [名称]` | 新建空世界书 |
| `list` | `list <文件> [--search 关键词]` | 列出条目（按 order 排序） |
| `get` | `get <文件> <uid>` | 查看条目完整 JSON |
| `add` | `add <文件> --key "a,b" --content "..." [--comment] [--constant] [--position 0-5] [--order N] [--depth N] [--probability N] [--group] [--sticky N] [--selective] [--use_regex] [--role 0\|1\|2] [--keysecondary] [--disable] [--caseSensitive] [--matchWholeWords]` | 新增条目 |
| `update` | `update <文件> <uid> --字段 值 [--字段2 值2]` | 修改条目字段（布尔用 true/false，key 用逗号分隔） |
| `remove` | `remove <文件> <uid>` | 删除条目 |
| `batch` | `batch <文件> <uid,uid,...> --disable\|--enable\|--toggle\|--remove\|--constant true\|--set k=v;k2=v2` | 批量操作 |
| `meta` | `meta <文件> [--name 名称] [--description 描述]` | 查看 / 修改世界书名称与描述（不传参数只查看） |
| `search` | `search <文件> <关键词> [--exact]` | 搜索（匹配 comment/content/key/group） |
| `validate` | `validate <文件>` | 校验：结构 / 触发词冲突 / LLM 可见性铁律（有错误时 exit code=1） |
| `sort` | `sort <文件> [--by uid|order] [--renumber-order N] [--dry-run]` | 重排条目顺序（物理顺序 + 可选重编 order）；`--by order` 按 order 升序、`--renumber-order N` 把 order 重编为 N,2N,3N…、`--dry-run` 仅预览 |
| `renumber-uid` | `renumber-uid <文件> [--start N] [--by order|uid] [--renumber-order M] [--dry-run]` | 把条目 uid 重编为连续 N,N+1,…（默认按 order 升序，可选同步把 order 重编为 M,2M,3M…）；`--dry-run` 仅预览映射 |
| `import` | `import <来源> [--out 目标.json]` | 导入世界书 JSON 或角色卡 PNG（ccv3/chara） |
| `export` | `export <文件> [--type classic\|st3] [--out 目标]` | 导出（经典 / ST V3） |
| `export-card` | `export-card <文件> --image 底图.png --out 卡.png` | 把世界书打包进角色卡 PNG（ccv3） |
| `serve` | `serve [--port 8080] [--open]` | 启动 Web 编辑界面 |

示例：

```bash
node wbedit.js add wb.json --key "精灵,elf" --content "精灵是长寿种族…" --comment 种族设定 --constant
node wbedit.js update wb.json 3 --constant true --position 4
node wbedit.js meta wb.json --name "我的世界书" --description "设定说明…"
node wbedit.js import 角色卡.png --out wb.json
node wbedit.js validate wb.json
```

### 排序条目（sort）

重排条目在文件中的物理顺序，并可选择性地把 `order` 字段重编为均匀的步进值。

```bash
# 按 order 升序重排物理顺序，并把 order 重编为 10,20,30…
node wbedit.js sort wb.json --by order --renumber-order 10
# 仅预览目标顺序，不写盘
node wbedit.js sort wb.json --by order --renumber-order 10 --dry-run
# 按 uid 数值升序重排（不改动 order 值）
node wbedit.js sort wb.json --by uid
```

- `--by uid`（默认）：按 uid 数值升序。
- `--by order`：按 `order` 字段升序；未设 `order` 的条目视为 0（排最前）。
- `--renumber-order N`：重排后把 `order` 重编为 `N, 2N, 3N…`；省略则不改动原 `order`。
- `--dry-run`：只打印目标顺序与计划，不写文件。
- 注：JS 对整型键（如 `"1"`/`"12"`）在 `JSON.stringify` 时会强制按数值升序，工具保存时按 `order` 字段手工拼出条目物理顺序，确保写盘顺序与意图一致。

### 重编条目 uid（renumber-uid）

uid 是持久标识（新增时取当前最大 uid+1，只增不减、删条不退号），所以会空洞、不反映顺序。`renumber-uid` 把 uid 重编为连续值，让 uid 与顺序一致。

```bash
# 按 order 升序把 uid 重编为 0,1,2…（默认），并同步把 order 重编为 10,20,30…
node wbedit.js renumber-uid wb.json --renumber-order 10
# 仅预览旧uid→新uid 映射，不写盘
node wbedit.js renumber-uid wb.json --dry-run
# 按当前 uid 数值升序仅连续化（保序不重排），起始 uid=1
node wbedit.js renumber-uid wb.json --by uid --start 1
```

- `--by order`（默认）：按 order 升序（同 order 按 uid）分配新 uid，uid 数字顺序与显示顺序一致。
- `--by uid`：按当前 uid 升序分配新 uid，只把编号连续化、不改顺序。
- `--start N`：起始 uid（默认 0，非负）。
- `--renumber-order M`：同时把 order 重编为 M, 2M, 3M…，保证 uid 与 order 顺序完全对齐。
- `--dry-run`：只打印映射计划，不写文件。

> 已添加命令对应的 Web API：`POST /api/renumber-uid`（body: `{file, start?, by?, renumberOrder?, dryRun?}`）。

## Web 模式

`node bin\wbedit.js serve --open` 后访问 `http://127.0.0.1:8080/`。

- 顶部「浏览…」打开文件选择器（也可用于新建/导入弹窗），单击目录进入、单击文件选中、双击直接打开
- 打开世界书后，详情区顶部显示**世界书信息**面板：编辑名称（顶层 `name`）与描述（顶层 `description`），点「保存名称/描述」写入文件
- 导入：保存路径留空自动存到 `导入\文件名.json`，同名自动加 `（1）`；PNG 卡也导出为 JSON
- 校验面板展示错误/警告；搜索框实时过滤
- REST API：`POST /api/list|get|create|add|update|remove|batch|meta|search|validate|import|export|dir`（`meta` 传 `{file, name?, description?}`，不传字段只读当前值）

## 数据格式要点（必须遵守）

- **经典格式**：`{ name?, entries: { "<uid>": 条目 } }`（DSH-Tavern 独立世界书）
- **顶层元信息**：名称存顶层 `name`；描述存顶层 `description`（DSH 经典格式原本没有该字段，写入后 ST/DSHT 宽容读取；ST V3 导出 / 打包 PNG 时映射到 `character_book.name` / `character_book.description`）
- **ST V3 格式**：`character_book.entries[]` 数组；互转映射：`key↔keys`、`disable↔enabled(!)`、`position↔inserting`；ST3 丢弃 `uid/keysecondary/displayIndex`
- **条目字段**：42 字段全集（uid/key/keysecondary/comment/content/constant/selective/use_regex/order/position/depth/group/sticky/probability/…）；加载时对缺失字段宽容
- **LLM 可见性铁律**：**LLM 只能看见 `content`**！`comment`（标题/注释）、`key`（触发词）LLM 均不可见。因此主体名词必须写进 `content`，且 `comment` 中的主体名词若未出现在 `content` 会校验报错
- 同一世界书内 `key` 被多条目共用 → 校验报错；空 `content` → 报错；非常驻且无触发词 → 警告（永远不会被召回）

## 操作约定

1. **所有写操作必须走本工具**（CLI / Web API），禁止直接 `JSON.parse` + 改字段 + `writeFile` 裸覆盖
2. 修改条目用 `update` 传字段名；布尔字段传 `true/false`；数组字段（key/keysecondary/triggers）用逗号分隔
3. `validate` 通过后再交付；校验输出区分 `[错误]`（致命）与 `[警告]`
4. 每次改完运行 `node test\test-all.js`（57 断言）做回归
5. **自动备份**：每次写操作（CLI 与 Web 的 `add`/`update`/`remove`/`batch`/`meta`/`sort`/`renumber-uid`/`import` 等）在写入前，都会自动把**改前的旧文件内容**快照到源文件同目录的 `backups/` 子目录（命名 `<原名>_备份_<YYYYMMDD_HHMMSS>.json`），供误改/误删后恢复。设环境变量 `WBEDIT_NO_BACKUP=1` 可关闭。**无实际变化的写入不会产生备份**（避免堆积）。

## 校验

```bash
node test\test-all.js
# 期望输出：57 通过, 0 失败
```

覆盖：真实样例加载 / 校验铁律 / CRUD / 搜索 / 原子保存回读 / 元信息（名称/描述改存回读与 ST3 映射）/ ST3 互转 / 导入导出 / PNG 构建提取闭环 / 损坏 JSON 友好提示。
