import { requestSeizeTurnFromGM } from "../socket/remote-prompts.mjs";
import { qsa, qs, toElement } from "./dom.mjs";

const SEIZE_WIDTH_PX = "64px";
const SEIZE_HEIGHT_PX = "32px";

function lockSeizeContainerSize(el) {
  if (!el) return;
  el.style.setProperty("display", "grid", "important");
  el.style.setProperty("grid-template-columns", "1fr", "important");
  el.style.setProperty("gap", "2px", "important");
  el.style.setProperty("width", SEIZE_WIDTH_PX, "important");
  el.style.setProperty("min-width", SEIZE_WIDTH_PX, "important");
  el.style.setProperty("max-width", SEIZE_WIDTH_PX, "important");
  el.style.setProperty("flex", `0 0 ${SEIZE_WIDTH_PX}`, "important");
  el.style.setProperty("margin", "0 4px", "important");
  el.style.setProperty("align-self", "center", "important");
}

function lockSeizeButtonSize(el) {
  if (!el) return;
  el.style.setProperty("width", SEIZE_WIDTH_PX, "important");
  el.style.setProperty("min-width", SEIZE_WIDTH_PX, "important");
  el.style.setProperty("max-width", SEIZE_WIDTH_PX, "important");
  el.style.setProperty("height", SEIZE_HEIGHT_PX, "important");
  el.style.setProperty("min-height", SEIZE_HEIGHT_PX, "important");
  el.style.setProperty("max-height", SEIZE_HEIGHT_PX, "important");
  el.style.setProperty("padding", "0 0.2rem", "important");
  el.style.setProperty("white-space", "normal", "important");
  el.style.setProperty("line-height", "1.15", "important");
  el.style.setProperty("text-align", "center", "important");
  el.style.setProperty("box-sizing", "border-box", "important");
}

function userOwnsCombatantForSeize(user, combatant) {
  if (!user || !combatant) return false;
  if (user.isGM) return true;

  const ownerLevel = CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  const actor = combatant.actor || combatant.token?.actor || null;
  const tokenDocument = combatant.token?.document || combatant.token || null;

  try {
    if (typeof actor?.testUserPermission === "function" && actor.testUserPermission(user, ownerLevel)) return true;
  } catch (e) {}

  try {
    if (typeof combatant?.testUserPermission === "function" && combatant.testUserPermission(user, ownerLevel)) return true;
  } catch (e) {}

  try {
    if (typeof tokenDocument?.testUserPermission === "function" && tokenDocument.testUserPermission(user, ownerLevel)) return true;
  } catch (e) {}

  try {
    if (typeof actor?.canUserModify === "function" && actor.canUserModify(user, "update")) return true;
  } catch (e) {}

  try {
    if (user?.character?.id && actor?.id && user.character.id === actor.id) return true;
  } catch (e) {}

  return false;
}

async function handleSeizeClick(event, combat, combatantId, phase) {
  event.preventDefault();
  event.stopPropagation();

  try {
    if (game.user?.isGM) {
      await combat.seizeTurn(combatantId, phase);
      return;
    }
    await requestSeizeTurnFromGM(combat, combatantId, phase);
  } catch (err) {
    const phaseName = phase === 0 ? "movement" : "standard";
    console.error(`Peasant Core | Seize ${phaseName} failed`, err);
    ui.notifications?.error?.(err?.message || `Failed to seize ${phaseName}.`);
  }
}

export function configureCombatTracker() {
  Hooks.on("renderCombatTracker", async (app, html, data) => {
    const combat = game.combat;
    if (!combat || !combat.round) return;

    const currentCombatant = combat.combatant;
    if (!currentCombatant) return;

    const currentIdx = combat.turn;
    const currentPhase = combat.getFlag("peasant-core", "combatPhase") || 0;
    const root = toElement(html);
    if (!root) return;

    for (const row of qsa(root, ".combatant")) {
      const id = row.dataset.combatantId;
      const combatant = combat.combatants.get(id);

      if (!combatant || combatant.id === currentCombatant.id) continue;
      if (!userOwnsCombatantForSeize(game.user, combatant)) continue;

      const myIdx = combat.turns.findIndex(c => c.id === id);
      if (myIdx <= currentIdx) continue;

      const seizedMove = (combat.getFlag("peasant-core", "seizedMovement") || []).includes(id);
      const seizedStd = (combat.getFlag("peasant-core", "seizedStandard") || []).includes(id);

      let movePassed = false;
      let stdPassed = false;
      if (currentPhase === 0) {
        if (myIdx < currentIdx) movePassed = true;
      } else {
        movePassed = true;
        stdPassed = true;
      }

      const btnContainer = document.createElement("div");
      btnContainer.className = "seize-buttons";
      lockSeizeContainerSize(btnContainer);

      if (!seizedMove && !movePassed) {
        const moveBtn = document.createElement("button");
        moveBtn.type = "button";
        moveBtn.className = "seize-btn seize-move";
        moveBtn.title = "Seize Movement Phase";
        moveBtn.textContent = "Seize Move";
        lockSeizeButtonSize(moveBtn);
        moveBtn.addEventListener("click", (event) => handleSeizeClick(event, combat, id, 0));
        btnContainer.append(moveBtn);
      }

      if (!seizedStd && !stdPassed) {
        const stdBtn = document.createElement("button");
        stdBtn.type = "button";
        stdBtn.className = "seize-btn seize-std";
        stdBtn.title = "Seize Standard Phase";
        stdBtn.textContent = "Seize Standard";
        lockSeizeButtonSize(stdBtn);
        stdBtn.addEventListener("click", (event) => handleSeizeClick(event, combat, id, 1));
        btnContainer.append(stdBtn);
      }

      if (btnContainer.children.length > 0) {
        const initBox = qs(row, ".token-initiative");
        if (initBox) initBox.before(btnContainer);
        else qs(row, ".token-name")?.after(btnContainer);
      }
    }
  });
}
