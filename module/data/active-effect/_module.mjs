export class PeasantEnchantmentActiveEffectModel extends foundry.data.ActiveEffectTypeDataModel {}
export class PeasantSkillActiveEffectModel extends foundry.data.ActiveEffectTypeDataModel {}

export const PEASANT_ACTIVE_EFFECT_DATA_MODELS = Object.freeze({
  enchantment: PeasantEnchantmentActiveEffectModel,
  skill: PeasantSkillActiveEffectModel
});
