import Papa from "papaparse";
import ExcelJS from "exceljs";
import { createEmptyMatch, createMatchEvent } from "../domain/rules";
import type { Match, RuleSet } from "../types";

type Row = Record<string, unknown>;

const headerAliases: Record<string, string[]> = {
  matchNo: ["场次编号", "场次", "matchNo", "match_no", "match", "编号"],
  groupName: ["组别", "分组", "group", "groupName", "group_name"],
  piste: ["场地", "赛场", "piste", "field", "area"],
  redName: ["红方姓名", "红方", "redName", "red_name", "red"],
  redClub: ["红方单位", "红方俱乐部", "redClub", "red_club"],
  blueName: ["蓝方姓名", "蓝方", "blueName", "blue_name", "blue"],
  blueClub: ["蓝方单位", "蓝方俱乐部", "blueClub", "blue_club"],
};

function normalizeValue(value: unknown) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim();
}

function pick(row: Row, field: keyof typeof headerAliases) {
  const normalizedRow = Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeValue(key), value]));
  const alias = headerAliases[field].find((key) => Object.prototype.hasOwnProperty.call(normalizedRow, key));
  return alias ? normalizeValue(normalizedRow[alias]) : "";
}

function rowsToMatches(rows: Row[], ruleSet: RuleSet): Match[] {
  const matches: Match[] = [];
  rows.forEach((row, index) => {
    const redName = pick(row, "redName");
    const blueName = pick(row, "blueName");
    if (!redName || !blueName) return;

    const match = createEmptyMatch({
      matchNo: pick(row, "matchNo") || `${index + 1}`,
      groupName: pick(row, "groupName") || "默认组",
      piste: pick(row, "piste") || "未分配",
      redName,
      redClub: pick(row, "redClub"),
      blueName,
      blueClub: pick(row, "blueClub"),
      ruleSet,
    });
    matches.push({
      ...match,
      events: [createMatchEvent(match.id, "match_created", "导入生成场次")],
    });
  });
  return matches;
}

export async function parseMatchFile(file: File, ruleSet: RuleSet): Promise<Match[]> {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "csv") {
    const text = await file.text();
    const result = Papa.parse<Row>(text, {
      header: true,
      skipEmptyLines: true,
    });
    return rowsToMatches(result.data, ruleSet);
  }

  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const firstSheet = workbook.worksheets[0];
  if (!firstSheet) return [];

  const headers: string[] = [];
  firstSheet.getRow(1).eachCell((cell, columnNumber) => {
    headers[columnNumber - 1] = normalizeValue(cell.value);
  });

  const rows: Row[] = [];
  firstSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const data: Row = {};
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      data[headers[columnNumber - 1] ?? `column_${columnNumber}`] = normalizeValue(cell.value);
    });
    rows.push(data);
  });
  return rowsToMatches(rows, ruleSet);
}
