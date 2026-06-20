export const PC_PHASE_MOVEMENT = 0;
export const PC_PHASE_STANDARD = 1;
export const PC_SKIP_INITIATIVE_REANCHOR_OPTION = "peasantCoreSkipInitiativeReanchor";

const TURN_COMPLETION_ACTION = "nextTurn";

const normalizeId = function(id) {
  return String(id || "");
};

export const normalizeCombatPhase = function(phase) {
  return Number(phase) === PC_PHASE_STANDARD ? PC_PHASE_STANDARD : PC_PHASE_MOVEMENT;
};

export const getCombatPhase = function(combat) {
  return normalizeCombatPhase(combat?.getFlag("peasant-core", "combatPhase"));
};

export const getCombatTurns = function(combat) {
  if (!combat) return [];
  if (!combat.turns || combat.turns.length === 0) combat.setupTurns();
  return Array.from(combat.turns || []);
};

export const getTurnIndexByCombatantId = function(turns, id) {
  const safeId = normalizeId(id);
  if (!safeId) return -1;
  return Array.from(turns || []).findIndex(c => normalizeId(c?.id) === safeId);
};

export const getPhaseOrderedTurns = function(turns, phase = PC_PHASE_MOVEMENT) {
  const ordered = Array.from(turns || []).filter(Boolean);
  return normalizeCombatPhase(phase) === PC_PHASE_STANDARD ? ordered.reverse() : ordered;
};

export const getSeizedIdsForPhase = function(combat, phase) {
  const flag = normalizeCombatPhase(phase) === PC_PHASE_STANDARD ? "seizedStandard" : "seizedMovement";
  const value = combat?.getFlag("peasant-core", flag);
  return Array.isArray(value) ? value.map(normalizeId).filter(Boolean) : [];
};

export const getCompletedIdsFromTurnHistory = function(history, {
  round = 0,
  phase = PC_PHASE_MOVEMENT,
  additionalCompletedIds = []
} = {}) {
  const targetRound = Number(round ?? 0);
  const targetPhase = normalizeCombatPhase(phase);
  const completed = new Set(Array.from(additionalCompletedIds || []).map(normalizeId).filter(Boolean));

  for (const entry of Array.isArray(history) ? history : []) {
    if (entry?.type !== "transition") continue;
    if (String(entry.action || "") !== TURN_COMPLETION_ACTION) continue;

    const from = entry.from || {};
    if (Number(from.round ?? 0) !== targetRound) continue;
    if (normalizeCombatPhase(from.phase) !== targetPhase) continue;

    const id = normalizeId(from.combatantId);
    if (id) completed.add(id);
  }

  return completed;
};

export const getFirstPendingTurnIndex = function({
  turns,
  history,
  round = 0,
  phase = PC_PHASE_MOVEMENT,
  seizedIds = [],
  additionalCompletedIds = []
} = {}) {
  const completed = getCompletedIdsFromTurnHistory(history, { round, phase, additionalCompletedIds });
  const seized = new Set(Array.from(seizedIds || []).map(normalizeId).filter(Boolean));

  for (const combatant of getPhaseOrderedTurns(turns, phase)) {
    const id = normalizeId(combatant?.id);
    if (!id || completed.has(id) || seized.has(id)) continue;
    return getTurnIndexByCombatantId(turns, id);
  }

  return -1;
};

export const getFirstPendingTurnIndexForCombat = function(combat, {
  phase = getCombatPhase(combat),
  additionalCompletedIds = []
} = {}) {
  return getFirstPendingTurnIndex({
    turns: getCombatTurns(combat),
    history: combat?.getFlag("peasant-core", "turnHistory"),
    round: combat?.round,
    phase,
    seizedIds: getSeizedIdsForPhase(combat, phase),
    additionalCompletedIds
  });
};

export const getReanchoredTurnForCombat = function(combat, options = {}) {
  const currentPhase = normalizeCombatPhase(options.phase ?? getCombatPhase(combat));
  const movementTurn = getFirstPendingTurnIndexForCombat(combat, {
    phase: PC_PHASE_MOVEMENT,
    additionalCompletedIds: currentPhase === PC_PHASE_MOVEMENT ? options.additionalCompletedIds : []
  });

  if (currentPhase === PC_PHASE_MOVEMENT && movementTurn >= 0) {
    return { phase: PC_PHASE_MOVEMENT, turn: movementTurn };
  }

  const standardTurn = getFirstPendingTurnIndexForCombat(combat, {
    phase: PC_PHASE_STANDARD,
    additionalCompletedIds: currentPhase === PC_PHASE_STANDARD ? options.additionalCompletedIds : []
  });
  if (standardTurn >= 0) return { phase: PC_PHASE_STANDARD, turn: standardTurn };
  return { phase: currentPhase, turn: -1 };
};

export const getSeizeEligibility = function({
  turns,
  history,
  round = 0,
  currentTurn = -1,
  currentPhase = PC_PHASE_MOVEMENT,
  targetId,
  targetPhase = PC_PHASE_MOVEMENT,
  seizedMovementIds = [],
  seizedStandardIds = []
} = {}) {
  const currentIndex = Number(currentTurn);
  const targetIndex = getTurnIndexByCombatantId(turns, targetId);
  if (!Number.isFinite(currentIndex) || targetIndex === -1) {
    return { ok: false, reason: "Combat turn order is unavailable." };
  }

  if (targetIndex <= currentIndex) {
    return { ok: false, reason: "Only higher initiative combatants can seize." };
  }

  const safeTargetId = normalizeId(targetId);
  const movementComplete = getCompletedIdsFromTurnHistory(history, { round, phase: PC_PHASE_MOVEMENT });
  const standardComplete = getCompletedIdsFromTurnHistory(history, { round, phase: PC_PHASE_STANDARD });
  const seizedMovement = new Set(Array.from(seizedMovementIds || []).map(normalizeId).filter(Boolean));
  const seizedStandard = new Set(Array.from(seizedStandardIds || []).map(normalizeId).filter(Boolean));
  const normalizedCurrentPhase = normalizeCombatPhase(currentPhase);

  const movementPassed = normalizedCurrentPhase === PC_PHASE_STANDARD
    || movementComplete.has(safeTargetId)
    || seizedMovement.has(safeTargetId);
  const standardPassed = standardComplete.has(safeTargetId)
    || seizedStandard.has(safeTargetId);

  if (normalizeCombatPhase(targetPhase) === PC_PHASE_MOVEMENT) {
    if (seizedMovement.has(safeTargetId)) return { ok: false, reason: "Movement has already been seized for that combatant." };
    if (movementPassed) return { ok: false, reason: "Movement can no longer be seized." };
  } else {
    if (seizedStandard.has(safeTargetId)) return { ok: false, reason: "Standard has already been seized for that combatant." };
    if (standardPassed) return { ok: false, reason: "Standard can no longer be seized." };
  }

  return { ok: true, currentIndex, targetIndex, movementPassed, standardPassed };
};
