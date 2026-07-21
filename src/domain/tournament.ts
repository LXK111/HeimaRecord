import { createEmptyMatch, createMatchEvent } from "./rules";
import type { BracketNode, Match, RuleSet, TournamentEvent, TournamentPlayer, TournamentRanking } from "../types";

type GeneratedMatches = {
  event: TournamentEvent;
  matches: Match[];
};

type PlayerStanding = Omit<TournamentRanking, "rank" | "advanced" | "needsPlayoff">;

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

export function assignGroups(players: TournamentPlayer[], groupSize: number): { players: TournamentPlayer[]; groupNames: string[] } {
  const activePlayers = players.filter((player) => player.status === "active");
  const groupCount = Math.max(1, Math.ceil(activePlayers.length / Math.max(2, groupSize)));
  const groupNames = Array.from({ length: groupCount }, (_, index) => `${String.fromCharCode(65 + index)}组`);
  const orderedPlayers = [...players].sort(comparePlayersBySeed);
  const groupedPlayers = orderedPlayers.map((player, index) => {
    if (player.status !== "active") return { ...player, groupName: "" };
    const row = Math.floor(index / groupCount);
    const column = index % groupCount;
    const groupIndex = row % 2 === 0 ? column : groupCount - column - 1;
    return { ...player, groupName: groupNames[groupIndex] ?? groupNames[0] };
  });
  return { players: restoreOriginalPlayerOrder(players, groupedPlayers), groupNames };
}

export function generateGroupStage(event: TournamentEvent, ruleSet: RuleSet): GeneratedMatches {
  const { players, groupNames } = assignGroups(event.players, event.formatConfig.groupSize);
  const matches: Match[] = [];
  let matchNo = 1;

  groupNames.forEach((groupName) => {
    const groupPlayers = players.filter((player) => player.groupName === groupName && player.status === "active");
    for (let redIndex = 0; redIndex < groupPlayers.length; redIndex += 1) {
      for (let blueIndex = redIndex + 1; blueIndex < groupPlayers.length; blueIndex += 1) {
        const red = groupPlayers[redIndex];
        const blue = groupPlayers[blueIndex];
        const match = createEmptyMatch({
          matchNo: `${matchNo}`,
          groupName,
          piste: "未分配",
          redName: red.name,
          redClub: red.club,
          blueName: blue.name,
          blueClub: blue.club,
          ruleSet,
        });
        matches.push({
          ...match,
          tournamentStage: "group",
          tournamentRound: 1,
          redPlayerId: red.id,
          bluePlayerId: blue.id,
          events: [createMatchEvent(match.id, "match_created", "赛事编排生成小组赛")],
        });
        matchNo += 1;
      }
    }
  });

  return {
    event: touchEvent({
      ...event,
      players,
      groupNames,
      stage: "group_ready",
      rankings: [],
      bracketNodes: [],
    }),
    matches,
  };
}

export function calculateRankings(event: TournamentEvent, matches: Match[], ruleSet: RuleSet): TournamentRanking[] {
  const standings = new Map<string, PlayerStanding>();
  event.players
    .filter((player) => player.status === "active")
    .forEach((player) => standings.set(player.id, createEmptyStanding(player)));

  matches
    .filter((match) => match.tournamentStage === "group" && match.status === "finished")
    .forEach((match) => applyMatchToStandings(standings, match, ruleSet));

  const baseRankings = Array.from(standings.values());
  const rankedByGroup = event.groupNames.flatMap((groupName) =>
    rankStandings(baseRankings.filter((standing) => standing.groupName === groupName))
  );
  const groupAdvanced = new Set(
    rankedByGroup
      .filter((ranking) => ranking.rank <= event.formatConfig.groupAdvancers)
      .map((ranking) => ranking.playerId)
  );
  const targetAdvancers = Math.max(groupAdvanced.size, event.formatConfig.totalAdvancers);
  const globalRankings = rankStandings(baseRankings);
  globalRankings.slice(0, targetAdvancers).forEach((ranking) => groupAdvanced.add(ranking.playerId));

  return rankedByGroup.map((ranking) => ({
    ...ranking,
    advanced: groupAdvanced.has(ranking.playerId),
    needsPlayoff: false,
  }));
}

export function refreshTournamentRankings(event: TournamentEvent, matches: Match[], ruleSet: RuleSet): TournamentEvent {
  const rankings = calculateRankings(event, matches, ruleSet);
  const allGroupMatchesFinished = matches
    .filter((match) => match.tournamentStage === "group")
    .every((match) => match.status === "finished");
  return touchEvent({
    ...event,
    rankings,
    stage: allGroupMatchesFinished && rankings.length > 0 ? "group_finished" : event.stage,
  });
}

export function generateInitialBracket(event: TournamentEvent, matches: Match[], ruleSet: RuleSet): GeneratedMatches {
  const rankings = event.rankings.length ? event.rankings : calculateRankings(event, matches, ruleSet);
  const seeds = rankings
    .filter((ranking) => ranking.advanced)
    .sort(compareRankings)
    .map((ranking, index) => ({ ...ranking, seedOrder: index + 1 }));
  const bracketSize = nextPowerOfTwo(seeds.length);
  const byeCount = bracketSize - seeds.length;
  const byes = seeds.slice(0, byeCount);
  const playable = seeds.slice(byeCount);
  const generatedMatches: Match[] = [];
  const nodes: BracketNode[] = [];

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
      matchNo: `${matches.length + generatedMatches.length + 1}`,
      roundNo: 1,
      label: "淘汰赛第1轮",
      red: findPlayer(event.players, redSeed.playerId),
      blue: findPlayer(event.players, blueSeed.playerId),
      ruleSet,
    });
    const nodeId = crypto.randomUUID();
    generatedMatches.push({ ...match, bracketNodeId: nodeId });
    nodes.push({
      id: nodeId,
      roundNo: 1,
      label: `${redSeed.name} vs ${blueSeed.name}`,
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
    matches: generatedMatches,
  };
}

export function advanceBracket(event: TournamentEvent, matches: Match[], ruleSet: RuleSet): GeneratedMatches {
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
    matches: generatedMatches,
  };
}

export function syncTournamentEvent(event: TournamentEvent, matches: Match[]): TournamentEvent {
  const bracketNodes = syncBracketNodes(event.bracketNodes, matches);
  const hasReadyBracketMatch = bracketNodes.some((node) => node.status === "ready");
  const allBracketDone = bracketNodes.length > 0 && !hasReadyBracketMatch && bracketNodes.some((node) => node.label === "决赛");
  return touchEvent({
    ...event,
    bracketNodes,
    stage: allBracketDone ? "finished" : event.stage,
  });
}

function createPairedBracketMatches(
  event: TournamentEvent,
  seeds: Array<{ playerId: string; seedOrder: number }>,
  matchOffset: number,
  roundNo: number,
  label: string,
  ruleSet: RuleSet,
  stage: "bracket" | "third_place",
  nodes: BracketNode[]
): Match[] {
  const orderedSeeds = [...seeds].sort((a, b) => a.seedOrder - b.seedOrder);
  const generatedMatches: Match[] = [];
  for (let index = 0; index < orderedSeeds.length / 2; index += 1) {
    const redSeed = orderedSeeds[index];
    const blueSeed = orderedSeeds[orderedSeeds.length - index - 1];
    const match = createBracketMatch({
      matchNo: `${matchOffset + generatedMatches.length + 1}`,
      roundNo,
      label,
      red: findPlayer(event.players, redSeed.playerId),
      blue: findPlayer(event.players, blueSeed.playerId),
      ruleSet,
      stage,
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

function createBracketMatch(input: {
  matchNo: string;
  roundNo: number;
  label: string;
  red: TournamentPlayer;
  blue: TournamentPlayer;
  ruleSet: RuleSet;
  stage?: "bracket" | "third_place";
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
    tournamentStage: input.stage ?? "bracket",
    tournamentRound: input.roundNo,
    redPlayerId: input.red.id,
    bluePlayerId: input.blue.id,
    events: [createMatchEvent(match.id, "match_created", `${input.label}生成场次`)],
  };
}

function applyMatchToStandings(standings: Map<string, PlayerStanding>, match: Match, ruleSet: RuleSet) {
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
  red.disciplinePenalty += calculateDisciplinePenalty(match, "red", ruleSet);
  blue.disciplinePenalty += calculateDisciplinePenalty(match, "blue", ruleSet);

  if (match.winner === "draw") {
    red.eventPoints += 1;
    blue.eventPoints += 1;
    red.draws += 1;
    blue.draws += 1;
    return;
  }

  const winner = match.winner === "red" ? red : blue;
  const loser = match.winner === "red" ? blue : red;
  winner.eventPoints += 3;
  winner.realWins += 1;
  loser.losses += 1;
}

function calculateDisciplinePenalty(match: Match, side: "red" | "blue", ruleSet: RuleSet) {
  const warnings = side === "red" ? match.redWarnings : match.blueWarnings;
  return Object.entries(warnings ?? {}).reduce((total, [warningId, count]) => {
    const warning = ruleSet.warningLevels.find((item) => item.id === warningId);
    return total + Math.abs(warning?.scoreDelta ?? 0) * count;
  }, 0);
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

function rankStandings(standings: PlayerStanding[]): TournamentRanking[] {
  return [...standings].sort(compareStandings).map((standing, index) => ({
    ...standing,
    rank: index + 1,
    advanced: false,
    needsPlayoff: false,
  }));
}

function compareStandings(a: PlayerStanding, b: PlayerStanding) {
  return (
    b.eventPoints - a.eventPoints ||
    b.realWins - a.realWins ||
    b.scoreDiff - a.scoreDiff ||
    a.disciplinePenalty - b.disciplinePenalty ||
    a.name.localeCompare(b.name, "zh-Hans-CN")
  );
}

function compareRankings(a: TournamentRanking, b: TournamentRanking) {
  return compareStandings(a, b);
}

function comparePlayersBySeed(a: TournamentPlayer, b: TournamentPlayer) {
  const seedA = a.seed ?? Number.MAX_SAFE_INTEGER;
  const seedB = b.seed ?? Number.MAX_SAFE_INTEGER;
  return seedA - seedB || a.name.localeCompare(b.name, "zh-Hans-CN");
}

function restoreOriginalPlayerOrder(original: TournamentPlayer[], grouped: TournamentPlayer[]) {
  const groupedById = new Map(grouped.map((player) => [player.id, player]));
  return original.map((player) => groupedById.get(player.id) ?? player);
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
