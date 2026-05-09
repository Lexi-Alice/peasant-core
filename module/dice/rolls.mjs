// Helper roll functions for peasant-core - autoroll implementations
// No UI dialogs here; these return by posting chat messages directly.

import { registerPeasantCoreApi } from "../utils/api.mjs";
import { applyRollMode, escapeHtml } from "../utils/chat.mjs";
import { pcLog } from "../utils/logging.mjs";

export async function performConsciousnessCheck({
  tn = 7,
  asSave = false,
  skillName = 'Consciousness Check',
  speaker = ChatMessage.getSpeaker(),
  style = CONST.CHAT_MESSAGE_STYLES.OTHER
} = {}) {
  pcLog.debug('Peasant Core: performConsciousnessCheck called', { tn, asSave, skillName });

  let total = 0;
  let diceValues = "";
  let detailLines = "";

  if (asSave) {
    const roll = await new Roll('3d6').evaluate();
    const allDice = roll.dice[0].results.map(r => r.result);
    const minValue = Math.min(...allDice);
    const minIndex = allDice.indexOf(minValue);
    const keptDice = allDice.filter((_, index) => index !== minIndex);
    total = keptDice[0] + keptDice[1];
    const allDiceDisplay = allDice
      .map((die, index) => index === minIndex ? `<span style="color: #888;">${die}</span>` : die)
      .join(', ');
    detailLines = `<div>Dice: [${allDiceDisplay}] = ${total}</div>`;
  } else {
    const roll = await new Roll('2d6').evaluate();
    const initialDice = roll.dice[0].results.map(r => r.result);
    total = roll.total;
    diceValues = initialDice.join(', ');
    detailLines = `<div>Dice: [${diceValues}] = ${total}</div>`;
  }

  const isSuccess = total >= tn;
  const rollId = `consciousness-roll-${Date.now()}`;
  // Use the same structure as skill roll for consistent styling
  const difference = total - tn;
  const totalMoS = difference * 0.25; // kept for potential use, but not displayed
  const mosColor = isSuccess ? '#4ade80' : '#f87171';
  const outcomeBackground = isSuccess ? 'rgba(34, 197, 94, 0.2)' : 'rgba(220, 38, 38, 0.2)';
  const outcomeBorder = isSuccess ? '1px solid #22c55e' : '1px solid #dc2626';

  const content = `<div class="skill-roll-card" style="background: #1e1e1e; border: 1px solid #444; border-radius: 4px; padding: 10px; color: #e0e0e0; font-family: var(--font-body, 'Signika', 'Palatino Linotype', sans-serif);">
    <div style="font-size: 14px; font-weight: bold; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #555; color: #ffffff;">
      ${escapeHtml(skillName)}
    </div>
    <div style="display: flex; flex-direction: column; gap: 6px;">
      <div style="display: flex; gap: 6px;"></div>
      <div class="roll-details" data-roll-id="${rollId}" style="display: none; background-color: #1a1a1a; color: #e0e0e0; border-radius: 4px; padding: 6px; border: 1px solid #555; font-size: 10px; line-height: 1.5;">
        <div style="color: #4a9eff; font-weight: bold; margin-bottom: 2px;">Roll Details:</div>
        ${detailLines}
      </div>
      <div class="mos-toggle" data-roll-id="${rollId}" style="text-align: center; font-size: 12px; font-weight: bold; padding: 6px; border-radius: 3px; background: ${outcomeBackground}; color: ${mosColor}; border: ${outcomeBorder}; cursor: pointer;">
        ${isSuccess ? 'Success' : 'Failure'}
      </div>
    </div>
  </div>`;
  await ChatMessage.create(applyRollMode({ user: game.user.id, speaker, content, style }));
}

export async function performSkillRoll({ toHit = 7, accuracy = undefined, skillName = 'Skill Roll', speaker = ChatMessage.getSpeaker(), style = CONST.CHAT_MESSAGE_STYLES.OTHER } = {}) {
  pcLog.debug('Peasant Core: performSkillRoll called', { toHit, accuracy, skillName });
  const roll = await new Roll('2d6').evaluate();
  const initialDice = roll.dice[0].results.map(r => r.result);
  const diceValues = initialDice.join(', ');

  let isCritical = false;
  let criticalType = null;
  let additionalDice = [];
  let criticalMoS = 0;

  if (initialDice[0] === 6 && initialDice[1] === 6) {
    isCritical = true;
    criticalType = 'Critical Success';
    let keepRolling = true;
    while (keepRolling) {
      const extraRoll = await new Roll('1d6').evaluate();
      const extraValue = extraRoll.dice[0].results[0].result;
      additionalDice.push(extraValue);
      criticalMoS += extraValue * 0.25;
      if (extraValue !== 6) keepRolling = false;
    }
  } else if (initialDice[0] === 1 && initialDice[1] === 1) {
    isCritical = true;
    criticalType = 'Critical Failure';
    let keepRolling = true;
    while (keepRolling) {
      const extraRoll = await new Roll('1d6').evaluate();
      const extraValue = extraRoll.dice[0].results[0].result;
      additionalDice.push(extraValue);
      criticalMoS -= extraValue * 0.25;
      if (extraValue !== 6) keepRolling = false;
    }
  }

  let diceResult = initialDice[0] + initialDice[1];
  if (isCritical && additionalDice.length > 0) diceResult = initialDice[0] + initialDice[1] + additionalDice.reduce((s, v) => s + v, 0);

  const initialTotal = initialDice[0] + initialDice[1];
  const difference = initialTotal - toHit;
  const baseMoS = difference * 0.25;
  let accuracyNum = (accuracy === undefined || accuracy === null || accuracy === '') ? null : (typeof accuracy === 'number' ? accuracy : parseInt(accuracy));
  if (accuracyNum !== null && !Number.isFinite(accuracyNum)) accuracyNum = null;
  const accuracyMoS = (accuracyNum === null) ? 0 : accuracyNum * 0.25;
  const totalMoS = baseMoS + (accuracyNum === null ? 0 : accuracyMoS) + criticalMoS;

  const isSuccess = totalMoS >= 0;
  const baseIsSuccess = baseMoS >= 0;

  let specialResult = null;
  if (criticalType) specialResult = criticalType;
  else if (isSuccess && !baseIsSuccess) specialResult = 'Glancing Success';
  else if (!isSuccess && baseIsSuccess) specialResult = 'Narrow Success';

  const resultText = specialResult || (isSuccess ? 'Success' : 'Failure');
  const mosDisplay = Number(totalMoS.toFixed(2)).toString();

  const mosColor = isSuccess ? '#4ade80' : '#f87171';
  const mosBorder = isSuccess ? '2px solid #22c55e' : '2px solid #dc2626';
  const outcomeBackground = isSuccess ? 'rgba(34, 197, 94, 0.2)' : 'rgba(220, 38, 38, 0.2)';
  const outcomeBorder = isSuccess ? '1px solid #22c55e' : '1px solid #dc2626';

  const rollId = `skill-roll-${Date.now()}`;

  const chatContent = `<div class="skill-roll-card" style="background: #1e1e1e; border: 1px solid #444; border-radius: 4px; padding: 10px; color: #e0e0e0; font-family: var(--font-body, 'Signika', 'Palatino Linotype', sans-serif);">
    <div style="font-size: 14px; font-weight: bold; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #555; color: #ffffff;">
      ${escapeHtml(skillName)}
    </div>
    <div style="display: flex; flex-direction: column; gap: 6px;">
      <div style="display: flex; gap: 6px;">
        <div style="flex: 1; display: flex; justify-content: space-between; align-items: center; padding: 6px; background: #252525; border-radius: 3px; border-left: 3px solid #555;">
          <span style="color: #ffffff; font-weight: bold; font-size: 11px;">To-Hit:</span>
          <span style="color: #e0e0e0; font-size: 13px; font-weight: bold;">${toHit}+</span>
        </div>
        <div style="flex: 1; display: flex; justify-content: space-between; align-items: center; padding: 6px; background: #252525; border-radius: 3px; border-left: 3px solid #555;">
          <span style="color: #ffffff; font-weight: bold; font-size: 11px;">MoS:</span>
          <button class="mos-toggle" data-roll-id="${rollId}" style="cursor: pointer; padding: 4px 8px; background: #2a2a2a; border-radius: 3px; font-size: 14px; font-weight: bold; color: ${mosColor}; border: ${mosBorder};">
            ${mosDisplay}
          </button>
        </div>
      </div>
      <div class="roll-details" data-roll-id="${rollId}" style="display: none; background-color: #1a1a1a; color: #e0e0e0; border-radius: 4px; padding: 6px; border: 1px solid #555; font-size: 10px; line-height: 1.5;">
        <div style="color: #4a9eff; font-weight: bold; margin-bottom: 2px;">Roll Details:</div>
        <div>Dice: [${diceValues}] = ${initialTotal}</div>${isCritical ? `
        <div>Critical Dice: [${additionalDice.join(', ')}] = ${additionalDice.reduce((sum, val) => sum + val, 0)}</div>` : ''}
        <div>Base MoS: ${baseMoS >= 0 ? '+' : ''}${baseMoS.toFixed(2)}</div>
        ${accuracyNum !== null && Number.isFinite(accuracyNum) ? `<div>Accuracy: ${accuracyNum}</div>` : ''}
      </div>
      <div style="text-align: center; font-size: 12px; font-weight: bold; padding: 6px; border-radius: 3px; background: ${outcomeBackground}; color: ${mosColor}; border: ${outcomeBorder};">
        ${resultText}
      </div>
    </div>
  </div>`;

  const chatMessage = await ChatMessage.create(applyRollMode({ user: game.user.id, speaker, content: chatContent, style }));
  return {
    chatMessage,
    toHit,
    accuracy: accuracyNum,
    initialDice,
    additionalDice,
    initialTotal,
    total: diceResult,
    baseMoS,
    accuracyMoS,
    criticalMoS,
    totalMoS,
    isSuccess,
    resultText,
    criticalType
  };
}

export async function performUntrainedSkillRoll({ toHit = 7, accuracy = undefined, skillName = 'Untrained Skill Roll', speaker = ChatMessage.getSpeaker(), style = CONST.CHAT_MESSAGE_STYLES.OTHER } = {}) {
  pcLog.debug('Peasant Core: performUntrainedSkillRoll called', { toHit, accuracy, skillName });
  const roll = await new Roll('3d6').evaluate();
  const allDice = roll.dice[0].results.map(r => r.result);
  const maxValue = Math.max(...allDice);
  const maxIndex = allDice.indexOf(maxValue);
  const keptDice = allDice.filter((_, index) => index !== maxIndex);
  const diceResult = keptDice[0] + keptDice[1];
  const allDiceDisplay = allDice.map((die, index) => index === maxIndex ? `<span style="color: #888;">${die}</span>` : die).join(', ');

  let isCritical = false;
  let criticalType = null;
  let additionalDice = [];
  let criticalMoS = 0;
  if (keptDice[0] === 6 && keptDice[1] === 6) {
    isCritical = true; criticalType = 'Critical Success';
    let keepRolling = true;
    while (keepRolling) {
      const extraRoll = await new Roll('1d6').evaluate();
      const extraValue = extraRoll.dice[0].results[0].result;
      additionalDice.push(extraValue);
      criticalMoS += extraValue * 0.25;
      if (extraValue !== 6) keepRolling = false;
    }
  } else if (keptDice[0] === 1 && keptDice[1] === 1) {
    isCritical = true; criticalType = 'Critical Failure';
    let keepRolling = true;
    while (keepRolling) {
      const extraRoll = await new Roll('1d6').evaluate();
      const extraValue = extraRoll.dice[0].results[0].result;
      additionalDice.push(extraValue);
      criticalMoS -= extraValue * 0.25;
      if (extraValue !== 6) keepRolling = false;
    }
  }

  const initialTotal = keptDice[0] + keptDice[1];
  const difference = initialTotal - toHit;
  const baseMoS = difference * 0.25;
  let accuracyNum = (accuracy === undefined || accuracy === null || accuracy === '') ? null : (typeof accuracy === 'number' ? accuracy : parseInt(accuracy));
  if (accuracyNum !== null && !Number.isFinite(accuracyNum)) accuracyNum = null;
  const accuracyMoS = (accuracyNum === null) ? 0 : accuracyNum * 0.25;
  const totalMoS = baseMoS + (accuracyNum === null ? 0 : accuracyMoS) + criticalMoS;
  const isSuccess = totalMoS >= 0;
  const baseIsSuccess = baseMoS >= 0;
  let specialResult = null;
  if (criticalType) specialResult = criticalType;
  else if (isSuccess && baseMoS < 0) specialResult = 'Glancing Success';
  else if (!isSuccess && baseIsSuccess) specialResult = 'Narrow Success';
  const resultText = specialResult || (isSuccess ? 'Success' : 'Failure');
  const mosDisplay = Number(totalMoS.toFixed(2)).toString();

  const mosColor = isSuccess ? '#4ade80' : '#f87171';
  const mosBorder = isSuccess ? '2px solid #22c55e' : '2px solid #dc2626';
  const outcomeBackground = isSuccess ? 'rgba(34, 197, 94, 0.2)' : 'rgba(220, 38, 38, 0.2)';
  const outcomeBorder = isSuccess ? '1px solid #22c55e' : '1px solid #dc2626';

  const rollId = `untrained-roll-${Date.now()}`;
  const chatContent = `<div class="skill-roll-card" style="background: #1e1e1e; border: 1px solid #444; border-radius: 4px; padding: 10px; color: #e0e0e0; font-family: var(--font-body, 'Signika', 'Palatino Linotype', sans-serif);">
    <div style="font-size: 14px; font-weight: bold; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #555; color: #ffffff;">
      ${escapeHtml(skillName)}
    </div>
    <div style="display: flex; flex-direction: column; gap: 6px;">
      <div style="display: flex; gap: 6px;">
        <div style="flex: 1; display: flex; justify-content: space-between; align-items: center; padding: 6px; background: #252525; border-radius: 3px; border-left: 3px solid #555;">
          <span style="color: #ffffff; font-weight: bold; font-size: 11px;">To-Hit:</span>
          <span style="color: #e0e0e0; font-size: 13px; font-weight: bold;">${toHit}+</span>
        </div>
        <div style="flex: 1; display: flex; justify-content: space-between; align-items: center; padding: 6px; background: #252525; border-radius: 3px; border-left: 3px solid #555;">
          <span style="color: #ffffff; font-weight: bold; font-size: 11px;">MoS:</span>
          <button class="mos-toggle" data-roll-id="${rollId}" style="cursor: pointer; padding: 4px 8px; background: #2a2a2a; border-radius: 3px; font-size: 14px; font-weight: bold; color: ${mosColor}; border: ${mosBorder};">
            ${mosDisplay}
          </button>
        </div>
      </div>
      <div class="roll-details" data-roll-id="${rollId}" style="display: none; background-color: #1a1a1a; color: #e0e0e0; border-radius: 4px; padding: 6px; border: 1px solid #555; font-size: 10px; line-height: 1.5;">
        <div style="color: #4a9eff; font-weight: bold; margin-bottom: 2px;">Roll Details:</div>
        <div>Dice: [${allDiceDisplay}] = ${diceResult}</div>${isCritical ? `
        <div>Critical Dice: [${additionalDice.join(', ')}] = ${additionalDice.reduce((sum, val) => sum + val, 0)}</div>` : ''}
        <div>Base MoS: ${baseMoS >= 0 ? '+' : ''}${baseMoS.toFixed(2)}</div>
        ${accuracyNum !== null && Number.isFinite(accuracyNum) && accuracyNum !== 0 ? `<div>Accuracy: ${accuracyNum}</div>` : ''}
      </div>
      <div style="text-align: center; font-size: 12px; font-weight: bold; padding: 6px; border-radius: 3px; background: ${outcomeBackground}; color: ${mosColor}; border: ${outcomeBorder};">
        ${resultText}
      </div>
    </div>
  </div>`;

  const chatMessage = await ChatMessage.create(applyRollMode({ user: game.user.id, speaker, content: chatContent, style }));
  return {
    chatMessage,
    toHit,
    accuracy: accuracyNum,
    allDice,
    keptDice,
    additionalDice,
    initialTotal,
    total: diceResult,
    baseMoS,
    accuracyMoS,
    criticalMoS,
    totalMoS,
    isSuccess,
    resultText,
    criticalType
  };
}

export async function performSavingRoll({ toHit = 7, skillName = 'Saving Roll', speaker = ChatMessage.getSpeaker(), style = CONST.CHAT_MESSAGE_STYLES.OTHER } = {}) {
  pcLog.debug('Peasant Core: performSavingRoll called', { toHit, skillName });
  const roll = await new Roll('3d6').evaluate();
  const allDice = roll.dice[0].results.map(r => r.result);
  const minValue = Math.min(...allDice);
  const minIndex = allDice.indexOf(minValue);
  const keptDice = allDice.filter((_, index) => index !== minIndex);
  const diceResult = keptDice[0] + keptDice[1];

  const difference = diceResult - toHit;
  const totalMoS = difference * 0.25;
  const isSuccess = totalMoS >= 0;
  const mosDisplay = Number(totalMoS.toFixed(2)).toString();

  const mosColor = isSuccess ? '#4ade80' : '#f87171';
  const mosBorder = isSuccess ? '2px solid #22c55e' : '2px solid #dc2626';
  const outcomeBackground = isSuccess ? 'rgba(34, 197, 94, 0.2)' : 'rgba(220, 38, 38, 0.2)';
  const outcomeBorder = isSuccess ? '1px solid #22c55e' : '1px solid #dc2626';

  const rollId = `saving-roll-${Date.now()}`;
  const allDiceDisplay = allDice.map((die, index) => index === minIndex ? `<span style="color: #888;">${die}</span>` : die).join(', ');

  const chatContent = `<div class="skill-roll-card" style="background: #1e1e1e; border: 1px solid #444; border-radius: 4px; padding: 10px; color: #e0e0e0; font-family: var(--font-body, 'Signika', 'Palatino Linotype', sans-serif);">
    <div style="font-size: 14px; font-weight: bold; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #555; color: #ffffff;">
      ${escapeHtml(skillName)}
    </div>
    <div style="display: flex; flex-direction: column; gap: 6px;">
      <div style="display: flex; gap: 6px;">
        <div style="flex: 1; display: flex; justify-content: space-between; align-items: center; padding: 6px; background: #252525; border-radius: 3px; border-left: 3px solid #555;">
          <span style="color: #ffffff; font-weight: bold; font-size: 11px;">To-Hit:</span>
          <span style="color: #e0e0e0; font-size: 13px; font-weight: bold;">${toHit}+</span>
        </div>
        <div style="flex: 1; display: flex; justify-content: space-between; align-items: center; padding: 6px; background: #252525; border-radius: 3px; border-left: 3px solid #555;">
          <span style="color: #ffffff; font-weight: bold; font-size: 11px;">MoS:</span>
          <button class="mos-toggle" data-roll-id="${rollId}" style="cursor: pointer; padding: 4px 8px; background: #2a2a2a; border-radius: 3px; font-size: 14px; font-weight: bold; color: ${mosColor}; border: ${mosBorder};">
            ${mosDisplay}
          </button>
        </div>
      </div>
      <div class="roll-details" data-roll-id="${rollId}" style="display: none; background-color: #1a1a1a; color: #e0e0e0; border-radius: 4px; padding: 6px; border: 1px solid #555; font-size: 10px; line-height: 1.5;">
        <div style="color: #4a9eff; font-weight: bold; margin-bottom: 2px;">Roll Details:</div>
        <div>Dice: [${allDiceDisplay}] = ${diceResult}</div>
        <div>MoS: ${totalMoS >= 0 ? '+' : ''}${totalMoS.toFixed(2)}</div>
      </div>
      <div style="text-align: center; font-size: 12px; font-weight: bold; padding: 6px; border-radius: 3px; background: ${outcomeBackground}; color: ${mosColor}; border: ${outcomeBorder};">
        ${isSuccess ? 'Success' : 'Failure'}
      </div>
    </div>
  </div>`;

  const chatMessage = await ChatMessage.create(applyRollMode({ user: game.user.id, speaker, content: chatContent, style }));
  return {
    chatMessage,
    toHit,
    allDice,
    keptDice,
    total: diceResult,
    totalMoS,
    isSuccess
  };
}

registerPeasantCoreApi({
  performConsciousnessCheck,
  performSkillRoll,
  performUntrainedSkillRoll,
  performSavingRoll
});

