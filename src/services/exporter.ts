import ExcelJS from "exceljs";
import { getEndReasonLabel, getWinnerLabel } from "../domain/rules";
import { downloadBlob } from "./download";
import type { Match } from "../types";

function buildRows(matches: Match[]) {
  return matches.map((match) => ({
    场次编号: match.matchNo,
    组别: match.groupName,
    场地: match.piste,
    红方: match.red.name,
    红方单位: match.red.club,
    蓝方: match.blue.name,
    蓝方单位: match.blue.club,
    红方得分: match.redScore,
    蓝方得分: match.blueScore,
    红方处罚: match.redPenalties,
    蓝方处罚: match.bluePenalties,
    胜方: getWinnerLabel(match.winner, match),
    结束原因: getEndReasonLabel(match.endReason),
    状态: match.status,
    记录: match.events.map((event) => event.label).join("；"),
  }));
}

export function exportMatchesToCsv(matches: Match[]) {
  const rows = buildRows(matches);
  const headers = Object.keys(rows[0] ?? { 场次编号: "" });
  const csv = `\uFEFF${[
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => {
          const value = String(row[header as keyof typeof row] ?? "");
          return `"${value.replace(/"/g, '""')}"`;
        })
        .join(",")
    ),
  ].join("\n")}`;
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "heima-record-results.csv");
}

export async function exportMatchesToExcel(matches: Match[]) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("比赛结果");
  const rows = buildRows(matches);
  worksheet.columns = Object.keys(rows[0] ?? { 场次编号: "" }).map((header) => ({
    header,
    key: header,
    width: Math.max(12, header.length + 4),
  }));
  rows.forEach((row) => worksheet.addRow(row));
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "heima-record-results.xlsx");
}
