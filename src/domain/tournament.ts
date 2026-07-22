import { createEmptyMatch, createMatchEvent } from "./rules";
import { resolveRuleProfile } from "./matchRules";
import { assignGeneratedPistes, assignGroupStagePistes } from "./pisteAssignment";
import type { BracketNode, Match, MatchRuleProfileKey, RankingRuleKey, RuleSet, SwissRound, TournamentEvent, TournamentPlayer, TournamentRanking, TournamentStageType } from "../types";

type GeneratedMatches = {
  event: TournamentEvent;
  matches: Match[];
};

type PlayerStanding = Omit<TournamentRanking, "rank" | "advanced" | "needsPlayoff">;

const SWISS_GROUP_NAME = "瑞士轮";
const DIRECT_BRACKET_GROUP_NAME = "直接淘汰";
const DOUBLE_ELIMINATION_GROUP_NAME = "双败淘汰";

export function createTournamentPlayer(input: { name: string; club?: string; seed?: number | null }): TournamentPlayer {
  return {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    club: input.club?.trim() ?? "",
    seed: input.seed ?? null,
    status: "active",
    groupName: "",
  };
}

export function parsePlayersText(text: string): TournamentPlayer[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [name, club = "", seedText = ""] = line.split(/[,，\t]/).map((item) => item.trim());
      return createTournamentPlayer({ name, club, seed: Number(seedText) || index + 1 });
    })
    .filter((player) => player.name);
}

export function assignGroups(
  players: TournamentPlayer[],
  groupSize: number,
  options: { groupCount?: number; useSeeding?: boolean; avoidSameClub?: boolean; random?: () => number } = {}
): { players: TournamentPlayer[]; groupNames: string[] } {
  const activePlayers = players.filter((player) => player.status === "active");
  const groupCount = Math.max(1, Math.min(activePlayers.length || 1, options.groupCount ?? Math.ceil(activePlayers.length / Math.max(2, groupSize))));
  const groupNames = Array.from({ length: groupCount }, (_, index) => `${String.fromCharCode(65 + index)}组`);
  const orderedPlayers = createInitialPlayerOrder(activePlayers, options.useSeeding ?? true, options.random);
  const baseSize = Math.floor(activePlayers.length / groupCount);
  const remainder = activePlayers.length % groupCount;
  const capacities = groupNames.map((_, index) => baseSize + (index < remainder ? 1 : 0));
  const groupedById = new Map<string, TournamentPlayer>();
  const assignedGroups: TournamentPlayer[][] = groupNames.map(() => []);

  orderedPlayers.forEach((player, index) => {
    const row = Math.floor(index / groupCount);
    const column = index % groupCount;
    const preferredGroupIndex = row % 2 === 0 ? column : groupCount - column - 1;
    const groupIndex = assignedGroups
      .map((group, candidateIndex) => ({
        candidateIndex,
        isFull: group.length >= capacities[candidateIndex],
        clubConflicts: options.avoidSameClub && player.club
          ? group.filter((member) => member.club && member.club === player.club).length
          : 0,
        preferredDistance: Math.abs(candidateIndex - preferredGroupIndex),
      }))
      .filter((candidate) => !candidate.isFull)
      .sort((a, b) => a.clubConflicts - b.clubConflicts || a.preferredDistance - b.preferredDistance || a.candidateIndex - b.candidateIndex)[0]
      ?.candidateIndex ?? 0;
    const groupedPlayer = { ...player, groupName: groupNames[groupIndex] };
    assignedGroups[groupIndex].push(groupedPlayer);
    groupedById.set(player.id, groupedPlayer);
  });
  const groupedPlayers = players.map((player) => player.status === "active" ? groupedById.get(player.id) ?? player : { ...player, groupName: "" });
  return { players: groupedPlayers, groupNames };
}

export function countGroupClubConflicts(players: TournamentPlayer[]) {
  const groups = new Map<string, TournamentPlayer[]>();
  players.filter((player) => player.status === "active" && player.groupName).forEach((player) => {
    groups.set(player.groupName, [...(groups.get(player.groupName) ?? []), player]);
  });
  return [...groups.values()].reduce((total, group) => total + group.reduce((count, player, index) => (
    count + group.slice(index + 1).filter((other) => player.club && other.club === player.club).length
  ), 0), 0);
}

export function calculateConfiguredGroupCount(event: TournamentEvent) {
  const activeCount = event.players.filter((player) => player.status === "active").length;
  if (activeCount === 0) return 0;
  if (event.formatConfig.groupAllocationMode === "group_count") {
    return Math.max(1, Math.min(activeCount, Math.trunc(event.formatConfig.groupCount || 1)));
  }
  return Math.max(1, Math.ceil(activeCount / Math.max(2, event.formatConfig.groupSize)));
}

export function calculateMinimumGroupAdvancers(event: TournamentEvent) {
  return calculateConfiguredGroupCount(event) * Math.max(0, Math.trunc(event.formatConfig.groupAdvancers));
}

export function generateGroupStage(event: TournamentEvent, ruleSet: RuleSet, random: () => number = Math.random): GeneratedMatches {
  const configuredGroupCount = event.formatConfig.groupAllocationMode === "group_count"
    ? Math.max(1, Math.trunc(event.formatConfig.groupCount))
    : undefined;
  const { players, groupNames } = assignGroups(event.players, event.formatConfig.groupSize, {
    groupCount: configuredGroupCount,
    useSeeding: event.formatConfig.useSeeding,
    avoidSameClub: event.formatConfig.avoidClubInGroups,
    random,
  });
  const matches: Match[] = [];
  let matchNo = 1;
  const matchRule = resolveRuleProfile(ruleSet, event.stageRuleConfig, "preliminary");

  groupNames.forEach((groupName) => {
    const groupPlayers = players.filter((player) => player.groupName === groupName && player.status === "active");
    createRoundRobinPairings(groupPlayers).forEach((roundPairings, roundIndex) => {
      roundPairings.forEach(([red, blue]) => {
        const match = createEmptyMatch({
          matchNo: `${matchNo}`,
          groupName,
          piste: "未分配",
          redName: red.name,
          redClub: red.club,
          blueName: blue.name,
          blueClub: blue.club,
          ruleSet: matchRule,
        });
        matches.push({
          ...match,
          eventId: event.id,
          tournamentStage: "group",
          tournamentRound: roundIndex + 1,
          ruleProfile: "preliminary",
          redPlayerId: red.id,
          bluePlayerId: blue.id,
          events: [createMatchEvent(match.id, "match_created", "赛事编排生成小组赛")],
        });
        matchNo += 1;
      });
    });
  });

  const scheduledMatches = scheduleGroupMatchesByPiste(
    assignGroupStagePistes(matches, event.formatConfig.pisteCount),
    event.formatConfig.pisteCount
  );

  return {
    event: touchEvent({
      ...event,
      players,
      groupNames,
      stage: "group_ready",
      rankings: [],
      swissRounds: [],
      bracketNodes: [],
    }),
    matches: scheduledMatches,
  };
}

export function generateSwissFirstRound(event: TournamentEvent, ruleSet: RuleSet, existingMatches: Match[], random: () => number = Math.random): GeneratedMatches {
  if (event.swissRounds.length > 0) return { event: touchEvent(event), matches: [] };
  const players = event.players.map((player) => (player.status === "active" ? { ...player, groupName: SWISS_GROUP_NAME } : { ...player, groupName: "" }));
  return generateSwissRound(
    {
      ...event,
      players,
      groupNames: [SWISS_GROUP_NAME],
      rankings: [],
      bracketNodes: [],
      swissRounds: [],
      stage: "swiss_ready",
    },
    existingMatches,
    ruleSet,
    1,
    random
  );
}

export function lockCurrentSwissRound(event: TournamentEvent, matches: Match[], ruleSet: RuleSet): TournamentEvent {
  const currentRound = getCurrentSwissRound(event);
  if (!currentRound || currentRound.status === "locked") return touchEvent(event);
  const allFinished = currentRound.matchIds.every((matchId) => matches.find((match) => match.id === matchId)?.status === "finished");
  if (!allFinished) return touchEvent(event);
  const swissRounds = event.swissRounds.map((round) => (round.roundNo === currentRound.roundNo ? { ...round, status: "locked" as const } : round));
  const nextStage = currentRound.roundNo >= event.formatConfig.swissRounds ? "swiss_finished" : "swiss_ready";
  return touchEvent({
    ...event,
    swissRounds,
    rankings: calculateRankings({ ...event, swissRounds }, matches, ruleSet),
    stage: nextStage,
  });
}

export function generateNextSwissRound(event: TournamentEvent, matches: Match[], ruleSet: RuleSet): GeneratedMatches {
  const currentRound = getCurrentSwissRound(event);
  if (!currentRound || currentRound.status !== "locked" || event.swissRounds.length >= event.formatConfig.swissRounds) {
    return { event: touchEvent(event), matches: [] };
  }
  return generateSwissRound(event, matches, ruleSet, currentRound.roundNo + 1, Math.random);
}

export function calculateRankings(event: TournamentEvent, matches: Match[], ruleSet: RuleSet): TournamentRanking[] {
  const standings = new Map<string, PlayerStanding>();
  event.players
    .filter((player) => player.status === "active")
    .forEach((player) => standings.set(player.id, createEmptyStanding(player)));

  matches
    .filter((match) => (match.tournamentStage === "group" || match.tournamentStage === "playoff" || match.tournamentStage === "swiss") && match.status === "finished")
    .forEach((match) => applyMatchToStandings(standings, match, ruleSet, event));
  // 瑞士轮轮空是赛事编排结果：给赛事积分，但不计入真实胜场、净胜分或相互胜负。
  event.swissRounds
    .filter((round) => round.status === "locked" && round.byePlayerId)
    .forEach((round) => {
      const standing = standings.get(round.byePlayerId as string);
      if (standing) standing.eventPoints += getEventPoints(event, "win", 0);
    });

  const baseRankings = Array.from(standings.values());
  const rankedByGroup = event.groupNames.flatMap((groupName) =>
    rankStandings(baseRankings.filter((standing) => standing.groupName === groupName), event, matches)
  );
  const groupAdvanced = new Set(
    event.formatConfig.format === "group_bracket"
      ? rankedByGroup
          .filter((ranking) => ranking.rank <= event.formatConfig.groupAdvancers)
          .map((ranking) => ranking.playerId)
      : []
  );
  const targetAdvancers = getTargetAdvancers(event);
  const globalRankings = rankStandings(baseRankings, event, matches);
  globalRankings
    .filter((ranking) => !groupAdvanced.has(ranking.playerId))
    .slice(0, Math.max(0, targetAdvancers - groupAdvanced.size))
    .forEach((ranking) => groupAdvanced.add(ranking.playerId));
  const playoffPlayerIds = findPlayoffCandidates(rankedByGroup, globalRankings, targetAdvancers, event, matches);

  return rankedByGroup.map((ranking) => ({
    ...ranking,
    advanced: groupAdvanced.has(ranking.playerId),
    needsPlayoff: playoffPlayerIds.has(ranking.playerId),
  }));
}

export function refreshTournamentRankings(event: TournamentEvent, matches: Match[], ruleSet: RuleSet): TournamentEvent {
  const rankings = calculateRankings(event, matches, ruleSet);
  const allGroupMatchesFinished = matches
    .filter((match) => match.tournamentStage === "group")
    .every((match) => match.status === "finished");
  const nextStage = event.formatConfig.format === "group_bracket" && allGroupMatchesFinished && rankings.length > 0 ? "group_finished" : event.stage;
  return touchEvent({
    ...event,
    rankings,
    stage: nextStage,
  });
}

export function generatePlayoffMatches(event: TournamentEvent, matches: Match[], ruleSet: RuleSet): GeneratedMatches {
  if (matches.some((match) => match.tournamentStage === "playoff" && match.status !== "finished")) {
    return { event: touchEvent(event), matches: [] };
  }

  const rankings = calculateRankings(event, matches, ruleSet);
  const candidates = rankings.filter((ranking) => ranking.needsPlayoff);
  const generatedMatches: Match[] = [];
  const matchRule = resolveRuleProfile(ruleSet, event.stageRuleConfig, "preliminary");
  let matchNo = matches.length + 1;
  const candidatesByGroup = new Map<string, TournamentRanking[]>();

  candidates.forEach((ranking) => {
    candidatesByGroup.set(ranking.groupName, [...(candidatesByGroup.get(ranking.groupName) ?? []), ranking]);
  });

  candidatesByGroup.forEach((groupCandidates, groupName) => {
    for (let redIndex = 0; redIndex < groupCandidates.length; redIndex += 1) {
      for (let blueIndex = redIndex + 1; blueIndex < groupCandidates.length; blueIndex += 1) {
        const red = findPlayer(event.players, groupCandidates[redIndex].playerId);
        const blue = findPlayer(event.players, groupCandidates[blueIndex].playerId);
        const match = createEmptyMatch({
          matchNo: `${matchNo}`,
          groupName: `${groupName}附加赛`,
          piste: "未分配",
          redName: red.name,
          redClub: red.club,
          blueName: blue.name,
          blueClub: blue.club,
          ruleSet: matchRule,
        });
        generatedMatches.push({
          ...match,
          eventId: event.id,
          tournamentStage: "playoff",
          tournamentRound: 1,
          ruleProfile: "preliminary",
          redPlayerId: red.id,
          bluePlayerId: blue.id,
          events: [createMatchEvent(match.id, "match_created", "晋级线同分生成附加赛")],
        });
        matchNo += 1;
      }
    }
  });

  return {
    event: touchEvent({ ...event, rankings }),
    matches: assignGeneratedPistes(generatedMatches, matches, event.formatConfig.pisteCount),
  };
}

export function generateDirectEliminationBracket(event: TournamentEvent, matches: Match[], ruleSet: RuleSet, random: () => number = Math.random): GeneratedMatches {
  const players = event.players.map((player) => (player.status === "active" ? { ...player, groupName: DIRECT_BRACKET_GROUP_NAME } : { ...player, groupName: "" }));
  const rankings = createDirectEliminationRankings(players, DIRECT_BRACKET_GROUP_NAME, event.formatConfig.useSeeding, random);
  if (rankings.length < 2) return { event: touchEvent(event), matches: [] };
  return generateInitialBracket(
    {
      ...event,
      players,
      groupNames: [DIRECT_BRACKET_GROUP_NAME],
      rankings,
      swissRounds: [],
      bracketNodes: [],
      stage: "setup",
    },
    matches,
    ruleSet
  );
}

export function generateDoubleEliminationBracket(event: TournamentEvent, matches: Match[], ruleSet: RuleSet, random: () => number = Math.random): GeneratedMatches {
  const players = event.players.map((player) => (player.status === "active" ? { ...player, groupName: DOUBLE_ELIMINATION_GROUP_NAME } : { ...player, groupName: "" }));
  const rankings = createDirectEliminationRankings(players, DOUBLE_ELIMINATION_GROUP_NAME, event.formatConfig.useSeeding, random);
  if (rankings.length < 2) return { event: touchEvent(event), matches: [] };
  const generatedMatches: Match[] = [];
  const nodes: BracketNode[] = [];
  const seeds = rankings.map((ranking, index) => ({ playerId: ranking.playerId, seedOrder: index + 1, name: ranking.name }));
  const bracketSize = nextPowerOfTwo(seeds.length);
  const byeCount = bracketSize - seeds.length;
  const byes = seeds.slice(0, byeCount);
  const playable = seeds.slice(byeCount);

  byes.forEach((seed) => {
    nodes.push(createByeNode({
      label: `胜者组第1轮轮空：${seed.name}`,
      roundNo: 1,
      playerId: seed.playerId,
      seedOrder: seed.seedOrder,
      stage: "winner_bracket",
    }));
  });
  generatedMatches.push(...createPairedBracketMatches(event, playable, matches.length, 1, "胜者组第1轮", ruleSet, "winner_bracket", nodes));

  return {
    event: touchEvent({
      ...event,
      players,
      groupNames: [DOUBLE_ELIMINATION_GROUP_NAME],
      rankings,
      swissRounds: [],
      bracketNodes: nodes,
      stage: "bracket_ready",
    }),
    matches: assignGeneratedPistes(generatedMatches, matches, event.formatConfig.pisteCount),
  };
}

export function generateInitialBracket(event: TournamentEvent, matches: Match[], ruleSet: RuleSet): GeneratedMatches {
  const rankings = event.rankings.length ? event.rankings : calculateRankings(event, matches, ruleSet);
  const seeds = rankings
    .filter((ranking) => ranking.advanced)
    .sort((a, b) => event.formatConfig.format === "direct_bracket"
      ? a.rank - b.rank
      : compareRankingRecords(a, b, event, matches))
    .map((ranking, index) => ({ ...ranking, seedOrder: index + 1 }));
  const bracketSize = nextPowerOfTwo(seeds.length);
  const byeCount = bracketSize - seeds.length;
  const byes = seeds.slice(0, byeCount);
  const playable = seeds.slice(byeCount);
  const generatedMatches: Match[] = [];
  const nodes: BracketNode[] = [];
  const initialLabel = seeds.length === 2 ? "决赛" : "淘汰赛第1轮";

  byes.forEach((seed) => {
    nodes.push({
      id: crypto.randomUUID(),
      roundNo: 1,
      label: `第1轮轮空：${seed.name}`,
      matchId: null,
      redPlayerId: seed.playerId,
      bluePlayerId: null,
      winnerPlayerId: seed.playerId,
      loserPlayerId: null,
      seedOrder: seed.seedOrder,
      stage: "bracket",
      status: "bye",
    });
  });

  for (let index = 0; index < playable.length / 2; index += 1) {
    const redSeed = playable[index];
    const blueSeed = playable[playable.length - index - 1];
    const match = createBracketMatch({
      eventId: event.id,
      matchNo: `${matches.length + generatedMatches.length + 1}`,
      roundNo: 1,
      label: initialLabel,
      red: findPlayer(event.players, redSeed.playerId),
      blue: findPlayer(event.players, blueSeed.playerId),
      ruleSet: resolveRuleProfile(ruleSet, event.stageRuleConfig, initialLabel === "决赛" ? "finals" : "elimination"),
      ruleProfile: initialLabel === "决赛" ? "finals" : "elimination",
    });
    const nodeId = crypto.randomUUID();
    generatedMatches.push({ ...match, bracketNodeId: nodeId });
    nodes.push({
      id: nodeId,
      roundNo: 1,
      label: initialLabel === "决赛" ? "决赛" : `${redSeed.name} vs ${blueSeed.name}`,
      matchId: match.id,
      redPlayerId: redSeed.playerId,
      bluePlayerId: blueSeed.playerId,
      winnerPlayerId: null,
      loserPlayerId: null,
      seedOrder: Math.min(redSeed.seedOrder, blueSeed.seedOrder),
      stage: "bracket",
      status: "ready",
    });
  }

  return {
    event: touchEvent({
      ...event,
      rankings,
      stage: "bracket_ready",
      bracketNodes: nodes,
    }),
    matches: assignGeneratedPistes(generatedMatches, matches, event.formatConfig.pisteCount),
  };
}

export function advanceBracket(event: TournamentEvent, matches: Match[], ruleSet: RuleSet): GeneratedMatches {
  if (event.formatConfig.format === "double_elimination") {
    return advanceDoubleEliminationBracket(event, matches, ruleSet);
  }
  const syncedNodes = syncBracketNodes(event.bracketNodes, matches);
  const maxRound = Math.max(0, ...syncedNodes.map((node) => node.roundNo));
  const currentRoundNodes = syncedNodes.filter((node) => node.roundNo === maxRound);
  if (!currentRoundNodes.length || currentRoundNodes.some((node) => node.status === "ready")) {
    return { event: touchEvent({ ...event, bracketNodes: syncedNodes }), matches: [] };
  }

  const winners = currentRoundNodes
    .filter((node) => node.winnerPlayerId)
    .map((node) => ({ playerId: node.winnerPlayerId as string, seedOrder: node.seedOrder }));
  const losers = currentRoundNodes
    .filter((node) => node.loserPlayerId)
    .map((node) => ({ playerId: node.loserPlayerId as string, seedOrder: node.seedOrder }));

  if (winners.length < 2) {
    return {
      event: touchEvent({ ...event, stage: "finished", bracketNodes: syncedNodes }),
      matches: [],
    };
  }

  const nextRoundNo = maxRound + 1;
  const generatedMatches: Match[] = [];
  const nextNodes: BracketNode[] = [];
  const isFinal = winners.length === 2;

  generatedMatches.push(...createPairedBracketMatches(event, winners, matches.length, nextRoundNo, isFinal ? "决赛" : `淘汰赛第${nextRoundNo}轮`, ruleSet, "bracket", nextNodes));
  if (isFinal && event.formatConfig.generateThirdPlaceMatch && losers.length === 2) {
    generatedMatches.push(...createPairedBracketMatches(event, losers, matches.length + generatedMatches.length, nextRoundNo, "季军赛", ruleSet, "third_place", nextNodes));
  }

  return {
    event: touchEvent({
      ...event,
      bracketNodes: [...syncedNodes, ...nextNodes],
    }),
    matches: assignGeneratedPistes(generatedMatches, matches, event.formatConfig.pisteCount),
  };
}

export function syncTournamentEvent(event: TournamentEvent, matches: Match[]): TournamentEvent {
  const bracketNodes = syncBracketNodes(event.bracketNodes, matches);
  const hasReadyBracketMatch = bracketNodes.some((node) => node.status === "ready");
  const allBracketDone = bracketNodes.length > 0 && !hasReadyBracketMatch && bracketNodes.some((node) => node.label === "决赛");
  const allDoubleEliminationDone = bracketNodes.some((node) => node.stage === "grand_final" && node.status === "finished");
  return touchEvent({
    ...event,
    bracketNodes,
    stage: allBracketDone || allDoubleEliminationDone ? "finished" : event.stage,
  });
}

function advanceDoubleEliminationBracket(event: TournamentEvent, matches: Match[], ruleSet: RuleSet): GeneratedMatches {
  const syncedNodes = syncBracketNodes(event.bracketNodes, matches);
  if (!syncedNodes.length || syncedNodes.some((node) => node.status === "ready")) {
    return { event: touchEvent({ ...event, bracketNodes: syncedNodes }), matches: [] };
  }
  if (syncedNodes.some((node) => node.stage === "grand_final" && node.status === "finished")) {
    return { event: touchEvent({ ...event, stage: "finished", bracketNodes: syncedNodes }), matches: [] };
  }

  const losses = calculateDoubleEliminationLosses(syncedNodes);
  const persistedRankings = event.rankings.length
    ? event.rankings
    : createDirectEliminationRankings(event.players, DOUBLE_ELIMINATION_GROUP_NAME, true);
  const activeSeeds = persistedRankings
    .map((ranking) => ({ playerId: ranking.playerId, seedOrder: ranking.rank }))
    .filter((seed) => (losses.get(seed.playerId) ?? 0) < 2);
  const undefeatedSeeds = activeSeeds.filter((seed) => (losses.get(seed.playerId) ?? 0) === 0);
  const oneLossSeeds = activeSeeds.filter((seed) => (losses.get(seed.playerId) ?? 0) === 1);
  const nextRoundNo = Math.max(0, ...syncedNodes.map((node) => node.roundNo)) + 1;
  const generatedMatches: Match[] = [];
  const nextNodes: BracketNode[] = [];

  if (undefeatedSeeds.length === 1 && oneLossSeeds.length === 1) {
    generatedMatches.push(...createPairedBracketMatches(event, [undefeatedSeeds[0], oneLossSeeds[0]], matches.length, nextRoundNo, "总决赛", ruleSet, "grand_final", nextNodes));
    return {
      event: touchEvent({ ...event, bracketNodes: [...syncedNodes, ...nextNodes] }),
      matches: assignGeneratedPistes(generatedMatches, matches, event.formatConfig.pisteCount),
    };
  }

  if (undefeatedSeeds.length >= 2) {
    generatedMatches.push(...createDoubleEliminationWave(event, undefeatedSeeds, matches.length + generatedMatches.length, nextRoundNo, "胜者组", "winner_bracket", ruleSet, nextNodes));
  }
  if (oneLossSeeds.length >= 2) {
    generatedMatches.push(...createDoubleEliminationWave(event, oneLossSeeds, matches.length + generatedMatches.length, nextRoundNo, "败者组", "loser_bracket", ruleSet, nextNodes));
  } else if (undefeatedSeeds.length === 1 && oneLossSeeds.length === 0) {
    return { event: touchEvent({ ...event, stage: "finished", bracketNodes: syncedNodes }), matches: [] };
  }

  return {
    event: touchEvent({
      ...event,
      bracketNodes: [...syncedNodes, ...nextNodes],
    }),
    matches: assignGeneratedPistes(generatedMatches, matches, event.formatConfig.pisteCount),
  };
}

function createDoubleEliminationWave(
  event: TournamentEvent,
  seeds: Array<{ playerId: string; seedOrder: number }>,
  matchOffset: number,
  roundNo: number,
  labelPrefix: string,
  stage: "winner_bracket" | "loser_bracket",
  ruleSet: RuleSet,
  nodes: BracketNode[]
) {
  const orderedSeeds = [...seeds].sort((a, b) => a.seedOrder - b.seedOrder);
  const byeCount = orderedSeeds.length % 2;
  const byes = byeCount ? orderedSeeds.slice(0, 1) : [];
  const playable = byeCount ? orderedSeeds.slice(1) : orderedSeeds;
  byes.forEach((seed) => {
    const player = findPlayer(event.players, seed.playerId);
    nodes.push(createByeNode({
      label: `${labelPrefix}第${roundNo}轮轮空：${player.name}`,
      roundNo,
      playerId: seed.playerId,
      seedOrder: seed.seedOrder,
      stage,
    }));
  });
  return createPairedBracketMatches(event, playable, matchOffset, roundNo, `${labelPrefix}第${roundNo}轮`, ruleSet, stage, nodes);
}

function calculateDoubleEliminationLosses(nodes: BracketNode[]) {
  const losses = new Map<string, number>();
  nodes
    .filter((node) => node.status === "finished" && node.loserPlayerId)
    .forEach((node) => {
      const loserPlayerId = node.loserPlayerId as string;
      losses.set(loserPlayerId, (losses.get(loserPlayerId) ?? 0) + 1);
    });
  return losses;
}

export function getCurrentSwissRound(event: TournamentEvent): SwissRound | null {
  if (event.swissRounds.length === 0) return null;
  return [...event.swissRounds].sort((a, b) => b.roundNo - a.roundNo)[0];
}

function generateSwissRound(event: TournamentEvent, matches: Match[], ruleSet: RuleSet, roundNo: number, random: () => number): GeneratedMatches {
  const activePlayers = event.players.filter((player) => player.status === "active");
  if (activePlayers.length < 2) return { event: touchEvent(event), matches: [] };

  const rankings = roundNo === 1 ? [] : calculateRankings(event, matches, ruleSet);
  const orderedPlayers = roundNo === 1
    ? createInitialPlayerOrder(activePlayers, event.formatConfig.useSeeding, random)
    : orderSwissPlayersByRanking(activePlayers, rankings);
  const byePlayer = orderedPlayers.length % 2 === 1 && event.formatConfig.allowSwissBye ? selectSwissByePlayer(orderedPlayers, event.swissRounds) : null;
  if (orderedPlayers.length % 2 === 1 && !byePlayer) {
    return { event: touchEvent(event), matches: [] };
  }
  const pairingPlayers = byePlayer ? orderedPlayers.filter((player) => player.id !== byePlayer.id) : orderedPlayers;
  const randomizeFirstRound = roundNo === 1 && !event.formatConfig.useSeeding;
  const pairings = roundNo === 1
    ? createSeededSwissFirstRoundPairings(pairingPlayers)
    : createSwissPairings(pairingPlayers, matches, rankings, event.formatConfig.avoidClubInSwiss);
  if (!pairings) return { event: touchEvent(event), matches: [] };

  const matchRule = resolveRuleProfile(ruleSet, event.stageRuleConfig, "preliminary");
  const rawMatches = pairings.map(([red, blue], index) => createSwissMatch({
    eventId: event.id,
    matchNo: `${matches.length + index + 1}`,
    roundNo,
    groupName: SWISS_GROUP_NAME,
    isRandomFirstRound: randomizeFirstRound,
    red,
    blue,
    ruleSet: matchRule,
  }));
  const generatedMatches = assignGeneratedPistes(rawMatches, matches, event.formatConfig.pisteCount).map((match) => ({
    ...match,
    groupName: swissVenueGroupName(pisteIndexFromLabel(match.piste)),
  }));
  const swissRound: SwissRound = {
    roundNo,
    status: "published",
    matchIds: generatedMatches.map((match) => match.id),
    byePlayerId: byePlayer?.id ?? null,
  };

  return {
    event: touchEvent({
      ...event,
      groupNames: [SWISS_GROUP_NAME],
      rankings,
      swissRounds: [...event.swissRounds, swissRound],
      stage: "swiss_ready",
    }),
    matches: generatedMatches,
  };
}

function createSwissMatch(input: { eventId: string; matchNo: string; roundNo: number; groupName: string; isRandomFirstRound: boolean; red: TournamentPlayer; blue: TournamentPlayer; ruleSet: RuleSet }): Match {
  const roundLabel = `瑞士轮第${input.roundNo}轮`;
  const pairingLabel = input.isRandomFirstRound ? `${roundLabel}随机配对` : roundLabel;
  const match = createEmptyMatch({
    matchNo: input.matchNo,
    groupName: input.groupName,
    piste: "未分配",
    redName: input.red.name,
    redClub: input.red.club,
    blueName: input.blue.name,
    blueClub: input.blue.club,
    ruleSet: input.ruleSet,
  });
  return {
    ...match,
    eventId: input.eventId,
    tournamentStage: "swiss",
    tournamentRound: input.roundNo,
    ruleProfile: "preliminary",
    redPlayerId: input.red.id,
    bluePlayerId: input.blue.id,
    events: [createMatchEvent(match.id, "match_created", `${pairingLabel}生成场次`)],
  };
}

function swissVenueGroupName(index: number) {
  // 场地组只负责现场分流，不参与瑞士轮的全局排名和下一轮配对。
  return `瑞士${String.fromCharCode(65 + index)}组`;
}

function createDirectEliminationRankings(
  players: TournamentPlayer[],
  groupName = DIRECT_BRACKET_GROUP_NAME,
  useSeeding = true,
  random: () => number = Math.random
): TournamentRanking[] {
  // 直接淘汰没有预赛积分，此处排名只用于固定本次抽签顺序。
  return createInitialPlayerOrder(players.filter((player) => player.status === "active"), useSeeding, random)
    .map((player, index) => ({
      rank: index + 1,
      playerId: player.id,
      name: player.name,
      club: player.club,
      groupName,
      eventPoints: 0,
      realWins: 0,
      draws: 0,
      losses: 0,
      scoreFor: 0,
      scoreAgainst: 0,
      scoreDiff: 0,
      disciplinePenalty: 0,
      advanced: true,
      needsPlayoff: false,
    }));
}

function orderSwissPlayersByRanking(players: TournamentPlayer[], rankings: TournamentRanking[]) {
  const rankingByPlayerId = new Map(rankings.map((ranking) => [ranking.playerId, ranking]));
  return [...players].sort((a, b) => {
    const rankingA = rankingByPlayerId.get(a.id);
    const rankingB = rankingByPlayerId.get(b.id);
    if (rankingA && rankingB) return rankingA.rank - rankingB.rank;
    if (rankingA) return -1;
    if (rankingB) return 1;
    return comparePlayersBySeed(a, b);
  });
}

function selectSwissByePlayer(players: TournamentPlayer[], rounds: SwissRound[]) {
  const previousByePlayerIds = new Set(rounds.map((round) => round.byePlayerId).filter(Boolean));
  return [...players].reverse().find((player) => !previousByePlayerIds.has(player.id)) ?? null;
}

function createSeededSwissFirstRoundPairings(players: TournamentPlayer[]): Array<[TournamentPlayer, TournamentPlayer]> {
  const half = players.length / 2;
  return players.slice(0, half).map((red, index) => [red, players[index + half]]);
}

function createSwissPairings(
  players: TournamentPlayer[],
  matches: Match[],
  rankings: TournamentRanking[],
  avoidSameClub: boolean
): Array<[TournamentPlayer, TournamentPlayer]> | null {
  const rankingByPlayerId = new Map(rankings.map((ranking) => [ranking.playerId, ranking]));
  const pairRecursively = (remaining: TournamentPlayer[]): Array<[TournamentPlayer, TournamentPlayer]> | null => {
    if (remaining.length === 0) return [];
    const [red, ...candidates] = remaining;
    const orderedCandidates = [...candidates].sort((a, b) => compareSwissPairCandidate(red, a, b, rankingByPlayerId, avoidSameClub));
    for (const blue of orderedCandidates) {
      if (hasSwissPairing(red.id, blue.id, matches)) continue;
      const rest = candidates.filter((candidate) => candidate.id !== blue.id);
      const nextPairs = pairRecursively(rest);
      if (nextPairs) return [[red, blue], ...nextPairs];
    }
    return null;
  };
  return pairRecursively(players);
}

function compareSwissPairCandidate(
  red: TournamentPlayer,
  a: TournamentPlayer,
  b: TournamentPlayer,
  rankings: Map<string, TournamentRanking>,
  avoidSameClub: boolean
) {
  const redPoints = rankings.get(red.id)?.eventPoints ?? 0;
  const pointGapA = Math.abs(redPoints - (rankings.get(a.id)?.eventPoints ?? 0));
  const pointGapB = Math.abs(redPoints - (rankings.get(b.id)?.eventPoints ?? 0));
  if (pointGapA !== pointGapB) return pointGapA - pointGapB;
  const clubPenaltyA = avoidSameClub && red.club && a.club && red.club === a.club ? 1 : 0;
  const clubPenaltyB = avoidSameClub && red.club && b.club && red.club === b.club ? 1 : 0;
  if (clubPenaltyA !== clubPenaltyB) return clubPenaltyA - clubPenaltyB;
  return comparePlayersBySeed(a, b);
}

function hasSwissPairing(redPlayerId: string, bluePlayerId: string, matches: Match[]) {
  return matches.some(
    (match) =>
      match.tournamentStage === "swiss" &&
      ((match.redPlayerId === redPlayerId && match.bluePlayerId === bluePlayerId) ||
        (match.redPlayerId === bluePlayerId && match.bluePlayerId === redPlayerId))
  );
}

function createPairedBracketMatches(
  event: TournamentEvent,
  seeds: Array<{ playerId: string; seedOrder: number }>,
  matchOffset: number,
  roundNo: number,
  label: string,
  ruleSet: RuleSet,
  stage: "bracket" | "third_place" | "winner_bracket" | "loser_bracket" | "grand_final",
  nodes: BracketNode[]
): Match[] {
  const orderedSeeds = [...seeds].sort((a, b) => a.seedOrder - b.seedOrder);
  const generatedMatches: Match[] = [];
  const profile = bracketRuleProfile(stage, label);
  const matchRule = resolveRuleProfile(ruleSet, event.stageRuleConfig, profile);
  for (let index = 0; index < orderedSeeds.length / 2; index += 1) {
    const redSeed = orderedSeeds[index];
    const blueSeed = orderedSeeds[orderedSeeds.length - index - 1];
    const match = createBracketMatch({
      matchNo: `${matchOffset + generatedMatches.length + 1}`,
      roundNo,
      label,
      red: findPlayer(event.players, redSeed.playerId),
      blue: findPlayer(event.players, blueSeed.playerId),
      ruleSet: matchRule,
      stage,
      eventId: event.id,
      ruleProfile: profile,
    });
    const nodeId = crypto.randomUUID();
    generatedMatches.push({ ...match, bracketNodeId: nodeId });
    nodes.push({
      id: nodeId,
      roundNo,
      label,
      matchId: match.id,
      redPlayerId: redSeed.playerId,
      bluePlayerId: blueSeed.playerId,
      winnerPlayerId: null,
      loserPlayerId: null,
      seedOrder: Math.min(redSeed.seedOrder, blueSeed.seedOrder),
      stage,
      status: "ready",
    });
  }
  return generatedMatches;
}

function createByeNode(input: {
  label: string;
  roundNo: number;
  playerId: string;
  seedOrder: number;
  stage: "bracket" | "winner_bracket" | "loser_bracket";
}): BracketNode {
  return {
    id: crypto.randomUUID(),
    roundNo: input.roundNo,
    label: input.label,
    matchId: null,
    redPlayerId: input.playerId,
    bluePlayerId: null,
    winnerPlayerId: input.playerId,
    loserPlayerId: null,
    seedOrder: input.seedOrder,
    stage: input.stage,
    status: "bye",
  };
}

function createBracketMatch(input: {
  eventId: string;
  matchNo: string;
  roundNo: number;
  label: string;
  red: TournamentPlayer;
  blue: TournamentPlayer;
  ruleSet: RuleSet;
  ruleProfile: MatchRuleProfileKey;
  stage?: "bracket" | "third_place" | "winner_bracket" | "loser_bracket" | "grand_final";
}): Match {
  const match = createEmptyMatch({
    matchNo: input.matchNo,
    groupName: input.label,
    piste: "未分配",
    redName: input.red.name,
    redClub: input.red.club,
    blueName: input.blue.name,
    blueClub: input.blue.club,
    ruleSet: input.ruleSet,
  });
  return {
    ...match,
    eventId: input.eventId,
    tournamentStage: input.stage ?? "bracket",
    tournamentRound: input.roundNo,
    ruleProfile: input.ruleProfile,
    redPlayerId: input.red.id,
    bluePlayerId: input.blue.id,
    events: [createMatchEvent(match.id, "match_created", `${input.label}生成场次`)],
  };
}

function applyMatchToStandings(standings: Map<string, PlayerStanding>, match: Match, ruleSet: RuleSet, event: TournamentEvent) {
  if (!match.redPlayerId || !match.bluePlayerId || !match.winner) return;
  const red = standings.get(match.redPlayerId);
  const blue = standings.get(match.bluePlayerId);
  if (!red || !blue) return;

  red.scoreFor += match.redScore;
  red.scoreAgainst += match.blueScore;
  blue.scoreFor += match.blueScore;
  blue.scoreAgainst += match.redScore;
  red.scoreDiff += match.redScore - match.blueScore;
  blue.scoreDiff += match.blueScore - match.redScore;
  const redDisciplinePenalty = calculateDisciplinePenalty(match, "red", ruleSet, event);
  const blueDisciplinePenalty = calculateDisciplinePenalty(match, "blue", ruleSet, event);
  red.disciplinePenalty += redDisciplinePenalty;
  blue.disciplinePenalty += blueDisciplinePenalty;

  if (match.winner === "draw") {
    red.eventPoints += getEventPoints(event, "draw", redDisciplinePenalty);
    blue.eventPoints += getEventPoints(event, "draw", blueDisciplinePenalty);
    red.draws += 1;
    blue.draws += 1;
    return;
  }

  const winner = match.winner === "red" ? red : blue;
  const loser = match.winner === "red" ? blue : red;
  const winnerPenalty = match.winner === "red" ? redDisciplinePenalty : blueDisciplinePenalty;
  const loserPenalty = match.winner === "red" ? blueDisciplinePenalty : redDisciplinePenalty;
  winner.eventPoints += getEventPoints(event, "win", winnerPenalty);
  loser.eventPoints += getEventPoints(event, "loss", loserPenalty);
  winner.realWins += 1;
  loser.losses += 1;
}

function calculateDisciplinePenalty(match: Match, side: "red" | "blue", ruleSet: RuleSet, event: TournamentEvent) {
  const warnings = side === "red" ? match.redWarnings : match.blueWarnings;
  return Object.entries(warnings ?? {}).reduce((total, [warningId, count]) => {
    const warning = ruleSet.warningLevels.find((item) => item.id === warningId);
    const configuredDeduction = event.disciplinePointConfig.warningDeductions[warningId];
    return total + (configuredDeduction ?? Math.abs(warning?.scoreDelta ?? 0)) * count;
  }, 0);
}

function getEventPoints(event: TournamentEvent, result: "win" | "draw" | "loss" | "doubleLoss", disciplinePenalty: number) {
  const basePoints = event.eventPointConfig[result];
  return basePoints - (event.disciplinePointConfig.applyToEventPoints ? disciplinePenalty : 0);
}

function syncBracketNodes(nodes: BracketNode[], matches: Match[]): BracketNode[] {
  return nodes.map((node) => {
    if (!node.matchId) return node;
    const match = matches.find((item) => item.id === node.matchId);
    if (!match || match.status !== "finished" || !match.winner || match.winner === "draw") return node;
    const winnerPlayerId = match.winner === "red" ? match.redPlayerId : match.bluePlayerId;
    const loserPlayerId = match.winner === "red" ? match.bluePlayerId : match.redPlayerId;
    return {
      ...node,
      winnerPlayerId: winnerPlayerId ?? null,
      loserPlayerId: loserPlayerId ?? null,
      status: "finished",
    };
  });
}

function createEmptyStanding(player: TournamentPlayer): PlayerStanding {
  return {
    playerId: player.id,
    name: player.name,
    club: player.club,
    groupName: player.groupName,
    eventPoints: 0,
    realWins: 0,
    draws: 0,
    losses: 0,
    scoreFor: 0,
    scoreAgainst: 0,
    scoreDiff: 0,
    disciplinePenalty: 0,
  };
}

function rankStandings(standings: PlayerStanding[], event: TournamentEvent, matches: Match[]): TournamentRanking[] {
  return [...standings].sort((a, b) => compareStandingRecords(a, b, event, matches, true)).map((standing, index) => ({
    ...standing,
    rank: index + 1,
    advanced: false,
    needsPlayoff: false,
  }));
}

function compareStandingRecords(a: PlayerStanding, b: PlayerStanding, event: TournamentEvent, matches: Match[], includeFallback: boolean) {
  for (const rule of getEnabledRankingRules(event)) {
    const compared = compareByRankingRule(rule.key, a, b, matches);
    if (compared !== 0) return compared;
  }
  return includeFallback ? a.name.localeCompare(b.name, "zh-Hans-CN") : 0;
}

function compareRankingRecords(a: TournamentRanking, b: TournamentRanking, event: TournamentEvent, matches: Match[]) {
  return compareStandingRecords(a, b, event, matches, true);
}

function compareByRankingRule(ruleKey: RankingRuleKey, a: PlayerStanding, b: PlayerStanding, matches: Match[]) {
  if (ruleKey === "eventPoints") return b.eventPoints - a.eventPoints;
  if (ruleKey === "realWins") return b.realWins - a.realWins;
  if (ruleKey === "scoreDiff") return b.scoreDiff - a.scoreDiff;
  if (ruleKey === "disciplinePenalty") return a.disciplinePenalty - b.disciplinePenalty;
  if (ruleKey === "headToHead") return compareHeadToHead(a, b, matches);
  return 0;
}

function compareHeadToHead(a: PlayerStanding, b: PlayerStanding, matches: Match[]) {
  const directMatches = matches.filter(
    (match) =>
      (match.tournamentStage === "group" || match.tournamentStage === "swiss") &&
      match.status === "finished" &&
      ((match.redPlayerId === a.playerId && match.bluePlayerId === b.playerId) ||
        (match.redPlayerId === b.playerId && match.bluePlayerId === a.playerId))
  );
  if (directMatches.length !== 1) return 0;
  const match = directMatches[0];
  if (match.winner === "draw" || !match.winner) return 0;
  const winnerPlayerId = match.winner === "red" ? match.redPlayerId : match.bluePlayerId;
  if (winnerPlayerId === a.playerId) return -1;
  if (winnerPlayerId === b.playerId) return 1;
  return 0;
}

function getEnabledRankingRules(event: TournamentEvent) {
  return event.rankingRules
    .filter((rule) => rule.enabled && rule.key !== "playoff")
    .sort((a, b) => a.priority - b.priority);
}

function getTargetAdvancers(event: TournamentEvent) {
  if (event.formatConfig.format === "swiss_bracket") return Math.max(0, event.formatConfig.swissAdvancers);
  if (event.formatConfig.format === "group_bracket") {
    return Math.max(calculateMinimumGroupAdvancers(event), event.formatConfig.totalAdvancers);
  }
  return Math.max(0, event.formatConfig.totalAdvancers);
}

function findPlayoffCandidates(
  rankedByGroup: TournamentRanking[],
  globalRankings: TournamentRanking[],
  targetAdvancers: number,
  event: TournamentEvent,
  matches: Match[]
) {
  const playerIds = new Set<string>();
  if (!event.rankingRules.find((rule) => rule.key === "playoff")?.enabled) return playerIds;

  event.groupNames.forEach((groupName) => {
    const groupRankings = rankedByGroup.filter((ranking) => ranking.groupName === groupName);
    const groupCutoff = event.formatConfig.format === "swiss_bracket" ? event.formatConfig.swissAdvancers : event.formatConfig.groupAdvancers;
    addBoundaryTiePlayers(playerIds, groupRankings, groupCutoff, event, matches);
  });
  const guaranteedPlayerIds = new Set(
    rankedByGroup
      .filter((ranking) => ranking.rank <= event.formatConfig.groupAdvancers)
      .map((ranking) => ranking.playerId)
  );
  const remainingSlots = Math.max(0, targetAdvancers - guaranteedPlayerIds.size);
  const wildcardRankings = globalRankings.filter((ranking) => !guaranteedPlayerIds.has(ranking.playerId));
  addBoundaryTiePlayers(playerIds, wildcardRankings, remainingSlots, event, matches);
  return playerIds;
}

function addBoundaryTiePlayers(
  playerIds: Set<string>,
  rankings: TournamentRanking[],
  cutoff: number,
  event: TournamentEvent,
  matches: Match[]
) {
  if (cutoff <= 0 || rankings.length <= cutoff) return;
  const boundary = rankings[cutoff - 1];
  const next = rankings[cutoff];
  if (!boundary || !next || compareStandingRecords(boundary, next, event, matches, false) !== 0) return;
  rankings
    .filter((ranking) => compareStandingRecords(boundary, ranking, event, matches, false) === 0)
    .forEach((ranking) => playerIds.add(ranking.playerId));
}

function comparePlayersBySeed(a: TournamentPlayer, b: TournamentPlayer) {
  const seedA = a.seed ?? Number.MAX_SAFE_INTEGER;
  const seedB = b.seed ?? Number.MAX_SAFE_INTEGER;
  return seedA - seedB || a.name.localeCompare(b.name, "zh-Hans-CN");
}

function createInitialPlayerOrder(players: TournamentPlayer[], useSeeding: boolean, random: () => number = Math.random) {
  const ordered = [...players].sort(comparePlayersBySeed);
  if (useSeeding) return ordered;
  // 随机抽签只执行一次，调用方会把生成结果写入赛事状态并持久化。
  for (let index = ordered.length - 1; index > 0; index -= 1) {
    const targetIndex = Math.floor(random() * (index + 1));
    [ordered[index], ordered[targetIndex]] = [ordered[targetIndex], ordered[index]];
  }
  return ordered;
}

function createRoundRobinPairings(players: TournamentPlayer[]): Array<Array<[TournamentPlayer, TournamentPlayer]>> {
  const rotation: Array<TournamentPlayer | null> = [...players];
  if (rotation.length % 2 === 1) rotation.push(null);
  if (rotation.length < 2) return [];

  const rounds: Array<Array<[TournamentPlayer, TournamentPlayer]>> = [];
  let previousPair: [TournamentPlayer, TournamentPlayer] | null = null;
  for (let roundIndex = 0; roundIndex < rotation.length - 1; roundIndex += 1) {
    const pairs: Array<[TournamentPlayer, TournamentPlayer]> = [];
    for (let index = 0; index < rotation.length / 2; index += 1) {
      const red = rotation[index];
      const blue = rotation[rotation.length - index - 1];
      if (red && blue) pairs.push([red, blue]);
    }
    const orderedPairs: Array<[TournamentPlayer, TournamentPlayer]> = [];
    while (pairs.length > 0) {
      const previousIds = new Set(previousPair?.map((player) => player.id) ?? []);
      const candidateIndex = pairs.findIndex(([red, blue]) => !previousIds.has(red.id) && !previousIds.has(blue.id));
      const [nextPair] = pairs.splice(candidateIndex >= 0 ? candidateIndex : 0, 1);
      orderedPairs.push(nextPair);
      previousPair = nextPair;
    }
    rounds.push(orderedPairs);
    rotation.splice(1, 0, rotation.pop() ?? null);
  }
  return rounds;
}

function scheduleGroupMatchesByPiste(matches: Match[], pisteCount: number) {
  const pisteNames = Array.from({ length: Math.max(1, pisteCount) }, (_, index) => `场地 ${index + 1}`);
  const scheduledByPiste = pisteNames.map((piste) => {
    const groupQueues = new Map<string, Match[]>();
    matches.filter((match) => match.piste === piste).forEach((match) => {
      groupQueues.set(match.groupName, [...(groupQueues.get(match.groupName) ?? []), match]);
    });
    const scheduled: Match[] = [];
    while ([...groupQueues.values()].some((queue) => queue.length > 0)) {
      groupQueues.forEach((queue) => {
        const next = queue.shift();
        if (next) scheduled.push(next);
      });
    }
    return scheduled;
  });

  const ordered: Match[] = [];
  while (scheduledByPiste.some((queue) => queue.length > 0)) {
    scheduledByPiste.forEach((queue) => {
      const next = queue.shift();
      if (next) ordered.push(next);
    });
  }
  return ordered.map((match, index) => ({ ...match, matchNo: `${index + 1}` }));
}

function bracketRuleProfile(stage: TournamentStageType, label: string): MatchRuleProfileKey {
  return stage === "third_place" || stage === "grand_final" || label === "决赛" ? "finals" : "elimination";
}

function pisteIndexFromLabel(value: string) {
  const match = /^场地\s+(\d+)$/.exec(value.trim());
  return Math.max(0, Number(match?.[1] ?? 1) - 1);
}

function nextPowerOfTwo(value: number) {
  return 2 ** Math.ceil(Math.log2(Math.max(2, value)));
}

function findPlayer(players: TournamentPlayer[], playerId: string): TournamentPlayer {
  const player = players.find((item) => item.id === playerId);
  if (!player) throw new Error("未找到签表选手。");
  return player;
}

function touchEvent(event: TournamentEvent): TournamentEvent {
  return {
    ...event,
    updatedAt: new Date().toISOString(),
  };
}
