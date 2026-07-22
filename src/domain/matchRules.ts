import type { Match, MatchRuleProfileKey, RuleSet, TournamentStageRuleConfig, TournamentStageType } from "../types";

export function inferMatchRuleProfile(stage?: TournamentStageType, groupName = ""): MatchRuleProfileKey {
  if (stage === "group" || stage === "swiss" || stage === "playoff") return "preliminary";
  if (stage === "third_place" || stage === "grand_final" || groupName === "决赛") return "finals";
  return "elimination";
}

export function resolveMatchRuleSet(ruleSet: RuleSet, stageRules: TournamentStageRuleConfig, match: Match): RuleSet {
  const profile = match.ruleProfile ?? inferMatchRuleProfile(match.tournamentStage, match.groupName);
  const stageRule = stageRules[profile];
  return {
    ...ruleSet,
    durationSeconds: stageRule.durationSeconds,
    targetScore: stageRule.targetScore,
  };
}

export function resolveRuleProfile(ruleSet: RuleSet, stageRules: TournamentStageRuleConfig, profile: MatchRuleProfileKey): RuleSet {
  return {
    ...ruleSet,
    durationSeconds: stageRules[profile].durationSeconds,
    targetScore: stageRules[profile].targetScore,
  };
}
