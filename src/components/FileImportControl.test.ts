import { describe, expect, it } from "vitest";
import { acceptsFile, getImportFileError } from "./fileImport";

describe("acceptsFile", () => {
  it("在移动端未提供 MIME 时仍按扩展名接受 XLSX", () => {
    expect(acceptsFile({ name: "选手名单.XLSX", type: "" }, ".xlsx,.xls,.csv")).toBe(true);
  });

  it("接受 JSON MIME 类型", () => {
    expect(acceptsFile({ name: "backup", type: "application/json" }, ".json,application/json")).toBe(true);
  });

  it("拒绝不匹配的文件类型", () => {
    expect(acceptsFile({ name: "photo.png", type: "image/png" }, ".xlsx,.xls,.csv")).toBe(false);
  });

  it("拒绝页面同时拖入多个文件", () => {
    const files = [
      { name: "选手1.xlsx", type: "" },
      { name: "选手2.xlsx", type: "" },
    ] as File[];
    expect(getImportFileError(files, ".xlsx,.xls,.csv")).toBe("一次只能导入一个文件。");
  });
});
