import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = resolve(root, "release");
const releaseDir = resolve(releaseRoot, "heima-record");

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
copyFileSync(resolve(root, "docs", "使用说明.md"), resolve(releaseDir, "使用说明.md"));

const sampleCsv = readFileSync(resolve(root, "release-assets", "示例导入模板.csv"), "utf8");
writeFileSync(
  resolve(releaseDir, "示例导入模板.csv"),
  sampleCsv.startsWith("\uFEFF") ? sampleCsv : `\uFEFF${sampleCsv}`,
  "utf8"
);

console.log(`Release package generated: ${releaseDir}`);
