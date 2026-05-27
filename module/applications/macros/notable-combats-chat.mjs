import { renderDialogV2 } from "../dialogs.mjs";
import { applyDieRate, hasCombatDice } from "../../dice/combat-dice.mjs";
import {
  hasRangeRateValue,
  normalizeRangeRateValue
} from "../../data/actor/combat-tags.mjs";
import { hasOptionalInteger, parseOptionalInteger } from "../../data/actor/helpers.mjs";
import { applyToHitAccuracy } from "../../dice/roll-targets.mjs";
import { performSkillRoll, performUntrainedSkillRoll } from "../../dice/rolls.mjs";
import { applyMessageMode, escapeHtml } from "../../utils/chat.mjs";
import { pcLog } from "../../utils/logging.mjs";

export async function renderNotableCombatsChat() {
  const TextEditorImplementation = foundry.applications.ux.TextEditor.implementation;

  const actor = canvas?.tokens?.controlled?.[0]?.actor ?? game.user?.character;
  if (!actor) {
    ui.notifications?.warn?.('Select a token or assign a character first.');
    return;
  }

  function getRollFns() {
    return { performSkillRoll, performUntrainedSkillRoll };
  }

  const data = await actor.sheet.getData();
  const combats = data?.notableCombats || [];
  if (!combats.length) {
    ui.notifications?.info?.('No notable combats to display.');
    return;
  }

  const renderTag = (tag, combatIndex, tagIdx) => {
    const label = escapeHtml(tag.label ?? '');
    const value = escapeHtml(tag.value ?? '');

    if (tag.isUses) {
      return `<span class="combat-uses-display combat-tag-uses-display">
        <span class="uses-label">${label}</span>
        <span class="combat-uses-box">
          <input type="number" class="combat-uses-current combat-tag-uses-current pc-input-plain" data-index="${combatIndex}" value="${tag.current}" readonly tabindex="-1" data-dtype="Number" inputmode="numeric" pattern="[+=\\-]?\\d*">
          <span class="uses-separator">/ ${tag.max}</span>
        </span>
      </span>`;
    }
    if (tag.isSections) {
      return `<span class="combat-tag combat-tag-compact combat-tag-sections">
        ${label}:
        <input type="number" class="combat-tag-sections-current pc-input-plain" data-index="${combatIndex}" value="${tag.current}" readonly tabindex="-1" data-dtype="Number" inputmode="numeric" pattern="[+=\\-]?\\d*">
        <span>/ ${tag.max}</span>
      </span>`;
    }
    if (tag.isSplitSecond) {
      return `<span class="combat-tag combat-tag-compact combat-tag-speed">
        ${value}:
        <input type="number" class="combat-tag-splitsecond-current pc-input-plain" data-index="${combatIndex}" value="${tag.splitSecondCurrent}" readonly tabindex="-1" data-dtype="Number" inputmode="numeric" pattern="[+=\\-]?\\d*">
        <span>/ ${tag.splitSecondMax}</span>
      </span>`;
    }
    if (tag.rollable) {
      return `<button type="button" class="combat-tag combat-tag-compact combat-tag-button combat-tag-rollable" data-combat-index="${combatIndex}" data-roll-type="${escapeHtml(tag.type)}" data-tag-type="${escapeHtml(tag.type)}" data-tag-index="${tagIdx}" title="Click to roll ${label}">${label}: ${value}</button>`;
    }
    if (value) {
      return `<span class="combat-tag combat-tag-compact">${label ? `${label}: ` : ''}${value}</span>`;
    }
    return `<span class="combat-tag combat-tag-compact">${label}</span>`;
  };

  const itemsHtml = combats.map((combat, index) => {
    if (!combat.isDisplayable) return '';

    const indent = (Number(combat.indent) || 0) * 20;
    const isStandard = !!combat.isStandard;
    const classRank = isStandard ? escapeHtml(combat.classRankDisplay ?? '') : escapeHtml(combat.type ?? '');
    const sigLabel = (combat.sig && isStandard) ? '<span class="combat-sig-label">SIG</span>' : '';

    const nameSuffix = (combat.hasToHit || combat.hasAccuracy) ? ':' : '';
    const nameText = escapeHtml(combat.name ?? '');

    const nameHtml = combat.hasDescription
      ? `<span class="combat-name-wrapper" data-index="${index}" tabindex="0">
          <span class="combat-name-view combat-has-desc" data-index="${index}">${nameText}${nameSuffix}</span>
          <div class="combat-description-tooltip">
            <div class="skill-tooltip-header">${nameText}</div>
            <div class="skill-tooltip-content">${combat.description ?? ''}</div>
          </div>
        </span>`
      : `<span class="combat-name-view">${nameText}${nameSuffix}</span>`;

    let rollText = '';
    if (combat.allowToHitAcc) {
      if (combat.hasToHit) rollText += `${combat.modifiedTohit}+`;
      if (combat.hasAccuracy) rollText += ` ${combat.accuracySign}${combat.accuracyNum} Acc`;
    }
    const rollHtml = rollText.trim()
      ? `<span class="combat-roll-clickable" data-index="${index}" tabindex="0" title="Roll ${nameText}">${rollText.trim()}</span>`
      : '';

    const usesHtml = combat.sig ? `
      <span class="combat-uses-display">
        <span class="uses-label">Uses</span>
        <span class="combat-uses-box">
          <input type="number" class="combat-uses-current pc-input-plain" data-index="${index}" value="${combat.usesCurrent}" readonly tabindex="-1" data-dtype="Number" inputmode="numeric" pattern="[+=\\-]?\\d*">
          <span class="uses-separator">/ ${combat.usesMax}</span>
        </span>
      </span>` : '';

    const tags = Array.isArray(combat.activeTags) ? combat.activeTags : [];
    const tagsHtml = (combat.hasTags && tags.length)
      ? `<span class="combat-tags-inline" data-combat-index="${index}">
          ${tags.map((tag, tagIdx) => renderTag(tag, index, tagIdx)).join(' ')}
        </span>`
      : '';

    return `<li class="combat-view-item" style="margin-left: ${indent}px; margin-bottom: 4px; color: #e0e0e0;">
      <div class="combat-view-line">
        <span class="combat-class-rank">${classRank}:</span>${sigLabel}
        ${nameHtml}
        ${rollHtml}
        ${usesHtml}
        ${tagsHtml}
      </div>
    </li>`;
  }).filter(Boolean).join('');

  const content = `<div class="pc-notable-combats-chat notable-combats-list-view" style="padding: 10px; border-radius: 4px;">
    <ul style="padding-left: 20px; margin: 0; list-style-type: disc;">
      ${itemsHtml}
    </ul>
  </div>`;

  const msg = await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content
  });

  Hooks.once('renderChatMessageHTML', (message, html) => {
    if (message.id !== msg.id) return;

    const getActor = () => game.actors?.get(actor.id) ?? actor;
    const $html = html instanceof HTMLElement ? $(html) : $(html?.[0] ?? html);
    if (!$html.length) return;

    $html.on('click', '.combat-name-view.combat-has-desc', async (ev) => {
      try {
        ev.preventDefault();
        ev.stopPropagation();
        const $el = $(ev.currentTarget);
        const idx = Number($el.data('index'));
        if (Number.isNaN(idx)) return;

        const actorNow = getActor();
        const combat = actorNow.system.notableCombats?.[idx] || {};
        const description = combat.description || '';
        const combatName = combat.name || 'Combat';

        const descriptionText = description.replace(/<[^>]*>/g, '').trim();
        if (!descriptionText) return;

        const enriched = await TextEditorImplementation.enrichHTML(description, { async: true });

        renderDialogV2({
          title: `${combatName} - Description`,
          content: `<div style="padding:10px;min-height:100px;color:#e0e0e0;">${enriched}</div>`,
          buttons: {},
          default: null
        }, { classes: ["peasant-macro-dialog", "peasant-macro-dialog-force"] });
      } catch (e) {
        pcLog.debug('combat-name-view click failed', e);
      }
    });

    $html.on('click', '.combat-roll-clickable', async (ev) => {
      try {
        ev.preventDefault();
        const $el = $(ev.currentTarget);
        const idx = Number($el.data('index'));
        if (Number.isNaN(idx)) return;

        const actorNow = getActor();
        const startNotableCombatRoll = game.peasantCore?.startNotableCombatRoll;
        if (typeof startNotableCombatRoll === 'function') {
          await startNotableCombatRoll({
            actor: actorNow,
            combatIndex: idx,
            promptForTargets: true
          });
          return;
        }

        const combatsRaw = actorNow.system.notableCombats || [];
        const combat = combatsRaw[idx] || {};

        const combatMods = actorNow.system.combatMods || { toHit: 0, accuracy: 0 };
        const toHitMod = parseInt(combatMods.toHit) || 0;
        const accuracyMod = parseInt(combatMods.accuracy) || 0;

        const combatTohit = parseOptionalInteger(combat.tohit, { min: 1 });
        const combatAccuracy = parseOptionalInteger(combat.accuracy, { allowSign: true });
        const baseTohit = hasOptionalInteger(combatTohit) ? combatTohit : 7;
        const baseAccuracy = combatAccuracy ?? 0;
        const accuracyHasValue = hasOptionalInteger(combatAccuracy);

        const rankStr = String(combat.rank ?? '').trim().toLowerCase();
        const isUntrained = (rankStr === 'u');
        const hasRangeRate = hasRangeRateValue(combat.rangeRate);

        const rollFns = await getRollFns();

        const executeCombatRoll = async (toHitAdj = 0, accuracyAdj = 0) => {
          const calc = applyToHitAccuracy(baseTohit, baseAccuracy, toHitMod + toHitAdj, accuracyMod + accuracyAdj, 2);
          const finalTohit = calc.toHit;
          const finalAccuracy = calc.accuracy;
          const accVal = (!accuracyHasValue && finalAccuracy === 0) ? undefined : finalAccuracy;

          const speaker = ChatMessage.getSpeaker({ actor: actorNow });
          const combatName = combat.name || 'Combat';

          if (isUntrained && rollFns.performUntrainedSkillRoll) {
            await rollFns.performUntrainedSkillRoll({ toHit: finalTohit, accuracy: finalAccuracy, skillName: `${combatName} Untrained Roll`, speaker });
            return;
          }
          if (rollFns.performSkillRoll) {
            await rollFns.performSkillRoll({ toHit: finalTohit, accuracy: accVal, skillName: `${combatName} Roll`, speaker });
            return;
          }

          const roll = await new Roll('2d6').evaluate();
          const content = `<strong>${escapeHtml(combatName)}</strong>: Rolled <strong>${roll.total}</strong> vs TN <strong>${finalTohit}+</strong>`;
          await ChatMessage.create(applyMessageMode({ user: game.user.id, speaker, content }));
        };

        if (hasRangeRate) {
          const rrValues = normalizeRangeRateValue(combat.rangeRate);
          const ords = ['1st', '2nd', '3rd', '4th'];
          const optionsHtml = rrValues.map((val, i) => {
            const displayVal = escapeHtml(val === null ? '-' : String(val));
            return `<option value="${i}">${ords[i]}: ${displayVal}</option>`;
          }).join('');

          const dialogContent = `
            <form>
              <div class="form-group" style="margin-bottom: 10px;">
                <label style="display: block; margin-bottom: 5px; color: #b0b0b0;">Range-Rate?</label>
                <select class="pc-defense-prompt-select pc-select pc-dialog-field-full" name="rangeRateIndex">
                  ${optionsHtml}
                </select>
              </div>
            </form>
          `;

          renderDialogV2({
            title: 'Range-Rate',
            content: dialogContent,
            buttons: {
              roll: {
                icon: '<i class="fas fa-dice"></i>',
                label: 'Roll',
                callback: async (html) => {
                  const idx = parseInt(html.find('[name="rangeRateIndex"]').val()) || 0;
                  const toHitAdj = idx;
                  const accAdj = -idx;
                  await executeCombatRoll(toHitAdj, accAdj);
                }
              },
              cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' }
            },
            default: 'roll'
          }, { classes: ["peasant-macro-dialog", "peasant-macro-dialog-force"] });
          return;
        }

        await executeCombatRoll(0, 0);
      } catch (e) {
        pcLog.debug('combat-roll-clickable handler failed', e);
      }
    });

    const rollableElements = $html.find('.combat-tag-rollable');
    rollableElements.off('mouseup.rollable click.rollable').on('mouseup.rollable', async (ev) => {
      if (ev.which !== 1) return;

      try {
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation();

        const $el = $(ev.currentTarget);
        let idx = parseInt($el.data('combatIndex')) || parseInt($el.data('combat-index')) || parseInt($el.attr('data-combat-index'));
        if (Number.isNaN(idx)) {
          const container = $el.closest('.combat-tags-inline');
          idx = parseInt(container.data('combatIndex')) || parseInt(container.attr('data-combat-index'));
        }
        if (Number.isNaN(idx)) idx = parseInt($el.data('index'));

        const rollType = $el.data('rollType') || $el.attr('data-roll-type');
        if (Number.isNaN(idx) || !rollType) return;

        const actorNow = getActor();
        const combatsRaw = actorNow.system.notableCombats || [];
        const combat = combatsRaw[idx] || {};
        const combatName = combat.name || 'Combat';

        if (rollType === 'heal' && hasCombatDice(combat.heal)) {
          const startNotableCombatRoll = game.peasantCore?.startNotableCombatRoll;
          if (typeof startNotableCombatRoll === 'function') {
            await startNotableCombatRoll({
              actor: actorNow,
              combatIndex: idx,
              promptForTargets: true,
              rollMode: 'heal'
            });
            return;
          }
        }

        const combatMods = actorNow.system.combatMods || { diceRate: 0, flatDamage: 0 };
        const diceRateMod = parseInt(combatMods.diceRate) || 0;
        const flatDamageMod = parseInt(combatMods.flatDamage) || 0;

        let diceCount = 0;
        let diceValue = 0;
        let flat = 0;
        let rollLabel = '';
        let typeLabel = '';

        if (rollType === 'damage' && combat.damage) {
          const result = applyDieRate(combat.damage.diceCount || 0, combat.damage.diceValue || 0, combat.damage.flat || 0, diceRateMod, combat.damage.diceBonus || 0);
          diceCount = result.diceCount;
          diceValue = result.diceValue;
          flat = result.flat + flatDamageMod;
          rollLabel = 'Damage';
          typeLabel = combat.damage.type || '';
        } else if (rollType === 'heal' && combat.heal) {
          const result = applyDieRate(combat.heal.diceCount || 0, combat.heal.diceValue || 0, combat.heal.flat || 0, diceRateMod, combat.heal.diceBonus || 0);
          diceCount = result.diceCount;
          diceValue = result.diceValue;
          flat = result.flat + flatDamageMod;
          rollLabel = 'Heal';
          typeLabel = combat.heal.type || '';
        } else if (rollType === 'manifest' && combat.manifest) {
          const result = applyDieRate(combat.manifest.diceCount || 0, combat.manifest.diceValue || 0, combat.manifest.flat || 0, diceRateMod, combat.manifest.diceBonus || 0);
          diceCount = result.diceCount;
          diceValue = result.diceValue;
          flat = result.flat + flatDamageMod;
          rollLabel = 'Manifest';
          typeLabel = '';
        }

        const canRollDice = diceCount > 0 && diceValue > 0;
        let formula = canRollDice ? `${diceCount}d${diceValue}` : "0";
        if (flat !== 0) formula = canRollDice ? `${formula}${flat > 0 ? '+' : ''}${flat}` : `${flat}`;

        const roll = await new Roll(formula).evaluate();
        const total = roll.total;

        const diceResults = canRollDice ? roll.dice.map(d => d.results.map(r => r.result)) : [];
        const allDice = diceResults.flat();
        const diceBreakdown = allDice.join(', ');
        const diceSum = allDice.reduce((a, b) => a + b, 0);

        const speaker = ChatMessage.getSpeaker({ actor: actorNow });
        const rollTitle = `${combatName}`;
        const typeDisplay = typeLabel ? `<span style="color: #aaa; font-size: 11px; margin-left: 6px;">${escapeHtml(typeLabel)}</span>` : '';
        const rollId = `dice-roll-${Date.now()}`;
        const rollCardClass = rollType === 'damage' ? ' pc-damage-roll-card' : (rollType === 'heal' ? ' pc-heal-roll-card' : (rollType === 'manifest' ? ' pc-manifest-roll-card' : ''));

        const chatHtml = `<fieldset class="skill-roll-card${rollCardClass}" style="background: transparent; border: 1px solid #444; border-radius: 4px; padding: 10px; color: #e0e0e0; font-family: var(--font-body, 'Signika', 'Palatino Linotype', sans-serif);">
  <legend>
    ${escapeHtml(rollTitle)}
  </legend>
  <div style="display: flex; flex-direction: column; gap: 6px;">
    <div style="display: flex; gap: 6px;">
      <div style="flex: 1; display: flex; justify-content: space-between; align-items: center; padding: 6px; background: transparent; border-radius: 3px; border-left: 3px solid #555;">
        <span style="color: #ffffff; font-weight: bold; font-size: 11px;">${rollLabel}:</span>
        <div style="display: flex; align-items: center; gap: 6px;">
          <button class="mos-toggle" data-roll-id="${rollId}" style="cursor: pointer; padding: 4px 8px; background: #2a2a2a; border-radius: 3px; font-size: 14px; font-weight: bold; color: #4ade80; border: 2px solid #22c55e;">
            ${total}
          </button>${typeDisplay}
        </div>
      </div>
    </div>
    <div class="roll-details" data-roll-id="${rollId}" style="display: none; background-color: transparent; color: #e0e0e0; border-radius: 4px; padding: 6px; border: 1px solid #555; font-size: 10px; line-height: 1.5;">
      <div style="color: #4a9eff; font-weight: bold; margin-bottom: 2px;">Roll Details:</div>
      <div>Dice: [${diceBreakdown}] = ${diceSum}</div>${flat !== 0 ? `
      <div>Flat Modifier: ${flat > 0 ? '+' : ''}${flat}</div>` : ''}
    </div>
  </div>
</fieldset>`;

        await ChatMessage.create(applyMessageMode({
          user: game.user.id,
          speaker,
          content: chatHtml,
          rolls: [roll]
        }));
      } catch (e) {
        console.error('combat-tag-rollable handler failed', e);
      }
    });
  });
}


