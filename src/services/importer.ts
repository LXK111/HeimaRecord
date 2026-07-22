import Papa from "papaparse";
import ExcelJS from "exceljs";
import { createEmptyMatch, createMatchEvent, normalizeRuleSet } from "../domain/rules";
import type { Match, MatchRuleProfileKey, RuleSet, TournamentStageRuleConfig, TournamentStageType } from "../types";

type Row = Record<string, unknown>;

export interface MatchImportPackage {
  matches: Match[];
  eventId?: string;
  name?: string;
  ruleSet?: RuleSet;
  stageRuleConfig?: TournamentStageRuleConfig;
  startedAt?: string | null;
  rulesLockedAt?: string | null;
}

const headerAliases: Record<string, string[]> = {
  eventId: ["赛事ID", "eventId", "event_id"],
  matchId: ["场次ID", "matchId", "match_id"],
  ruleProfile: ["规则档位", "ruleProfile", "rule_profile"],
  tournamentStage: ["赛事阶段代码", "tournamentStage", "tournament_stage"],
  tournamentRound: ["赛事轮次", "tournamentRound", "tournament_round"],
  remainingSeconds: ["剩余秒数", "remainingSeconds", "remaining_seconds"],
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
    const importedId = pick(row, "matchId") || match.id;
    matches.push({
      ...match,
      id: importedId,
      eventId: pick(row, "eventId") || undefined,
      ruleProfile: (pick(row, "ruleProfile") || undefined) as MatchRuleProfileKey | undefined,
      tournamentStage: (pick(row, "tournamentStage") || undefined) as TournamentStageType | undefined,
      tournamentRound: Number(pick(row, "tournamentRound")) || undefined,
      remainingSeconds: Number(pick(row, "remainingSeconds")) || match.remainingSeconds,
      events: [createMatchEvent(importedId, "match_created", "导入生成场次")],
    });
  });
  return matches;
}

export async function parseMatchFile(file: File, ruleSet: RuleSet): Promise<Match[]> {
  return (await parseMatchImportPackage(file, ruleSet)).matches;
}

export async function parseMatchImportPackage(file: File, ruleSet: RuleSet): Promise<MatchImportPackage> {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "csv") {
    const text = await file.text();
    const result = Papa.parse<Row>(text, {
      header: true,
      skipEmptyLines: true,
    });
    return { matches: rowsToMatches(result.data, ruleSet) };
  }

  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const firstSheet = workbook.getWorksheet("编排场次") ?? workbook.worksheets[0];
  if (!firstSheet) return { matches: [] };

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
  const metadataSheet = workbook.getWorksheet("赛事信息");
  const metadata = new Map<string, string>();
  metadataSheet?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    metadata.set(normalizeValue(row.getCell(1).value), normalizeValue(row.getCell(2).value));
  });
  const importedRuleSet = parseJson<RuleSet>(metadata.get("基础规则JSON"));
  const stageRuleConfig = parseJson<TournamentStageRuleConfig>(metadata.get("阶段规则JSON"));
  return {
    matches: rowsToMatches(rows, importedRuleSet ? normalizeRuleSet(importedRuleSet) : ruleSet),
    eventId: metadata.get("赛事ID") || undefined,
    name: metadata.get("赛事名称") || undefined,
    ruleSet: importedRuleSet ? normalizeRuleSet(importedRuleSet) : undefined,
    stageRuleConfig,
    startedAt: metadata.get("赛事开始时间") || null,
    rulesLockedAt: metadata.get("规则冻结时间") || null,
  };
}

function parseJson<T>(value?: string): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}
