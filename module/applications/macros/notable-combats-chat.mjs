import { renderDialogV2 } from "../dialogs.mjs";
import { hasCombatDice } from "../../dice/combat-dice.mjs";
import {
  hasRangeRateValue,
  normalizeRangeRateValue
} from "../../data/actor/combat-tags.mjs";
import { hasOptionalInteger, parseOptionalInteger } from "../../data/actor/helpers.mjs";
import { getEffectiveSkillCombatModifiers } from "../../data/actor/combat-modifiers.mjs";
import { getNotableCombatImage } from "../../data/actor/notable-combat-image.mjs";
import { applyToHitAccuracy } from "../../dice/roll-targets.mjs";
import { performSkillRoll, performUntrainedSkillRoll } from "../../dice/rolls.mjs";
import { applyMessageMode, escapeHtml } from "../../utils/chat.mjs";
import { pcLog } from "../../utils/logging.mjs";
import { rollManualCombatTag } from "../combat/manual-combat-tag-rolls.mjs";

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
      return `<button type="button" class="combat-tag combat-tag-compact combat-tag-button combat-tag-rollable" data-combat-index="${combatIndex}" data-roll-type="${escapeHtml(tag.type)}" data-tag-type="${escapeHtml(tag.type)}" data-tag-index="${tagIdx}" data-tooltip="Click to roll ${label}" aria-label="Click to roll ${label}">${label}: ${value}</button>`;
    }
    if (value) {
      return `<span class="combat-tag combat-tag-compact">${label ? `${label}: ` : ''}${value}</span>`;
    }
    return `<span class="combat-tag combat-tag-compact">${label}</span>`;
  };

  const itemsHtml = combats.map((combat, index) => {
    if (!combat.isDisplayable) return '';

    const indent = (Number(combat.indent) || 0) * 20;
    const isSkillType = !!combat.isSkillType;
    const classRank = isSkillType ? escapeHtml(combat.classRankDisplay ?? '') : escapeHtml(combat.type ?? '');
    const sigLabel = (combat.isSignature && isSkillType) ? '<span class="combat-sig-label">SIG</span>' : '';

    const nameSuffix = (combat.hasToHit || combat.hasAccuracy) ? ':' : '';
    const nameText = escapeHtml(combat.name ?? '');
    const descriptionTooltipHtml = escapeHtml(combat.descriptionTooltipHtml ?? '');

    const nameHtml = combat.hasDescription
      ? `<span class="combat-name-wrapper" data-index="${index}" tabindex="0" data-tooltip-html="${descriptionTooltipHtml}">
          <span class="combat-name-view combat-has-desc" data-index="${index}">${nameText}${nameSuffix}</span>
        </span>`
      : `<span class="combat-name-view">${nameText}${nameSuffix}</span>`;

    let rollText = '';
    if (combat.allowToHitAcc) {
      if (combat.hasToHit) rollText += `${combat.modifiedTohit}+`;
      if (combat.hasAccuracy) rollText += ` ${combat.accuracySign}${combat.accuracyNum} Acc`;
    }
    const rollHtml = rollText.trim()
      ? `<span class="combat-roll-clickable" data-index="${index}" tabindex="0" data-tooltip="Roll ${nameText}" aria-label="Roll ${nameText}">${rollText.trim()}</span>`
      : '';

    const usesHtml = combat.isSignature ? `
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

        const combatMods = getEffectiveSkillCombatModifiers(actorNow);
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
          const imageSrc = getNotableCombatImage(combat);

          if (isUntrained && rollFns.performUntrainedSkillRoll) {
            await rollFns.performUntrainedSkillRoll({ toHit: finalTohit, accuracy: finalAccuracy, skillName: `${combatName} Untrained Roll`, speaker, imageSrc });
            return;
          }
          if (rollFns.performSkillRoll) {
            await rollFns.performSkillRoll({ toHit: finalTohit, accuracy: accVal, skillName: `${combatName} Roll`, speaker, imageSrc });
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
              }
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

        await rollManualCombatTag({
          actor: actorNow,
          combatIndex: idx,
          rollType
        });
      } catch (e) {
        console.error('combat-tag-rollable handler failed', e);
      }
    });
  });
}


