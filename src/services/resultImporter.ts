import ExcelJS from "exceljs";
import Papa from "papaparse";
import type { MatchEndReason, MatchEvent, MatchStatus, RoundRecord, TournamentState, Winner } from "../types";

type Row = Record<string, unknown>;

export interface ResultImportReport {
  applied: number;
  duplicates: number;
  conflicts: string[];
  skipped: number;
  eventMismatch: boolean;
}

export interface ImportedResult {
  eventId: string;
  matchId: string;
  status: MatchStatus;
  redScore: number;
  blueScore: number;
  redPenalties: number;
  bluePenalties: number;
  redWarnings: Record<string, number>;
  blueWarnings: Record<string, number>;
  winner: Winner;
  endReason: MatchEndReason;
  remainingSeconds: number;
  isOvertime: boolean;
  currentRound: number;
  roundRecords: RoundRecord[];
  events: MatchEvent[];
  updatedAt: string;
}

export async function parseTournamentResultFile(file: File): Promise<ImportedResult[]> {
  const rows = file.name.toLowerCase().endsWith(".csv")
    ? parseCsvRows(await file.text())
    : await parseWorkbookRows(await file.arrayBuffer());
  return rows.map(toImportedResult).filter((result): result is ImportedResult => Boolean(result));
}

export function mergeTournamentResults(
  state: TournamentState,
  importedResults: ImportedResult[]
): { state: TournamentState; report: ResultImportReport } {
  const report: ResultImportReport = { applied: 0, duplicates: 0, conflicts: [], skipped: 0, eventMismatch: false };
  const relevant = importedResults.filter((result) => {
    if (result.eventId === state.event.id) return true;
    report.eventMismatch = true;
    report.skipped += 1;
    return false;
  });
  const byId = new Map(relevant.map((result) => [result.matchId, result]));
  const matches = state.matches.map((match) => {
    const incoming = byId.get(match.id);
    if (!incoming) return match;
    byId.delete(match.id);
    if (incoming.status !== "finished") {
      report.skipped += 1;
      return match;
    }
    if (match.status === "finished") {
      if (resultFingerprint(match) === resultFingerprint(incoming)) report.duplicates += 1;
      else report.conflicts.push(`${match.matchNo}（${match.red.name} vs ${match.blue.name}）`);
      return match;
    }
    report.applied += 1;
    return {
      ...match,
      redScore: incoming.redScore,
      blueScore: incoming.blueScore,
      redPenalties: incoming.redPenalties,
      bluePenalties: incoming.bluePenalties,
      redWarnings: incoming.redWarnings,
      blueWarnings: incoming.blueWarnings,
      winner: incoming.winner,
      endReason: incoming.endReason,
      remainingSeconds: incoming.remainingSeconds,
      isOvertime: incoming.isOvertime,
      currentRound: incoming.currentRound,
      roundRecords: incoming.roundRecords,
      events: incoming.events.map((event) => ({ ...event, matchId: match.id })),
      status: "finished" as const,
      updatedAt: incoming.updatedAt || new Date().toISOString(),
    };
  });
  report.skipped += byId.size;
  return { state: { ...state, matches, updatedAt: new Date().toISOString() }, report };
}

function parseCsvRows(text: string) {
  return Papa.parse<Row>(text, { header: true, skipEmptyLines: true }).data;
}

async function parseWorkbookRows(buffer: ArrayBuffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet("全部场次") ?? workbook.getWorksheet("比赛结果") ?? workbook.getWorksheet("编排场次") ?? workbook.worksheets[0];
  if (!sheet) return [];
  const headers: string[] = [];
  sheet.getRow(1).eachCell((cell, columnNumber) => { headers[columnNumber - 1] = normalize(cell.value); });
  const rows: Row[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const item: Row = {};
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => { item[headers[columnNumber - 1] ?? `column_${columnNumber}`] = cell.value; });
    rows.push(item);
  });
  return rows;
}

function toImportedResult(row: Row): ImportedResult | null {
  const eventId = value(row, "赛事ID");
  const matchId = value(row, "场次ID");
  if (!eventId || !matchId) return null;
  const status = value(row, "状态") as MatchStatus;
  return {
    eventId,
    matchId,
    status: status === "finished" ? status : status === "running" || status === "paused" ? status : "pending",
    redScore: numberValue(row, "红方得分"),
    blueScore: numberValue(row, "蓝方得分"),
    redPenalties: numberValue(row, "红方处罚"),
    bluePenalties: numberValue(row, "蓝方处罚"),
    redWarnings: jsonValue(row, "红方警告JSON", {}),
    blueWarnings: jsonValue(row, "蓝方警告JSON", {}),
    winner: winnerValue(value(row, "胜方代码")),
    endReason: endReasonValue(value(row, "结束原因代码")),
    remainingSeconds: numberValue(row, "剩余秒数"),
    isOvertime: value(row, "是否加时") === "1" || value(row, "是否加时").toLowerCase() === "true",
    currentRound: Math.max(1, numberValue(row, "当前回合") || 1),
    roundRecords: jsonValue<RoundRecord[]>(row, "回合记录JSON", []),
    events: jsonValue<MatchEvent[]>(row, "操作记录JSON", []),
    updatedAt: new Date().toISOString(),
  };
}

function resultFingerprint(result: Pick<ImportedResult, "redScore" | "blueScore" | "redPenalties" | "bluePenalties" | "redWarnings" | "blueWarnings" | "winner" | "endReason" | "roundRecords">) {
  return JSON.stringify({
    redScore: result.redScore,
    blueScore: result.blueScore,
    redPenalties: result.redPenalties,
    bluePenalties: result.bluePenalties,
    redWarnings: result.redWarnings,
    blueWarnings: result.blueWarnings,
    winner: result.winner,
    endReason: result.endReason,
    roundRecords: result.roundRecords,
  });
}

function normalize(input: unknown) {
  return String(input ?? "").replace(/^\uFEFF/, "").trim();
}

function value(row: Row, key: string) {
  return normalize(row[key]);
}

function numberValue(row: Row, key: string) {
  return Number(value(row, key)) || 0;
}

function jsonValue<T>(row: Row, key: string, fallback: T): T {
  try {
    return JSON.parse(value(row, key)) as T;
  } catch {
    return fallback;
  }
}

function winnerValue(value: string): Winner {
  return value === "red" || value === "blue" || value === "draw" ? value : null;
}

function endReasonValue(value: string): MatchEndReason {
  return value === "target_score" || value === "round_limit" || value === "time_up" || value === "manual" || value === "forfeit" || value === "draw" ? value : null;
}
