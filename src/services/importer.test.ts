import { describe, expect, it } from "vitest";
import { createTournamentPlayer, generateGroupStage } from "../domain/tournament";
import { defaultRuleSet } from "../domain/rules";
import { buildArrangementWorkbook } from "./exporter";
import { parseMatchImportPackage } from "./importer";
import { createInitialState } from "./storage";

describe("编排工作簿回读", () => {
  it("保留赛事 ID、场次 ID、基础规则和阶段规则", async () => {
    const state = createInitialState();
    state.ruleSet = { ...state.ruleSet, targetScore: 12 };
    state.event.players = Array.from({ length: 4 }, (_, index) => createTournamentPlayer({ name: `选手${index + 1}`, seed: index + 1 }));
    state.event.formatConfig = { ...state.event.formatConfig, groupSize: 4 };
    state.event.stageRuleConfig = {
      preliminary: { durationSeconds: 120, targetScore: 5 },
      elimination: { durationSeconds: 180, targetScore: 10 },
      finals: { durationSeconds: 240, targetScore: 15 },
    };
    const generated = generateGroupStage(state.event, state.ruleSet, () => 0);
    const workbook = buildArrangementWorkbook({ ...state, event: generated.event, matches: generated.matches });
    const buffer = await workbook.xlsx.writeBuffer();

    const imported = await parseMatchImportPackage(fakeFile("arrangement.xlsx", buffer as ArrayBuffer), defaultRuleSet);
    expect(imported.eventId).toBe(state.event.id);
    expect(imported.ruleSet?.targetScore).toBe(12);
    expect(imported.stageRuleConfig?.finals).toEqual({ durationSeconds: 240, targetScore: 15 });
    expect(imported.matches.map((match) => match.id)).toEqual(generated.matches.map((match) => match.id));
    expect(imported.matches.every((match) => match.eventId === state.event.id && match.remainingSeconds === 120)).toBe(true);
  });
});

function fakeFile(name: string, buffer: ArrayBuffer) {
  return { name, arrayBuffer: async () => buffer } as File;
}
