import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = resolve(root, "release", "heima-record");
const expectedFiles = [
  "index.html",
  "使用说明.pdf",
  "赛事验收清单.pdf",
  "示例导入模板.csv",
  "规则配置模板.xlsx",
  "16人选手测试数据.xlsx",
  "32人选手测试数据.xlsx",
];

const actualFiles = readdirSync(releaseDir).sort();
if (actualFiles.length !== expectedFiles.length) {
  throw new Error(`发布包文件数量应为 ${expectedFiles.length}，实际为 ${actualFiles.length}。`);
}
const missingFiles = expectedFiles.filter((filename) => !actualFiles.includes(filename));
if (missingFiles.length > 0) {
  throw new Error(`发布包缺少文件：${missingFiles.join("、")}`);
}

expectedFiles.forEach((filename) => {
  const filePath = resolve(releaseDir, filename);
  if (statSync(filePath).size === 0) throw new Error(`发布文件为空：${filename}`);
});

const html = readFileSync(resolve(releaseDir, "index.html"), "utf8");
if (!html.includes("<style>") || !html.includes('<script type="module">')) {
  throw new Error("index.html 未完整内联样式或脚本。");
}
if (/<script[^>]+src=|<link[^>]+href=["'][^"']+\.css/.test(html)) {
  throw new Error("index.html 仍包含外部脚本或样式引用。");
}

const csv = readFileSync(resolve(releaseDir, "示例导入模板.csv"));
if (csv[0] !== 0xef || csv[1] !== 0xbb || csv[2] !== 0xbf) {
  throw new Error("示例导入模板.csv 不是 UTF-8 BOM 编码。");
}

for (const pdfName of ["使用说明.pdf", "赛事验收清单.pdf"]) {
  const pdf = readFileSync(resolve(releaseDir, pdfName));
  if (pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error(`${pdfName} 不是有效的 PDF 文件。`);
  }
  if (pdf.length < 10_000) {
    throw new Error(`${pdfName} 文件大小异常。`);
  }
}

async function verifyPlayerWorkbook(playerCount) {
  const filename = `${playerCount}人选手测试数据.xlsx`;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolve(releaseDir, filename));
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.name !== "选手名单") {
    throw new Error(`${filename} 首个工作表必须为“选手名单”。`);
  }

  const headers = [1, 2, 3].map((column) => String(sheet.getCell(1, column).value ?? ""));
  if (headers.join("|") !== "姓名|单位|种子") {
    throw new Error(`${filename} 表头不符合选手导入格式。`);
  }
  if (sheet.actualRowCount !== playerCount + 1) {
    throw new Error(`${filename} 应包含 ${playerCount} 名选手。`);
  }

  const names = new Set();
  for (let rowNumber = 2; rowNumber <= playerCount + 1; rowNumber += 1) {
    const name = String(sheet.getCell(rowNumber, 1).value ?? "").trim();
    const club = String(sheet.getCell(rowNumber, 2).value ?? "").trim();
    const seed = Number(sheet.getCell(rowNumber, 3).value);
    if (!name || !club || seed !== rowNumber - 1) {
      throw new Error(`${filename} 第 ${rowNumber} 行数据不完整或种子序号错误。`);
    }
    names.add(name);
  }
  if (names.size !== playerCount) {
    throw new Error(`${filename} 存在重复选手姓名。`);
  }
}

await verifyPlayerWorkbook(16);
await verifyPlayerWorkbook(32);

console.log(`Release package verified: ${expectedFiles.length} required files are ready.`);
