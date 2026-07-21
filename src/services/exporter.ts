import ExcelJS from "exceljs";
import { getEndReasonLabel, getWinnerLabel } from "../domain/rules";
import { downloadBlob } from "./download";
import type {
  BracketNode,
  Match,
  TournamentFormat,
  TournamentRanking,
  TournamentStageType,
  TournamentState,
} from "../types";

type ExportCell = string | number;
type ExportRow = Record<string, ExportCell>;

function buildRows(matches: Match[]): ExportRow[] {
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
          const value = String(row[header] ?? "");
          return `"${value.replace(/"/g, '""')}"`;
        })
        .join(",")
    ),
  ].join("\n")}`;
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "heima-record-results.csv");
}

export async function exportMatchesToExcel(matches: Match[]) {
  const workbook = new ExcelJS.Workbook();
  addTableWorksheet(workbook, "比赛结果", Object.keys(buildRows(matches)[0] ?? { 场次编号: "" }), buildRows(matches));
  await downloadWorkbook(workbook, "heima-record-results.xlsx");
}

export async function exportTournamentResultsToExcel(state: TournamentState, liveRankings: TournamentRanking[]) {
  const workbook = buildTournamentResultsWorkbook(state, liveRankings);
  await downloadWorkbook(workbook, "heima-record-tournament-results.xlsx");
}

export function buildTournamentResultsWorkbook(state: TournamentState, liveRankings: TournamentRanking[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "heima-record";
  workbook.created = new Date();

  const finalResult = resolveFinalResult(state);
  addTableWorksheet(workbook, "赛事摘要", ["项目", "内容"], buildSummaryRows(state, finalResult));
  addTableWorksheet(workbook, "最终名次", ["名次", "选手", "单位", "阶段结果", "负场数", "备注"], buildFinalRankingRows(state, finalResult));
  addTableWorksheet(
    workbook,
    "预赛排名",
    ["分组或阶段", "名次", "选手", "单位", "积分", "真实胜场", "平局", "负场", "净胜分", "纪律扣分", "是否晋级", "是否需要附加赛"],
    buildPreliminaryRankingRows(state, liveRankings)
  );
  addTableWorksheet(workbook, "淘汰签表", ["阶段", "轮次", "节点", "红方", "蓝方", "比分", "胜方", "状态"], buildBracketRows(state));
  addTableWorksheet(workbook, "全部场次", Object.keys(buildRows(state.matches)[0] ?? { 场次编号: "" }), buildRows(state.matches));

  return workbook;
}

function buildSummaryRows(state: TournamentState, result: FinalResult): ExportRow[] {
  const completedMatches = state.matches.filter((match) => match.status === "finished").length;
  const activePlayers = state.event.players.filter((player) => player.status === "active");
  return [
    { 项目: "赛事名称", 内容: state.name || "未命名赛事" },
    { 项目: "赛制", 内容: tournamentFormatLabel(state.event.formatConfig.format) },
    { 项目: "参赛人数", 内容: activePlayers.length },
    { 项目: "场次数", 内容: state.matches.length },
    { 项目: "已完成场次数", 内容: completedMatches },
    { 项目: "冠军", 内容: playerName(state, result.championPlayerId) },
    { 项目: "亚军", 内容: playerName(state, result.runnerUpPlayerId) },
    { 项目: "季军", 内容: playerName(state, result.thirdPlacePlayerId) },
    { 项目: "完赛状态", 内容: result.isFinished ? "赛事已完成" : "未完赛结果" },
    { 项目: "导出时间", 内容: new Date().toLocaleString("zh-CN", { hour12: false }) },
  ];
}

function buildFinalRankingRows(state: TournamentState, result: FinalResult): ExportRow[] {
  const losses = calculateBracketLosses(state.event.bracketNodes);
  const knownRanks = new Map<string, number>();
  if (result.championPlayerId) knownRanks.set(result.championPlayerId, 1);
  if (result.runnerUpPlayerId) knownRanks.set(result.runnerUpPlayerId, 2);
  if (result.thirdPlacePlayerId) knownRanks.set(result.thirdPlacePlayerId, 3);

  const activePlayers = state.event.players.filter((player) => player.status === "active");
  return [...activePlayers]
    .sort((a, b) => {
      const rankA = knownRanks.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const rankB = knownRanks.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      return (a.seed ?? Number.MAX_SAFE_INTEGER) - (b.seed ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name, "zh-CN");
    })
    .map((player) => {
      const rank = knownRanks.get(player.id);
      const lossCount = losses.get(player.id) ?? 0;
      return {
        名次: rank ?? "",
        选手: player.name,
        单位: player.club,
        阶段结果: rank === 1 ? "冠军" : rank === 2 ? "亚军" : rank === 3 ? "季军" : finalStageResult(state, result, lossCount),
        负场数: state.event.formatConfig.format === "double_elimination" ? lossCount : "",
        备注: result.isFinished ? (rank ? "" : "其余完整名次待后续版本完善") : "未完赛结果",
      };
    });
}

function buildPreliminaryRankingRows(state: TournamentState, rankings: TournamentRanking[]): ExportRow[] {
  const format = state.event.formatConfig.format;
  if (format !== "group_bracket" && format !== "swiss_bracket") return [];
  return rankings.map((ranking) => ({
    分组或阶段: format === "swiss_bracket" ? "瑞士轮" : ranking.groupName,
    名次: ranking.rank,
    选手: ranking.name,
    单位: ranking.club,
    积分: ranking.eventPoints,
    真实胜场: ranking.realWins,
    平局: ranking.draws,
    负场: ranking.losses,
    净胜分: ranking.scoreDiff,
    纪律扣分: ranking.disciplinePenalty,
    是否晋级: ranking.advanced ? "是" : "否",
    是否需要附加赛: ranking.needsPlayoff ? "是" : "否",
  }));
}

function buildBracketRows(state: TournamentState): ExportRow[] {
  const matchesById = new Map(state.matches.map((match) => [match.id, match]));
  return state.event.bracketNodes.map((node) => {
    const match = node.matchId ? matchesById.get(node.matchId) : undefined;
    return {
      阶段: bracketStageLabel(node.stage),
      轮次: node.roundNo,
      节点: node.label,
      红方: playerName(state, node.redPlayerId) || match?.red.name || "",
      蓝方: playerName(state, node.bluePlayerId) || match?.blue.name || (node.status === "bye" ? "轮空" : ""),
      比分: match ? `${match.redScore}:${match.blueScore}` : node.status === "bye" ? "轮空" : "",
      胜方: playerName(state, node.winnerPlayerId) || (match ? getWinnerLabel(match.winner, match) : ""),
      状态: bracketStatusLabel(node.status),
    };
  });
}

type FinalResult = {
  championPlayerId: string | null;
  runnerUpPlayerId: string | null;
  thirdPlacePlayerId: string | null;
  isFinished: boolean;
};

function resolveFinalResult(state: TournamentState): FinalResult {
  const nodes = state.event.bracketNodes;
  const isDoubleElimination = state.event.formatConfig.format === "double_elimination";
  const explicitFinal = isDoubleElimination
    ? lastNode(nodes.filter((node) => node.stage === "grand_final"))
    : lastNode(nodes.filter((node) => node.stage === "bracket" && node.label === "决赛"));
  // 两人直接单败的首轮就是最终决赛，赛事完成后需要把这个唯一的末轮节点作为决赛识别。
  const fallbackFinal = !isDoubleElimination && state.event.stage === "finished"
    ? lastNode(nodes.filter((node) => node.stage === "bracket"))
    : undefined;
  const finalNode = explicitFinal ?? fallbackFinal;
  const thirdPlaceNode = lastNode(nodes.filter((node) => node.stage === "third_place"));
  const isFinished = state.event.stage === "finished" && finalNode?.status === "finished";

  return {
    championPlayerId: finalNode?.status === "finished" ? finalNode.winnerPlayerId : null,
    runnerUpPlayerId: finalNode?.status === "finished" ? finalNode.loserPlayerId : null,
    thirdPlacePlayerId: thirdPlaceNode?.status === "finished" ? thirdPlaceNode.winnerPlayerId : null,
    isFinished,
  };
}

function lastNode(nodes: BracketNode[]) {
  return [...nodes].sort((a, b) => b.roundNo - a.roundNo)[0];
}

function calculateBracketLosses(nodes: BracketNode[]) {
  const losses = new Map<string, number>();
  nodes.filter((node) => node.status === "finished" && node.loserPlayerId).forEach((node) => {
    const playerId = node.loserPlayerId as string;
    losses.set(playerId, (losses.get(playerId) ?? 0) + 1);
  });
  return losses;
}

function finalStageResult(state: TournamentState, result: FinalResult, lossCount: number) {
  if (!result.isFinished) return "名次待定";
  if (state.event.formatConfig.format === "double_elimination") return lossCount >= 2 ? "已淘汰" : "赛事完成";
  return "已淘汰";
}

function playerName(state: TournamentState, playerId: string | null) {
  if (!playerId) return "";
  return state.event.players.find((player) => player.id === playerId)?.name ?? "";
}

function tournamentFormatLabel(format: TournamentFormat) {
  const labels: Record<TournamentFormat, string> = {
    group_bracket: "小组循环 + 单败淘汰赛",
    swiss_bracket: "瑞士轮 + 单败淘汰赛",
    direct_bracket: "直接单败淘汰赛",
    double_elimination: "双败淘汰赛",
  };
  return labels[format];
}

function bracketStageLabel(stage: TournamentStageType) {
  const labels: Partial<Record<TournamentStageType, string>> = {
    bracket: "单败淘汰",
    third_place: "季军赛",
    winner_bracket: "胜者组",
    loser_bracket: "败者组",
    grand_final: "总决赛",
  };
  return labels[stage] ?? "淘汰赛";
}

function bracketStatusLabel(status: BracketNode["status"]) {
  const labels: Record<BracketNode["status"], string> = {
    bye: "轮空",
    ready: "待比赛",
    finished: "已完成",
  };
  return labels[status];
}

function addTableWorksheet(workbook: ExcelJS.Workbook, name: string, headers: string[], rows: ExportRow[]) {
  const worksheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  worksheet.columns = headers.map((header) => ({ header, key: header, width: Math.max(12, header.length + 4) }));
  rows.forEach((row) => worksheet.addRow(row));
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).alignment = { vertical: "middle" };
  worksheet.columns.forEach((column) => {
    let width = column.width ?? 12;
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      width = Math.min(40, Math.max(width, String(cell.value ?? "").length + 2));
      cell.alignment = { ...cell.alignment, vertical: "top", wrapText: true };
    });
    column.width = width;
  });
  worksheet.autoFilter = headers.length ? { from: "A1", to: `${excelColumnName(headers.length)}1` } : undefined;
}

function excelColumnName(columnNumber: number) {
  let current = columnNumber;
  let name = "";
  while (current > 0) {
    current -= 1;
    name = String.fromCharCode(65 + (current % 26)) + name;
    current = Math.floor(current / 26);
  }
  return name;
}

async function downloadWorkbook(workbook: ExcelJS.Workbook, filename: string) {
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
}
