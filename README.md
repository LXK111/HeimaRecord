# heima-record

## 历史记录

- 2026-07-07 liuxiaoke 增加综合判定、撤销不回退计时、判罚中止结果和加时能力。
- 2026-07-06 liuxiaoke 增加限制回合计分模式，保留现有目标分和文件读写能力同包发布。
- 2026-07-06 liuxiaoke 增加规则文件、部位计分、警告分级、申诉、撤销、重置和赛后修正能力。
- 2026-07-02 liuxiaoke 将发布模板和结果 CSV 导出调整为 UTF-8 with BOM，避免 Excel 直接打开中文乱码。
- 2026-07-02 liuxiaoke 将无 Node 发布包调整为单文件 index.html，减少 file:// 资源加载风险。
- 2026-07-02 liuxiaoke 增加无 Node 交付说明，补充发布包、完整备份和恢复能力。
- 2026-07-02 liuxiaoke 创建项目说明，记录本地兵击比赛控制台第一版目标。

## 项目定位

`heima-record` 是一个本地 Web 端兵击比赛控制台，第一版聚焦导入场次、现场计时记分、规则判定、本地保存和结果导出。

## 第一版能力

- 导入 Excel / CSV 场次表
- 配置比赛时长、目标分、平局、加时和处罚扣分规则
- 单场比赛控制台：计时、加减分、处罚、手动结束
- 浏览器 IndexedDB 本地保存
- 导出 CSV / Excel 比赛结果
- 导出 / 导入完整 JSON 备份
- 通过 CSV / XLSX 配置部位分值、警告分级和警告转换
- 支持申诉记录、撤销、重置比赛和赛后修正
- 支持目标分模式和限制回合模式
- 支持综合判定、判罚中止比赛结果配置和加时

## 导入字段

导入文件首行建议包含以下字段，中文或英文表头均可：

- 场次编号 / matchNo
- 组别 / group
- 场地 / piste
- 红方姓名 / redName
- 红方单位 / redClub
- 蓝方姓名 / blueName
- 蓝方单位 / blueClub

## 本地运行

```bash
npm install
npm run dev
```

## 生成无 Node 交付包

```bash
npm run release
```

生成目录：

```text
release/heima-record/
```

比赛现场使用者只需要浏览器，双击发布包里的单文件 `index.html` 即可打开。
