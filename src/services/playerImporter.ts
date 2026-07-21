import ExcelJS from "exceljs";
import Papa from "papaparse";
import { createTournamentPlayer } from "../domain/tournament";
import type { TournamentPlayer } from "../types";

type Row = Record<string, unknown>;

const headerAliases = {
  name: ["姓名", "选手", "选手姓名", "name", "playerName", "player"],
  club: ["单位", "俱乐部", "club", "team", "organization"],
  seed: ["种子", "种子序号", "seed", "seedNo"],
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

function rowsToPlayers(rows: Row[]): TournamentPlayer[] {
  return rows
    .map((row, index) => {
      const name = pick(row, "name");
      if (!name) return null;
      return createTournamentPlayer({
        name,
        club: pick(row, "club"),
        seed: Number(pick(row, "seed")) || index + 1,
      });
    })
    .filter((player): player is TournamentPlayer => Boolean(player));
}

export async function parsePlayerFile(file: File): Promise<TournamentPlayer[]> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv") {
    const result = Papa.parse<Row>(await file.text(), { header: true, skipEmptyLines: true });
    return rowsToPlayers(result.data);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headers: string[] = [];
  sheet.getRow(1).eachCell((cell, columnNumber) => {
    headers[columnNumber - 1] = normalizeValue(cell.value);
  });

  const rows: Row[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const data: Row = {};
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      data[headers[columnNumber - 1] ?? `column_${columnNumber}`] = normalizeValue(cell.value);
    });
    rows.push(data);
  });
  return rowsToPlayers(rows);
}
