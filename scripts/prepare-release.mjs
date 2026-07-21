import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = resolve(root, "release");
const releaseDir = resolve(releaseRoot, "heima-record");
const releaseAssetsDir = resolve(root, "release-assets");

const docsManifest = JSON.parse(
  readFileSync(resolve(releaseAssetsDir, "release-docs-manifest.json"), "utf8")
);

docsManifest.documents.forEach(({ source, pdf, sha256 }) => {
  const sourcePath = resolve(root, source);
  const actualHash = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
  if (actualHash !== sha256) {
    throw new Error(`${source} 已修改，请先执行 npm run release:docs 更新 ${pdf}。`);
  }
  if (!existsSync(resolve(releaseAssetsDir, pdf))) {
    throw new Error(`缺少 PDF 资产：${pdf}，请先执行 npm run release:docs。`);
  }
});

if (existsSync(releaseDir)) {
  rmSync(releaseDir, { recursive: true, force: true });
}

mkdirSync(releaseDir, { recursive: true });

const distDir = resolve(root, "dist");
const htmlPath = resolve(distDir, "index.html");
const html = readFileSync(htmlPath, "utf8");
const scriptMatch = html.match(/<script[^>]+src="(.+?\.js)"[^>]*><\/script>/);
const styleMatch = html.match(/<link[^>]+href="(.+?\.css)"[^>]*>/);

if (!scriptMatch || !styleMatch) {
  throw new Error("Unable to locate built JS or CSS assets in dist/index.html.");
}

const scriptPath = resolve(distDir, scriptMatch[1].replace(/^\.\//, ""));
const stylePath = resolve(distDir, styleMatch[1].replace(/^\.\//, ""));
const script = readFileSync(scriptPath, "utf8").replaceAll("</script>", "<\\/script>");
const style = readFileSync(stylePath, "utf8");

// 单文件发布包规避 file:// 场景下外部模块资源加载策略差异。
const singleFileHtml = html
  .replace(styleMatch[0], () => `<style>\n${style}\n</style>`)
  .replace(scriptMatch[0], () => `<script type="module">\n${script}\n</script>`);

writeFileSync(resolve(releaseDir, "index.html"), singleFileHtml);
docsManifest.documents.forEach(({ pdf }) => {
  copyFileSync(resolve(releaseAssetsDir, pdf), resolve(releaseDir, pdf));
});

const sampleCsv = readFileSync(resolve(releaseAssetsDir, "示例导入模板.csv"), "utf8");
writeFileSync(
  resolve(releaseDir, "示例导入模板.csv"),
  sampleCsv.startsWith("\uFEFF") ? sampleCsv : `\uFEFF${sampleCsv}`,
  "utf8"
);

const ruleWorkbook = new ExcelJS.Workbook();
const baseSheet = ruleWorkbook.addWorksheet("基础规则");
baseSheet.columns = [
  { header: "规则项", key: "key", width: 20 },
  { header: "规则值", key: "value", width: 20 },
  { header: "说明", key: "description", width: 32 },
];
[
  { key: "计分模式", value: "target_score", description: "target_score 或 round_limit" },
  { key: "比赛时长", value: 180, description: "秒" },
  { key: "目标分", value: 10, description: "目标分模式使用" },
  { key: "最大回合数", value: 10, description: "限制回合模式使用" },
  { key: "允许双方得分", value: "是", description: "限制回合模式使用" },
  { key: "允许无效回合", value: "是", description: "限制回合模式使用" },
  { key: "允许平局", value: "否", description: "时间到或回合打满后使用" },
  { key: "启用加时", value: "是", description: "平分且未结束时使用" },
  { key: "加时时长", value: 60, description: "秒" },
  { key: "处罚判负次数", value: 3, description: "处罚累计次数" },
].forEach((row) => baseSheet.addRow(row));

const hitSheet = ruleWorkbook.addWorksheet("部位分值");
hitSheet.columns = [
  { header: "部位ID", key: "id", width: 14 },
  { header: "部位名称", key: "label", width: 14 },
  { header: "分值", key: "score", width: 10 },
  { header: "启用", key: "enabled", width: 10 },
];
[
  { id: "head", label: "头部", score: 3, enabled: "是" },
  { id: "torso", label: "躯干", score: 2, enabled: "是" },
  { id: "arm", label: "手臂", score: 1, enabled: "是" },
  { id: "leg", label: "腿部", score: 1, enabled: "是" },
].forEach((row) => hitSheet.addRow(row));

const warningSheet = ruleWorkbook.addWorksheet("警告分级");
warningSheet.columns = [
  { header: "警告ID", key: "id", width: 16 },
  { header: "警告名称", key: "label", width: 16 },
  { header: "扣分", key: "scoreDelta", width: 10 },
  { header: "是否处罚", key: "isPenalty", width: 12 },
  { header: "是否判负", key: "isForfeit", width: 12 },
  { header: "是否中止比赛", key: "stopsMatch", width: 16 },
  { header: "中止结果", key: "stopResult", width: 16 },
];
[
  { id: "verbal", label: "口头警告", scoreDelta: 0, isPenalty: "否", isForfeit: "否", stopsMatch: "否", stopResult: "对方胜" },
  { id: "yellow", label: "黄牌", scoreDelta: 0, isPenalty: "否", isForfeit: "否", stopsMatch: "否", stopResult: "对方胜" },
  { id: "red", label: "红牌", scoreDelta: 1, isPenalty: "是", isForfeit: "否", stopsMatch: "否", stopResult: "对方胜" },
  { id: "black", label: "黑牌", scoreDelta: 0, isPenalty: "是", isForfeit: "是", stopsMatch: "是", stopResult: "对方胜" },
].forEach((row) => warningSheet.addRow(row));

const conversionSheet = ruleWorkbook.addWorksheet("警告转换");
conversionSheet.columns = [
  { header: "来源警告ID", key: "fromWarningId", width: 18 },
  { header: "累计次数", key: "count", width: 12 },
  { header: "转换为警告ID", key: "toWarningId", width: 18 },
];
[
  { fromWarningId: "yellow", count: 2, toWarningId: "red" },
  { fromWarningId: "red", count: 3, toWarningId: "black" },
].forEach((row) => conversionSheet.addRow(row));

await ruleWorkbook.xlsx.writeFile(resolve(releaseDir, "规则配置模板.xlsx"));

const playerClubs = ["黑马测试队A", "青锋测试队B", "长风测试队C", "云剑测试队D"];

async function writePlayerTestWorkbook(playerCount) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "liuxiaoke";
  workbook.created = new Date("2026-07-21T00:00:00+08:00");

  const sheet = workbook.addWorksheet("选手名单", {
    views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
  });
  sheet.columns = [
    { header: "姓名", key: "name", width: 18 },
    { header: "单位", key: "club", width: 18 },
    { header: "种子", key: "seed", width: 10 },
  ];
  sheet.autoFilter = `A1:C${playerCount + 1}`;
  sheet.getRow(1).height = 26;
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF18231F" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });

  for (let index = 1; index <= playerCount; index += 1) {
    const row = sheet.addRow({
      name: `测试选手${String(index).padStart(2, "0")}`,
      club: playerClubs[(index - 1) % playerClubs.length],
      seed: index,
    });
    row.height = 22;
    row.eachCell((cell, columnNumber) => {
      cell.alignment = {
        vertical: "middle",
        horizontal: columnNumber === 3 ? "center" : "left",
      };
      cell.border = { bottom: { style: "hair", color: { argb: "FFD9DED9" } } };
      if (index % 2 === 0) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F7F5" } };
      }
    });
  }

  await workbook.xlsx.writeFile(resolve(releaseDir, `${playerCount}人选手测试数据.xlsx`));
}

await writePlayerTestWorkbook(16);
await writePlayerTestWorkbook(32);

console.log(`Release package generated: ${releaseDir}`);
