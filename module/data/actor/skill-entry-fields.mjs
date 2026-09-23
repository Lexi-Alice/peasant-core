function createDiceFields(fields, additions = {}) {
  return {
    enabled: new fields.BooleanField({ initial: false }),
    diceCount: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    diceValue: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    diceBonus: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    flat: new fields.NumberField({ integer: true, initial: 0 }),
    ...additions
  };
}

function createCounterFields(fields) {
  return {
    current: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    max: new fields.NumberField({ integer: true, min: 0, initial: 0 })
  };
}

function createEffectivenessFields(fields) {
  const createEntry = () => new fields.SchemaField({
    mosPer: new fields.NumberField({ min: 0, initial: 0 }),
    accuracyPenalty: new fields.NumberField({ integer: true, initial: 0 })
  });
  return {
    melee: createEntry(),
    projectile: createEntry(),
    normal: createEntry(),
    smite: createEntry(),
    aoe: createEntry(),
    areaBlast: createEntry(),
    tileBlast: createEntry()
  };
}

export function createSkillMechanicFields(fields) {
  return {
    staminaCost: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    attunementCost: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    resourceCosts: new fields.ArrayField(new fields.SchemaField({
      type: new fields.StringField({ initial: "" }),
      value: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
      damageType: new fields.StringField({ initial: "" })
    }), { initial: [] }),
    speed: new fields.SchemaField({
      type: new fields.StringField({ initial: "" }),
      splitSecondCurrent: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
      splitSecondMax: new fields.NumberField({ integer: true, min: 0, initial: 0 })
    }),
    range: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    rangeRate: new fields.ArrayField(
      new fields.NumberField({ integer: true, min: 0, nullable: true, initial: null }),
      { initial: [null, null, null, null] }
    ),
    damage: new fields.SchemaField(createDiceFields(fields, {
      type: new fields.StringField({ initial: "" })
    })),
    desperate: new fields.NumberField({ integer: true, initial: 0 }),
    overkill: new fields.BooleanField({ initial: false }),
    magnetism: new fields.SchemaField({
      grade: new fields.NumberField({ integer: true, min: 0, initial: 0 })
    }),
    heal: new fields.SchemaField(createDiceFields(fields, {
      type: new fields.StringField({ initial: "" })
    })),
    manifest: new fields.SchemaField(createDiceFields(fields)),
    manifestDome: new fields.SchemaField(createDiceFields(fields, {
      duration: new fields.NumberField({ integer: true, min: 1, initial: 3 })
    })),
    manifestResistance: new fields.SchemaField(createDiceFields(fields, {
      haltValues: new fields.ArrayField(
        new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        { initial: [1, 1, 1, 1] }
      )
    })),
    tagUses: new fields.SchemaField(createCounterFields(fields)),
    sections: new fields.SchemaField(createCounterFields(fields)),
    aoe: new fields.SchemaField({
      value: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
      type: new fields.StringField({ initial: "" })
    }),
    customTag: new fields.SchemaField({
      id: new fields.StringField({ initial: "" }),
      name: new fields.StringField({ initial: "" }),
      value: new fields.StringField({ initial: "" })
    }),
    customTags: new fields.ArrayField(new fields.SchemaField({
      id: new fields.StringField({ initial: "" }),
      name: new fields.StringField({ initial: "" }),
      value: new fields.StringField({ initial: "" })
    }), { initial: [] }),
    targetingType: new fields.StringField({ initial: "" }),
    defense: new fields.SchemaField({
      responses: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      effectiveness: new fields.SchemaField(createEffectivenessFields(fields)),
      block: new fields.BooleanField({ initial: false }),
      contactless: new fields.BooleanField({ initial: false }),
      blockType: new fields.StringField({ initial: "Shield" }),
      shieldArm: new fields.StringField({ initial: "LeftArm" }),
      hardness: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
      hp: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
      maxHp: new fields.NumberField({ integer: true, min: 0, initial: 40 }),
      masteryBonus: new fields.BooleanField({ initial: false }),
      alwaysBraced: new fields.BooleanField({ initial: false }),
      appliesDebuff: new fields.BooleanField({ initial: false }),
      debuffToHit: new fields.NumberField({ integer: true, initial: 0 }),
      appliesBefore: new fields.BooleanField({ initial: false })
    }),
    reach: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
    stability: new fields.BooleanField({ initial: false }),
    strengthen: new fields.BooleanField({ initial: false }),
    self: new fields.BooleanField({ initial: false }),
    tagOrder: new fields.ArrayField(new fields.StringField(), { initial: [] })
  };
}

function createLayoutField(fields) {
  return new fields.ArrayField(new fields.SchemaField({
    kind: new fields.StringField({ initial: "tag" }),
    id: new fields.StringField({ initial: "" }),
    key: new fields.StringField({ initial: "" })
  }), { initial: [] });
}

function createRuleField(fields) {
  return new fields.ArrayField(new fields.SchemaField({
    id: new fields.StringField({ initial: "" }),
    label: new fields.StringField({ initial: "" }),
    when: new fields.StringField({ initial: "always" }),
    tagKeys: new fields.ArrayField(new fields.StringField(), { initial: [] }),
    effectLinkIds: new fields.ArrayField(new fields.StringField(), { initial: [] }),
    note: new fields.StringField({ initial: "" })
  }), { initial: [] });
}

function createEffectLinkField(fields) {
  return new fields.ArrayField(new fields.SchemaField({
    id: new fields.StringField({ initial: "" }),
    effectId: new fields.StringField({ initial: "" }),
    tagKey: new fields.StringField({ initial: "" }),
    when: new fields.StringField({ initial: "always" }),
    recipient: new fields.StringField({ initial: "self" }),
    application: new fields.StringField({ initial: "manual" })
  }), { initial: [] });
}

function createUsageMetadataFields(fields) {
  return {
    name: new fields.StringField({ initial: "" }),
    resolution: new fields.StringField({ initial: "legacy" }),
    layout: createLayoutField(fields),
    rules: createRuleField(fields),
    effectLinks: createEffectLinkField(fields)
  };
}

export function createSkillEditorFields(fields) {
  return {
    category: new fields.StringField({ initial: "" }),
    weaponType: new fields.StringField({ initial: "" }),
    defenseType: new fields.StringField({ initial: "" }),
    trickType: new fields.StringField({ initial: "" }),
    signatureType: new fields.StringField({ initial: "" }),
    gateType: new fields.StringField({ initial: "" }),
    characteristics: new fields.ArrayField(new fields.StringField(), { initial: [] }),
    characteristicMode: new fields.StringField({ initial: "single" }),
    signatureUsage: new fields.SchemaField({
      duressUses: new fields.BooleanField({ initial: false }),
      duressCurrent: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
      duressMax: new fields.NumberField({ integer: true, min: 0, initial: 0 })
    }),
    defaultUsageId: new fields.StringField({ initial: "base" }),
    baseUsage: new fields.SchemaField({
      ...createUsageMetadataFields(fields),
      name: new fields.StringField({ initial: "Default" })
    }),
    usages: new fields.ArrayField(new fields.SchemaField({
      id: new fields.StringField({ initial: "" }),
      ...createUsageMetadataFields(fields),
      mechanics: new fields.SchemaField(createSkillMechanicFields(fields)),
      rollOverrides: new fields.ObjectField({ initial: {} }),
      counterScopes: new fields.SchemaField({
        tagUses: new fields.StringField({ initial: "shared" }),
        sections: new fields.StringField({ initial: "shared" })
      })
    }), { initial: [] })
  };
}
