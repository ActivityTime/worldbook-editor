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
| `add` | `add <文件> --key "a,b" --content "..." [--comment] [--constant] [--position 0-5] [--order N] [--depth N] [--probability N] [--group] [--sticky N] [--selective] [--use_regex] [--role 0|1|2] [--keysecondary] [--disable] [--caseSensitive] [--matchWholeWords]` | 新增条目 |
| `update` | `update <文件> <uid> --字段 值 [--字段2 值2]` | 修改条目字段（布尔用 true/false，key 用逗号分隔） |
| `remove` | `remove <文件> <uid>` | 删除条目 |
| `batch` | `batch <文件> <uid,uid,...> --disable|--enable|--toggle|--remove|--constant true|--set k=v;k2=v2` | 批量操作 |
| `search` | `search <文件> <关键词> [--exact]` | 搜索（匹配 comment/content/key/group） |
| `validate` | `validate <文件>` | 校验：结构 / 触发词冲突 / LLM 可见性铁律（有错误时 exit code=1） |
| `import` | `import <来源> [--out 目标.json]` | 导入世界书 JSON 或角色卡 PNG（ccv3/chara） |
| `export` | `export <文件> [--type classic|st3] [--out 目标]` | 导出（经典 / ST V3） |
| `export-card` | `export-card <文件> --image 底图.png --out 卡.png` | 把世界书打包进角色卡 PNG（ccv3） |
| `serve` | `serve [--port 8080] [--open]` | 启动 Web 编辑界面 |

示例：

```bash
node wbedit.js add wb.json --key "精灵,elf" --content "精灵是长寿种族…" --comment 种族设定 --constant
node wbedit.js update wb.json 3 --constant true --position 4
node wbedit.js import 角色卡.png --out wb.json
node wbedit.js validate wb.json
```

## Web 模式

`node bin\wbedit.js serve --open` 后访问 `http://127.0.0.1:8080/`。

- 顶部「浏览…」打开文件选择器（也可用于新建/导入弹窗），单击目录进入、单击文件选中、双击直接打开
- 导入：保存路径留空自动存到 `导入\文件名.json`，同名自动加 `（1）`；PNG 卡也导出为 JSON
- 校验面板展示错误/警告；搜索框实时过滤
- REST API：`POST /api/list|get|create|add|update|remove|batch|search|validate|import|export|dir`

## 数据格式要点（必须遵守）

- **经典格式**：`{ name?, entries: { "<uid>": 条目 } }`（DSH-Tavern 独立世界书）
- **ST V3 格式**：`character_book.entries[]` 数组；互转映射：`key↔keys`、`disable↔enabled(!)`、`position↔inserting`；ST3 丢弃 `uid/keysecondary/displayIndex`
- **条目字段**：42 字段全集（uid/key/keysecondary/comment/content/constant/selective/use_regex/order/position/depth/group/sticky/probability/…）；加载时对缺失字段宽容
- **LLM 可见性铁律**：**LLM 只能看见 `content`**！`comment`（标题/注释）、`key`（触发词）LLM 均不可见。因此主体名词必须写进 `content`，且 `comment` 中的主体名词若未出现在 `content` 会校验报错
- 同一世界书内 `key` 被多条目共用 → 校验报错；空 `content` → 报错；非常驻且无触发词 → 警告（永远不会被召回）

## 操作约定

1. **所有写操作必须走本工具**（CLI / Web API），禁止直接 `JSON.parse` + 改字段 + `writeFile` 裸覆盖
2. 修改条目用 `update` 传字段名；布尔字段传 `true/false`；数组字段（key/keysecondary/triggers）用逗号分隔
3. `validate` 通过后再交付；校验输出区分 `[错误]`（致命）与 `[警告]`
4. 每次改完运行 `node test\test-all.js`（41 断言）做回归

## 校验

```bash
node test\test-all.js
# 期望输出：41 通过, 0 失败
```

覆盖：真实样例加载 / 校验铁律 / CRUD / 搜索 / 原子保存回读 / ST3 互转 / 导入导出 / PNG 构建提取闭环 / 损坏 JSON 友好提示。
