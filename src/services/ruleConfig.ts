import ExcelJS from "exceljs";
import Papa from "papaparse";
import { defaultRuleSet, normalizeRuleSet } from "../domain/rules";
import { downloadBlob } from "./download";
import type { HitZone, PenaltyStopResult, RuleSet, WarningConversion, WarningLevel } from "../types";

type Row = Record<string, unknown>;

function normalizeValue(value: unknown) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim();
}

function pick(row: Row, aliases: string[]) {
  const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeValue(key), value]));
  const key = aliases.find((alias) => Object.prototype.hasOwnProperty.call(normalized, alias));
  return key ? normalizeValue(normalized[key]) : "";
}

function parseBoolean(value: string) {
  return ["是", "true", "TRUE", "1", "yes", "启用"].includes(value);
}

function parseNumber(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseStopResult(value: string): PenaltyStopResult {
  const normalized = value.toLowerCase();
  if (normalized === "self_win" || value === "本人胜") return "self_win";
  if (normalized === "draw" || value === "平局") return "draw";
  if (normalized === "manual" || value === "手动判定") return "manual";
  return "opponent_win";
}

function rowsToBaseRules(rows: Row[], currentRuleSet: RuleSet): Partial<RuleSet> {
  const entries = Object.fromEntries(rows.map((row) => [pick(row, ["规则项", "key"]), pick(row, ["规则值", "value"])]));
  const scoringModeValue = entries.scoringMode || entries["计分模式"];
  return {
    scoringMode: scoringModeValue === "round_limit" || scoringModeValue === "限制回合模式" ? "round_limit" : currentRuleSet.scoringMode,
    durationSeconds: parseNumber(entries.durationSeconds || entries["比赛时长"], currentRuleSet.durationSeconds),
    targetScore: parseNumber(entries.targetScore || entries["目标分"], currentRuleSet.targetScore),
    maxRounds: parseNumber(entries.maxRounds || entries["最大回合数"], currentRuleSet.maxRounds),
    allowDoubleHit: entries.allowDoubleHit || entries["允许双方得分"] ? parseBoolean(entries.allowDoubleHit || entries["允许双方得分"]) : currentRuleSet.allowDoubleHit,
    allowNoHitRound: entries.allowNoHitRound || entries["允许无效回合"] ? parseBoolean(entries.allowNoHitRound || entries["允许无效回合"]) : currentRuleSet.allowNoHitRound,
    allowDraw: entries.allowDraw || entries["允许平局"] ? parseBoolean(entries.allowDraw || entries["允许平局"]) : currentRuleSet.allowDraw,
    enableOvertime: entries.enableOvertime || entries["启用加时"] ? parseBoolean(entries.enableOvertime || entries["启用加时"]) : currentRuleSet.enableOvertime,
    overtimeSeconds: parseNumber(entries.overtimeSeconds || entries["加时时长"], currentRuleSet.overtimeSeconds),
    maxPenaltyCount: parseNumber(entries.maxPenaltyCount || entries["处罚判负次数"], currentRuleSet.maxPenaltyCount),
  };
}

function rowsToHitZones(rows: Row[]): HitZone[] {
  return rows
    .map((row) => ({
      id: pick(row, ["部位ID", "id", "zoneId"]),
      label: pick(row, ["部位名称", "名称", "label", "zoneLabel"]),
      score: parseNumber(pick(row, ["分值", "score"]), 0),
      enabled: parseBoolean(pick(row, ["启用", "enabled"])) || pick(row, ["启用", "enabled"]) === "",
    }))
    .filter((item) => item.id && item.label);
}

function rowsToWarningLevels(rows: Row[]): WarningLevel[] {
  return rows
    .map((row) => {
      const isForfeit = parseBoolean(pick(row, ["是否判负", "isForfeit"]));
      return {
        id: pick(row, ["警告ID", "id", "warningId"]),
        label: pick(row, ["警告名称", "名称", "label", "warningLabel"]),
        scoreDelta: -Math.abs(parseNumber(pick(row, ["扣分", "scoreDelta"]), 0)),
        isPenalty: parseBoolean(pick(row, ["是否处罚", "isPenalty"])),
        isForfeit,
        stopsMatch: parseBoolean(pick(row, ["是否中止比赛", "stopsMatch"])) || isForfeit,
        stopResult: parseStopResult(pick(row, ["中止结果", "stopResult"])),
      };
    })
    .filter((item) => item.id && item.label);
}

function rowsToWarningConversions(rows: Row[]): WarningConversion[] {
  return rows
    .map((row) => ({
      fromWarningId: pick(row, ["来源警告ID", "fromWarningId", "from"]),
      count: parseNumber(pick(row, ["累计次数", "count"]), 0),
      toWarningId: pick(row, ["转换为警告ID", "toWarningId", "to"]),
    }))
    .filter((item) => item.fromWarningId && item.toWarningId && item.count > 0);
}

function sheetToRows(sheet: ExcelJS.Worksheet): Row[] {
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
  return rows;
}

export async function parseRuleFile(file: File, currentRuleSet: RuleSet): Promise<RuleSet> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv") {
    const result = Papa.parse<Row>(await file.text(), { header: true, skipEmptyLines: true });
    const rows = result.data;
    const first = rows[0] ?? {};
    const keys = Object.keys(first).map(normalizeValue);

    if (keys.includes("规则项")) return normalizeRuleSet({ ...currentRuleSet, ...rowsToBaseRules(rows, currentRuleSet) });
    if (keys.includes("部位ID")) return normalizeRuleSet({ ...currentRuleSet, hitZones: rowsToHitZones(rows) });
    if (keys.includes("警告ID")) return normalizeRuleSet({ ...currentRuleSet, warningLevels: rowsToWarningLevels(rows) });
    if (keys.includes("来源警告ID")) return normalizeRuleSet({ ...currentRuleSet, warningConversions: rowsToWarningConversions(rows) });
    throw new Error("CSV 表头无法识别，请使用部位分值、警告分级或警告转换模板。");
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const hitSheet = workbook.getWorksheet("部位分值");
  const warningSheet = workbook.getWorksheet("警告分级");
  const conversionSheet = workbook.getWorksheet("警告转换");
  const baseSheet = workbook.getWorksheet("基础规则");

  return normalizeRuleSet({
    ...currentRuleSet,
    ...(baseSheet ? rowsToBaseRules(sheetToRows(baseSheet), currentRuleSet) : {}),
    hitZones: hitSheet ? rowsToHitZones(sheetToRows(hitSheet)) : currentRuleSet.hitZones,
    warningLevels: warningSheet ? rowsToWarningLevels(sheetToRows(warningSheet)) : currentRuleSet.warningLevels,
    warningConversions: conversionSheet ? rowsToWarningConversions(sheetToRows(conversionSheet)) : currentRuleSet.warningConversions,
  });
}

export async function exportRuleSetToExcel(ruleSet: RuleSet, filename = "heima-record-rules.xlsx") {
  const workbook = new ExcelJS.Workbook();

  const baseSheet = workbook.addWorksheet("基础规则");
  baseSheet.columns = [
    { header: "规则项", key: "key", width: 20 },
    { header: "规则值", key: "value", width: 20 },
    { header: "说明", key: "description", width: 32 },
  ];
  [
    { key: "计分模式", value: ruleSet.scoringMode, description: "target_score 或 round_limit" },
    { key: "比赛时长", value: ruleSet.durationSeconds, description: "秒" },
    { key: "目标分", value: ruleSet.targetScore, description: "目标分模式使用" },
    { key: "最大回合数", value: ruleSet.maxRounds, description: "限制回合模式使用" },
    { key: "允许双方得分", value: ruleSet.allowDoubleHit ? "是" : "否", description: "限制回合模式使用" },
    { key: "允许无效回合", value: ruleSet.allowNoHitRound ? "是" : "否", description: "限制回合模式使用" },
    { key: "允许平局", value: ruleSet.allowDraw ? "是" : "否", description: "时间到或回合打满后使用" },
    { key: "启用加时", value: ruleSet.enableOvertime ? "是" : "否", description: "目标分模式使用" },
    { key: "加时时长", value: ruleSet.overtimeSeconds, description: "秒" },
    { key: "处罚判负次数", value: ruleSet.maxPenaltyCount, description: "处罚累计次数" },
  ].forEach((row) => baseSheet.addRow(row));

  const hitSheet = workbook.addWorksheet("部位分值");
  hitSheet.columns = [
    { header: "部位ID", key: "id", width: 14 },
    { header: "部位名称", key: "label", width: 14 },
    { header: "分值", key: "score", width: 10 },
    { header: "启用", key: "enabled", width: 10 },
  ];
  ruleSet.hitZones.forEach((item) => hitSheet.addRow({ ...item, enabled: item.enabled ? "是" : "否" }));

  const warningSheet = workbook.addWorksheet("警告分级");
  warningSheet.columns = [
    { header: "警告ID", key: "id", width: 16 },
    { header: "警告名称", key: "label", width: 16 },
    { header: "扣分", key: "scoreDelta", width: 10 },
    { header: "是否处罚", key: "isPenalty", width: 12 },
    { header: "是否判负", key: "isForfeit", width: 12 },
    { header: "是否中止比赛", key: "stopsMatch", width: 16 },
    { header: "中止结果", key: "stopResult", width: 16 },
  ];
  ruleSet.warningLevels.forEach((item) =>
    warningSheet.addRow({
      ...item,
      scoreDelta: Math.abs(item.scoreDelta),
      isPenalty: item.isPenalty ? "是" : "否",
      isForfeit: item.isForfeit ? "是" : "否",
      stopsMatch: item.stopsMatch ? "是" : "否",
      stopResult: stopResultText(item.stopResult),
    })
  );

  const conversionSheet = workbook.addWorksheet("警告转换");
  conversionSheet.columns = [
    { header: "来源警告ID", key: "fromWarningId", width: 18 },
    { header: "累计次数", key: "count", width: 12 },
    { header: "转换为警告ID", key: "toWarningId", width: 18 },
  ];
  ruleSet.warningConversions.forEach((item) => conversionSheet.addRow(item));

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
}

export const templateRuleSet = defaultRuleSet;

function stopResultText(result: PenaltyStopResult) {
  const labels: Record<PenaltyStopResult, string> = {
    opponent_win: "对方胜",
    self_win: "本人胜",
    draw: "平局",
    manual: "手动判定",
  };
  return labels[result];
}
