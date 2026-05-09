import { pcLog } from "../utils/logging.mjs";

const sortCombatantsAscending = function(a, b) {
  const ia = Number.isNumeric(a.initiative) ? a.initiative : -Infinity;
  const ib = Number.isNumeric(b.initiative) ? b.initiative : -Infinity;

  // Sort by initiative ascending
  let diff = ia - ib;

  // Tiebreaker: use initiative score first, then roll-off flag if still equal
  if (diff === 0) {
    const scoreA = getCombatantInitiativeScore(a);
    const scoreB = getCombatantInitiativeScore(b);
    diff = scoreA - scoreB;
  }

  if (diff === 0) {
    const tieA = a.getFlag("peasant-core", "initiativeTiebreaker") || 0;
    const tieB = b.getFlag("peasant-core", "initiativeTiebreaker") || 0;

    // Lower tiebreaker value (e.g. 4) goes BEFORE Higher (e.g. 6) in ascending sort
    diff = tieA - tieB;
  }

  // Final Tiebreaker: use ID to ensure stable sort
  if (diff === 0) {
    return a.id.localeCompare(b.id);
  }

  return diff;
};

const getCombatantInitiativeScore = function(combatant) {
  return parseInt(combatant?.actor?.system?.initiative) || 0;
};

export class PeasantCombat extends Combat {}

const PC_INITIATIVE_SAVE_FLAG = "rollInitiativeAsSaves";

function installPeasantCombatMethods() {
  if (PeasantCombat.prototype._peasantCoreMethodsInstalled) return;
  Object.defineProperty(PeasantCombat.prototype, "_peasantCoreMethodsInstalled", {
    value: true,
    configurable: false
  });

  const getCombatState = function(combat) {
    if (!combat) return null;
    if (combat.turn === null || combat.turn === undefined) return null;
    return {
      round: Number(combat.round ?? 0),
      turn: Number(combat.turn ?? 0),
      phase: Number(combat.getFlag("peasant-core", "combatPhase") || 0),
      combatantId: combat.combatant?.id ?? null,
      combatantName: combat.combatant?.name ?? null
    };
  };

  const normalizeHistoryState = function(state) {
    if (!state) return null;
    if (state.turn === null || state.turn === undefined) return null;
    return {
      round: Number(state.round ?? 0),
      turn: Number(state.turn ?? 0),
      phase: Number(state.phase ?? 0),
      combatantId: state.combatantId ?? null,
      combatantName: state.combatantName ?? null
    };
  };

  const statesEqual = function(a, b) {
    if (!a || !b) return false;
    return Number(a.round) === Number(b.round)
      && Number(a.turn) === Number(b.turn)
      && Number(a.phase ?? 0) === Number(b.phase ?? 0)
      && (a.combatantId ?? null) === (b.combatantId ?? null);
  };

  // Undo matching should prioritize positional state (round/turn/phase).
  // Combatant id is checked only when both sides provide one.
  const statesMatchForUndo = function(recordedTo, currentState) {
    if (!recordedTo || !currentState) return false;
    const samePosition = Number(recordedTo.round) === Number(currentState.round)
      && Number(recordedTo.turn) === Number(currentState.turn)
      && Number(recordedTo.phase ?? 0) === Number(currentState.phase ?? 0);
    if (!samePosition) return false;

    const recordedId = recordedTo.combatantId ?? null;
    const currentId = currentState.combatantId ?? null;
    if (recordedId && currentId && recordedId !== currentId) return false;
    return true;
  };

  const getUndoStateFromHistoryEntry = function(entry, currentState = null) {
    if (!entry || typeof entry !== "object") return null;
    if (entry.type === "transition" && entry.from) {
      const fromState = normalizeHistoryState(entry.from);
      if (!fromState) return null;
      if (currentState) {
        const toState = normalizeHistoryState(entry.to);
        if (toState && !statesMatchForUndo(toState, currentState)) return null;
      }
      return fromState;
    }
    if (entry.round !== undefined || entry.turn !== undefined) return normalizeHistoryState(entry);
    return null;
  };

  const MAX_TURN_HISTORY_ENTRIES = 500;
  const TURN_UNDO_ACTIONS = new Set(["nextTurn", "seizeTurn"]);

  // Append a transition-style history entry to support deterministic reverse traversal.
  const addTurnTransition = async function(combat, action, fromState, meta = {}) {
    const start = normalizeHistoryState(fromState);
    const end = getCombatState(combat);
    if (!start || !end) return false;
    if (statesEqual(start, end)) return false;

    const turnHistory = Array.isArray(combat.getFlag("peasant-core", "turnHistory"))
      ? [...combat.getFlag("peasant-core", "turnHistory")]
      : [];
    const prevSeq = Number(combat.getFlag("peasant-core", "turnHistorySeq")) || 0;
    const seq = prevSeq + 1;

    turnHistory.push({
      type: "transition",
      seq,
      action: String(action || "unknown"),
      from: start,
      to: end,
      timestamp: Date.now(),
      meta
    });
    if (turnHistory.length > MAX_TURN_HISTORY_ENTRIES) {
      turnHistory.splice(0, turnHistory.length - MAX_TURN_HISTORY_ENTRIES);
    }

    await combat.setFlag("peasant-core", "turnHistory", turnHistory);
    await combat.setFlag("peasant-core", "turnHistorySeq", seq);

    const fromPhase = start.phase === 0 ? "Move" : "Std";
    const toPhase = end.phase === 0 ? "Move" : "Std";
    pcLog.debug(
      `Peasant Core | Transition[${seq}] ${action}: `
      + `${start.combatantName || start.combatantId || "?"} R${start.round} T${start.turn} ${fromPhase} -> `
      + `${end.combatantName || end.combatantId || "?"} R${end.round} T${end.turn} ${toPhase}`
    );
    return true;
  };

  PeasantCombat.prototype._sortCombatants = sortCombatantsAscending;

  const resolveTurnIndex = function(combat, state) {
    if (!combat || !state) return combat?.turn ?? 0;
    if (!combat.turns || combat.turns.length === 0) combat.setupTurns();

    if (state.combatantId) {
      const idx = combat.turns.findIndex(c => c.id === state.combatantId);
      if (idx !== -1) return idx;
    }

    return Number.isNumeric(state.turn) ? state.turn : (combat.turn ?? 0);
  };

  PeasantCombat.prototype.rollInitiative = async function(ids, options = {}) {
    pcLog.debug('Peasant Core | Custom rollInitiative called');
    const historyStartState = getCombatState(this);
    
    // Normalize ids to array
    if (!ids || ids.length === 0) {
      ids = this.combatants.filter(c => c.initiative === null).map(c => c.id);
    }
    ids = typeof ids === "string" ? [ids] : ids;
    
    const updates = [];
    const messages = [];
    const results = [];
    
    // 1. Roll for each combatant
    for (const id of ids) {
      const combatant = this.combatants.get(id);
      if (!combatant || !combatant.actor) continue;
      
      const actor = combatant.actor;
      const initiativeValue = actor.system?.initiative ? parseInt(actor.system.initiative) || 0 : 0;
      const rollAsSave = !!actor.getFlag?.("peasant-core", PC_INITIATIVE_SAVE_FLAG);
      
      // Roll initiative dice: standard 2d6, or 3d6 keep highest 2 when actor flag is enabled.
      const roll = new Roll(rollAsSave ? "3d6" : "2d6");
      await roll.evaluate();
      
      const rolledDice = roll.dice[0].results.map(r => r.result);
      let dice = rolledDice;
      let baseDiceTotal = roll.total;
      let diceDisplay = rolledDice.join(", ");

      if (rollAsSave) {
        const droppedValue = Math.min(...rolledDice);
        const droppedIndex = rolledDice.indexOf(droppedValue);
        dice = rolledDice.filter((_, index) => index !== droppedIndex);
        baseDiceTotal = (dice[0] || 0) + (dice[1] || 0);
        diceDisplay = rolledDice
          .map((die, index) => index === droppedIndex ? `<span style="color: #888;">${die}</span>` : `${die}`)
          .join(", ");
      }

      let diceTotal = baseDiceTotal;
      let extraDice = [];
      let criticalType = null;
      
      // Check for critical success (double 6s)
      if (dice[0] === 6 && dice[1] === 6) {
        criticalType = 'success';
        let keepRolling = true;
        while (keepRolling) {
          const extraRoll = new Roll("1d6");
          await extraRoll.evaluate();
          const extraValue = extraRoll.total;
          extraDice.push(extraValue);
          diceTotal += extraValue;
          if (extraValue !== 6) keepRolling = false;
        }
      }
      // Check for critical failure (double 1s)
      else if (dice[0] === 1 && dice[1] === 1) {
        criticalType = 'failure';
        let keepRolling = true;
        while (keepRolling) {
          const extraRoll = new Roll("1d6");
          await extraRoll.evaluate();
          const extraValue = extraRoll.total;
          extraDice.push(extraValue);
          diceTotal -= extraValue;
          if (extraValue !== 6) keepRolling = false;
        }
      }
      
      const total = diceTotal + initiativeValue;
      
      results.push({
        id,
        combatant,
        actor,
        initiativeValue,
        roll,
        rollAsSave,
        dice,
        diceDisplay,
        baseDiceTotal,
        extraDice,
        criticalType,
        total,
        tiebreaker: 0,
        rollOffs: []
      });
    }

    // 2. Handle Ties (Global Check against ALL combatants)
    // We need to check if the NEW rolls collide with EXISTING rolls
    
    // First, map everyone's proposed initiative
    const allCombatantData = [];
    
    // Add the new results
    results.forEach(r => {
        allCombatantData.push({
            id: r.id,
            total: r.total,
            initiativeValue: r.initiativeValue,
            isNew: true,
            resultObj: r, // Reference to the result object to update tiebreaker/rolloffs
            tiebreaker: 0
        });
    });
    
    // Add existing combatants who were NOT rolled
    this.combatants.forEach(c => {
        if (!ids.includes(c.id) && c.initiative !== null) {
            allCombatantData.push({
                id: c.id,
                total: c.initiative,
                initiativeValue: getCombatantInitiativeScore(c),
                isNew: false,
                combatant: c,
                tiebreaker: c.getFlag("peasant-core", "initiativeTiebreaker") || 0
            });
        }
    });
    
    // Group by Total + Initiative Score. Roll off only when both are tied.
    const groups = {};
    allCombatantData.forEach(d => {
        const key = `${d.total}|${d.initiativeValue}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(d);
    });
    
    // Process Ties
    for (const key in groups) {
      const group = groups[key];
      if (group.length > 1) {
        // Tie detected among [Group].
        // We must roll off for ALL of them to determine order.
        
        let tied = true;
        while (tied) {
            const currentRolls = [];
            
            for (const d of group) {
                // Roll 1d6
                const tieRoll = new Roll("1d6");
                await tieRoll.evaluate();
                const val = tieRoll.total;
                
                d.tiebreaker = val;
                currentRolls.push(val);
                
                // If this is a NEW roll, update the result object for chat display
                if (d.isNew) {
                    d.resultObj.tiebreaker = val;
                    // We only want to show the FINAL winning roll, or list them? 
                    // User said: "Roll-Off Value: [4] = 4".
                    // I'll overwrite the list to show the final one.
                    d.resultObj.rollOffs = [val];
                } else {
                    // This is an existing combatant involved in a NEW tie.
                    // We need to update their flag.
                    // We also technically should show a chat message for them? 
                    // Or just update them silently? 
                    // User didn't specify showing roll-offs for passive participants, but updating order is critical.
                    updates.push({ _id: d.id }); // Placeholder to ensure we trigger update? 
                    // Actually we set flag directly below.
                }
            }
            
            // Check uniqueness
            const uniqueValues = new Set(currentRolls);
            if (uniqueValues.size === currentRolls.length) {
                tied = false;
            }
        }
      }
    }

    // 3. Apply Updates
    // Apply flags for EVERYONE involved in the logic (New + Old who tied)
    for (const d of allCombatantData) {
        // If it's a new roll, we already have it in `results` loop below
        // If it's an old roll involved in a tie, we need to update flag
        if (!d.isNew) {
             const c = this.combatants.get(d.id);
             if (c) await c.setFlag("peasant-core", "initiativeTiebreaker", d.tiebreaker);
        } else {
             // For new rolls, ensure the result object has the final tiebreaker
             // (Already done in the loop via reference)
        }
    }

    // 4. Create Updates and Messages for NEW rolls
    for (const r of results) {
      // Update initiative
      updates.push({ _id: r.id, initiative: r.total });
      // Set flag for tiebreaker
      await r.combatant.setFlag("peasant-core", "initiativeTiebreaker", r.tiebreaker);

      // Create styled chat message
      const rollId = foundry.utils.randomID();
      const criticalSign = r.criticalType === 'failure' ? '-' : '+';
      const criticalDiceTotal = r.extraDice.reduce((sum, val) => sum + val, 0);
      
      let detailsHTML = `<div style="color: #4a9eff; font-weight: bold; margin-bottom: 2px;">Roll Details:</div>
        <div>Dice: [${r.diceDisplay}] = ${r.baseDiceTotal}</div>`;
      
      if (r.extraDice.length > 0) {
        detailsHTML += `<div>Critical Dice: [${r.extraDice.join(', ')}] = ${criticalSign}${criticalDiceTotal}</div>`;
      }
      
      // Add Roll-off details if existing
      if (r.rollOffs.length > 0) {
         detailsHTML += `<div>Roll-Off: [${r.rollOffs.join(', ')}] = ${r.tiebreaker}</div>`;
      }
      
      detailsHTML += `<div>Initiative Score: <span style="cursor: pointer; padding: 2px 6px; background: #2a2a2a; border-radius: 3px; font-weight: bold; color: #9370db; border: 2px solid #7b68ee;">${r.initiativeValue >= 0 ? '+' : ''}${r.initiativeValue}</span></div>`;
      
      const chatContent = `<div class="skill-roll-card" style="background: #1e1e1e; border: 1px solid #444; border-radius: 4px; padding: 10px; color: #e0e0e0; font-family: var(--font-body, 'Signika', 'Palatino Linotype', sans-serif);">
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <div style="flex: 1; display: flex; justify-content: space-between; align-items: center; padding: 6px; background: #252525; border-radius: 3px; border-left: 3px solid #555;">
            <span style="color: #ffffff; font-weight: bold; font-size: 11px;">Initiative:</span>
            <button class="mos-toggle" data-roll-id="${rollId}" style="cursor: pointer; padding: 4px 8px; background: #2a2a2a; border-radius: 3px; font-size: 14px; font-weight: bold; color: #9370db; border: 2px solid #7b68ee;">
              ${r.total}
            </button>
          </div>
          <div class="roll-details" data-roll-id="${rollId}" style="display: none; background-color: #1a1a1a; color: #e0e0e0; border-radius: 4px; padding: 6px; border: 1px solid #555; font-size: 10px; line-height: 1.5;">
            ${detailsHTML}
          </div>
        </div>
      </div>`;
      
      messages.push({
        content: chatContent,
        speaker: ChatMessage.getSpeaker({ actor: r.actor }),
      });
    }
    
    // Update combatants
    if (updates.length > 0) {
      await this.updateEmbeddedDocuments("Combatant", updates);
      
      // If we rolled for multiple combatants (likely start of round), ensure we start at the bottom
      if (updates.length > 1 || (this.round === 0 && this.turn === null)) {
          // Reset to Movement phase (0)
          await this.setFlag("peasant-core", "combatPhase", 0);
          
          // Reset to first turn (0) and ensure round is set if starting combat
          const updateData = { turn: 0 };
          if (this.round === 0) updateData.round = 1;
          
          await this.update(updateData);
      }
      
      // Record state transition for deterministic undo/backtrack.
      await addTurnTransition(this, "rollInitiative", historyStartState, {
        rolledIds: ids
      });
    }
    
    // Post chat messages
    for (const msg of messages) {
      await ChatMessage.create({
        speaker: msg.speaker,
        content: msg.content,
        style: CONST.CHAT_MESSAGE_STYLES.OTHER
      });
    }

    // Announce the active combatant (usually start of round Movement Phase)
    if (this.combatant) {
      const currentPhase = this.getFlag("peasant-core", "combatPhase") || 0;
      const phaseName = currentPhase === 0 ? "Movement" : "Standard";
      ui.notifications.info(`${this.combatant.name} - ${phaseName} Phase`);
    }
    
    return this;
  };

  // Override nextTurn for two-phase system with Seizure support
  const originalNextTurn = Combat.prototype.nextTurn;
  PeasantCombat.prototype.nextTurn = async function(options = {}) {
    // Prevent infinite recursion
    const depth = options._recursionDepth || 0;
    const historyStartState = options._historyStartState || (depth === 0 ? getCombatState(this) : null);
    const finalize = async (result = this) => {
      if (depth === 0) {
        await addTurnTransition(this, "nextTurn", historyStartState, {
          recursionDepth: depth
        });
      }
      return result;
    };

    if (depth > 20) {
      ui.notifications.error("Peasant Core | Turn skip limit exceeded");
      return this;
    }

    // 1. Check if we are currently in a seizure (Seizure Stack)
    const seizureStack = this.getFlag("peasant-core", "seizureStack") || [];
    if (seizureStack.length > 0) {
        // Return to the interrupted state
        const returnState = seizureStack.pop();
        await this.setFlag("peasant-core", "seizureStack", seizureStack);
        
        await this.setFlag("peasant-core", "combatPhase", returnState.phase);
        await this.update({ round: returnState.round, turn: returnState.turn });
        
        ui.notifications.info(`Returning from Seizure -> ${this.combatant?.name || "Combatant"}`);
        return finalize(this);
    }

    // 2. Normal Flow with Skip Logic
    const currentPhase = this.getFlag("peasant-core", "combatPhase") || 0; // 0=Movement, 1=Standard
    const combatants = this.turns;
    const currentIdx = this.turn ?? -1;
    
    // Helper to check if next candidate is seized
    const isSeized = (id, phase) => {
        const flag = phase === 0 ? "seizedMovement" : "seizedStandard";
        const seized = this.getFlag("peasant-core", flag) || [];
        return seized.includes(id);
    };

    if (currentPhase === 0) {
      // Movement phase - going up (ascending)
      if (currentIdx >= combatants.length - 1) {
        // Reached top, switch to Standard phase
        await this.setFlag("peasant-core", "combatPhase", 1);
        
        // IMMEDIATE CHECK: Did this combatant seize Standard?
        // If so, we must skip them immediately by calling nextTurn again (which will now process as Standard phase)
        if (this.combatant && isSeized(this.combatant.id, 1)) {
             pcLog.debug(`Peasant Core | Skipping ${this.combatant.name} (Seized Standard at Transition)`);
             const result = await this.nextTurn({ _recursionDepth: depth + 1, _historyStartState: historyStartState });
             return finalize(result);
        }
        
        ui.notifications.info(`${this.combatant?.name || "Combatant"} - Standard Phase`);
      } else {
        // Move to next
        await originalNextTurn.call(this);
        
        // Check if this new combatant has seized this Movement phase
        if (this.combatant && isSeized(this.combatant.id, 0)) {
            pcLog.debug(`Peasant Core | Skipping ${this.combatant.name} (Seized Movement)`);
            const result = await this.nextTurn({ _recursionDepth: depth + 1, _historyStartState: historyStartState });
            return finalize(result);
        }
        
        ui.notifications.info(`${this.combatant?.name || "Combatant"} - Movement Phase`);
      }
    } else {
      // Standard phase - going down (descending)
      if (currentIdx <= 0) {
        // Reached bottom, round complete
        ui.notifications.warn("End of round. Use 'New Round' button to start next round.");
      } else {
        // Move to previous combatant's standard (going backwards through list)
        await this.update({ turn: currentIdx - 1 });
        
        // Check if this new combatant has seized this Standard phase
        if (this.combatant && isSeized(this.combatant.id, 1)) {
            pcLog.debug(`Peasant Core | Skipping ${this.combatant.name} (Seized Standard)`);
            const result = await this.nextTurn({ _recursionDepth: depth + 1, _historyStartState: historyStartState });
            return finalize(result);
        }
        
        ui.notifications.info(`${this.combatant?.name || "Combatant"} - Standard Phase`);
      }
    }
    
    return finalize(this);
  };

  PeasantCombat.prototype.seizeTurn = async function(combatantId, phase) {
      pcLog.debug(`Peasant Core | Seizing Turn: ${combatantId} Phase ${phase}`);
      const historyStartState = getCombatState(this);
      
      // 1. Save current state to stack
      const seizureStack = this.getFlag("peasant-core", "seizureStack") || [];
      seizureStack.push({
          round: this.round,
          turn: this.turn,
          phase: this.getFlag("peasant-core", "combatPhase") || 0,
          combatantId: this.combatant?.id
      });
      await this.setFlag("peasant-core", "seizureStack", seizureStack);
      
      // 2. Mark target as seized so they don't get it again
      const flagName = phase === 0 ? "seizedMovement" : "seizedStandard";
      const seizedList = this.getFlag("peasant-core", flagName) || [];
      if (!seizedList.includes(combatantId)) {
          seizedList.push(combatantId);
          await this.setFlag("peasant-core", flagName, seizedList);
      }
      
      // 3. Switch to target
      // Find turn index of combatant
      const targetIdx = this.turns.findIndex(c => c.id === combatantId);
      if (targetIdx === -1) return;
      
      await this.setFlag("peasant-core", "combatPhase", phase);
      await this.update({ turn: targetIdx });
      
      // 4. Log explicit transition for deterministic undo/backtrack.
      await addTurnTransition(this, "seizeTurn", historyStartState, {
        seizedCombatantId: combatantId,
        seizedPhase: phase
      });
      
      const phaseName = phase === 0 ? "Movement" : "Standard";
      const combatant = this.combatants.get(combatantId);
      ui.notifications.warn(`${combatant?.name} SEIZED THE TURN! (${phaseName})`);
  };

  // Override nextRound to save initiatives and reset them
  const originalNextRound = Combat.prototype.nextRound;
  PeasantCombat.prototype.nextRound = async function() {
    pcLog.debug("Peasant Core | Starting New Round");
    const historyStartState = getCombatState(this);
    
    // Save current initiatives for this round
    const currentRound = this.round;
    const currentInitiatives = {};
    const currentTiebreakers = {};
    
    this.combatants.forEach(c => {
      currentInitiatives[c.id] = c.initiative;
      currentTiebreakers[c.id] = c.getFlag("peasant-core", "initiativeTiebreaker");
    });
    
    const roundInitiatives = this.getFlag("peasant-core", "roundInitiatives") || {};
    const roundTiebreakers = this.getFlag("peasant-core", "roundTiebreakers") || {};
    
    roundInitiatives[currentRound] = currentInitiatives;
    roundTiebreakers[currentRound] = currentTiebreakers;
    
    await this.setFlag("peasant-core", "roundInitiatives", roundInitiatives);
    await this.setFlag("peasant-core", "roundTiebreakers", roundTiebreakers);
    
    // Advance round (this also resets turn to 0)
    await originalNextRound.call(this);
    
    // Check if next round already has history
    const nextRound = this.round;
    // Re-fetch flags to be absolutely sure we have latest data
    const updatedRoundInitiatives = this.getFlag("peasant-core", "roundInitiatives") || {};
    const existingNextRoundInits = updatedRoundInitiatives[nextRound];
    
    pcLog.debug(`Peasant Core | Advanced to Round ${nextRound}. History exists? ${!!existingNextRoundInits}`);
    
    if (existingNextRoundInits) {
        // Restore initiatives for the next round
        const updates = [];
        for (const [id, init] of Object.entries(existingNextRoundInits)) {
            updates.push({ _id: id, initiative: init });
        }
        
        // Restore tiebreakers
        const updatedTiebreakers = this.getFlag("peasant-core", "roundTiebreakers") || {};
        const existingTiebreakers = updatedTiebreakers[nextRound];
        if (existingTiebreakers) {
            for (const [id, val] of Object.entries(existingTiebreakers)) {
                const c = this.combatants.get(id);
                if (c) await c.setFlag("peasant-core", "initiativeTiebreaker", val);
            }
        }
        
        await this.updateEmbeddedDocuments("Combatant", updates);
        
        // Force a resort of turns now that flags and values are restored
        this.setupTurns();
        
        ui.notifications.info(`Round ${nextRound} Restored - Initiatives Loaded`);
    } else {
        // Brand new round - Reset initiatives
        const updates = this.combatants.map(c => ({ _id: c.id, initiative: null }));
        await this.updateEmbeddedDocuments("Combatant", updates);
        
        // Clear seized flags for the new round so nobody is skipped
        await this.setFlag("peasant-core", "seizedMovement", []);
        await this.setFlag("peasant-core", "seizedStandard", []);
        
        ui.notifications.info(`Round ${this.round} Started - Roll Initiative!`);
    }
    
    // Reset phase to movement
    await this.setFlag("peasant-core", "combatPhase", 0);
    
    // Ensure we start at the first turn (Lowest Initiative)
    await this.update({ turn: 0 });

    await addTurnTransition(this, "nextRound", historyStartState, {
      fromRound: historyStartState?.round ?? null,
      toRound: this.round
    });
    
    return this;
  };

  // Override previousRound to restore initiatives
  const originalPreviousRound = Combat.prototype.previousRound;
  PeasantCombat.prototype.previousRound = async function() {
    pcLog.debug("Peasant Core | Going to Previous Round");
    const historyStartState = getCombatState(this);
    
    // Save current initiatives for the round we are leaving (so we can return to it later)
    const currentRound = this.round;
    const currentInitiatives = {};
    const currentTiebreakers = {};
    
    let saveCount = 0;
    this.combatants.forEach(c => {
      currentInitiatives[c.id] = c.initiative;
      currentTiebreakers[c.id] = c.getFlag("peasant-core", "initiativeTiebreaker") || 0;
      if (c.initiative !== null) saveCount++;
    });
    
    pcLog.debug(`Peasant Core | Saving Round ${currentRound} History: ${saveCount} initiatives`);
    
    const roundInitiatives = this.getFlag("peasant-core", "roundInitiatives") || {};
    const roundTiebreakers = this.getFlag("peasant-core", "roundTiebreakers") || {};
    
    roundInitiatives[currentRound] = currentInitiatives;
    roundTiebreakers[currentRound] = currentTiebreakers;
    
    await this.setFlag("peasant-core", "roundInitiatives", roundInitiatives);
    await this.setFlag("peasant-core", "roundTiebreakers", roundTiebreakers);

    // Go back one round
    await originalPreviousRound.call(this);
    
    const newRound = this.round;
    const savedInitiatives = roundInitiatives[newRound];
    
    if (savedInitiatives) {
      // Restore initiatives
      const updates = [];
      for (const [id, init] of Object.entries(savedInitiatives)) {
        updates.push({ _id: id, initiative: init });
      }
      
      // Restore tiebreakers
      const savedTiebreakers = roundTiebreakers[newRound];
      if (savedTiebreakers) {
         for (const [id, val] of Object.entries(savedTiebreakers)) {
            const c = this.combatants.get(id);
            if (c) await c.setFlag("peasant-core", "initiativeTiebreaker", val);
         }
      }
      
      if (updates.length > 0) {
        await this.updateEmbeddedDocuments("Combatant", updates);
        
        // Force a resort of turns
        this.setupTurns();
        
        ui.notifications.info(`Round ${newRound} Restored - Initiatives Loaded`);
      }
    }
    
    // Reset phase to Standard (1) - End of restored round
    await this.setFlag("peasant-core", "combatPhase", 1);
    
    // Set turn to 0 (Lowest Initiative = Last turn in Standard Phase)
    await this.update({ turn: 0 });
    
    // Announce
    ui.notifications.info(`${this.combatant?.name || "Combatant"} - Standard Phase`);

    await addTurnTransition(this, "previousRound", historyStartState, {
      fromRound: historyStartState?.round ?? null,
      toRound: this.round
    });
    
    return this;
  };
  
  PeasantCombat.prototype.previousTurn = async function() {
    pcLog.debug("Peasant Core | Going to Previous Turn (History Undo)");
    
    // Get the history
    const turnHistoryRaw = this.getFlag("peasant-core", "turnHistory");
    const turnHistory = Array.isArray(turnHistoryRaw) ? [...turnHistoryRaw] : [];
    
    if (turnHistory.length === 0) {
        ui.notifications.warn("No further turn history to undo.");
        return this;
    }
    
    // Current combat context
    const currentCombatantId = this.combatant?.id;
    const currentPhase = this.getFlag("peasant-core", "combatPhase") || 0;
    const currentState = getCombatState(this);

    const applyLegacySeizureUndo = async () => {
      if (!currentCombatantId) return;
      const flagName = currentPhase === 0 ? "seizedMovement" : "seizedStandard";
      const seizedList = this.getFlag("peasant-core", flagName) || [];
      if (!seizedList.includes(currentCombatantId)) return;

      const newList = seizedList.filter(id => id !== currentCombatantId);
      await this.setFlag("peasant-core", flagName, newList);
      pcLog.debug(`Peasant Core | Undoing Seizure status for ${this.combatant?.name || currentCombatantId}`);

      const seizureStack = this.getFlag("peasant-core", "seizureStack") || [];
      if (seizureStack.length > 0) {
        seizureStack.pop();
        await this.setFlag("peasant-core", "seizureStack", seizureStack);
      }
    };

    // 2. Standard History Restore
    // Prefer transition entries (from->to), while still supporting legacy snapshot entries.
    let previousState = null;
    let consumedHistoryEntry = null;
    let consumedHistoryIndex = -1;
    for (let i = turnHistory.length - 1; i >= 0; i--) {
      const candidate = turnHistory[i];
      if (candidate?.type === "transition") {
        const action = String(candidate.action || "");
        if (!TURN_UNDO_ACTIONS.has(action)) {
          continue;
        }
      }
      const candidateState = getUndoStateFromHistoryEntry(candidate, currentState);
      if (!candidateState) continue;
      if (currentState && statesEqual(candidateState, currentState)) continue;

      previousState = candidateState;
      consumedHistoryEntry = candidate;
      consumedHistoryIndex = i;
      break;
    }

    if (!previousState) {
      ui.notifications.warn("No further turn history to undo.");
      return this;
    }

    // Match nextTurn behavior: do not cross round boundaries via previousTurn.
    if (Number(previousState.round) !== Number(this.round)) {
      ui.notifications.warn("Start of round. Use 'Previous Round' button to go back.");
      return this;
    }

    // Consume the chosen transition (and any future timeline after it).
    const nextHistory = consumedHistoryIndex >= 0
      ? turnHistory.slice(0, consumedHistoryIndex)
      : turnHistory;
    await this.setFlag("peasant-core", "turnHistory", nextHistory);

    // 3. Seizure cleanup tied to the consumed history entry
    if (consumedHistoryEntry?.type === "transition" && consumedHistoryEntry.action === "seizeTurn") {
      const seizedPhase = Number(consumedHistoryEntry?.meta?.seizedPhase);
      const phase = Number.isFinite(seizedPhase) ? seizedPhase : currentPhase;
      const seizedCombatantId = consumedHistoryEntry?.meta?.seizedCombatantId || currentCombatantId;
      if (seizedCombatantId) {
        const flagName = phase === 0 ? "seizedMovement" : "seizedStandard";
        const seizedList = this.getFlag("peasant-core", flagName) || [];
        if (seizedList.includes(seizedCombatantId)) {
          const newList = seizedList.filter(id => id !== seizedCombatantId);
          await this.setFlag("peasant-core", flagName, newList);
          pcLog.debug(`Peasant Core | Undoing Seizure status for ${seizedCombatantId}`);
        }
      }

      const seizureStack = this.getFlag("peasant-core", "seizureStack") || [];
      if (seizureStack.length > 0) {
        const expected = normalizeHistoryState(consumedHistoryEntry?.from);
        const top = seizureStack[seizureStack.length - 1];
        const topMatches = !!expected && !!top
          && Number(top.round) === Number(expected.round)
          && Number(top.turn) === Number(expected.turn)
          && Number(top.phase ?? 0) === Number(expected.phase ?? 0);
        if (topMatches) {
          seizureStack.pop();
          await this.setFlag("peasant-core", "seizureStack", seizureStack);
        }
      }
    } else if (!consumedHistoryEntry?.type) {
      // Legacy snapshot entries do not provide action context; keep old behavior as fallback.
      await applyLegacySeizureUndo();
    }

    if (consumedHistoryEntry?.type === "transition") {
      pcLog.debug(
        `Peasant Core | Undo Transition[${consumedHistoryEntry.seq ?? "?"}] `
        + `${consumedHistoryEntry.action || "unknown"}`
      );
    }
    
    // Check if we are crossing a round boundary backward
    if (previousState.round !== this.round) {
        // We are going back to a previous round.
        // SAVE the initiatives of the current round (the one we are leaving via undo) so they aren't lost
        const currentRound = this.round;
        const currentInitiatives = {};
        const currentTiebreakers = {};
        
        this.combatants.forEach(c => {
          currentInitiatives[c.id] = c.initiative;
          currentTiebreakers[c.id] = c.getFlag("peasant-core", "initiativeTiebreaker") || 0;
        });
        
        const roundInitiatives = this.getFlag("peasant-core", "roundInitiatives") || {};
        const roundTiebreakers = this.getFlag("peasant-core", "roundTiebreakers") || {};
        
        roundInitiatives[currentRound] = currentInitiatives;
        roundTiebreakers[currentRound] = currentTiebreakers;
        
        await this.setFlag("peasant-core", "roundInitiatives", roundInitiatives);
        await this.setFlag("peasant-core", "roundTiebreakers", roundTiebreakers);
        pcLog.debug(`Peasant Core | Saved Round ${currentRound} state before undoing to Round ${previousState.round}`);

        // Now revert to previous round logic (restore initiatives)
        pcLog.debug(`Peasant Core | Reverting to Round ${previousState.round} from History`);
        
        const savedInitiatives = roundInitiatives[previousState.round];
        if (savedInitiatives) {
             const updates = [];
             for (const [id, init] of Object.entries(savedInitiatives)) {
                updates.push({ _id: id, initiative: init });
             }
             const savedTiebreakers = roundTiebreakers[previousState.round];
             if (savedTiebreakers) {
                 for (const [id, val] of Object.entries(savedTiebreakers)) {
                    const c = this.combatants.get(id);
                    if (c) await c.setFlag("peasant-core", "initiativeTiebreaker", val);
                 }
             }
             if (updates.length > 0) {
                await this.updateEmbeddedDocuments("Combatant", updates);
                this.setupTurns(); // Force resort
             }
        }
    }
    
    // Restore the state (prefer combatantId over stored turn index for resilience)
    const targetTurn = resolveTurnIndex(this, previousState);
    await this.setFlag("peasant-core", "combatPhase", previousState.phase);
    await this.update({ round: previousState.round, turn: targetTurn });
    
    // Notify
    const phaseName = previousState.phase === 0 ? "Movement" : "Standard";
    const combatant = this.combatants.get(previousState.combatantId);
    const name = combatant ? combatant.name : "Combatant";
    ui.notifications.info(`${name} - ${phaseName} Phase (History Restored)`);
    
    return this;
  };
}


export function configurePeasantCombat() {
  CONFIG.Combat.documentClass = PeasantCombat;
  installPeasantCombatMethods();

  // Configure initiative - formula unused since PeasantCombat overrides rollInitiative.
  CONFIG.Combat.initiative = {
    formula: null,
    decimals: 0
  };
}

