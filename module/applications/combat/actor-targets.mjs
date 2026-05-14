import { pcLog } from "../../utils/logging.mjs";

export function getPreferredActorToken(actor) {
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

export function getActorRollSpeaker(actor, token = null) {
  const resolvedToken = token || getPreferredActorToken(actor);
  if (resolvedToken) {
    return ChatMessage.getSpeaker({ actor, token: resolvedToken.document ?? resolvedToken });
  }
  return ChatMessage.getSpeaker({ actor });
}

export function getActiveNotableCombatTargets() {
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

export function userOwnsActorOrToken(user, actor, tokenDocument = null) {
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

export function getPreferredDefensePromptRecipientUser(actor, tokenDocument = null) {
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

export async function resolveDefensePromptActor(payload = {}) {
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
