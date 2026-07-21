import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = resolve(root, "release", "heima-record");
const expectedFiles = [
  "index.html",
  "使用说明.md",
  "赛事验收清单.md",
  "示例导入模板.csv",
  "规则配置模板.xlsx",
];

const actualFiles = readdirSync(releaseDir).sort();
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

const acceptanceGuide = readFileSync(resolve(releaseDir, "赛事验收清单.md"), "utf8");
if (!acceptanceGuide.includes("赛事现场验收与交付说明") || !acceptanceGuide.includes("E2 TODO")) {
  throw new Error("赛事验收清单缺少标题或 E2 TODO 边界说明。");
}

console.log(`Release package verified: ${expectedFiles.length} required files are ready.`);
