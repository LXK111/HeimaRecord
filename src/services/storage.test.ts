import { describe, expect, it } from "vitest";
import { createInitialState, normalizeState } from "./storage";
import type { TournamentFormatConfig, TournamentState } from "../types";

describe("赛事配置兼容", () => {
  it("新赛事默认忽略种子并使用一个场地", () => {
    const config = createInitialState().event.formatConfig;
    expect(config.useSeeding).toBe(false);
    expect(config.pisteCount).toBe(1);
    expect(config.avoidClubInGroups).toBe(true);
  });

  it("旧备份迁移瑞士轮随机开关和场地组数", () => {
    const base = createInitialState();
    const legacyConfig = {
      ...base.event.formatConfig,
      swissGroupCount: 3,
      randomizeSwissFirstRound: false,
    };
    delete (legacyConfig as Partial<TournamentFormatConfig>).useSeeding;
    delete (legacyConfig as Partial<TournamentFormatConfig>).pisteCount;
    const legacyState = {
      ...base,
      event: { ...base.event, formatConfig: legacyConfig as unknown as TournamentFormatConfig },
    } as TournamentState;

    const normalized = normalizeState(legacyState);
    expect(normalized.event.formatConfig.useSeeding).toBe(true);
    expect(normalized.event.formatConfig.pisteCount).toBe(3);

    legacyConfig.randomizeSwissFirstRound = true;
    expect(normalizeState(legacyState).event.formatConfig.useSeeding).toBe(false);
  });

  it("加载旧赛事时自动修正小于每组保底总数的淘汰赛目标人数", () => {
    const state = createInitialState();
    state.event.players = Array.from({ length: 16 }, (_, index) => ({
      id: `${index + 1}`,
      name: `选手${index + 1}`,
      club: "",
      seed: index + 1,
      status: "active" as const,
      groupName: "",
    }));
    state.event.formatConfig = { ...state.event.formatConfig, groupSize: 4, groupAdvancers: 2, totalAdvancers: 4 };

    expect(normalizeState(state).event.formatConfig.totalAdvancers).toBe(8);
  });
});
