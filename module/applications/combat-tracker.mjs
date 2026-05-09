import { requestSeizeTurnFromGM } from "../socket/remote-prompts.mjs";

const SEIZE_WIDTH_PX = "64px";
const SEIZE_HEIGHT_PX = "32px";

function lockSeizeContainerSize($el) {
  const el = $el?.[0];
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

function lockSeizeButtonSize($el) {
  const el = $el?.[0];
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
    const $html = html instanceof jQuery ? html : $(html);

    $html.find(".combatant").each(function() {
      const $row = $(this);
      const id = $row.data("combatant-id");
      const combatant = combat.combatants.get(id);

      if (!combatant || combatant.id === currentCombatant.id) return;

      const myIdx = combat.turns.findIndex(c => c.id === id);
      if (myIdx <= currentIdx) return;

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

      const btnContainer = $('<div class="seize-buttons"></div>');
      lockSeizeContainerSize(btnContainer);

      if (!seizedMove && !movePassed) {
        const moveBtn = $('<button type="button" class="seize-btn seize-move" title="Seize Movement Phase">Seize Move</button>');
        lockSeizeButtonSize(moveBtn);
        moveBtn.on("click", (event) => handleSeizeClick(event, combat, id, 0));
        btnContainer.append(moveBtn);
      }

      if (!seizedStd && !stdPassed) {
        const stdBtn = $('<button type="button" class="seize-btn seize-std" title="Seize Standard Phase">Seize Standard</button>');
        lockSeizeButtonSize(stdBtn);
        stdBtn.on("click", (event) => handleSeizeClick(event, combat, id, 1));
        btnContainer.append(stdBtn);
      }

      if (btnContainer.children().length > 0) {
        const initBox = $row.find(".token-initiative");
        if (initBox.length) initBox.before(btnContainer);
        else $row.find(".token-name").after(btnContainer);
      }
    });
  });
}
