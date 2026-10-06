import { migrateLegacyManifestSpellEffectSystemData } from "./spell-effect-change-keys.mjs";
import { migrateHeraldryEffectChanges } from "../actor/identity-options.mjs";
import { hasExpiringSkillEffectDuration, isPassiveSkillEffectDefinition, isSkillEditorDefinition } from "../actor/skill-entry-conditions.mjs";

export class PeasantActiveEffect extends ActiveEffect {
  static migrateData(source, options) {
    const data = super.migrateData(source, options);
    if (!Array.isArray(data.system?.changes)) return data;
    data.system.changes = migrateHeraldryEffectChanges(data.system.changes);
    return data;
  }

  async _preUpdate(changed, options, user) {
    if (changed?.disabled === false && isSkillEditorDefinition(this)
      && !isPassiveSkillEffectDefinition(this)) return false;
    if (isPassiveSkillEffectDefinition(this)
      && (changed?.duration || Object.keys(changed ?? {}).some(key => key.startsWith("duration.")))) {
      const duration = { ...(this._source?.duration ?? this.duration), ...changed.duration };
      for (const key of ["value", "expiry", "expired"]) {
        if (Object.hasOwn(changed, `duration.${key}`)) duration[key] = changed[`duration.${key}`];
      }
      if (hasExpiringSkillEffectDuration(duration)) {
        globalThis.ui?.notifications?.warn?.("Passive effects cannot have a duration.");
        return false;
      }
    }
    return super._preUpdate(changed, options, user);
  }

  async deleteDialog(options = {}, operation = {}) {
    const type = game.i18n.localize(this.constructor.metadata.label);
    const question = game.i18n.localize("COMMON.AreYouSure");
    const warning = game.i18n.format("SIDEBAR.DeleteWarning", { type });
    const { ok = {}, window = {}, ...dialogOptions } = options;
    return foundry.applications.api.DialogV2.prompt({
      ...dialogOptions,
      content: options.content || `<p><strong>${question}</strong> ${warning}</p>`,
      ok: {
        ...ok,
        label: "SIDEBAR.Delete",
        icon: "fa-solid fa-trash",
        callback: () => this.delete(operation)
      },
      window: {
        icon: "fa-solid fa-trash",
        title: `${game.i18n.format("DOCUMENT.Delete", { type })}: ${this.name}`,
        ...window
      }
    });
  }

  _prepareCombatBasedDuration(duration, context) {
    const value = Number(duration?.value);
    const units = String(duration?.units || "");
    if (
      !(this.parent instanceof Actor)
      || this._source?.start?.combat
      || this.start?.combat
      || duration?.expired
      || !Number.isFinite(value)
      || value <= 0
      || !["rounds", "turns"].includes(units)
    ) {
      return super._prepareCombatBasedDuration(duration, context);
    }

    const unitsSingular = units.replace(/s$/, "");
    const timeConversion = CONFIG.time[`${unitsSingular}Time`] || 0;
    const seconds = timeConversion ? Math.trunc(value * timeConversion) : null;
    const pluralRule = game.i18n.pluralRules.select(Math.abs(value));
    const label = game.i18n.format(`EFFECT.DURATION.${units.toUpperCase()}.${pluralRule}`, {
      [units]: Math.abs(value)
    });
    Object.assign(duration, { seconds, remaining: value, label });
    if (timeConversion) duration.secondsRemaining = value * timeConversion;
    else delete duration.secondsRemaining;
    return duration;
  }
}

export class PeasantEnchantmentActiveEffectModel extends foundry.data.ActiveEffectTypeDataModel {}
export class PeasantSkillActiveEffectModel extends foundry.data.ActiveEffectTypeDataModel {}
export class PeasantSpellActiveEffectModel extends foundry.data.ActiveEffectTypeDataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      ...super.defineSchema(),
      encounterId: new fields.StringField({ initial: "" })
    };
  }

  static migrateData(source, options) {
    // Convert legacy fields before the strict v14 type schema discards them.
    migrateLegacyManifestSpellEffectSystemData(source);
    return super.migrateData(source, options);
  }
}

export const PEASANT_ACTIVE_EFFECT_DATA_MODELS = Object.freeze({
  enchantment: PeasantEnchantmentActiveEffectModel,
  skill: PeasantSkillActiveEffectModel,
  spellEffect: PeasantSpellActiveEffectModel
});

export function configurePeasantActiveEffects() {
  CONFIG.ActiveEffect.documentClass = PeasantActiveEffect;
  Object.assign(CONFIG.ActiveEffect.dataModels, PEASANT_ACTIVE_EFFECT_DATA_MODELS);
  CONFIG.ActiveEffect.typeLabels = {
    ...CONFIG.ActiveEffect.typeLabels,
    enchantment: "TYPES.ActiveEffect.enchantment",
    skill: "TYPES.ActiveEffect.skill",
    spellEffect: "TYPES.ActiveEffect.spellEffect"
  };
  CONFIG.ActiveEffect.expiryAction = "delete";
}
