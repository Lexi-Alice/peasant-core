const { fields } = foundry.data;

export const PEASANT_ITEM_TYPES = Object.freeze(["weapon", "equipment", "tool", "consumable", "loot"]);

function commonItemSchema() {
  return {
    description: new fields.HTMLField({ initial: "" }),
    category: new fields.StringField({ initial: "" }),
    quality: new fields.StringField({ initial: "standard" }),
    magicType: new fields.StringField({ initial: "mundane" }),
    quantity: new fields.NumberField({ integer: true, min: 0, initial: 1 }),
    weight: new fields.NumberField({ min: 0, initial: 0 }),
    weightUnit: new fields.StringField({ initial: "lb" }),
    value: new fields.NumberField({ min: 0, initial: 0 }),
    currency: new fields.StringField({ initial: "gp" }),
    sunder: new fields.SchemaField({
      current: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
      max: new fields.NumberField({ integer: true, min: 0, initial: 0 })
    }),
    imageOffsetX: new fields.NumberField({ initial: 0, integer: true }),
    imageOffsetY: new fields.NumberField({ initial: 0, integer: true }),
    imageScale: new fields.NumberField({ initial: 1, min: 1, max: 4 })
  };
}

function equipableItemSchema() {
  return {
    ...commonItemSchema(),
    equipped: new fields.BooleanField({ initial: false })
  };
}

function combatDiceSchema() {
  return new fields.SchemaField({
    enabled: new fields.BooleanField({ initial: false }),
    diceCount: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    diceValue: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    diceBonus: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    flat: new fields.NumberField({ integer: true, initial: 0 }),
    type: new fields.StringField({ initial: "" })
  });
}

export class PeasantWeaponModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...equipableItemSchema(),
      tohit: new fields.NumberField({ integer: true, min: 1, nullable: true, initial: null }),
      accuracy: new fields.NumberField({ integer: true, nullable: true, initial: null }),
      ap: new fields.NumberField({ integer: true, min: 0, nullable: true, initial: null }),
      sp: new fields.NumberField({ integer: true, min: 0, nullable: true, initial: null }),
      range: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
      rangeRate: new fields.ArrayField(new fields.NumberField({ integer: true, min: 0, nullable: true, initial: null }), { initial: [null, null, null, null] }),
      damage: combatDiceSchema(),
      reach: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
      stability: new fields.BooleanField({ initial: false }),
      strengthen: new fields.BooleanField({ initial: false })
    };
  }
}

export class PeasantEquipmentModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...equipableItemSchema(),
      shield: new fields.SchemaField({
        hp: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        hardness: new fields.NumberField({ integer: true, min: 0, initial: 0 })
      })
    };
  }
}

export class PeasantToolModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return equipableItemSchema();
  }
}

export class PeasantConsumableModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...commonItemSchema(),
      equipped: new fields.BooleanField({ initial: false }),
      uses: new fields.SchemaField({
        value: new fields.NumberField({ integer: true, min: 0, initial: 1 }),
        max: new fields.NumberField({ integer: true, min: 0, initial: 1 })
      }),
      consumed: new fields.BooleanField({ initial: false })
    };
  }
}

export class PeasantLootModel extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      ...commonItemSchema(),
      category: new fields.StringField({ initial: "art-object" })
    };
  }
}

export const PEASANT_ITEM_DATA_MODELS = Object.freeze({
  weapon: PeasantWeaponModel,
  equipment: PeasantEquipmentModel,
  tool: PeasantToolModel,
  consumable: PeasantConsumableModel,
  loot: PeasantLootModel
});
