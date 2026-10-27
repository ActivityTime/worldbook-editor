# 世界书编辑器（Worldbook Editor）

独立的 Node.js 世界书编辑工具，**双模式**：

- **CLI**（`bin/wbedit.js`）—— 给外部 AI / LLM / 脚本用的结构化命令行，所有写操作都经规范化 + 原子写入，**不会把 JSON 结构写坏**。
- **Web 界面**（`node wbedit.js serve`）—— 给人工编辑用，浏览器打开即可增删改查。

兼容 **SillyTavern V3**（`character_book.entries[]`）与 **DSH-Tavern** 独立世界书（经典 `entries` 对象格式）。

零依赖，纯 Node.js 内置模块，`node >= 14`。

## 快速开始

```powershell
# 方式一：双击启动脚本（推荐）
启动世界书编辑器.bat          # 默认端口 8080，自动打开浏览器
启动世界书编辑器.bat 9090     # 指定端口

# 方式二：命令行
node bin\wbedit.js serve --open

# CLI 查看世界书
node bin\wbedit.js list E:\MyWorkSpace\.dsh\profile-data\tavern\data\resources\worldbooks\【我的系统交互世界书】.json

# 校验（结构 / 触发词冲突 / LLM 可见性铁律）
node bin\wbedit.js validate wb.json
```

> 启动脚本 `启动世界书编辑器.bat` 为 ASCII 编码（兼容任意系统代码页），保持该编码，勿另存为 UTF-8/GBK。

**Web 界面文件选择**：顶部「浏览…」打开文件选择器（也可用于新建/导入弹窗内）。单击目录进入、单击文件选中、双击文件直接打开；支持「上级」「工作目录」快捷跳转与手动输入路径回车跳转。浏览任意目录（JSON/PNG 高亮为可打开的世界书）。

**导入默认落盘位置**：保存路径留空时自动保存到 `导入\<文件名>.json`（PNG 卡也导出为 JSON），保存时自动创建 `导入\` 子文件夹；目标已存在时自动追加 `（1）` `（2）`…，永不覆盖已有文件。

## CLI 命令

| 命令 | 说明 |
|---|---|
| `create <文件> [名称]` | 新建空世界书 |
| `list <文件> [--search 关键词]` | 列出条目 |
| `get <文件> <uid>` | 查看条目详情（完整 42 字段 JSON） |
| `add <文件> --key "a,b" --content "..." [选项]` | 新增条目 |
| `update <文件> <uid> --字段 值 [--字段2 值2]` | 更新任意字段 |
| `remove <文件> <uid>` | 删除条目 |
| `batch <文件> <uid,uid,...> --disable | --enable | --toggle | --remove | --constant true | --set k=v` | 批量操作 |
| `search <文件> <关键词> [--exact]` | 搜索条目 |
| `validate <文件>` | 校验 |
| `import <来源> [--out 目标.json]` | 导入（.json / .png 角色卡） |
| `export <文件> [--type classic|st3] [--out 目标.json]` | 导出 |
| `export-card <文件> --image 底图.png --out 卡.png` | 世界书打包成角色卡 PNG |
| `serve [--port 8080] [--open]` | 启动 Web 界面 |

`add` / `update` 常用字段：`key`、`keysecondary`、`comment`、`content`、`constant`、`disable`、`position`（0-5）、`order`、`depth`、`probability`、`group`、`sticky`、`role`、`selective`、`use_regex`、`caseSensitive`、`matchWholeWords`。布尔字段接受 `true/false`，key 用逗号分隔。支持点路径更新（如 `--characterFilter.isExclude true`）。

示例：

```powershell
# 新增一个常驻条目
node bin\wbedit.js add wb.json --key "精灵,elf" --content "精灵是长寿种族，生活在森林中。" --comment 种族设定 --constant

# 修改条目的注入位置与触发词
node bin\wbedit.js update wb.json 3 --position 4 --key "新的触发词,another"

# 从角色卡 PNG 提取世界书
node bin\wbedit.js import 角色卡.png --out 提取的世界书.json

# 导出 ST3 格式（用于角色卡 character_book）
node bin\wbedit.js export wb.json --type st3 --out wb_st3.json
```

## Web 界面

```powershell
node bin\wbedit.js serve --port 8080 --open
```

打开 `http://127.0.0.1:8080/` 后：

1. 顶部输入世界书 JSON 的**绝对路径**（或相对当前工作目录的路径），点「打开」
2. 左侧列表：点击查看/编辑，Shift+点击多选（批量启用/禁用/删除）
3. 右侧表单：编辑 comment / key / content 及全部 42 字段，点「保存修改」
4. 顶部按钮：「新建」「校验」「导入」「导出」

## 格式说明

### DSH-Tavern 独立世界书（经典格式）

```json
{
  "name": "世界书名称",
  "entries": {
    "0": { "uid": 0, "key": ["触发词"], "comment": "注释", "content": "正文", "constant": false, ... }
  }
}
```

- `entries` 是**对象**，键为 uid 字符串
- 单条目 42 字段：`uid/key/keysecondary/comment/content/constant/selective/use_regex/selectiveLogic/order/position/disable/excludeRecursion/preventRecursion/delayUntilRecursion/probability/useProbability/depth/role/group/sticky/cooldown/delay/caseSensitive/matchWholeWords/scanDepth/groupWeight/groupOverride/useGroupScoring/ignoreBudget/matchCharacterDescription/matchCharacterPersonality/matchScenario/matchPersonaDescription/matchCharacterDepthPrompt/matchCreatorNotes/characterFilter/triggers/displayIndex/vectorized`
- DSH 对缺失字段宽容（自动补默认值），本工具保存时**补全默认值但保留未知字段**，不破坏原文件

### SillyTavern V3（角色卡内嵌）

`character_book = { name, description, scan_depth, token_budget, recursive_scaling, extensions, entries: [...] }`，entries 是**数组**，条目带 `keys`（数组）/`enabled`/`inserting` 等 V3 命名。

本工具内部统一用经典格式编辑，导入导出时自动互转：

| 经典 | V3 |
|---|---|
| `key[]` | `keys[]` |
| `disable` | `!enabled` |
| `position` | `inserting` |
| `uid` / `keysecondary` / `displayIndex` | 丢弃 |

### PNG 角色卡

- `ccv3` chunk：V3 角色卡 JSON（含 `character_book`）
- `chara` chunk：V2 角色卡 base64 JSON

`import` 支持从 PNG 直接提取世界书；`export-card` 把世界书写入底图 PNG 的 `ccv3` chunk 生成角色卡。

## 校验规则（`validate`）

1. **结构**：entries 对象、uid 冲突、字段类型错误
2. **触发词冲突**：同一世界书内 key 被多个条目共用（召回顺序不确定）
3. **LLM 可见性铁律**：LLM 只能看见 `content`，看不见 `keys`/`comment`/标题 —— 从 comment 提取主体名词，若未出现在 content 中则报错
4. 空 content 报错；非常驻条目无触发词告警（永远不会被召回）

## 运行测试

```powershell
node test\test-all.js
```

用真实 DSH 世界书样例（E 盘活跃实例的「我的系统交互世界书」与 107 条大世界书）做回读验证，覆盖：加载、校验（LLM 可见性铁律/触发词冲突）、CRUD、搜索、原子保存回读、ST3 互转、导入导出、PNG 构建与提取闭环。41 项断言。

## 目录结构

```
世界书编辑器/
├── bin/wbedit.js     CLI 入口
├── lib/
│   ├── schema.js     42 字段定义 + 规范化 + V3 互转
│   ├── core.js       读写 / CRUD / 搜索 / 批量（原子写入）
│   ├── validate.js   校验（结构/冲突/LLM 可见性铁律）
│   ├── io.js         导入导出（PNG chunk 解析 / 生成）
│   └── server.js     Web 服务（REST API + 静态页面）
├── web/index.html    Web 界面（单文件）
└── package.json
```

## 防破坏设计

- **原子写入**：先写临时文件再 rename，中断不会留下半截 JSON
- **字段白名单 + 宽容纠型**：数字/布尔/数组自动纠正类型，非法值按默认值处理
- **未知字段保留**：不认识的字段原样保留（防 DSH/ST 新字段被丢）
- **无裸 JSON 覆盖入口**：CLI 只有结构化命令，不允许 `--raw` 直接写文件

## 已知限制

- `export-card` 需要提供一张 PNG 底图（角色卡封面）
- PNG 生成仅支持 ccv3（V3），不支持写 V2 chara chunk
