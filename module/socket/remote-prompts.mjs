// Peasant Core socket and remote prompt routing
import {
  getPeasantCoreApiFunction as _getPeasantCoreApiFunction,
  registerPeasantCoreApi as _registerPeasantCoreApi
} from "../utils/api.mjs";
import { pcLog } from "../utils/logging.mjs";

export const PC_SOCKET_NAMESPACE = "system.peasant-core";
const PC_SOCKET_REQUEST_SEIZE_TURN = "requestSeizeTurn";
const PC_SOCKET_RESPONSE_SEIZE_TURN = "responseSeizeTurn";
export const PC_SOCKET_PROMPT_DEFENSE = "promptDefense";
export const PC_SOCKET_PROMPT_INCOMING_HIT = "promptIncomingHit";
const PC_SOCKET_APPLY_INCOMING_HIT = "applyIncomingHit";
const PC_SOCKET_CANCEL_REMOTE_PROMPT = "cancelRemotePrompt";
const PC_SOCKETLIB_HANDLER_PROMPT_DEFENSE = "promptDefense";
const PC_SOCKETLIB_HANDLER_PROMPT_INCOMING_HIT = "promptIncomingHit";
const PC_SOCKETLIB_HANDLER_APPLY_INCOMING_HIT = "applyIncomingHit";
const PC_SOCKETLIB_HANDLER_CANCEL_REMOTE_PROMPT = "cancelRemotePrompt";
const _pcPendingSeizeRequests = new Map();
let _pcSocketlib = null;
let _pcSocketlibInitializationQueued = false;

function _initializePeasantSocketlib() {
  if (_pcSocketlibInitializationQueued) return;
  _pcSocketlibInitializationQueued = true;
  Hooks.once("socketlib.ready", () => {
    try {
      if (typeof socketlib === "undefined") {
        console.warn("Peasant Core | socketlib is not available. Defense prompts will fall back to raw sockets.");
        return;
      }

      const registerFn = typeof socketlib.registerSystem === "function"
        ? socketlib.registerSystem.bind(socketlib)
        : (typeof socketlib.registerModule === "function" ? socketlib.registerModule.bind(socketlib) : null);
      if (!registerFn) {
        console.warn("Peasant Core | socketlib does not expose registerSystem/registerModule.");
        return;
      }

      _pcSocketlib = registerFn("peasant-core");
      game.peasantCoreSocketlib = _pcSocketlib;
      _registerPeasantCoreApi({ socketlib: _pcSocketlib });
      _pcSocketlib.register(PC_SOCKETLIB_HANDLER_PROMPT_DEFENSE, async (payload = {}) => {
        pcLog.debug("Peasant Core | socketlib defense prompt received", {
          recipient: game.user?.name,
          attack: payload.attackCombatName,
          targetingType: payload.attackTargetingType
        });
        const handler = _getPeasantCoreApiFunction("showDefensePrompt");
        if (typeof handler === "function") return await handler(payload);
        return false;
      });
      _pcSocketlib.register(PC_SOCKETLIB_HANDLER_PROMPT_INCOMING_HIT, async (payload = {}) => {
        pcLog.debug("Peasant Core | socketlib incoming hit prompt received", {
          recipient: game.user?.name,
          attack: payload.attackCombatName,
          location: payload.locationDisplay || payload.location
        });
        const handler = _getPeasantCoreApiFunction("showIncomingHitPrompt");
        if (typeof handler === "function") return await handler(payload);
        return false;
      });
      _pcSocketlib.register(PC_SOCKETLIB_HANDLER_APPLY_INCOMING_HIT, async (payload = {}) => {
        pcLog.debug("Peasant Core | socketlib incoming hit apply received", {
          recipient: game.user?.name,
          attack: payload.attackCombatName,
          location: payload.locationDisplay || payload.location,
          damageAmount: payload.damageAmount
        });
        const handler = _getPeasantCoreApiFunction("applyIncomingHit");
        if (typeof handler === "function") return await handler(payload);
        return false;
      });
      _pcSocketlib.register(PC_SOCKETLIB_HANDLER_CANCEL_REMOTE_PROMPT, async (payload = {}) => {
        pcLog.debug("Peasant Core | socketlib remote prompt cancel received", {
          recipient: game.user?.name,
          promptId: payload.promptId
        });
        const handler = _getPeasantCoreApiFunction("closeRemotePrompt");
        if (typeof handler === "function") {
          return await handler(payload.promptId, {
            selection: "close",
            chainCancelled: true
          });
        }
        return false;
      });
      pcLog.debug("Peasant Core | socketlib defense prompt handler registered.");
    } catch (err) {
      console.error("Peasant Core | Failed to initialize socketlib support", err);
    }
  });
}

async function _requestDefensePromptForUser(userId, payload = {}) {
  if (!userId) return false;

  if (userId === game.user?.id) {
    const handler = _getPeasantCoreApiFunction("showDefensePrompt");
    if (typeof handler === "function") return await handler(payload);
    return false;
  }

  const handleLocallyAsGM = async (reason) => {
    if (!game.user?.isGM) return false;
    const handler = _getPeasantCoreApiFunction("showDefensePrompt");
    if (typeof handler !== "function") return false;
    pcLog.warn("Peasant Core | Handling defense prompt on GM client", {
      reason,
      intendedRecipientUserId: userId,
      attack: payload.attackCombatName,
      target: payload.targetTokenName || payload.targetActorId
    });
    return await handler({
      ...payload,
      recipientUserId: game.user.id
    });
  };

  if (_pcSocketlib?.executeAsUser) {
    try {
      const result = await _pcSocketlib.executeAsUser(PC_SOCKETLIB_HANDLER_PROMPT_DEFENSE, userId, payload);
      pcLog.debug("Peasant Core | socketlib defense prompt sent", {
        recipientUserId: userId,
        attack: payload.attackCombatName,
        target: payload.targetTokenName || payload.targetActorId
      });
      if (result === false || result == null) {
        const localResult = await handleLocallyAsGM("remote-unhandled");
        if (localResult !== false) return localResult;
      }
      return result;
    } catch (err) {
      console.warn("Peasant Core | socketlib defense prompt failed, falling back to raw socket", err);
      const localResult = await handleLocallyAsGM("socketlib-error");
      if (localResult !== false) return localResult;
    }
  }

  const localResult = await handleLocallyAsGM("socketlib-unavailable");
  if (localResult !== false) return localResult;

  if (game?.socket) {
    game.socket.emit(PC_SOCKET_NAMESPACE, {
      ...payload,
      type: PC_SOCKET_PROMPT_DEFENSE,
      recipientUserId: userId
    });
    return { handled: false, deferred: true, appliedAccuracyPenalty: 0 };
  }

  return false;
}

async function _requestIncomingHitForUser(userId, payload = {}) {
  if (!userId) return false;

  if (userId === game.user?.id) {
    const handler = _getPeasantCoreApiFunction("showIncomingHitPrompt");
    if (typeof handler === "function") return await handler(payload);
    return false;
  }

  if (_pcSocketlib?.executeAsUser) {
    try {
      const result = await _pcSocketlib.executeAsUser(PC_SOCKETLIB_HANDLER_PROMPT_INCOMING_HIT, userId, payload);
      pcLog.debug("Peasant Core | socketlib incoming hit prompt sent", {
        recipientUserId: userId,
        attack: payload.attackCombatName,
        target: payload.targetTokenName || payload.targetActorId
      });
      return result;
    } catch (err) {
      console.warn("Peasant Core | socketlib incoming hit prompt failed, falling back to raw socket", err);
    }
  }

  if (game?.socket) {
    game.socket.emit(PC_SOCKET_NAMESPACE, {
      ...payload,
      type: PC_SOCKET_PROMPT_INCOMING_HIT,
      recipientUserId: userId
    });
    return { handled: false, deferred: true, applied: false };
  }

  return false;
}

async function _applyIncomingHitForUser(userId, payload = {}) {
  if (!userId) return false;

  if (userId === game.user?.id) {
    const handler = _getPeasantCoreApiFunction("applyIncomingHit");
    if (typeof handler === "function") return await handler(payload);
    return false;
  }

  if (_pcSocketlib?.executeAsUser) {
    try {
      const result = await _pcSocketlib.executeAsUser(PC_SOCKETLIB_HANDLER_APPLY_INCOMING_HIT, userId, payload);
      pcLog.debug("Peasant Core | socketlib incoming hit apply sent", {
        recipientUserId: userId,
        attack: payload.attackCombatName,
        target: payload.targetTokenName || payload.targetActorId
      });
      return result;
    } catch (err) {
      console.warn("Peasant Core | socketlib incoming hit apply failed, falling back to raw socket", err);
    }
  }

  if (game?.socket) {
    game.socket.emit(PC_SOCKET_NAMESPACE, {
      ...payload,
      type: PC_SOCKET_APPLY_INCOMING_HIT,
      recipientUserId: userId
    });
    return { handled: false, deferred: true, applied: false };
  }

  return false;
}

async function _cancelRemotePromptForUser(userId, payload = {}) {
  if (!userId || !payload?.promptId) return false;

  if (userId === game.user?.id) {
    const handler = _getPeasantCoreApiFunction("closeRemotePrompt");
    if (typeof handler === "function") {
      return await handler(payload.promptId, {
        selection: "close",
        chainCancelled: true
      });
    }
    return false;
  }

  if (_pcSocketlib?.executeAsUser) {
    try {
      const result = await _pcSocketlib.executeAsUser(PC_SOCKETLIB_HANDLER_CANCEL_REMOTE_PROMPT, userId, payload);
      pcLog.debug("Peasant Core | socketlib remote prompt cancel sent", {
        recipientUserId: userId,
        promptId: payload.promptId
      });
      return result;
    } catch (err) {
      console.warn("Peasant Core | socketlib remote prompt cancel failed, falling back to raw socket", err);
    }
  }

  if (game?.socket) {
    game.socket.emit(PC_SOCKET_NAMESPACE, {
      ...payload,
      type: PC_SOCKET_CANCEL_REMOTE_PROMPT,
      recipientUserId: userId
    });
    return { handled: false, deferred: true };
  }

  return false;
}

export function initializePeasantSockets() {
  _registerPeasantCoreApi({
    requestDefensePromptForUser: _requestDefensePromptForUser,
    requestIncomingHitForUser: _requestIncomingHitForUser,
    applyIncomingHitForUser: _applyIncomingHitForUser,
    cancelPromptForUser: _cancelRemotePromptForUser
  });

  _initializePeasantSocketlib();
}

function _getPreferredActiveGM() {
  const activeGMs = Array.from(game?.users || [])
    .filter(user => user?.active && user?.isGM)
    .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
  return activeGMs[0] || null;
}

function _userOwnsCombatant(user, combatant) {
  if (!user || !combatant) return false;
  if (user.isGM) return true;

  const ownerLevel = CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  const actor = combatant.actor || combatant.token?.actor || null;

  try {
    if (typeof actor?.testUserPermission === "function" && actor.testUserPermission(user, ownerLevel)) {
      return true;
    }
  } catch (e) {
    pcLog.debug("Peasant Core | Actor permission check failed", e);
  }

  try {
    if (typeof combatant?.testUserPermission === "function" && combatant.testUserPermission(user, ownerLevel)) {
      return true;
    }
  } catch (e) {
    pcLog.debug("Peasant Core | Combatant permission check failed", e);
  }

  try {
    if (typeof actor?.canUserModify === "function" && actor.canUserModify(user, "update")) {
      return true;
    }
  } catch (e) {
    pcLog.debug("Peasant Core | Actor modify check failed", e);
  }

  return false;
}

function _userOwnsActorOrToken(user, actor, tokenDocument = null) {
  if (!user) return false;
  if (user.isGM) return true;

  const ownerLevel = CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;

  try {
    if (typeof actor?.testUserPermission === "function" && actor.testUserPermission(user, ownerLevel)) {
      return true;
    }
  } catch (e) {
    pcLog.debug("Peasant Core | Actor permission check failed", e);
  }

  try {
    if (typeof tokenDocument?.testUserPermission === "function" && tokenDocument.testUserPermission(user, ownerLevel)) {
      return true;
    }
  } catch (e) {
    pcLog.debug("Peasant Core | Token permission check failed", e);
  }

  try {
    if (typeof actor?.canUserModify === "function" && actor.canUserModify(user, "update")) {
      return true;
    }
  } catch (e) {
    pcLog.debug("Peasant Core | Actor modify check failed", e);
  }

  try {
    if (user?.character?.id && actor?.id && user.character.id === actor.id) {
      return true;
    }
  } catch (e) {}

  return false;
}

async function _resolveDefensePromptTarget(payload) {
  const sceneId = String(payload?.targetSceneId || "").trim();
  const tokenId = String(payload?.targetTokenId || "").trim();
  if (sceneId && tokenId) {
    try {
      const tokenDocument = game.scenes?.get(sceneId)?.tokens?.get(tokenId) || null;
      const actor = tokenDocument?.actor || tokenDocument?.object?.actor || null;
      if (actor) {
        return { tokenDocument, actor };
      }
    } catch (e) {
      pcLog.debug("Peasant Core | Failed to resolve defense prompt target from scene/token ids", e);
    }
  }

  let tokenDocument = null;
  const tokenUuid = String(payload?.targetTokenUuid || "").trim();
  if (tokenUuid && typeof fromUuid === "function") {
    try {
      tokenDocument = await fromUuid(tokenUuid);
    } catch (e) {
      pcLog.debug("Peasant Core | Failed to resolve defense prompt token", e);
    }
  }

  let actor = tokenDocument?.actor || tokenDocument?.object?.actor || null;

  if (!actor) {
    const actorId = String(payload?.targetActorId || "").trim();
    if (actorId) actor = game.actors?.get(actorId) || null;
  }

  if (!actor) {
    const actorUuid = String(payload?.targetActorUuid || "").trim();
    if (actorUuid && typeof fromUuid === "function") {
      try {
        const resolved = await fromUuid(actorUuid);
        if (resolved?.documentName === "Actor" || String(resolved?.collectionName || "").toLowerCase() === "actors") {
          actor = resolved;
        }
      } catch (e) {
        pcLog.debug("Peasant Core | Failed to resolve defense prompt actor", e);
      }
    }
  }

  return {
    tokenDocument,
    actor
  };
}

function _getPreferredDefensePromptRecipient(actor, tokenDocument = null) {
  const activePlayers = Array.from(game?.users || [])
    .filter((user) => user?.active && !user?.isGM)
    .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));

  const playerRecipient = activePlayers.find((user) => _userOwnsActorOrToken(user, actor, tokenDocument));
  return playerRecipient || _getPreferredActiveGM();
}

function _canUseSeizeButton(combat, combatantId, phase) {
  if (!combat || !combat.round) return { ok: false, reason: "Combat is not active." };

  const normalizedPhase = Number(phase);
  if (![0, 1].includes(normalizedPhase)) {
    return { ok: false, reason: "Invalid seize phase." };
  }

  const currentCombatant = combat.combatant;
  if (!currentCombatant) return { ok: false, reason: "No active combatant." };

  const targetCombatant = combat.combatants.get(combatantId);
  if (!targetCombatant) return { ok: false, reason: "Combatant not found." };

  const currentIdx = Number(combat.turn);
  const targetIdx = combat.turns.findIndex(c => c.id === combatantId);
  if (!Number.isFinite(currentIdx) || targetIdx === -1) {
    return { ok: false, reason: "Combat turn order is unavailable." };
  }

  if (targetIdx <= currentIdx) {
    return { ok: false, reason: "Only higher initiative combatants can seize." };
  }

  const currentPhase = Number(combat.getFlag("peasant-core", "combatPhase") || 0);
  let movePassed = false;
  let stdPassed = false;

  if (currentPhase === 0) {
    if (targetIdx < currentIdx) movePassed = true;
  } else {
    movePassed = true;
    stdPassed = true;
  }

  const seizedMove = (combat.getFlag("peasant-core", "seizedMovement") || []).includes(combatantId);
  const seizedStd = (combat.getFlag("peasant-core", "seizedStandard") || []).includes(combatantId);

  if (normalizedPhase === 0) {
    if (seizedMove) return { ok: false, reason: "Movement has already been seized for that combatant." };
    if (movePassed) return { ok: false, reason: "Movement can no longer be seized." };
  } else {
    if (seizedStd) return { ok: false, reason: "Standard has already been seized for that combatant." };
    if (stdPassed) return { ok: false, reason: "Standard can no longer be seized." };
  }

  return { ok: true, targetCombatant };
}

export async function requestSeizeTurnFromGM(combat, combatantId, phase) {
  const gm = _getPreferredActiveGM();
  if (!combat?.id) {
    ui.notifications?.error?.("Combat is not available for seize.");
    return false;
  }
  if (!gm) {
    ui.notifications?.error?.("A GM must be online to process seize actions.");
    return false;
  }

  const requestId = foundry.utils.randomID();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      _pcPendingSeizeRequests.delete(requestId);
      reject(new Error("Timed out waiting for GM seize response."));
    }, 10000);

    _pcPendingSeizeRequests.set(requestId, { resolve, reject, timeout });
    pcLog.debug(`Peasant Core | Sending seize request ${requestId} for combat ${combat.id} combatant ${combatantId} phase ${phase}`);
    game.socket.emit(PC_SOCKET_NAMESPACE, {
      type: PC_SOCKET_REQUEST_SEIZE_TURN,
      requestId,
      userId: game.user.id,
      combatId: combat.id,
      combatantId,
      phase: Number(phase)
    });
  }).catch(err => {
    console.warn("Peasant Core | Seize request failed", err);
    ui.notifications?.error?.(err?.message || "Failed to process seize action.");
    return false;
  });
}

export function registerPeasantSocketHandler() {
  if (!game?.socket) return;

  try {
    if (game.__pcSocketHandler && typeof game.socket.off === "function") {
      game.socket.off(PC_SOCKET_NAMESPACE, game.__pcSocketHandler);
    }
  } catch (e) {
    pcLog.debug("Peasant Core | Failed removing prior socket handler", e);
  }

  game.__pcSocketHandler = async payload => {
    if (!payload || typeof payload !== "object") return;

    try {
      if (payload.type === PC_SOCKET_PROMPT_DEFENSE) {
        if (payload.recipientUserId && payload.recipientUserId !== game.user?.id) return;

        const { tokenDocument, actor } = await _resolveDefensePromptTarget(payload);
        if (!actor) return;

        const recipient = payload.recipientUserId
          ? game.users?.get(payload.recipientUserId) || null
          : _getPreferredDefensePromptRecipient(actor, tokenDocument);
        if (!recipient || recipient.id !== game.user?.id) return;

        pcLog.debug("Peasant Core | Received defense prompt", {
          recipient: game.user?.name,
          target: tokenDocument?.name || actor?.name,
          attack: payload.attackCombatName,
          targetingType: payload.attackTargetingType
        });

        const handler = _getPeasantCoreApiFunction("showDefensePrompt");
        if (typeof handler === "function") {
          await handler({
            ...payload,
            targetActorId: actor.id,
            targetActorUuid: actor.uuid,
            targetTokenUuid: tokenDocument?.uuid || payload.targetTokenUuid || null,
            targetTokenName: tokenDocument?.name || payload.targetTokenName || actor.name || "Target"
          });
        }
        return;
      }

      if (payload.type === PC_SOCKET_PROMPT_INCOMING_HIT) {
        if (payload.recipientUserId && payload.recipientUserId !== game.user?.id) return;

        const { tokenDocument, actor } = await _resolveDefensePromptTarget(payload);
        if (!actor) return;

        const recipient = payload.recipientUserId
          ? game.users?.get(payload.recipientUserId) || null
          : _getPreferredDefensePromptRecipient(actor, tokenDocument);
        if (!recipient || recipient.id !== game.user?.id) return;

        pcLog.debug("Peasant Core | Received incoming hit prompt", {
          recipient: game.user?.name,
          target: tokenDocument?.name || actor?.name,
          attack: payload.attackCombatName,
          location: payload.locationDisplay || payload.location
        });

        const handler = _getPeasantCoreApiFunction("showIncomingHitPrompt");
        if (typeof handler === "function") {
          await handler({
            ...payload,
            targetActorId: actor.id,
            targetActorUuid: actor.uuid,
            targetTokenUuid: tokenDocument?.uuid || payload.targetTokenUuid || null,
            targetTokenName: tokenDocument?.name || payload.targetTokenName || actor.name || "Target"
          });
        }
        return;
      }

      if (payload.type === PC_SOCKET_APPLY_INCOMING_HIT) {
        if (payload.recipientUserId && payload.recipientUserId !== game.user?.id) return;

        const { tokenDocument, actor } = await _resolveDefensePromptTarget(payload);
        if (!actor) return;

        const recipient = payload.recipientUserId
          ? game.users?.get(payload.recipientUserId) || null
          : _getPreferredDefensePromptRecipient(actor, tokenDocument);
        if (!recipient || recipient.id !== game.user?.id) return;

        pcLog.debug("Peasant Core | Received incoming hit apply", {
          recipient: game.user?.name,
          target: tokenDocument?.name || actor?.name,
          attack: payload.attackCombatName,
          location: payload.locationDisplay || payload.location,
          damageAmount: payload.damageAmount
        });

        const handler = _getPeasantCoreApiFunction("applyIncomingHit");
        if (typeof handler === "function") {
          await handler({
            ...payload,
            targetActorId: actor.id,
            targetActorUuid: actor.uuid,
            targetTokenUuid: tokenDocument?.uuid || payload.targetTokenUuid || null,
            targetTokenName: tokenDocument?.name || payload.targetTokenName || actor.name || "Target"
          });
        }
        return;
      }

      if (payload.type === PC_SOCKET_CANCEL_REMOTE_PROMPT) {
        if (payload.recipientUserId && payload.recipientUserId !== game.user?.id) return;

        const { tokenDocument, actor } = await _resolveDefensePromptTarget(payload);
        if (!actor && payload.targetActorId) {
          pcLog.debug("Peasant Core | Remote prompt cancel target actor could not be resolved", payload.targetActorId);
        }

        const recipient = payload.recipientUserId
          ? game.users?.get(payload.recipientUserId) || null
          : (actor ? _getPreferredDefensePromptRecipient(actor, tokenDocument) : null);
        if (payload.recipientUserId && recipient && recipient.id !== game.user?.id) return;
        if (!payload.recipientUserId && recipient && recipient.id !== game.user?.id) return;

        const handler = _getPeasantCoreApiFunction("closeRemotePrompt");
        if (typeof handler === "function") {
          await handler(payload.promptId, {
            selection: "close",
            chainCancelled: true
          });
        }
        return;
      }

      if (payload.type === PC_SOCKET_RESPONSE_SEIZE_TURN) {
        if (payload.userId !== game.user?.id) return;

        const pending = _pcPendingSeizeRequests.get(payload.requestId);
        if (!pending) return;

        clearTimeout(pending.timeout);
        _pcPendingSeizeRequests.delete(payload.requestId);

        if (payload.ok) {
          if (payload.combatantName) {
            const phaseName = Number(payload.phase) === 0 ? "Movement" : "Standard";
            ui.notifications?.warn?.(`${payload.combatantName} SEIZED THE TURN! (${phaseName})`);
          }
          pending.resolve(true);
        } else {
          pending.reject(new Error(payload.error || "Seize request was rejected."));
        }
        return;
      }

      if (payload.type !== PC_SOCKET_REQUEST_SEIZE_TURN) return;
      if (!game.user?.isGM) return;

      const preferredGM = _getPreferredActiveGM();
      if (!preferredGM || preferredGM.id !== game.user.id) return;

      const respond = response => {
        game.socket.emit(PC_SOCKET_NAMESPACE, {
          type: PC_SOCKET_RESPONSE_SEIZE_TURN,
          requestId: payload.requestId,
          userId: payload.userId,
          ...response
        });
      };

      const requester = game.users?.get(payload.userId);
      const combat = game.combats?.get(payload.combatId) || null;
      if (!requester) {
        respond({ ok: false, error: "Requesting user was not found." });
        return;
      }
      if (!combat) {
        respond({ ok: false, error: "Combat no longer exists." });
        return;
      }

      const combatantId = String(payload.combatantId || "");
      const phase = Number(payload.phase);
      const seizeCheck = _canUseSeizeButton(combat, combatantId, phase);
      if (!seizeCheck.ok) {
        respond({ ok: false, error: seizeCheck.reason });
        return;
      }

      if (!_userOwnsCombatant(requester, seizeCheck.targetCombatant)) {
        respond({ ok: false, error: "You do not own that combatant." });
        return;
      }

      pcLog.debug(`Peasant Core | GM ${game.user.name} handling seize request ${payload.requestId} from ${requester.name}`);
      await combat.seizeTurn(combatantId, phase);
      respond({
        ok: true,
        combatantName: seizeCheck.targetCombatant?.name || "Combatant",
        phase
      });
    } catch (err) {
      console.error("Peasant Core | Socket handler error", err);
      if (payload.type === PC_SOCKET_REQUEST_SEIZE_TURN && game.user?.isGM) {
        game.socket.emit(PC_SOCKET_NAMESPACE, {
          type: PC_SOCKET_RESPONSE_SEIZE_TURN,
          requestId: payload.requestId,
          userId: payload.userId,
          ok: false,
          error: err?.message || "GM failed to process seize request."
        });
      }
    }
  };

  game.socket.on(PC_SOCKET_NAMESPACE, game.__pcSocketHandler);
}



