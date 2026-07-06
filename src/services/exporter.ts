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
    红方警告: Object.entries(match.redWarnings ?? {}).map(([id, count]) => `${id}:${count}`).join("；"),
    蓝方警告: Object.entries(match.blueWarnings ?? {}).map(([id, count]) => `${id}:${count}`).join("；"),
    红方处罚: match.redPenalties,
    蓝方处罚: match.bluePenalties,
    计分模式: match.roundRecords?.length ? "限制回合" : "目标分/基础计分",
    回合记录: (match.roundRecords ?? []).map((round) => `第${round.roundNumber}回合:${round.result}`).join("；"),
    胜方: getWinnerLabel(match.winner, match),
    结束原因: getEndReasonLabel(match.endReason),
    状态: match.status,
    申诉记录: match.events.filter((event) => event.type === "appeal_recorded").map((event) => event.label).join("；"),
    赛后修正: match.events.filter((event) => event.type === "post_match_adjustment").map((event) => event.label).join("；"),
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
