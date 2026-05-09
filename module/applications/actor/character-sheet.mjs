import { PeasantCharacterModel } from "../../data/actor/character.mjs";
import { computeBaseAttrToHits, computeBaseSaves } from "../../data/actor/attributes.mjs";
import { COMBAT_DEFENSE_BLOCK_TYPES, COMBAT_DEFENSE_RESPONSE_OPTIONS, createDefaultCombatDefense, createDefaultCombatDefenseEffectivenessEntry, getCombatDefenseResponseKey, getCombatDefenseSummary, normalizeCombatDefense, normalizeCombatDefenseBlockType, normalizeCombatDefenseEffectivenessEntry, parseCombatDefenseMosPer } from "../../data/actor/combat-defense.mjs";
import { COMBAT_EDITOR_TAG_TYPES, COMBAT_VIEW_TAG_TYPES, getCombatCustomTags } from "../../data/actor/combat-tags.mjs";
import { COMBAT_COST_RESOURCE_TYPES, COMBAT_HALT_BUFF_TYPE_COST, COMBAT_HALT_BUFF_TYPE_CUSTOM, COMBAT_HALT_BUFF_TYPE_FLAT, COMBAT_HALT_BUFF_TYPE_HALT, COMBAT_HALT_BUFF_TYPE_NATURAL, getCombatCostModifiers, getCombatFlatDamageModifier, getCombatHaltBuffTotals, normalizeHaltSlashValue, normalizeHaltSlashValueEditable, parseHaltSlashValues, sanitizeCombatCostResourceType, sanitizeCombatHaltBuffs, sanitizeCombatHaltBuffType } from "../../data/actor/combat-modifiers.mjs";
import { EDGE_LABEL_MODE_CUSTOM, getDefaultEdgeLabelMode, normalizeEdgeResourceEntry, resolveEdgeLabel, sanitizeEdgeLabelMode } from "../../data/actor/edge-resources.mjs";
import { getActorBolsteredMax, getActorHealthMax, isPeasantCharacterType, isSimplifiedHpActor } from "../../data/actor/helpers.mjs";
import { getForcePassSpendTypeLabel, getForcePassStressCostFromRollResult, getPreAccuracyMoSFromRollResult, getStressCapacityForSpendType, spendStressForForcePass } from "../../data/actor/stress.mjs";
import { LOWEST_HALT_LOCATION_PRIORITY, PC_ARMOR_CHARGE_MULTIPLIER_FLAG, PC_DEFAULT_ARMOR_CHARGE_MULTIPLIER, PC_DEFAULT_WOUND_ARMS_MULTIPLIER, PC_DEFAULT_WOUND_HEAD_MULTIPLIER, PC_DEFAULT_WOUND_LEGS_MULTIPLIER, PC_DEFAULT_WOUND_TORSO_MULTIPLIER, PC_WOUND_ARMS_MULTIPLIER_FLAG, PC_WOUND_HEAD_MULTIPLIER_FLAG, PC_WOUND_LEGS_MULTIPLIER_FLAG, PC_WOUND_TORSO_MULTIPLIER_FLAG, TARGETED_DAMAGE_HALT_INDEX_MAP, getWoundThresholdMultipliers, sanitizePositiveMultiplier } from "../../data/actor/targeted-damage.mjs";
import { PeasantActor } from "../../documents/actor.mjs";
import { applyDieRate, formatCombatDiceValue, hasCombatDice, parseCombatDiceValue } from "../../dice/combat-dice.mjs";
import { applyToHitAccuracy, applyToHitFloor } from "../../dice/roll-targets.mjs";
import { performConsciousnessCheck, performSkillRoll, performUntrainedSkillRoll, performSavingRoll } from "../../dice/rolls.mjs";
import { configurePeasantActorSheetHooks } from "./hooks.mjs";
import { createChosenLocationTableMessage, createLocationRollFromSkillOption, drawLocationTableLikeMacro, getTargetedDamageLocationDisplay, isArmorPenLocationLike, normalizeAppliedDamageType, rollAutomatedAttackLocation, showLocationBySkillPrompt } from "./location-table.mjs";
import { showReadonlyDescriptionDialog } from "./description-dialogs.mjs";
import { setupSheetDraggablePopups } from "./draggable.mjs";
import { setupPortraitControls, teardownPortraitBindings } from "./portrait-controls.mjs";
import { confirmPeasantResourceRefresh, confirmPeasantRest } from "./rest-controls.mjs";
import { applyTargetedDamageWorkflow } from "./targeted-damage-workflow.mjs";
import { ensureSlideToggleElement } from "../components/slide-toggle.mjs";
import { renderDialogCompat } from "../dialogs.mjs";
import { registerPeasantCoreApi } from "../../utils/api.mjs";
import { applyRollMode, escapeHtml } from "../../utils/chat.mjs";
import { pcLog } from "../../utils/logging.mjs";
import { PC_SOCKET_NAMESPACE, PC_SOCKET_PROMPT_DEFENSE, PC_SOCKET_PROMPT_INCOMING_HIT } from "../../socket/remote-prompts.mjs";

const ActorSheetV2Class = foundry?.applications?.sheets?.ActorSheetV2;
const HandlebarsApplicationMixin = foundry?.applications?.api?.HandlebarsApplicationMixin;
if (!ActorSheetV2Class || !HandlebarsApplicationMixin) {
  throw new Error("Peasant Core requires Foundry's ActorSheetV2 and HandlebarsApplicationMixin.");
}
const ActorSheetBase = HandlebarsApplicationMixin(ActorSheetV2Class);
const DocumentSheetConfig = foundry?.applications?.apps?.DocumentSheetConfig;
// Core's fallback actor sheet is still AppV1; this reference only unregisters it.
const CoreActorSheetClass = foundry?.appv1?.sheets?.ActorSheet;
const TokenHUDClass = foundry?.applications?.hud?.TokenHUD ?? globalThis.TokenHUD;
const TextEditorImplementation = foundry?.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
const PC_CONSCIOUSNESS_SAVE_FLAG = "rollConsciousnessAsSaves";
const PC_INITIATIVE_SAVE_FLAG = "rollInitiativeAsSaves";
const PC_SIMPLIFIED_HP_FLAG = "simplifiedHp";
const PC_RUN_MULTIPLIER_FLAG = "runMultiplier";
const PC_DEFAULT_RUN_MULTIPLIER = 2;
const PC_SPRINT_MULTIPLIER_FLAG = "sprintMultiplier";
const PC_DEFAULT_SPRINT_MULTIPLIER = 6;
const PC_SAVE_MODIFIER_FLAG = "saveModifier";
const PC_DEFAULT_SAVE_MODIFIER = 0;
const PC_PRIMAL_EVASION_FLAG = "primalEvasion";
const PC_DEFAULT_PRIMAL_EVASION = 0;
const PC_DEFENSE_FAVORITES_FLAG = "defenseFavorites";
const PC_ART_PANEL_COLLAPSED_FLAG = "artPanelCollapsed";
const PC_ACTIVE_REMOTE_PROMPTS = new Map();
const PC_CANCELLED_REMOTE_PROMPTS = new Set();
const PC_DEFAULT_SHEET_TEMPLATE = "systems/peasant-core/templates/actor/character-sheet.html";

const PC_ACTOR_SETTING_DEFINITIONS = Object.freeze([
  {
    group: "Rolls",
    label: "Roll consciousness checks as saves?",
    hint: "If checked, consciousness checks use 3d6 and keep the highest 2 dice.",
    type: "boolean",
    flagKey: PC_CONSCIOUSNESS_SAVE_FLAG
  },
  {
    group: "Rolls",
    label: "Roll initiative checks as saves?",
    hint: "If checked, initiative checks use 3d6 and keep the highest 2 dice.",
    type: "boolean",
    flagKey: PC_INITIATIVE_SAVE_FLAG
  },
  {
    group: "Health",
    label: "Simplified HP?",
    hint: "If checked, this actor uses current/max HP without the HP grid, wounds, or wound thresholds.",
    type: "boolean",
    flagKey: PC_SIMPLIFIED_HP_FLAG
  },
  {
    group: "Rolls",
    label: "Save modifiers?",
    hint: "Adds to save THs shown in the attribute table. Use positive or negative whole numbers.",
    type: "number",
    flagKey: PC_SAVE_MODIFIER_FLAG,
    defaultValue: PC_DEFAULT_SAVE_MODIFIER,
    allowNegative: true
  },
  {
    group: "Defenses",
    label: "Primal Evasion?",
    hint: "When 1 or higher, choosing None as the defensive reflex applies this as an Accuracy penalty to non-Smite attacks.",
    type: "number",
    flagKey: PC_PRIMAL_EVASION_FLAG,
    defaultValue: PC_DEFAULT_PRIMAL_EVASION,
    min: 0
  },
  {
    group: "Movement",
    label: "Run multiplier?",
    hint: "Adjusts the movement run value multiplier shown on this sheet.",
    type: "number",
    flagKey: PC_RUN_MULTIPLIER_FLAG,
    defaultValue: PC_DEFAULT_RUN_MULTIPLIER,
    min: 1
  },
  {
    group: "Movement",
    label: "Sprint multiplier?",
    hint: "Adjusts the movement sprint value multiplier shown on this sheet.",
    type: "number",
    flagKey: PC_SPRINT_MULTIPLIER_FLAG,
    defaultValue: PC_DEFAULT_SPRINT_MULTIPLIER,
    min: 1
  },
  {
    group: "Health",
    label: "Armor charge multiplier?",
    hint: "Adjusts how much armor HALT is multiplied by when Armor Charge is checked in Take Damage.",
    type: "number",
    flagKey: PC_ARMOR_CHARGE_MULTIPLIER_FLAG,
    defaultValue: PC_DEFAULT_ARMOR_CHARGE_MULTIPLIER,
    min: 0.1,
    allowDecimal: true
  },
  {
    group: "Wound Thresholds",
    label: "Wound head multiplier?",
    hint: "Head wound threshold multiplier.",
    type: "number",
    flagKey: PC_WOUND_HEAD_MULTIPLIER_FLAG,
    defaultValue: PC_DEFAULT_WOUND_HEAD_MULTIPLIER,
    min: 0.1,
    allowDecimal: true
  },
  {
    group: "Wound Thresholds",
    label: "Wound arms multiplier?",
    hint: "Arms wound threshold multiplier.",
    type: "number",
    flagKey: PC_WOUND_ARMS_MULTIPLIER_FLAG,
    defaultValue: PC_DEFAULT_WOUND_ARMS_MULTIPLIER,
    min: 0.1,
    allowDecimal: true
  },
  {
    group: "Wound Thresholds",
    label: "Wound legs multiplier?",
    hint: "Legs wound threshold multiplier.",
    type: "number",
    flagKey: PC_WOUND_LEGS_MULTIPLIER_FLAG,
    defaultValue: PC_DEFAULT_WOUND_LEGS_MULTIPLIER,
    min: 0.1,
    allowDecimal: true
  },
  {
    group: "Wound Thresholds",
    label: "Wound torso multiplier?",
    hint: "Torso wound threshold multiplier.",
    type: "number",
    flagKey: PC_WOUND_TORSO_MULTIPLIER_FLAG,
    defaultValue: PC_DEFAULT_WOUND_TORSO_MULTIPLIER,
    min: 0.1,
    allowDecimal: true
  }
]);

ensureSlideToggleElement();

function getApplicationElement(appOrElement) {
  const source = appOrElement?.element ?? appOrElement;
  if (!source) return null;
  if (source.nodeType === 1 && typeof source.querySelector === "function") return source;
  if (source instanceof jQuery) return source[0] ?? null;
  if (Array.isArray(source)) return getApplicationElement(source[0]);
  const first = source?.[0];
  return first?.nodeType === 1 && typeof first.querySelector === "function" ? first : null;
}

function getApplicationJQuery(appOrElement) {
  const element = getApplicationElement(appOrElement);
  return element ? $(element) : $();
}

function sanitizePeasantCoreSettingNumber(setting, value) {
  if (setting?.allowNegative) {
    const fallbackRaw = Number.parseInt(setting.defaultValue ?? 0, 10);
    const fallback = Number.isFinite(fallbackRaw) ? fallbackRaw : 0;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  if (setting?.allowDecimal) {
    return sanitizePositiveMultiplier(value, setting.defaultValue ?? 1, setting.min ?? 0.1);
  }

  const parsed = Math.floor(Number(value));
  const fallback = Math.floor(Number(setting?.defaultValue ?? 1));
  const min = Number.isFinite(Number(setting?.min)) ? Number(setting.min) : 1;
  return Number.isFinite(parsed) ? Math.max(min, parsed) : Math.max(min, Number.isFinite(fallback) ? fallback : 1);
}

function getPeasantCoreSettingValue(actor, setting) {
  const raw = actor?.getFlag?.("peasant-core", setting.flagKey);
  if (setting.type === "boolean") return !!raw;
  return sanitizePeasantCoreSettingNumber(setting, raw);
}

function getPeasantCoreSettingGroups(actor, editable = true) {
  const groupMap = new Map();

  for (const setting of PC_ACTOR_SETTING_DEFINITIONS) {
    const group = setting.group || "Settings";
    if (!groupMap.has(group)) groupMap.set(group, []);

    const value = getPeasantCoreSettingValue(actor, setting);
    const hasMin = Number.isFinite(Number(setting.min));
    groupMap.get(group).push({
      ...setting,
      id: `pc-setting-${setting.flagKey}`,
      isBoolean: setting.type === "boolean",
      checked: value === true,
      value,
      editable,
      step: setting.allowDecimal ? "0.1" : "1",
      inputMode: setting.allowDecimal ? "decimal" : "numeric",
      hasMin,
      min: hasMin ? setting.min : null
    });
  }

  return Array.from(groupMap, ([label, settings]) => ({ label, settings }));
}

function formatThresholdValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n - Math.round(n)) < 0.00001) return String(Math.round(n));
  return String(Number(n.toFixed(2)));
}

function registerActiveRemotePrompt(promptId, closer) {
  const key = String(promptId || "").trim();
  if (!key || typeof closer !== "function") return;
  PC_ACTIVE_REMOTE_PROMPTS.set(key, closer);
  if (PC_CANCELLED_REMOTE_PROMPTS.has(key)) {
    PC_CANCELLED_REMOTE_PROMPTS.delete(key);
    queueMicrotask(() => {
      void closer({ selection: "close", chainCancelled: true });
    });
  }
}

function unregisterActiveRemotePrompt(promptId, closer = null) {
  const key = String(promptId || "").trim();
  if (!key) return;
  if (closer && PC_ACTIVE_REMOTE_PROMPTS.get(key) !== closer) return;
  PC_ACTIVE_REMOTE_PROMPTS.delete(key);
}

async function closeActiveRemotePrompt(promptId, result = {}) {
  const key = String(promptId || "").trim();
  if (!key) return false;
  const closer = PC_ACTIVE_REMOTE_PROMPTS.get(key);
  if (typeof closer !== "function") {
    PC_CANCELLED_REMOTE_PROMPTS.add(key);
    return false;
  }
  try {
    await closer(result);
    return true;
  } catch (e) {
    pcLog.debug("Peasant Core | Failed to close active remote prompt", { promptId: key, error: e });
    return false;
  }
}

function getPreferredActorToken(actor) {
  if (!actor) return null;

  const controlledToken = Array.from(canvas?.tokens?.controlled || [])
    .find((token) => token?.actor?.id === actor.id);
  if (controlledToken) return controlledToken;

  try {
    const activeTokens = typeof actor.getActiveTokens === "function"
      ? actor.getActiveTokens(true, true)
      : [];
    return activeTokens.find(Boolean) || null;
  } catch (e) {
    pcLog.debug("Peasant Core | Failed to resolve preferred actor token", e);
    return null;
  }
}

function getActorRollSpeaker(actor, token = null) {
  const resolvedToken = token || getPreferredActorToken(actor);
  if (resolvedToken) {
    return ChatMessage.getSpeaker({ actor, token: resolvedToken.document ?? resolvedToken });
  }
  return ChatMessage.getSpeaker({ actor });
}

function userOwnsActorOrToken(user, actor, tokenDocument = null) {
  if (!user) return false;
  if (user.isGM) return true;

  const ownerLevel = CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;

  try {
    if (typeof actor?.testUserPermission === "function" && actor.testUserPermission(user, ownerLevel)) {
      return true;
    }
  } catch (e) {
    pcLog.debug("Peasant Core | Actor permission check failed while selecting defense recipient", e);
  }

  try {
    if (typeof tokenDocument?.testUserPermission === "function" && tokenDocument.testUserPermission(user, ownerLevel)) {
      return true;
    }
  } catch (e) {
    pcLog.debug("Peasant Core | Token permission check failed while selecting defense recipient", e);
  }

  try {
    if (typeof actor?.canUserModify === "function" && actor.canUserModify(user, "update")) {
      return true;
    }
  } catch (e) {
    pcLog.debug("Peasant Core | Actor modify check failed while selecting defense recipient", e);
  }

  try {
    if (user?.character?.id && actor?.id && user.character.id === actor.id) {
      return true;
    }
  } catch (e) {}

  return false;
}

function getPreferredDefensePromptRecipientUser(actor, tokenDocument = null) {
  const activePlayers = Array.from(game?.users || [])
    .filter((user) => user?.active && !user?.isGM)
    .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
  const playerRecipient = activePlayers.find((user) => userOwnsActorOrToken(user, actor, tokenDocument));
  if (playerRecipient) return playerRecipient;

  const activeGMs = Array.from(game?.users || [])
    .filter((user) => user?.active && user?.isGM)
    .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
  return activeGMs[0] || null;
}

function getMatchingDefenseNotables(actor, targetingType) {
  const targetKey = getCombatDefenseResponseKey(targetingType);
  if (!actor || !targetKey) return [];

  const combats = Array.isArray(actor.system?.notableCombats) ? actor.system.notableCombats : [];
  return combats.reduce((matches, combat, index) => {
    const defenseData = normalizeCombatDefense(combat?.defense);
    const responses = Array.isArray(defenseData.responses) ? defenseData.responses : [];
    const matchesTargetingType = responses.some((response) => getCombatDefenseResponseKey(response) === targetKey);
    if (!matchesTargetingType) return matches;

    matches.push({
      index,
      combat,
      defense: defenseData
    });
    return matches;
  }, []);
}

function getNotableCombatRollPreview(actor, combat) {
  if (!actor || !combat) {
    return {
      allowToHitAcc: false,
      hasToHit: false,
      hasAccuracy: false,
      modifiedTohit: "",
      accuracyNum: 0,
      accuracySign: "+"
    };
  }

  const combatMods = actor.system?.combatMods || { toHit: 0, accuracy: 0 };
  const toHitMod = Number.parseInt(combatMods.toHit, 10) || 0;
  const accuracyMod = Number.parseInt(combatMods.accuracy, 10) || 0;
  const baseAccuracy = Number.parseInt(combat.accuracy, 10) || 0;
  const baseTohit = Number.isFinite(Number.parseInt(combat.tohit, 10))
    ? Number.parseInt(combat.tohit, 10)
    : 7;
  const combatCalc = applyToHitAccuracy(baseTohit, baseAccuracy, toHitMod, accuracyMod, 2);
  const accuracyNum = combatCalc.accuracy;
  const modifiedTohit = combatCalc.toHit;
  const isStandard = !combat.type || combat.type === "standard";
  const combatTypeKey = String(combat.type || "").trim().toLowerCase();
  const noToHitTypes = new Set(["stance", "perk", "style", "cantrip", "tm"]);
  const allowToHitAcc = isStandard || !noToHitTypes.has(combatTypeKey);

  return {
    allowToHitAcc,
    hasToHit: allowToHitAcc && !!combat.tohit,
    hasAccuracy: allowToHitAcc && (accuracyNum !== 0 || baseAccuracy !== 0),
    modifiedTohit,
    accuracyNum,
    accuracySign: accuracyNum >= 0 ? "+" : ""
  };
}

function getDefenseFavoriteKey(targetingType) {
  const responseKey = getCombatDefenseResponseKey(targetingType);
  if (responseKey) return responseKey;
  return String(targetingType ?? "").trim().toLowerCase();
}

function getDefenseFavorites(actor) {
  const raw = actor?.getFlag?.("peasant-core", PC_DEFENSE_FAVORITES_FLAG);
  return (raw && typeof raw === "object") ? foundry.utils.deepClone(raw) : {};
}

function getPreferredDefenseMatch(actor, targetingType, matchingDefenses) {
  const favoriteKey = getDefenseFavoriteKey(targetingType);
  const favorites = getDefenseFavorites(actor);
  const favorite = favorites?.[favoriteKey];
  if (!favorite || !Array.isArray(matchingDefenses) || !matchingDefenses.length) return null;

  const favoriteIndex = Number.parseInt(favorite.index, 10);
  const favoriteName = String(favorite.name || "").trim();

  if (Number.isFinite(favoriteIndex)) {
    const directMatch = matchingDefenses.find(({ index, combat }) => (
      index === favoriteIndex
      && (!favoriteName || String(combat?.name || "").trim() === favoriteName)
    ));
    if (directMatch) return directMatch;
  }

  if (favoriteName) {
    const nameMatch = matchingDefenses.find(({ combat }) => String(combat?.name || "").trim() === favoriteName);
    if (nameMatch) return nameMatch;
  }

  return null;
}

function getDefenseEffectivenessForTargeting(defenseData, targetingType) {
  const targetKey = getCombatDefenseResponseKey(targetingType);
  if (!targetKey) return createDefaultCombatDefenseEffectivenessEntry();
  return normalizeCombatDefenseEffectivenessEntry(defenseData?.effectiveness?.[targetKey]);
}

function getAccuracyPenaltyFromDefenseRoll(defenseData, targetingType, rollResult) {
  const effectiveness = getDefenseEffectivenessForTargeting(defenseData, targetingType);
  const mosPer = parseCombatDefenseMosPer(effectiveness?.mosPer);
  const accuracyPenalty = Number.parseInt(effectiveness?.accuracyPenalty, 10) || 0;
  const totalMoS = Number(rollResult?.totalMoS);

  if (!Number.isFinite(totalMoS) || totalMoS <= 0 || mosPer <= 0 || accuracyPenalty === 0) {
    return 0;
  }

  const steps = Math.floor((totalMoS + 1e-9) / mosPer);
  if (steps <= 0) return 0;
  return steps * accuracyPenalty;
}

function getActorPrimalEvasionValue(actor) {
  const rawValue = Number(actor?.getFlag?.("peasant-core", PC_PRIMAL_EVASION_FLAG));
  if (!Number.isFinite(rawValue)) return PC_DEFAULT_PRIMAL_EVASION;
  return Math.max(0, Math.floor(rawValue));
}

function canApplyPrimalEvasion(actor, targetingType) {
  if (getCombatDefenseResponseKey(targetingType) === "smite") return false;
  return getActorPrimalEvasionValue(actor) >= 1;
}

function createPrimalEvasionDefenseResult(actor, targetingType) {
  const penalty = canApplyPrimalEvasion(actor, targetingType) ? getActorPrimalEvasionValue(actor) : 0;
  return {
    handled: true,
    selection: "none",
    selectedCombatIndex: null,
    selectedDefense: null,
    defenseRoll: null,
    appliedAccuracyPenalty: penalty,
    appliedToHitPenalty: 0,
    activeDefense: penalty >= 1,
    primalEvasionPenalty: penalty
  };
}

function getToHitPenaltyFromDefenseRoll(defenseData, rollResult) {
  const defense = normalizeCombatDefense(defenseData);
  const totalMoS = Number(rollResult?.totalMoS);
  if (!defense.appliesDebuff) return 0;
  if (!defense.appliesBefore) return 0;
  if (!Number.isFinite(totalMoS) || totalMoS < 0) return 0;
  return Number.parseInt(defense.debuffToHit, 10) || 0;
}

function doesPromptResultCountAsActiveDefense(defensePromptResult) {
  if (!defensePromptResult || typeof defensePromptResult !== "object") return false;
  if (defensePromptResult.selection === "defense") return true;
  return !!defensePromptResult.activeDefense;
}

function getFailureLabelFromDefensePromptResult(defensePromptResult) {
  if (Number(defensePromptResult?.primalEvasionPenalty) >= 1) {
    return "Failure due to Primal Evasion";
  }
  return "Failure due to Defense";
}

async function setPreferredDefenseMatch(actor, targetingType, defenseMatch) {
  const favoriteKey = getDefenseFavoriteKey(targetingType);
  if (!actor?.setFlag || !favoriteKey || !defenseMatch) return false;

  const favoriteIndex = Number.parseInt(defenseMatch.index, 10);
  if (!Number.isFinite(favoriteIndex)) return false;

  const favorites = getDefenseFavorites(actor);
  favorites[favoriteKey] = {
    index: favoriteIndex,
    name: String(defenseMatch?.combat?.name || "").trim()
  };
  await actor.setFlag("peasant-core", PC_DEFENSE_FAVORITES_FLAG, favorites);
  return true;
}

async function clearPreferredDefenseMatch(actor, targetingType) {
  const favoriteKey = getDefenseFavoriteKey(targetingType);
  if (!actor?.setFlag || !favoriteKey) return false;

  const favorites = getDefenseFavorites(actor);
  if (!(favoriteKey in favorites)) return true;

  delete favorites[favoriteKey];
  if (Object.keys(favorites).length > 0) {
    await actor.setFlag("peasant-core", PC_DEFENSE_FAVORITES_FLAG, favorites);
  } else if (typeof actor.unsetFlag === "function") {
    await actor.unsetFlag("peasant-core", PC_DEFENSE_FAVORITES_FLAG);
  } else {
    await actor.setFlag("peasant-core", PC_DEFENSE_FAVORITES_FLAG, {});
  }
  return true;
}

async function resolveDefensePromptActor(payload = {}) {
  const targetSceneId = String(payload.targetSceneId || "").trim();
  const targetTokenId = String(payload.targetTokenId || "").trim();
  if (targetSceneId && targetTokenId) {
    try {
      const tokenDocument = game.scenes?.get(targetSceneId)?.tokens?.get(targetTokenId) || null;
      const actor = tokenDocument?.actor || tokenDocument?.object?.actor || null;
      if (actor) return actor;
    } catch (e) {
      pcLog.debug("Peasant Core | Failed to resolve defense prompt actor from scene token ids", e);
    }
  }

  const directActorId = String(payload.targetActorId || "").trim();
  if (directActorId) {
    const actor = game.actors?.get(directActorId);
    if (actor) return actor;
  }

  const actorUuid = String(payload.targetActorUuid || "").trim();
  if (actorUuid && typeof fromUuid === "function") {
    try {
      const actor = await fromUuid(actorUuid);
      if (actor?.documentName === "Actor" || String(actor?.collectionName || "").toLowerCase() === "actors") {
        return actor;
      }
    } catch (e) {
      pcLog.debug("Peasant Core | Failed to resolve defense prompt actor from UUID", e);
    }
  }

  const tokenUuid = String(payload.targetTokenUuid || "").trim();
  if (tokenUuid && typeof fromUuid === "function") {
    try {
      const tokenDocument = await fromUuid(tokenUuid);
      const actor = tokenDocument?.actor || tokenDocument?.object?.actor || null;
      if (actor) return actor;
    } catch (e) {
      pcLog.debug("Peasant Core | Failed to resolve defense prompt token actor from UUID", e);
    }
  }

  return null;
}

async function consumeNotableCombatRollUse(actor, combatIndex, sheet = null) {
  try {
    const result = await actor?.consumePeasantCombatUse?.(combatIndex);
    if (result?.changed && typeof sheet?.render === "function") sheet.render(false);
    return result;
  } catch (err) {
    console.warn("Failed to consume combat use after autoroll:", err);
    return { ok: false, changed: false, error: err };
  }
}

async function emitDefensePromptRequestsForAttack({ actor, combat, combatIndex, attackerToken = null } = {}) {
  const targetingType = String(combat?.targetingType || "").trim();
  if (!targetingType) {
    pcLog.debug("Peasant Core | Defense prompt skipped: no targeting type", {
      actor: actor?.name,
      combatIndex,
      combatName: combat?.name || "Combat"
    });
    return { totalAccuracyPenalty: 0, promptResults: [] };
  }

  const targets = Array.from(game.user?.targets || []).filter((token) => token?.actor);
  if (!targets.length) {
    pcLog.debug("Peasant Core | Defense prompt skipped: no targeted tokens", {
      actor: actor?.name,
      combatIndex,
      combatName: combat?.name || "Combat",
      targetingType
    });
    return { totalAccuracyPenalty: 0, promptResults: [] };
  }

  const resolvedAttackerToken = attackerToken || getPreferredActorToken(actor);
  const attackerTokenDocument = resolvedAttackerToken?.document ?? resolvedAttackerToken ?? null;
  const attackerTokenName = String(
    resolvedAttackerToken?.name
    || attackerTokenDocument?.name
    || actor?.name
    || "Attacker"
  ).trim() || "Attacker";

  const promptResults = [];

  for (const targetToken of targets) {
    const targetTokenDocument = targetToken?.document ?? targetToken ?? null;
    const targetActor = targetToken?.actor || targetTokenDocument?.actor || null;
    if (!targetActor) continue;
    const recipient = getPreferredDefensePromptRecipientUser(targetActor, targetTokenDocument);
    if (!recipient?.id) {
      pcLog.debug("Peasant Core | Defense prompt skipped: no recipient user found", {
        target: targetTokenDocument?.name || targetActor?.name,
        targetActorId: targetActor?.id,
        targetingType
      });
      continue;
    }

    const payload = {
      promptId: foundry.utils.randomID(),
      type: PC_SOCKET_PROMPT_DEFENSE,
      originatingUserId: game.user?.id || null,
      recipientUserId: recipient.id,
      attackerActorId: actor?.id || null,
      attackerActorUuid: actor?.uuid || null,
      attackerTokenUuid: attackerTokenDocument?.uuid || null,
      attackerTokenName,
      attackCombatIndex: combatIndex,
      attackCombatName: String(combat?.name || "Attack").trim() || "Attack",
      attackTargetingType: targetingType,
      targetSceneId: targetTokenDocument?.parent?.id || targetTokenDocument?.scene?.id || null,
      targetTokenId: targetTokenDocument?.id || null,
      targetTokenUuid: targetTokenDocument?.uuid || null,
      targetTokenName: String(targetToken?.name || targetTokenDocument?.name || targetActor?.name || "").trim(),
      targetActorId: targetActor?.id || null,
      targetActorUuid: targetActor?.uuid || null
    };

    const requestDefensePromptForUser = game.peasantCore?.requestDefensePromptForUser;
    const cancelPromptForUser = game.peasantCore?.cancelPromptForUser;
    let promptResult = null;
    if (typeof requestDefensePromptForUser === "function") {
      promptResult = await withWaitingForDefenderResponse(
        () => requestDefensePromptForUser(recipient.id, payload),
        {
          enabled: recipient.id !== game.user?.id,
          onAbort: () => cancelPromptForUser?.(recipient.id, {
            promptId: payload.promptId,
            targetActorId: targetActor?.id || null,
            targetTokenId: targetTokenDocument?.id || null
          })
        }
      );
    } else {
      game.socket.emit(PC_SOCKET_NAMESPACE, payload);
    }

    pcLog.debug("Peasant Core | Sent defense prompt", {
      attacker: attackerTokenName,
      target: targetTokenDocument?.name || targetActor?.name,
      targetingType,
      recipient: recipient.name
    });

    promptResults.push({
      targetTokenId: targetTokenDocument?.id || null,
      targetActorId: targetActor?.id || null,
      targetName: targetTokenDocument?.name || targetActor?.name || "",
      recipientUserId: recipient.id,
      result: promptResult
    });

    if (isChainCancelledResult(promptResult)) {
      return {
        totalAccuracyPenalty: 0,
        totalToHitPenalty: 0,
        promptResults,
        abortChain: true
      };
    }
  }

  const totalAccuracyPenalty = promptResults.reduce((sum, entry) => {
    const appliedPenalty = Number(entry?.result?.appliedAccuracyPenalty);
    return sum + (Number.isFinite(appliedPenalty) ? appliedPenalty : 0);
  }, 0);

  const totalToHitPenalty = promptResults.reduce((sum, entry) => {
    const appliedPenalty = Number(entry?.result?.appliedToHitPenalty);
    return sum + (Number.isFinite(appliedPenalty) ? appliedPenalty : 0);
  }, 0);

  return { totalAccuracyPenalty, totalToHitPenalty, promptResults, abortChain: false };
}

function getActiveNotableCombatTargets() {
  return Array.from(game.user?.targets || [])
    .map((targetToken) => {
      const tokenDocument = targetToken?.document ?? targetToken ?? null;
      const actor = targetToken?.actor || tokenDocument?.actor || null;
      if (!actor) return null;
      return {
        token: targetToken,
        tokenDocument,
        actor,
        tokenId: tokenDocument?.id || null,
        actorId: actor?.id || null,
        targetName: String(targetToken?.name || tokenDocument?.name || actor?.name || "").trim() || "Target"
      };
    })
    .filter(Boolean);
}

function showWaitingForDefenderResponseDialog() {
  let dialogApp = null;
  let dotInterval = null;
  let abortResolved = false;
  let closedProgrammatically = false;
  let abortResolve = null;

  const abortPromise = new Promise((resolve) => {
    abortResolve = resolve;
  });

  const resolveAbort = () => {
    if (abortResolved) return;
    abortResolved = true;
    abortResolve?.({ chainCancelled: true, selection: "close" });
  };

  const content = `
    <div class="pc-waiting-dialog-body">
    </div>
  `;

  dialogApp = renderDialogCompat({
    title: "Waiting for Defender Response",
    content,
    buttons: {
      wait: {
        label: "Waiting",
        callback: async () => true
      }
    },
    default: "wait",
    render: (html) => {
      const viewportWidth = Number(window?.innerWidth) || 480;
      const stableDialogWidth = Math.max(320, Math.min(380, viewportWidth - 32));
      html.css({
        width: `${stableDialogWidth}px`,
        minWidth: `${stableDialogWidth}px`,
        maxWidth: `${Math.max(300, viewportWidth - 32)}px`
      });
      html.find('.window-content, .dialog-content, form, .standard-form').css({ overflow: 'hidden' });
      html.find('.dialog-buttons, .form-footer, footer').hide();
      const renderedWindow = html.closest('.window-app, .application')[0] || html[0];
      $(renderedWindow)
        .find('.header-control, [data-action="close"], [data-button="close"]')
        .off('.pcWaitingClose')
        .on('click.pcWaitingClose', () => {
          if (!closedProgrammatically) resolveAbort();
        });
      const bodyEl = html.find('.pc-waiting-dialog-body')[0];
      if (bodyEl) {
        bodyEl.replaceChildren();
        const dotsEl = document.createElement('div');
        dotsEl.className = 'pc-waiting-dialog-dots';
        dotsEl.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < 3; i += 1) {
          const dot = document.createElement('span');
          dot.textContent = 'â—';
          dot.style.display = 'inline-block';
          dot.style.minWidth = '12px';
          dot.style.lineHeight = '1';
          dot.style.fontSize = '22px';
          dot.style.fontWeight = '700';
          dot.style.color = 'var(--button-hover-border-color, #c9b183)';
          dot.style.textShadow = '0 0 8px rgba(201, 177, 131, 0.25)';
          dot.style.opacity = '0.4';
          dot.style.transform = 'translateY(0)';
          dot.style.transition = 'transform 140ms ease, opacity 140ms ease';
          dotsEl.appendChild(dot);
        }
        bodyEl.appendChild(dotsEl);
      }

      const dots = Array.from(html.find('.pc-waiting-dialog-dots span'));
      if (dotInterval) {
        clearInterval(dotInterval);
        dotInterval = null;
      }
      if (dots.length) {
        let activeIndex = 0;
        const paintDots = () => {
          dots.forEach((dot, index) => {
            const isActive = index === activeIndex;
            dot.style.transform = isActive ? 'translateY(-7px)' : 'translateY(0)';
            dot.style.opacity = isActive ? '1' : '0.4';
          });
        };
        paintDots();
        dotInterval = window.setInterval(() => {
          activeIndex = (activeIndex + 1) % dots.length;
          paintDots();
        }, 220);
      }
    }
  }, { classes: ["pc-waiting-dialog", "peasant-macro-dialog-force"] });

  return {
    abortPromise,
    close: async () => {
      closedProgrammatically = true;
      if (dotInterval) {
        clearInterval(dotInterval);
        dotInterval = null;
      }
      try {
        await dialogApp?.close?.();
      } catch (e) {
        pcLog.debug("Peasant Core | Failed to close waiting dialog", e);
      }
    }
  };
}

async function showFlexibleDamageTypePrompt({
  combatName = "Attack"
} = {}) {
  const content = `
    <form class="pc-flexible-damage-type-form">
      <div class="form-group" style="margin-bottom: 10px;">
        <label style="display:block; margin-bottom:5px; color:#b0b0b0;">Damage Type:</label>
        <select class="pc-defense-prompt-select" name="flexibleDamageType" style="width:100%; padding:8px 10px; min-height:38px; font-size:14px;">
          <option value="blunt">Blunt</option>
          <option value="lethal">Lethal</option>
        </select>
      </div>
    </form>
  `;

  return await new Promise((resolve) => {
    let settled = false;
    let renderedWindow = null;
    let closeWatcher = null;

    const finalize = (result = {}) => {
      if (settled) return result;
      settled = true;
      if (closeWatcher) {
        clearInterval(closeWatcher);
        closeWatcher = null;
      }
      resolve(result);
      return result;
    };

    renderDialogCompat({
      title: `Choose Damage Type: ${combatName}`,
      content,
      buttons: {
        select: {
          label: "Select",
          callback: async (html) => {
            const selectedType = String(html.find('[name="flexibleDamageType"]').val() || "blunt").trim().toLowerCase();
            finalize({
              selected: true,
              damageType: normalizeAppliedDamageType(selectedType, "blunt"),
              chainCancelled: false
            });
            return true;
          }
        },
        cancel: {
          label: "Cancel",
          callback: async () => {
            finalize({
              selected: false,
              damageType: null,
              chainCancelled: true
            });
            return true;
          }
        }
      },
      default: "select",
      render: (html) => {
        const viewportWidth = Number(window?.innerWidth) || 480;
        const stableDialogWidth = Math.max(340, Math.min(400, viewportWidth - 32));
        html.css({
          width: `${stableDialogWidth}px`,
          minWidth: `${stableDialogWidth}px`,
          maxWidth: `${Math.max(320, viewportWidth - 32)}px`
        });
        html.find('.window-content, .dialog-content').css({ overflowX: 'hidden' });

        renderedWindow = html.closest('.window-app, .application')[0] || html[0];
        $(renderedWindow)
          .find('.header-control, [data-action="close"], [data-button="close"]')
          .off('.pcFlexibleDamageClose')
          .on('click.pcFlexibleDamageClose', () => finalize({
            selected: false,
            damageType: null,
            chainCancelled: true
          }));

        if (!closeWatcher) {
          closeWatcher = window.setInterval(() => {
            if (settled || !renderedWindow) return;
            if (!renderedWindow.isConnected) {
              finalize({
                selected: false,
                damageType: null,
                chainCancelled: true
              });
            }
          }, 150);
        }
      }
    }, { classes: ["pc-flexible-damage-dialog", "peasant-macro-dialog-force"] });
  });
}

async function withWaitingForDefenderResponse(promiseFactory, { enabled = true, onAbort = null } = {}) {
  let waitingDialog = null;
  try {
    const remotePromise = Promise.resolve().then(() => promiseFactory());
    if (!enabled) return await remotePromise;

    waitingDialog = showWaitingForDefenderResponseDialog();
    const raced = await Promise.race([
      remotePromise.then((value) => ({ kind: "result", value }), (error) => ({ kind: "error", error })),
      waitingDialog.abortPromise.then((value) => ({ kind: "abort", value }))
    ]);

    if (raced.kind === "error") throw raced.error;
    if (raced.kind === "abort" && typeof onAbort === "function") {
      try {
        await onAbort();
      } catch (e) {
        pcLog.debug("Peasant Core | Failed to cancel remote prompt after local abort", e);
      }
    }
    return raced.value;
  } finally {
    await waitingDialog?.close?.();
  }
}

function isChainCancelledResult(result) {
  return !!result?.chainCancelled;
}

async function markRollFailureDueToDefense(rollResult, { label = "Failure due to Defense" } = {}) {
  return updateSkillRollChatCardFromResult(rollResult, { label });
}

async function updateSkillRollChatCardFromResult(rollResult, { label = null } = {}) {
  if (!rollResult?.chatMessage?.update) return;

  const content = String(rollResult.chatMessage.content || "");
  if (!content) return;

  const container = document.createElement("div");
  container.innerHTML = content;

  const skillRollCard = container.querySelector(".skill-roll-card");
  if (!(skillRollCard instanceof HTMLElement)) return;

  const topRow = skillRollCard.querySelector(":scope > div:nth-child(2) > div");
  const statBoxes = topRow?.children;
  const toHitBox = statBoxes?.[0];
  if (toHitBox instanceof HTMLElement && Number.isFinite(Number(rollResult?.toHit))) {
    const toHitSpans = toHitBox.querySelectorAll("span");
    if (toHitSpans.length >= 2) {
      toHitSpans[1].textContent = `${Number(rollResult.toHit)}+`;
    }
  }

  const mosButton = container.querySelector(".mos-toggle");
  if (mosButton instanceof HTMLElement) {
    const totalMoS = Number(rollResult?.totalMoS);
    if (Number.isFinite(totalMoS)) {
      mosButton.textContent = formatThresholdValue(totalMoS);
    }
    mosButton.style.color = rollResult?.isSuccess ? "#4ade80" : "#f87171";
    mosButton.style.border = rollResult?.isSuccess ? "2px solid #22c55e" : "2px solid #dc2626";
  }

  const rollDetails = container.querySelector(".roll-details");
  if (rollDetails instanceof HTMLElement) {
    const detailLines = Array.from(rollDetails.children).filter((child) => child instanceof HTMLElement);
    const baseMosLine = detailLines.find((child) => child.textContent?.trim().startsWith("Base MoS:"));
    if (baseMosLine instanceof HTMLElement && Number.isFinite(Number(rollResult?.baseMoS))) {
      const baseMoS = Number(rollResult.baseMoS);
      baseMosLine.textContent = `Base MoS: ${baseMoS >= 0 ? "+" : ""}${baseMoS.toFixed(2)}`;
    }

    let accuracyLine = detailLines.find((child) => child.textContent?.trim().startsWith("Accuracy:"));
    const accuracyValue = rollResult?.accuracy;
    const hasAccuracyValue = !(accuracyValue === undefined || accuracyValue === null || accuracyValue === "");
    if (hasAccuracyValue) {
      const normalizedAccuracy = Number.parseInt(accuracyValue, 10) || 0;
      if (!(accuracyLine instanceof HTMLElement)) {
        accuracyLine = document.createElement("div");
        if (baseMosLine instanceof HTMLElement && baseMosLine.nextSibling) {
          rollDetails.insertBefore(accuracyLine, baseMosLine.nextSibling);
        } else {
          rollDetails.appendChild(accuracyLine);
        }
      }
      accuracyLine.textContent = `Accuracy: ${normalizedAccuracy}`;
    } else if (accuracyLine instanceof HTMLElement) {
      accuracyLine.remove();
    }
  }

  const outcome = container.querySelector(".skill-roll-card .roll-details + div");
  if (outcome instanceof HTMLElement) {
    const outcomeLabel = String(label || rollResult?.resultText || (rollResult?.isSuccess ? "Success" : "Failure"));
    outcome.textContent = outcomeLabel;
    outcome.style.background = rollResult?.isSuccess ? "rgba(34, 197, 94, 0.2)" : "rgba(220, 38, 38, 0.2)";
    outcome.style.color = rollResult?.isSuccess ? "#4ade80" : "#f87171";
    outcome.style.border = rollResult?.isSuccess ? "1px solid #22c55e" : "1px solid #dc2626";
  }

  await rollResult.chatMessage.update({ content: container.innerHTML });
}

async function markRollForcedPass(rollResult, { stressCost = 0, spendType = "general" } = {}) {
  if (!rollResult?.chatMessage?.update) return;

  const content = String(rollResult.chatMessage.content || "");
  if (!content) return;

  const container = document.createElement("div");
  container.innerHTML = content;

  const mosButton = container.querySelector(".mos-toggle");
  if (mosButton instanceof HTMLElement) {
    mosButton.textContent = "0";
    mosButton.style.color = "#4ade80";
    mosButton.style.border = "2px solid #22c55e";
  }

  const outcome = container.querySelector(".skill-roll-card .roll-details + div");
  if (outcome instanceof HTMLElement) {
    outcome.textContent = "Success";
    outcome.style.background = "rgba(34, 197, 94, 0.2)";
    outcome.style.color = "#4ade80";
    outcome.style.border = "1px solid #22c55e";
  }

  const rollDetails = container.querySelector(".roll-details");
  if (rollDetails instanceof HTMLElement) {
    let note = rollDetails.querySelector(".pc-force-pass-note");
    if (!(note instanceof HTMLElement)) {
      note = document.createElement("div");
      note.className = "pc-force-pass-note";
      rollDetails.appendChild(note);
    }
    note.textContent = `Forced Pass: ${stressCost} ${getForcePassSpendTypeLabel(spendType)}`;
    note.style.color = "#e0e0e0";
    note.style.marginTop = "0";
    note.style.fontWeight = "normal";
  }

  await rollResult.chatMessage.update({ content: container.innerHTML });
}

async function showForcePassPromptDialog({
  actor = null,
  rollLabel = "Skill Roll",
  stressCost = 0
} = {}) {
  if (!actor || stressCost <= 0) return { forced: false, selection: "no", spendType: "general" };

  const content = `
    <form class="pc-force-pass-form">
      <div class="form-group" style="margin-bottom: 10px;">
        <label style="display:flex; align-items:center; justify-content:space-between; gap:12px; color:#b0b0b0;">
          <span>Spend ${stressCost} stress to force pass?</span>
          <select class="pc-defense-prompt-select" name="forcePassStressType" style="width: 180px; padding:8px 10px; min-height:38px; font-size:14px;">
            <option value="physical">Physical Stress</option>
            <option value="mental">Mental Stress</option>
            <option value="general">General Stress</option>
          </select>
        </label>
      </div>
    </form>
  `;

  return await new Promise((resolve) => {
    let settled = false;
    let renderedWindow = null;
    let closeWatcher = null;

    const finalize = (result = { forced: false, selection: "no", spendType: "general", chainCancelled: false }) => {
      if (settled) return result;
      settled = true;
      if (closeWatcher) {
        clearInterval(closeWatcher);
        closeWatcher = null;
      }
      resolve(result);
      return result;
    };

    renderDialogCompat({
      title: rollLabel,
      content,
      buttons: {
        yes: {
          label: "Yes",
          callback: async (html) => {
            const spendType = String(html.find('[name="forcePassStressType"]').val() || "general").trim().toLowerCase();
            finalize({ forced: true, selection: "yes", spendType });
            return true;
          }
        },
        no: {
          label: "No",
          callback: async () => {
            finalize({ forced: false, selection: "no", spendType: "general" });
            return true;
          }
        }
      },
      default: "yes",
      render: (html) => {
        const viewportWidth = Number(window?.innerWidth) || 480;
        const stableDialogWidth = Math.max(380, Math.min(430, viewportWidth - 32));
        html.css({
          width: `${stableDialogWidth}px`,
          minWidth: `${stableDialogWidth}px`,
          maxWidth: `${Math.max(340, viewportWidth - 32)}px`
        });
        html.find('.window-content, .dialog-content').css({ overflowX: 'hidden' });

        renderedWindow = html.closest('.window-app, .application')[0] || html[0];
        $(renderedWindow)
          .find('.header-control, [data-action="close"], [data-button="close"]')
          .off('.pcForcePassClose')
          .on('click.pcForcePassClose', () => finalize({ forced: false, selection: "close", spendType: "general", chainCancelled: true }));

        if (!closeWatcher) {
          closeWatcher = window.setInterval(() => {
            if (settled || !renderedWindow) return;
            if (!renderedWindow.isConnected) {
              finalize({ forced: false, selection: "close", spendType: "general", chainCancelled: true });
            }
          }, 150);
        }
      }
    }, { classes: ["pc-force-pass-dialog", "peasant-macro-dialog-force"] });
  });
}

async function maybeForcePassFailedNotableRoll({
  actor = null,
  rollLabel = "Skill Roll",
  rollResult = null
} = {}) {
  if (!actor || !rollResult || rollResult.isSuccess) {
    return { forced: false, stressCost: 0, spendType: null, reason: "not-failed" };
  }

  if (String(rollResult.criticalType || "").trim() === "Critical Failure") {
    return { forced: false, stressCost: 0, spendType: null, reason: "critical-failure" };
  }

  const preAccuracyMoS = getPreAccuracyMoSFromRollResult(rollResult);
  if (!Number.isFinite(preAccuracyMoS) || preAccuracyMoS >= 0) {
    return { forced: false, stressCost: 0, spendType: null, reason: "accuracy-or-non-dice-failure" };
  }

  const stressCost = getForcePassStressCostFromRollResult(rollResult);
  if (stressCost <= 0) {
    return { forced: false, stressCost: 0, spendType: null, reason: "no-cost" };
  }

  const promptResult = await showForcePassPromptDialog({ actor, rollLabel, stressCost });
  if (isChainCancelledResult(promptResult)) {
    return {
      forced: false,
      stressCost,
      spendType: promptResult?.spendType || null,
      reason: "close",
      chainCancelled: true
    };
  }
  if (!promptResult?.forced) {
    return {
      forced: false,
      stressCost,
      spendType: promptResult?.spendType || null,
      reason: promptResult?.selection || "declined"
    };
  }

  const spendType = String(promptResult.spendType || "general").trim().toLowerCase();
  const availableCapacity = getStressCapacityForSpendType(actor, spendType);
  if (availableCapacity < stressCost) {
    ui.notifications?.warn?.(`Not enough ${getForcePassSpendTypeLabel(spendType)} capacity to spend ${stressCost} stress.`);
    return { forced: false, stressCost, spendType, reason: "insufficient-capacity" };
  }

  const spendResult = await spendStressForForcePass(actor, spendType, stressCost);
  if (!spendResult?.ok) {
    ui.notifications?.warn?.(`Could not spend ${stressCost} ${getForcePassSpendTypeLabel(spendType)}.`);
    return { forced: false, stressCost, spendType, reason: "spend-failed" };
  }

  rollResult.totalMoS = 0;
  rollResult.isSuccess = true;
  rollResult.resultText = "Success";
  rollResult.forcedPass = true;
  rollResult.forcedPassStressCost = stressCost;
  rollResult.forcedPassSpendType = spendType;

  try {
    await markRollForcedPass(rollResult, { stressCost, spendType });
  } catch (e) {
    pcLog.debug("Peasant Core | Failed to restyle roll as forced pass", e);
  }

  return { forced: true, stressCost, spendType, reason: "forced-pass" };
}

function applyDefensePenaltiesToRollResult(sourceRollResult, {
  defenseAccuracyPenalty = 0,
  defenseToHitPenalty = 0,
  defenseFailureLabel = "Failure due to Defense",
  preserveChatMessage = false
} = {}) {
  if (!sourceRollResult || typeof sourceRollResult !== "object") return null;

  const defensePenaltyValue = Number(defenseAccuracyPenalty) || 0;
  const defenseToHitPenaltyValue = Number(defenseToHitPenalty) || 0;
  const totalDefensePenaltyValue = defensePenaltyValue + defenseToHitPenaltyValue;

  const rollResult = {
    ...sourceRollResult,
    chatMessage: preserveChatMessage ? sourceRollResult.chatMessage : null
  };

  const sourceTotalMoS = Number(sourceRollResult.totalMoS);
  const resolvedSourceTotalMoS = Number.isFinite(sourceTotalMoS) ? sourceTotalMoS : 0;
  const preDefenseTotalMoS = rollResult.forcedPass ? 0 : resolvedSourceTotalMoS;

  if (Number.isFinite(Number(sourceRollResult.baseMoS))) {
    rollResult.baseMoS = Number(sourceRollResult.baseMoS) - (defenseToHitPenaltyValue * 0.25);
  }

  const sourceAccuracyMoS = Number(sourceRollResult.accuracyMoS);
  if (Number.isFinite(sourceAccuracyMoS)) {
    rollResult.accuracyMoS = sourceAccuracyMoS - (defensePenaltyValue * 0.25);
  } else if (defensePenaltyValue !== 0) {
    rollResult.accuracyMoS = -(defensePenaltyValue * 0.25);
  }

  if (Number.isFinite(Number(sourceRollResult.toHit))) {
    rollResult.toHit = Number(sourceRollResult.toHit) + defenseToHitPenaltyValue;
  }

  const sourceAccuracyValue = sourceRollResult.accuracy;
  const sourceAccuracyNum = (sourceAccuracyValue === undefined || sourceAccuracyValue === null || sourceAccuracyValue === "")
    ? 0
    : (Number.parseInt(sourceAccuracyValue, 10) || 0);
  const adjustedAccuracy = sourceAccuracyNum - defensePenaltyValue;
  rollResult.accuracy = (sourceAccuracyValue === undefined || sourceAccuracyValue === null || sourceAccuracyValue === "") && adjustedAccuracy === 0
    ? undefined
    : adjustedAccuracy;

  rollResult.totalMoS = preDefenseTotalMoS - (totalDefensePenaltyValue * 0.25);

  const failureDueToDefense = totalDefensePenaltyValue > 0
    && preDefenseTotalMoS >= 0
    && Number(rollResult.totalMoS) <= 0;

  rollResult.failureDueToDefense = failureDueToDefense;
  rollResult.failureDueToPrimalEvasion = failureDueToDefense && defenseFailureLabel === "Failure due to Primal Evasion";

  if (failureDueToDefense) {
    rollResult.isSuccess = false;
    rollResult.resultText = defenseFailureLabel;
  } else {
    rollResult.isSuccess = Number(rollResult.totalMoS) >= 0;
  }

  return {
    rollResult,
    defensePenaltyValue,
    defenseToHitPenaltyValue,
    totalDefensePenaltyValue,
    failureDueToDefense
  };
}

async function executeResolvedNotableCombatRoll({
  actor,
  combat,
  combatIndex,
  attackerToken = null,
  toHitAdj = 0,
  accuracyAdj = 0,
  rollOverrides = null,
  defenseAccuracyPenalty = 0,
  defenseToHitPenalty = 0,
  defenseFailureLabel = "Failure due to Defense",
  targetLabel = ""
} = {}) {
  const combatMods = actor.system?.combatMods || { toHit: 0, accuracy: 0, diceRate: 0, flatDamage: 0, costMod: 0 };
  const toHitMod = Number.parseInt(combatMods.toHit, 10) || 0;
  const accuracyMod = Number.parseInt(combatMods.accuracy, 10) || 0;

  const baseToHit = Number.isFinite(Number.parseInt(combat.tohit, 10))
    ? Number.parseInt(combat.tohit, 10)
    : 7;
  const baseAccuracy = Number.parseInt(combat.accuracy, 10) || 0;
  const accuracyHasValue = !(combat.accuracy === undefined || combat.accuracy === null || combat.accuracy === "");
  const combatRollBaseName = `${combat.name || "Combat"} Roll`;
  const combatName = targetLabel ? `${combatRollBaseName} vs ${targetLabel}` : combatRollBaseName;

  const rankStr = String(combat.rank || "").trim().toLowerCase();
  const isUntrained = rankStr === "u";

  let finalToHit;
  let finalAccuracy;
  let accuracyValue;
  let untrainedAccuracyValue;

  const hasRollOverrides = !!rollOverrides && Number.isFinite(Number.parseInt(rollOverrides.toHit, 10));
  if (hasRollOverrides) {
    finalToHit = Number.parseInt(rollOverrides.toHit, 10) + toHitAdj + defenseToHitPenalty;

    const overrideAccuracyRaw = rollOverrides.accuracy;
    if (overrideAccuracyRaw === undefined || overrideAccuracyRaw === null || overrideAccuracyRaw === "") {
      finalAccuracy = 0 + accuracyAdj - defenseAccuracyPenalty;
      accuracyValue = finalAccuracy === 0 ? undefined : finalAccuracy;
    } else {
      finalAccuracy = (Number.parseInt(overrideAccuracyRaw, 10) || 0) + accuracyAdj - defenseAccuracyPenalty;
      accuracyValue = finalAccuracy;
    }
    untrainedAccuracyValue = finalAccuracy;
  } else {
    const totalToHitMod = toHitMod + toHitAdj + defenseToHitPenalty;
    const totalAccuracyMod = accuracyMod + accuracyAdj - defenseAccuracyPenalty;
    const rollCalc = applyToHitAccuracy(baseToHit, baseAccuracy, totalToHitMod, totalAccuracyMod, 2);
    finalToHit = rollCalc.toHit;
    finalAccuracy = rollCalc.accuracy;
    accuracyValue = (!accuracyHasValue && finalAccuracy === 0) ? undefined : finalAccuracy;
    untrainedAccuracyValue = finalAccuracy;
  }

  const speaker = getActorRollSpeaker(actor, attackerToken);
  let rollResult = null;

  if (isUntrained) {
    const untrainedName = targetLabel
      ? `${combat.name || "Combat"} Untrained Roll vs ${targetLabel}`
      : `${combat.name || "Combat"} Untrained Roll`;

    rollResult = await performUntrainedSkillRoll({
      toHit: finalToHit,
      accuracy: untrainedAccuracyValue,
      skillName: untrainedName,
      speaker
    });
  } else {
    rollResult = await performSkillRoll({ toHit: finalToHit, accuracy: accuracyValue, skillName: combatName, speaker });
  }

  const defensePenaltyValue = Number(defenseAccuracyPenalty) || 0;
  const defenseToHitPenaltyValue = Number(defenseToHitPenalty) || 0;
  const forcePassResult = await maybeForcePassFailedNotableRoll({
    actor,
    rollLabel: combatName,
    rollResult
  });
  if (isChainCancelledResult(forcePassResult)) {
    return {
      rolled: true,
      actorId: actor.id,
      combatIndex,
      combatName: combat.name || "Combat",
      rollLabel: combatName,
      toHit: finalToHit,
      accuracy: accuracyValue,
      defenseAccuracyPenalty,
      defenseToHitPenalty,
      forcePassResult,
      targetLabel,
      rollResult,
      chainCancelled: true
    };
  }
  const penaltyApplication = applyDefensePenaltiesToRollResult(rollResult, {
    defenseAccuracyPenalty,
    defenseToHitPenalty,
    defenseFailureLabel,
    preserveChatMessage: true
  });
  if (penaltyApplication?.rollResult) {
    rollResult = penaltyApplication.rollResult;
  }
  const failureDueToDefense = !!penaltyApplication?.failureDueToDefense;
  if (failureDueToDefense && rollResult) {
    try {
      await markRollFailureDueToDefense(rollResult, { label: defenseFailureLabel });
    } catch (e) {
      pcLog.debug("Peasant Core | Failed to restyle attack roll as defense failure", e);
    }
  }

  return {
    rolled: true,
    actorId: actor.id,
    combatIndex,
    combatName: combat.name || "Combat",
    rollLabel: combatName,
    toHit: finalToHit,
    accuracy: accuracyValue,
    defenseAccuracyPenalty,
    defenseToHitPenalty,
    forcePassResult,
    targetLabel,
    rollResult
  };
}

async function performNotableCombatRoll({
  actor,
  combatIndex,
  toHitAdj = 0,
  accuracyAdj = 0,
  sheet = null,
  promptForTargets = true,
  rollOverrides = null,
  targetLabel = "",
  selectedDamageType = null
} = {}) {
  try {
    if (!actor) return false;

    const combats = Array.isArray(actor.system?.notableCombats) ? actor.system.notableCombats : [];
    const combat = combats[combatIndex] || null;
    if (!combat) return false;
    pcLog.debug("Peasant Core | performNotableCombatRoll", {
      actor: actor.name,
      combatIndex,
      combatName: combat?.name || "Combat",
      promptForTargets
    });

    const attackerToken = getPreferredActorToken(actor);
    const activeTargets = promptForTargets ? getActiveNotableCombatTargets() : [];
    const shouldRollPerTarget = activeTargets.length > 1;
    let resolvedDamageType = normalizeAppliedDamageType(selectedDamageType, "");
    if (!resolvedDamageType) {
      const combatDamageType = normalizeAppliedDamageType(combat?.damage?.type, "");
      if (combatDamageType === "flexible" && activeTargets.length > 0) {
        const damageTypePrompt = await showFlexibleDamageTypePrompt({
          combatName: combat?.name || "Attack"
        });
        if (isChainCancelledResult(damageTypePrompt)) {
          return {
            rolled: false,
            actorId: actor.id,
            combatIndex,
            combatName: combat.name || "Combat",
            chainCancelled: true,
            damageTypePrompt
          };
        }
        resolvedDamageType = normalizeAppliedDamageType(damageTypePrompt?.damageType, "blunt");
      }
    }

    let defensePromptSummary = { totalAccuracyPenalty: 0, promptResults: [] };
    if (promptForTargets) {
      defensePromptSummary = await emitDefensePromptRequestsForAttack({
        actor,
        combat,
        combatIndex,
        attackerToken
      }) || defensePromptSummary;
    }
    if (defensePromptSummary?.abortChain) {
      return {
        rolled: false,
        actorId: actor.id,
        combatIndex,
        combatName: combat.name || "Combat",
        chainCancelled: true,
        defensePromptSummary
      };
    }

    const combatMods = actor.system?.combatMods || { toHit: 0, accuracy: 0, diceRate: 0, flatDamage: 0, costMod: 0 };
    const costModifiersByType = getCombatCostModifiers(combatMods);

    if (typeof actor.applyPeasantCombatResourceCosts === "function") {
      await actor.applyPeasantCombatResourceCosts(combat, costModifiersByType);
    }

    let rollOutcome;
    if (shouldRollPerTarget) {
      const sharedAttackRoll = await executeResolvedNotableCombatRoll({
        actor,
        combat,
        combatIndex,
        attackerToken,
        toHitAdj,
        accuracyAdj,
        rollOverrides,
        defenseAccuracyPenalty: 0,
        defenseToHitPenalty: 0,
        targetLabel: "Multiple Targets"
      });
      if (isChainCancelledResult(sharedAttackRoll)) {
        await consumeNotableCombatRollUse(actor, combatIndex, sheet);
        return {
          rolled: false,
          actorId: actor.id,
          combatIndex,
          combatName: combat.name || "Combat",
          multiTarget: true,
          targetRolls: [],
          sharedAttackRoll,
          chainCancelled: true,
          defensePromptSummary
        };
      }

      const promptResultByTokenId = new Map(
        (defensePromptSummary?.promptResults || [])
          .map((entry) => [String(entry?.targetTokenId || ""), entry])
          .filter(([tokenId]) => !!tokenId)
      );

      const targetRolls = [];
      for (const target of activeTargets) {
        const promptEntry = promptResultByTokenId.get(String(target.tokenId || "")) || null;
        const defenseAccuracyPenalty = Number(promptEntry?.result?.appliedAccuracyPenalty) || 0;
        const defenseToHitPenalty = Number(promptEntry?.result?.appliedToHitPenalty) || 0;
        const defenseFailureLabel = getFailureLabelFromDefensePromptResult(promptEntry?.result);
        const penaltyApplication = applyDefensePenaltiesToRollResult(sharedAttackRoll?.rollResult, {
          defenseAccuracyPenalty,
          defenseToHitPenalty,
          defenseFailureLabel,
          preserveChatMessage: false
        });
        const targetRoll = {
          ...sharedAttackRoll,
          targetLabel: target.targetName,
          defenseAccuracyPenalty,
          defenseToHitPenalty,
          rollResult: penaltyApplication?.rollResult || sharedAttackRoll?.rollResult || null,
          sharedAttackRollId: sharedAttackRoll?.rollResult?.chatMessage?.id || null
        };
        if (isChainCancelledResult(targetRoll)) {
          await consumeNotableCombatRollUse(actor, combatIndex, sheet);
          return {
            rolled: false,
            actorId: actor.id,
            combatIndex,
            combatName: combat.name || "Combat",
            multiTarget: true,
            targetRolls,
            chainCancelled: true,
            defensePromptSummary
          };
        }
        const incomingHitResolution = await resolveSuccessfulAttackDamageForTarget({
          actor,
          attackerToken,
          combat,
          target,
          attackRoll: targetRoll,
          defensePromptResult: promptEntry?.result || null,
          appliedDamageType: resolvedDamageType || null
        });
        if (isChainCancelledResult(incomingHitResolution)) {
          await consumeNotableCombatRollUse(actor, combatIndex, sheet);
          return {
            rolled: true,
            actorId: actor.id,
            combatIndex,
            combatName: combat.name || "Combat",
            multiTarget: true,
            targetRolls,
            chainCancelled: true,
            defensePromptSummary,
            cancelledAfterRoll: true
          };
        }
        targetRolls.push({
          ...targetRoll,
          targetTokenId: target.tokenId,
          targetActorId: target.actorId,
          targetName: target.targetName,
          defensePromptResult: promptEntry?.result || null,
          incomingHitResolution
        });
      }

      rollOutcome = {
        rolled: !!sharedAttackRoll?.rolled,
        actorId: actor.id,
        combatIndex,
        combatName: combat.name || "Combat",
        multiTarget: true,
        sharedAttackRoll,
        targetRolls,
        defensePromptSummary
      };
    } else {
      const defenseAccuracyPenalty = Number(defensePromptSummary?.totalAccuracyPenalty) || 0;
      const defenseToHitPenalty = Number(defensePromptSummary?.totalToHitPenalty) || 0;
      const defenseFailureLabel = getFailureLabelFromDefensePromptResult(defensePromptSummary?.promptResults?.[0]?.result);
      const target = activeTargets[0] || null;
      const resolvedTargetLabel = target?.targetName || targetLabel || "";
      const singleRoll = await executeResolvedNotableCombatRoll({
        actor,
        combat,
        combatIndex,
        attackerToken,
        toHitAdj,
        accuracyAdj,
        rollOverrides,
        defenseAccuracyPenalty: 0,
        defenseToHitPenalty: 0,
        targetLabel: resolvedTargetLabel
      });
      if (isChainCancelledResult(singleRoll)) {
        await consumeNotableCombatRollUse(actor, combatIndex, sheet);
        return {
          ...singleRoll,
          multiTarget: false,
          defensePromptSummary,
          targetTokenId: target?.tokenId || null,
          targetActorId: target?.actorId || null,
          targetName: target?.targetName || null,
          chainCancelled: true
        };
      }
      if (singleRoll?.rollResult && (defenseAccuracyPenalty > 0 || defenseToHitPenalty > 0)) {
        const penaltyApplication = applyDefensePenaltiesToRollResult(singleRoll.rollResult, {
          defenseAccuracyPenalty,
          defenseToHitPenalty,
          defenseFailureLabel,
          preserveChatMessage: true
        });
        if (penaltyApplication?.rollResult) {
          singleRoll.rollResult = penaltyApplication.rollResult;
          singleRoll.toHit = penaltyApplication.rollResult.toHit;
          singleRoll.accuracy = penaltyApplication.rollResult.accuracy;
          singleRoll.defenseAccuracyPenalty = defenseAccuracyPenalty;
          singleRoll.defenseToHitPenalty = defenseToHitPenalty;
          try {
            await updateSkillRollChatCardFromResult(singleRoll.rollResult, {
              label: penaltyApplication.failureDueToDefense ? defenseFailureLabel : null
            });
          } catch (e) {
            pcLog.debug("Peasant Core | Failed to update single-target roll after defense penalties", e);
          }
        }
      }
      const incomingHitResolution = await resolveSuccessfulAttackDamageForTarget({
        actor,
        attackerToken,
        combat,
        target,
        attackRoll: singleRoll,
        defensePromptResult: defensePromptSummary?.promptResults?.[0]?.result || null,
        appliedDamageType: resolvedDamageType || null
      });
      if (isChainCancelledResult(incomingHitResolution)) {
        await consumeNotableCombatRollUse(actor, combatIndex, sheet);
        return {
          ...singleRoll,
          multiTarget: false,
          defensePromptSummary,
          targetTokenId: target?.tokenId || null,
          targetActorId: target?.actorId || null,
          targetName: target?.targetName || null,
          incomingHitResolution,
          chainCancelled: true
        };
      }
      rollOutcome = {
        ...singleRoll,
        multiTarget: false,
        defensePromptSummary,
        targetTokenId: target?.tokenId || null,
        targetActorId: target?.actorId || null,
        targetName: target?.targetName || null,
        incomingHitResolution
      };
    }

    await consumeNotableCombatRollUse(actor, combatIndex, sheet);

    return rollOutcome;
  } catch (e) {
    console.error("Peasant Core | performNotableCombatRoll failed", e);
    return { rolled: false, error: e };
  }
}

async function startNotableCombatRoll({
  actor,
  combatIndex,
  sheet = null,
  promptForTargets = true,
  rollOverrides = null,
  targetLabel = "",
  selectedDamageType = null
} = {}) {
  if (!actor) return false;

  const combats = Array.isArray(actor.system?.notableCombats) ? actor.system.notableCombats : [];
  const combat = combats[combatIndex] || null;
  if (!combat) return false;

  const hasRangeRate = !!combat.rangeRate && combat.rangeRate !== "///";
  if (!hasRangeRate) {
    return await performNotableCombatRoll({ actor, combatIndex, sheet, promptForTargets, rollOverrides, targetLabel, selectedDamageType });
  }

  const rrValues = String(combat.rangeRate || "").split("/");
  while (rrValues.length < 4) rrValues.push("");
  const ordinals = ["1st", "2nd", "3rd", "4th"];
  const optionsHtml = rrValues.map((value, index) => {
    const displayValue = escapeHtml((value || "").trim() || "-");
    return `<option value="${index}">${ordinals[index]}: ${displayValue}</option>`;
  }).join("");

  const dialogContent = `
    <form>
      <div class="form-group" style="margin-bottom: 10px;">
        <label style="display: block; margin-bottom: 5px; color: #b0b0b0;">Range-Rate?</label>
        <select name="rangeRateIndex" style="width: 100%; padding: 8px 10px; min-height: 38px; background: #2a2a2a; color: #e0e0e0; border: 1px solid #555; border-radius: 4px; font-size: 14px;">
          ${optionsHtml}
        </select>
      </div>
    </form>
  `;

  return await new Promise((resolve) => {
    let settled = false;
    let renderedWindow = null;
    let closeWatcher = null;

    const finalize = (result = { rolled: false, cancelled: true, chainCancelled: false }) => {
      if (settled) return result;
      settled = true;
      if (closeWatcher) {
        clearInterval(closeWatcher);
        closeWatcher = null;
      }
      resolve(result);
      return result;
    };

    renderDialogCompat({
      title: "Range-Rate",
      content: dialogContent,
      buttons: {
        roll: {
          label: "Roll",
          callback: async (html) => {
            const selectedIndex = Number.parseInt(html.find('[name="rangeRateIndex"]').val(), 10) || 0;
            const toHitAdj = selectedIndex;
            const accAdj = -selectedIndex;
            const result = await performNotableCombatRoll({
              actor,
              combatIndex,
              toHitAdj,
              accuracyAdj: accAdj,
              sheet,
              promptForTargets,
              rollOverrides,
              targetLabel,
              selectedDamageType
            });
            finalize(result);
            return true;
          }
        },
        cancel: {
          label: "Cancel",
          callback: async () => {
            finalize({ rolled: false, cancelled: true });
            return true;
          }
        }
      },
      default: "roll",
      render: (html) => {
        renderedWindow = html.closest('.window-app, .application')[0] || html[0];
        $(renderedWindow)
          .find('.header-control, [data-action="close"], [data-button="close"]')
          .off('.pcRangeRateClose')
          .on('click.pcRangeRateClose', () => finalize({ rolled: false, cancelled: true, chainCancelled: true }));

        if (!closeWatcher) {
          closeWatcher = window.setInterval(() => {
            if (settled || !renderedWindow) return;
            if (!renderedWindow.isConnected) finalize({ rolled: false, cancelled: true, chainCancelled: true });
          }, 150);
        }
      }
    });
  });
}

async function showDefensePromptDialog(payload = {}) {
  const defenderActor = await resolveDefensePromptActor(payload);
  if (!defenderActor) return null;
  const promptId = String(payload.promptId || "").trim();

  const targetingType = String(payload.attackTargetingType || "").trim();
  const matchingDefenses = getMatchingDefenseNotables(defenderActor, targetingType);
  const primalEvasionResult = createPrimalEvasionDefenseResult(defenderActor, targetingType);
  if (!matchingDefenses.length) {
    if (primalEvasionResult.activeDefense) {
      pcLog.debug("Peasant Core | Defense prompt auto-resolved with Primal Evasion", {
        defender: defenderActor.name,
        targetingType,
        attack: payload.attackCombatName,
        penalty: primalEvasionResult.appliedAccuracyPenalty
      });
      return primalEvasionResult;
    }
    pcLog.debug("Peasant Core | Defense prompt skipped: only None available", {
      defender: defenderActor.name,
      targetingType,
      attack: payload.attackCombatName
    });
    return null;
  }

  const attackerName = String(payload.attackerTokenName || payload.attackerActorName || "Attacker").trim() || "Attacker";
  const titleTargetingType = targetingType || "Unknown";
  const title = `${attackerName} attacks you! | ${titleTargetingType}`;
  const previewByIndex = new Map(
    matchingDefenses.map(({ combat, index }) => [String(index), getNotableCombatRollPreview(defenderActor, combat)])
  );
  const preferredDefenseMatch = getPreferredDefenseMatch(defenderActor, targetingType, matchingDefenses);
  const preferredDefenseValue = preferredDefenseMatch ? String(preferredDefenseMatch.index) : "";
  const defaultDefenseValue = preferredDefenseValue || "__none__";
  const optionsHtml = [
    ...matchingDefenses.map(({ combat, index }) => {
      const label = String(combat?.name || `Defense ${index + 1}`).trim() || `Defense ${index + 1}`;
      return `<option value="${index}">${escapeHtml(label)}</option>`;
    }),
    `<option value="__none__">None</option>`
  ].join("");

  const content = `
    <form class="pc-defense-prompt-form">
      <div class="form-group" style="margin-bottom: 10px;">
        <div style="color: #e0e0e0;">Would you like to defend?</div>
      </div>
      <div class="form-group">
        <label style="display:block; margin-bottom:5px; color:#b0b0b0;">Defense:</label>
        <select class="pc-defense-prompt-select" name="defenseCombatIndex" style="width:100%; padding:8px 10px; min-height:38px; font-size:14px;">
          ${optionsHtml}
        </select>
      </div>
      <div class="form-group pc-defense-favorite" style="display:none;">
        <label style="display:flex; align-items:center; justify-content:space-between; gap:8px; color:#b0b0b0;">
          <span>Favorite as defensive reflex for targeting type?</span>
          <input type="checkbox" name="defenseFavoriteForTargeting">
        </label>
      </div>
      <div class="form-group pc-defense-preview" style="display:grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <label style="display:block; color:#b0b0b0;">
          <span style="display:block; margin-bottom:5px;">To-Hit</span>
          <input type="number" name="defensePreviewToHit" value="" step="1">
        </label>
        <label style="display:block; color:#b0b0b0;">
          <span style="display:block; margin-bottom:5px;">Accuracy</span>
          <input type="number" name="defensePreviewAccuracy" value="" step="1">
        </label>
      </div>
    </form>
  `;

  return await new Promise((resolve) => {
    let settled = false;
    let renderedWindow = null;
    let closeWatcher = null;
    let dialogApp = null;

    const finalize = (result = {}) => {
      if (settled) return result;
      settled = true;
      if (closeWatcher) {
        clearInterval(closeWatcher);
        closeWatcher = null;
      }
      unregisterActiveRemotePrompt(promptId, remoteCloser);
      resolve({
        handled: true,
        selection: "none",
        selectedCombatIndex: null,
        selectedDefense: null,
        defenseRoll: null,
        appliedAccuracyPenalty: 0,
        appliedToHitPenalty: 0,
        activeDefense: false,
        primalEvasionPenalty: 0,
        ...result
      });
      return result;
    };

    const remoteCloser = async (result = {}) => {
      const finalized = finalize({
        selection: "close",
        selectedCombatIndex: null,
        defenseRoll: null,
        appliedAccuracyPenalty: 0,
        appliedToHitPenalty: 0,
        chainCancelled: true,
        ...result
      });
      try {
        await dialogApp?.close?.();
      } catch (e) {
        pcLog.debug("Peasant Core | Failed to close remote defense prompt", e);
      }
      return finalized;
    };
    if (promptId) registerActiveRemotePrompt(promptId, remoteCloser);

    dialogApp = renderDialogCompat({
      title,
      content,
      buttons: {
        roll: {
          label: "Roll",
          callback: async (html) => {
            const selectedValue = String(html.find('[name="defenseCombatIndex"]').val() || "");
            if (selectedValue === "__none__") {
              finalize(createPrimalEvasionDefenseResult(defenderActor, targetingType));
              return true;
            }

            const selectedIndex = Number.parseInt(selectedValue, 10);
            if (!Number.isFinite(selectedIndex)) {
              ui.notifications?.warn?.("No matching defenses are available for this attack.");
              return false;
            }

            const selectedDefenseMatch = matchingDefenses.find(({ index }) => index === selectedIndex) || null;
            if (!selectedDefenseMatch) {
              ui.notifications?.warn?.("That defense is no longer available.");
              return false;
            }

            const toHitRaw = String(html.find('[name="defensePreviewToHit"]').val() || "").trim();
            const accuracyRaw = String(html.find('[name="defensePreviewAccuracy"]').val() || "").trim();
            const overrideToHit = Number.parseInt(toHitRaw, 10);
            if (!Number.isFinite(overrideToHit)) {
              ui.notifications?.warn?.("Please enter a valid To-Hit value.");
              return false;
            }

            const overrideAccuracy = accuracyRaw === "" ? undefined : Number.parseInt(accuracyRaw, 10);
            if (accuracyRaw !== "" && !Number.isFinite(overrideAccuracy)) {
              ui.notifications?.warn?.("Please enter a valid Accuracy value.");
              return false;
            }

            const favoriteChecked = !!html.find('[name="defenseFavoriteForTargeting"]').prop('checked');
            try {
              if (favoriteChecked) {
                await setPreferredDefenseMatch(defenderActor, targetingType, selectedDefenseMatch);
              } else if (preferredDefenseValue === selectedValue) {
                await clearPreferredDefenseMatch(defenderActor, targetingType);
              }
            } catch (favoriteError) {
              console.warn("Peasant Core | Failed to update defensive reflex favorite", favoriteError);
            }

            const defenseRoll = await startNotableCombatRoll({
              actor: defenderActor,
              combatIndex: selectedIndex,
              promptForTargets: false,
              targetLabel: attackerName,
              rollOverrides: {
                toHit: overrideToHit,
                accuracy: overrideAccuracy
              }
            });
            if (isChainCancelledResult(defenseRoll)) {
              finalize({
                selection: "close",
                selectedCombatIndex: selectedIndex,
                selectedDefense: normalizeCombatDefense(selectedDefenseMatch.defense),
                defenseRoll,
                appliedAccuracyPenalty: 0,
                appliedToHitPenalty: 0,
                chainCancelled: true
              });
              return true;
            }

            const appliedAccuracyPenalty = getAccuracyPenaltyFromDefenseRoll(
              selectedDefenseMatch.defense,
              targetingType,
              defenseRoll?.rollResult
            );
            const appliedToHitPenalty = getToHitPenaltyFromDefenseRoll(
              selectedDefenseMatch.defense,
              defenseRoll?.rollResult
            );

            finalize({
              selection: "defense",
              selectedCombatIndex: selectedIndex,
              selectedDefense: normalizeCombatDefense(selectedDefenseMatch.defense),
              defenseRoll,
              appliedAccuracyPenalty,
              appliedToHitPenalty,
              activeDefense: true,
              primalEvasionPenalty: 0
            });
            return true;
          }
        },
        cancel: {
          label: "Cancel",
          callback: async () => {
            finalize({
              selection: "cancel",
              selectedCombatIndex: null,
              defenseRoll: null,
              appliedAccuracyPenalty: 0,
              appliedToHitPenalty: 0
            });
            return true;
          }
        }
      },
      default: "roll",
      render: (html) => {
        const viewportWidth = Number(window?.innerWidth) || 480;
        const stableDialogWidth = Math.max(360, Math.min(420, viewportWidth - 32));
        html.css({
          width: `${stableDialogWidth}px`,
          minWidth: `${stableDialogWidth}px`,
          maxWidth: `${Math.max(320, viewportWidth - 32)}px`
        });
        html.find('.window-content, .dialog-content').css({ overflowX: 'hidden' });

        renderedWindow = html.closest('.window-app, .application')[0] || html[0];
        $(renderedWindow)
          .find('.header-control, [data-action="close"], [data-button="close"]')
          .off('.pcDefensePromptClose')
          .on('click.pcDefensePromptClose', () => {
            finalize({
              selection: "close",
              selectedCombatIndex: null,
              selectedDefense: null,
              defenseRoll: null,
              appliedAccuracyPenalty: 0,
              appliedToHitPenalty: 0,
              chainCancelled: true
            });
          });

        if (!closeWatcher) {
          closeWatcher = window.setInterval(() => {
            if (settled || !renderedWindow) return;
            if (!renderedWindow.isConnected) {
              finalize({
                selection: "close",
                selectedCombatIndex: null,
                selectedDefense: null,
                defenseRoll: null,
                appliedAccuracyPenalty: 0,
                appliedToHitPenalty: 0,
                chainCancelled: true
              });
            }
          }, 150);
        }

        const $select = html.find('[name="defenseCombatIndex"]');
        const $favorite = html.find('[name="defenseFavoriteForTargeting"]');
        const $favoriteRow = html.find('.pc-defense-favorite');
        const $toHit = html.find('[name="defensePreviewToHit"]');
        const $accuracy = html.find('[name="defensePreviewAccuracy"]');
        const $roll = html.find('[data-action="roll"], [data-button="roll"]');
        const $preview = html.find('.pc-defense-preview');

        const updatePreview = () => {
          const selectedValue = String($select.val() || "");
          if (selectedValue === "__none__") {
            $toHit.val("");
            $accuracy.val("");
            $favorite.prop('checked', false);
            $favoriteRow.hide();
            $preview.hide();
            $roll.prop('disabled', false);
            return;
          }

          const preview = previewByIndex.get(selectedValue);
          if (!preview) {
            $toHit.val("");
            $accuracy.val("");
            $favorite.prop('checked', false);
            $favoriteRow.show();
            $preview.show();
            $roll.prop('disabled', true);
            return;
          }

          $favoriteRow.show();
          $favorite.prop('checked', selectedValue === preferredDefenseValue);
          $preview.show();
          $toHit.val(preview.hasToHit ? `${preview.modifiedTohit}` : "");
          $accuracy.val(preview.hasAccuracy ? `${preview.accuracyNum}` : "0");
          $roll.prop('disabled', false);
        };

        $select.off('.pcDefensePreview');
        $select.on('change.pcDefensePreview', updatePreview);
        $select.val(defaultDefenseValue);
        updatePreview();
      }
    }, { classes: ["pc-defense-prompt-dialog", "peasant-macro-dialog-force"] });
  });
}

registerPeasantCoreApi({ showDefensePrompt: showDefensePromptDialog });

async function requestIncomingHitResolutionForTarget({
  target = null,
  attackerActor = null,
  attackerToken = null,
  combat = null,
  locationRoll = null,
  damagePreview = "",
  damageType = "",
  damageTypeLabel = ""
} = {}) {
  const targetActor = target?.actor || null;
  const targetTokenDocument = target?.tokenDocument || target?.token?.document || target?.token || null;
  if (!targetActor || !combat || !locationRoll) return null;

  const recipient = getPreferredDefensePromptRecipientUser(targetActor, targetTokenDocument);
  if (!recipient?.id) {
    pcLog.debug("Peasant Core | Incoming hit prompt skipped: no recipient user found", {
      target: target?.targetName || targetActor?.name,
      combatName: combat?.name || "Combat"
    });
    return null;
  }

  const attackerTokenDocument = attackerToken?.document ?? attackerToken ?? null;
  const attackerName = String(
    attackerToken?.name
    || attackerTokenDocument?.name
    || attackerActor?.name
    || "Attacker"
  ).trim() || "Attacker";
  const armorPenHit = isArmorPenLocationLike({
    isAP: locationRoll?.isAP,
    rawText: locationRoll?.rawText,
    locationResultText: locationRoll?.locationDisplay
  });

  const payload = {
    promptId: foundry.utils.randomID(),
    type: PC_SOCKET_PROMPT_INCOMING_HIT,
    originatingUserId: game.user?.id || null,
    recipientUserId: recipient.id,
    attackerActorId: attackerActor?.id || null,
    attackerActorUuid: attackerActor?.uuid || null,
    attackerTokenUuid: attackerTokenDocument?.uuid || null,
    attackerTokenName: attackerName,
    attackCombatIndex: null,
    attackCombatName: String(combat?.name || "Attack").trim() || "Attack",
    attackTargetingType: String(combat?.targetingType || "").trim(),
    targetSceneId: targetTokenDocument?.parent?.id || targetTokenDocument?.scene?.id || null,
    targetTokenId: targetTokenDocument?.id || null,
    targetTokenUuid: targetTokenDocument?.uuid || null,
    targetTokenName: target?.targetName || targetTokenDocument?.name || targetActor?.name || "Target",
    targetActorId: targetActor?.id || null,
    targetActorUuid: targetActor?.uuid || null,
    location: locationRoll.location,
    locationDisplay: locationRoll.locationDisplay,
    locationResultText: locationRoll.rawText,
    isAP: armorPenHit,
    damagePreview: String(damagePreview || "").trim(),
    damageType: String(damageType || "").trim(),
    damageTypeLabel: String(damageTypeLabel || "").trim()
  };

  const requestIncomingHitForUser = game.peasantCore?.requestIncomingHitForUser;
  const cancelPromptForUser = game.peasantCore?.cancelPromptForUser;
  if (typeof requestIncomingHitForUser === "function") {
    return await withWaitingForDefenderResponse(
      () => requestIncomingHitForUser(recipient.id, payload),
      {
        enabled: recipient.id !== game.user?.id,
        onAbort: () => cancelPromptForUser?.(recipient.id, {
          promptId: payload.promptId,
          targetActorId: targetActor?.id || null,
          targetTokenId: targetTokenDocument?.id || null
        })
      }
    );
  }

  if (game?.socket) {
    game.socket.emit(PC_SOCKET_NAMESPACE, payload);
  }
  return null;
}

async function requestIncomingHitApplicationForTarget({
  target = null,
  attackerActor = null,
  attackerToken = null,
  combat = null,
  damageRoll = null,
  locationRoll = null,
  incomingHitResolution = null,
  damageAmountOverride = null,
  ignoreHaltReduction = false
} = {}) {
  const targetActor = target?.actor || null;
  const targetTokenDocument = target?.tokenDocument || target?.token?.document || target?.token || null;
  if (!targetActor || !combat || !damageRoll || !locationRoll) return null;

  const recipient = getPreferredDefensePromptRecipientUser(targetActor, targetTokenDocument);
  if (!recipient?.id) {
    pcLog.debug("Peasant Core | Incoming hit apply skipped: no recipient user found", {
      target: target?.targetName || targetActor?.name,
      combatName: combat?.name || "Combat"
    });
    return null;
  }

  const attackerTokenDocument = attackerToken?.document ?? attackerToken ?? null;
  const attackerName = String(
    attackerToken?.name
    || attackerTokenDocument?.name
    || attackerActor?.name
    || "Attacker"
  ).trim() || "Attacker";

  let appliedDamageType = normalizeAppliedDamageType(
    incomingHitResolution?.appliedDamageType || damageRoll?.normalizedType || combat?.damage?.type,
    "blunt"
  );
  if (appliedDamageType === "flexible") appliedDamageType = "blunt";
  const armorPenHit = isArmorPenLocationLike({
    isAP: locationRoll?.isAP,
    rawText: locationRoll?.rawText,
    locationResultText: locationRoll?.locationDisplay
  });
  const parsedDamageAmountOverride = (
    damageAmountOverride === null
    || damageAmountOverride === undefined
    || String(damageAmountOverride).trim() === ""
  )
    ? null
    : Number(damageAmountOverride);
  const resolvedDamageAmount = Number.isFinite(parsedDamageAmountOverride)
    ? parsedDamageAmountOverride
    : (Number(damageRoll.total) || 0);

  const payload = {
    originatingUserId: game.user?.id || null,
    recipientUserId: recipient.id,
    attackerActorId: attackerActor?.id || null,
    attackerActorUuid: attackerActor?.uuid || null,
    attackerTokenUuid: attackerTokenDocument?.uuid || null,
    attackerTokenName: attackerName,
    attackCombatIndex: null,
    attackCombatName: String(combat?.name || "Attack").trim() || "Attack",
    attackTargetingType: String(combat?.targetingType || "").trim(),
    targetSceneId: targetTokenDocument?.parent?.id || targetTokenDocument?.scene?.id || null,
    targetTokenId: targetTokenDocument?.id || null,
    targetTokenUuid: targetTokenDocument?.uuid || null,
    targetTokenName: target?.targetName || targetTokenDocument?.name || targetActor?.name || "Target",
    targetActorId: targetActor?.id || null,
    targetActorUuid: targetActor?.uuid || null,
    location: locationRoll.location,
    locationDisplay: locationRoll.locationDisplay,
    locationResultText: locationRoll.rawText,
    isAP: armorPenHit,
    damageAmount: resolvedDamageAmount,
    damageType: appliedDamageType,
    damageTypeLabel: getAutomatedCombatDamageTypeLabel(appliedDamageType),
    useArmorCharge: !!incomingHitResolution?.useArmorCharge,
    ignoreHaltReduction: !!ignoreHaltReduction
  };

  let canApplyLocally = false;
  try {
    canApplyLocally = !!game.user?.isGM
      || (typeof targetActor?.canUserModify === "function" && targetActor.canUserModify(game.user, "update"));
  } catch (e) {
    pcLog.debug("Peasant Core | Failed to test local incoming-hit apply permission", e);
  }

  if (canApplyLocally) {
    try {
      const localApplication = await applyIncomingHit(payload);
      if (localApplication?.handled && localApplication?.applied) {
        return localApplication;
      }
    } catch (error) {
      console.error("Peasant Core | Local incoming hit apply failed, falling back to remote application.", error);
    }
  }

  const applyIncomingHitForUser = game.peasantCore?.applyIncomingHitForUser;
  let applicationResult = null;
  if (typeof applyIncomingHitForUser === "function") {
    applicationResult = await applyIncomingHitForUser(recipient.id, payload);
  } else {
    applicationResult = await applyIncomingHit(payload);
  }

  const applicationHandled = !!(applicationResult && typeof applicationResult === "object" && applicationResult.handled);
  const applicationApplied = !!(applicationResult && typeof applicationResult === "object" && applicationResult.applied);
  if (applicationHandled && applicationApplied) {
    return applicationResult;
  }

  return applicationResult;
}

async function resolveSuccessfulAttackDamageForTarget({
  actor = null,
  attackerToken = null,
  combat = null,
  target = null,
  attackRoll = null,
  defensePromptResult = null,
  appliedDamageType = null
} = {}) {
  if (!actor || !combat || !target) {
    return null;
  }

  const targetingKey = getCombatDefenseResponseKey(combat?.targetingType);
  if (targetingKey === "aoe") return null;
  if (!combat?.damage) return null;

  const mageBlockFailure = isMageDefenseDamageRedirect(attackRoll, defensePromptResult);
  if (!attackRoll?.rollResult?.isSuccess && !mageBlockFailure) {
    return null;
  }

  const targetLabel = target?.targetName || target?.actor?.name || "";
  if (mageBlockFailure) {
    const mageDefense = normalizeCombatDefense(defensePromptResult?.selectedDefense);
    const location = getLowestHaltDamageLocation(target?.actor);
    const locationRoll = {
      rawText: getTargetedDamageLocationDisplay(location),
      location,
      locationDisplay: getTargetedDamageLocationDisplay(location),
      isAP: false,
      byMageBlock: true
    };

    const resolvedDamageType = normalizeAppliedDamageType(appliedDamageType || combat?.damage?.type, "blunt");

    const damageRoll = await rollAutomatedCombatDamage(actor, combat, {
      targetLabel,
      attackerToken,
      appliedDamageType: resolvedDamageType
    });
    if (!damageRoll || !Number.isFinite(Number(damageRoll.total)) || Number(damageRoll.total) <= 0) {
      return { handled: false, reason: "noDamageRolled", locationRoll, damageRoll, mageBlockFailure: true };
    }

    const absorbedByMage = Math.max(0, Number(mageDefense.hp) || 0);
    const redirectedDamage = Math.max(0, (Number(damageRoll.total) || 0) - absorbedByMage);
    if (redirectedDamage <= 0) {
      return {
        handled: true,
        mageBlockFailure: true,
        locationRoll,
        damageRoll,
        absorbedByMage,
        redirectedDamage,
        application: { handled: true, applied: false, reason: "mageBlockAbsorbedAllDamage" }
      };
    }

    const application = await requestIncomingHitApplicationForTarget({
      target,
      attackerActor: actor,
      attackerToken,
      combat,
      damageRoll,
      locationRoll,
      incomingHitResolution: {
        useArmorCharge: false,
        appliedDamageType: resolvedDamageType
      },
      damageAmountOverride: redirectedDamage,
      ignoreHaltReduction: true
    });

    return {
      handled: true,
      mageBlockFailure: true,
      locationRoll,
      damageRoll,
      absorbedByMage,
      redirectedDamage,
      application
    };
  }

  const locationRoll = await resolveAttackLocationForTarget({
    actor,
    attackerToken,
    combat,
    target,
    attackRoll,
    defensePromptResult
  });
  if (isChainCancelledResult(locationRoll)) {
    return { handled: false, chainCancelled: true, reason: "locationPromptClosed" };
  }
  if (!locationRoll) return { handled: false, reason: "locationUnavailable" };

  const damagePreview = getAutomatedCombatDamagePreview(actor, combat, { appliedDamageType });
  const resolution = await requestIncomingHitResolutionForTarget({
    target,
    attackerActor: actor,
    attackerToken,
    combat,
    locationRoll,
    damagePreview,
    damageType: String(appliedDamageType || combat?.damage?.type || "").trim(),
    damageTypeLabel: getAutomatedCombatDamageTypeLabel(appliedDamageType || combat?.damage?.type)
  });
  if (isChainCancelledResult(resolution)) {
    return { handled: false, chainCancelled: true, reason: "incomingHitPromptClosed", locationRoll, resolution };
  }

  const resolvedDamageType = normalizeAppliedDamageType(resolution?.appliedDamageType || appliedDamageType || combat?.damage?.type, "blunt");

  const damageRoll = await rollAutomatedCombatDamage(actor, combat, {
    targetLabel,
    attackerToken,
    appliedDamageType: resolvedDamageType
  });
  if (!damageRoll || !Number.isFinite(Number(damageRoll.total)) || Number(damageRoll.total) <= 0) {
    return { handled: false, reason: "noDamageRolled", locationRoll, damageRoll, resolution };
  }

  const application = await requestIncomingHitApplicationForTarget({
    target,
    attackerActor: actor,
    attackerToken,
    combat,
    damageRoll,
    locationRoll,
    incomingHitResolution: resolution
  });

  return {
    handled: true,
    locationRoll,
    damageRoll,
    resolution,
    application
  };
}

async function showIncomingHitPrompt(payload = {}) {
  const defenderActor = await resolveDefensePromptActor(payload);
  if (!defenderActor) return null;
  const promptId = String(payload.promptId || "").trim();

  const attackerName = String(payload.attackerTokenName || payload.attackerActorName || "Attacker").trim() || "Attacker";
  const location = String(payload.location || "Torso").trim() || "Torso";
  const locationDisplay = String(payload.locationDisplay || getTargetedDamageLocationDisplay(location)).trim() || getTargetedDamageLocationDisplay(location);
  const locationText = String(payload.locationResultText || locationDisplay).trim() || locationDisplay;
  const isAP = !!payload.isAP;
  const normalizedDamageType = normalizeAppliedDamageType(payload.damageType);
  const title = `${attackerName} hits you in the ${locationText}!`;

  const content = `
    <form class="pc-incoming-hit-form">
      <div class="form-group" style="margin-bottom: 10px;">
        <div class="pc-incoming-hit-message">Use armor charge before damage is rolled and applied?</div>
      </div>
    </form>
  `;

  return await new Promise((resolve) => {
    let settled = false;
    let renderedWindow = null;
    let closeWatcher = null;
    let dialogApp = null;

    const finalize = async (useArmorCharge, html = null, { chainCancelled = false } = {}) => {
      if (settled) return null;
      settled = true;
      if (closeWatcher) {
        clearInterval(closeWatcher);
        closeWatcher = null;
      }
      unregisterActiveRemotePrompt(promptId, remoteCloser);

      let appliedType = normalizedDamageType;
      if (appliedType === "flexible") appliedType = "blunt";

      const result = {
        handled: true,
        useArmorCharge: !!useArmorCharge,
        appliedDamageType: appliedType,
        location,
        isAP,
        chainCancelled: !!chainCancelled
      };
      resolve(result);
      try {
        Promise.resolve(dialogApp?.close?.()).catch((e) => {
          console.error("Peasant Core | Failed to close incoming hit prompt", e);
        });
      } catch (e) {
        console.error("Peasant Core | Failed to close incoming hit prompt", e);
      }
      return result;
    };

    const remoteCloser = async (result = {}) => {
      const finalized = await finalize(false, null, { chainCancelled: true, ...result });
      try {
        await dialogApp?.close?.();
      } catch (e) {
        pcLog.debug("Peasant Core | Failed to close remote incoming hit prompt", e);
      }
      return finalized;
    };
    if (promptId) registerActiveRemotePrompt(promptId, remoteCloser);

    dialogApp = renderDialogCompat({
      title,
      content,
      buttons: {
        armor: {
          label: "Use Armor Charge",
          callback: async (html) => {
            await finalize(true, html);
            return true;
          }
        },
        noArmor: {
          label: "Don't Use Armor Charge",
          callback: async (html) => {
            await finalize(false, html);
            return true;
          }
        }
      },
      default: "noArmor",
      render: (html) => {
        const viewportWidth = Number(window?.innerWidth) || 480;
        const stableDialogWidth = Math.max(360, Math.min(420, viewportWidth - 32));
        html.css({
          width: `${stableDialogWidth}px`,
          minWidth: `${stableDialogWidth}px`,
          maxWidth: `${Math.max(320, viewportWidth - 32)}px`
        });
        html.find('.window-content, .dialog-content').css({ overflowX: 'hidden' });

        renderedWindow = html.closest('.window-app, .application')[0] || html[0];
        $(renderedWindow)
          .find('.header-control, [data-action="close"], [data-button="close"]')
          .off('.pcIncomingHitClose')
          .on('click.pcIncomingHitClose', () => {
            void finalize(false, html, { chainCancelled: true });
          });

        if (!closeWatcher) {
          closeWatcher = window.setInterval(() => {
            if (settled || !renderedWindow) return;
            if (!renderedWindow.isConnected) {
              void finalize(false, html, { chainCancelled: true });
            }
          }, 150);
        }
      }
    }, { classes: ["pc-incoming-hit-dialog", "peasant-macro-dialog-force"] });
  });
}

async function applyIncomingHit(payload = {}) {
  const defenderActor = await resolveDefensePromptActor(payload);
  if (!defenderActor) return null;

  const damageAmount = Number(payload.damageAmount);
  if (!Number.isFinite(damageAmount) || damageAmount <= 0) {
    return { handled: false, applied: false, reason: "invalidDamage" };
  }

  const location = String(payload.location || "Torso").trim() || "Torso";
  const armorPenHit = isArmorPenLocationLike({
    isAP: payload.isAP,
    rawText: payload.locationResultText,
    locationResultText: payload.locationDisplay,
    label: payload.location
  });
  let appliedType = normalizeAppliedDamageType(payload.damageType, "blunt");
  if (appliedType === "flexible") appliedType = "blunt";

  let applyResult = null;
  try {
    applyResult = await applyTargetedDamageWorkflow(defenderActor, {
      amount: damageAmount,
      type: appliedType,
      location,
      isAP: armorPenHit,
      useArmorCharge: !!payload.useArmorCharge,
      ignoreHaltReduction: !!payload.ignoreHaltReduction,
      chatSpeaker: ChatMessage.getSpeaker({ actor: defenderActor })
    });
  } catch (error) {
    console.error("Peasant Core | applyIncomingHit failed while applying targeted damage workflow", {
      payload,
      defender: defenderActor?.name,
      error
    });
    return {
      handled: true,
      applied: false,
      reason: "workflowError",
      error: String(error?.message || error || "Unknown error")
    };
  }

  return {
    handled: true,
    applied: !!applyResult?.ok,
    useArmorCharge: !!payload.useArmorCharge,
    ignoreHaltReduction: !!payload.ignoreHaltReduction,
    appliedDamageType: appliedType,
    location,
    isAP: armorPenHit,
    applyResult
  };
}

registerPeasantCoreApi({
  showIncomingHitPrompt,
  applyIncomingHit,
  closeRemotePrompt: closeActiveRemotePrompt,
  drawLocationTable: drawLocationTableLikeMacro,
  startNotableCombatRoll
});

function getLowestHaltDamageLocation(actor) {
  if (!actor) return "Torso";

  const haltParts = parseHaltSlashValues(actor.system?.haltValues || "0/0/0/0");
  const combatHaltTotals = getCombatHaltBuffTotals(actor.system?.combatMods?.haltBuffs);
  const armorHaltBuffs = combatHaltTotals[COMBAT_HALT_BUFF_TYPE_HALT] || [0, 0, 0, 0];

  let bestLocation = "Torso";
  let bestValue = Number.POSITIVE_INFINITY;
  for (const location of LOWEST_HALT_LOCATION_PRIORITY) {
    const haltIndex = TARGETED_DAMAGE_HALT_INDEX_MAP[location] ?? 0;
    const haltValue = (Number.parseInt(haltParts[haltIndex], 10) || 0) + (armorHaltBuffs[haltIndex] || 0);
    if (haltValue < bestValue) {
      bestValue = haltValue;
      bestLocation = location;
    }
  }
  return bestLocation;
}

function isMageDefenseDamageRedirect(attackRoll, defensePromptResult) {
  const defense = normalizeCombatDefense(defensePromptResult?.selectedDefense);
  return !!(
    defensePromptResult?.selection === "defense"
    && attackRoll?.rollResult?.failureDueToDefense
    && defense.block
    && defense.blockType === "Mage"
  );
}

async function resolveAttackLocationForTarget({
  actor = null,
  attackerToken = null,
  combat = null,
  target = null,
  attackRoll = null,
  defensePromptResult = null
} = {}) {
  const targetLabel = target?.targetName || target?.actor?.name || "";
  const defendedByReflex = doesPromptResultCountAsActiveDefense(defensePromptResult);
  const selectableMoS = Number(attackRoll?.rollResult?.totalMoS) || 0;

  if (selectableMoS >= 1) {
    const promptResult = await showLocationBySkillPrompt({
      maxMoS: selectableMoS,
      attackerName: actor?.name || attackerToken?.name || "Attacker",
      targetLabel
    });
    if (isChainCancelledResult(promptResult)) {
      return { chainCancelled: true };
    }
    const selectedOption = promptResult?.option || null;
    if (selectedOption && selectedOption.mode !== "table") {
      const selectedLocation = createLocationRollFromSkillOption(selectedOption);
      await createChosenLocationTableMessage(selectedLocation);

      return selectedLocation;
    }
  }

  let locationRoll = await rollAutomatedAttackLocation({
    actor,
    attackerToken,
    combatName: combat?.name || "Combat",
    targetLabel
  });

  if (defendedByReflex && locationRoll?.location === "Head") {
    ui.notifications?.info?.("Head deflected by the defensive reflex. Rerolling location.");
    const rerolledLocation = await rollAutomatedAttackLocation({
      actor,
      attackerToken,
      combatName: combat?.name || "Combat",
      targetLabel
    });
    if (rerolledLocation) locationRoll = rerolledLocation;
  }

  return locationRoll;
}

function getAutomatedCombatDamageTypeLabel(rawType) {
  const normalizedType = normalizeAppliedDamageType(rawType, "");
  switch (normalizedType) {
    case "blunt":
      return "Blunt";
    case "lethal":
      return "Lethal";
    case "critical":
      return "Critical";
    case "hybrid":
      return "Hybrid";
    case "flexible":
      return "Blunt or Lethal";
    default: {
      const fallback = String(rawType || "").trim();
      return fallback ? fallback.charAt(0).toUpperCase() + fallback.slice(1) : "";
    }
  }
}

function buildAutomatedCombatDamageData(actor, combat, { appliedDamageType = null } = {}) {
  const combatName = combat.name || "Combat";
  const combatMods = actor.system?.combatMods || { toHit: 0, accuracy: 0, diceRate: 0, flatDamage: 0 };
  const diceRateMod = Number.parseInt(combatMods.diceRate, 10) || 0;
  const flatDamageMod = getCombatFlatDamageModifier(combatMods);

  const result = applyDieRate(
    combat.damage.diceCount || 0,
    combat.damage.diceValue || 0,
    combat.damage.flat || 0,
    diceRateMod,
    combat.damage.diceBonus || 0
  );

  let diceCount = Number(result.diceCount) || 0;
  let diceValue = Number(result.diceValue) || 0;
  let flat = (Number(result.flat) || 0) + flatDamageMod;
  const naturalDiceCount = diceCount;
  const useStability = !!combat.stability;
  const useStrengthen = useStability && !!combat.strengthen;
  const rolledDiceCount = useStability ? (naturalDiceCount * 2) : naturalDiceCount;

  let formula = "";
  if (rolledDiceCount > 0 && diceValue > 0) formula = `${rolledDiceCount}d${diceValue}`;
  if (flat !== 0 || !formula) {
    const flatText = `${flat}`;
    formula = formula
      ? `${formula}${flat >= 0 ? "+" : ""}${flatText}`
      : flatText;
  }

  let previewFormula = formula || "0";
  if (useStrengthen && naturalDiceCount > 0) previewFormula = `${previewFormula} keep highest ${naturalDiceCount}`;
  else if (useStability && naturalDiceCount > 0) previewFormula = `${previewFormula} / 2`;

  const resolvedTypeLabel = getAutomatedCombatDamageTypeLabel(appliedDamageType || combat?.damage?.type);

  return {
    combatName,
    combatMods,
    diceRateMod,
    flatDamageMod,
    diceCount,
    diceValue,
    flat,
    naturalDiceCount,
    rolledDiceCount,
    useStability,
    useStrengthen,
    previewFormula,
    previewText: resolvedTypeLabel ? `${previewFormula} ${resolvedTypeLabel}` : previewFormula,
    typeLabel: resolvedTypeLabel,
    normalizedType: normalizeAppliedDamageType(appliedDamageType || combat?.damage?.type, "blunt")
  };
}

function getAutomatedCombatDamagePreview(actor, combat, { appliedDamageType = null } = {}) {
  if (!actor || !combat?.damage) return "";
  return buildAutomatedCombatDamageData(actor, combat, { appliedDamageType }).previewText;
}

async function rollAutomatedCombatDamage(actor, combat, { targetLabel = "", attackerToken = null, appliedDamageType = null } = {}) {
  if (!actor || !combat?.damage) return null;

  const damageData = buildAutomatedCombatDamageData(actor, combat, { appliedDamageType });
  const { combatName, diceCount, diceValue, flat, naturalDiceCount, rolledDiceCount, useStability, useStrengthen, typeLabel, normalizedType } = damageData;

  let roll = null;
  let allDice = [];
  let adjustedDiceTotal = 0;
  let diceDetailLine = `<div>Dice: [] = 0</div>`;

  if (diceCount > 0 && diceValue > 0) {
    const formula = `${rolledDiceCount}d${diceValue}`;
    roll = await new Roll(formula).evaluate();
    allDice = roll.dice.flatMap((d) => d.results.map((r) => r.result));
    const diceBreakdown = allDice.join(", ");
    const diceSum = allDice.reduce((a, b) => a + b, 0);
    adjustedDiceTotal = diceSum;
    diceDetailLine = `<div>Dice: [${diceBreakdown}] = ${diceSum}</div>`;

    if (useStrengthen) {
      const indexed = allDice.map((value, index) => ({ value, index }));
      indexed.sort((a, b) => (b.value - a.value) || (a.index - b.index));
      const keepCount = Math.min(naturalDiceCount, allDice.length);
      const keepIndexSet = new Set(indexed.slice(0, keepCount).map((d) => d.index));
      adjustedDiceTotal = allDice.reduce((sum, value, index) => sum + (keepIndexSet.has(index) ? value : 0), 0);
      const droppedDisplay = allDice
        .map((die, index) => keepIndexSet.has(index) ? `${die}` : `<span style="color: #888;">${die}</span>`)
        .join(", ");
      diceDetailLine = `<div>Strengthened Dice: [${droppedDisplay}] = ${adjustedDiceTotal}</div>`;
    } else if (useStability) {
      adjustedDiceTotal = Math.floor(diceSum / 2);
      diceDetailLine = `<div>Stabilized Dice: [${diceBreakdown}] / 2 = ${adjustedDiceTotal}</div>`;
    }
  }

  const total = adjustedDiceTotal + flat;
  const speaker = getActorRollSpeaker(actor, attackerToken);
  const typeDisplay = typeLabel ? `<span style="color: #aaa; font-size: 11px; margin-left: 6px;">${escapeHtml(typeLabel)}</span>` : "";
  const rollTitle = targetLabel ? `${combatName} vs ${targetLabel}` : combatName;
  const rollId = `automated-damage-roll-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const chatHtml = `<div class="skill-roll-card" style="background: #1e1e1e; border: 1px solid #444; border-radius: 4px; padding: 10px; color: #e0e0e0; font-family: var(--font-body, 'Signika', 'Palatino Linotype', sans-serif);">
    <div style="font-size: 14px; font-weight: bold; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #555; color: #ffffff;">
      ${escapeHtml(rollTitle)}
    </div>
    <div style="display: flex; flex-direction: column; gap: 6px;">
      <div style="display: flex; gap: 6px;">
        <div style="flex: 1; display: flex; justify-content: space-between; align-items: center; padding: 6px; background: #252525; border-radius: 3px; border-left: 3px solid #555;">
          <span style="color: #ffffff; font-weight: bold; font-size: 11px;">Damage:</span>
          <div style="display: flex; align-items: center; gap: 6px;">
            <button class="mos-toggle" data-roll-id="${rollId}" style="cursor: pointer; padding: 4px 8px; background: #2a2a2a; border-radius: 3px; font-size: 14px; font-weight: bold; color: #4ade80; border: 2px solid #22c55e;">
              ${total}
            </button>${typeDisplay}
          </div>
        </div>
      </div>
      <div class="roll-details" data-roll-id="${rollId}" style="display: none; background-color: #1a1a1a; color: #e0e0e0; border-radius: 4px; padding: 6px; border: 1px solid #555; font-size: 10px; line-height: 1.5;">
        <div style="color: #4a9eff; font-weight: bold; margin-bottom: 2px;">Roll Details:</div>
        ${diceDetailLine}${flat !== 0 ? `
        <div>Flat Modifier: ${flat > 0 ? '+' : ''}${flat}</div>` : ''}
      </div>
    </div>
  </div>`;

  await ChatMessage.create(applyRollMode({
    user: game.user.id,
    speaker,
    content: chatHtml,
    rolls: roll ? [roll] : undefined
  }));

  return {
    total,
    flat,
    diceCount,
    diceValue,
    typeLabel,
    normalizedType,
    roll,
    allDice,
    adjustedDiceTotal
  };
}

// Extracted helper to keep click logic testable and ensure `this` is the sheet
async function handleConsciousnessClick(ev) {
  try {
    ev.preventDefault();
    const el = $(ev.currentTarget);
    const tn = Number.isFinite(parseInt(el.data('tn'))) ? parseInt(el.data('tn')) : null;
    pcLog.debug('handleConsciousnessClick tn=', tn, 'sheet actor=', this?.actor?.name);
    if (tn === null) return;
    // notification removed: no UI popup on consciousness click
    const asSave = !!this.actor?.getFlag?.("peasant-core", PC_CONSCIOUSNESS_SAVE_FLAG);
    await performConsciousnessCheck({
      tn,
      asSave,
      speaker: ChatMessage.getSpeaker({ actor: this.actor })
    });
  } catch (err) {
    console.warn('handleConsciousnessClick error:', err);
  }
}

export class PeasantActorSheet extends ActorSheetBase {
  static MODES = {
    PLAY: 1,
    EDIT: 2
  };

  static get SHEET_TEMPLATE() {
    return PC_DEFAULT_SHEET_TEMPLATE;
  }

  static get SHEET_CLASSES() {
    return ["peasant-core", "peasant-actor-sheet"];
  }

  static get SHEET_WIDTH() {
    return 800;
  }

  static get SHEET_HEIGHT() {
    return 700;
  }

  get title() {
    return this.actor?.name || super.title;
  }

  _mode = null;

  get isEditMode() {
    return this._mode === this.constructor.MODES.EDIT;
  }

  _clearPendingEditAutosaves() {
    if (!(this._pendingEditAutosaveTimers instanceof Map)) {
      this._pendingEditAutosaveTimers = new Map();
      return;
    }
    for (const [el, entry] of this._pendingEditAutosaveTimers.entries()) {
      this._clearPendingEditAutosaveTarget(el, entry);
    }
    this._pendingEditAutosaveTimers.clear();
  }

  _clearPendingEditAutosaveTarget(target, entry = null) {
    if (!target || !(this._pendingEditAutosaveTimers instanceof Map)) return;
    const current = entry ?? this._pendingEditAutosaveTimers.get(target);
    const timeoutId = typeof current === "object" ? current?.timeoutId : current;
    if (timeoutId) clearTimeout(timeoutId);
    if (typeof current?.onChange === "function") {
      try { target.removeEventListener("change", current.onChange); } catch (e) { /* ignore */ }
    }
    this._pendingEditAutosaveTimers.delete(target);
  }

  async _flushPendingEditAutosaves({ triggerChanges = false } = {}) {
    if (!(this._pendingEditAutosaveTimers instanceof Map) || this._pendingEditAutosaveTimers.size === 0) return;

    const pendingTargets = [];
    for (const [el, entry] of this._pendingEditAutosaveTimers.entries()) {
      this._clearPendingEditAutosaveTarget(el, entry);
      if (triggerChanges && el?.isConnected) pendingTargets.push(el);
    }
    this._pendingEditAutosaveTimers.clear();

    if (!triggerChanges || pendingTargets.length === 0) return;
    for (const el of pendingTargets) {
      const EventConstructor = el?.ownerDocument?.defaultView?.Event ?? Event;
      try { el.dispatchEvent(new EventConstructor("change", { bubbles: true })); } catch (e) {
        try { $(el).trigger("change"); } catch (jqErr) { /* ignore */ }
      }
    }
    await new Promise(resolve => setTimeout(resolve, 60));
  }

  _getElementDocument(element = null) {
    const resolved = getApplicationElement(element) ?? getApplicationElement(this);
    return resolved?.ownerDocument ?? document;
  }

  _isElementFocused(element) {
    if (!element) return false;
    return this._getElementDocument(element)?.activeElement === element;
  }

  _scheduleEditAutosaveChange(target, delayMs = 360) {
    if (!target || typeof target !== "object") return;
    if (!(this._pendingEditAutosaveTimers instanceof Map)) this._pendingEditAutosaveTimers = new Map();

    // Prune detached nodes to avoid stale timers.
    for (const [el, entry] of this._pendingEditAutosaveTimers.entries()) {
      if (!el?.isConnected) {
        this._clearPendingEditAutosaveTarget(el, entry);
      }
    }

    this._clearPendingEditAutosaveTarget(target);

    const timerId = setTimeout(() => {
      if (!target?.isConnected) {
        this._clearPendingEditAutosaveTarget(target);
        return;
      }
      if (this._isElementFocused(target)) return;
      this._clearPendingEditAutosaveTarget(target);
      const EventConstructor = target?.ownerDocument?.defaultView?.Event ?? Event;
      try { target.dispatchEvent(new EventConstructor("change", { bubbles: true })); } catch (e) {
        try { $(target).trigger("change"); } catch (jqErr) { /* ignore */ }
      }
    }, Math.max(120, Number(delayMs) || 0));

    const onChange = () => this._clearPendingEditAutosaveTarget(target);
    try { target.addEventListener("change", onChange, { once: true }); } catch (e) { /* ignore */ }
    this._pendingEditAutosaveTimers.set(target, { timeoutId: timerId, onChange });
  }

  async _flushQueuedSaves() {
    const queueKeys = [
      "_skillsSaveQueue",
      "_combatSaveQueue",
      "_advantageSaveQueue",
      "_edgeResourceSaveQueue"
    ];

    for (const key of queueKeys) {
      const queue = this[key];
      if (!queue || typeof queue.then !== "function") continue;
      try { await queue; } catch (e) { /* keep flushing remaining queues */ }
    }

    // Allow any final queued microtasks/change handlers to settle.
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  static get DEFAULT_OPTIONS() {
    const superOptions = super.DEFAULT_OPTIONS ?? {};
    const classes = Array.from(new Set([...(superOptions.classes ?? []), ...this.SHEET_CLASSES]));
    return foundry.utils.mergeObject(superOptions, {
      classes,
      position: {
        width: this.SHEET_WIDTH,
        height: this.SHEET_HEIGHT
      },
      window: {
        resizable: true
      },
      form: {
        submitOnChange: true,
        closeOnSubmit: false
      },
      actions: {
        tab: this._onSheetTabAction,
        changeMode: this.#changeMode,
        refreshResources: this._onRefreshResourcesAction,
        rest: this._onRestAction,
        rollConsciousness: this._onConsciousnessRollAction,
        rollInitiative: this._onInitiativeRollAction,
        rollCombat: this._onCombatRollAction,
        rollCombatTag: this._onCombatTagRollAction,
        rollSkill: this._onSkillRollAction,
        rollAttributeToHit: this._onAttributeToHitRollAction,
        rollAttributeSave: this._onAttributeSaveRollAction
      }
    }, { inplace: false });
  }

  static get PARTS() {
    return {
      sheet: {
        template: this.SHEET_TEMPLATE
      },
      tabs: {
        id: "tabs",
        classes: ["pc-sheet-tabs-part"],
        template: "systems/peasant-core/templates/actor/parts/character-tabs.html"
      }
    };
  }

  static get SHEET_PARTIAL_PATH() {
    return "systems/peasant-core/templates/actor/parts";
  }

  static get TAB_DEFINITIONS() {
    return [
      { tab: "skills", label: "Skills", icon: "fa-solid fa-book", slot: "attributes", partial: "character-skills.html" },
      { tab: "notable-combats", label: "Notable Combats", icon: "fas fa-list", slot: "attributes", partial: "character-notable-combats.html" },
      { tab: "effects", label: "Effects", icon: "fa-solid fa-bolt", slot: "main", partial: "character-effects.html" },
      { tab: "inventory", label: "Inventory", icon: "fa-solid fa-backpack", slot: "main", partial: "character-inventory.html" },
      { tab: "aspects-advantages", label: "Aspects & Advantages", icon: "fa-solid fa-star", slot: "main", partial: "character-advantages.html" },
      { tab: "biography", label: "Biography", icon: "fas fa-feather", slot: "main", partial: "character-biography.html" },
      { tab: "settings", label: "Sheet Configuration", icon: "fa-solid fa-gear", slot: "main", partial: "character-settings.html" }
    ];
  }

  static get SHEET_PARTIALS() {
    const tabPartials = this.TAB_DEFINITIONS.map(({ partial }) => `${this.SHEET_PARTIAL_PATH}/${partial}`);
    return [...tabPartials, `${this.SHEET_PARTIAL_PATH}/character-blessing-menu.html`];
  }

  static get TABS() {
    return this.TAB_DEFINITIONS.map(({ tab, label, icon }) => ({ tab, label, icon }));
  }

  static get ATTRIBUTE_STAGE_TABS() {
    return new Set(this.TAB_DEFINITIONS
      .filter(({ slot }) => slot === "attributes")
      .map(({ tab }) => tab));
  }

  tabGroups = {
    primary: "skills"
  };

  static async preloadSheetPartials() {
    const loadTemplatesFn = foundry?.applications?.handlebars?.loadTemplates;
    if (typeof loadTemplatesFn !== "function") return;
    this._sheetPartialsReady ??= loadTemplatesFn(this.SHEET_PARTIALS).catch(err => {
      this._sheetPartialsReady = null;
      console.error("Peasant Core | Failed to preload actor sheet partials", err);
      throw err;
    });
    await this._sheetPartialsReady;
  }

  static _onSheetTabAction(event, target) {
    const tab = target?.dataset?.tab;
    const group = target?.dataset?.group ?? "primary";
    if (!tab || typeof this.changeTab !== "function") return;
    this.changeTab(tab, group, { event });
  }

  static #changeMode(event, target) {
    this._onChangeSheetMode(event, target);
  }

  async _onChangeSheetMode(event, target = event.currentTarget) {
    const { MODES } = this.constructor;
    const label = target.checked ? "Enter View Mode" : "Enter Edit Mode";
    target.dataset.tooltip = label;
    target.setAttribute("aria-label", label);
    target.title = label;
    this._mode = target.checked ? MODES.EDIT : MODES.PLAY;

    if (typeof this.submit === "function") await this.submit();
    this.render();
  }

  static async _onRefreshResourcesAction() {
    await confirmPeasantResourceRefresh(this);
  }

  static async _onRestAction(event, target) {
    const restButton = target ?? event?.currentTarget;
    const restType = restButton?.dataset?.type ?? restButton?.dataset?.restType;
    await confirmPeasantRest(this, restType);
  }

  static async _onConsciousnessRollAction(event, target) {
    await this._rollConsciousnessFromElement(event, target);
  }

  static async _onInitiativeRollAction(event, target) {
    await this._rollInitiativeFromElement(event, target);
  }

  static async _onCombatRollAction(event, target) {
    await this._rollCombatFromElement(event, target);
  }

  static async _onCombatTagRollAction(event, target) {
    await this._rollCombatTagFromElement(event, target);
  }

  static async _onSkillRollAction(event, target) {
    await this._rollSkillFromElement(event, target);
  }

  static async _onAttributeToHitRollAction(event, target) {
    await this._rollAttributeToHitFromElement(event, target);
  }

  static async _onAttributeSaveRollAction(event, target) {
    await this._rollAttributeSaveFromElement(event, target);
  }

  _configureRenderOptions(options) {
    if (typeof super._configureRenderOptions === "function") super._configureRenderOptions(options);

    let { mode, renderContext } = options;
    if ((mode === undefined) && (renderContext === "createItem")) mode = this.constructor.MODES.EDIT;
    this._mode = mode ?? this._mode ?? this.constructor.MODES.PLAY;
  }

  async render(options = {}) {
    if (typeof options === "boolean") options = { force: options };
    else if (!options) options = {};
    if (!this.isEditMode) this._clearPendingEditAutosaves();
    const preserveScroll = options?.preserveScroll !== false;
    const scrollState = preserveScroll ? this._captureSheetScrollState() : null;
    const rendered = await super.render(options);
    if (preserveScroll && scrollState) this._restoreSheetScrollState(scrollState);
    return rendered;
  }

  async close(options) {
    if (this.isEditMode) {
      if (typeof this._flushPendingEditAutosaves === "function") {
        try { await this._flushPendingEditAutosaves({ triggerChanges: true }); } catch (e) { /* ignore */ }
      }
      if (typeof this._flushQueuedSaves === "function") {
        try { await this._flushQueuedSaves(); } catch (e) { /* ignore */ }
      }
    }
    teardownPortraitBindings(this);
    this._teardownSheetEventBindings();
    return super.close(options);
  }

  _detachOptions() {
    const windowId = (this.parent ?? this).window?.windowId;
    return windowId ? { window: { detached: true, windowId } } : {};
  }

  _withDetachedOptions(options = {}) {
    const detached = this._detachOptions();
    if (!detached.window) return options ?? {};
    return {
      ...(options ?? {}),
      window: {
        ...detached.window,
        ...((options ?? {}).window ?? {})
      }
    };
  }

  _renderDialog(data, options = {}) {
    return renderDialogCompat(data, this._withDetachedOptions(options));
  }

  _teardownSheetEventBindings() {
    if (this._sheetKeydownRoot && this._sheetKeydownHandler) {
      try {
        this._sheetKeydownRoot.removeEventListener("keydown", this._sheetKeydownHandler, true);
      } catch (e) { /* ignore */ }
    }
    this._sheetKeydownRoot = null;
    this._sheetKeydownHandler = null;
  }

  _claimSheetActivationEvent(event, claim, target = null) {
    const key = `__peasantCore_${claim}`;
    const nativeEvent = event?.originalEvent ?? event;

    if (nativeEvent) {
      if (nativeEvent[key]) return false;
      try {
        Object.defineProperty(nativeEvent, key, { value: true, configurable: true });
      } catch (e) {
        try { nativeEvent[key] = true; } catch (assignErr) { /* ignore */ }
      }
    }

    const guardTarget = target ?? event?.currentTarget ?? null;
    if (guardTarget) {
      this._sheetActivationGuards ??= new WeakMap();
      const now = Date.now();
      const last = this._sheetActivationGuards.get(guardTarget);
      if (last?.claim === claim && (now - last.at) < 100) return false;
      this._sheetActivationGuards.set(guardTarget, { claim, at: now });
    }

    return true;
  }

  _prepareSheetRollEvent(event, claim, target = null) {
    if (!this._claimSheetActivationEvent(event, claim, target)) return false;
    event?.preventDefault?.();
    event?.stopImmediatePropagation?.();
    event?.stopPropagation?.();
    return true;
  }

  _getActionTarget(event, target) {
    return target ?? event?.currentTarget ?? null;
  }

  _isPrimaryPointerEvent(event) {
    const nativeEvent = event?.originalEvent ?? event;
    const button = event?.button ?? nativeEvent?.button;
    const which = event?.which ?? nativeEvent?.which;
    return !((button != null && button !== 0) || (button == null && which != null && which !== 1));
  }

  async _rollConsciousnessFromElement(event, target) {
    try {
      if (!this._prepareSheetRollEvent(event, "consciousness-roll", target)) return;
      const el = $(this._getActionTarget(event, target));
      const th = Number.isFinite(parseInt(el.data("th")))
        ? parseInt(el.data("th"))
        : (Number.isFinite(parseInt(el.data("tn"))) ? parseInt(el.data("tn")) : null);
      if (th === null) return;
      const asSave = !!this.actor?.getFlag?.("peasant-core", PC_CONSCIOUSNESS_SAVE_FLAG);
      await performConsciousnessCheck({
        tn: th,
        asSave,
        speaker: ChatMessage.getSpeaker({ actor: this.actor })
      });
    } catch (err) {
      console.warn("Consciousness TH click handler failed:", err);
    }
  }

  async _rollInitiativeFromElement(event, target) {
    try {
      if (!this._prepareSheetRollEvent(event, "initiative-roll", target)) return;
      if (this.isEditMode) return;

      pcLog.debug("PeasantActorSheet: initiative clicked for actor", this.actor.id, this.actor.name);

      let foundCombat = game?.combat || canvas?.combat || null;
      const canvasToken = (canvas?.tokens?.placeables || []).find(t => t.actor && (t.actor.id === this.actor.id || t.actor.uuid === this.actor.uuid));
      const canvasTokenId = canvasToken?.id;

      const matchesCombatant = (c) => {
        try {
          if (!c) return false;
          const actorIdFields = [c.actor?.id, c.actor?.uuid, c.actorId, c.actorId?.toString(), c.actor?.data?.id].filter(Boolean);
          const tokenActorId = c.token?.actor?.id || c.token?.actorId || c.token?.actor?.uuid || c.token?.actor?.data?.id;
          const tokenIdFields = [c.token?.id, c.tokenId, c.token?._id].filter(Boolean);

          if (actorIdFields.includes(this.actor.id) || actorIdFields.includes(this.actor.uuid)) return true;
          if (tokenActorId === this.actor.id || tokenActorId === this.actor.uuid) return true;
          if (tokenIdFields.includes(canvasTokenId)) return true;
          return c.actor?.name === this.actor.name;
        } catch (e) { return false; }
      };

      let foundCombatant = foundCombat?.combatants?.find?.(matchesCombatant) || null;

      if (!foundCombatant) {
        for (const c of (game.combats?.contents || [])) {
          const cb = c.combatants.find(matchesCombatant);
          if (cb) { foundCombat = c; foundCombatant = cb; break; }
        }
      }

      if (!foundCombat || !foundCombatant) {
        try {
          const summary = (game.combats?.contents || []).map(c => ({ id: c.id, scene: c.scene, combatants: c.combatants.map(cb => ({ id: cb.id, actorId: cb.actor?.id || cb.actorId || null, tokenId: cb.token?.id || cb.tokenId || null })) }));
          pcLog.debug("PeasantActorSheet: no combat found for actor", this.actor.id, { canvasTokenId, combats: summary });
        } catch (e) {
          pcLog.debug("PeasantActorSheet: no combat found and failed to enumerate combats", e);
        }
        return;
      }

      const targetCombatant = foundCombat.combatants.find(matchesCombatant);
      if (!targetCombatant) {
        pcLog.debug("PeasantActorSheet: matching combatant not present on foundCombat", { combatId: foundCombat.id });
        return;
      }

      pcLog.debug("PeasantActorSheet: delegating to Combat.rollInitiative", { combatId: foundCombat.id, combatantId: targetCombatant.id });
      await foundCombat.rollInitiative(targetCombatant.id);
    } catch (err) {
      console.warn("Initiative click handler failed:", err);
    }
  }

  async _rollCombatFromElement(event, target) {
    try {
      if (!this._prepareSheetRollEvent(event, "combat-roll", target)) return;
      const el = $(this._getActionTarget(event, target));
      const idx = parseInt(el.data("index"));
      if (Number.isNaN(idx)) return;
      pcLog.debug("Peasant Core | combat-roll-clickable clicked", {
        actor: this.actor?.name,
        combatIndex: idx
      });
      await startNotableCombatRoll({
        actor: this.actor,
        combatIndex: idx,
        sheet: this,
        promptForTargets: true
      });
    } catch (e) {
      console.error("combat-roll-clickable handler failed", e);
    }
  }

  async _rollCombatTagFromElement(event, target) {
    if (!this._isPrimaryPointerEvent(event)) return;

    try {
      if (!this._prepareSheetRollEvent(event, "combat-tag-roll", target)) return;
      const $el = $(this._getActionTarget(event, target));
      let idx = parseInt($el.data("combatIndex")) || parseInt($el.data("combat-index")) || parseInt($el.attr("data-combat-index"));
      if (Number.isNaN(idx)) {
        const container = $el.closest(".combat-tags-inline");
        idx = parseInt(container.data("combatIndex")) || parseInt(container.attr("data-combat-index"));
      }
      if (Number.isNaN(idx)) idx = parseInt($el.data("index"));

      const rollType = $el.data("rollType") || $el.attr("data-roll-type");
      pcLog.debug("combat-tag-rollable action", { idx, rollType, el: $el[0] });

      if (Number.isNaN(idx) || !rollType) {
        pcLog.debug("combat-tag-rollable: invalid idx or rollType", { idx, rollType });
        return;
      }

      const combats = this.actor.system.notableCombats || [];
      const combat = combats[idx] || {};
      const combatName = combat.name || "Combat";
      const combatMods = this.actor.system.combatMods || { toHit: 0, accuracy: 0, diceRate: 0, flatDamage: 0 };
      const diceRateMod = parseInt(combatMods.diceRate) || 0;
      const flatDamageMod = getCombatFlatDamageModifier(combatMods);

      let diceCount = 0;
      let diceValue = 0;
      let flat = 0;
      let rollLabel = "";
      let typeLabel = "";

      if (rollType === "damage" && combat.damage) {
        const result = applyDieRate(
          combat.damage.diceCount || 0,
          combat.damage.diceValue || 0,
          combat.damage.flat || 0,
          diceRateMod,
          combat.damage.diceBonus || 0
        );
        diceCount = result.diceCount;
        diceValue = result.diceValue;
        flat = result.flat + flatDamageMod;
        rollLabel = "Damage";
        typeLabel = combat.damage.type || "";
      } else if (rollType === "heal" && combat.heal) {
        const result = applyDieRate(
          combat.heal.diceCount || 0,
          combat.heal.diceValue || 0,
          combat.heal.flat || 0,
          diceRateMod,
          combat.heal.diceBonus || 0
        );
        diceCount = result.diceCount;
        diceValue = result.diceValue;
        flat = result.flat + flatDamageMod;
        rollLabel = "Heal";
        typeLabel = combat.heal.type || "";
      } else if (rollType === "manifest" && combat.manifest) {
        const result = applyDieRate(
          combat.manifest.diceCount || 0,
          combat.manifest.diceValue || 0,
          combat.manifest.flat || 0,
          diceRateMod,
          combat.manifest.diceBonus || 0
        );
        diceCount = result.diceCount;
        diceValue = result.diceValue;
        flat = result.flat + flatDamageMod;
        rollLabel = "Manifest";
      }

      if (diceCount <= 0 || diceValue <= 0) return;

      const naturalDiceCount = diceCount;
      const useStability = !!combat.stability && (rollType === "damage" || rollType === "heal" || rollType === "manifest");
      const useStrengthen = useStability && !!combat.strengthen;
      const rolledDiceCount = useStability ? (naturalDiceCount * 2) : naturalDiceCount;
      const roll = await new Roll(`${rolledDiceCount}d${diceValue}`).evaluate();

      const diceResults = roll.dice.map(d => d.results.map(r => r.result));
      const allDice = diceResults.flat();
      const diceBreakdown = allDice.join(", ");
      const diceSum = allDice.reduce((a, b) => a + b, 0);
      let adjustedDiceTotal = diceSum;
      let diceDetailLine = `<div>Dice: [${diceBreakdown}] = ${diceSum}</div>`;

      if (useStrengthen) {
        const indexed = allDice.map((value, index) => ({ value, index }));
        indexed.sort((a, b) => (b.value - a.value) || (a.index - b.index));
        const keepCount = Math.min(naturalDiceCount, allDice.length);
        const keepIndexSet = new Set(indexed.slice(0, keepCount).map((d) => d.index));
        adjustedDiceTotal = allDice.reduce((sum, value, index) => sum + (keepIndexSet.has(index) ? value : 0), 0);
        const droppedDisplay = allDice
          .map((die, index) => keepIndexSet.has(index) ? `${die}` : `<span style="color: #888;">${die}</span>`)
          .join(", ");
        diceDetailLine = `<div>Strengthened Dice: [${droppedDisplay}] = ${adjustedDiceTotal}</div>`;
      } else if (useStability) {
        adjustedDiceTotal = Math.floor(diceSum / 2);
        diceDetailLine = `<div>Stabilized Dice: [${diceBreakdown}] / 2 = ${adjustedDiceTotal}</div>`;
      }

      const total = adjustedDiceTotal + flat;
      const speaker = ChatMessage.getSpeaker({ actor: this.actor });
      const typeDisplay = typeLabel ? `<span style="color: #aaa; font-size: 11px; margin-left: 6px;">${typeLabel}</span>` : "";
      const rollId = `dice-roll-${Date.now()}`;
      const chatHtml = `<div class="skill-roll-card" style="background: #1e1e1e; border: 1px solid #444; border-radius: 4px; padding: 10px; color: #e0e0e0; font-family: var(--font-body, 'Signika', 'Palatino Linotype', sans-serif);">
  <div style="font-size: 14px; font-weight: bold; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #555; color: #ffffff;">
    ${escapeHtml(combatName)}
  </div>
  <div style="display: flex; flex-direction: column; gap: 6px;">
    <div style="display: flex; gap: 6px;">
      <div style="flex: 1; display: flex; justify-content: space-between; align-items: center; padding: 6px; background: #252525; border-radius: 3px; border-left: 3px solid #555;">
        <span style="color: #ffffff; font-weight: bold; font-size: 11px;">${rollLabel}:</span>
        <div style="display: flex; align-items: center; gap: 6px;">
          <button class="mos-toggle" data-roll-id="${rollId}" style="cursor: pointer; padding: 4px 8px; background: #2a2a2a; border-radius: 3px; font-size: 14px; font-weight: bold; color: #4ade80; border: 2px solid #22c55e;">
            ${total}
          </button>${typeDisplay}
        </div>
      </div>
    </div>
    <div class="roll-details" data-roll-id="${rollId}" style="display: none; background-color: #1a1a1a; color: #e0e0e0; border-radius: 4px; padding: 6px; border: 1px solid #555; font-size: 10px; line-height: 1.5;">
      <div style="color: #4a9eff; font-weight: bold; margin-bottom: 2px;">Roll Details:</div>
      ${diceDetailLine}${flat !== 0 ? `
      <div>Flat Modifier: ${flat > 0 ? "+" : ""}${flat}</div>` : ""}
    </div>
  </div>
</div>`;

      await ChatMessage.create(applyRollMode({
        user: game.user.id,
        speaker,
        content: chatHtml,
        rolls: [roll]
      }));
    } catch (e) {
      console.error("combat-tag-rollable handler failed", e);
    }
  }

  async _rollSkillFromElement(event, target) {
    try {
      if (!this._prepareSheetRollEvent(event, "skill-roll", target)) return;
      const el = $(this._getActionTarget(event, target));
      const idx = parseInt(el.data("index"));
      if (Number.isNaN(idx)) return;
      const skills = this.actor.system.skills || [];
      const skill = skills[idx] || {};
      const combatMods = this.actor.system.combatMods || { toHit: 0, accuracy: 0, diceRate: 0, flatDamage: 0 };
      const toHitMod = parseInt(combatMods.toHit) || 0;
      const accuracyMod = parseInt(combatMods.accuracy) || 0;
      const baseTohit = Number.isFinite(parseInt(skill.tohit)) ? parseInt(skill.tohit) : 7;
      const baseAccuracy = parseInt(skill.accuracy) || 0;
      const skillCalc = applyToHitAccuracy(baseTohit, baseAccuracy, toHitMod, accuracyMod, 2);
      const tohit = skillCalc.toHit;
      const accuracy = skillCalc.accuracy;
      const skillName = `${skill.name || "Skill"} Skill Roll`;
      const isUntrained = String(skill.rank || "").trim().toLowerCase() === "u";

      const consumeSigUse = async () => {
        try {
          const result = await this.actor.consumePeasantSkillUse?.(idx);
          if (result?.skills) this._lastSkillsSnapshot = JSON.parse(JSON.stringify(result.skills));
          if (!result?.changed) return;
          this.render(false);
        } catch (err) {
          console.warn("Failed to consume SIG use after autoroll:", err);
        }
      };

      const accVal = accuracy !== 0 ? accuracy : undefined;
      if (isUntrained) {
        const untrainedSkillName = `${skill.name || "Skill"} Untrained Skill Roll`;
        await performUntrainedSkillRoll({ toHit: tohit, accuracy: 0, skillName: untrainedSkillName, speaker: ChatMessage.getSpeaker({ actor: this.actor }) });
      } else {
        await performSkillRoll({ toHit: tohit, accuracy: accVal, skillName, speaker: ChatMessage.getSpeaker({ actor: this.actor }) });
      }
      await consumeSigUse();
    } catch (err) {
      console.warn("Skill roll click failed:", err);
    }
  }

  async _rollAttributeToHitFromElement(event, target) {
    try {
      if (!this._prepareSheetRollEvent(event, "attr-tohit-roll", target)) return;
      const el = $(this._getActionTarget(event, target));
      const characteristic = el.data("characteristic") || "Untrained";
      const combatMods = this.actor.system.combatMods || { toHit: 0, accuracy: 0, diceRate: 0, flatDamage: 0 };
      const toHitMod = parseInt(combatMods.toHit) || 0;
      const baseMap = computeBaseAttrToHits(this.actor.system);
      const baseTn = Number.isFinite(baseMap[characteristic]) ? baseMap[characteristic] : 7;
      const attrCalc = applyToHitAccuracy(baseTn, 0, toHitMod, 0, 2);
      const tn = attrCalc.toHit;
      const accOverflow = attrCalc.accuracy;
      const skillName = `Untrained ${characteristic} Skill Roll`;

      await performUntrainedSkillRoll({ toHit: tn, accuracy: accOverflow, skillName, speaker: ChatMessage.getSpeaker({ actor: this.actor }) });
    } catch (err) {
      console.warn("Attribute to-hit click failed:", err);
    }
  }

  async _rollAttributeSaveFromElement(event, target) {
    try {
      if (!this._prepareSheetRollEvent(event, "attr-save-roll", target)) return;
      const el = $(this._getActionTarget(event, target));
      const saveKey = el.data("save") || "";
      const explicitTnRaw = Number.parseInt(el.data("tn"), 10);
      const hasExplicitTn = Number.isFinite(explicitTnRaw);

      let tn = 7;
      let skillName = "Saving Roll";
      if (hasExplicitTn) {
        tn = Math.max(2, explicitTnRaw);
        const customSkillName = String(el.data("saveLabel") || "").trim();
        skillName = customSkillName || "AoE Reflex Save";
      } else {
        const combatMods = this.actor.system.combatMods || { toHit: 0, accuracy: 0, diceRate: 0, flatDamage: 0 };
        const toHitMod = parseInt(combatMods.toHit) || 0;
        const saveConfigModRaw = Number(this.actor?.getFlag?.("peasant-core", PC_SAVE_MODIFIER_FLAG));
        const saveConfigMod = Number.isFinite(saveConfigModRaw) ? Math.trunc(saveConfigModRaw) : 0;
        const baseSaves = computeBaseSaves(this.actor.system);
        const baseTn = Number.isFinite(baseSaves[saveKey]) ? baseSaves[saveKey] : 7;
        const saveCalc = applyToHitFloor(baseTn, toHitMod + saveConfigMod, 2);
        tn = saveCalc.toHit;
        const pretty = saveKey.charAt(0).toUpperCase() + saveKey.slice(1);
        skillName = `${pretty} Save`;
      }

      await performSavingRoll({ toHit: tn, skillName, speaker: ChatMessage.getSpeaker({ actor: this.actor }) });
    } catch (err) {
      console.warn("Attribute save click failed:", err);
    }
  }

  _captureSheetScrollState() {
    const sheet = this._getSheetJQ()?.[0];
    if (!sheet) return null;
    return {
      top: sheet.scrollTop ?? 0,
      left: sheet.scrollLeft ?? 0
    };
  }

  _restoreSheetScrollState(state) {
    if (!state) return;
    const apply = () => {
      const sheet = this._getSheetJQ()?.[0];
      if (!sheet) return;
      sheet.scrollTop = state.top ?? 0;
      sheet.scrollLeft = state.left ?? 0;
    };
    apply();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(apply);
    setTimeout(apply, 0);
  }

  async _prepareContext(options) {
    await this.constructor.preloadSheetPartials();
    const baseContext = await super._prepareContext(options);
    const data = await this.getData(options);
    data.activeSheetTab = this._normalizeSheetTab(this.tabGroups?.primary);
    data.sheetTabs = this._getSheetTabs();
    data.editable = this.isEditable && this.isEditMode;
    return Object.assign(baseContext, data);
  }

  async _onRender(context, options) {
    if (typeof super._onRender === "function") await super._onRender(context, options);
    const sheet = this._getSheetJQ();
    const sheetEl = sheet?.[0] || null;
    if (sheetEl && sheetEl.tabIndex < 0) sheetEl.tabIndex = 0;
    this.activateListeners(sheet);
    this._renderModeToggle();
    const root = getApplicationElement(this);
    root?.classList.toggle("editable", this.isEditable && this.isEditMode);
    root?.classList.toggle("interactable", this.isEditable && (this._mode === this.constructor.MODES.PLAY));
    root?.classList.toggle("locked", !this.isEditable);
    this._syncSheetTabRailViewportMode();
  }

  _getSheetJQ() {
    const root = getApplicationJQuery(this);
    if (!root.length) return $();
    if (root.is(".actor-sheet")) return root;
    const sheet = root.find(".actor-sheet").first();
    if (sheet.length) return sheet;
    return root;
  }

  _syncSheetTabRailViewportMode() {
    const root = getApplicationJQuery(this);
    const rootEl = root?.[0];
    const rail = root.find(".pc-sheet-tab-rail").first()?.[0];
    if (!rootEl || !rail) return;

    const sync = () => {
      const ownerDocument = this._getElementDocument(rootEl);
      const isDetached = !!ownerDocument?.body?.classList?.contains("detached");
      root.toggleClass("pc-tabs-inside-viewport", isDetached);
      if (isDetached) return;

      root.removeClass("pc-tabs-inside-viewport");
      const viewportWidth = ownerDocument?.documentElement?.clientWidth || ownerDocument?.defaultView?.innerWidth || 0;
      const railRect = rail.getBoundingClientRect();
      const shouldPullInside = viewportWidth > 0 && railRect.right > viewportWidth - 2;
      root.toggleClass("pc-tabs-inside-viewport", shouldPullInside);
    };

    sync();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(sync);
  }

  _setupSheetTabs(html) {
    const sheet = html instanceof jQuery ? html : $(html);
    if (!sheet.length) return;

    this.tabGroups ??= {};
    const activeTab = this._normalizeSheetTab(this.tabGroups.primary);
    this.tabGroups.primary = activeTab;

    this._prepareSheetTabLayout(sheet);
    this._applySheetTab(activeTab, sheet);
  }

  _normalizeSheetTab(tab) {
    const validTabs = new Set(this.constructor.TABS.map(tabConfig => tabConfig.tab));
    return validTabs.has(String(tab ?? "")) ? String(tab) : "skills";
  }

  _getSheetTabs() {
    const activeTab = this._normalizeSheetTab(this.tabGroups?.primary);
    return this.constructor.TABS.map(({ tab, ...config }) => {
      const active = tab === activeTab;
      return {
        ...config,
        id: tab,
        group: "primary",
        active,
        cssClass: active ? "active is-active" : ""
      };
    });
  }

  _prepareSheetTabLayout(sheet) {
    const attributesPanel = sheet.find(".attributes-resources-container").first();
    const attributesSkillSection = sheet.find(".pc-attributes-skills-section").first();
    const skillsPanel = attributesSkillSection.find(".pc-skills-tab-panel").first();
    skillsPanel.addClass("tab").attr({ "data-group": "primary", "data-tab": "skills" });

    let attributesTabSlot = attributesSkillSection.find(".pc-attributes-tab-slot").first();
    if (!attributesTabSlot.length) {
      attributesTabSlot = $('<div class="pc-attributes-tab-slot"></div>').appendTo(attributesSkillSection);
    }

    let mainTabStage = sheet.find(".pc-sheet-main-tab-stage").first();
    if (!mainTabStage.length) {
      mainTabStage = $('<div class="pc-sheet-main-tab-stage" aria-live="polite"></div>');
      if (attributesPanel.length) mainTabStage.insertAfter(attributesPanel);
      else {
        const hpSection = sheet.find(".hp-section").first();
        if (hpSection.length) mainTabStage.appendTo(hpSection);
        else mainTabStage.appendTo(sheet);
      }
    }

    for (const { tab, slot } of this.constructor.TAB_DEFINITIONS) {
      if (tab === "skills") continue;
      const panel = sheet.find(`[data-pc-tab-panel="${tab}"]`).first();
      if (panel.length) {
        panel.addClass("tab").attr({ "data-group": "primary", "data-tab": tab });
        panel.appendTo(slot === "attributes" ? attributesTabSlot : mainTabStage);
      }
    }

    sheet.find(".pc-tab-detached-divider").prop("hidden", true).attr("aria-hidden", "true");
  }

  _applySheetTab(tab, sheet = this._getSheetJQ()) {
    const activeTab = this._normalizeSheetTab(tab);
    this.tabGroups ??= {};
    this.tabGroups.primary = activeTab;

    const root = getApplicationJQuery(this);
    const tabClasses = this.constructor.TABS.map(tabConfig => `tab-${tabConfig.tab}`);
    root.removeClass(tabClasses.join(" ")).addClass(`tab-${activeTab}`);

    const attributesPanel = sheet.find(".attributes-resources-container").first();
    const mainTabStage = sheet.find(".pc-sheet-main-tab-stage").first();
    const skillsHeader = sheet.find(".pc-attributes-skills-header").first();
    const showAttributes = this.constructor.ATTRIBUTE_STAGE_TABS.has(activeTab);

    attributesPanel.prop("hidden", !showAttributes).attr("aria-hidden", showAttributes ? null : "true");
    mainTabStage.prop("hidden", showAttributes).attr("aria-hidden", showAttributes ? "true" : null);
    skillsHeader.prop("hidden", activeTab !== "skills").attr("aria-hidden", activeTab === "skills" ? null : "true");

    sheet.find('.tab[data-group="primary"]').each((_, panel) => {
      const isActive = panel.dataset.tab === activeTab;
      panel.classList.toggle("active", isActive);
      panel.hidden = !isActive;
      panel.setAttribute("aria-hidden", isActive ? "false" : "true");
    });

    root.find('.pc-sheet-tab-rail [data-group="primary"][data-tab]').each((_, button) => {
      const isActive = button.dataset.tab === activeTab;
      button.classList.toggle("active", isActive);
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  changeTab(tab, group = "primary", options = {}) {
    const activeTab = this._normalizeSheetTab(tab);
    if (group !== "primary") {
      if (typeof super.changeTab === "function") return super.changeTab(tab, group, options);
      return;
    }

    if (typeof super.changeTab === "function") {
      try {
        super.changeTab(activeTab, group, options);
      } catch (err) {
        this.tabGroups ??= {};
        this.tabGroups.primary = activeTab;
      }
    } else {
      this.tabGroups ??= {};
      this.tabGroups.primary = activeTab;
    }

    this._applySheetTab(activeTab);
  }

  _escapeHtml(value) {
    if (foundry?.utils?.escapeHTML) return foundry.utils.escapeHTML(String(value ?? ""));
    const div = document.createElement("div");
    div.textContent = String(value ?? "");
    return div.innerHTML;
  }

  _getDialogPositionNearTrigger(trigger, width = 420, height = 320) {
    const viewportWidth = Math.max(document.documentElement?.clientWidth || 0, window.innerWidth || 0);
    const viewportHeight = Math.max(document.documentElement?.clientHeight || 0, window.innerHeight || 0);
    const fallback = {
      width,
      left: Math.max(16, Math.round((viewportWidth - width) / 2)),
      top: Math.max(16, Math.round((viewportHeight - height) / 2))
    };
    const rect = trigger?.getBoundingClientRect?.();
    if (!rect) return fallback;

    const gap = 12;
    const edge = 16;
    let left = rect.right + gap;
    if (left + width > viewportWidth - edge) left = rect.left - width - gap;
    if (left < edge) left = Math.min(Math.max(edge, rect.left), Math.max(edge, viewportWidth - width - edge));

    let top = rect.top - 24;
    if (top + height > viewportHeight - edge) top = viewportHeight - height - edge;
    if (top < edge) top = edge;

    return {
      width,
      left: Math.round(left),
      top: Math.round(top)
    };
  }

  _positionSheetPopupNearTrigger(html, selector, trigger) {
    const popup = html.find(selector).first();
    const popupEl = popup[0];
    const triggerRect = trigger?.getBoundingClientRect?.();
    if (!popupEl || !triggerRect) return;

    const parent = popupEl.offsetParent || html.find(".hp-grid-container")[0] || this._getSheetJQ()[0];
    const parentRect = parent?.getBoundingClientRect?.();
    if (!parentRect) return;

    const popupWidth = popup.outerWidth() || 280;
    const sheetRect = this._getSheetJQ()[0]?.getBoundingClientRect?.() || parentRect;
    let left = triggerRect.left - parentRect.left;
    let top = triggerRect.bottom - parentRect.top + 8;

    const minLeft = sheetRect.left - parentRect.left + 8;
    const maxLeft = sheetRect.right - parentRect.left - popupWidth - 8;
    if (Number.isFinite(maxLeft) && maxLeft > minLeft) left = Math.max(minLeft, Math.min(left, maxLeft));
    top = Math.max(sheetRect.top - parentRect.top + 8, top);

    popup.css({
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`
    });
  }

  _getHpLabelRows() {
    return [
      { value: 3, text: "Good" },
      { value: 5, text: "Fair" },
      { value: 7, text: "Poor" },
      { value: 10, text: "Terrible" },
      { value: 11, text: "Critical" }
    ];
  }

  _renderHpGridDialogBody() {
    if (isSimplifiedHpActor(this.actor)) {
      return `<div class="pc-hp-grid-empty">This actor uses simplified HP. Use the portrait HP bar directly.</div>`;
    }

    const hp = this.actor?.system?.hp ?? {};
    const rows = Math.max(0, Number(hp.rows) || 0);
    const cols = Math.max(0, Number(hp.cols) || 0);
    const grid = Array.isArray(hp.grid) ? hp.grid : [];
    const labels = this._getHpLabelRows();
    const editMode = !!this.isEditMode;

    const controls = editMode ? `
      <div class="pc-hp-grid-popup-controls">
        <div class="pc-hp-grid-popup-stepper">
          <label>Columns</label>
          <button type="button" class="hp-col-minus sheet-stepper-btn" title="Decrease HP columns">&minus;</button>
          <span>${cols}</span>
          <button type="button" class="hp-col-plus sheet-stepper-btn" title="Increase HP columns">+</button>
        </div>
        <div class="pc-hp-grid-popup-stepper">
          <label>Rows</label>
          <button type="button" class="hp-row-minus sheet-stepper-btn" title="Decrease HP rows">&minus;</button>
          <span>${rows}</span>
          <button type="button" class="hp-row-plus sheet-stepper-btn" title="Increase HP rows">+</button>
        </div>
      </div>` : "";

    const rowHtml = Array.from({ length: rows }, (_, rowIndex) => {
      const row = Array.isArray(grid[rowIndex]) ? grid[rowIndex] : [];
      const cells = Array.from({ length: cols }, (_, colIndex) => {
        const cell = Number(row[colIndex]) || 0;
        const stateClass = cell === 1 ? "blunt" : cell === 2 ? "lethal" : cell === 3 ? "critical" : "regular";
        return `<div class="hp-cell ${stateClass}" data-row="${rowIndex}" data-col="${colIndex}"></div>`;
      }).join("");
      const label = labels[rowIndex] ?? { value: null, text: "" };
      const labelHtml = label.value
        ? `<span class="hp-th hp-tn-clickable" data-action="rollConsciousness" data-th="${label.value}" tabindex="0">${label.value}+</span><span class="hp-tn-text">${this._escapeHtml(label.text)}</span>`
        : `<span>${this._escapeHtml(label.text)}</span>`;
      return `${cells}<div class="hp-label pc-hp-grid-popup-label">${labelHtml}</div>`;
    }).join("");

    return `
      ${controls}
      <div class="pc-hp-grid-popup-grid" style="--hp-cols: ${Math.max(cols, 1)};">
        ${rowHtml}
      </div>
      <p class="pc-hp-grid-popup-help">Left-click cycles damage. Right-click clears a cell.</p>
    `;
  }

  _renderHpGridDialogContent() {
    return `<div class="pc-hp-grid-dialog-content"><div class="pc-hp-grid-dialog-body">${this._renderHpGridDialogBody()}</div></div>`;
  }

  _refreshHpGridDialog(root) {
    const jq = root instanceof jQuery ? root : $(root);
    jq.find(".pc-hp-grid-dialog-body").html(this._renderHpGridDialogBody());
    this._bindHpGridDialog(jq);
  }

  async _changeHpGridSize(rowDelta = 0, colDelta = 0) {
    await this.actor.resizePeasantHpGrid?.(rowDelta, colDelta);
  }

  async _setHpGridCell(row, col, value) {
    await this.actor.setPeasantHpGridCell?.(row, col, value);
  }

  _bindHpGridDialog(root) {
    const jq = root instanceof jQuery ? root : $(root);

    jq.find(".hp-col-plus").off("click.pcHpGrid").on("click.pcHpGrid", async (ev) => {
      ev.preventDefault();
      await this._changeHpGridSize(0, 1);
      await this.render(false);
      this._refreshHpGridDialog(jq);
    });

    jq.find(".hp-col-minus").off("click.pcHpGrid").on("click.pcHpGrid", async (ev) => {
      ev.preventDefault();
      await this._changeHpGridSize(0, -1);
      await this.render(false);
      this._refreshHpGridDialog(jq);
    });

    jq.find(".hp-row-plus").off("click.pcHpGrid").on("click.pcHpGrid", async (ev) => {
      ev.preventDefault();
      await this._changeHpGridSize(1, 0);
      await this.render(false);
      this._refreshHpGridDialog(jq);
    });

    jq.find(".hp-row-minus").off("click.pcHpGrid").on("click.pcHpGrid", async (ev) => {
      ev.preventDefault();
      await this._changeHpGridSize(-1, 0);
      await this.render(false);
      this._refreshHpGridDialog(jq);
    });

    jq.find(".hp-cell:not(.stress-cell)").off("click.pcHpGrid").on("click.pcHpGrid", async (ev) => {
      ev.preventDefault();
      const cell = $(ev.currentTarget);
      const row = Number.parseInt(cell.data("row"), 10);
      const col = Number.parseInt(cell.data("col"), 10);
      if (Number.isNaN(row) || Number.isNaN(col)) return;
      const current = Number(this.actor.system?.hp?.grid?.[row]?.[col]) || 0;
      await this._setHpGridCell(row, col, (current + 1) % 4);
      await this.render(false);
      this._refreshHpGridDialog(jq);
    });

    jq.find(".hp-cell:not(.stress-cell)").off("contextmenu.pcHpGrid").on("contextmenu.pcHpGrid", async (ev) => {
      ev.preventDefault();
      const cell = $(ev.currentTarget);
      const row = Number.parseInt(cell.data("row"), 10);
      const col = Number.parseInt(cell.data("col"), 10);
      if (Number.isNaN(row) || Number.isNaN(col)) return;
      await this._setHpGridCell(row, col, 0);
      await this.render(false);
      this._refreshHpGridDialog(jq);
    });

    jq.find(".hp-tn-clickable").off("click.pcHpGrid").on("click.pcHpGrid", async (ev) => {
      ev.preventDefault();
      const th = Number.parseInt($(ev.currentTarget).data("th"), 10);
      if (!Number.isFinite(th)) return;
      const asSave = !!this.actor?.getFlag?.("peasant-core", PC_CONSCIOUSNESS_SAVE_FLAG);
      await performConsciousnessCheck({
        tn: th,
        asSave,
        speaker: ChatMessage.getSpeaker({ actor: this.actor })
      });
    });
  }

  _openHpGridDialog(trigger = null) {
    const dialog = this._renderDialog({
      title: `${this.actor?.name || "Actor"} HP Grid`,
      content: this._renderHpGridDialogContent(),
      buttons: {},
      render: (html) => {
        html.addClass("pc-hp-grid-dialog-window");
        html.find(".dialog-buttons, .form-footer, footer").hide();
        this._bindHpGridDialog(html);
      }
    }, {
      classes: ["peasant-core", "pc-hp-grid-dialog"],
      position: this._getDialogPositionNearTrigger(trigger, 420, 340)
    });
    this._hpGridDialog = dialog;
    return dialog;
  }

  _getStressGridTypes() {
    return [
      { key: "physical", label: "Physical" },
      { key: "mental", label: "Mental" },
      { key: "general", label: "General" }
    ];
  }

  _normalizeStressType(stressType) {
    const type = String(stressType || "").trim().toLowerCase();
    return this._getStressGridTypes().some(entry => entry.key === type) ? type : "physical";
  }

  _getStressGridStates(stressType) {
    const type = this._normalizeStressType(stressType);
    const count = Math.max(0, Number(this.actor?.system?.[`${type}StressCount`]) || 0);
    return Array.from({ length: count }, (_, index) => {
      const value = Number(this.actor?.system?.[`${type}${index}`]) || 0;
      return Math.max(0, Math.min(3, value));
    });
  }

  _renderStressGridDialogBody(activeType = "physical") {
    const active = this._normalizeStressType(activeType);
    const editMode = !!this.isEditMode;
    const types = this._getStressGridTypes();
    const stateClass = (cell) => cell === 1 ? "blunt" : cell === 2 ? "lethal" : cell === 3 ? "critical" : "regular";

    const tabs = types.map(type => `
      <button type="button" class="pc-stress-grid-tab${type.key === active ? " active" : ""}" data-stress-tab="${type.key}" role="tab" aria-selected="${type.key === active ? "true" : "false"}">
        ${this._escapeHtml(type.label)}
      </button>
    `).join("");

    const panes = types.map(type => {
      const states = this._getStressGridStates(type.key);
      const cells = states.map((cell, index) => `
        <div class="hp-cell stress-cell ${stateClass(cell)}" data-stress-type="${type.key}" data-index="${index}"></div>
      `).join("");
      const controls = editMode ? `
        <div class="pc-hp-grid-popup-stepper pc-stress-grid-popup-stepper">
          <label>Boxes</label>
          <button type="button" class="stress-remove sheet-stepper-btn" data-stress-type="${type.key}" title="Remove ${this._escapeHtml(type.label)} stress box">&minus;</button>
          <span>${states.length}</span>
          <button type="button" class="stress-add sheet-stepper-btn" data-stress-type="${type.key}" title="Add ${this._escapeHtml(type.label)} stress box">+</button>
        </div>
      ` : `
        <button type="button" class="pc-portrait-hp-action pc-stress-grid-refresh" data-stress-type="${type.key}" title="Reset ${this._escapeHtml(type.label)} Stress" aria-label="Reset ${this._escapeHtml(type.label)} Stress">
          <i class="fas fa-sync-alt" aria-hidden="true"></i>
        </button>
      `;

      return `
        <section class="pc-stress-grid-pane${type.key === active ? " active" : ""}" data-stress-pane="${type.key}" role="tabpanel">
          <div class="pc-stress-grid-pane-header">
            <label class="stress-label">${this._escapeHtml(type.label)} Stress</label>
            <div class="pc-stress-grid-pane-controls">${controls}</div>
          </div>
          ${states.length ? `
            <div class="stress-grid pc-stress-grid-popup-grid" style="--col-count: ${Math.max(states.length, 1)};">
              ${cells}
            </div>
          ` : `<div class="pc-stress-grid-empty">No ${this._escapeHtml(type.label.toLowerCase())} stress boxes configured.</div>`}
        </section>
      `;
    }).join("");

    return `
      <div class="pc-stress-grid-tabs" role="tablist">${tabs}</div>
      <div class="pc-stress-grid-panes">${panes}</div>
      <p class="pc-hp-grid-popup-help">Left-click cycles stress damage. Right-click clears a cell.</p>
    `;
  }

  _renderStressGridDialogContent(activeType = "physical") {
    return `<div class="pc-hp-grid-dialog-content pc-stress-grid-dialog-content"><div class="pc-stress-grid-dialog-body">${this._renderStressGridDialogBody(activeType)}</div></div>`;
  }

  _refreshStressGridDialog(root, activeType = null) {
    const jq = root instanceof jQuery ? root : $(root);
    const active = this._normalizeStressType(activeType || this._stressGridDialogActive || jq.find(".pc-stress-grid-tab.active").data("stress-tab"));
    this._stressGridDialogActive = active;
    jq.find(".pc-stress-grid-dialog-body").html(this._renderStressGridDialogBody(active));
    this._bindStressGridDialog(jq);
  }

  async _setStressGridCell(stressType, index, value) {
    await this.actor.setPeasantStressCell?.(stressType, index, value);
  }

  async _setStressGridSize(stressType, count = 0) {
    await this.actor.setPeasantStressGridSize?.(stressType, count);
  }

  async _changeStressGridSize(stressType, delta = 0) {
    await this.actor.resizePeasantStressGrid?.(stressType, delta);
  }

  _bindStressGridDialog(root) {
    const jq = root instanceof jQuery ? root : $(root);

    jq.find(".pc-stress-grid-tab").off("click.pcStressGrid").on("click.pcStressGrid", (ev) => {
      ev.preventDefault();
      const active = this._normalizeStressType(ev.currentTarget?.dataset?.stressTab);
      this._stressGridDialogActive = active;
      jq.find(".pc-stress-grid-tab").removeClass("active").attr("aria-selected", "false");
      jq.find(`.pc-stress-grid-tab[data-stress-tab="${active}"]`).addClass("active").attr("aria-selected", "true");
      jq.find(".pc-stress-grid-pane").removeClass("active");
      jq.find(`.pc-stress-grid-pane[data-stress-pane="${active}"]`).addClass("active");
    });

    jq.find(".stress-add").off("click.pcStressGrid").on("click.pcStressGrid", async (ev) => {
      ev.preventDefault();
      const stressType = ev.currentTarget?.dataset?.stressType;
      await this._changeStressGridSize(stressType, 1);
      await this.render(false);
      this._refreshStressGridDialog(jq, stressType);
    });

    jq.find(".stress-remove").off("click.pcStressGrid").on("click.pcStressGrid", async (ev) => {
      ev.preventDefault();
      const stressType = ev.currentTarget?.dataset?.stressType;
      await this._changeStressGridSize(stressType, -1);
      await this.render(false);
      this._refreshStressGridDialog(jq, stressType);
    });

    jq.find(".stress-cell").off("click.pcStressGrid").on("click.pcStressGrid", async (ev) => {
      ev.preventDefault();
      const cell = ev.currentTarget;
      const stressType = cell?.dataset?.stressType;
      const index = Number.parseInt(cell?.dataset?.index, 10);
      if (!stressType || Number.isNaN(index)) return;
      const currentState = Number(this.actor?.system?.[`${stressType}${index}`]) || 0;
      await this._setStressGridCell(stressType, index, (currentState + 1) % 4);
      await this.render(false);
      this._refreshStressGridDialog(jq, stressType);
    });

    jq.find(".stress-cell").off("contextmenu.pcStressGrid").on("contextmenu.pcStressGrid", async (ev) => {
      ev.preventDefault();
      const cell = ev.currentTarget;
      const stressType = cell?.dataset?.stressType;
      const index = Number.parseInt(cell?.dataset?.index, 10);
      if (!stressType || Number.isNaN(index)) return;
      await this._setStressGridCell(stressType, index, 0);
      await this.render(false);
      this._refreshStressGridDialog(jq, stressType);
    });

    jq.find(".pc-stress-grid-refresh").off("click.pcStressGrid").on("click.pcStressGrid", async (ev) => {
      ev.preventDefault();
      const stressType = this._normalizeStressType(ev.currentTarget?.dataset?.stressType);
      await this.actor.refreshPeasantStressTrack?.(stressType);
      await this.render(false);
      this._refreshStressGridDialog(jq, stressType);
    });
  }

  _openStressGridDialog(activeType = "physical", trigger = null) {
    const active = this._normalizeStressType(activeType);
    this._stressGridDialogActive = active;
    const dialog = this._renderDialog({
      title: `${this.actor?.name || "Actor"} Stress Grids`,
      content: this._renderStressGridDialogContent(active),
      buttons: {},
      render: (html) => {
        html.addClass("pc-stress-grid-dialog-window");
        html.find(".dialog-buttons, .form-footer, footer").hide();
        this._bindStressGridDialog(html);
      }
    }, {
      classes: ["peasant-core", "pc-stress-grid-dialog"],
      position: this._getDialogPositionNearTrigger(trigger, 430, 260)
    });
    this._stressGridDialog = dialog;
    return dialog;
  }

  async _applyStressDamage(stressType, amount = 1) {
    await this.actor.applyPeasantStressDamage?.(stressType, amount);
  }

  async _applyStressHeal(stressType, amount = 1) {
    await this.actor.applyPeasantStressHeal?.(stressType, amount);
  }

  _getHeaderControls() {
    if (typeof super._getHeaderControls !== "function") {
      if (typeof super._getHeaderControls === "function") return super._getHeaderControls();
      return [];
    }

    const controls = Array.isArray(super._getHeaderControls()) ? super._getHeaderControls() : [];
    const canConfigure = game.user.isGM || this.actor.isOwner;
    if (canConfigure) {
      const hasRefreshResources = controls.some(control => String(control?.action || "").trim().toLowerCase() === "refreshresources");
      if (!hasRefreshResources) {
        controls.unshift({
          action: "refreshResources",
          icon: "fa-solid fa-rotate-right",
          label: "Refresh Resources"
        });
      }
    }

    // Foundry V13 compatibility can surface duplicate controls via mixed providers.
    // Keep first instance by visible label, then by action key for unlabeled entries.
    const seenLabels = new Set();
    const seenActions = new Set();
    const deduped = [];
    for (const control of controls) {
      if (!control || typeof control !== "object") continue;
      const labelKey = String(control.label ?? "").trim().toLowerCase();
      const actionKey = String(control.action ?? "").trim().toLowerCase();
      if (labelKey) {
        if (seenLabels.has(labelKey)) continue;
        seenLabels.add(labelKey);
      } else if (actionKey) {
        if (seenActions.has(actionKey)) continue;
        seenActions.add(actionKey);
      }
      deduped.push(control);
    }
    return deduped;
  }

  _renderModeToggle() {
    const header = this.element.querySelector(".window-header");
    ensureSlideToggleElement(header?.ownerDocument?.defaultView);
    const toggle = header.querySelector(".mode-slider");
    const positionToggle = (toggle) => {
      const controlsToggle = header.querySelector('.header-control[data-action="toggleControls"], [data-action="toggleControls"]');
      if (controlsToggle?.parentElement === header) controlsToggle.before(toggle);
      else header.prepend(toggle);
    };
    const syncToggleLabel = (toggle) => {
      const label = toggle.checked ? "Enter View Mode" : "Enter Edit Mode";
      toggle.dataset.tooltip = label;
      toggle.setAttribute("aria-label", label);
      toggle.title = label;
    };
    if (this.isEditable && !toggle) {
      const toggle = header.ownerDocument.createElement("slide-toggle");
      toggle.checked = this.isEditMode;
      toggle.classList.add("mode-slider");
      toggle.dataset.action = "changeMode";
      toggle.addEventListener("dblclick", event => event.stopPropagation());
      toggle.addEventListener("pointerdown", event => event.stopPropagation());
      syncToggleLabel(toggle);
      positionToggle(toggle);
    } else if (this.isEditable) {
      toggle.checked = this.isEditMode;
      syncToggleLabel(toggle);
      positionToggle(toggle);
    } else if (!this.isEditable && toggle) {
      toggle.remove();
    }
  }

  _getHeaderButtons() {
    const buttons = typeof super._getHeaderButtons === "function" ? super._getHeaderButtons() : [];

    // Legacy frame controls that are still independent of sheet mode.
    const canConfigure = game.user.isGM || this.actor.isOwner;
    if (canConfigure) {
      buttons.unshift({
        label: "Refresh Resources",
        class: "refresh-resources",
        icon: "fas fa-sync-alt",
        onclick: async () => {
          await confirmPeasantResourceRefresh(this);
        }
      });

    }

    return buttons;
  }

  async getData() {
    await this.constructor.preloadSheetPartials();

    // Start with original super data
    let data;
    try {
      if (typeof super.getData === "function") {
        data = await super.getData();
      } else {
        data = {
          actor: this.actor,
          editable: this.isEditable,
          owner: this.actor?.isOwner ?? false,
          options: this.options
        };
      }
      data.artPanelCollapsed = !!this.actor?.getFlag?.("peasant-core", PC_ART_PANEL_COLLAPSED_FLAG);
      data.editable = this.isEditable && this.isEditMode;
      data.peasantCoreSettingGroups = getPeasantCoreSettingGroups(this.actor, data.editable !== false);
      const bolsteredHpSafe = Math.max(0, Number(data?.actor?.system?.bolsteredHp) || 0);
      const runMultiplierRaw = Number(this.actor?.getFlag?.("peasant-core", PC_RUN_MULTIPLIER_FLAG));
      const runMultiplier = Number.isFinite(runMultiplierRaw) && runMultiplierRaw >= 1
        ? Math.floor(runMultiplierRaw)
        : PC_DEFAULT_RUN_MULTIPLIER;
      const sprintMultiplierRaw = Number(this.actor?.getFlag?.("peasant-core", PC_SPRINT_MULTIPLIER_FLAG));
      const sprintMultiplier = Number.isFinite(sprintMultiplierRaw) && sprintMultiplierRaw >= 1
        ? Math.floor(sprintMultiplierRaw)
        : PC_DEFAULT_SPRINT_MULTIPLIER;
      if (data?.actor?.system) {
        data.actor.system.bolsteredHp = bolsteredHpSafe;
        data.actor.system.haltValues = normalizeHaltSlashValue(data.actor.system.haltValues || "0/0/0/0");
        data.actor.system.naturalHaltValues = normalizeHaltSlashValue(data.actor.system.naturalHaltValues || "0/0/0/0");
        const rawCombatMods = data.actor.system.combatMods || {};
        const haltBuffs = sanitizeCombatHaltBuffs(rawCombatMods.haltBuffs);
        data.actor.system.combatMods = {
          ...rawCombatMods,
          toHit: Number(rawCombatMods.toHit) || 0,
          accuracy: Number(rawCombatMods.accuracy) || 0,
          diceRate: Number(rawCombatMods.diceRate) || 0,
          flatDamage: Number(rawCombatMods.flatDamage) || 0,
          costMod: Number(rawCombatMods.costMod) || 0,
          haltBuffs
        };
      }
      data.runMultiplier = runMultiplier;
      data.sprintMultiplier = sprintMultiplier;
      const portraitMovement = Math.max(0, Number(data?.actor?.system?.movement) || 0);
      const initiativeRaw = String(data?.actor?.system?.initiative ?? "").trim();
      const initiativeNumeric = Number(initiativeRaw);
      const initiativeDisplay = initiativeRaw === ""
        ? "+0"
        : Number.isFinite(initiativeNumeric)
          ? `${initiativeNumeric >= 0 ? "+" : ""}${initiativeNumeric}`
          : initiativeRaw;
      data.portraitStats = {
        movement: portraitMovement,
        run: portraitMovement * runMultiplier,
        sprint: portraitMovement * sprintMultiplier,
        initiative: initiativeDisplay
      };
      const combatHaltBuffRows = sanitizeCombatHaltBuffs(data?.actor?.system?.combatMods?.haltBuffs).map((buff, index) => {
        const type = sanitizeCombatHaltBuffType(buff.type);
        const row = {
          index,
          type,
          values: normalizeHaltSlashValue(buff.values),
          value: Number.parseInt(buff.value, 10) || 0,
          resourceType: sanitizeCombatCostResourceType(buff.resourceType),
          customName: String(buff.customName ?? "").trim(),
          isHaltLike: false,
          isFlat: false,
          isCustom: false,
          isCost: false,
          label: "HALT:"
        };

        if (type === COMBAT_HALT_BUFF_TYPE_NATURAL) {
          row.label = "Nat HALT:";
          row.isHaltLike = true;
        } else if (type === COMBAT_HALT_BUFF_TYPE_HALT) {
          row.label = "HALT:";
          row.isHaltLike = true;
        } else if (type === COMBAT_HALT_BUFF_TYPE_FLAT) {
          row.label = "Flat:";
          row.isFlat = true;
        } else if (type === COMBAT_HALT_BUFF_TYPE_COST) {
          row.label = "Cost:";
          row.isCost = true;
        } else if (type === COMBAT_HALT_BUFF_TYPE_CUSTOM) {
          row.label = row.customName || "Custom";
          row.isCustom = true;
        }

        return row;
      });
      data.combatHaltBuffRows = combatHaltBuffRows;
      const resolveCustomSelect = (baseValue, customValue) => {
        const normalizedBase = String(baseValue ?? "").trim();
        const isCustom = /^(custom|other)$/i.test(normalizedBase);
        const customText = String(customValue ?? "").trim();
        const display = isCustom ? (customText || "Custom") : normalizedBase;
        return { isCustom, display };
      };
      const raceSelection = resolveCustomSelect(this.actor?.system?.race, this.actor?.system?.customRace);
      const originSelection = resolveCustomSelect(this.actor?.system?.origin, this.actor?.system?.customOrigin);
      const specificOriginSelection = resolveCustomSelect(this.actor?.system?.specificOrigin, this.actor?.system?.customSpecificOrigin);
      data.customRaceSelected = raceSelection.isCustom;
      data.customOriginSelected = originSelection.isCustom;
      data.customSpecificOriginSelected = specificOriginSelection.isCustom;
      data.hasCustomIdentitySelection = !!this.isEditMode && (raceSelection.isCustom || originSelection.isCustom || specificOriginSelection.isCustom);
      data.displayRace = raceSelection.display || "Human";
      data.displayOrigin = originSelection.display || "Grimmstad";
      data.displaySpecificOrigin = specificOriginSelection.display || "Soldier";
      const defaultEdgeLabelMode = getDefaultEdgeLabelMode(this.actor);
      const edgeLabelMode = sanitizeEdgeLabelMode(this.actor?.system?.edgeLabelMode, defaultEdgeLabelMode);
      const edgeCustomLabel = String(this.actor?.system?.edgeCustomLabel ?? "");
      data.edgeLabelMode = edgeLabelMode;
      data.edgeLabelIsCustom = edgeLabelMode === EDGE_LABEL_MODE_CUSTOM;
      data.edgeCustomLabel = edgeCustomLabel;
      data.edgeDisplayLabel = resolveEdgeLabel(edgeLabelMode, edgeCustomLabel, defaultEdgeLabelMode);
      const edgeResourcesRaw = Array.isArray(this.actor?.system?.edgeResources) ? this.actor.system.edgeResources : [];
      data.edgeResources = edgeResourcesRaw.map((entry, index) => {
        const normalized = normalizeEdgeResourceEntry(entry, edgeLabelMode);
        return {
          ...normalized,
          index,
          isCustom: normalized.labelMode === EDGE_LABEL_MODE_CUSTOM,
          displayLabel: resolveEdgeLabel(normalized.labelMode, normalized.customLabel, edgeLabelMode)
        };
      });

      // BASIC ATTRIBUTES
      const build = this.actor.system.build || 0;
    const reflex = this.actor.system.reflex || 0;
    const intuition = this.actor.system.intuition || 0;
    const learn = this.actor.system.learn || 0;
    const charisma = this.actor.system.charisma || 0;

    // Blessing state (store on actor.system.blessing = { type: 'spring'|'summer'|'fall'|'winter' | null, target: 'build'|'reflex'|'intuition'|'learn'|'charisma' | null })
    const blessing = this.actor.system.blessing || { type: null, target: null };

    // Build a map of attribute numeric values
    const attrVals = { build, reflex, intuition, learn, charisma };

    // Get combat modifier for saves (to-hit mod affects saves too)
    const saveCombatMods = this.actor.system.combatMods || { toHit: 0, accuracy: 0, diceRate: 0, flatDamage: 0, costMod: 0 };
    const saveToHitMod = parseInt(saveCombatMods.toHit) || 0;
    const saveConfigModRaw = Number(this.actor?.getFlag?.("peasant-core", PC_SAVE_MODIFIER_FLAG));
    const saveConfigMod = Number.isFinite(saveConfigModRaw) ? Math.trunc(saveConfigModRaw) : 0;
    const totalSaveToHitMod = saveToHitMod + saveConfigMod;

    // Compute base Saves: default formula is 18 - (score * 2)
    const baseSaves = {};
    for (const [k, v] of Object.entries(attrVals)) {
      baseSaves[k] = 18 - (v * 2);
    }

    // Blessing of Spring: blessed attribute uses 16 - (score*2)
    if (blessing.type === 'spring' && blessing.target) {
      const t = blessing.target;
      if (baseSaves[t] !== undefined) baseSaves[t] = 16 - (attrVals[t] * 2);
    }

    // Blessing of Fall: blessed attribute save becomes the best (lowest numeric) of all other saves
    if (blessing.type === 'fall' && blessing.target) {
      const t = blessing.target;
      const otherSaves = Object.entries(baseSaves).filter(([k]) => k !== t).map(([, v]) => v);
      if (otherSaves.length > 0) baseSaves[t] = Math.min(...otherSaves);
    }

    // Apply to-hit modifier to saves
    const modifiedSaves = {};
    for (const [k, v] of Object.entries(baseSaves)) {
      const saveCalc = applyToHitFloor(v, totalSaveToHitMod, 2);
      modifiedSaves[k] = saveCalc.toHit;
    }

    // Build save strings with modified values
    const buildSaveStr = `${modifiedSaves.build}+`;
    const reflexSaveStr = `${modifiedSaves.reflex}+`;
    const intuitionSaveStr = `${modifiedSaves.intuition}+`;
    const learnSaveStr = `${modifiedSaves.learn}+`;
    const charismaSaveStr = `${modifiedSaves.charisma}+`;
    const reflexAoeSaveEnabled = !!this.actor.system.reflexAoeSaveEnabled;
    const reflexAoeSaveTargetRaw = String(this.actor.system.reflexAoeSaveTarget ?? "").trim();
    const reflexAoeParsed = Number.parseInt(reflexAoeSaveTargetRaw, 10);
    const reflexAoeSaveTn = Number.isFinite(reflexAoeParsed) ? Math.max(2, reflexAoeParsed) : null;

    // Characteristic To-Hit calculations
    // Default: Str: 18 - BLD - REF
    //          Dex: 18 - REF - INT
    //          Mnt: 18 - INT - LRN
    //          Soc: 18 - INT - CHA
    // Blessing of Summer: To-Hit becomes 22 - (normal components) - blessedAttributeScore
    const isSummer = blessing.type === 'summer' && blessing.target;
    const blessedValue = isSummer ? (attrVals[blessing.target] || 0) : 0;

    const strToHitNumBase = isSummer ? (22 - build - reflex - blessedValue) : (18 - build - reflex);
    const dexToHitNumBase = isSummer ? (22 - reflex - intuition - blessedValue) : (18 - reflex - intuition);
    const mntToHitNumBase = isSummer ? (22 - intuition - learn - blessedValue) : (18 - intuition - learn);
    const socToHitNumBase = isSummer ? (22 - intuition - charisma - blessedValue) : (18 - intuition - charisma);

    // Apply an optional -1 to-hit penalty for a selected characteristic (stored at actor.system.toHitPenaltyTarget)
    const toHitPenaltyTarget = this.actor.system.toHitPenaltyTarget || "";
    const strToHitNumPenalized = (toHitPenaltyTarget === 'Strength') ? (strToHitNumBase - 1) : strToHitNumBase;
    const dexToHitNumPenalized = (toHitPenaltyTarget === 'Dexterity') ? (dexToHitNumBase - 1) : dexToHitNumBase;
    const mntToHitNumPenalized = (toHitPenaltyTarget === 'Mental') ? (mntToHitNumBase - 1) : mntToHitNumBase;
    const socToHitNumPenalized = (toHitPenaltyTarget === 'Social') ? (socToHitNumBase - 1) : socToHitNumBase;

    // Apply combat modifier to attribute to-hits
    const attrCombatMods = this.actor.system.combatMods || { toHit: 0, accuracy: 0, diceRate: 0, flatDamage: 0 };
    const attrToHitMod = parseInt(attrCombatMods.toHit) || 0;
    const strToHitNum = applyToHitFloor(strToHitNumPenalized, attrToHitMod, 2).toHit;
    const dexToHitNum = applyToHitFloor(dexToHitNumPenalized, attrToHitMod, 2).toHit;
    const mntToHitNum = applyToHitFloor(mntToHitNumPenalized, attrToHitMod, 2).toHit;
    const socToHitNum = applyToHitFloor(socToHitNumPenalized, attrToHitMod, 2).toHit;

    

    // Push attributes into data for template
    data.attributes = {
      buildSave: buildSaveStr,
      reflexSave: reflexSaveStr,
      intuitionSave: intuitionSaveStr,
      learnSave: learnSaveStr,
      charismaSave: charismaSaveStr,
      strToHit: `${strToHitNum}+`,
      dexToHit: `${dexToHitNum}+`,
      mntToHit: `${mntToHitNum}+`,
      socToHit: `${socToHitNum}+`
    };
    data.reflexAoeSaveEnabled = reflexAoeSaveEnabled;
    data.reflexAoeSaveTarget = reflexAoeSaveTargetRaw;
    data.reflexAoeSaveTn = reflexAoeSaveEnabled && Number.isFinite(reflexAoeSaveTn) ? reflexAoeSaveTn : null;
    data.reflexAoeSaveDisplay = reflexAoeSaveEnabled && Number.isFinite(reflexAoeSaveTn) ? `${reflexAoeSaveTn}+` : "";

    // --- Continue populating the rest of data exactly like before ---
    // Build stress arrays from individual fields for template
    const physicalCountRaw = Number(this.actor.system.physicalStressCount);
    const mentalCountRaw = Number(this.actor.system.mentalStressCount);
    const generalCountRaw = Number(this.actor.system.generalStressCount);
    const physicalCount = Number.isFinite(physicalCountRaw) ? Math.max(0, Math.floor(physicalCountRaw)) : 4;
    const mentalCount = Number.isFinite(mentalCountRaw) ? Math.max(0, Math.floor(mentalCountRaw)) : 4;
    const generalCount = Number.isFinite(generalCountRaw) ? Math.max(0, Math.floor(generalCountRaw)) : 8;

    data.stress = {
      physical: [],
      mental: [],
      general: []
    };

    for (let i = 0; i < physicalCount; i++) {
      data.stress.physical.push(this.actor.system[`physical${i}`] || 0);
    }

    for (let i = 0; i < mentalCount; i++) {
      data.stress.mental.push(this.actor.system[`mental${i}`] || 0);
    }

    for (let i = 0; i < generalCount; i++) {
      data.stress.general.push(this.actor.system[`general${i}`] || 0);
    }

    const showZeroStressBars = !!this.isEditMode;
    const buildStressBar = (cells = []) => {
      const count = cells.length;
      const totalSeverity = cells.reduce((sum, value) => {
        const numeric = Math.max(0, Math.min(3, Number(value) || 0));
        return sum + numeric;
      }, 0);
      const sectionValue = (offset) => Math.max(0, Math.min(count, totalSeverity - offset));
      const sectionPct = (value) => count > 0 ? Math.round((value / count) * 1000) / 10 : 0;
      const segments = [
        { key: "blunt", label: "Blunt", value: sectionValue(0), max: count },
        { key: "lethal", label: "Lethal", value: sectionValue(count), max: count },
        { key: "critical", label: "Critical", value: sectionValue(count * 2), max: count }
      ];
      for (const segment of segments) segment.fillPct = sectionPct(segment.value);
      return { count, totalSeverity, maxSeverity: count * 3, segments, show: showZeroStressBars || count > 0 };
    };

    const physicalStressBar = buildStressBar(data.stress.physical);
    const mentalStressBar = buildStressBar(data.stress.mental);
    const generalStressBar = buildStressBar(data.stress.general);
    data.stressBars = {
      physical: physicalStressBar,
      mental: mentalStressBar,
      general: generalStressBar,
      firstRowVisible: physicalStressBar.show || mentalStressBar.show,
      firstRowSingle: physicalStressBar.show !== mentalStressBar.show,
      anyVisible: physicalStressBar.show || mentalStressBar.show || generalStressBar.show
    };

    // Ensure portrait offsets are valid for current scale
    const scale = Math.max(1.0, this.actor.system.portraitScale || 1);
    if (scale <= 1.0) {
      data.actor.system.portraitOffsetX = 0;
      data.actor.system.portraitOffsetY = 0;
    }

    // Pass skills array to template with derived values (original logic preserved)
      // Use authoritative actor data for skills to avoid render/update alternating
      const sourceSkills = (this.actor.system.skills || []);
      // Get combat modifiers for skills display
      const skillCombatMods = this.actor.system.combatMods || { toHit: 0, accuracy: 0, diceRate: 0, flatDamage: 0 };
      const skillToHitMod = parseInt(skillCombatMods.toHit) || 0;
      const skillAccuracyMod = parseInt(skillCombatMods.accuracy) || 0;
      
      try { pcLog.debug('PeasantActorSheet.getData: using actor.skills', sourceSkills.map(s => ({ name: s.name, sig: !!s.sig }))); } catch (e) {}
      data.skills = (sourceSkills || []).map(skill => {
      const baseAccuracy = parseInt(skill.accuracy) || 0;
      const baseTohit = Number.isFinite(parseInt(skill.tohit)) ? parseInt(skill.tohit) : 7;
      const skillCalc = applyToHitAccuracy(baseTohit, baseAccuracy, skillToHitMod, skillAccuracyMod, 2);
      const accuracyNum = skillCalc.accuracy;
      const modifiedTohit = skillCalc.toHit;
      const isStandard = !skill.type || skill.type === "standard";
      const skillType = String(skill.type || '').trim();
      const skillTypeKey = skillType.toLowerCase();
      const noToHitTypes = new Set(['stance', 'perk', 'style', 'cantrip', 'tm']);
      const allowToHitAcc = isStandard || !noToHitTypes.has(skillTypeKey);
      let isDisplayable = false;
      const specialGradeRaw = parseInt(skill.specialGrade);
      const specialGrade = Number.isFinite(specialGradeRaw) ? Math.max(0, specialGradeRaw) : 0;
      const hasSpecialGrade = Number.isFinite(specialGradeRaw) && specialGrade > 0;

      // Check if rank is 'u' or 'U' (untrained) or a valid number (0-4)
      const rankStr = String(skill.rank ?? '').trim().toLowerCase();
      const isUntrainedRank = (rankStr === 'u');
      const hasValidRank = isUntrainedRank || skill.rank === 0 || Number.isFinite(parseInt(skill.rank));

      if (isStandard) {
        isDisplayable = skill.class && hasValidRank && skill.name && skill.tohit;
      } else {
        isDisplayable = skill.name;
      }

      // Check if description has actual content (not just empty HTML tags)
      const descriptionRaw = skill.description || '';
      const descriptionText = descriptionRaw.replace(/<[^>]*>/g, '').trim();
      const hasDescription = descriptionText.length > 0;

      // Build classRankDisplay: handle 'u'/'U' rank for untrained
      let classRankDisplay = undefined;
      if (isStandard) {
        const rankDisplay = isUntrainedRank ? 'U' : (hasValidRank ? `R${skill.rank}` : '');
        classRankDisplay = `C${skill.class}${rankDisplay}`;
      }
      let specialTypeDisplay = skill.type || '';
      if (!isStandard) {
        if (skillTypeKey === 'tm' || skillTypeKey === 'perk') {
          specialTypeDisplay = hasSpecialGrade ? `Grade ${specialGrade} ${skillType}` : (skill.type || '');
        } else if (skillTypeKey === 'spellcraft' || skillTypeKey === 'gate') {
          specialTypeDisplay = hasSpecialGrade ? `C${specialGrade}` : 'C';
        }
      }

      return {
        ...skill,
        isStandard,
        allowToHitAcc,
        // Compute a display string for class/rank (SIG shown separately in template)
        classRankDisplay,
        specialTypeDisplay,
        specialGrade,
        specialGradeInput: hasSpecialGrade ? specialGrade : '',
        accuracy: skill.accuracy || "",
        accuracyNum,
        hasToHit: allowToHitAcc && !!skill.tohit,
        modifiedTohit,
        hasAccuracy: allowToHitAcc && (accuracyNum !== 0 || baseAccuracy !== 0),
        accuracySign: accuracyNum >= 0 ? '+' : '',
        ap: skill.ap || "",
        usesMax: skill.usesMax || 0,
        usesCurrent: skill.usesCurrent || 0,
        sp: skill.sp || "",
        hasAp: !!skill.ap,
        hasSp: !!skill.sp,
        hasDescription,
        isDisplayable,
        isUntrainedRank
      };
    });

    // Enrich Inventory HTML for View Mode - use namespaced API (Foundry v13+)
    const TextEditorImpl = TextEditorImplementation;
    data.inventoryHTML = await TextEditorImpl.enrichHTML(this.actor.system.inventory, { async: true });
    const biographyRaw = String(this.actor.system.biography ?? "");
    data.hasBiographyText = biographyRaw.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim().length > 0;
    data.biographyHTML = data.hasBiographyText
      ? await TextEditorImpl.enrichHTML(this.actor.system.biography, { async: true })
      : "";

    // Pass flexible advantages to template (name + description)
    const advantageNamesRaw = Array.isArray(this.actor.system.flexibleAdvantages) ? this.actor.system.flexibleAdvantages : [];
    const advantageDescriptionsRaw = Array.isArray(this.actor.system.flexibleAdvantageDescriptions) ? this.actor.system.flexibleAdvantageDescriptions : [];
    data.flexibleAdvantages = advantageNamesRaw.map((advantage, index) => {
      const name = (typeof advantage === 'string')
        ? advantage
        : String(advantage?.name ?? '');
      const description = String(advantageDescriptionsRaw[index] ?? (advantage?.description ?? ''));
      const descriptionText = description.replace(/<[^>]*>/g, '').trim();
      return {
        name,
        description,
        hasDescription: descriptionText.length > 0,
        index
      };
    });

    // Pass notable combats array to template with derived values (similar to skills)
    const sourceNotableCombats = (this.actor.system.notableCombats || []);
    // Get combat modifiers
    const combatMods = this.actor.system.combatMods || { toHit: 0, accuracy: 0, diceRate: 0, flatDamage: 0, costMod: 0 };
    const toHitMod = parseInt(combatMods.toHit) || 0;
    const accuracyMod = parseInt(combatMods.accuracy) || 0;
    const diceRateMod = parseInt(combatMods.diceRate) || 0;
    const flatDamageMod = getCombatFlatDamageModifier(combatMods);
    const costModifiersByType = getCombatCostModifiers(combatMods);
    
    data.notableCombats = (sourceNotableCombats || []).map(combat => {
      const baseAccuracy = parseInt(combat.accuracy) || 0;
      const baseTohit = Number.isFinite(parseInt(combat.tohit)) ? parseInt(combat.tohit) : 7;
      const combatCalc = applyToHitAccuracy(baseTohit, baseAccuracy, toHitMod, accuracyMod, 2);
      const accuracyNum = combatCalc.accuracy;
      const modifiedTohit = combatCalc.toHit;
      const isStandard = !combat.type || combat.type === "standard";
      const combatType = String(combat.type || '').trim();
      const combatTypeKey = combatType.toLowerCase();
      const noToHitTypes = new Set(['stance', 'perk', 'style', 'cantrip', 'tm']);
      const allowToHitAcc = isStandard || !noToHitTypes.has(combatTypeKey);
      let isDisplayable = false;
      const specialGradeRaw = parseInt(combat.specialGrade);
      const specialGrade = Number.isFinite(specialGradeRaw) ? Math.max(0, specialGradeRaw) : 0;
      const hasSpecialGrade = Number.isFinite(specialGradeRaw) && specialGrade > 0;

      // Check if rank is 'u' or 'U' (untrained) or a valid number (0-4)
      const rankStr = String(combat.rank ?? '').trim().toLowerCase();
      const isUntrainedRank = (rankStr === 'u');
      const hasValidRank = isUntrainedRank || combat.rank === 0 || Number.isFinite(parseInt(combat.rank));

      if (isStandard) {
        isDisplayable = combat.class && hasValidRank && combat.name && combat.tohit;
      } else {
        isDisplayable = combat.name;
      }

      // Check if description has actual content (not just empty HTML tags)
      const descriptionRaw = combat.description || '';
      const descriptionText = descriptionRaw.replace(/<[^>]*>/g, '').trim();
      const hasDescription = descriptionText.length > 0;

      // Build classRankDisplay: handle 'u'/'U' rank for untrained
      let classRankDisplay = undefined;
      if (isStandard) {
        const rankDisplay = isUntrainedRank ? 'U' : (hasValidRank ? `R${combat.rank}` : '');
        classRankDisplay = `C${combat.class}${rankDisplay}`;
      }
      let specialTypeDisplay = combat.type || '';
      if (!isStandard) {
        if (combatTypeKey === 'tm' || combatTypeKey === 'perk') {
          specialTypeDisplay = hasSpecialGrade ? `Grade ${specialGrade} ${combatType}` : (combat.type || '');
        } else if (combatTypeKey === 'spellcraft' || combatTypeKey === 'gate') {
          specialTypeDisplay = hasSpecialGrade ? `C${specialGrade}` : 'C';
        }
      }

      // Tag display values - check for > 0 since we use 0 as "not set"
      // Legacy staminaCost/attunementCost support + new resourceCosts
      const hasStaminaCost = combat.staminaCost > 0;
      const hasAttunementCost = combat.attunementCost > 0;
      const hasResourceCosts = Array.isArray(combat.resourceCosts)
        && combat.resourceCosts.length > 0
        && combat.resourceCosts.some(rc => {
          const baseValue = Number.parseInt(rc?.value, 10) || 0;
          return !!rc?.type && baseValue > 0;
        });
      
      // Build resource costs display with cost modifier applied
      let resourceCostsDisplay = '';
      const resourceCostsList = [];
      if (hasResourceCosts) {
        for (const rc of combat.resourceCosts) {
          const baseValue = Number.parseInt(rc?.value, 10) || 0;
          if (!rc?.type || baseValue <= 0) continue;
          const rcType = sanitizeCombatCostResourceType(rc.type);
          let label = rcType;
          if (rcType === 'HP' && rc.damageType) {
            label = `${rc.damageType} HP`;
          }
          // Apply per-resource cost modifier (minimum 0)
          const modifiedValue = Math.max(0, baseValue + (costModifiersByType[rcType] || 0));
          resourceCostsList.push({
            type: rcType,
            value: modifiedValue,
            baseValue,
            damageType: rc.damageType || '',
            label
          });
        }
        resourceCostsDisplay = resourceCostsList.map(rc => `${rc.label} ${rc.value}`).join(', ');
      }
      
      // Speed tag
      const hasSpeed = combat.speed && combat.speed.type;
      const isSplitSecond = hasSpeed && combat.speed.type === 'Split Second';
      let speedDisplay = '';
      if (hasSpeed) {
        speedDisplay = combat.speed.type;
      }
      
      const hasRange = combat.range > 0;
      const hasRangeRate = !!combat.rangeRate && combat.rangeRate !== '///';
      
      // Damage display - apply die-rate progression and flat damage mods
      const hasDamage = hasCombatDice(combat.damage);
      let damageDisplay = '';
      let modifiedDamageDice = 0;
      let modifiedDamageValue = 0;
      let modifiedDamageFlat = 0;
      if (hasDamage) {
        const damageResult = applyDieRate(
          combat.damage.diceCount,
          combat.damage.diceValue,
          combat.damage.flat || 0,
          diceRateMod,
          combat.damage.diceBonus || 0
        );
        modifiedDamageDice = damageResult.diceCount;
        modifiedDamageValue = damageResult.diceValue;
        modifiedDamageFlat = damageResult.flat + flatDamageMod;
        damageDisplay = `${modifiedDamageDice}d${modifiedDamageValue}`;
        if (modifiedDamageFlat !== 0) {
          damageDisplay += modifiedDamageFlat > 0 ? `+${modifiedDamageFlat}` : `${modifiedDamageFlat}`;
        }
        if (combat.damage.type) damageDisplay += ` ${combat.damage.type}`;
      }
      
      // Heal display - apply die-rate progression and flat mods
      const hasHeal = hasCombatDice(combat.heal);
      let healDisplay = '';
      let modifiedHealDice = 0;
      let modifiedHealValue = 0;
      let modifiedHealFlat = 0;
      if (hasHeal) {
        const healResult = applyDieRate(
          combat.heal.diceCount,
          combat.heal.diceValue,
          combat.heal.flat || 0,
          diceRateMod,
          combat.heal.diceBonus || 0
        );
        modifiedHealDice = healResult.diceCount;
        modifiedHealValue = healResult.diceValue;
        modifiedHealFlat = healResult.flat + flatDamageMod;
        healDisplay = `${modifiedHealDice}d${modifiedHealValue}`;
        if (modifiedHealFlat !== 0) {
          healDisplay += modifiedHealFlat > 0 ? `+${modifiedHealFlat}` : `${modifiedHealFlat}`;
        }
        if (combat.heal.type) healDisplay += ` ${combat.heal.type}`;
      }
      
      // Manifest display - apply die-rate progression and flat mods
      const hasManifest = hasCombatDice(combat.manifest);
      let manifestDisplay = '';
      let modifiedManifestDice = 0;
      let modifiedManifestValue = 0;
      let modifiedManifestFlat = 0;
      if (hasManifest) {
        const manifestResult = applyDieRate(
          combat.manifest.diceCount,
          combat.manifest.diceValue,
          combat.manifest.flat || 0,
          diceRateMod,
          combat.manifest.diceBonus || 0
        );
        modifiedManifestDice = manifestResult.diceCount;
        modifiedManifestValue = manifestResult.diceValue;
        modifiedManifestFlat = manifestResult.flat + flatDamageMod;
        manifestDisplay = `${modifiedManifestDice}d${modifiedManifestValue}`;
        if (modifiedManifestFlat !== 0) {
          manifestDisplay += modifiedManifestFlat > 0 ? `+${modifiedManifestFlat}` : `${modifiedManifestFlat}`;
        }
      }
      
      // Tag Uses display
      const hasTagUses = combat.tagUses && combat.tagUses.max > 0;
      
      // Sections display
      const hasSections = combat.sections && combat.sections.max > 0;
      
      // AoE display
      const hasAoe = combat.aoe && combat.aoe.value > 0;
      let aoeDisplay = '';
      if (hasAoe) {
        aoeDisplay = `${combat.aoe.value}`;
        if (combat.aoe.type && combat.aoe.type !== 'Area') {
          aoeDisplay += ` ${combat.aoe.type}`;
        }
      }
      
      // Targeting type
      const hasTargetingType = !!combat.targetingType;

      // Defense
      const defenseData = normalizeCombatDefense(combat.defense);
      const defenseSummary = getCombatDefenseSummary(defenseData);
      const hasDefense = defenseData.responses.length > 0;
      
      // Reach
      const hasReach = combat.reach > 0;

      // Stability
      const hasStability = !!combat.stability;

      // Strengthen
      const hasStrengthen = !!combat.stability && !!combat.strengthen;

      // Custom tags (supports multiple tags with legacy customTag fallback)
      const customTags = getCombatCustomTags(combat);
      const hasCustom = customTags.length > 0;
      
      // Build ordered tags array based on tagOrder or default order
      // This is the canonical order for view mode tags (excludes 'description' which is shown as tooltip)
      // Get saved tagOrder - check if it's a non-empty array with valid tag types
      const rawTagOrder = Array.isArray(combat.tagOrder) ? combat.tagOrder : [];
      const hasCustomOrder = rawTagOrder.length > 0;
      
      // Filter to only view-mode tag types (exclude 'description' and legacy tags)
      let tagOrder = hasCustomOrder 
        ? rawTagOrder.filter(t => COMBAT_VIEW_TAG_TYPES.includes(t))
        : [...COMBAT_VIEW_TAG_TYPES];
      
      // Ensure all view tag types are in the order (handles newly added tags)
      for (const tagType of COMBAT_VIEW_TAG_TYPES) {
        if (!tagOrder.includes(tagType)) {
          tagOrder.push(tagType);
        }
      }
      
      // Build active tags list with their data
      const activeTags = [];
      const tagData = {
        resourceCosts: { has: hasResourceCosts, label: 'Cost', value: resourceCostsDisplay, costsList: resourceCostsList },
        speed: { has: hasSpeed, label: 'Speed', value: speedDisplay, isSplitSecond, splitSecondCurrent: combat.speed?.splitSecondCurrent || 0, splitSecondMax: combat.speed?.splitSecondMax || 0 },
        range: { has: hasRange, label: 'Range', value: combat.range },
        rangeRate: { has: hasRangeRate, label: 'Range-Rate', value: combat.rangeRate },
        damage: { has: hasDamage, label: 'Damage', value: damageDisplay, rollable: true },
        heal: { has: hasHeal, label: 'Heal', value: healDisplay, rollable: true },
        manifest: { has: hasManifest, label: 'Manifest', value: manifestDisplay, rollable: true },
        tagUses: { has: hasTagUses, label: 'Uses', current: combat.tagUses?.current || 0, max: combat.tagUses?.max || 0, isUses: true },
        sections: { has: hasSections, label: 'Sections', current: combat.sections?.current || 0, max: combat.sections?.max || 0, isSections: true },
        aoe: { has: hasAoe, label: 'AoE', value: aoeDisplay },
        targetingType: { has: hasTargetingType, label: '', value: combat.targetingType },
        defense: { has: hasDefense, label: 'Defense', value: defenseSummary },
        reach: { has: hasReach, label: 'Reach', value: combat.reach },
        stability: { has: hasStability, label: 'Stability', value: '' },
        strengthen: { has: hasStrengthen, label: 'Strengthen', value: '' },
        custom: { has: hasCustom, tags: customTags },
        self: { has: combat.self, label: 'Self', value: '' }
      };
      
      // Build ordered active tags - iterate through tagOrder and add active ones
      for (const tagType of tagOrder) {
        if (!tagData[tagType] || !tagData[tagType].has) continue;
        if (tagType === 'custom') {
          const tags = Array.isArray(tagData.custom?.tags) ? tagData.custom.tags : [];
          tags.forEach((tag, customIndex) => {
            activeTags.push({
              type: 'custom',
              customIndex,
              label: tag.name,
              value: tag.value || ''
            });
          });
        } else {
          activeTags.push({ type: tagType, ...tagData[tagType] });
        }
      }


      return {
        ...combat,
        isStandard,
        allowToHitAcc,
        classRankDisplay,
        specialTypeDisplay,
        specialGrade,
        specialGradeInput: hasSpecialGrade ? specialGrade : '',
        accuracy: combat.accuracy || "",
        accuracyNum,
        hasToHit: allowToHitAcc && !!combat.tohit,
        hasAccuracy: allowToHitAcc && (accuracyNum !== 0 || baseAccuracy !== 0),
        accuracySign: accuracyNum >= 0 ? '+' : '',
        // Modified values for display (with mods applied)
        modifiedTohit,
        hasToHitMod: toHitMod !== 0,
        hasAccuracyMod: accuracyMod !== 0,
        hasDiceRateMod: diceRateMod !== 0,
        hasFlatDamageMod: flatDamageMod !== 0,
        // Modified dice/flat values for tag rolls
        modifiedDamageDice,
        modifiedDamageValue,
        modifiedDamageFlat,
        modifiedHealDice,
        modifiedHealValue,
        modifiedHealFlat,
        modifiedManifestDice,
        modifiedManifestValue,
        modifiedManifestFlat,
        usesMax: combat.usesMax || 0,
        usesCurrent: combat.usesCurrent || 0,
        hasDescription,
        isDisplayable,
        isUntrainedRank,
        // Tag flags and display values
        hasStaminaCost,
        hasAttunementCost,
        hasRange,
        hasRangeRate,
        hasDamage,
        damageDisplay,
        hasHeal,
        healDisplay,
        hasManifest,
        manifestDisplay,
        hasTagUses,
        hasSections,
        hasAoe,
        aoeDisplay,
        hasTargetingType,
        hasDefense,
        defenseData,
        defenseSummary,
        hasStability,
        hasStrengthen,
        // New tag fields
        hasResourceCosts,
        resourceCostsDisplay,
        resourceCostsList,
        hasSpeed,
        speedDisplay,
        isSplitSecond,
        // Ordered tags for rendering
        activeTags,
        customTags,
        tagOrder: combat.tagOrder || [],
        // Combined flag for whether any tags exist
        hasTags: hasResourceCosts || hasSpeed || hasRange || hasRangeRate || hasDamage || hasHeal || hasManifest || hasTagUses || hasSections || hasAoe || hasTargetingType || hasDefense || hasReach || hasStability || hasStrengthen || hasCustom || combat.self
      };
    });

    // Pass inventory HTML content
    data.inventory = this.actor.system.inventory || "";
    data.biography = this.actor.system.biography || "";

    data.simplifiedHp = isSimplifiedHpActor(this.actor);
    data.bolsteredHpMax = getActorBolsteredMax(this.actor);

    if (data.simplifiedHp) {
      const maxHealth = getActorHealthMax(this.actor);
      const currentHealthRaw = Number(this.actor.system?.health?.value);
      const currentHealth = Number.isFinite(currentHealthRaw)
        ? Math.max(0, Math.min(currentHealthRaw, maxHealth))
        : maxHealth;
      data.actor.system.health = { ...(data.actor.system.health || {}), value: currentHealth, max: maxHealth };
      data.hpWithLabels = [];
      data.woundThresholds = "";
      data.woundThresholdsReduced = false;
      data.isWounded = false;
      data.activeConditions = [];
      data.hasConditions = false;
    } else {
      // HP Grid with Labels preparation (structured for clickable TN)
      const hpLabelData = [
        { value: 3, text: "Good" },
        { value: 5, text: "Fair" },
        { value: 7, text: "Poor" },
        { value: 10, text: "Terrible" },
        { value: 11, text: "Critical" }
      ];
      const hpGrid = this.actor.system?.hp?.grid || [];
      const hpCols = Number(this.actor.system?.hp?.cols) || 0;
      data.hpWithLabels = hpGrid.map((row, index) => {
        return {
          cells: row,
          label: hpLabelData[index] || { value: null, text: "" }
        };
      });

      // Calculate wound thresholds using per-actor multipliers from Peasant Core sheet config.
      const isWounded = this.actor.system.conditions?.wounded || false;
      const woundMult = getWoundThresholdMultipliers(this.actor);
      
      // Keep legacy "reduced thresholds when wounded" behavior, but derive from configured multipliers.
      const headThreshold = hpCols * woundMult.head;
      const armsThreshold = hpCols * woundMult.arms;
      const legsThreshold = hpCols * woundMult.legs;
      const torsoThreshold = hpCols * woundMult.torso;

      if (isWounded) {
        const reducedArms = headThreshold;
        const reducedLegs = legsThreshold;
        const reducedTorso = hpCols * Math.max(woundMult.head, woundMult.torso - 1);
        data.woundThresholds = [
          formatThresholdValue(headThreshold),
          formatThresholdValue(reducedArms),
          formatThresholdValue(reducedLegs),
          formatThresholdValue(reducedTorso)
        ].join("/");
        data.woundThresholdsReduced = true;
      } else {
        data.woundThresholds = [
          formatThresholdValue(headThreshold),
          formatThresholdValue(armsThreshold),
          formatThresholdValue(legsThreshold),
          formatThresholdValue(torsoThreshold)
        ].join("/");
        data.woundThresholdsReduced = false;
      }
      data.isWounded = isWounded;
    }

    const healthMaxForBar = Math.max(0, Number(data.actor.system?.health?.max) || getActorHealthMax(this.actor));
    const healthValueForBar = Math.max(0, Math.min(Number(data.actor.system?.health?.value) || 0, healthMaxForBar));
    const tempHpValueForBar = Math.max(0, Number(data.actor.system?.temporaryHp?.value) || 0);
    const tempHpMaxForBar = Math.max(0, Number(data.actor.system?.temporaryHp?.max) || 0, tempHpValueForBar);
    const bolsteredHpValueForBar = Math.max(0, Number(data.actor.system?.bolsteredHp) || 0);
    const bolsteredHpMaxForBar = Math.max(0, Number(data.bolsteredHpMax) || getActorBolsteredMax(this.actor));
    const pct = (value, max) => {
      if (!Number.isFinite(max) || max <= 0) return 0;
      return Math.max(0, Math.min(100, Math.round((value / max) * 1000) / 10));
    };
    data.hpBar = {
      healthValue: healthValueForBar,
      healthMax: healthMaxForBar,
      healthPct: pct(healthValueForBar, healthMaxForBar),
      tempValue: tempHpValueForBar,
      tempMax: tempHpMaxForBar,
      tempPct: pct(tempHpValueForBar, tempHpMaxForBar),
      bolsteredValue: bolsteredHpValueForBar,
      bolsteredMax: bolsteredHpMaxForBar,
      bolsteredPct: pct(bolsteredHpValueForBar, bolsteredHpMaxForBar)
    };

    const apMaxForBar = Math.max(0, Number(data.actor.system?.ap?.max) || 0);
    const apValueForBar = Math.max(0, Math.min(Number(data.actor.system?.ap?.value) || 0, apMaxForBar));
    data.apBar = {
      value: apValueForBar,
      max: apMaxForBar,
      pct: pct(apValueForBar, apMaxForBar)
    };

    const showZeroResourceBars = !!this.isEditMode;
    const buildResourceBar = (key, label) => {
      const max = Math.max(0, Number(data.actor.system?.[key]?.max) || 0);
      const value = Math.max(0, Math.min(Number(data.actor.system?.[key]?.value) || 0, max));
      return { key, label, value, max, pct: pct(value, max), show: showZeroResourceBars || max > 0 };
    };
    const staminaBar = buildResourceBar("stamina", "Stamina");
    const attunementBar = buildResourceBar("attunement", "Attunement");
    const capacityBar = buildResourceBar("capacity", "Capacity");
    const edgeBar = buildResourceBar("edge", "Edge");
    data.resourceBars = {
      stamina: staminaBar,
      attunement: attunementBar,
      capacity: capacityBar,
      edge: edgeBar,
      firstRowVisible: staminaBar.show || attunementBar.show,
      firstRowSingle: staminaBar.show !== attunementBar.show,
      secondRowVisible: capacityBar.show || edgeBar.show,
      secondRowSingle: capacityBar.show !== edgeBar.show,
      anyVisible: staminaBar.show || attunementBar.show || capacityBar.show || edgeBar.show
    };

    // Parse HALT values for display (includes notable-combat HALT/Nat HALT buffs)
    const haltParts = parseHaltSlashValues(this.actor.system.haltValues || "0/0/0/0");
    const hardLocations = [
      this.actor.system.hardHead,
      this.actor.system.hardArms,
      this.actor.system.hardLegs,
      this.actor.system.hardTorso
    ];
    const combatHaltTotals = getCombatHaltBuffTotals(this.actor.system?.combatMods?.haltBuffs);
    const armorHaltBuffs = combatHaltTotals[COMBAT_HALT_BUFF_TYPE_HALT] || [0, 0, 0, 0];

    data.haltDisplay = haltParts.map((val, index) => {
      return {
        value: String((Number.parseInt(val, 10) || 0) + (armorHaltBuffs[index] || 0)),
        isHard: hardLocations[index] || false
      };
    });

    // Parse Natural HALT values for display (includes notable-combat Nat HALT buffs)
    const naturalHaltParts = parseHaltSlashValues(this.actor.system.naturalHaltValues || "0/0/0/0");

    const naturalHardLocations = [
      this.actor.system.naturalHardHead,
      this.actor.system.naturalHardArms,
      this.actor.system.naturalHardLegs,
      this.actor.system.naturalHardTorso
    ];
    const naturalHaltBuffs = combatHaltTotals[COMBAT_HALT_BUFF_TYPE_NATURAL] || [0, 0, 0, 0];

    data.naturalHaltDisplay = naturalHaltParts.map((val, index) => {
      return {
        value: String((Number.parseInt(val, 10) || 0) + (naturalHaltBuffs[index] || 0)),
        isHard: naturalHardLocations[index] || false
      };
    });

    if (!data.simplifiedHp) {
      // Prepare active conditions for the template
      const conditions = this.actor.system.conditions || {};
      data.activeConditions = [];
      data.hasConditions = false;

      if (conditions.wounded) {
        data.hasConditions = true;
      }

      // Support both new left/right limbs and legacy arms/legs
      const locMappings = [
        { key: 'head', label: 'Head' },
        { key: 'rightArm', label: 'Right Arm' },
        { key: 'leftArm', label: 'Left Arm' },
        { key: 'rightLeg', label: 'Right Leg' },
        { key: 'leftLeg', label: 'Left Leg' },
        { key: 'torso', label: 'Torso' },
        // Legacy fallback
        { key: 'arms', label: 'Arms' },
        { key: 'legs', label: 'Legs' }
      ];
      for (const loc of locMappings) {
        if (conditions[loc.key]) {
          data.activeConditions.push({
            key: loc.key,
            label: `${conditions[loc.key].charAt(0).toUpperCase() + conditions[loc.key].slice(1)} ${loc.label}`
          });
          data.hasConditions = true;
        }
      }
    }

    // Include blessing info for template rendering so blessed attribute can be styled
    data.blessing = blessing;

    // Expose the to-hit penalty target to the template so the characteristic label can be highlighted
    data.toHitPenaltyTarget = toHitPenaltyTarget;

    // Compute quick flags for template (only highlight when a blessing type is set)
    data.isBlessed = {
      build: !!blessing.type && blessing.target === 'build',
      reflex: !!blessing.type && blessing.target === 'reflex',
      intuition: !!blessing.type && blessing.target === 'intuition',
      learn: !!blessing.type && blessing.target === 'learn',
      charisma: !!blessing.type && blessing.target === 'charisma'
    };

      return data;
    } catch (err) {
      console.error('PeasantActorSheet.getData error:', err);
      // Fallback to super data so sheet can still render minimally
      try {
        if (typeof super.getData === "function") return await super.getData();
        return {
          actor: this.actor,
          editable: this.isEditable,
          owner: this.actor?.isOwner ?? false,
          options: this.options
        };
      } catch (err2) {
        console.error('PeasantActorSheet.getData fallback failed:', err2);
        return {};
      }
    }
  }

  async _applySimplifiedHpDefaults() {
    await this.actor?.applyPeasantSimplifiedHpDefaults?.();
  }

  async _onPeasantCoreSettingChange(event) {
    event.preventDefault();
    event.stopPropagation();
    const input = event.currentTarget;
    const flagKey = input?.dataset?.pcSetting;
    const setting = PC_ACTOR_SETTING_DEFINITIONS.find(candidate => candidate.flagKey === flagKey);
    if (!setting || !this.actor?.setFlag) return;

    try {
      if (setting.type === "boolean") {
        const wasEnabled = !!this.actor.getFlag("peasant-core", setting.flagKey);
        const enabled = !!input.checked;
        await this.actor.setFlag("peasant-core", setting.flagKey, enabled);
        if (setting.flagKey === PC_SIMPLIFIED_HP_FLAG && enabled && !wasEnabled) {
          await this._applySimplifiedHpDefaults();
        }
      } else {
        const value = sanitizePeasantCoreSettingNumber(setting, input.value);
        input.value = String(value);
        await this.actor.setFlag("peasant-core", setting.flagKey, value);
      }

      this.render(false);
    } catch (err) {
      console.warn(`Peasant Core | Failed to save actor setting ${flagKey}`, err);
      ui.notifications?.warn?.("Failed to save Peasant Core setting. See console for details.");
    }
  }

  activateListeners(html) {
    if (typeof super.activateListeners === "function") {
      try {
        super.activateListeners(html);
      } catch (err) {
        console.error('Error in super.activateListeners or initial setup:', err);
      }
    }
    pcLog.debug('PeasantActorSheet.activateListeners bound for actor:', this.actor?.name);
    this._setupSheetTabs(html);
    const sheetDocument = this._getElementDocument(html?.[0]);
    const sheetBody = sheetDocument?.body ?? document.body;
    // Initialize a promise-based queue to serialize skill saves and avoid race conditions
    if (this._skillsSaveQueue === undefined) this._skillsSaveQueue = Promise.resolve();
    if (this._combatSaveQueue === undefined) this._combatSaveQueue = Promise.resolve();
    if (this._advantageSaveQueue === undefined) this._advantageSaveQueue = Promise.resolve();
    if (this._edgeResourceSaveQueue === undefined) this._edgeResourceSaveQueue = Promise.resolve();
    teardownPortraitBindings(this);

    html.find(".pc-art-panel-toggle").off("click.peasantCoreArtPanel").on("click.peasantCoreArtPanel", async (event) => {
      event.preventDefault();
      const collapsed = !this.actor?.getFlag?.("peasant-core", PC_ART_PANEL_COLLAPSED_FLAG);
      await this.actor.setFlag("peasant-core", PC_ART_PANEL_COLLAPSED_FLAG, collapsed);
      this.render(false);
    });

    html.find(".pc-banner-rest-button").off("click.peasantCoreRest").on("click.peasantCoreRest", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const restType = event.currentTarget?.dataset?.type ?? event.currentTarget?.dataset?.restType;
      await confirmPeasantRest(this, restType);
    });

    html.find(".pc-sheet-setting-input").off("change.peasantCoreSettings").on("change.peasantCoreSettings", async (event) => {
      await this._onPeasantCoreSettingChange(event);
    });

    html.find(".pc-portrait-lozenge-input[data-field]").off("input.peasantPortraitLozenge change.peasantPortraitLozenge").on("input.peasantPortraitLozenge", (event) => {
      const input = event.currentTarget;
      if (input?.dataset?.field !== "system.movement") return;
      const value = Number.parseInt(input.value, 10);
      if (Number.isFinite(value) && value < 0) input.value = "0";
    }).on("change.peasantPortraitLozenge", async (event) => {
      const input = event.currentTarget;
      const field = input?.dataset?.field;
      if (!["system.movement", "system.initiative"].includes(field)) return;
      const value = field === "system.movement"
        ? Math.max(0, Number.parseInt(input.value, 10) || 0)
        : String(input.value ?? "").trim();
      input.value = String(value);
      if (field === "system.movement") await this.actor.setPeasantMovement?.(value);
      else await this.actor.setPeasantInitiative?.(value);
    });

    const enqueueSheetUpdate = (queueKey, label, task) => {
      if (this[queueKey] === undefined) this[queueKey] = Promise.resolve();

      const queued = this[queueKey]
        .catch(() => {})
        .then(async () => {
          try {
            return await task();
          } catch (err) {
            console.warn(`${label} queued update failed:`, err);
            throw err;
          }
        });

      // Keep the queue usable after failures
      this[queueKey] = queued.catch(() => {});
      return queued;
    };

    const collectAdvantagesFromDOM = () => {
      const items = this._getSheetJQ().find('.advantages-list .advantage-item');
      const actorNames = (JSON.parse(JSON.stringify(this.actor.system.flexibleAdvantages || [])) || []).map(entry => {
        if (typeof entry === 'string') return entry;
        return String(entry?.name ?? '');
      });
      const actorDescriptions = JSON.parse(JSON.stringify(this.actor.system.flexibleAdvantageDescriptions || []));
      if (!items.length) {
        return {
          names: actorNames,
          descriptions: actorDescriptions
        };
      }

      const names = [];
      const descriptions = [];
      items.each((_, el) => {
        const $el = $(el);
        const nameValue = $el.find('.advantage-input').val();
        const descValue = $el.find('.advantage-description-hidden').val();
        names.push(nameValue == null ? '' : String(nameValue));
        descriptions.push(descValue == null ? '' : String(descValue));
      });
      return { names, descriptions };
    };

    const blurActiveEditableInSheet = async () => {
      const sheetRoot = this._getSheetJQ()?.[0] || this.element || null;
      const active = this._getElementDocument(sheetRoot)?.activeElement;
      if (!sheetRoot || !active || !sheetRoot.contains(active)) return;

      const tag = String(active.tagName || '').toUpperCase();
      const editable = active.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (!editable || typeof active.blur !== 'function') return;

      try { active.blur(); } catch (e) { /* ignore */ }
      await new Promise(resolve => setTimeout(resolve, 0));
    };

    const resolveItemIndex = ($source, { dataKey = "index", rowSelector = null, rowAttr = null } = {}) => {
      let index = Number.parseInt($source?.data?.(dataKey));
      if (Number.isNaN(index) && rowSelector) {
        const row = $source.closest(rowSelector);
        if (row?.length) {
          if (rowAttr) index = Number.parseInt(row.attr(rowAttr));
          if (Number.isNaN(index)) index = row.index();
        }
      }
      return Number.isNaN(index) ? -1 : index;
    };

    const resolveCombatTagInputIndex = ($input) => {
      let idx = Number.parseInt($input.data("index"));
      if (Number.isNaN(idx)) {
        const container = $input.closest(".combat-tags-inline");
        idx = Number.parseInt(container.attr("data-combat-index"));
      }
      return Number.isNaN(idx) ? -1 : idx;
    };

    const runQueuedInputUpdate = async (input, queueKey, label, task) => {
      const inputEl = input?.[0] || null;
      const ownerDocument = this._getElementDocument(inputEl);
      const hadFocus = !!(inputEl && ownerDocument?.activeElement === inputEl);
      const canTrackSelection = !!(inputEl && typeof inputEl.selectionStart === "number");
      const valueBeforeUpdate = inputEl ? String(inputEl.value ?? "") : null;
      const selStart = canTrackSelection ? inputEl.selectionStart : null;
      const selEnd = canTrackSelection ? inputEl.selectionEnd : null;
      const selDir = canTrackSelection ? inputEl.selectionDirection : null;

      // Disabling the active input drops caret/selection; avoid it for focused fields.
      if (!hadFocus) {
        try { input?.prop?.("disabled", true); } catch (e) { /* ignore */ }
      }

      try {
        await enqueueSheetUpdate(queueKey, label, task);
      } finally {
        if (!hadFocus) {
          try { input?.prop?.("disabled", false); } catch (e) { /* ignore */ }
          return;
        }

        // Preserve typing flow when live-save fires while editing this field.
        try {
          const valueUnchanged = inputEl && String(inputEl.value ?? "") === valueBeforeUpdate;
          if (!valueUnchanged) return;
          if (inputEl && inputEl.isConnected && ownerDocument?.activeElement !== inputEl) {
            inputEl.focus({ preventScroll: true });
          }
          if (inputEl && inputEl.isConnected && ownerDocument?.activeElement === inputEl && canTrackSelection && selStart !== null && selEnd !== null && typeof inputEl.setSelectionRange === "function") {
            inputEl.setSelectionRange(selStart, selEnd, selDir || "none");
          }
        } catch (e) { /* ignore */ }
      }
    };

    // D&D-style form handling: free text fields save on change/blur instead of synthetic per-keystroke changes.
             
    // Ensure initial sheet-level flag exists
    if (this._woundsMenuOpen === undefined) this._woundsMenuOpen = false;

    // ========== ARROW KEY NAVIGATION ==========
    // Arrow key navigation that works in both edit and view modes.
    // Edit mode: navigate between editable inputs
    // View mode: navigate between interactive elements (buttons, clickable rolls, resource inputs)
    const setupArrowKeyNavigation = () => {
      const sheet = this;

      // Get all navigable inputs for EDIT mode as a flat list sorted by visual position
      const getEditModeInputs = () => {
        // Collect all inputs/selects from the sheet, plus contenteditable elements for inventory
        const allInputs = html.find('input:not([type="checkbox"]):not([type="hidden"]), select, .advantage-input, .editor-content[contenteditable="true"], .ProseMirror[contenteditable="true"]').toArray();
        
        // Filter out:
        // 1. The .skill-select dropdown in special skill rows (but NOT the other inputs)
        // 2. Inputs that are hidden or not visible
        // 3. Inputs in popup menus that are hidden
        // 4. Race/origin identity selects and attribute-table edge label selects
        const filtered = allInputs.filter(el => {
          try {
            const $el = $(el);
            
            // Skip if inside a hidden element
            if ($el.closest('.hidden').length) return false;
            if ($el.closest('[style*="display: none"]').length) return false;
            if ($el.closest('[style*="display:none"]').length) return false;
            
            // Skip if inside a popup menu (blessing-menu, wounds-menu, damage-controls, etc.)
            if ($el.closest('.blessing-menu, .wounds-menu, .damage-controls, .heal-controls, .stress-damage-controls, .stress-heal-controls').length) return false;
            
            // Skip the .skill-select dropdown itself (but allow other inputs in special skill rows)
            if ($el.hasClass('skill-select')) return false;
            
            // Skip race, origin, and specificOrigin selects
            const name = $el.attr('name') || '';
            if (name === 'system.race' || name === 'system.origin' || name === 'system.specificOrigin') return false;

            // Skip edge resource type selects in the attributes table to keep arrow navigation smooth.
            // Users can still edit these via mouse click.
            if ($el.hasClass('edge-base-label-mode') || $el.hasClass('edge-resource-label-mode') || $el.hasClass('edge-label-mode')) return false;
            
            // Skip if not visible
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return false;
            
            return true;
          } catch (e) { return false; }
        });

        return sortByVisualPosition(filtered);
      };

      // Get all navigable elements for VIEW mode
      const getViewModeElements = () => {
        // Selectors for interactive elements in view mode
        const selectors = [
          // Damage and heal buttons
          '.damage-toggle',
          '.heal-toggle',
          // Stress damage/heal/refresh buttons
          '.stress-damage-toggle',
          '.stress-heal-toggle',
          '.stress-refresh',
          // HP TN clicks (consciousness checks)
          '.hp-tn-clickable',
          // Attribute saves
          '.attr-save-clickable',
          '.attr-reflex-aoe-save-clickable',
          // Attribute to-hits (untrained rolls)
          '.attr-tohit-clickable',
          // Resource inputs (current value)
          'input[name="system.stamina.value"]',
          'input[name="system.attunement.value"]',
          'input[name="system.capacity.value"]',
          'input[name="system.edge.value"]',
          '.edge-resource-current',
          // Bolstered HP and Temporary HP inputs
          '.bolstered-hp-input',
          '.temporary-hp-input',
          // Combat modifier boxes (To-Hit, Acc, Die-Rate, Flat, Cost)
          '.combat-mod-input',
          'input[name="system.combatMods.toHit"]',
          'input[name="system.combatMods.accuracy"]',
          'input[name="system.combatMods.diceRate"]',
          '.combat-flat-buff-input',
          '.combat-cost-buff-value',
          '.combat-cost-buff-resource',
          '.combat-halt-buff-input',
          '.add-combat-halt-buff',
          '.remove-combat-halt-buff',
          // Resource refresh buttons
          '.resource-refresh',
          // Initiative
          '.initiative-clickable',
          // Skill names with descriptions (wrapper has tabindex for hover tooltip preview)
          '.skill-name-wrapper[tabindex]',
          // Skill rolls
          '.skill-roll-clickable[tabindex]',
          // Skill uses current (editable in view mode)
          '.skill-uses-current',
          // Combat names with descriptions (wrapper has tabindex for hover tooltip preview)
          '.combat-name-wrapper[tabindex]',
          // Combat rolls (notable combats section)
          '.combat-roll-clickable[tabindex]',
          // Combat tag rolls (damage, heal, manifest)
          '.combat-tag-rollable',
          // Combat uses current (editable in view mode)
          '.combat-uses-current',
          '.combat-tag-uses-current'
        ];

        const allElements = html.find(selectors.join(', ')).toArray();
        
        // Filter out hidden elements
        const filtered = allElements.filter(el => {
          try {
            const $el = $(el);
            
            // Skip if inside a hidden element
            if ($el.closest('.hidden').length) return false;
            if ($el.closest('[style*="display: none"]').length) return false;
            if ($el.closest('[style*="display:none"]').length) return false;
            
            // Skip if not visible
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return false;
            
            return true;
          } catch (e) { return false; }
        });

        return sortByVisualPosition(filtered);
      };

      // Sort elements by visual position (top-to-bottom, left-to-right)
      const sortByVisualPosition = (elements) => {
        const withPos = elements.map(el => {
          const rect = el.getBoundingClientRect();
          return { el, top: rect.top, left: rect.left };
        });

        // Sort by top position first, then by left position
        withPos.sort((a, b) => {
          // If within 10px vertically, consider them on same row - sort by left
          if (Math.abs(a.top - b.top) < 10) {
            return a.left - b.left;
          }
          return a.top - b.top;
        });

        return withPos.map(p => p.el);
      };

      // Find the next element in the given direction
      const findNextElement = (currentEl, direction, elements) => {
        if (elements.length === 0) return null;

        const currentIndex = elements.indexOf(currentEl);
        
        // If current element not in list, find the closest one visually
        if (currentIndex === -1) {
          const currentRect = currentEl.getBoundingClientRect();
          let bestIndex = 0;
          let bestDist = Infinity;
          
          for (let i = 0; i < elements.length; i++) {
            const rect = elements[i].getBoundingClientRect();
            const dist = Math.abs(rect.top - currentRect.top) * 2 + Math.abs(rect.left - currentRect.left);
            if (dist < bestDist) {
              bestDist = dist;
              bestIndex = i;
            }
          }
          
          // Navigate from the closest element
          if (direction === 'right' || direction === 'down') {
            return elements[Math.min(bestIndex + 1, elements.length - 1)] || null;
          } else {
            return elements[Math.max(bestIndex - 1, 0)] || null;
          }
        }

        // For left/right: simple prev/next in the flat list
        if (direction === 'left') {
          return currentIndex > 0 ? elements[currentIndex - 1] : null;
        }
        if (direction === 'right') {
          return currentIndex < elements.length - 1 ? elements[currentIndex + 1] : null;
        }

        // For up/down: find the closest element in that direction
        const currentRect = currentEl.getBoundingClientRect();
        let bestCandidate = null;
        let bestScore = Infinity;

        // Minimum vertical distance to consider as a different "row"
        // This prevents cycling between elements on the same line
        const minVerticalDiff = 15;

        for (let i = 0; i < elements.length; i++) {
          if (i === currentIndex) continue;
          const rect = elements[i].getBoundingClientRect();
          
          if (direction === 'up') {
            // Must be significantly above current element
            if (rect.top >= currentRect.top - minVerticalDiff) continue;
            // Score: prefer same horizontal position, then closest vertically
            const vertDist = currentRect.top - rect.top;
            const horizDist = Math.abs(rect.left - currentRect.left);
            const score = vertDist + horizDist * 0.5;
            if (score < bestScore) {
              bestScore = score;
              bestCandidate = elements[i];
            }
          } else if (direction === 'down') {
            // Must be significantly below current element
            if (rect.top <= currentRect.top + minVerticalDiff) continue;
            // Score: prefer same horizontal position, then closest vertically
            const vertDist = rect.top - currentRect.top;
            const horizDist = Math.abs(rect.left - currentRect.left);
            const score = vertDist + horizDist * 0.5;
            if (score < bestScore) {
              bestScore = score;
              bestCandidate = elements[i];
            }
          }
        }

        return bestCandidate;
      };

      // Focus an element appropriately based on its type
      const focusElement = (el) => {
        if (!el) return;
        el.focus();
        // For inputs, select all text
        if (el.tagName === 'INPUT' && el.select) {
          try { el.select(); } catch (e) { /* ignore */ }
        }
        // For non-input elements (buttons, clickable spans), add a visual focus indicator
        if (el.tagName !== 'INPUT' && el.tagName !== 'SELECT') {
          // Add tabindex if not present so it can receive focus
          if (!el.hasAttribute('tabindex')) {
            el.setAttribute('tabindex', '-1');
          }
        }
      };

      // Handle keydown for arrow navigation - works in both edit and view modes
      const handleArrowKey = (ev) => {
        const sheetRoot = html?.[0] ?? null;
        const eventTarget = ev.target;
        if (sheetRoot && eventTarget && eventTarget !== sheetRoot && !sheetRoot.contains(eventTarget)) return;

        const isEditMode = sheet?.isEditMode;
        const el = ev.target;
        if (!el) return;
        
        const tag = el.tagName;
        const isContentEditable = el.isContentEditable || el.classList?.contains('ProseMirror') || el.classList?.contains('editor-content');
        
        // Determine if the current element is navigable
        const isNavigableElement = (
          tag === 'INPUT' || 
          tag === 'SELECT' || 
          tag === 'BUTTON' ||
          isContentEditable ||
          el.classList?.contains('attr-save-clickable') ||
          el.classList?.contains('attr-reflex-aoe-save-clickable') ||
          el.classList?.contains('attr-tohit-clickable') ||
          el.classList?.contains('hp-tn-clickable') ||
          el.classList?.contains('skill-roll-clickable') ||
          el.classList?.contains('initiative-clickable') ||
          el.classList?.contains('damage-toggle') ||
          el.classList?.contains('heal-toggle') ||
          el.classList?.contains('stress-damage-toggle') ||
          el.classList?.contains('stress-heal-toggle') ||
          el.classList?.contains('stress-refresh') ||
          el.classList?.contains('resource-refresh') ||
          el.classList?.contains('combat-roll-clickable') ||
          el.classList?.contains('combat-tag-rollable') ||
          el.classList?.contains('skill-name-wrapper') ||
          el.classList?.contains('combat-name-wrapper') ||
          el.classList?.contains('combat-mod-input') ||
          el.classList?.contains('bolstered-hp-input') ||
          el.classList?.contains('temporary-hp-input')
        );

        // Skip if modifier keys are held
        if (ev.ctrlKey || ev.metaKey || ev.shiftKey) return;

        const key = ev.key;
        
        // Handle Enter/Space to activate clickable elements in view mode
        if (!isEditMode && (key === 'Enter' || key === ' ')) {
          if (el.tagName !== 'INPUT' && el.tagName !== 'SELECT') {
            ev.preventDefault();
            el.click();
            return;
          }
        }

        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return;

        // Get the appropriate list of navigable elements based on mode
        const elements = isEditMode ? getEditModeInputs() : getViewModeElements();
        
        // If not currently on a navigable element, start navigation from an appropriate element
        // This handles when the sheet itself is focused but no specific input/button is selected
        if (!isNavigableElement && elements.length > 0) {
          ev.preventDefault();
          // For down/right, start from the first element; for up/left, start from the last
          if (key === 'ArrowDown' || key === 'ArrowRight') {
            focusElement(elements[0]);
          } else {
            focusElement(elements[elements.length - 1]);
          }
          return;
        }

        // EDIT MODE: Handle inputs specially
        if (isEditMode) {
          if (!(tag === 'INPUT' || tag === 'SELECT' || isContentEditable)) return;

          // For number inputs: always prevent increment/decrement on up/down, and navigate
          if (tag === 'INPUT' && el.type === 'number') {
            if (key === 'ArrowUp' || key === 'ArrowDown') {
              ev.preventDefault();
              const direction = key === 'ArrowUp' ? 'up' : 'down';
              const nextEl = findNextElement(el, direction, elements);
              if (nextEl) focusElement(nextEl);
              return;
            }
            // For left/right on number inputs, always navigate
            if (key === 'ArrowLeft' || key === 'ArrowRight') {
              ev.preventDefault();
              const direction = key === 'ArrowLeft' ? 'left' : 'right';
              const nextEl = findNextElement(el, direction, elements);
              if (nextEl) focusElement(nextEl);
              return;
            }
          }

          // For select elements: left/right navigate, up/down change value (don't intercept)
          if (tag === 'SELECT') {
            if (key === 'ArrowUp' || key === 'ArrowDown') return; // Let select handle it
            ev.preventDefault();
            const direction = key === 'ArrowLeft' ? 'left' : 'right';
            const nextEl = findNextElement(el, direction, elements);
            if (nextEl) focusElement(nextEl);
            return;
          }

          // For contenteditable elements (inventory editor): only navigate on up/down
          if (isContentEditable) {
            if (key === 'ArrowUp' || key === 'ArrowDown') {
              ev.preventDefault();
              const direction = key === 'ArrowUp' ? 'up' : 'down';
              const nextEl = findNextElement(el, direction, elements);
              if (nextEl) focusElement(nextEl);
            }
            // Allow left/right for normal text editing in contenteditable
            return;
          }

          // For text inputs: check cursor position for left/right
          let direction = null;
          const selStart = (typeof el.selectionStart === 'number') ? el.selectionStart : null;
          const selEnd = (typeof el.selectionEnd === 'number') ? el.selectionEnd : null;
          // If there is an active selection, let the browser handle arrow keys
          if (selStart !== null && selEnd !== null && selStart !== selEnd) return;
          if (key === 'ArrowUp') direction = 'up';
          else if (key === 'ArrowDown') direction = 'down';
          else if (key === 'ArrowLeft') {
            // Only navigate if cursor is at start
            if (selStart === 0 && selEnd === 0) {
              direction = 'left';
            }
          } else if (key === 'ArrowRight') {
            // Only navigate if cursor is at end
            const len = (el.value || '').length;
            if (selStart === len && selEnd === len) {
              direction = 'right';
            }
          }

          if (!direction) return;

          ev.preventDefault();
          const nextEl = findNextElement(el, direction, elements);
          if (nextEl) focusElement(nextEl);
          return;
        }

        // VIEW MODE: Navigate between interactive elements
        // Allow navigation from any element, not just inputs
        let direction = null;
        if (key === 'ArrowUp') direction = 'up';
        else if (key === 'ArrowDown') direction = 'down';
        else if (key === 'ArrowLeft') direction = 'left';
        else if (key === 'ArrowRight') direction = 'right';

        if (!direction) return;

        // For inputs in view mode (like resource values), check cursor position for left/right
        // But for number inputs, always allow navigation (selectionStart not supported reliably)
        if (tag === 'INPUT') {
          const isNumberInput = el.type === 'number';
          
          if (!isNumberInput) {
            // For text inputs, check cursor position
            const selStart = (typeof el.selectionStart === 'number') ? el.selectionStart : null;
            const selEnd = (typeof el.selectionEnd === 'number') ? el.selectionEnd : null;
            if (selStart !== null && selEnd !== null && selStart !== selEnd) return;
            if (key === 'ArrowLeft' && selStart !== 0) return;
            if (key === 'ArrowRight') {
              const len = (el.value || '').length;
              if (selStart !== len) return;
            }
          }
          
          // Prevent number increment on up/down for all number inputs
          if (isNumberInput && (key === 'ArrowUp' || key === 'ArrowDown')) {
            ev.preventDefault();
          }
        }

        ev.preventDefault();
        const nextEl = findNextElement(el, direction, elements);
        if (nextEl) focusElement(nextEl);
      };

      // Use capturing phase to handle events before they bubble.
      this._teardownSheetEventBindings();
      sheetDocument.addEventListener('keydown', handleArrowKey, true);
      this._sheetKeydownRoot = sheetDocument;
      this._sheetKeydownHandler = handleArrowKey;
    };

    // Initialize arrow key navigation
    try {
      setupArrowKeyNavigation();
    } catch (err) {
      pcLog.debug('Failed to setup arrow key navigation:', err);
    }
    // Restore wounds menu open state on render
    if (this._woundsMenuOpen) {
      html.find(".wounds-menu").removeClass("hidden");
    }

    // Ensure blessing menu is hidden by default (only open via clicking labels in edit mode)
    html.find(".blessing-menu").addClass("hidden");

    // Remove any stray header 'Apply' button that may have been injected
    html.find(".header-button.apply").remove();

    // TOGGLE WOUNDS MENU - single handler
    html.find(".toggle-wounds-menu").click((ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const menu = html.find(".wounds-menu");
      menu.toggleClass("hidden");
      this._woundsMenuOpen = !menu.hasClass("hidden");
    });

    // CLOSE WOUNDS
    html.find(".close-wounds").click((ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      html.find(".wounds-menu").addClass("hidden");
      this._woundsMenuOpen = false;
    });

    html.find(".wounds-menu .wound-tag").each((_, tagEl) => {
      const removeBtn = tagEl.querySelector(".remove-condition");
      const setTagHoverState = (active) => {
        tagEl.classList.toggle("tag-hover-active", !!active);
        if (!active) {
          tagEl.style.removeProperty("background");
          tagEl.style.removeProperty("background-color");
          tagEl.style.removeProperty("border-color");
          tagEl.style.removeProperty("color");
          return;
        }

        const hoverSource = removeBtn || tagEl;
        const hoverStyles = getComputedStyle(hoverSource);
        const hoverBg = hoverStyles.getPropertyValue("--button-hover-background-color").trim() || "rgba(206, 122, 28, 0.85)";
        const hoverBorder = hoverStyles.getPropertyValue("--button-hover-border-color").trim() || "#e0b15b";
        const hoverText = hoverStyles.getPropertyValue("--button-hover-text-color").trim() || "#fff4db";

        tagEl.style.setProperty("background", hoverBg, "important");
        tagEl.style.setProperty("background-color", hoverBg, "important");
        tagEl.style.setProperty("border-color", hoverBorder, "important");
        tagEl.style.setProperty("color", hoverText, "important");
      };
      const setRemoveHoverState = (active) => {
        if (!removeBtn) return;
        removeBtn.classList.toggle("tag-hover-active", !!active);
      };

      tagEl.addEventListener("mouseenter", () => setTagHoverState(true));
      tagEl.addEventListener("mouseleave", () => setTagHoverState(false));

      if (removeBtn) {
        removeBtn.addEventListener("mouseenter", () => {
          setTagHoverState(false);
          setRemoveHoverState(true);
        });
        removeBtn.addEventListener("mouseleave", () => {
          setRemoveHoverState(false);
          if (tagEl.matches(":hover")) setTagHoverState(true);
        });
        removeBtn.addEventListener("focusin", () => {
          setTagHoverState(false);
          setRemoveHoverState(true);
        });
        removeBtn.addEventListener("focusout", () => {
          setRemoveHoverState(false);
          setTimeout(() => {
            if (tagEl.matches(":hover")) setTagHoverState(true);
          }, 0);
        });
      }
    });

    // REMOVE CONDITION (inside activateListeners)
    html.find(".remove-condition").click(async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const key = $(ev.currentTarget).data("condition"); // wounded or head/arms/legs/torso

      try {
        await this.actor.clearPeasantCondition?.(key);
      } catch (err) {
        console.warn("Failed to remove condition:", err);
        return;
      }

      // Re-evaluate remaining conditions
      const hasRemaining = this.actor.hasPeasantConditions?.() ?? false;
      this._woundsMenuOpen = hasRemaining;
      if (!hasRemaining) html.find(".wounds-menu").addClass("hidden");
      else html.find(".wounds-menu").removeClass("hidden");

      // Re-render to refresh UI
      this.render(false);
    });

    // ADD WOUND - show dialog to select wound type
    html.find(".add-wound-btn").click(async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      
      const dialogContent = `
        <form>
          <div class="form-group" style="margin-bottom: 10px;">
            <label style="display: block; margin-bottom: 5px; color: #b0b0b0;">Select Wound Type:</label>
            <select name="woundType" style="width: 100%; padding: 8px 10px; min-height: 38px; font-size: 14px;">
              <option value="wounded">Wounded</option>
              <optgroup label="â”€â”€â”€ Disabled â”€â”€â”€">
                <option value="disabled:head">Disabled Head</option>
                <option value="disabled:rightArm">Disabled Right Arm</option>
                <option value="disabled:leftArm">Disabled Left Arm</option>
                <option value="disabled:rightLeg">Disabled Right Leg</option>
                <option value="disabled:leftLeg">Disabled Left Leg</option>
              <option value="disabled:torso">Disabled Torso</option>
              </optgroup>
              <optgroup label="â”€â”€â”€ Crippled â”€â”€â”€">
                <option value="crippled:head">Crippled Head</option>
                <option value="crippled:rightArm">Crippled Right Arm</option>
                <option value="crippled:leftArm">Crippled Left Arm</option>
                <option value="crippled:rightLeg">Crippled Right Leg</option>
                <option value="crippled:leftLeg">Crippled Left Leg</option>
                <option value="crippled:torso">Crippled Torso</option>
              </optgroup>
            </select>
          </div>
        </form>
      `;
      
      this._renderDialog({
        title: "Add Wound",
        content: dialogContent,
        buttons: {
          add: {
            icon: '<i class="fas fa-plus"></i>',
            label: "Add",
            callback: async (html) => {
              const woundType = html.find('[name="woundType"]').val();
              await this.actor.addPeasantWound?.(woundType);
              this._woundsMenuOpen = true;
              this.render(false);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: "Cancel"
          }
        },
        default: "add"
      });
    });

    // HALT HARD LOCATION TOGGLE
    html.find(".halt-letter").click(async (ev) => {
      if (!this.isEditMode) return;
      const el = $(ev.currentTarget);
      const loc = el.data("loc");
      const type = el.data("type");

      await this.actor.togglePeasantHardLocation?.(loc, type);
    });

    // HALT INPUT SANITIZER - keep "/" separators intact while editing
    const normalizeHaltValue = (raw) => normalizeHaltSlashValueEditable(raw);
    const finalizeHaltValue = (raw) => normalizeHaltSlashValue(raw);

    const haltInputs = html.find('input[name="system.haltValues"], input[name="system.naturalHaltValues"]');
    haltInputs.each((_, el) => {
      const normalized = normalizeHaltValue(el.value);
      if (normalized !== el.value) el.value = normalized;
    });

    haltInputs.on('keydown', (ev) => {
      // Prevent deleting the "/" separators directly
      if (ev.key !== 'Backspace' && ev.key !== 'Delete') return;
      const input = ev.currentTarget;
      const value = input.value || '';
      const start = input.selectionStart ?? 0;
      const end = input.selectionEnd ?? start;
      if (start !== end) return; // allow selection deletes; we'll re-normalize on input
      if (ev.key === 'Backspace' && start > 0 && value[start - 1] === '/') {
        ev.preventDefault();
      }
      if (ev.key === 'Delete' && value[start] === '/') {
        ev.preventDefault();
      }
    });

    haltInputs.on('input', (ev) => {
      const input = ev.currentTarget;
      const before = input.value || '';
      const pos = input.selectionStart ?? before.length;
      const normalized = normalizeHaltValue(before);
      if (normalized !== before) {
        const delta = normalized.length - before.length;
        const nextPos = Math.max(0, Math.min(normalized.length, pos + delta));
        input.value = normalized;
        try { input.setSelectionRange(nextPos, nextPos); } catch (e) { /* ignore */ }
      }
    });

    haltInputs.on('change blur', (ev) => {
      const input = ev.currentTarget;
      const finalized = finalizeHaltValue(input.value || '');
      if (finalized !== input.value) input.value = finalized;
    });

    // RANK INPUT RESTRICTION (Skills + Notable Combats)
    const normalizeRankValue = (raw) => {
      const match = String(raw || '').match(/[1234uU]/);
      return match ? match[0] : '';
    };
    const rankInputs = html.find('.skill-rank, .combat-rank');
    rankInputs.on('keydown', (ev) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const key = ev.key;
      const isNav = ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'Enter', 'Home', 'End'].includes(key);
      if (isNav) return;
      if (!/^[1234uU]$/.test(key)) {
        ev.preventDefault();
      }
    });
    rankInputs.on('input', (ev) => {
      const input = ev.currentTarget;
      const before = input.value || '';
      const normalized = normalizeRankValue(before);
      if (normalized !== before) input.value = normalized;
    });
    rankInputs.on('change blur', (ev) => {
      const input = ev.currentTarget;
      const normalized = normalizeRankValue(input.value);
      const finalVal = normalized === '' ? '1' : normalized;
      if (finalVal !== input.value) input.value = finalVal;
    });

    // Resource and HP/stress handlers (kept intact)
    html.find("input[name='system.stamina.max'], input[name='system.attunement.max'], input[name='system.capacity.max'], input[name='system.edge.max']").change(async (ev) => {
      const input = $(ev.currentTarget);
      const fieldName = input.attr("name");
      const newMaxValue = parseInt(input.val()) || 0;
      const resourceName = fieldName.split(".")[1];
      await this.actor.setPeasantResourceMax?.(resourceName, newMaxValue, { fillOnlyWhenEmpty: true });
    });

    html.find(".pc-portrait-resource-max-input").off("change.peasantPortraitResourceMax").on("change.peasantPortraitResourceMax", async (ev) => {
      const input = $(ev.currentTarget);
      const resourceName = String(input.data("resource") || "").trim();
      if (!["stamina", "attunement", "capacity", "edge"].includes(resourceName)) return;

      const newMaxValue = Math.max(0, parseInt(input.val(), 10) || 0);
      input.val(newMaxValue);
      await this.actor.setPeasantResourceMax?.(resourceName, newMaxValue);
    });

    html.find(".pc-portrait-resource-value-input").off("input.peasantPortraitResourceValue change.peasantPortraitResourceValue").on("input.peasantPortraitResourceValue", (ev) => {
      const input = $(ev.currentTarget);
      const resourceName = String(input.data("resource") || "").trim();
      if (!["stamina", "attunement", "capacity", "edge"].includes(resourceName)) return;
      const maxValue = Math.max(0, Number(this.actor.system?.[resourceName]?.max) || 0);
      const newValue = Math.max(0, parseInt(input.val(), 10) || 0);
      if (newValue > maxValue) input.val(maxValue);
    }).on("change.peasantPortraitResourceValue", async (ev) => {
      const input = $(ev.currentTarget);
      const resourceName = String(input.data("resource") || "").trim();
      if (!["stamina", "attunement", "capacity", "edge"].includes(resourceName)) return;
      const maxValue = Math.max(0, Number(this.actor.system?.[resourceName]?.max) || 0);
      const newValue = Math.max(0, Math.min(parseInt(input.val(), 10) || 0, maxValue));
      input.val(newValue);
      await this.actor.setPeasantResourceValue?.(resourceName, newValue);
    });

    const togglePortraitResourceBarInput = (bar, edit) => {
      const label = bar.querySelector(":scope > .pc-portrait-resource-bar-label");
      const input = bar.querySelector(":scope > .pc-portrait-resource-value-input, :scope > .pc-portrait-resource-max-input");
      if (!label || !input) return;
      label.hidden = edit;
      input.hidden = !edit;
      if (edit) {
        input.focus();
        input.select?.();
      }
    };

    html.find(".pc-portrait-resource-bar").off("click.peasantPortraitResourceBar").on("click.peasantPortraitResourceBar", (ev) => {
      if ($(ev.target).is("input, button, select, textarea, a")) return;
      togglePortraitResourceBarInput(ev.currentTarget, true);
    });

    html.find(".pc-portrait-resource-value-input, .pc-portrait-resource-max-input")
      .off("blur.peasantPortraitResourceBar keydown.peasantPortraitResourceBar")
      .on("blur.peasantPortraitResourceBar", (ev) => {
        const bar = ev.currentTarget.closest(".pc-portrait-resource-bar");
        if (bar) togglePortraitResourceBarInput(bar, false);
      })
      .on("keydown.peasantPortraitResourceBar", (ev) => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        ev.currentTarget.blur();
      });

    html.find(".pc-portrait-stress-count-input").off("change.peasantPortraitStressCount").on("change.peasantPortraitStressCount", async (ev) => {
      const input = $(ev.currentTarget);
      const stressType = this._normalizeStressType(input.data("stressType"));
      const newCount = Math.max(0, parseInt(input.val(), 10) || 0);
      input.val(newCount);
      await this._setStressGridSize(stressType, newCount);
      this.render(false);
    });

    const resourceInputs = html.find("input[name='system.stamina.value'], input[name='system.attunement.value'], input[name='system.capacity.value'], input[name='system.edge.value']");
    resourceInputs.on("input", (ev) => {
      const input = $(ev.currentTarget);
      const fieldName = input.attr("name");
      const resourceName = fieldName.split(".")[1];
      const maxValue = this.actor.system[resourceName].max;
      const newValue = parseInt(input.val()) || 0;
      if (newValue > maxValue) input.val(maxValue);
    });

    resourceInputs.on("change", async (ev) => {
      const input = $(ev.currentTarget);
      const fieldName = input.attr("name");
      const newCurrentValue = parseInt(input.val()) || 0;
      const resourceName = fieldName.split(".")[1];
      const maxValue = this.actor.system[resourceName].max;
      if (newCurrentValue > maxValue) {
        await this.actor.setPeasantResourceValue?.(resourceName, maxValue);
      }
    });

    const defaultEdgeLabelMode = getDefaultEdgeLabelMode(this.actor);
    const getEdgeResourceAt = (index) => this.actor.getPeasantEdgeResource?.(index) ?? null;

    const getCombatHaltBuffsForUpdate = () => this.actor.getPeasantCombatHaltBuffsForUpdate?.() ?? sanitizeCombatHaltBuffs(this.actor?.system?.combatMods?.haltBuffs);
    const hasCombatHaltBuffType = (buffs, type) => buffs.some(buff => sanitizeCombatHaltBuffType(buff?.type) === type);
    const hasCombatCostBuffResource = (buffs, resourceType) => {
      const safeType = sanitizeCombatCostResourceType(resourceType);
      return buffs.some(buff =>
        sanitizeCombatHaltBuffType(buff?.type) === COMBAT_HALT_BUFF_TYPE_COST &&
        sanitizeCombatCostResourceType(buff?.resourceType) === safeType
      );
    };
    const refreshCombatModifierHighlights = () => {
      html.find(".combat-modifiers .combat-mod-input").each((_, inputEl) => {
        const $input = $(inputEl);
        let hasMod = false;

        if ($input.hasClass("combat-halt-buff-input")) {
          hasMod = normalizeHaltSlashValue($input.val()) !== "0/0/0/0";
        } else if (inputEl.type === "number") {
          hasMod = (Number.parseInt($input.val(), 10) || 0) !== 0;
        }

        $input.toggleClass("has-mod", hasMod);
      });
    };
    refreshCombatModifierHighlights();
    html.on("input change", ".combat-modifiers .combat-mod-input", () => {
      refreshCombatModifierHighlights();
    });

    const getDefaultReflexAoeSaveTarget = () => {
      const combatMods = this.actor.system.combatMods || { toHit: 0 };
      const toHitMod = Number.parseInt(combatMods.toHit, 10) || 0;
      const baseSaves = computeBaseSaves(this.actor.system);
      const reflexBase = Number.isFinite(baseSaves.reflex) ? baseSaves.reflex : 7;
      return applyToHitFloor(reflexBase, toHitMod, 2).toHit;
    };

    html.on("click", ".reflex-aoe-add", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!this.isEditMode) return;
      const defaultTarget = getDefaultReflexAoeSaveTarget();
      await this.actor.setPeasantReflexAoeSave?.(true, String(defaultTarget));
      setTimeout(() => {
        const input = this._getSheetJQ().find(".reflex-aoe-save-input").first();
        if (!input.length) return;
        try {
          input.trigger("focus");
          input[0]?.select?.();
        } catch (e) {
          /* ignore */
        }
      }, 40);
    });

    html.on("click", ".reflex-aoe-remove", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!this.isEditMode) return;
      await this.actor.setPeasantReflexAoeSave?.(false);
    });

    html.on("input", ".reflex-aoe-save-input", (ev) => {
      if (!this.isEditMode) return;
      const inputEl = ev.currentTarget;
      const before = String(inputEl.value ?? "");
      const digitsOnly = before.replace(/[^\d]/g, "");
      if (digitsOnly !== before) {
        const pos = inputEl.selectionStart ?? before.length;
        const delta = digitsOnly.length - before.length;
        inputEl.value = digitsOnly;
        const nextPos = Math.max(0, Math.min(digitsOnly.length, pos + delta));
        try { inputEl.setSelectionRange(nextPos, nextPos); } catch (e) { /* ignore */ }
      }
      this._scheduleEditAutosaveChange(inputEl, 260);
    });

    html.on("change blur", ".reflex-aoe-save-input", (ev) => {
      if (!this.isEditMode) return;
      const input = $(ev.currentTarget);
      const raw = String(input.val() ?? "").trim();
      if (!raw) {
        input.val("");
        return;
      }
      const parsed = Number.parseInt(raw, 10);
      const normalized = Number.isFinite(parsed) ? String(Math.max(2, parsed)) : "";
      if (normalized !== raw) input.val(normalized);
    });

    html.on("click", ".add-edge-resource-btn", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      await this.actor.addPeasantEdgeResource?.();
    });

    html.on("click", ".remove-edge-resource-btn", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!this.isEditMode) return;
      const index = Number.parseInt($(ev.currentTarget).data("resourceIndex"), 10);
      if (!Number.isFinite(index) || index < 0) return;
      await this.actor.removePeasantEdgeResource?.(index);
    });

    html.on("change", ".edge-base-label-mode", async (ev) => {
      if (!this.isEditMode) return;
      const selected = sanitizeEdgeLabelMode($(ev.currentTarget).val(), defaultEdgeLabelMode);
      await this.actor.setPeasantEdgeLabelMode?.(selected);
      this.render(false);
    });

    html.on("change", ".edge-base-custom-label", async (ev) => {
      if (!this.isEditMode) return;
      const customLabel = String($(ev.currentTarget).val() ?? "").trim();
      await this.actor.setPeasantEdgeCustomLabel?.(customLabel);
    });

    html.on("change", ".edge-resource-label-mode", async (ev) => {
      if (!this.isEditMode) return;
      const input = $(ev.currentTarget);
      const index = Number.parseInt(input.data("resourceIndex"), 10);
      if (!Number.isFinite(index) || index < 0) return;
      await runQueuedInputUpdate(input, "_edgeResourceSaveQueue", "Edge resource label mode change", async () => {
        await this.actor.setPeasantEdgeResourceLabelMode?.(index, input.val(), { render: false });
      });
      this.render(false);
    });

    html.on("change", ".edge-resource-custom-label", async (ev) => {
      if (!this.isEditMode) return;
      const input = $(ev.currentTarget);
      const index = Number.parseInt(input.data("resourceIndex"), 10);
      if (!Number.isFinite(index) || index < 0) return;
      await runQueuedInputUpdate(input, "_edgeResourceSaveQueue", "Edge resource custom label change", async () => {
        await this.actor.setPeasantEdgeResourceCustomLabel?.(index, input.val(), { render: false });
      });
    });

    html.on("click", ".add-combat-halt-buff", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!this.isEditable) return;
      await blurActiveEditableInSheet();

      const existing = getCombatHaltBuffsForUpdate();
      const options = [];
      const availableCostResourceTypes = COMBAT_COST_RESOURCE_TYPES.filter(type => !hasCombatCostBuffResource(existing, type));
      if (!hasCombatHaltBuffType(existing, COMBAT_HALT_BUFF_TYPE_HALT)) options.push({ type: COMBAT_HALT_BUFF_TYPE_HALT, label: "HALT" });
      if (!hasCombatHaltBuffType(existing, COMBAT_HALT_BUFF_TYPE_NATURAL)) options.push({ type: COMBAT_HALT_BUFF_TYPE_NATURAL, label: "Nat HALT" });
      if (!hasCombatHaltBuffType(existing, COMBAT_HALT_BUFF_TYPE_FLAT)) options.push({ type: COMBAT_HALT_BUFF_TYPE_FLAT, label: "Flat" });
      if (availableCostResourceTypes.length > 0) options.push({ type: COMBAT_HALT_BUFF_TYPE_COST, label: "Resource Cost" });
      options.push({ type: COMBAT_HALT_BUFF_TYPE_CUSTOM, label: "Custom" });

      if (!options.length) {
        ui.notifications?.info?.("No additional buff types available.");
        return;
      }

      const optionsHtml = options.map(opt => `<option value="${opt.type}">${opt.label}</option>`).join("");
      const resourceOptionsHtml = availableCostResourceTypes
        .map(type => `<option value="${type}">${type}</option>`)
        .join("");
      this._renderDialog({
        title: "Add Buff",
        content: `
          <form>
            <div class="form-group" style="margin-bottom: 10px;">
              <label style="display: block; margin-bottom: 5px;">Buff Type</label>
              <select name="combatBuffType" class="pc-macro-input" style="width: 100%;">
                ${optionsHtml}
              </select>
            </div>
            <div class="form-group combat-cost-type-group" style="margin-bottom: 10px; display: none;">
              <label style="display: block; margin-bottom: 5px;">Resource Type</label>
              <select name="combatCostResourceType" class="pc-macro-input" style="width: 100%;">
                ${resourceOptionsHtml}
              </select>
            </div>
            <div class="form-group combat-custom-group" style="margin-bottom: 10px; display: none;">
              <label style="display: block; margin-bottom: 5px;">Custom Name</label>
              <input type="text" name="combatCustomBuffName" class="pc-macro-input" style="width: 100%;" placeholder="Custom Buff">
              <label style="display: block; margin-bottom: 5px; margin-top: 8px;">Value</label>
              <input type="number" name="combatCustomBuffValue" class="pc-macro-input" style="width: 100%;" value="0">
            </div>
          </form>
        `,
        buttons: {
          add: {
            icon: '<i class="fas fa-plus"></i>',
            label: "Add",
            callback: async (dlgHtml) => {
              const selectedType = sanitizeCombatHaltBuffType(dlgHtml.find('[name="combatBuffType"]').val());
              const selectedResourceType = sanitizeCombatCostResourceType(dlgHtml.find('[name="combatCostResourceType"]').val());
              const customName = String(dlgHtml.find('[name="combatCustomBuffName"]').val() ?? "").trim() || "Custom";
              const customValue = Number.parseInt(dlgHtml.find('[name="combatCustomBuffValue"]').val(), 10) || 0;
              const result = await this.actor.addPeasantCombatHaltBuff?.(selectedType, {
                resourceType: selectedResourceType,
                customName,
                value: customValue
              });
              if (result?.reason === "duplicate-cost") {
                ui.notifications?.info?.(`${result.resourceType || selectedResourceType} cost buff already exists.`);
              }
              this.render(false);
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: "Cancel"
          }
        },
        default: "add",
        render: (dlgHtml) => {
          const typeSelect = dlgHtml.find('[name="combatBuffType"]');
          const resourceGroup = dlgHtml.find('.combat-cost-type-group');
          const customGroup = dlgHtml.find('.combat-custom-group');
          const refreshVisibility = () => {
            const selectedType = sanitizeCombatHaltBuffType(typeSelect.val());
            resourceGroup.css('display', selectedType === COMBAT_HALT_BUFF_TYPE_COST ? '' : 'none');
            customGroup.css('display', selectedType === COMBAT_HALT_BUFF_TYPE_CUSTOM ? '' : 'none');
          };
          typeSelect.on('change', refreshVisibility);
          refreshVisibility();
        }
      }, { classes: ["peasant-macro-dialog"] });
    });

    html.on("click", ".remove-combat-halt-buff", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!this.isEditable) return;
      const index = Number.parseInt($(ev.currentTarget).data("buffIndex"), 10);
      if (!Number.isFinite(index) || index < 0) return;

      await enqueueSheetUpdate("_combatSaveQueue", "Remove combat HALT buff", async () => {
        await this.actor.removePeasantCombatHaltBuff?.(index, { render: false });
      });
      this.render(false);
    });

    html.on("input", ".combat-halt-buff-input", (ev) => {
      if (!this.isEditable) return;
      const inputEl = ev.currentTarget;
      const before = String(inputEl.value ?? "");
      const pos = inputEl.selectionStart ?? before.length;
      const normalized = normalizeHaltSlashValueEditable(before);
      if (normalized !== before) {
        const delta = normalized.length - before.length;
        const nextPos = Math.max(0, Math.min(normalized.length, pos + delta));
        inputEl.value = normalized;
        try { inputEl.setSelectionRange(nextPos, nextPos); } catch (e) { /* ignore */ }
      }
    });

    html.on("change blur", ".combat-halt-buff-input", async (ev) => {
      if (!this.isEditable) return;
      const input = $(ev.currentTarget);
      const index = Number.parseInt(input.data("buffIndex"), 10);
      if (!Number.isFinite(index) || index < 0) return;
      const normalized = normalizeHaltSlashValue(input.val());
      if (normalized !== input.val()) input.val(normalized);

      await runQueuedInputUpdate(input, "_combatSaveQueue", "Combat HALT buff values change", async () => {
        await this.actor.setPeasantCombatHaltBuffValues?.(index, input.val(), { render: false });
      });
      refreshCombatModifierHighlights();
      this.render(false);
    });

    html.on("change", ".combat-flat-buff-input, .combat-cost-buff-value, .combat-custom-buff-value", async (ev) => {
      if (!this.isEditable) return;
      const input = $(ev.currentTarget);
      const index = Number.parseInt(input.data("buffIndex"), 10);
      if (!Number.isFinite(index) || index < 0) return;
      const normalizedValue = Number.parseInt(input.val(), 10) || 0;
      if (String(normalizedValue) !== String(input.val())) input.val(normalizedValue);

      await runQueuedInputUpdate(input, "_combatSaveQueue", "Combat numeric buff value change", async () => {
        await this.actor.setPeasantCombatHaltBuffValue?.(index, normalizedValue, { render: false });
      });
      refreshCombatModifierHighlights();
      this.render(false);
    });

    html.on("change blur", ".combat-custom-buff-name", async (ev) => {
      if (!this.isEditable) return;
      const input = $(ev.currentTarget);
      const index = Number.parseInt(input.data("buffIndex"), 10);
      if (!Number.isFinite(index) || index < 0) return;
      const normalizedName = String(input.val() ?? "").trim() || "Custom";
      if (normalizedName !== input.val()) input.val(normalizedName);

      await runQueuedInputUpdate(input, "_combatSaveQueue", "Combat custom buff name change", async () => {
        await this.actor.setPeasantCombatCustomBuffName?.(index, normalizedName, { render: false });
      });
      this.render(false);
    });

    html.on("change", ".combat-cost-buff-resource", async (ev) => {
      if (!this.isEditable) return;
      const select = $(ev.currentTarget);
      const index = Number.parseInt(select.data("buffIndex"), 10);
      if (!Number.isFinite(index) || index < 0) return;
      const selectedResourceType = sanitizeCombatCostResourceType(select.val());

      await runQueuedInputUpdate(select, "_combatSaveQueue", "Combat cost buff resource type change", async () => {
        const result = await this.actor.setPeasantCombatCostBuffResource?.(index, selectedResourceType, { render: false });
        if (result?.reason === "duplicate-cost") ui.notifications?.info?.(`${result.resourceType || selectedResourceType} cost buff already exists.`);
      });
      this.render(false);
    });

    html.on("input", ".edge-resource-custom-label", (ev) => {
      if (!this.isEditMode) return;
      this._scheduleEditAutosaveChange(ev.currentTarget, 260);
    });

    html.on("input", ".edge-resource-current, .edge-resource-max", (ev) => {
      const input = $(ev.currentTarget);
      const index = Number.parseInt(input.data("resourceIndex"), 10);
      if (!Number.isFinite(index) || index < 0) return;
      const isMax = input.hasClass("edge-resource-max");
      if (isMax) {
        const maxValue = Math.max(0, Number.parseInt(input.val(), 10) || 0);
        input.val(maxValue);
      } else {
        const entry = getEdgeResourceAt(index);
        if (!entry) return;
        const maxValue = Math.max(0, Number.parseInt(entry.max, 10) || 0);
        const value = Math.max(0, Number.parseInt(input.val(), 10) || 0);
        if (value > maxValue) input.val(maxValue);
      }
      this._scheduleEditAutosaveChange(ev.currentTarget, 240);
    });

    html.on("change", ".edge-resource-current, .edge-resource-max", async (ev) => {
      const input = $(ev.currentTarget);
      const index = Number.parseInt(input.data("resourceIndex"), 10);
      if (!Number.isFinite(index) || index < 0) return;
      const isMax = input.hasClass("edge-resource-max");
      await runQueuedInputUpdate(
        input,
        "_edgeResourceSaveQueue",
        isMax ? "Edge resource max change" : "Edge resource current change",
        async () => {
          if (isMax) {
            const maxValue = Math.max(0, Number.parseInt(input.val(), 10) || 0);
            input.val(maxValue);
            await this.actor.setPeasantEdgeResourceMax?.(index, maxValue, { render: false });
          } else {
            const entry = getEdgeResourceAt(index);
            const maxValue = Math.max(0, Number.parseInt(entry?.max, 10) || 0);
            const value = Math.max(0, Number.parseInt(input.val(), 10) || 0);
            const nextValue = Math.min(value, maxValue);
            input.val(nextValue);
            await this.actor.setPeasantEdgeResourceValue?.(index, nextValue, { render: false });
          }
        }
      );
    });

    // Bolstered HP input handler - clamp to HP columns
    html.find("input[name='system.bolsteredHp']").on("change", async (ev) => {
      const input = $(ev.currentTarget);
      let newValue = parseInt(input.val()) || 0;
      const maxBolstered = getActorBolsteredMax(this.actor);
      newValue = Math.max(0, Math.min(newValue, maxBolstered));
      input.val(newValue);
      await this.actor.setPeasantBolsteredHp?.(newValue);
    });

    // Temporary HP input handler - clamp to max
    html.find("input[name='system.temporaryHp.value']").on("change", async (ev) => {
      const input = $(ev.currentTarget);
      let newValue = parseInt(input.val()) || 0;
      const maxTempHp = this.actor.system.temporaryHp?.max || 0;
      newValue = Math.max(0, Math.min(newValue, maxTempHp));
      input.val(newValue);
      await this.actor.setPeasantTemporaryHpValue?.(newValue);
    });

    html.find(".pc-portrait-thp-input").on("change", async (ev) => {
      const input = $(ev.currentTarget);
      const newValue = Math.max(0, Number.parseInt(input.val(), 10) || 0);
      input.val(newValue);
      await this.actor.setPeasantTemporaryHpValue?.(newValue, { expandMax: true });
    });

    html.find(".pc-portrait-bhp-input").on("change", async (ev) => {
      const input = $(ev.currentTarget);
      const maxBolstered = getActorBolsteredMax(this.actor);
      const newValue = Math.max(0, Math.min(Number.parseInt(input.val(), 10) || 0, maxBolstered));
      input.val(newValue);
      await this.actor.setPeasantBolsteredHp?.(newValue);
    });

    html.find(".pc-hp-grid-open").off("click.peasantHpGrid").on("click.peasantHpGrid", (ev) => {
      ev.preventDefault();
      this._openHpGridDialog(ev.currentTarget);
    });

    html.find(".pc-stress-grid-open").off("click.peasantStressGrid").on("click.peasantStressGrid", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this._openStressGridDialog(ev.currentTarget?.dataset?.stressType, ev.currentTarget);
    });

    // Simplified HP inputs
    html.find("input[name='system.health.max']").on("change", async (ev) => {
      if (!isSimplifiedHpActor(this.actor)) return;
      const input = $(ev.currentTarget);
      let newMax = parseInt(input.val()) || 1;
      newMax = Math.max(1, newMax);
      input.val(newMax);
      await this.actor.setPeasantSimplifiedHealthMax?.(newMax);
    });

    html.find("input[name='system.health.value']").on("change", async (ev) => {
      if (!isSimplifiedHpActor(this.actor)) return;
      const input = $(ev.currentTarget);
      const maxHealth = getActorHealthMax(this.actor);
      let newValue = parseInt(input.val()) || 0;
      newValue = Math.max(0, Math.min(newValue, maxHealth));
      input.val(newValue);
      await this.actor.setPeasantSimplifiedHealthValue?.(newValue);
    });

    // HP Value input handler - command-based edits (+# / -#)
    // HP / STRESS / OTHER handlers
    // HP GRID - Add Column
    html.find(".hp-col-plus").click(async () => {
      await this.actor.resizePeasantHpGrid?.(0, 1);
    });

    // HP GRID - Remove Column
    html.find(".hp-col-minus").click(async () => {
      await this.actor.resizePeasantHpGrid?.(0, -1);
    });

    // HP GRID - Add Row
    html.find(".hp-row-plus").click(async () => {
      await this.actor.resizePeasantHpGrid?.(1, 0);
    });

    // HP GRID - Remove Row
    html.find(".hp-row-minus").click(async () => {
      await this.actor.resizePeasantHpGrid?.(-1, 0);
    });

    // HP CELL CLICK - Cycle through damage states
    html.find(".hp-cell:not(.stress-cell)").click(async (ev) => {
      const cell = $(ev.currentTarget);
      let row = parseInt(cell.data("row"));
      let col = parseInt(cell.data("col"));
      if (Number.isNaN(row) || Number.isNaN(col)) return;
      await this.actor.cyclePeasantHpGridCell?.(row, col);
      this.render(false);
    });

    // HP CELL RIGHT-CLICK - Reset to regular
    html.find(".hp-cell:not(.stress-cell)").on("contextmenu", async (ev) => {
      ev.preventDefault();
      const cell = $(ev.currentTarget);
      let row = parseInt(cell.data("row"));
      let col = parseInt(cell.data("col"));
      if (Number.isNaN(row) || Number.isNaN(col)) return;
      await this.actor.setPeasantHpGridCell?.(row, col, 0);
      this.render(false);
    });

    // STRESS - Add Box
    html.find(".stress-add").click(async (ev) => {
      const stressType = $(ev.currentTarget).data("stress-type");
      await this.actor.resizePeasantStressGrid?.(stressType, 1);
    });

    // STRESS - Remove Box
    html.find(".stress-remove").click(async (ev) => {
      const stressType = $(ev.currentTarget).data("stress-type");
      await this.actor.resizePeasantStressGrid?.(stressType, -1);
    });

    // STRESS CELL CLICK - Cycle through damage states
    html.find(".stress-cell").click(async (ev) => {
      ev.preventDefault();
      const cell = ev.currentTarget;
      const stressType = cell.dataset.stressType;
      const index = parseInt(cell.dataset.index);
      if (!stressType || Number.isNaN(index)) return;
      await this.actor.cyclePeasantStressCell?.(stressType, index);
    });

    // STRESS CELL RIGHT-CLICK - Reset to regular
    html.find(".stress-cell").on("contextmenu", async (ev) => {
      ev.preventDefault();
      const cell = ev.currentTarget;
      const stressType = cell.dataset.stressType;
      const index = parseInt(cell.dataset.index);
      if (!stressType || Number.isNaN(index)) return;
      await this.actor.setPeasantStressCell?.(stressType, index, 0);
    });

    html.find(".pc-stress-bar-section").on("click", async (ev) => {
      ev.preventDefault();
      const stressType = ev.currentTarget?.dataset?.stressType;
      if (!stressType) return;
      await this._applyStressDamage(stressType, 1);
      this.render(false);
    });

    html.find(".pc-stress-bar-section").on("contextmenu", async (ev) => {
      ev.preventDefault();
      const stressType = ev.currentTarget?.dataset?.stressType;
      if (!stressType) return;
      await this._applyStressHeal(stressType, 1);
      this.render(false);
    });

    // STRESS DAMAGE/HEAL TOGGLES
    html.find(".stress-damage-toggle").click((ev) => {
      const stressType = $(ev.currentTarget).data("stress-type");
      this.valueStressType = stressType;
      const label = `${String(stressType || "stress").charAt(0).toUpperCase()}${String(stressType || "stress").slice(1)} Stress`;
      html.find(".stress-damage-title").text(`Take ${label}`);
      const controls = html.find(".stress-damage-controls");
      const opening = controls.hasClass("hidden");
      controls.toggleClass("hidden");
      if (opening) this._positionSheetPopupNearTrigger(html, ".stress-damage-controls", ev.currentTarget);
    });

    html.find(".close-stress-damage").click(() => {
      html.find(".stress-damage-controls").addClass("hidden");
    });

    html.find(".stress-heal-toggle").click((ev) => {
      const stressType = $(ev.currentTarget).data("stress-type");
      this.valueStressType = stressType;
      const label = `${String(stressType || "stress").charAt(0).toUpperCase()}${String(stressType || "stress").slice(1)} Stress`;
      html.find(".stress-heal-title").text(`Heal ${label}`);
      const controls = html.find(".stress-heal-controls");
      const opening = controls.hasClass("hidden");
      controls.toggleClass("hidden");
      if (opening) this._positionSheetPopupNearTrigger(html, ".stress-heal-controls", ev.currentTarget);
    });

    html.find(".close-stress-heal").click(() => {
      html.find(".stress-heal-controls").addClass("hidden");
    });

    // REFRESH STRESS (Reset to 0)
    html.find(".stress-refresh").click(async (ev) => {
        const stressType = $(ev.currentTarget).data("stress-type");
        await this.actor.refreshPeasantStressTrack?.(stressType);
    });

    // APPLY STRESS DAMAGE
    html.find(".apply-stress-damage").click(async () => {
      const amount = Number(html.find("[name=stressAmount]").val()) || 0;
      const stressType = this.valueStressType;
      if (!stressType || amount <= 0) return;
      await this._applyStressDamage(stressType, amount);
      this.render(false);
    });

    // APPLY STRESS HEALING
    html.find(".apply-stress-heal").click(async () => {
      const amount = Number(html.find("[name=stressHealAmount]").val()) || 0;
      const stressType = this.valueStressType;
      if (!stressType || amount <= 0) return;
      await this._applyStressHeal(stressType, amount);
      this.render(false);
    });

    // RESOURCE REFRESH
    html.find(".resource-refresh").click(async (ev) => {
      const resourceName = $(ev.currentTarget).data("resource");
      await this.actor.refreshPeasantResource?.(resourceName);
    });

    // TOGGLE DAMAGE PANEL
    html.find(".damage-toggle").click((ev) => {
      const controls = html.find(".damage-controls");
      const opening = controls.hasClass("hidden");
      controls.toggleClass("hidden");
      if (opening) this._positionSheetPopupNearTrigger(html, ".damage-controls", ev.currentTarget);
    });

    // CLOSE DAMAGE PANEL
    html.find(".close-damage").click(() => {
      html.find(".damage-controls").addClass("hidden");
    });

    // APPLY DAMAGE
    html.find(".apply-damage").click(async () => {
      const type = html.find("[name=damageType]").val();
      const amount = Number(html.find("[name=damageAmount]").val());
      const location = html.find("[name=damageLocation]").val() || "Torso";
      const isAP = html.find("[name=damageAP]").is(":checked");
      const useArmorCharge = html.find("[name=damageArmorCharge]").is(":checked");
      const result = await applyTargetedDamageWorkflow(this.actor, {
        amount,
        type,
        location,
        isAP,
        useArmorCharge,
        chatSpeaker: ChatMessage.getSpeaker({ actor: this.actor })
      });
      if (!result.ok) {
        ui.notifications?.warn?.(result.message || "Failed to apply damage.");
        return;
      }
      this.render(false);
    });

    // TOGGLE HEAL PANEL
    html.find(".heal-toggle").click((ev) => {
      const controls = html.find(".heal-controls");
      const opening = controls.hasClass("hidden");
      controls.toggleClass("hidden");
      if (opening) this._positionSheetPopupNearTrigger(html, ".heal-controls", ev.currentTarget);
    });

    // CLOSE HEAL PANEL
    html.find(".close-heal").click(() => {
      html.find(".heal-controls").addClass("hidden");
    });

    // APPLY HEAL - Temporary Heal and Greater Heal implementation
    html.find(".apply-heal").click(async () => {
      const amount = Number(html.find("[name=healAmount]").val()) || 0;
      const healType = html.find("[name=healType]").val(); // "temporary" or "greater"
      if (!amount) return;
      const result = typeof this.actor.applyPeasantHeal === "function"
        ? await this.actor.applyPeasantHeal(amount, healType)
        : { ok: false, message: "Peasant Core healing workflow is not available for this actor." };
      if (!result.ok) ui.notifications?.warn?.(result.message);
      this.render(false);
    });

    // ----- BLESSING POPUP LISTENERS -----
    // Open Blessing popup when clicking attribute label text (span). Use delegated handler so it always attaches
    html.on("click", ".attr-label[data-attr] > span, .attr-label[data-attr]", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      

      // Only open blessing menu in edit mode
      if (!this.isEditMode) return;

      const $label = $(ev.currentTarget).closest(".attr-label[data-attr]");
      const attr = $label.data("attr"); // build/reflex/intuition/learn/charisma

      const menu = html.find(".blessing-menu");
      if (!menu.length) {
        pcLog.debug('Blessing menu element not found in DOM');
        return; // no menu present in template
      }

      // Anchor the blessing menu inside the attributes table so positioning is reliable.
      const container = html.find('.attributes-table');
      if (container.length) {
        // Move the menu into the attributes table so absolute positioning is relative to it
        menu.appendTo(container);
        // Make the menu visible offscreen (hidden) so we can measure its size reliably even if it was hidden
        menu.css({ position: 'absolute', display: 'block', visibility: 'hidden' });
        const labelPos = $label.position();
        const nudgeDown = 12; // pixels to nudge the popup downward from the label
        // Measure after forcing display so sizes are available
        const menuWidth = menu.outerWidth() || 260;
        const menuHeight = menu.outerHeight() || 160;
        const containerWidth = container.innerWidth() || html.width() || 720;

        // Default left anchored to label left, clamp inside container
        let left = Math.min(containerWidth - menuWidth - 6, Math.max(6, (labelPos.left || 0)));
        let top = (labelPos.top || 0) + $label.outerHeight() + nudgeDown;

        // If the menu would overlap the bottom of the container, try placing it above the label
        const containerHeight = container.innerHeight() || html.height() || 700;
        if (top + menuHeight > containerHeight - 6) {
          // place above label
          top = Math.max(6, (labelPos.top || 0) - menuHeight - 6);
        }

        // Apply final position and reveal
        menu.css({ position: 'absolute', top: `${Math.round(top)}px`, left: `${Math.round(left)}px`, visibility: '', display: '' });
      } else {
        // Fallback to sheet-relative positioning if attributes table isn't found
        const sheetOffset = html.offset() || { top: 0, left: 0 };
        const labelOffset = $label.offset() || { top: 0, left: 0 };
        const extraOffset = 18;
        const top = (labelOffset.top - sheetOffset.top) + $label.outerHeight() + 6 + extraOffset;
        let left = (labelOffset.left - sheetOffset.left) || 0;
        const menuWidth = menu.outerWidth() || 260;
        const containerWidth = html.width() || (html[0] && html[0].clientWidth) || 720;
        left = Math.min(containerWidth - menuWidth - 10, Math.max(6, left));
        const menuHeight = menu.outerHeight() || 200;
        const containerHeight = html.height() || (html[0] && html[0].clientHeight) || 700;
        const maxTop = Math.max(6, containerHeight - menuHeight - 10);
        const finalTop = Math.min(maxTop, top);
        menu.css({ top: `${finalTop}px`, left: `${left}px`, position: 'absolute' });
      }

      // Load current blessing state
      const blessing = this.actor.system.blessing || { type: "", target: "" };
      menu.find("input[name=blessingType]").prop("checked", false);
      if (blessing.type) menu.find(`input[name=blessingType][value=${blessing.type}]`).prop("checked", true);
      // Store the target attribute on the menu DOM (hidden input was removed)
      menu.data('blessingTarget', blessing.target || attr);

      // Ensure the Apply button is visible/enabled
      try {
        menu.find('.apply-blessing').prop('disabled', false).show();
      } catch (err) {
        pcLog.debug('Blessing menu apply button missing or cannot be shown', err);
      }

      // Remove hidden class and explicitly set display to flex to ensure visibility
      menu.removeClass("hidden");
      if (menu[0]) menu[0].style.display = '';
      
    });

    // CHARACTERISTIC TO-HIT PENALTY TOGGLE
    html.on("click", ".characteristic-label", async (ev) => {
      try {
        if (!this.isEditMode) return;
        ev.preventDefault();
        ev.stopPropagation();

        const el = $(ev.currentTarget);
        const characteristic = el.data('characteristic'); // Strength, Dexterity, Mental, Social

        try {
          const result = await this.actor.togglePeasantToHitPenaltyTarget?.(characteristic);
          const newTarget = result?.target ?? "";

          // Update DOM 
          try {
            const labels = html.find('.characteristic-label');
            const tohitEls = html.find('.attr-tohit-clickable'); 

            // Toggle blessed class on characteristic labels
            labels.removeClass('blessed');
            if (newTarget) {
              const targetLabel = html.find(`.characteristic-label[data-characteristic="${newTarget}"]`);
              targetLabel.addClass('blessed');
            }

            // Recompute the to-hit values locally and update the displayed text
            const build = this.actor.system.build || 0;
            const reflex = this.actor.system.reflex || 0;
            const intuition = this.actor.system.intuition || 0;
            const learn = this.actor.system.learn || 0;
            const charisma = this.actor.system.charisma || 0;

            const blessing = this.actor.system.blessing || { type: null, target: null };
            const isSummer = blessing.type === 'summer' && blessing.target;
            const blessedValue = isSummer ? ( { build, reflex, intuition, learn, charisma }[blessing.target] || 0 ) : 0;

            const strBase = isSummer ? (22 - build - reflex - blessedValue) : (18 - build - reflex);
            const dexBase = isSummer ? (22 - reflex - intuition - blessedValue) : (18 - reflex - intuition);
            const mntBase = isSummer ? (22 - intuition - learn - blessedValue) : (18 - intuition - learn);
            const socBase = isSummer ? (22 - intuition - charisma - blessedValue) : (18 - intuition - charisma);

            const strVal = (newTarget === 'Strength') ? (strBase - 1) : strBase;
            const dexVal = (newTarget === 'Dexterity') ? (dexBase - 1) : dexBase;
            const mntVal = (newTarget === 'Mental') ? (mntBase - 1) : mntBase;
            const socVal = (newTarget === 'Social') ? (socBase - 1) : socBase;

            const mapping = {
              'Strength': strVal,
              'Dexterity': dexVal,
              'Mental': mntVal,
              'Social': socVal
            };

            Object.keys(mapping).forEach(char => {
              const val = mapping[char];
              const sel = `.attr-tohit-clickable[data-characteristic="${char}"]`;
              const el = html.find(sel);
              if (el.length) {
                el.text(`${val}+`);
              }
            });
          } catch (domErr) {
            // DOM fallback failed silently
          }

        } catch (err) {
          console.warn('Failed to update toHitPenaltyTarget', err);
        }
        // Re-render and re-fetch data so getData uses the updated actor state
        await this.render(true);
      } catch (err) {
        console.error('Error handling characteristic-label click:', err);
      }
    });

    // Make blessing type inputs behave like single-choice (allow clearing)
    // Use 'change' event so the checked state is stable when handler runs.
    html.find(".blessing-menu").on("change", "input[name=blessingType]", (ev) => {
      const $input = $(ev.currentTarget);
      const menu = $input.closest(".blessing-menu");
      const isChecked = $input.is(":checked");
      if (isChecked) {
        // Uncheck others
        menu.find("input[name=blessingType]").not($input).prop("checked", false);
        // Keep the stored blessing target (user clicked attribute to open menu). Do not clear it when switching types.
      } else {
        // If current was unchecked, only clear stored target if no other type remains checked.
        const anyChecked = menu.find("input[name=blessingType]:checked").length > 0;
        if (!anyChecked) menu.data('blessingTarget', '');
      }
    });

    // Clear blessing (explicit button in popup)
    html.find(".blessing-menu").on("click", ".clear-blessing", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const menu = html.find('.blessing-menu');
      try {
        await this.actor.clearPeasantBlessing?.();
      } catch (err) {
        console.warn('Failed to clear blessing:', err);
      }
      menu.addClass('hidden');
      this.render(false);
    });

    // Close blessing
    html.find(".blessing-menu").on("click", ".close-blessing", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      html.find(".blessing-menu").addClass("hidden");
    });

    // Clear blessing
    // (Clear button removed from template; no handler required)

    // Apply blessing
    html.find(".blessing-menu").on("click", ".apply-blessing", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const menu = html.find(".blessing-menu");
      const chosenType = menu.find("input[name=blessingType]:checked").val() || "";
      // read the stored target from the menu data attribute
      const chosenTarget = menu.data('blessingTarget') || "";

      if (chosenType && (chosenType === "spring" || chosenType === "fall" || chosenType === "summer")) {
        if (!chosenTarget) {
          ui.notifications.warn("Please select a basic attribute target for this Blessing.");
          return;
        }
      }

      // Ensure we always write an object matching the schema instead of null
      await this.actor.setPeasantBlessing?.(chosenType, chosenTarget);

      menu.addClass("hidden");
      this.render(false);
    });

    setupSheetDraggablePopups(html);

    setupPortraitControls(this, html);

    // Ensure skill and advantage add/delete handlers are bound (delegated so they survive re-renders)
    html.on("click", ".add-skill-btn", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!this.isEditMode) return;
      await blurActiveEditableInSheet();
      await enqueueSheetUpdate('_skillsSaveQueue', 'Skill add', async () => {
        await this.actor.addPeasantSkill?.();
      });
      this.render(true);
    });

    // SKILL TYPE TOGGLE: Switch from standard to special skill type
    html.on("click", ".skill-toggle-type", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!this.isEditMode) return;
      await blurActiveEditableInSheet();
      const row = $(ev.currentTarget).closest('.skill-item');
      let index = parseInt(row.attr('data-skill-index'));
      if (Number.isNaN(index)) index = row.index();
      if (Number.isNaN(index)) return;

      await enqueueSheetUpdate('_skillsSaveQueue', 'Skill type toggle', async () => {
        await this.actor.setPeasantSkillType?.(index, "Other");
      });
      this.render(true);
    });

    // SKILL TYPE SELECT: Handle dropdown change for special skill types (including switching back to standard)
    html.on("change", ".skill-select", async (ev) => {
      if (!this.isEditMode) return;
      const select = $(ev.currentTarget);
      const newType = select.val() || 'standard';
      const row = select.closest('.skill-item');
      let index = parseInt(row.attr('data-skill-index'));
      if (Number.isNaN(index)) index = row.index();
      if (Number.isNaN(index)) return;

      await enqueueSheetUpdate('_skillsSaveQueue', 'Skill type select', async () => {
        await this.actor.setPeasantSkillType?.(index, newType);
      });
      this.render(true);
    });


    // VIEW SKILL DESCRIPTION (view mode popup showing existing description)
    // Support both wrapper-based and span-based markup so click keeps working across template revisions.
    html.on('click', '.skill-name-wrapper, .skill-name-view.skill-has-desc', async (ev) => {
      try {
        ev.preventDefault();
        ev.stopPropagation();
        const $current = $(ev.currentTarget);
        const $target = $(ev.target);
        const $wrapper = $current.hasClass('skill-name-wrapper') ? $current : $current.closest('.skill-name-wrapper');
        const $nameSpan = $current.hasClass('skill-name-view') ? $current : $current.find('.skill-name-view.skill-has-desc').first();

        // Prefer wrapper data-index, then fallback to span data-index for older cached templates.
        let index = Number($wrapper.data('index'));
        if (Number.isNaN(index)) index = Number($nameSpan.data('index'));
        if (Number.isNaN(index)) index = Number($target.closest('.skill-name-view.skill-has-desc').data('index'));
        if (Number.isNaN(index)) return;

        const skills = this.actor.system.skills || [];
        const skill = skills[index] || {};
        const description = skill.description || '';
        const skillName = skill.name || 'Skill';

        await showReadonlyDescriptionDialog(this, {
          title: `${skillName} â€” Description`,
          description
        });
      } catch (e) {
        pcLog.debug('skill-name-view click failed', e);
      }
    });

    // Skills now use inline tooltip markup (same behavior/style path as notable combats).
    // Keep the legacy global tooltip code disabled to avoid duplicate tooltip rendering.
    const useLegacyGlobalSkillTooltip = false;
    if (useLegacyGlobalSkillTooltip) {
      // Create or get the global skill tooltip element (appended to document.body to escape overflow)
      let $globalTooltip = $(sheetBody).find('#peasant-skill-tooltip');
      if (!$globalTooltip.length) {
        $globalTooltip = $('<div id="peasant-skill-tooltip" class="skill-tooltip"></div>');
        $(sheetBody).append($globalTooltip);
      }

      // Populate tooltip content for each skill with description
      const skillTooltipContent = {};
      html.find('.skill-name-view.skill-has-desc').each(async (i, el) => {
        try {
          const $el = $(el);
          const index = Number($el.data('index'));
          if (Number.isNaN(index)) return;

          const skills = this.actor.system.skills || [];
          const skill = skills[index] || {};
          const description = skill.description || '';
          const skillName = skill.name || 'Skill';

          // Check if description has actual text content
          const descriptionText = description.replace(/<[^>]*>/g, '').trim();
          if (!descriptionText) return;

          // Enrich the HTML content
          const enrichedContent = await TextEditorImplementation.enrichHTML(description, { async: true });
          
          // Store content keyed by actor+index for lookup on hover
          const key = `${this.actor.id}-${index}`;
          skillTooltipContent[key] = `<div class="skill-tooltip-header">${escapeHtml(skillName)}</div><div class="skill-tooltip-content">${enrichedContent}</div>`;
          $el.attr('data-tooltip-key', key);
        } catch (e) {
          pcLog.debug('skill tooltip content prep failed', e);
        }
      });

      // Show tooltip on hover
      html.on('mouseenter', '.skill-name-view.skill-has-desc', function(ev) {
        try {
          const $el = $(this);
          const key = $el.attr('data-tooltip-key');
          const content = skillTooltipContent[key];
          if (!content) {
            pcLog.debug('No tooltip content found for key:', key);
            return;
          }

          const rect = this.getBoundingClientRect();
          
          // Set content and position offscreen to measure (use display:block instead of visibility)
          $globalTooltip.html(content);
          $globalTooltip.css({ left: '-9999px', top: '-9999px', display: 'block', visibility: 'hidden', opacity: '' });
          
          const tooltipWidth = $globalTooltip.outerWidth();
          const tooltipHeight = $globalTooltip.outerHeight();
          
          // Position below the skill name
          let left = rect.left;
          let top = rect.bottom + 8;
          
          // Adjust if would go off right edge
          if (left + tooltipWidth > window.innerWidth - 10) {
            left = window.innerWidth - tooltipWidth - 10;
          }
          
          // Adjust if would go off bottom - show above instead
          if (top + tooltipHeight > window.innerHeight - 10) {
            top = rect.top - tooltipHeight - 8;
          }
          
          // Ensure doesn't go off left or top
          if (left < 10) left = 10;
          if (top < 10) top = 10;
          
          // Apply final position and make visible (clear inline visibility/opacity so CSS class works)
          $globalTooltip.css({ left: left + 'px', top: top + 'px', visibility: '', opacity: '' });
          $globalTooltip.addClass('visible');
        } catch (e) {
          pcLog.debug('tooltip show failed', e);
        }
      });

      html.on('mouseleave', '.skill-name-view.skill-has-desc', function(ev) {
        $globalTooltip.removeClass('visible').css({ visibility: '', opacity: '', display: '' });
      });

      // Also show tooltip on focus for keyboard navigation (skill-name-wrapper has tabindex)
      html.on('focusin', '.skill-name-wrapper[tabindex]', function(ev) {
        try {
          const $wrapper = $(this);
          const $el = $wrapper.find('.skill-name-view.skill-has-desc');
          if (!$el.length) return;
          
          const key = $el.attr('data-tooltip-key');
          const content = skillTooltipContent[key];
          if (!content) return;

          const rect = this.getBoundingClientRect();
          
          // Set content and position offscreen to measure
          $globalTooltip.html(content);
          $globalTooltip.css({ left: '-9999px', top: '-9999px', display: 'block', visibility: 'hidden', opacity: '' });
          
          const tooltipWidth = $globalTooltip.outerWidth();
          const tooltipHeight = $globalTooltip.outerHeight();
          
          // Position below the skill name
          let left = rect.left;
          let top = rect.bottom + 8;
          
          // Adjust if would go off right edge
          if (left + tooltipWidth > window.innerWidth - 10) {
            left = window.innerWidth - tooltipWidth - 10;
          }
          
          // Adjust if would go off bottom - show above instead
          if (top + tooltipHeight > window.innerHeight - 10) {
            top = rect.top - tooltipHeight - 8;
          }
          
          // Ensure doesn't go off left or top
          if (left < 10) left = 10;
          if (top < 10) top = 10;
          
          // Apply final position and make visible
          $globalTooltip.css({ left: left + 'px', top: top + 'px', visibility: '', opacity: '' });
          $globalTooltip.addClass('visible');
        } catch (e) {
          pcLog.debug('tooltip focusin show failed', e);
        }
      });

      html.on('focusout', '.skill-name-wrapper[tabindex]', function(ev) {
        $globalTooltip.removeClass('visible').css({ visibility: '', opacity: '', display: '' });
      });
    }

    // Drag & drop reordering for skills list
    html.on('dragstart', '.skills-list .skill-item', (ev) => {
      try {
        const el = $(ev.currentTarget);
        let index = parseInt(el.attr('data-skill-index'));
        if (Number.isNaN(index)) index = el.index();
        if (Number.isNaN(index)) return;
        const dt = ev.originalEvent.dataTransfer;
        if (dt) {
          dt.effectAllowed = 'move';
          dt.setData('text/plain', String(index));
        }
        el.addClass('dragging');
        try { el.css('opacity', '0.5'); } catch (e) {}

        // Prepare a placeholder element for HTML5 drag flows but do NOT insert it
        // immediately after the dragged element (that produced an undesired bar).
        try {
          if (this._skillDragState && this._skillDragState.placeholder) {
            try { this._skillDragState.placeholder.remove(); } catch (e) {}
            this._skillDragState = null;
          }
          const placeholder = $(`<div class="skill-placeholder" style="height: 8px; background: rgba(33,150,243,0.6); border-radius: 4px; margin: 6px 0; width: calc(100% - 12px);"></div>`);
          placeholder.css('pointer-events', 'none');
          // Do not append now. The placeholder will be inserted during dragover
          // only when the computed insertion index differs from the original.
          this._skillDragState = { fromIndex: index, placeholder, placeholderInserted: false };
          pcLog.debug('skill dragstart prepared placeholder at', index);
        } catch (phErr) { pcLog.debug('failed to prepare drag placeholder', phErr); }

      } catch (e) { pcLog.debug('skill dragstart failed', e); }
    });

    html.on('dragend', '.skills-list .skill-item', (ev) => {
      try {
        $(ev.currentTarget).removeClass('dragging');
        if (this._skillDragState && this._skillDragState.placeholder) {
          this._skillDragState.placeholder.remove();
          this._skillDragState = null;
        }
        try { $(ev.currentTarget).css('opacity', ''); } catch (e) {}
      } catch (e) {}
    });
    // Clear any drag-over classes when leaving the list
    html.on('dragleave', '.skills-list', (ev) => {
      try { this._getSheetJQ().find('.skills-list .skill-item').removeClass('drag-over-top drag-over-bottom'); } catch (e) {}
    });

    // Allow dropping anywhere in the skills list or on individual items
    html.on('dragover', '.skills-list, .skills-list .skill-item', (ev) => {
      try {
        ev.preventDefault();
        const dt = ev.originalEvent.dataTransfer;
        if (dt) dt.dropEffect = 'move';

        // Move HTML5 placeholder based on pointer location
        try {
          const x = ev.originalEvent.clientX; const y = ev.originalEvent.clientY;
          const el = sheetDocument.elementFromPoint(x, y);
          if (!el) return;
          const $closest = $(el).closest('.skills-list .skill-item');
          const items = this._getSheetJQ().find('.skills-list .skill-item');
          // Use visual drag-over classes instead of relying solely on an inserted placeholder.
          // Avoid marking the original dragged element so the current location isn't highlighted.
          if (!this._skillDragState) return;
          let toIndex;
          if ($closest.length) {
            toIndex = parseInt($closest.attr('data-skill-index')); if (Number.isNaN(toIndex)) toIndex = $closest.index();
          } else {
            toIndex = items.length;
          }
          if (Number.isNaN(toIndex)) return;
          // Clear previous markers
          items.removeClass('drag-over-top drag-over-bottom');
          const fromIndex = Number.isFinite(parseInt(this._skillDragState.fromIndex)) ? parseInt(this._skillDragState.fromIndex) : null;
          // Don't highlight insertion that equals the original item's location
          if (fromIndex !== null && (toIndex === fromIndex || toIndex === fromIndex + 1)) {
            return;
          }
          if (toIndex >= items.length) {
            // indicate insertion after last item
            if (items.length) items.last().addClass('drag-over-bottom');
          } else {
            items.eq(toIndex).addClass('drag-over-top');
          }
        } catch (mErr) { /* ignore */ }

      } catch (e) {}
    });

    html.on('drop', '.skills-list, .skills-list .skill-item', async (ev) => {
      try {
        ev.preventDefault(); ev.stopPropagation();
        const data = ev.originalEvent.dataTransfer.getData('text/plain');
        const fromIndex = Number.isFinite(parseInt(data)) ? parseInt(data) : null;
        if (fromIndex === null) return;

        const dropTarget = $(ev.target).closest('.skill-item');
        let toIndex = null;
        if (dropTarget.length) {
          toIndex = parseInt(dropTarget.attr('data-skill-index'));
          if (Number.isNaN(toIndex)) toIndex = dropTarget.index();
        } else {
          // If dropped on empty area, append to end
          toIndex = html.find('.skills-list .skill-item').length - 1 + 1;
        }
        if (Number.isNaN(toIndex)) return;

        // cleanup placeholder if present
        try { if (this._skillDragState && this._skillDragState.placeholder) { this._skillDragState.placeholder.remove(); this._skillDragState = null; } } catch (e) {}
        await this.actor.reorderPeasantSkill?.(fromIndex, toIndex);
        this.render(true);
      } catch (e) {
        console.warn('Failed to reorder skills via drag/drop:', e);
      }
    });

    // Indent / Outdent handlers
    html.on('click', '.skill-indent', async (ev) => {
      try {
        ev.preventDefault(); ev.stopPropagation();
        if (!this.isEditMode) return;
        await blurActiveEditableInSheet();
        const row = $(ev.currentTarget).closest('.skill-item');
        let index = parseInt(row.attr('data-skill-index'));
        if (Number.isNaN(index)) index = row.index();
        if (Number.isNaN(index)) return;
        await enqueueSheetUpdate('_skillsSaveQueue', 'Skill indent', async () => {
          await this.actor.changePeasantSkillIndent?.(index, 1);
        });
        this.render(true);
      } catch (e) { pcLog.debug('skill indent failed', e); }
    });

    html.on('click', '.skill-outdent', async (ev) => {
      try {
        ev.preventDefault(); ev.stopPropagation();
        if (!this.isEditMode) return;
        await blurActiveEditableInSheet();
        const row = $(ev.currentTarget).closest('.skill-item');
        let index = parseInt(row.attr('data-skill-index'));
        if (Number.isNaN(index)) index = row.index();
        if (Number.isNaN(index)) return;
        await enqueueSheetUpdate('_skillsSaveQueue', 'Skill outdent', async () => {
          await this.actor.changePeasantSkillIndent?.(index, -1);
        });
        this.render(true);
      } catch (e) { pcLog.debug('skill outdent failed', e); }
    });

    html.on("click", ".skill-delete", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!this.isEditMode) return;
      await blurActiveEditableInSheet();
      const row = $(ev.currentTarget).closest('.skill-item');
      let index = parseInt(row.attr('data-skill-index'));
      if (Number.isNaN(index)) index = row.index();
      if (Number.isNaN(index)) return;
      await enqueueSheetUpdate('_skillsSaveQueue', 'Skill delete', async () => {
        await this.actor.removePeasantSkill?.(index);
      });
      this.render(true);
    });

    html.on("click", ".add-advantage-btn", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!this.isEditMode) return;
      await blurActiveEditableInSheet();
      await enqueueSheetUpdate('_advantageSaveQueue', 'Advantage add', async () => {
        const adv = collectAdvantagesFromDOM();
        await this.actor.addPeasantFlexibleAdvantage?.(adv.names, adv.descriptions);
      });
      this.render(true);
    });

    // Open/Edit skill description (edit mode) - delegated so it survives re-renders
    // Uses Foundry v13+/v14 ProseMirror editor API
    const openSkillDescEditor = async (index) => {
      try {
        if (Number.isNaN(index) || index === undefined || index === null) return;
        
        // Debug: log what we're reading from the actor
        pcLog.debug('Opening skill description editor for index:', index);
        pcLog.debug('Actor system.skills:', this.actor.system.skills);
        pcLog.debug('Skill at index:', this.actor.system.skills?.[index]);
        
        const skillData = this.actor.system.skills?.[index] || {};
        const existing = skillData.description || '';
        const skillName = skillData.name || 'Skill';
        
        pcLog.debug('Existing description:', existing);

        // Store reference to sheet for callbacks
        const sheet = this;

        // Build a floating editor container
        const containerId = `peasant-skill-desc-${this.id}-${index}-container`;
        const editorId = `peasant-skill-desc-${this.id}-${index}`;
        
        // Remove any prior instance
        $(`#${containerId}`).remove();
        // Build the container with Foundry-style editor structure
        // Smaller window, draggable header, close button top-right, save/cancel at bottom
        const $container = $(`
          <div id="${containerId}" class="peasant-skill-floating app window-app application peasant-core" style="position:fixed;top:15%;left:50%;transform:translateX(-50%);width:580px;max-width:90%;z-index:4000;background:#1a1a1a;border:1px solid #444;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,0.7);overflow:visible;">
            <header class="window-header flexrow peasant-skill-drag-handle peasant-desc-header">
              <h4 class="window-title popup-handle-title">Skill Description: ${escapeHtml(skillName)}</h4>
              <button type="button" class="peasant-skill-close header-control icon fa-solid fa-xmark" title="Close" aria-label="Close"></button>
            </header>
            <div class="window-content" style="padding:12px;background:#1a1a1a;">
              <div class="form-group">
                <prose-mirror name="skillDescription" class="inventory-editor peasant-desc-editor" data-document-uuid="${sheet.actor?.uuid || ""}"></prose-mirror>
              </div>
            </div>
            <footer class="window-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:10px 12px;border-top:1px solid #333;background:#222;border-radius:0 0 8px 8px;">
              <button type="button" class="peasant-skill-save" style="background:#16a34a;color:white;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;font-weight:bold;">Save</button>
              <button type="button" class="peasant-skill-cancel" style="background:#8b0000;color:white;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;">Cancel</button>
            </footer>
          </div>
        `);

        $(sheetBody).append($container);

        // Make the window draggable by the header
        const containerEl = $container[0];
        const headerEl = $container.find('.peasant-skill-drag-handle')[0];
        let isDragging = false;
        let dragOffsetX = 0;
        let dragOffsetY = 0;

        headerEl.addEventListener('mousedown', (e) => {
          if (e.target.closest('.peasant-skill-close')) return; // Don't drag when clicking close
          isDragging = true;
          const rect = containerEl.getBoundingClientRect();
          dragOffsetX = e.clientX - rect.left;
          dragOffsetY = e.clientY - rect.top;
          containerEl.style.transform = 'none'; // Remove the centering transform
          containerEl.style.left = rect.left + 'px';
          containerEl.style.top = rect.top + 'px';
          e.preventDefault();
        });

        sheetDocument.addEventListener('mousemove', (e) => {
          if (!isDragging) return;
          containerEl.style.left = (e.clientX - dragOffsetX) + 'px';
          containerEl.style.top = (e.clientY - dragOffsetY) + 'px';
        });

        sheetDocument.addEventListener('mouseup', () => {
          isDragging = false;
        });






        const proseMirrorEl = $container.find('prose-mirror[name="skillDescription"]')[0];
        if (proseMirrorEl && (typeof proseMirrorEl.value !== 'undefined')) {
          proseMirrorEl.value = existing;
        } else {
          const $fallback = $(`<textarea id="${editorId}-fallback" style="width:100%;height:280px;background:transparent;color:#e0e0e0;border:none;padding:10px;border-radius:0;resize:vertical;font-family:inherit;">${escapeHtml(existing)}</textarea>`);
          $container.find('.form-group').empty().append($fallback);
        }

        // Save handler
        $container.on('click', '.peasant-skill-save', async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          
          let newContent = '';
          
          try {
            if (proseMirrorEl && (typeof proseMirrorEl.value !== 'undefined')) {
              newContent = String(proseMirrorEl.value ?? '');
            } else {
              const $fallback = $container.find(`#${editorId}-fallback`);
              if ($fallback.length) newContent = String($fallback.val() || '');
            }
          } catch (getContentErr) {
            console.warn('Error getting editor content:', getContentErr);
            const $fallback = $container.find(`#${editorId}-fallback`);
            if ($fallback.length) newContent = String($fallback.val() || '');
          }

          pcLog.debug('Saving skill description, content:', newContent);
          pcLog.debug('Saving skill description, content length:', newContent.length);

          try {
            pcLog.debug('Updating actor with skill description for index:', index);
            const result = await sheet.actor.setPeasantSkillDescription?.(index, newContent);
            pcLog.debug('Actor update complete');
            
            if (result?.skills) sheet._lastSkillsSnapshot = JSON.parse(JSON.stringify(result.skills));
          } catch (saveErr) {
            console.error('Failed to save skill description:', saveErr);
            ui.notifications?.error?.('Failed to save skill description. See console for details.');
          }

          // Cleanup and close
          $container.remove();
          sheet.render(false);
        });

        // Cancel handler
        $container.on('click', '.peasant-skill-cancel', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          $container.remove();
        });

        // Close button (X) handler - same as cancel
        $container.on('click', '.peasant-skill-close', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          $container.remove();
        });

        // Close on ESC
        const escHandler = (ev) => {
          if (ev.key === 'Escape') {
            $container.remove();
            sheetDocument.removeEventListener('keydown', escHandler);
          }
        };
        sheetDocument.addEventListener('keydown', escHandler);

      } catch (e) { pcLog.debug('openSkillDescEditor failed', e); }
    };

    html.on('click', '.skill-desc-btn', async (ev) => {
      try {
        ev.preventDefault(); ev.stopPropagation();
        if (!this.isEditMode) return;
        const btn = $(ev.currentTarget);
        const row = btn.closest('.skill-item');
        let index = parseInt(row.attr('data-skill-index'));
        if (Number.isNaN(index)) index = row.index();
        if (Number.isNaN(index)) return;
        pcLog.debug('Opening skill description editor for index', index);
        await openSkillDescEditor(index);
      } catch (e) { pcLog.debug('skill-desc-btn handler failed', e); }
    });

    // Also bind to currently-rendered buttons as a fallback
    try {
      html.find('.skill-desc-btn').off('click').click((ev) => {
        try {
          ev.preventDefault(); ev.stopPropagation();
          const btn = $(ev.currentTarget);
          const row = btn.closest('.skill-item');
          let index = parseInt(row.attr('data-skill-index'));
          if (Number.isNaN(index)) index = row.index();
          if (Number.isNaN(index)) return;
          openSkillDescEditor(index);
        } catch (e) { pcLog.debug('fallback skill-desc click failed', e); }
      });
    } catch (e) { /* ignore */ }

    // Open/Edit flexible advantage description (edit mode)
    const openAdvantageDescEditor = async (index) => {
      try {
        if (Number.isNaN(index) || index === undefined || index === null) return;

        const advantageEntry = this.actor.system.flexibleAdvantages?.[index];
        const advantageName = (typeof advantageEntry === 'string'
          ? advantageEntry
          : String(advantageEntry?.name ?? '')
        ).trim() || 'Flexible Advantage';
        const existingDescription = String(this.actor.system.flexibleAdvantageDescriptions?.[index] ?? '');
        const sheet = this;

        const containerId = `peasant-adv-desc-${this.id}-${index}-container`;
        const editorId = `peasant-adv-desc-${this.id}-${index}`;
        $(`#${containerId}`).remove();

        const $container = $(`
          <div id="${containerId}" class="peasant-skill-floating app window-app application peasant-core" style="position:fixed;top:15%;left:50%;transform:translateX(-50%);width:580px;max-width:90%;z-index:4000;background:#1a1a1a;border:1px solid #444;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,0.7);overflow:visible;">
            <header class="window-header flexrow peasant-skill-drag-handle peasant-desc-header">
              <h4 class="window-title popup-handle-title">Flexible Advantage Description: ${escapeHtml(advantageName)}</h4>
              <button type="button" class="peasant-skill-close header-control icon fa-solid fa-xmark" title="Close" aria-label="Close"></button>
            </header>
            <div class="window-content" style="padding:12px;background:#1a1a1a;">
              <div class="form-group">
                <prose-mirror name="advantageDescription" class="inventory-editor peasant-desc-editor" data-document-uuid="${sheet.actor?.uuid || ""}"></prose-mirror>
              </div>
            </div>
            <footer class="window-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:10px 12px;border-top:1px solid #333;background:#222;border-radius:0 0 8px 8px;">
              <button type="button" class="peasant-skill-save" style="background:#16a34a;color:white;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;font-weight:bold;">Save</button>
              <button type="button" class="peasant-skill-cancel" style="background:#8b0000;color:white;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;">Cancel</button>
            </footer>
          </div>
        `);

        const $popupHost = getApplicationJQuery(sheet);
        const $host = $popupHost.length ? $popupHost : $(sheetBody);
        $host.append($container);

        const containerEl = $container[0];
        const headerEl = $container.find('.peasant-skill-drag-handle')[0];
        let isDragging = false;
        let dragOffsetX = 0;
        let dragOffsetY = 0;

        headerEl.addEventListener('mousedown', (e) => {
          if (e.target.closest('.peasant-skill-close')) return;
          isDragging = true;
          const rect = containerEl.getBoundingClientRect();
          dragOffsetX = e.clientX - rect.left;
          dragOffsetY = e.clientY - rect.top;
          containerEl.style.transform = 'none';
          containerEl.style.left = `${rect.left}px`;
          containerEl.style.top = `${rect.top}px`;
          e.preventDefault();
        });

        const onMove = (e) => {
          if (!isDragging) return;
          containerEl.style.left = `${e.clientX - dragOffsetX}px`;
          containerEl.style.top = `${e.clientY - dragOffsetY}px`;
        };
        const onUp = () => { isDragging = false; };
        sheetDocument.addEventListener('mousemove', onMove);
        sheetDocument.addEventListener('mouseup', onUp);

        const proseMirrorEl = $container.find('prose-mirror[name="advantageDescription"]')[0];
        if (proseMirrorEl && (typeof proseMirrorEl.value !== 'undefined')) {
          proseMirrorEl.value = existingDescription;
        } else {
          const $fallback = $(`<textarea id="${editorId}-fallback" style="width:100%;height:280px;background:transparent;color:#e0e0e0;border:none;padding:10px;border-radius:0;resize:vertical;font-family:inherit;">${escapeHtml(existingDescription)}</textarea>`);
          $container.find('.form-group').empty().append($fallback);
        }

        let escHandler = null;
        const cleanup = () => {
          if (escHandler) {
            sheetDocument.removeEventListener('keydown', escHandler);
            escHandler = null;
          }
          sheetDocument.removeEventListener('mousemove', onMove);
          sheetDocument.removeEventListener('mouseup', onUp);
          $container.remove();
        };

        $container.on('click', '.peasant-skill-save', async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();

          let newContent = '';
          try {
            if (proseMirrorEl && (typeof proseMirrorEl.value !== 'undefined')) {
              newContent = String(proseMirrorEl.value ?? '');
            } else {
              const $fallback = $container.find(`#${editorId}-fallback`);
              if ($fallback.length) newContent = String($fallback.val() || '');
            }
          } catch (getContentErr) {
            console.warn('Error getting advantage description content:', getContentErr);
          }

          try {
            await sheet.actor.setPeasantFlexibleAdvantageDescription?.(index, newContent);

            // Keep current DOM row in sync until next render.
            const row = sheet._getSheetJQ().find(`.advantage-item[data-advantage-index="${index}"]`);
            row.find('.advantage-description-hidden').val(newContent);
          } catch (saveErr) {
            console.error('Failed to save flexible advantage description:', saveErr);
            ui.notifications?.error?.('Failed to save flexible advantage description.');
          }

          cleanup();
          sheet.render(false);
        });

        $container.on('click', '.peasant-skill-cancel', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          cleanup();
        });

        $container.on('click', '.peasant-skill-close', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          cleanup();
        });

        escHandler = (ev) => {
          if (ev.key === 'Escape') {
            cleanup();
          }
        };
        sheetDocument.addEventListener('keydown', escHandler);
      } catch (e) {
        pcLog.debug('openAdvantageDescEditor failed', e);
      }
    };

    html.on('click', '.advantage-desc-btn', async (ev) => {
      try {
        ev.preventDefault();
        ev.stopPropagation();
        if (!this.isEditMode) return;
        const btn = $(ev.currentTarget);
        const row = btn.closest('.advantage-item');
        let index = parseInt(row.attr('data-advantage-index'));
        if (Number.isNaN(index)) index = row.index();
        if (Number.isNaN(index)) return;
        await openAdvantageDescEditor(index);
      } catch (e) {
        pcLog.debug('advantage-desc-btn handler failed', e);
      }
    });

    // VIEW FLEXIBLE ADVANTAGE DESCRIPTION (view mode popup)
    html.on('click', '.advantage-name-wrapper, .advantage-name-view.advantage-has-desc', async (ev) => {
      try {
        ev.preventDefault();
        ev.stopPropagation();
        const $current = $(ev.currentTarget);
        const $target = $(ev.target);
        const $wrapper = $current.hasClass('advantage-name-wrapper') ? $current : $current.closest('.advantage-name-wrapper');
        const $nameSpan = $current.hasClass('advantage-name-view') ? $current : $current.find('.advantage-name-view.advantage-has-desc').first();

        let index = Number($wrapper.data('index'));
        if (Number.isNaN(index)) index = Number($nameSpan.data('index'));
        if (Number.isNaN(index)) index = Number($target.closest('.advantage-name-view.advantage-has-desc').data('index'));
        if (Number.isNaN(index)) return;

        const names = this.actor.system.flexibleAdvantages || [];
        const descriptions = this.actor.system.flexibleAdvantageDescriptions || [];
        const nameEntry = names[index];
        const advantageName = (typeof nameEntry === 'string'
          ? nameEntry
          : String(nameEntry?.name ?? '')
        ).trim() || 'Flexible Advantage';
        const description = String(descriptions[index] ?? '');

        await showReadonlyDescriptionDialog(this, {
          title: `${advantageName} - Description`,
          description
        });
      } catch (e) {
        pcLog.debug('advantage-name-view click failed', e);
      }
    });

    // SIG checkbox immediate persistence - listen for change (fires after DOM state updates)
    html.on('change', '.skill-sig-checkbox', async (ev) => {
      if (!this.isEditMode) return;
      try {
        await enqueueSheetUpdate('_skillsSaveQueue', 'Skill sig change', async () => {
          const cb = $(ev.currentTarget);
          const row = cb.closest('.skill-item');
          let index = parseInt(row.attr('data-skill-index'));
          if (Number.isNaN(index)) index = row.index();
          // Build skills array from DOM to capture current values
          const skillEls = this._getSheetJQ().find('.skills-list .skill-item') || [];
          const skills = [];
          // Snapshot existing actor skills so we can preserve usesCurrent if present
          const existing = JSON.parse(JSON.stringify(this.actor.system.skills || []));
          for (let i = 0; i < skillEls.length; i++) {
            const el = skillEls[i];
            const $el = $(el);
            const hasSelect = $el.find('.skill-select').length > 0;
            const isStandard = !hasSelect;
                  if (isStandard) {
              const base = existing[i] || {};
              const cls = parseInt($el.find('.skill-class').val()) || 1;
              // Handle 'u' or 'U' rank for untrained skills
              const rkRaw = ($el.find('.skill-rank').val() || '').trim();
              let rk;
              if (rkRaw.toLowerCase() === 'u') {
                rk = rkRaw; // Preserve 'u' or 'U'
              } else {
                const rkNum = parseInt(rkRaw);
                rk = Number.isNaN(rkNum) ? (base.rank ?? 0) : rkNum;
              }
              const sigVal = !!$el.find('.skill-sig-checkbox').is(':checked');
              const usesMaxInput = $el.find('.skill-uses-max');
              const usesMaxVal = usesMaxInput.length ? (Number.isNaN(parseInt(usesMaxInput.val())) ? 0 : parseInt(usesMaxInput.val())) : (base.usesMax || 0);
              const usesCurrentInput = $el.find('.skill-uses-current');
              // Preserve existing current uses if present; otherwise fall back to existing or max
              const usesCurrentVal = usesCurrentInput.length ? (Number.isNaN(parseInt(usesCurrentInput.val())) ? 0 : parseInt(usesCurrentInput.val())) : (base.usesCurrent !== undefined ? base.usesCurrent : (usesMaxVal || 0));
              const baseGrade = Number.isNaN(parseInt(base.specialGrade)) ? 0 : parseInt(base.specialGrade);
              skills.push({
                type: 'standard',
                class: cls,
                specialGrade: baseGrade,
                rank: rk,
                sig: sigVal,
                name: $el.find('.skill-name').val() || '',
                tohit: $el.find('.skill-tohit').val() || '',
                accuracy: $el.find('.skill-accuracy').val() || '',
                ap: $el.find('.skill-ap').val() || '',
                sp: $el.find('.skill-sp').val() || '',
                usesMax: usesMaxVal,
                usesCurrent: usesCurrentVal,
                indent: parseInt($el.attr('data-indent')) || 0,
                description: base.description || ''
              });
            } else {
              const base = existing[i] || {};
              const typeVal = $el.find('.skill-select').val() || 'standard';
              const gradeInput = $el.find('.skill-special-grade');
              const baseGrade = Number.isNaN(parseInt(base.specialGrade)) ? 0 : parseInt(base.specialGrade);
              const gradeVal = gradeInput.length ? (Number.isNaN(parseInt(gradeInput.val())) ? 0 : parseInt(gradeInput.val())) : baseGrade;
              skills.push({
                type: typeVal,
                specialGrade: Math.max(0, gradeVal),
                name: $el.find('.skill-name').val() || '',
                tohit: $el.find('.skill-tohit').val() || '',
                accuracy: $el.find('.skill-accuracy').val() || '',
                ap: $el.find('.skill-ap').val() || '',
                sp: $el.find('.skill-sp').val() || '',
                indent: parseInt($el.attr('data-indent')) || 0,
                description: base.description || ''
              });
            }
          }

          // Local snapshot to avoid render race
          this._lastSkillsSnapshot = skills;

          // Debug: show what we are about to persist for SIG
          try { pcLog.debug('SIG click persist: index', index, 'skills snapshot:', skills.map(s=>({name: s.name, sig: s.sig, usesCurrent: s.usesCurrent}))); } catch(e){}

          // Attempt to update actor with full array
          pcLog.debug('SIG persist update payload:', skills);
          try {
            const result = await this.actor.setPeasantSkills?.(skills);
            if (result?.skills) this._lastSkillsSnapshot = JSON.parse(JSON.stringify(result.skills));
          } catch (updateErr) {
            console.warn('SIG persist update failed:', updateErr);
            ui.notifications?.error?.('Failed to save signature toggle. See console for details.');
            throw updateErr;
          }
          // Debug: verify actor saved
          try { pcLog.debug('SIG click persist complete; actor.skills now:', this.actor.system.skills.map(s=>({name: s.name, sig: s.sig, usesCurrent: s.usesCurrent}))); } catch(e){}

          // Re-render to reflect persisted state
          this.render(true);
        });
      } catch (err) {
        console.warn('Failed to persist SIG checkbox click:', err);
      }
    });

    // Persist Uses max per-field when edited in edit-mode
    html.on('change', '.skill-uses-max', async (ev) => {
      const input = $(ev.currentTarget);
      // Only allow edits in edit mode
      if (!this.isEditMode) return;

      const index = resolveItemIndex(input, { dataKey: 'index', rowSelector: '.skill-item', rowAttr: 'data-skill-index' });
      if (index < 0) return;

      const val = Number.isNaN(parseInt(input.val())) ? 0 : parseInt(input.val());
      try {
        await runQueuedInputUpdate(input, '_skillsSaveQueue', 'Skill usesMax change', async () => {
          const result = await this.actor.setPeasantSkillUsesMax?.(index, val, { render: false });
          if (result?.skills) this._lastSkillsSnapshot = JSON.parse(JSON.stringify(result.skills));
        });
      } catch (err) {
        console.warn('Failed to persist usesMax change (per-field):', err);
      }
    });

    // Persist to-hit and accuracy per-field when edited in edit-mode
    html.on('change', '.skill-tohit, .skill-accuracy', async (ev) => {
      const input = $(ev.currentTarget);
      if (!this.isEditMode) return;

      const index = resolveItemIndex(input, { dataKey: 'index', rowSelector: '.skill-item', rowAttr: 'data-skill-index' });
      if (index < 0) return;
      const row = input.closest('.skill-item');

      try {
        await runQueuedInputUpdate(input, '_skillsSaveQueue', 'Skill to-hit/accuracy change', async () => {
          // Update only the changed field(s)
          const tohitEl = row.find('.skill-tohit');
          const accEl = row.find('.skill-accuracy');
          const currentSkill = this.actor.system.skills?.[index] || {};
          const tohitVal = tohitEl.length ? (tohitEl.val() || '') : (currentSkill.tohit || '');
          const accValRaw = accEl.length ? accEl.val() : (currentSkill.accuracy || '');
          const accVal = (accValRaw === '' || accValRaw === null) ? '' : String(accValRaw);

          pcLog.debug('Persisting skill tohit/accuracy (index):', index, { tohit: tohitVal, accuracy: accVal });
          const result = await this.actor.setPeasantSkillToHitAccuracy?.(index, { tohit: tohitVal, accuracy: accVal }, { render: false });
          if (result?.skills) this._lastSkillsSnapshot = JSON.parse(JSON.stringify(result.skills));
        });
      } catch (err) {
        console.warn('Failed to persist skill tohit/accuracy change (per-field):', err);
      }
    });

    // Persist Uses current per-field when edited (allowed in view mode)
    html.on('change', '.skill-uses-current', async (ev) => {
      const input = $(ev.currentTarget);

      const idx = resolveItemIndex(input, { dataKey: 'index', rowSelector: '.skill-item', rowAttr: 'data-skill-index' });
      if (idx < 0) return;

      const raw = Number.isNaN(parseInt(input.val())) ? 0 : parseInt(input.val());

      try {
        await runQueuedInputUpdate(input, '_skillsSaveQueue', 'Skill usesCurrent change', async () => {
          const result = await this.actor.setPeasantSkillUsesCurrent?.(idx, raw, { render: false });
          if (result?.skills) this._lastSkillsSnapshot = JSON.parse(JSON.stringify(result.skills));
        });
      } catch (err) {
        console.warn('Failed to persist usesCurrent change (per-field):', err);
      }
    });

    // Persist skill class, rank, name, ap, sp per-field when edited in edit-mode
    html.on('change', '.skill-class, .skill-rank, .skill-name, .skill-ap, .skill-sp, .skill-special-grade', async (ev) => {
      const input = $(ev.currentTarget);
      if (!this.isEditMode) return;

      const index = resolveItemIndex(input, { dataKey: 'index', rowSelector: '.skill-item', rowAttr: 'data-skill-index' });
      if (index < 0) return;
      const row = input.closest('.skill-item');

      try {
        await runQueuedInputUpdate(input, '_skillsSaveQueue', 'Skill main field change', async () => {
          // Read all editable fields from this row
          const classEl = row.find('.skill-class');
          const rankEl = row.find('.skill-rank');
          const nameEl = row.find('.skill-name');
          const apEl = row.find('.skill-ap');
          const spEl = row.find('.skill-sp');
          const specialGradeEl = row.find('.skill-special-grade');

          const fields = {};
          if (classEl.length) fields.class = classEl.val();
          if (rankEl.length) fields.rank = rankEl.val();
          if (nameEl.length) fields.name = nameEl.val();
          if (apEl.length) fields.ap = apEl.val();
          if (spEl.length) fields.sp = spEl.val();
          if (specialGradeEl.length) fields.specialGrade = specialGradeEl.val();

          pcLog.debug('Persisting skill class/rank/name/ap/sp (index):', index, fields);
          const result = await this.actor.setPeasantSkillMainFields?.(index, fields, { render: false });
          if (result?.skills) this._lastSkillsSnapshot = JSON.parse(JSON.stringify(result.skills));
        });
      } catch (err) {
        console.warn('Failed to persist skill class/rank/name/ap/sp change:', err);
      }
    });

    html.on("click", ".advantage-delete", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!this.isEditMode) return;
      const li = $(ev.currentTarget).closest('.advantage-item');
      let index = parseInt(li.attr('data-advantage-index'));
      if (Number.isNaN(index)) index = li.index();
      if (Number.isNaN(index)) return;
      await blurActiveEditableInSheet();
      await enqueueSheetUpdate('_advantageSaveQueue', 'Advantage delete', async () => {
        const adv = collectAdvantagesFromDOM();
        await this.actor.removePeasantFlexibleAdvantage?.(index, adv.names, adv.descriptions);
      });
      this.render(true);
    });

    // Persist flexible advantage changes on input change
    html.on('change', '.advantage-input', async (ev) => {
      if (!this.isEditMode) return;
      const input = $(ev.currentTarget);
      let index = parseInt(input.data('index'));
      if (Number.isNaN(index)) {
        const li = input.closest('.advantage-item');
        index = parseInt(li.attr('data-advantage-index'));
        if (Number.isNaN(index)) index = li.index();
      }
      if (Number.isNaN(index)) return;
      await enqueueSheetUpdate('_advantageSaveQueue', 'Advantage field change', async () => {
        const adv = collectAdvantagesFromDOM();
        while (adv.names.length <= index) adv.names.push('');
        while (adv.descriptions.length <= index) adv.descriptions.push('');
        await this.actor.setPeasantFlexibleAdvantages?.(adv.names, adv.descriptions, { render: false });
      });
    });

    // Drag & drop reordering for advantages list
    html.on('dragstart', '.advantages-list .advantage-item', (ev) => {
      try {
        if (!this.isEditMode) return;
        const el = $(ev.currentTarget);
        let index = parseInt(el.attr('data-advantage-index'));
        if (Number.isNaN(index)) index = el.index();
        if (Number.isNaN(index)) return;
        const dt = ev.originalEvent.dataTransfer;
        if (dt) {
          dt.effectAllowed = 'move';
          dt.setData('text/plain', `adv:${index}`);
        }
        el.addClass('dragging');
        this._advDragState = { fromIndex: index };
      } catch (e) { pcLog.debug('advantage dragstart failed', e); }
    });

    html.on('dragend', '.advantages-list .advantage-item', (ev) => {
      try {
        $(ev.currentTarget).removeClass('dragging');
        this._advDragState = null;
        this._getSheetJQ().find('.advantages-list .advantage-item').removeClass('drag-over-top drag-over-bottom');
      } catch (e) {}
    });

    html.on('dragover', '.advantages-list, .advantages-list .advantage-item', (ev) => {
      try {
        if (!this.isEditMode) return;
        ev.preventDefault();
        const dt = ev.originalEvent.dataTransfer;
        if (dt) dt.dropEffect = 'move';

        const x = ev.originalEvent.clientX; const y = ev.originalEvent.clientY;
        const el = sheetDocument.elementFromPoint(x, y);
        if (!el) return;
        const $closest = $(el).closest('.advantages-list .advantage-item');
        const items = this._getSheetJQ().find('.advantages-list .advantage-item');
        items.removeClass('drag-over-top drag-over-bottom');

        if (!this._advDragState) return;
        let toIndex;
        if ($closest.length) {
          toIndex = parseInt($closest.attr('data-advantage-index'));
          if (Number.isNaN(toIndex)) toIndex = $closest.index();
        } else {
          toIndex = items.length;
        }
        if (Number.isNaN(toIndex)) return;

        const fromIndex = this._advDragState.fromIndex;
        if (fromIndex !== null && (toIndex === fromIndex || toIndex === fromIndex + 1)) return;

        if (toIndex >= items.length) {
          if (items.length) items.last().addClass('drag-over-bottom');
        } else {
          items.eq(toIndex).addClass('drag-over-top');
        }
      } catch (e) {}
    });

    html.on('dragleave', '.advantages-list', (ev) => {
      try { this._getSheetJQ().find('.advantages-list .advantage-item').removeClass('drag-over-top drag-over-bottom'); } catch (e) {}
    });

    html.on('drop', '.advantages-list, .advantages-list .advantage-item', async (ev) => {
      try {
        if (!this.isEditMode) return;
        ev.preventDefault(); ev.stopPropagation();
        const data = ev.originalEvent.dataTransfer.getData('text/plain');
        if (!data.startsWith('adv:')) return;
        const fromIndex = parseInt(data.replace('adv:', ''));
        if (Number.isNaN(fromIndex)) return;

        const dropTarget = $(ev.target).closest('.advantage-item');
        let toIndex = null;
        if (dropTarget.length) {
          toIndex = parseInt(dropTarget.attr('data-advantage-index'));
          if (Number.isNaN(toIndex)) toIndex = dropTarget.index();
        } else {
          toIndex = html.find('.advantages-list .advantage-item').length;
        }
        if (Number.isNaN(toIndex)) return;

        await blurActiveEditableInSheet();
        await enqueueSheetUpdate('_advantageSaveQueue', 'Advantage reorder', async () => {
          const adv = collectAdvantagesFromDOM();
          this._advDragState = null;
          await this.actor.reorderPeasantFlexibleAdvantage?.(fromIndex, toIndex, adv.names, adv.descriptions);
        });
        this.render(true);
      } catch (e) {
        console.warn('Failed to reorder advantages via drag/drop:', e);
      }
    });

    // Pointer-based drag reorder for advantages (fallback for drag handle)
    try {
      const sheet = this;
      let advPointerDragState = null;

      html.on('pointerdown', '.advantage-drag-handle', (ev) => {
        try {
          if (!sheet?.isEditMode) return;
          ev.preventDefault(); ev.stopPropagation();
          const handle = $(ev.currentTarget);
          const row = handle.closest('.advantage-item');
          let fromIndex = parseInt(row.attr('data-advantage-index'));
          if (Number.isNaN(fromIndex)) fromIndex = row.index();
          if (Number.isNaN(fromIndex)) return;

          row.addClass('dragging');

          const previousUserSelect = sheetBody.style.userSelect;
          sheetBody.style.userSelect = 'none';

          advPointerDragState = { fromIndex, draggedEl: row, targetIndex: fromIndex, previousUserSelect };

          const onMove = (moveEv) => {
            try {
              const x = moveEv.clientX; const y = moveEv.clientY;
              const el = sheetDocument.elementFromPoint(x, y);
              if (!el) return;
              const $closest = $(el).closest('.advantages-list .advantage-item');
              const items = sheet.element.find('.advantages-list .advantage-item');
              
              // Clear all drag-over classes first
              items.removeClass('drag-over-top drag-over-bottom');
              
              let toIndex = null;
              if ($closest.length) {
                toIndex = parseInt($closest.attr('data-advantage-index'));
                if (Number.isNaN(toIndex)) toIndex = $closest.index();
              } else {
                toIndex = items.length;
              }
              if (Number.isNaN(toIndex)) return;

              const from = advPointerDragState.fromIndex;
              const isOriginalPos = (from !== null && (toIndex === from || toIndex === from + 1));

              if (isOriginalPos) {
                advPointerDragState.targetIndex = toIndex;
                return;
              }

              // Apply CSS class to indicate drop position
              if (toIndex >= items.length) {
                if (items.length) items.last().addClass('drag-over-bottom');
              } else {
                items.eq(toIndex).addClass('drag-over-top');
              }
              advPointerDragState.targetIndex = toIndex;
            } catch (e) { /* ignore */ }
          };

          const onUp = async (upEv) => {
            try {
              sheetDocument.removeEventListener('mousemove', onMove);
              sheetDocument.removeEventListener('mouseup', onUp);
              if (!advPointerDragState) return;
              const { fromIndex: f, targetIndex: t, draggedEl: dr, previousUserSelect: prev } = advPointerDragState;
              dr.removeClass('dragging');
              sheet.element.find('.advantages-list .advantage-item').removeClass('drag-over-top drag-over-bottom');
              advPointerDragState = null;
              sheetBody.style.userSelect = prev || '';

              let toIndex = Math.max(0, Number.parseInt(t, 10) || 0);
              const effectiveIndex = f < toIndex ? toIndex - 1 : toIndex;
              if (f === effectiveIndex) return;

              await blurActiveEditableInSheet();
              await enqueueSheetUpdate('_advantageSaveQueue', 'Advantage pointer reorder', async () => {
                const adv = collectAdvantagesFromDOM();
                await sheet.actor.reorderPeasantFlexibleAdvantage?.(f, toIndex, adv.names, adv.descriptions);
              });
              sheet.render(true);
            } catch (e) { console.warn('Pointer drag reorder for advantages failed', e); }
          };

          sheetDocument.addEventListener('mousemove', onMove);
          sheetDocument.addEventListener('mouseup', onUp);
        } catch (e) { pcLog.debug('advantage drag mousedown failed', e); }
      });
    } catch (e) { /* ignore */ }

    // ========== NOTABLE COMBATS HANDLERS ==========

    // Add Notable Combat
    html.on("click", ".add-combat-btn", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!this.isEditMode) return;
      await blurActiveEditableInSheet();
      await enqueueSheetUpdate('_combatSaveQueue', 'Combat add', async () => {
        await this.actor.addPeasantNotableCombat?.({ render: false });
      });
      this.render(true);
    });

    // Combat type toggle: Switch from standard to special type
    html.on("click", ".combat-toggle-type", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!this.isEditMode) return;
      await blurActiveEditableInSheet();
      const row = $(ev.currentTarget).closest('.combat-item');
      let index = parseInt(row.attr('data-combat-index'));
      if (Number.isNaN(index)) index = row.index();
      if (Number.isNaN(index)) return;
      await enqueueSheetUpdate('_combatSaveQueue', 'Combat type toggle', async () => {
        await this.actor.setPeasantNotableCombatType?.(index, "Other", { clearStandardFields: true, render: false });
      });
      this.render(true);
    });

    // Combat type select: Handle dropdown change
    html.on("change", ".combat-select", async (ev) => {
      if (!this.isEditMode) return;
      const select = $(ev.currentTarget);
      const newType = select.val() || 'standard';
      const row = select.closest('.combat-item');
      let index = parseInt(row.attr('data-combat-index'));
      if (Number.isNaN(index)) index = row.index();
      if (Number.isNaN(index)) return;
      await enqueueSheetUpdate('_combatSaveQueue', 'Combat type select', async () => {
        await this.actor.setPeasantNotableCombatType?.(index, newType, { render: false });
      });
      this.render(true);
    });

    // Delete Combat
    html.on("click", ".combat-delete", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!this.isEditMode) return;
      await blurActiveEditableInSheet();
      const row = $(ev.currentTarget).closest('.combat-item');
      let index = parseInt(row.attr('data-combat-index'));
      if (Number.isNaN(index)) index = row.index();
      if (Number.isNaN(index)) return;
      await enqueueSheetUpdate('_combatSaveQueue', 'Combat delete', async () => {
        await this.actor.removePeasantNotableCombat?.(index, { render: false });
      });
      this.render(true);
    });

    // Combat Indent/Outdent
    html.on('click', '.combat-indent', async (ev) => {
      try {
        ev.preventDefault(); ev.stopPropagation();
        if (!this.isEditMode) return;
        await blurActiveEditableInSheet();
        const row = $(ev.currentTarget).closest('.combat-item');
        let index = parseInt(row.attr('data-combat-index'));
        if (Number.isNaN(index)) index = row.index();
        if (Number.isNaN(index)) return;
        await enqueueSheetUpdate('_combatSaveQueue', 'Combat indent', async () => {
          await this.actor.changePeasantNotableCombatIndent?.(index, 1, { render: false });
        });
        this.render(true);
      } catch (e) { pcLog.debug('combat indent failed', e); }
    });

    html.on('click', '.combat-outdent', async (ev) => {
      try {
        ev.preventDefault(); ev.stopPropagation();
        if (!this.isEditMode) return;
        await blurActiveEditableInSheet();
        const row = $(ev.currentTarget).closest('.combat-item');
        let index = parseInt(row.attr('data-combat-index'));
        if (Number.isNaN(index)) index = row.index();
        if (Number.isNaN(index)) return;
        await enqueueSheetUpdate('_combatSaveQueue', 'Combat outdent', async () => {
          await this.actor.changePeasantNotableCombatIndent?.(index, -1, { render: false });
        });
        this.render(true);
      } catch (e) { pcLog.debug('combat outdent failed', e); }
    });

    // Combat SIG checkbox persistence
    html.on('change', '.combat-sig-checkbox', async (ev) => {
      if (!this.isEditMode) return;
      try {
        await enqueueSheetUpdate('_combatSaveQueue', 'Combat sig change', async () => {
          const cb = $(ev.currentTarget);
          const index = resolveItemIndex(cb, { dataKey: 'index', rowSelector: '.combat-item', rowAttr: 'data-combat-index' });
          if (index < 0) return;

          await this.actor.setPeasantNotableCombatSig?.(index, cb.is(':checked'), { render: false });
        });
      } catch (err) {
        console.warn('Failed to persist combat sig change:', err);
      }
    });

    // Combat field persistence (class, rank, name, tohit, accuracy)
    html.on('change', '.combat-class, .combat-rank, .combat-name, .combat-tohit, .combat-accuracy, .combat-special-grade', async (ev) => {
      const input = $(ev.currentTarget);
      if (!this.isEditMode) return;

      const index = resolveItemIndex(input, { dataKey: 'index', rowSelector: '.combat-item', rowAttr: 'data-combat-index' });
      if (index < 0) return;
      const row = input.closest('.combat-item');

      try {
        await runQueuedInputUpdate(input, '_combatSaveQueue', 'Combat main field change', async () => {
          const classEl = row.find('.combat-class');
          const rankEl = row.find('.combat-rank');
          const nameEl = row.find('.combat-name');
          const tohitEl = row.find('.combat-tohit');
          const accuracyEl = row.find('.combat-accuracy');
          const specialGradeEl = row.find('.combat-special-grade');

          const fields = {};
          if (classEl.length) fields.class = classEl.val();
          if (rankEl.length) fields.rank = rankEl.val();
          if (nameEl.length) fields.name = nameEl.val();
          if (tohitEl.length) fields.tohit = tohitEl.val();
          if (accuracyEl.length) fields.accuracy = accuracyEl.val();
          if (specialGradeEl.length) fields.specialGrade = specialGradeEl.val();

          await this.actor.setPeasantNotableCombatMainFields?.(index, fields, { render: false });
        });
      } catch (err) {
        console.warn('Failed to persist combat field change:', err);
      }
    });

    // Combat uses max persistence (edit mode)
    html.on('change', '.combat-uses-max', async (ev) => {
      const input = $(ev.currentTarget);
      if (!this.isEditMode) return;

      const index = resolveItemIndex(input, { dataKey: 'index', rowSelector: '.combat-item', rowAttr: 'data-combat-index' });
      if (index < 0) return;

      try {
        await runQueuedInputUpdate(input, '_combatSaveQueue', 'Combat usesMax change', async () => {
          await this.actor.setPeasantNotableCombatUsesMax?.(index, input.val(), { render: false });
        });
      } catch (err) {
        console.warn('Failed to persist combat usesMax change:', err);
      }
    });

    // Combat uses current persistence (view mode)
    html.on('change', '.combat-uses-current', async (ev) => {
      const input = $(ev.currentTarget);

      const idx = resolveItemIndex(input, { dataKey: 'index', rowSelector: '.combat-item', rowAttr: 'data-combat-index' });
      if (idx < 0) return;

      const raw = parseInt(input.val()) || 0;

      try {
        await runQueuedInputUpdate(input, '_combatSaveQueue', 'Combat usesCurrent change', async () => {
          await this.actor.setPeasantNotableCombatUsesCurrent?.(idx, raw, { render: false });
        });
      } catch (err) {
        console.warn('Failed to persist combat usesCurrent change:', err);
      }
    });

    // Combat tag sections current persistence (view mode)
    html.on('change', '.combat-tag-sections-current', async (ev) => {
      const input = $(ev.currentTarget);

      const idx = resolveCombatTagInputIndex(input);
      if (idx < 0) return;

      const raw = parseInt(input.val()) || 0;

      try {
        await runQueuedInputUpdate(input, '_combatSaveQueue', 'Combat sections current change', async () => {
          await this.actor.setPeasantNotableCombatSectionsCurrent?.(idx, raw, { render: false });
        });
      } catch (err) {
        console.warn('Failed to persist combat sections current change:', err);
      }
    });

    // Combat tag Split Second current persistence (view mode)
    html.on('change', '.combat-tag-splitsecond-current', async (ev) => {
      const input = $(ev.currentTarget);

      const idx = resolveCombatTagInputIndex(input);
      if (idx < 0) return;

      const raw = parseInt(input.val()) || 0;

      try {
        await runQueuedInputUpdate(input, '_combatSaveQueue', 'Combat split second current change', async () => {
          await this.actor.setPeasantNotableCombatSplitSecondCurrent?.(idx, raw, { render: false });
        });
      } catch (err) {
        console.warn('Failed to persist combat split second current change:', err);
      }
    });

    // Combat tag drag-to-reorder in view mode
    html.on('dragstart', '.combat-tag-draggable', (ev) => {
      try {
        const $el = $(ev.currentTarget);
        const tagType = $el.data('tag-type');
        const rawCustomIndex = $el.data('custom-index');
        const customIndex = Number.isInteger(rawCustomIndex) ? rawCustomIndex : parseInt(rawCustomIndex, 10);
        const tagKey = String($el.data('tag-key') || (tagType === 'custom' && !Number.isNaN(customIndex) ? `custom:${customIndex}` : String(tagType || '')));
        const container = $el.closest('.combat-tags-inline');
        const combatIdx = parseInt(container.attr('data-combat-index'));
        
        if (!tagType || !tagKey || Number.isNaN(combatIdx)) return;
        
        $el.addClass('dragging');
        ev.originalEvent.dataTransfer.effectAllowed = 'move';
        ev.originalEvent.dataTransfer.setData('text/plain', `tag:${combatIdx}:${tagKey}`);
        
        this._tagDragState = { combatIndex: combatIdx, tagType, tagKey, customIndex: Number.isNaN(customIndex) ? -1 : customIndex };
      } catch (e) { pcLog.debug('tag dragstart failed', e); }
    });

    html.on('dragend', '.combat-tag-draggable', (ev) => {
      try {
        $(ev.currentTarget).removeClass('dragging');
        html.find('.combat-tag-draggable').removeClass('drag-over-left drag-over-right');
        this._tagDragState = null;
      } catch (e) {}
    });

    html.on('dragover', '.combat-tag-draggable', (ev) => {
      try {
        ev.preventDefault();
        ev.originalEvent.dataTransfer.dropEffect = 'move';
        
        if (!this._tagDragState) return;
        
        const $el = $(ev.currentTarget);
        const container = $el.closest('.combat-tags-inline');
        const combatIdx = parseInt(container.attr('data-combat-index'));
        
        // Only allow reordering within the same combat
        if (combatIdx !== this._tagDragState.combatIndex) return;
        const targetRawCustomIndex = $el.data('custom-index');
        const targetCustomIndex = Number.isInteger(targetRawCustomIndex) ? targetRawCustomIndex : parseInt(targetRawCustomIndex, 10);
        const targetType = $el.data('tag-type');
        const targetKey = String($el.data('tag-key') || (targetType === 'custom' && !Number.isNaN(targetCustomIndex) ? `custom:${targetCustomIndex}` : String(targetType || '')));
        if (targetKey === this._tagDragState.tagKey) return;
        
        // Determine if dropping left or right
        const rect = ev.currentTarget.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        html.find('.combat-tag-draggable').removeClass('drag-over-left drag-over-right');
        
        if (ev.originalEvent.clientX < midX) {
          $el.addClass('drag-over-left');
        } else {
          $el.addClass('drag-over-right');
        }
      } catch (e) {}
    });

    html.on('dragleave', '.combat-tag-draggable', (ev) => {
      $(ev.currentTarget).removeClass('drag-over-left drag-over-right');
    });

    html.on('drop', '.combat-tag-draggable', async (ev) => {
      try {
        ev.preventDefault();
        html.find('.combat-tag-draggable').removeClass('drag-over-left drag-over-right');
        
        if (!this._tagDragState) return;
        
        const $el = $(ev.currentTarget);
        const container = $el.closest('.combat-tags-inline');
        const combatIdx = parseInt(container.attr('data-combat-index'));
        const targetType = $el.data('tag-type');
        const draggedType = this._tagDragState.tagType;
        const draggedKey = this._tagDragState.tagKey;
        const draggedCustomIndex = this._tagDragState.customIndex;
        const targetRawCustomIndex = $el.data('custom-index');
        const targetCustomIndex = Number.isInteger(targetRawCustomIndex) ? targetRawCustomIndex : parseInt(targetRawCustomIndex, 10);
        const targetKey = String($el.data('tag-key') || (targetType === 'custom' && !Number.isNaN(targetCustomIndex) ? `custom:${targetCustomIndex}` : String(targetType || '')));
        
        if (combatIdx !== this._tagDragState.combatIndex) return;
        if (targetKey === draggedKey) return;
        
        // Reorder within the customTags array when dragging one custom tag onto another custom tag.
        if (draggedType === 'custom' && targetType === 'custom' && !Number.isNaN(draggedCustomIndex) && !Number.isNaN(targetCustomIndex)) {
          const rect = ev.currentTarget.getBoundingClientRect();
          const midX = rect.left + rect.width / 2;
          const result = await this.actor.reorderPeasantNotableCombatCustomTag?.(combatIdx, draggedCustomIndex, targetCustomIndex, {
            insertAfter: ev.originalEvent.clientX >= midX,
            render: false
          });
          if (result?.changed) {
            this.render(false);
          }
          this._tagDragState = null;
          return;
        }
        
        // Determine if inserting before or after
        const rect = ev.currentTarget.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        const result = await this.actor.reorderPeasantNotableCombatTag?.(combatIdx, draggedType, targetType, {
          insertAfter: ev.originalEvent.clientX >= midX,
          render: false
        });
        if (result?.changed) this.render(false);
        
        this._tagDragState = null;
      } catch (e) {
        pcLog.debug('tag drop failed', e);
      }
    });

    // Combat drag & drop reordering
    html.on('dragstart', '.notable-combats-list .combat-item', (ev) => {
      try {
        const el = $(ev.currentTarget);
        let index = parseInt(el.attr('data-combat-index'));
        if (Number.isNaN(index)) index = el.index();
        if (Number.isNaN(index)) return;
        const dt = ev.originalEvent.dataTransfer;
        if (dt) {
          dt.effectAllowed = 'move';
          dt.setData('text/plain', `combat:${index}`);
        }
        el.addClass('dragging');
        this._combatDragState = { fromIndex: index };
      } catch (e) { pcLog.debug('combat dragstart failed', e); }
    });

    html.on('dragend', '.notable-combats-list .combat-item', (ev) => {
      try {
        $(ev.currentTarget).removeClass('dragging');
        this._combatDragState = null;
        this._getSheetJQ().find('.notable-combats-list .combat-item').removeClass('drag-over-top drag-over-bottom');
      } catch (e) {}
    });

    html.on('dragover', '.notable-combats-list, .notable-combats-list .combat-item', (ev) => {
      try {
        ev.preventDefault();
        const dt = ev.originalEvent.dataTransfer;
        if (dt) dt.dropEffect = 'move';

        const x = ev.originalEvent.clientX; const y = ev.originalEvent.clientY;
        const el = sheetDocument.elementFromPoint(x, y);
        if (!el) return;
        const $closest = $(el).closest('.notable-combats-list .combat-item');
        const items = this._getSheetJQ().find('.notable-combats-list .combat-item');
        items.removeClass('drag-over-top drag-over-bottom');

        if (!this._combatDragState) return;
        let toIndex;
        if ($closest.length) {
          toIndex = parseInt($closest.attr('data-combat-index'));
          if (Number.isNaN(toIndex)) toIndex = $closest.index();
        } else {
          toIndex = items.length;
        }
        if (Number.isNaN(toIndex)) return;

        const fromIndex = this._combatDragState.fromIndex;
        if (fromIndex !== null && (toIndex === fromIndex || toIndex === fromIndex + 1)) return;

        if (toIndex >= items.length) {
          if (items.length) items.last().addClass('drag-over-bottom');
        } else {
          items.eq(toIndex).addClass('drag-over-top');
        }
      } catch (e) {}
    });

    html.on('dragleave', '.notable-combats-list', (ev) => {
      try { this._getSheetJQ().find('.notable-combats-list .combat-item').removeClass('drag-over-top drag-over-bottom'); } catch (e) {}
    });

    html.on('drop', '.notable-combats-list, .notable-combats-list .combat-item', async (ev) => {
      try {
        ev.preventDefault(); ev.stopPropagation();
        const data = ev.originalEvent.dataTransfer.getData('text/plain');
        if (!data.startsWith('combat:')) return;
        const fromIndex = parseInt(data.replace('combat:', ''));
        if (Number.isNaN(fromIndex)) return;

        const dropTarget = $(ev.target).closest('.combat-item');
        let toIndex = null;
        if (dropTarget.length) {
          toIndex = parseInt(dropTarget.attr('data-combat-index'));
          if (Number.isNaN(toIndex)) toIndex = dropTarget.index();
        } else {
          toIndex = html.find('.notable-combats-list .combat-item').length;
        }
        if (Number.isNaN(toIndex)) return;

        this._combatDragState = null;
        await this.actor.reorderPeasantNotableCombat?.(fromIndex, toIndex, { render: false });
        this.render(true);
      } catch (e) {
        console.warn('Failed to reorder combats via drag/drop:', e);
      }
    });

    // Combat description editor
    const openCombatDescEditor = async (index, onSaveCallback) => {
      try {
        if (Number.isNaN(index) || index === undefined || index === null) return;
        
        const combatData = this.actor.system.notableCombats?.[index] || {};
        const existing = combatData.description || '';
        const combatName = combatData.name || 'Combat';
        
        const sheet = this;

        const containerId = `peasant-combat-desc-${this.id}-${index}-container`;
        const editorId = `peasant-combat-desc-${this.id}-${index}`;
        
        $(`#${containerId}`).remove();

        const $container = $(`
          <div id="${containerId}" class="peasant-skill-floating app window-app application peasant-core" style="position:fixed;top:15%;left:50%;transform:translateX(-50%);width:580px;max-width:90%;z-index:4000;background:#1a1a1a;border:1px solid #444;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,0.7);overflow:visible;">
            <header class="window-header flexrow peasant-combat-drag-handle peasant-desc-header">
              <h4 class="window-title popup-handle-title">Combat Description: ${escapeHtml(combatName)}</h4>
              <button type="button" class="peasant-combat-close header-control icon fa-solid fa-xmark" title="Close" aria-label="Close"></button>
            </header>
            <div class="window-content" style="padding:12px;background:#1a1a1a;">
              <div class="form-group">
                <prose-mirror name="combatDescription" class="inventory-editor peasant-desc-editor" data-document-uuid="${sheet.actor?.uuid || ""}"></prose-mirror>
              </div>
            </div>
            <footer class="window-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:10px 12px;border-top:1px solid #333;background:#222;border-radius:0 0 8px 8px;">
              <button type="button" class="peasant-combat-save" style="background:#16a34a;color:white;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;font-weight:bold;">Save</button>
              <button type="button" class="peasant-combat-cancel" style="background:#8b0000;color:white;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;">Cancel</button>
            </footer>
          </div>
        `);

        $(sheetBody).append($container);

        // Make draggable
        const containerEl = $container[0];
        const headerEl = $container.find('.peasant-combat-drag-handle')[0];
        let isDragging = false;
        let dragOffsetX = 0;
        let dragOffsetY = 0;

        headerEl.addEventListener('mousedown', (e) => {
          if (e.target.closest('.peasant-combat-close')) return;
          isDragging = true;
          const rect = containerEl.getBoundingClientRect();
          dragOffsetX = e.clientX - rect.left;
          dragOffsetY = e.clientY - rect.top;
          containerEl.style.transform = 'none';
          containerEl.style.left = rect.left + 'px';
          containerEl.style.top = rect.top + 'px';
          e.preventDefault();
        });

        sheetDocument.addEventListener('mousemove', (e) => {
          if (!isDragging) return;
          containerEl.style.left = (e.clientX - dragOffsetX) + 'px';
          containerEl.style.top = (e.clientY - dragOffsetY) + 'px';
        });

        sheetDocument.addEventListener('mouseup', () => {
          isDragging = false;
        });

        const proseMirrorEl = $container.find('prose-mirror[name="combatDescription"]')[0];
        if (proseMirrorEl && (typeof proseMirrorEl.value !== 'undefined')) {
          proseMirrorEl.value = existing;
        } else {
          const $fallback = $(`<textarea id="${editorId}-fallback" style="width:100%;min-height:200px;background:transparent;color:#e0e0e0;border:none;border-radius:0;padding:8px;resize:vertical;font-family:inherit;">${escapeHtml(existing)}</textarea>`);
          $container.find('.form-group').empty().append($fallback);
        }

        // Save handler
        $container.on('click', '.peasant-combat-save', async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();

          let newContent = '';
          try {
            if (proseMirrorEl && (typeof proseMirrorEl.value !== 'undefined')) {
              newContent = String(proseMirrorEl.value ?? '');
            } else {
              const $fallback = $container.find(`#${editorId}-fallback`);
              if ($fallback.length) newContent = String($fallback.val() || '');
            }
          } catch (getContentErr) {
            console.warn('Error getting combat editor content:', getContentErr);
            const $fallback = $container.find(`#${editorId}-fallback`);
            if ($fallback.length) newContent = String($fallback.val() || '');
          }

          try {
            await sheet.actor.setPeasantNotableCombatDescription?.(index, newContent);
            
            // Call the callback if provided (e.g., to refresh tag display)
            if (typeof onSaveCallback === 'function') {
              onSaveCallback();
            }
          } catch (saveErr) {
            console.error('Failed to save combat description:', saveErr);
            ui.notifications?.error?.('Failed to save combat description. See console for details.');
          }

          $container.remove();
          sheet.render(false);
        });

        // Cancel handler
        $container.on('click', '.peasant-combat-cancel', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          $container.remove();
        });

        // Close button handler
        $container.on('click', '.peasant-combat-close', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          $container.remove();
        });

        // ESC to close
        const escHandler = (ev) => {
          if (ev.key === 'Escape') {
            $container.remove();
            sheetDocument.removeEventListener('keydown', escHandler);
          }
        };
        sheetDocument.addEventListener('keydown', escHandler);

      } catch (e) { pcLog.debug('openCombatDescEditor failed', e); }
    };

    html.on('click', '.combat-desc-btn', async (ev) => {
      try {
        ev.preventDefault(); ev.stopPropagation();
        if (!this.isEditMode) return;
        const btn = $(ev.currentTarget);
        const row = btn.closest('.combat-item');
        let index = parseInt(row.attr('data-combat-index'));
        if (Number.isNaN(index)) index = row.index();
        if (Number.isNaN(index)) return;
        await openCombatTagEditor(index);
      } catch (e) { pcLog.debug('combat-desc-btn handler failed', e); }
    });

    // Combat Tag Editor popup
    const openCombatTagEditor = async (index) => {
      try {
        if (Number.isNaN(index) || index === undefined || index === null) return;
        
        const sheet = this;
        const containerId = `peasant-combat-tag-${this.id}-${index}-container`;
        
        // Remove any existing popup
        $(`#${containerId}`).remove();

        // Helper to get current combat data fresh from actor
        const getCombatData = () => sheet.actor.system.notableCombats?.[index] || {};
        
        const combatName = getCombatData().name || 'Combat';

        // Build the popup HTML with current tags section and add tag section
        const $container = $(`
          <div id="${containerId}" class="peasant-skill-floating application window-app peasant-core peasant-tag-editor" style="position:fixed;top:10%;left:50%;transform:translateX(-50%);width:480px;max-width:95%;z-index:4000;background:#1a1a1a;border:1px solid #444;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,0.7);overflow:visible;max-height:80vh;display:flex;flex-direction:column;">
            <header class="window-header flexrow peasant-tag-drag-handle peasant-tag-header">
              <h4 class="window-title popup-handle-title">Combat Tags: ${escapeHtml(combatName)}</h4>
              <button type="button" class="peasant-tag-close header-control icon fa-solid fa-xmark" title="Close" aria-label="Close"></button>
            </header>
            <div class="window-content" style="padding:12px;background:#1a1a1a;overflow-y:auto;flex:1;">
              <!-- Current Tags Section -->
              <div class="current-tags-section" style="margin-bottom:16px;">
                <label style="color:#aaa;display:block;margin-bottom:8px;font-size:12px;font-weight:bold;">Current Tags:</label>
                <div class="current-tags-list" style="display:flex;flex-wrap:wrap;gap:4px;min-height:24px;"></div>
              </div>
              
              <hr style="border:none;border-top:1px solid #444;margin:12px 0;">
              
              <!-- Add Tag Section -->
              <div class="add-tag-section">
                <label class="add-tag-section-label" style="color:#aaa;display:block;margin-bottom:8px;font-size:12px;font-weight:bold;">Add New Tag:</label>
                <div class="form-group" style="margin-bottom:12px;">
                  <select class="tag-type-select" style="width:100%;padding:6px;background:#2a2a2a;border:1px solid #555;border-radius:4px;color:#e0e0e0;">
                    <option value="">-- Choose a tag type --</option>
                    <option value="description">Description</option>
                    <option value="resourceCosts">Resource Costs</option>
                    <option value="speed">Speed</option>
                    <option value="range">Range</option>
                    <option value="rangeRate">Range-Rate</option>
                    <option value="damage">Damage</option>
                    <option value="heal">Heal</option>
                    <option value="manifest">Manifest</option>
                    <option value="tagUses">Uses</option>
                    <option value="sections">Sections</option>
                    <option value="aoe">AoE</option>
                    <option value="targetingType">Targeting Type</option>
                    <option value="defense">Defense</option>
                    <option value="reach">Reach</option>
                    <option value="stability">Stability</option>
                    <option value="strengthen">Strengthen</option>
                    <option value="custom">Custom</option>
                    <option value="self">Self</option>
                  </select>
                </div>
                <div class="tag-input-area" style="min-height:40px;"></div>
              </div>
            </div>
            <footer class="window-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:10px 12px;border-top:1px solid var(--pc-accent-border, var(--color-light-5, #9f8475));background:var(--background);border-radius:0 0 8px 8px;flex-shrink:0;">
              <button type="button" class="peasant-tag-add" style="background:#16a34a;color:white;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;font-weight:bold;">Add Tag</button>
              <button type="button" class="peasant-tag-done" style="background:#555;color:white;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;">Done</button>
            </footer>
          </div>
        `);

        // Mirror the active Foundry theme classes so popup controls render like the actor sheet.
        const inheritedThemeClasses = new Set(["themed"]);
        const themeClassSources = [
          sheetBody?.className || "",
          getApplicationElement(sheet)?.className || ""
        ];
        for (const source of themeClassSources) {
          for (const className of String(source).split(/\s+/)) {
            if (!className) continue;
            if (className.startsWith("theme-")) inheritedThemeClasses.add(className);
          }
        }
        $container.addClass(Array.from(inheritedThemeClasses).join(" "));

        $(sheetBody).append($container);

        // Make draggable
        const containerEl = $container[0];
        const headerEl = $container.find('.peasant-tag-drag-handle')[0];
        let isDragging = false;
        let dragOffsetX = 0;
        let dragOffsetY = 0;

        headerEl.addEventListener('mousedown', (e) => {
          if (e.target.closest('.peasant-tag-close')) return;
          isDragging = true;
          const rect = containerEl.getBoundingClientRect();
          dragOffsetX = e.clientX - rect.left;
          dragOffsetY = e.clientY - rect.top;
          containerEl.style.transform = 'none';
          containerEl.style.left = rect.left + 'px';
          containerEl.style.top = rect.top + 'px';
          e.preventDefault();
        });

        const onDragMove = (e) => {
          if (!isDragging) return;
          containerEl.style.left = (e.clientX - dragOffsetX) + 'px';
          containerEl.style.top = (e.clientY - dragOffsetY) + 'px';
        };

        const onDragUp = () => {
          isDragging = false;
        };

        sheetDocument.addEventListener('mousemove', onDragMove);
        sheetDocument.addEventListener('mouseup', onDragUp);

        const tagEditorState = {
          mode: 'add',
          tagType: '',
          customIndex: -1
        };

        const syncTagEditorUi = () => {
          const isEditing = tagEditorState.mode === 'edit' && !!tagEditorState.tagType;
          $container.find('.peasant-tag-add').text(isEditing ? 'Save Tag' : 'Add Tag');
          $container.find('.add-tag-section-label').text(isEditing ? 'Edit Tag:' : 'Add New Tag:');
        };

        const resetTagEditorState = ({ clearForm = false } = {}) => {
          tagEditorState.mode = 'add';
          tagEditorState.tagType = '';
          tagEditorState.customIndex = -1;
          syncTagEditorUi();
          if (clearForm) {
            $container.find('.tag-type-select').val('');
            $container.find('.tag-input-area').html(`<p style="color:#666;font-style:italic;font-size:12px;">Select a tag type above.</p>`);
          }
        };

        const beginEditTag = (tagType, customIndex = -1) => {
          tagEditorState.mode = 'edit';
          tagEditorState.tagType = String(tagType || '');
          tagEditorState.customIndex = Number.isInteger(customIndex) ? customIndex : parseInt(customIndex, 10);
          if (Number.isNaN(tagEditorState.customIndex)) tagEditorState.customIndex = -1;
          syncTagEditorUi();
        };

        // Helper to format tag display - check for > 0 since we use 0 as "not set"
        const formatTagValue = (tagType, combatData) => {
          switch (tagType) {
            case 'description':
              const descText = (combatData.description || '').replace(/<[^>]*>/g, '').trim();
              return descText ? 'Description' : null;
            case 'resourceCosts':
              if (Array.isArray(combatData.resourceCosts) && combatData.resourceCosts.length > 0) {
                const costs = combatData.resourceCosts.filter(rc => rc.type && rc.value > 0);
                if (costs.length > 0) {
                  return 'Resource Costs: ' + costs.map(rc => {
                    let label = rc.type;
                    if (rc.type === 'HP' && rc.damageType) label = `${rc.damageType} HP`;
                    return `${label} ${rc.value}`;
                  }).join(', ');
                }
              }
              return null;
            case 'speed':
              if (combatData.speed && combatData.speed.type) {
                if (combatData.speed.type === 'Split Second') {
                  return `Speed: Split Second (${combatData.speed.splitSecondCurrent || 0}/${combatData.speed.splitSecondMax || 0})`;
                }
                return `Speed: ${combatData.speed.type}`;
              }
              return null;
            // Legacy support
            case 'staminaCost':
              return combatData.staminaCost > 0 ? `Stamina Cost: ${combatData.staminaCost}` : null;
            case 'attunementCost':
              return combatData.attunementCost > 0 ? `Attunement Cost: ${combatData.attunementCost}` : null;
            case 'range':
              return combatData.range > 0 ? `Range: ${combatData.range}` : null;
            case 'rangeRate':
              return (combatData.rangeRate && combatData.rangeRate !== '///') ? `Range-Rate: ${combatData.rangeRate}` : null;
            case 'damage':
              if (hasCombatDice(combatData.damage)) {
                let str = `Damage: ${combatData.damage.diceCount}d${formatCombatDiceValue(combatData.damage.diceValue, combatData.damage.diceBonus)}`;
                if (combatData.damage.flat) str += combatData.damage.flat > 0 ? `+${combatData.damage.flat}` : `${combatData.damage.flat}`;
                if (combatData.damage.type) str += ` ${combatData.damage.type}`;
                return str;
              }
              return null;
            case 'heal':
              if (hasCombatDice(combatData.heal)) {
                let str = `Heal: ${combatData.heal.diceCount}d${formatCombatDiceValue(combatData.heal.diceValue, combatData.heal.diceBonus)}`;
                if (combatData.heal.flat) str += combatData.heal.flat > 0 ? `+${combatData.heal.flat}` : `${combatData.heal.flat}`;
                if (combatData.heal.type) str += ` ${combatData.heal.type}`;
                return str;
              }
              return null;
            case 'manifest':
              if (hasCombatDice(combatData.manifest)) {
                let str = `Manifest: ${combatData.manifest.diceCount}d${formatCombatDiceValue(combatData.manifest.diceValue, combatData.manifest.diceBonus)}`;
                if (combatData.manifest.flat) str += combatData.manifest.flat > 0 ? `+${combatData.manifest.flat}` : `${combatData.manifest.flat}`;
                return str;
              }
              return null;
            case 'tagUses':
              if (combatData.tagUses && combatData.tagUses.max > 0) {
                return `Uses: ${combatData.tagUses.current}/${combatData.tagUses.max}`;
              }
              return null;
            case 'sections':
              if (combatData.sections && combatData.sections.max > 0) {
                return `Sections: ${combatData.sections.current}/${combatData.sections.max}`;
              }
              return null;
            case 'aoe':
              if (combatData.aoe && combatData.aoe.value > 0) {
                let str = `AoE: ${combatData.aoe.value}`;
                if (combatData.aoe.type && combatData.aoe.type !== 'Area') str += ` ${combatData.aoe.type}`;
                return str;
              }
              return null;
            case 'targetingType':
              return combatData.targetingType ? `${combatData.targetingType}` : null;
            case 'defense': {
              const summary = getCombatDefenseSummary(combatData.defense);
              return summary ? `Defense: ${summary}` : null;
            }
            case 'reach':
              return combatData.reach > 0 ? `Reach: ${combatData.reach}` : null;
            case 'stability':
              return combatData.stability ? 'Stability' : null;
            case 'strengthen':
              return combatData.strengthen ? 'Strengthen' : null;
            case 'custom': {
              return null;
            }
            case 'self':
              return combatData.self ? 'Self' : null;
            default:
              return null;
          }
        };


        // Render current tags list with drag-to-reorder support
        const renderCurrentTags = () => {
          const combatData = getCombatData();
          const $list = $container.find('.current-tags-list');
          $list.empty();
          
          // All tag types for editor (includes description, new tags)
          const allEditorTagTypes = [...COMBAT_EDITOR_TAG_TYPES];
          
          // Get saved tagOrder
          const rawTagOrder = Array.isArray(combatData.tagOrder) ? combatData.tagOrder : [];
          const hasCustomOrder = rawTagOrder.length > 0;
          
          // Use saved order if it exists, otherwise use default
          let tagOrder = hasCustomOrder ? [...rawTagOrder] : [...allEditorTagTypes];
          
          // Ensure all tag types are in the order
          for (const tagType of allEditorTagTypes) {
            if (!tagOrder.includes(tagType)) {
              tagOrder.push(tagType);
            }
          }
          
          // Get active tags in order
          const activeTags = [];
          for (const tagType of tagOrder) {
            if (tagType === 'custom') {
              const customTags = getCombatCustomTags(combatData);
              customTags.forEach((tag, customIndex) => {
                const display = tag.value ? `${tag.name}: ${tag.value}` : tag.name;
                activeTags.push({ type: 'custom', display, customIndex });
              });
              continue;
            }
            const display = formatTagValue(tagType, combatData);
            if (display) activeTags.push({ type: tagType, display });
          }
          
          if (activeTags.length === 0) {
            $list.html('<span style="color:#666;font-style:italic;font-size:12px;">No tags set</span>');
            return;
          }
          
          activeTags.forEach((tag, idx) => {
            const isDescription = tag.type === 'description';
            const labelClass = isDescription ? 'current-tag-label edit-description-tag' : 'current-tag-label';
            const customIndexAttr = Number.isInteger(tag.customIndex) ? ` data-custom-index="${tag.customIndex}"` : '';
            const tagKey = tag.type === 'custom' && Number.isInteger(tag.customIndex) ? `custom:${tag.customIndex}` : tag.type;
            const $tagItem = $(`
              <div class="current-tag-item editor-tag-draggable combat-tag combat-tag-compact combat-tag-button" data-tag-type="${tag.type}" data-tag-key="${tagKey}" data-tag-index="${idx}"${customIndexAttr} draggable="true" role="button" tabindex="0" title="Right-click to edit this tag" style="display:inline-flex !important; width:auto !important; max-width:max-content !important; flex:0 0 auto !important; margin:0 !important; align-self:flex-start !important; justify-content:flex-start !important;">
                <span class="${labelClass}">${escapeHtml(tag.display)}</span>
                <button type="button" class="remove-tag-btn" data-tag-type="${tag.type}" data-tag-key="${tagKey}"${customIndexAttr} title="Remove tag" draggable="false" aria-label="Remove tag">&times;</button>
              </div>
            `);
            const chipEl = $tagItem[0];
            const removeBtn = $tagItem.find('.remove-tag-btn')[0];
            const setTagHoverState = (active) => {
              chipEl.classList.toggle('tag-hover-active', !!active);

              if (!active) {
                chipEl.style.removeProperty('background');
                chipEl.style.removeProperty('background-color');
                chipEl.style.removeProperty('border-color');
                chipEl.style.removeProperty('color');
                return;
              }

              const hoverSource = removeBtn || chipEl;
              const hoverStyles = getComputedStyle(hoverSource);
              const hoverBg = hoverStyles.getPropertyValue('--button-hover-background-color').trim() || 'rgba(46, 38, 28, 0.75)';
              const hoverBorder = hoverStyles.getPropertyValue('--button-hover-border-color').trim() || '#c9b183';
              const hoverText = hoverStyles.getPropertyValue('--button-hover-text-color').trim() || '#f2dfbd';

              chipEl.style.setProperty('background', hoverBg, 'important');
              chipEl.style.setProperty('background-color', hoverBg, 'important');
              chipEl.style.setProperty('border-color', hoverBorder, 'important');
              chipEl.style.setProperty('color', hoverText, 'important');
            };

            const setRemoveHoverState = (active) => {
              if (!removeBtn) return;
              removeBtn.classList.toggle('tag-hover-active', !!active);
            };

            chipEl.addEventListener('mouseenter', () => setTagHoverState(true));
            chipEl.addEventListener('mouseleave', () => setTagHoverState(false));
            chipEl.addEventListener('focusin', (ev) => {
              if (removeBtn && ev.target === removeBtn) return;
              setTagHoverState(true);
            });
            chipEl.addEventListener('focusout', () => {
              setTimeout(() => {
                if (!chipEl.contains(chipEl.ownerDocument?.activeElement)) setTagHoverState(false);
              }, 0);
            });

            if (removeBtn) {
              removeBtn.addEventListener('mouseenter', () => {
                setTagHoverState(false);
                setRemoveHoverState(true);
              });
              removeBtn.addEventListener('mouseleave', () => {
                setRemoveHoverState(false);
                if (!chipEl.matches(':hover') && !chipEl.contains(chipEl.ownerDocument?.activeElement)) {
                  setTagHoverState(false);
                } else {
                  setTagHoverState(true);
                }
              });
              removeBtn.addEventListener('focusin', () => {
                setTagHoverState(false);
                setRemoveHoverState(true);
              });
              removeBtn.addEventListener('focusout', () => {
                setRemoveHoverState(false);
                setTimeout(() => {
                  const activeElement = chipEl.ownerDocument?.activeElement;
                  if (!chipEl.contains(activeElement) && !chipEl.matches(':hover')) {
                    setTagHoverState(false);
                  } else if (chipEl.contains(activeElement) || chipEl.matches(':hover')) {
                    setTagHoverState(true);
                  }
                }, 0);
              });
            }

            $list.append($tagItem);
          });
          
          // Setup drag handlers for editor tags
          setupEditorTagDrag();
        };
        
        // Setup drag handlers for tags in the editor
        const setupEditorTagDrag = () => {
          const $list = $container.find('.current-tags-list');
          let draggedTag = null;
          
          $list.find('.editor-tag-draggable').each((_, el) => {
            const $el = $(el);
            
            $el.on('dragstart', (e) => {
              if ($el.attr('data-remove-pressed') === 'true') {
                e.preventDefault();
                e.stopPropagation();
                return false;
              }
              if ($(e.target).closest('.remove-tag-btn').length) {
                e.preventDefault();
                e.stopPropagation();
                return false;
              }
              draggedTag = $el[0];
              $el.addClass('dragging');
              e.originalEvent.dataTransfer.effectAllowed = 'move';
              e.originalEvent.dataTransfer.setData('text/plain', $el.data('tag-key') || $el.data('tag-type'));
            });
            
            $el.on('dragend', (e) => {
              $el.removeClass('dragging');
              $list.find('.editor-tag-draggable').removeClass('drag-over-left drag-over-right dragging');
              draggedTag = null;
            });
            
            $el.on('dragover', (e) => {
              e.preventDefault();
              e.originalEvent.dataTransfer.dropEffect = 'move';
              if (draggedTag && draggedTag !== $el[0]) {
                const rect = $el[0].getBoundingClientRect();
                const midX = rect.left + rect.width / 2;
                if (e.originalEvent.clientX < midX) {
                  $el.addClass('drag-over-left').removeClass('drag-over-right');
                } else {
                  $el.addClass('drag-over-right').removeClass('drag-over-left');
                }
              }
            });
            
            $el.on('dragleave', (e) => {
              $el.removeClass('drag-over-left drag-over-right');
            });
            
            $el.on('drop', async (e) => {
              e.preventDefault();
              $el.removeClass('drag-over-left drag-over-right');
              
              if (!draggedTag || draggedTag === $el[0]) return;
              
              const draggedType = $(draggedTag).data('tag-type');
              const draggedKey = String($(draggedTag).data('tag-key') || draggedType || '');
              const draggedRawCustomIndex = $(draggedTag).data('custom-index');
              const draggedCustomIndex = Number.isInteger(draggedRawCustomIndex) ? draggedRawCustomIndex : parseInt(draggedRawCustomIndex, 10);
              const targetType = $el.data('tag-type');
              const targetKey = String($el.data('tag-key') || targetType || '');
              const targetRawCustomIndex = $el.data('custom-index');
              const targetCustomIndex = Number.isInteger(targetRawCustomIndex) ? targetRawCustomIndex : parseInt(targetRawCustomIndex, 10);
              if (!draggedType || !targetType || !draggedKey || !targetKey || draggedKey === targetKey) return;
              
              // Reorder custom tags inside the customTags array if both entries are custom.
              if (draggedType === 'custom' && targetType === 'custom' && !Number.isNaN(draggedCustomIndex) && !Number.isNaN(targetCustomIndex)) {
                const rect = $el[0].getBoundingClientRect();
                const midX = rect.left + rect.width / 2;
                const result = await sheet.actor.reorderPeasantNotableCombatCustomTag?.(index, draggedCustomIndex, targetCustomIndex, {
                  insertAfter: e.originalEvent.clientX >= midX
                });
                if (result?.changed) {
                  renderCurrentTags();
                }
                return;
              }
              
              // Determine if inserting before or after
              const rect = $el[0].getBoundingClientRect();
              const midX = rect.left + rect.width / 2;
              const result = await sheet.actor.reorderPeasantNotableCombatTag?.(index, draggedType, targetType, {
                insertAfter: e.originalEvent.clientX >= midX
              });
              if (result?.changed) renderCurrentTags();
            });
          });
        };
        
        // Initial render of current tags
        renderCurrentTags();
        syncTagEditorUi();

        // Reference to track description editor state
        let descriptionEditorOpen = false;

        // Helper to build input fields based on tag type
        const buildTagInputs = (tagType) => {
          const combatData = getCombatData();
          const $area = $container.find('.tag-input-area');
          $area.empty();
          const isEditingThisType = tagEditorState.mode === 'edit' && tagEditorState.tagType === tagType;
          
          const inputStyle = 'width:60px;padding:4px;background:#2a2a2a;border:1px solid #555;border-radius:3px;color:#e0e0e0;text-align:center;';
          const labelStyle = 'color:#aaa;font-size:12px;margin-right:8px;';
          const selectStyle = 'padding:4px;background:#2a2a2a;border:1px solid #555;border-radius:3px;color:#e0e0e0;';
          
          switch (tagType) {
            case 'description':
              $area.html(`
                <div class="pc-tag-description-placeholder">
                  <p>Click <strong>Add Tag</strong> to open the description editor.</p>
                  <p class="pc-tag-description-placeholder-hint">This will open a rich text editor for the combat description.</p>
                </div>
              `);
              break;
            case 'staminaCost':
              $area.html(`
                <div style="display:flex;align-items:center;gap:8px;">
                  <label style="${labelStyle}">Stamina Cost:</label>
                  <input type="number" class="tag-stamina-cost" value="${combatData.staminaCost || ''}" style="${inputStyle}" min="0" placeholder="#">
                  <span style="color:#888;font-size:11px;">(Legacy - use Resource Costs)</span>
                </div>
              `);
              break;
            case 'attunementCost':
              $area.html(`
                <div style="display:flex;align-items:center;gap:8px;">
                  <label style="${labelStyle}">Attunement Cost:</label>
                  <input type="number" class="tag-attunement-cost" value="${combatData.attunementCost || ''}" style="${inputStyle}" min="0" placeholder="#">
                  <span style="color:#888;font-size:11px;">(Legacy - use Resource Costs)</span>
                </div>
              `);
              break;
            case 'resourceCosts':
              const existingCosts = combatData.resourceCosts || [];
              let costsHtml = `<div class="resource-costs-container" style="display:flex;flex-direction:column;gap:8px;">`;
              costsHtml += `<div class="resource-costs-list" style="display:flex;flex-direction:column;gap:6px;">`;
              
              // Render existing costs or one empty row
              const costsToRender = existingCosts.length > 0 ? existingCosts : [{ type: '', value: 0, damageType: '' }];
              costsToRender.forEach((cost, idx) => {
                costsHtml += `
                  <div class="resource-cost-row" data-cost-index="${idx}" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                    <select class="tag-rc-type" style="${selectStyle}">
                      <option value="">-- Type --</option>
                      <option value="Stamina" ${cost.type === 'Stamina' ? 'selected' : ''}>Stamina</option>
                      <option value="Attunement" ${cost.type === 'Attunement' ? 'selected' : ''}>Attunement</option>
                      <option value="HP" ${cost.type === 'HP' ? 'selected' : ''}>HP</option>
                      <option value="Physical Stress" ${cost.type === 'Physical Stress' ? 'selected' : ''}>Physical Stress</option>
                      <option value="Mental Stress" ${cost.type === 'Mental Stress' ? 'selected' : ''}>Mental Stress</option>
                    </select>
                    <input type="number" class="tag-rc-value" value="${cost.value || ''}" style="${inputStyle}width:50px;" min="0" placeholder="#">
                    <select class="tag-rc-dmgtype" style="${selectStyle}display:${cost.type === 'HP' ? 'inline-block' : 'none'};">
                      <option value="">-- Dmg Type --</option>
                      <option value="Blunt" ${cost.damageType === 'Blunt' ? 'selected' : ''}>Blunt</option>
                      <option value="Lethal" ${cost.damageType === 'Lethal' ? 'selected' : ''}>Lethal</option>
                      <option value="Critical" ${cost.damageType === 'Critical' ? 'selected' : ''}>Critical</option>
                    </select>
                    <button type="button" class="remove-cost-row peasant-tag-cancel" title="Remove cost row">-</button>
                  </div>
                `;
              });
              
              costsHtml += `</div>`;
              costsHtml += `<button type="button" class="add-cost-row peasant-tag-add">+ Add Cost</button>`;
              costsHtml += `</div>`;
              $area.html(costsHtml);
              
              // Show/hide damage type dropdown based on HP selection
              $area.on('change', '.tag-rc-type', function() {
                const $row = $(this).closest('.resource-cost-row');
                const $dmgType = $row.find('.tag-rc-dmgtype');
                if ($(this).val() === 'HP') {
                  $dmgType.show();
                } else {
                  $dmgType.hide().val('');
                }
              });
              
              // Add cost row
              $area.on('click', '.add-cost-row', function() {
                const $list = $area.find('.resource-costs-list');
                const newIdx = $list.find('.resource-cost-row').length;
                $list.append(`
                  <div class="resource-cost-row" data-cost-index="${newIdx}" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                    <select class="tag-rc-type" style="${selectStyle}">
                      <option value="">-- Type --</option>
                      <option value="Stamina">Stamina</option>
                      <option value="Attunement">Attunement</option>
                      <option value="HP">HP</option>
                      <option value="Physical Stress">Physical Stress</option>
                      <option value="Mental Stress">Mental Stress</option>
                    </select>
                    <input type="number" class="tag-rc-value" value="" style="${inputStyle}width:50px;" min="0" placeholder="#">
                    <select class="tag-rc-dmgtype" style="${selectStyle}display:none;">
                      <option value="">-- Dmg Type --</option>
                      <option value="Blunt">Blunt</option>
                      <option value="Lethal">Lethal</option>
                      <option value="Critical">Critical</option>
                    </select>
                    <button type="button" class="remove-cost-row peasant-tag-cancel" title="Remove cost row">-</button>
                  </div>
                `);
              });
              
              // Remove cost row
              $area.on('click', '.remove-cost-row', function() {
                $(this).closest('.resource-cost-row').remove();
              });
              break;
            case 'speed':
              const currentSpeed = combatData.speed || {};
              $area.html(`
                <div style="display:flex;flex-direction:column;gap:8px;">
                  <div style="display:flex;align-items:center;gap:8px;">
                    <label style="${labelStyle}">Speed:</label>
                    <select class="tag-speed-type" style="${selectStyle}">
                      <option value="">-- Select --</option>
                      <option value="Full Round" ${currentSpeed.type === 'Full Round' ? 'selected' : ''}>Full Round</option>
                      <option value="Standard" ${currentSpeed.type === 'Standard' ? 'selected' : ''}>Standard</option>
                      <option value="Movement" ${currentSpeed.type === 'Movement' ? 'selected' : ''}>Movement</option>
                      <option value="Reflex" ${currentSpeed.type === 'Reflex' ? 'selected' : ''}>Reflex</option>
                      <option value="Instant" ${currentSpeed.type === 'Instant' ? 'selected' : ''}>Instant</option>
                      <option value="Split Second" ${currentSpeed.type === 'Split Second' ? 'selected' : ''}>Split Second</option>
                    </select>
                  </div>
                  <div class="split-second-uses" style="display:${currentSpeed.type === 'Split Second' ? 'flex' : 'none'};align-items:center;gap:8px;">
                    <label style="${labelStyle}">Max Uses:</label>
                    <input type="number" class="tag-speed-max" value="${currentSpeed.splitSecondMax || ''}" style="${inputStyle}" min="1" placeholder="#">
                  </div>
                </div>
              `);
              
              // Show/hide split second uses
              $area.on('change', '.tag-speed-type', function() {
                const $splitUses = $area.find('.split-second-uses');
                if ($(this).val() === 'Split Second') {
                  $splitUses.show();
                } else {
                  $splitUses.hide();
                }
              });
              break;
            case 'range':
              $area.html(`
                <div style="display:flex;align-items:center;gap:8px;">
                  <label style="${labelStyle}">Range:</label>
                  <input type="number" class="tag-range" value="${combatData.range || ''}" style="${inputStyle}" min="0" placeholder="#">
                </div>
              `);
              break;
            case 'rangeRate':
              {
                const rangeRateParts = String(combatData.rangeRate || '').split('/');
              $area.html(`
                <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">
                  <label style="${labelStyle}">Range-Rate:</label>
                  <input type="number" class="tag-rr-1" value="${rangeRateParts[0] || ''}" style="${inputStyle}width:45px;" placeholder="1st">
                  <span style="color:#666;">/</span>
                  <input type="number" class="tag-rr-2" value="${rangeRateParts[1] || ''}" style="${inputStyle}width:45px;" placeholder="2nd">
                  <span style="color:#666;">/</span>
                  <input type="number" class="tag-rr-3" value="${rangeRateParts[2] || ''}" style="${inputStyle}width:45px;" placeholder="3rd">
                  <span style="color:#666;">/</span>
                  <input type="number" class="tag-rr-4" value="${rangeRateParts[3] || ''}" style="${inputStyle}width:45px;" placeholder="4th">
                </div>
              `);
              break;
              }
            case 'damage':
              const currentDamage = combatData.damage || {};
              $area.html(`
                <div style="display:flex;flex-direction:column;gap:8px;">
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <input type="number" class="tag-dmg-dice" value="${currentDamage.diceCount || ''}" style="${inputStyle}width:45px;" min="1" placeholder="#">
                    <span style="color:#e0e0e0;">d</span>
                    <input type="text" class="tag-dmg-value" value="${formatCombatDiceValue(currentDamage.diceValue, currentDamage.diceBonus)}" style="${inputStyle}width:58px;" placeholder="#">
                    <span style="color:#e0e0e0;">+</span>
                    <input type="number" class="tag-dmg-flat" value="${currentDamage.flat || ''}" style="${inputStyle}width:50px;" placeholder="flat">
                  </div>
                  <div style="display:flex;align-items:center;gap:8px;">
                    <label style="${labelStyle}">Type:</label>
                    <select class="tag-dmg-type" style="${selectStyle}">
                      <option value="">-- Select --</option>
                      <option value="Blunt" ${currentDamage.type === 'Blunt' ? 'selected' : ''}>Blunt</option>
                      <option value="Lethal" ${currentDamage.type === 'Lethal' ? 'selected' : ''}>Lethal</option>
                      <option value="Hybrid" ${currentDamage.type === 'Hybrid' ? 'selected' : ''}>Hybrid</option>
                      <option value="Flexible" ${currentDamage.type === 'Flexible' ? 'selected' : ''}>Flexible</option>
                      <option value="Crit" ${currentDamage.type === 'Crit' ? 'selected' : ''}>Crit</option>
                    </select>
                  </div>
                </div>
              `);
              break;
            case 'heal':
              const currentHeal = combatData.heal || {};
              $area.html(`
                <div style="display:flex;flex-direction:column;gap:8px;">
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <input type="number" class="tag-heal-dice" value="${currentHeal.diceCount || ''}" style="${inputStyle}width:45px;" min="1" placeholder="#">
                    <span style="color:#e0e0e0;">d</span>
                    <input type="text" class="tag-heal-value" value="${formatCombatDiceValue(currentHeal.diceValue, currentHeal.diceBonus)}" style="${inputStyle}width:58px;" placeholder="#">
                    <span style="color:#e0e0e0;">+</span>
                    <input type="number" class="tag-heal-flat" value="${currentHeal.flat || ''}" style="${inputStyle}width:50px;" placeholder="flat">
                  </div>
                  <div style="display:flex;align-items:center;gap:8px;">
                    <label style="${labelStyle}">Type:</label>
                    <select class="tag-heal-type" style="${selectStyle}">
                      <option value="">-- Select --</option>
                      <option value="Temporary" ${currentHeal.type === 'Temporary' ? 'selected' : ''}>Temporary</option>
                      <option value="Greater" ${currentHeal.type === 'Greater' ? 'selected' : ''}>Greater</option>
                    </select>
                  </div>
                </div>
              `);
              break;
            case 'manifest':
              const currentManifest = combatData.manifest || {};
              $area.html(`
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                  <input type="number" class="tag-mani-dice" value="${currentManifest.diceCount || ''}" style="${inputStyle}width:45px;" min="1" placeholder="#">
                  <span style="color:#e0e0e0;">d</span>
                  <input type="text" class="tag-mani-value" value="${formatCombatDiceValue(currentManifest.diceValue, currentManifest.diceBonus)}" style="${inputStyle}width:58px;" placeholder="#">
                  <span style="color:#e0e0e0;">+</span>
                  <input type="number" class="tag-mani-flat" value="${currentManifest.flat || ''}" style="${inputStyle}width:50px;" placeholder="flat">
                </div>
              `);
              break;
            case 'tagUses':
              $area.html(`
                <div style="display:flex;align-items:center;gap:8px;">
                  <label style="${labelStyle}">Max Uses:</label>
                  <input type="number" class="tag-uses-max" value="${combatData.tagUses?.max || ''}" style="${inputStyle}" min="1" placeholder="#">
                </div>
              `);
              break;
            case 'sections':
              $area.html(`
                <div style="display:flex;align-items:center;gap:8px;">
                  <label style="${labelStyle}">Max Sections:</label>
                  <input type="number" class="tag-sections-max" value="${combatData.sections?.max || ''}" style="${inputStyle}" min="1" placeholder="#">
                </div>
              `);
              break;
            case 'aoe':
              const currentAoe = combatData.aoe || {};
              $area.html(`
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                  <label style="${labelStyle}">AoE Value:</label>
                  <input type="number" class="tag-aoe-value" value="${currentAoe.value || ''}" style="${inputStyle}" min="1" placeholder="#">
                  <select class="tag-aoe-type" style="${selectStyle}">
                    <option value="Area" ${currentAoe.type === 'Area' || !currentAoe.type ? 'selected' : ''}>Area</option>
                    <option value="Blast" ${currentAoe.type === 'Blast' ? 'selected' : ''}>Blast</option>
                    <option value="Tile" ${currentAoe.type === 'Tile' ? 'selected' : ''}>Tile</option>
                  </select>
                </div>
              `);
              break;
            case 'targetingType':
              $area.html(`
                <div style="display:flex;align-items:center;gap:8px;">
                  <label style="${labelStyle}">Targeting Type:</label>
                  <select class="tag-targeting-type" style="${selectStyle}">
                    <option value="">-- Select --</option>
                    <option value="Melee" ${combatData.targetingType === 'Melee' ? 'selected' : ''}>Melee</option>
                    <option value="Projectile" ${combatData.targetingType === 'Projectile' ? 'selected' : ''}>Projectile</option>
                    <option value="Normal Targeting" ${combatData.targetingType === 'Normal Targeting' ? 'selected' : ''}>Normal Targeting</option>
                    <option value="Smite" ${combatData.targetingType === 'Smite' ? 'selected' : ''}>Smite</option>
                  </select>
                </div>
              `);
              break;
            case 'defense': {
              const defenseData = normalizeCombatDefense(combatData.defense);
              const isBlock = !!defenseData.block;
              const responseOptionsHtml = COMBAT_DEFENSE_RESPONSE_OPTIONS.map((option) => `
                <div class="defense-response-option">
                  <div class="defense-checkbox-cell" style="flex: 0 0 24px; text-align: center; display: flex; align-items: center; justify-content: center;">
                    <input type="checkbox" class="tag-defense-response" data-defense-key="${option.key}" ${defenseData.responses.includes(option.label) ? 'checked' : ''}>
                  </div>
                  <span>${option.label}</span>
                </div>
              `).join('');

              $area.html(`
                <div class="defense-tag-editor">
                  <div class="defense-section">
                    <div class="defense-section-label">Can respond to?</div>
                    <div class="defense-response-list">${responseOptionsHtml}</div>
                  </div>
                  <div class="defense-section">
                    <div class="defense-section-label">Effectiveness vs?</div>
                    <div class="defense-effectiveness-grid">
                      <div class="defense-effectiveness-head">Targeting Type</div>
                      <div class="defense-effectiveness-head">MoS Per</div>
                      <div class="defense-effectiveness-head">Accuracy Penalty</div>
                      <div class="defense-effectiveness-rows"></div>
                    </div>
                  </div>
                  <div class="defense-section">
                    <div class="defense-toggle-row">
                      <span>Block?</span>
                      <div class="defense-checkbox-cell" style="flex: 0 0 24px; text-align: center; display: flex; align-items: center; justify-content: center;">
                        <input type="checkbox" class="tag-defense-block" ${isBlock ? 'checked' : ''}>
                      </div>
                    </div>
                    <div class="defense-structure-fields" style="display:${isBlock ? 'grid' : 'none'};">
                      <label class="defense-inline-field" style="grid-column: 1 / -1;">
                        <span>Type</span>
                        <select class="tag-defense-block-type" style="${selectStyle}width:140px;">
                          ${COMBAT_DEFENSE_BLOCK_TYPES.map((blockType) => `<option value="${escapeHtml(blockType)}" ${defenseData.blockType === blockType ? 'selected' : ''}>${escapeHtml(blockType)}</option>`).join('')}
                        </select>
                      </label>
                      <label class="defense-inline-field defense-hardness-field" style="display:${defenseData.blockType === 'Mage' ? 'none' : 'flex'};">
                        <span class="defense-hardness-label" style="display:${defenseData.blockType === 'Mage' ? 'none' : 'inline'};">Hardness</span>
                        <input type="number" class="tag-defense-hardness" value="${defenseData.hardness || ''}" style="${inputStyle}width:72px; display:${defenseData.blockType === 'Mage' ? 'none' : 'inline-block'};" min="0" step="1" placeholder="0">
                      </label>
                      <label class="defense-inline-field">
                        <span>HP</span>
                        <input type="number" class="tag-defense-hp" value="${defenseData.hp || ''}" style="${inputStyle}width:72px;" min="0" step="1" placeholder="0">
                      </label>
                    </div>
                  </div>
                  <div class="defense-section">
                    <div class="defense-toggle-row">
                      <span>Applies debuff?</span>
                      <div class="defense-checkbox-cell" style="flex: 0 0 24px; text-align: center; display: flex; align-items: center; justify-content: center;">
                        <input type="checkbox" class="tag-defense-applies-debuff" ${defenseData.appliesDebuff ? 'checked' : ''}>
                      </div>
                    </div>
                    <div class="defense-debuff-fields" style="display:${defenseData.appliesDebuff ? 'block' : 'none'};">
                      <label class="defense-inline-field" style="margin-top:10px; justify-content:flex-start;">
                        <span>To-Hit</span>
                        <input type="number" class="tag-defense-debuff-tohit" value="${defenseData.debuffToHit || ''}" style="${inputStyle}width:72px;" step="1" placeholder="0">
                      </label>
                      <div class="defense-toggle-row defense-inline-toggle-row" style="margin-top:10px;">
                        <span>Applies before?</span>
                        <div class="defense-checkbox-cell" style="flex: 0 0 24px; text-align: center; display: flex; align-items: center; justify-content: center;">
                          <input type="checkbox" class="tag-defense-applies-before" ${defenseData.appliesBefore ? 'checked' : ''}>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              `);

              let defenseState = normalizeCombatDefense(defenseData);

              const captureDefenseEffectivenessRows = () => {
                for (const option of COMBAT_DEFENSE_RESPONSE_OPTIONS) {
                  const $row = $area.find(`.defense-effectiveness-row[data-defense-key="${option.key}"]`);
                  if (!$row.length) continue;
                  defenseState.effectiveness[option.key] = {
                    mosPer: parseCombatDefenseMosPer($row.find('.tag-defense-mos-per').val()),
                    accuracyPenalty: Number.parseInt($row.find('.tag-defense-accuracy-penalty').val(), 10) || 0
                  };
                }
              };

              const getSelectedDefenseResponses = () => COMBAT_DEFENSE_RESPONSE_OPTIONS
                .filter((option) => $area.find(`.tag-defense-response[data-defense-key="${option.key}"]`).is(':checked'))
                .map((option) => option.label);

              const renderDefenseEffectivenessRows = () => {
                captureDefenseEffectivenessRows();
                defenseState.responses = getSelectedDefenseResponses();
                const $rows = $area.find('.defense-effectiveness-rows');

                if (defenseState.responses.length === 0) {
                  $rows.html(`
                    <div class="defense-effectiveness-empty">
                      Select at least one targeting type above.
                    </div>
                  `);
                  return;
                }

                const rowsHtml = defenseState.responses.map((label) => {
                  const key = getCombatDefenseResponseKey(label);
                  const entry = normalizeCombatDefenseEffectivenessEntry(defenseState.effectiveness[key]);
                  return `
                    <div class="defense-effectiveness-row" data-defense-key="${key}">
                      <div class="defense-effectiveness-type">${label}</div>
                      <input type="number" class="tag-defense-mos-per" value="${entry.mosPer || ''}" style="${inputStyle}width:88px;" step="0.25" min="0" placeholder="0">
                      <input type="number" class="tag-defense-accuracy-penalty" value="${entry.accuracyPenalty || ''}" style="${inputStyle}width:110px;" step="1" placeholder="0">
                    </div>
                  `;
                }).join('');

                $rows.html(rowsHtml);
              };

              const updateDefenseStructureVisibility = () => {
                const blockSelected = !!$area.find('.tag-defense-block').is(':checked');
                $area.find('.defense-structure-fields').toggle(blockSelected);
                if (!blockSelected) return;
                const blockType = String($area.find('.tag-defense-block-type').val() || 'Shield').trim();
                const isMage = blockType === 'Mage';
                $area.find('.defense-hardness-field').css('display', isMage ? 'none' : 'flex');
              };

              const updateDefenseDebuffVisibility = () => {
                const appliesDebuff = !!$area.find('.tag-defense-applies-debuff').is(':checked');
                $area.find('.defense-debuff-fields').toggle(appliesDebuff);
              };

              $area.off('.defenseTagEditor');
              $area.on('change.defenseTagEditor', '.tag-defense-response', () => {
                renderDefenseEffectivenessRows();
              });
              $area.on('input.defenseTagEditor change.defenseTagEditor', '.tag-defense-mos-per, .tag-defense-accuracy-penalty', () => {
                captureDefenseEffectivenessRows();
              });
              $area.on('change.defenseTagEditor', '.tag-defense-block', () => {
                updateDefenseStructureVisibility();
              });
              $area.on('change.defenseTagEditor', '.tag-defense-block-type', () => {
                updateDefenseStructureVisibility();
              });
              $area.on('change.defenseTagEditor', '.tag-defense-applies-debuff', () => {
                updateDefenseDebuffVisibility();
              });
              $area.on('mousedown.defenseTagEditor', '.tag-defense-response, .tag-defense-block, .tag-defense-applies-before, .tag-defense-applies-debuff', (ev) => {
                // Match the sheet's feel more closely by preventing mouse clicks from leaving
                // the checkbox focused, which causes the persistent highlight in this popup.
                if (ev.button === 0) ev.preventDefault();
              });

              renderDefenseEffectivenessRows();
              updateDefenseStructureVisibility();
              updateDefenseDebuffVisibility();
              break;
            }
            case 'reach':
              $area.html(`
                <div style="display:flex;align-items:center;gap:8px;">
                  <label style="${labelStyle}">Reach:</label>
                  <input type="number" class="tag-reach" value="${combatData.reach || ''}" style="${inputStyle}" min="0" placeholder="#">
                </div>
              `);
              break;
            case 'stability':
              $area.html(`
                <div style="color:#e0e0e0;padding:8px;text-align:center;background:#2a2a2a;border-radius:4px;">
                  <p style="margin:0;">Click <strong>Add Tag</strong> to add the <em>Stability</em> tag.</p>
                </div>
              `);
              break;
            case 'strengthen':
              $area.html(`
                <div style="color:#e0e0e0;padding:8px;text-align:center;background:#2a2a2a;border-radius:4px;">
                  <p style="margin:0 0 6px 0;">Requires <strong>Stability</strong>.</p>
                  <p style="margin:0;">Click <strong>Add Tag</strong> to add the <em>Strengthen</em> tag.</p>
                </div>
              `);
              break;
            case 'custom': {
              const editingCustomTag = isEditingThisType
                ? (getCombatCustomTags(combatData)[tagEditorState.customIndex] || { name: '', value: '' })
                : { name: '', value: '' };
              $area.html(`
                <div style="display:flex;flex-direction:column;gap:8px;">
                  <div style="display:flex;align-items:center;gap:8px;">
                    <label style="${labelStyle}">Name:</label>
                    <input type="text" class="tag-custom-name" value="${escapeHtml(editingCustomTag.name)}" style="${inputStyle}flex:1;text-align:left;" placeholder="Name">
                  </div>
                  <div style="display:flex;align-items:center;gap:8px;">
                    <label style="${labelStyle}">Value:</label>
                    <input type="text" class="tag-custom-value" value="${escapeHtml(editingCustomTag.value)}" style="${inputStyle}flex:1;text-align:left;" placeholder="Value (optional)">
                  </div>
                </div>
              `);
              break;
            }
            case 'self':
              $area.html(`
                <div style="color:#e0e0e0;padding:8px;text-align:center;background:#2a2a2a;border-radius:4px;">
                  <p style="margin:0;">Click <strong>Add Tag</strong> to add the <em>Self</em> tag.</p>
                </div>
              `);
              break;
            default:
              $area.html(`<p style="color:#666;font-style:italic;font-size:12px;">Select a tag type above.</p>`);
          }
        };

        // Tag type select change handler
        $container.on('change', '.tag-type-select', (ev) => {
          const tagType = $(ev.currentTarget).val();
          if (!tagType) {
            resetTagEditorState();
            buildTagInputs(tagType);
            return;
          }
          if (!(tagEditorState.mode === 'edit' && tagEditorState.tagType === tagType)) {
            resetTagEditorState();
            tagEditorState.tagType = tagType;
          }
          buildTagInputs(tagType);
        });

        $container.on('contextmenu', '.current-tag-item', (ev) => {
          if ($(ev.target).closest('.remove-tag-btn').length) return;
          ev.preventDefault();
          ev.stopPropagation();

          const $item = $(ev.currentTarget);
          const tagType = String($item.data('tag-type') || '').trim();
          if (!tagType) return;
          if (tagType === 'description') {
            openCombatDescEditor(index, renderCurrentTags);
            return;
          }
          const rawCustomIndex = $item.data('custom-index');
          const customIndex = Number.isInteger(rawCustomIndex) ? rawCustomIndex : parseInt(rawCustomIndex, 10);

          beginEditTag(tagType, customIndex);
          $container.find('.tag-type-select').val(tagType);
          buildTagInputs(tagType);

          const $focusTarget = $container.find('.tag-input-area').find('input, select, textarea').filter(':visible').first();
          if ($focusTarget.length) $focusTarget.trigger('focus');
        });

        const removeNotableCombatTag = async (buttonEl) => {
          setRemoveButtonChipDraggable(buttonEl, true);

          try {
            const $button = $(buttonEl);
            const tagType = $button.data('tag-type');
            const rawCustomIndex = $button.data('custom-index');
            const customIndex = Number.isInteger(rawCustomIndex) ? rawCustomIndex : parseInt(rawCustomIndex, 10);
            if (!tagType) return;

            const result = await sheet.actor.removePeasantNotableCombatTag?.(index, tagType, { customIndex });
            if (result?.changed) renderCurrentTags();
          } catch (err) {
            console.error('Failed to remove notable combat tag:', err);
            ui.notifications?.error?.('Failed to remove tag. See console for details.');
          }
        };

        // Prevent drag-start interception when pressing remove.
        const setRemoveButtonChipDraggable = (buttonEl, enabled) => {
          const chipEl = buttonEl?.closest?.('.editor-tag-draggable');
          if (!chipEl) return;
          chipEl.draggable = !!enabled;
          if (enabled) {
            chipEl.removeAttribute('data-remove-pressed');
          } else {
            chipEl.setAttribute('data-remove-pressed', 'true');
          }
        };

        $container.on('pointerdown', '.remove-tag-btn', async (ev) => {
          if (ev.button != null && ev.button !== 0) return;
          ev.preventDefault();
          setRemoveButtonChipDraggable(ev.currentTarget, false);
          ev.stopPropagation();
          await removeNotableCombatTag(ev.currentTarget);
        });

        $container.on('pointerup mouseup pointercancel mouseleave blur', '.remove-tag-btn', (ev) => {
          setRemoveButtonChipDraggable(ev.currentTarget, true);
        });

        $container.on('dragstart', '.remove-tag-btn', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
        });

        // Keyboard fallback remove handler
        $container.on('click', '.remove-tag-btn', async (ev) => {
          const detail = ev.originalEvent?.detail ?? ev.detail ?? 0;
          if (detail > 0) return;
          ev.preventDefault();
          ev.stopPropagation();
          await removeNotableCombatTag(ev.currentTarget);
        });

        // Add tag handler
        $container.on('click', '.peasant-tag-add', async (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          
          const tagType = $container.find('.tag-type-select').val();
          if (!tagType) {
            ui.notifications?.warn?.('Please select a tag type first.');
            return;
          }
          
          // Apply the tag based on type
          let tagAdded = false;
          let tagData = {};
          switch (tagType) {
            case 'description':
              // Open the description editor popup - this is handled separately
              openCombatDescEditor(index, renderCurrentTags);
              return; // Don't close or update here - the editor handles it
            case 'resourceCosts':
              const costRows = $container.find('.resource-cost-row');
              const costs = [];
              costRows.each((_, row) => {
                const $row = $(row);
                const rcType = $row.find('.tag-rc-type').val();
                const rcValue = parseInt($row.find('.tag-rc-value').val()) || 0;
                const rcDmgType = $row.find('.tag-rc-dmgtype').val() || '';
                if (rcType && rcValue > 0) {
                  costs.push({ type: rcType, value: rcValue, damageType: rcDmgType });
                }
              });
              if (costs.length > 0) {
                tagData = { resourceCosts: costs };
                tagAdded = true;
              }
              break;
            case 'speed':
              const speedType = $container.find('.tag-speed-type').val();
              if (speedType) {
                const speedData = { type: speedType, splitSecondCurrent: 0, splitSecondMax: 0 };
                if (speedType === 'Split Second') {
                  const maxUses = parseInt($container.find('.tag-speed-max').val()) || 1;
                  speedData.splitSecondMax = maxUses;
                  speedData.splitSecondCurrent = maxUses;
                }
                tagData = { speed: speedData };
                tagAdded = true;
              }
              break;
            case 'staminaCost':
              const staminaVal = parseInt($container.find('.tag-stamina-cost').val());
              if (!Number.isNaN(staminaVal) && staminaVal > 0) {
                tagData = { staminaCost: staminaVal };
                tagAdded = true;
              }
              break;
            case 'attunementCost':
              const attunementVal = parseInt($container.find('.tag-attunement-cost').val());
              if (!Number.isNaN(attunementVal) && attunementVal > 0) {
                tagData = { attunementCost: attunementVal };
                tagAdded = true;
              }
              break;
            case 'range':
              const rangeVal = parseInt($container.find('.tag-range').val());
              if (!Number.isNaN(rangeVal) && rangeVal > 0) {
                tagData = { range: rangeVal };
                tagAdded = true;
              }
              break;
            case 'rangeRate':
              const rr1 = $container.find('.tag-rr-1').val() || '';
              const rr2 = $container.find('.tag-rr-2').val() || '';
              const rr3 = $container.find('.tag-rr-3').val() || '';
              const rr4 = $container.find('.tag-rr-4').val() || '';
              const rrVal = `${rr1}/${rr2}/${rr3}/${rr4}`;
              if (rrVal !== '///') {
                tagData = { rangeRate: rrVal };
                tagAdded = true;
              }
              break;
            case 'damage':
              const dmgDice = parseInt($container.find('.tag-dmg-dice').val()) || 0;
              const dmgValueData = parseCombatDiceValue($container.find('.tag-dmg-value').val());
              const dmgValue = dmgValueData.diceValue;
              if (dmgDice > 0 && dmgValue > 0) {
                tagData = { damage: {
                  diceCount: dmgDice,
                  diceValue: dmgValue,
                  diceBonus: dmgValueData.diceBonus,
                  flat: parseInt($container.find('.tag-dmg-flat').val()) || 0,
                  type: $container.find('.tag-dmg-type').val() || ''
                } };
                tagAdded = true;
              }
              break;
            case 'heal':
              const healDice = parseInt($container.find('.tag-heal-dice').val()) || 0;
              const healValueData = parseCombatDiceValue($container.find('.tag-heal-value').val());
              const healValue = healValueData.diceValue;
              if (healDice > 0 && healValue > 0) {
                tagData = { heal: {
                  diceCount: healDice,
                  diceValue: healValue,
                  diceBonus: healValueData.diceBonus,
                  flat: parseInt($container.find('.tag-heal-flat').val()) || 0,
                  type: $container.find('.tag-heal-type').val() || ''
                } };
                tagAdded = true;
              }
              break;
            case 'manifest':
              const maniDice = parseInt($container.find('.tag-mani-dice').val()) || 0;
              const maniValueData = parseCombatDiceValue($container.find('.tag-mani-value').val());
              const maniValue = maniValueData.diceValue;
              if (maniDice > 0 && maniValue > 0) {
                tagData = { manifest: {
                  diceCount: maniDice,
                  diceValue: maniValue,
                  diceBonus: maniValueData.diceBonus,
                  flat: parseInt($container.find('.tag-mani-flat').val()) || 0
                } };
                tagAdded = true;
              }
              break;
            case 'tagUses':
              const maxUses = parseInt($container.find('.tag-uses-max').val()) || 0;
              if (maxUses > 0) {
                tagData = { tagUses: {
                  current: maxUses,
                  max: maxUses
                } };
                tagAdded = true;
              }
              break;
            case 'sections':
              const maxSections = parseInt($container.find('.tag-sections-max').val()) || 0;
              if (maxSections > 0) {
                tagData = { sections: {
                  current: maxSections,
                  max: maxSections
                } };
                tagAdded = true;
              }
              break;
            case 'aoe':
              const aoeVal = parseInt($container.find('.tag-aoe-value').val()) || 0;
              if (aoeVal > 0) {
                tagData = { aoe: {
                  value: aoeVal,
                  type: $container.find('.tag-aoe-type').val() || 'Area'
                } };
                tagAdded = true;
              }
              break;
            case 'targetingType':
              const targetType = $container.find('.tag-targeting-type').val();
              if (targetType) {
                tagData = { targetingType: targetType };
                tagAdded = true;
              }
              break;
            case 'defense': {
              const selectedResponses = COMBAT_DEFENSE_RESPONSE_OPTIONS
                .filter((option) => $container.find(`.tag-defense-response[data-defense-key="${option.key}"]`).is(':checked'))
                .map((option) => option.label);

              if (selectedResponses.length === 0) {
                ui.notifications?.warn?.('Defense requires at least one response type.');
                return;
              }

              const defense = createDefaultCombatDefense();
              defense.responses = selectedResponses;
              const isBlock = !!$container.find('.tag-defense-block').is(':checked');
              const appliesDebuff = !!$container.find('.tag-defense-applies-debuff').is(':checked');
              defense.block = isBlock;
              defense.blockType = isBlock ? normalizeCombatDefenseBlockType($container.find('.tag-defense-block-type').val()) : "Shield";
              defense.appliesDebuff = appliesDebuff;
              defense.debuffToHit = appliesDebuff ? (Number.parseInt($container.find('.tag-defense-debuff-tohit').val(), 10) || 0) : 0;
              defense.appliesBefore = appliesDebuff && !!$container.find('.tag-defense-applies-before').is(':checked');

              for (const option of COMBAT_DEFENSE_RESPONSE_OPTIONS) {
                if (!selectedResponses.includes(option.label)) continue;
                const $row = $container.find(`.defense-effectiveness-row[data-defense-key="${option.key}"]`);
                defense.effectiveness[option.key] = {
                  mosPer: parseCombatDefenseMosPer($row.find('.tag-defense-mos-per').val()),
                  accuracyPenalty: Number.parseInt($row.find('.tag-defense-accuracy-penalty').val(), 10) || 0
                };
              }

              if (isBlock) {
                if (defense.blockType !== "Mage") {
                  defense.hardness = Math.max(0, Number.parseInt($container.find('.tag-defense-hardness').val(), 10) || 0);
                }
                defense.hp = Math.max(0, Number.parseInt($container.find('.tag-defense-hp').val(), 10) || 0);
              }

              tagData = { defense: normalizeCombatDefense(defense) };
              tagAdded = true;
              break;
            }
            case 'reach':
              const reachVal = parseInt($container.find('.tag-reach').val());
              if (!Number.isNaN(reachVal) && reachVal > 0) {
                tagData = { reach: reachVal };
                tagAdded = true;
              }
              break;
            case 'stability':
              tagData = {};
              tagAdded = true;
              break;
            case 'strengthen':
              if (!getCombatData().stability) {
                ui.notifications?.warn?.('Strengthen requires Stability on this notable entry.');
                return;
              }
              tagData = {};
              tagAdded = true;
              break;
            case 'custom':
              const customName = ($container.find('.tag-custom-name').val() || '').trim();
              const customValue = ($container.find('.tag-custom-value').val() || '').trim();
              if (customName) {
                tagData = { name: customName, value: customValue || '' };
                tagAdded = true;
              }
              break;
            case 'self':
              tagData = {};
              tagAdded = true;
              break;
          }
          
          if (!tagAdded) {
            ui.notifications?.warn?.('Please enter valid values for the tag.');
            return;
          }
          
          const wasEditingTag = tagEditorState.mode === 'edit';
          const actorTagMode = tagType === 'custom' && tagEditorState.tagType === 'custom' ? tagEditorState.mode : 'add';
          const result = await sheet.actor.setPeasantNotableCombatTag(index, tagType, tagData, {
            mode: actorTagMode,
            customIndex: tagEditorState.customIndex
          });
          if (!result?.changed) {
            ui.notifications?.warn?.('Please enter valid values for the tag.');
            return;
          }
          
          // Reset the form
          resetTagEditorState({ clearForm: true });
          
          // Refresh the current tags display
          renderCurrentTags();
          
          ui.notifications?.info?.(wasEditingTag ? 'Tag updated successfully.' : 'Tag added successfully.');
        });

        // Handler for clicking on description tag to edit it
        $container.on('click', '.edit-description-tag', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          openCombatDescEditor(index, renderCurrentTags);
        });

        // Done handler
        $container.on('click', '.peasant-tag-done', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          sheetDocument.removeEventListener('mousemove', onDragMove);
          sheetDocument.removeEventListener('mouseup', onDragUp);
          $container.remove();
          sheet.render(false);
        });

        // Close button handler
        $container.on('click', '.peasant-tag-close', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          sheetDocument.removeEventListener('mousemove', onDragMove);
          sheetDocument.removeEventListener('mouseup', onDragUp);
          $container.remove();
          sheet.render(false);
        });

        // ESC to close
        const escHandler = (ev) => {
          if (ev.key === 'Escape') {
            sheetDocument.removeEventListener('mousemove', onDragMove);
            sheetDocument.removeEventListener('mouseup', onDragUp);
            $container.remove();
            sheet.render(false);
            sheetDocument.removeEventListener('keydown', escHandler);
          }
        };
        sheetDocument.addEventListener('keydown', escHandler);

      } catch (e) { pcLog.debug('openCombatTagEditor failed', e); }
    };

    // Combat tag uses current value handler (view mode)
    html.on('change', '.combat-tag-uses-current', async (ev) => {
      const input = $(ev.currentTarget);
      try {
        ev.preventDefault();
        await runQueuedInputUpdate(input, '_combatSaveQueue', 'Combat tag uses current change', async () => {
          const index = Number(input.data('index'));
          if (Number.isNaN(index) || index < 0) return;

          const newVal = Math.max(0, parseInt(input.val()) || 0);
          await this.actor.setPeasantNotableCombatTagUsesCurrent?.(index, newVal, { render: false });
        });
      } catch (e) { pcLog.debug('combat-tag-uses-current change failed', e); }
    });

    // View combat description popup (view mode)
    html.on('click', '.combat-name-view.combat-has-desc', async (ev) => {
      try {
        ev.preventDefault();
        ev.stopPropagation();
        const $el = $(ev.currentTarget);
        const index = Number($el.data('index'));
        if (Number.isNaN(index)) return;

        const combats = this.actor.system.notableCombats || [];
        const combat = combats[index] || {};
        const description = combat.description || '';
        const combatName = combat.name || 'Combat';

        await showReadonlyDescriptionDialog(this, {
          title: `${combatName} â€” Description`,
          description
        });
      } catch (e) {
        pcLog.debug('combat-name-view click failed', e);
      }
    });

    // Also bind to currently rendered nodes as a backup
    html.find('.skill-delete').off('click').click(async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!this.isEditMode) return;
      await blurActiveEditableInSheet();
      const row = $(ev.currentTarget).closest('.skill-item');
      let index = parseInt(row.attr('data-skill-index'));
      if (Number.isNaN(index)) index = row.index();
      if (Number.isNaN(index)) return;
      await enqueueSheetUpdate('_skillsSaveQueue', 'Skill delete backup', async () => {
        await this.actor.removePeasantSkill?.(index);
      });
      this.render(true);
    });

    html.find('.advantage-delete').off('click').click(async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!this.isEditMode) return;
      const li = $(ev.currentTarget).closest('.advantage-item');
      let index = parseInt(li.attr('data-advantage-index'));
      if (Number.isNaN(index)) index = li.index();
      if (Number.isNaN(index)) return;
      await blurActiveEditableInSheet();
      await enqueueSheetUpdate('_advantageSaveQueue', 'Advantage delete backup', async () => {
        const adv = collectAdvantagesFromDOM();
        await this.actor.removePeasantFlexibleAdvantage?.(index, adv.names, adv.descriptions);
      });
      this.render(true);
    });

    // ... rest of activateListeners (skill drag/drop, etc.) remain intact.
  }

}
configurePeasantActorSheetHooks({
  sheetClass: PeasantActorSheet,
  actorClass: PeasantActor,
  characterModel: PeasantCharacterModel,
  documentSheetConfig: DocumentSheetConfig,
  coreActorSheetClass: CoreActorSheetClass,
  tokenHudClass: TokenHUDClass,
  isPeasantCharacterType
});
