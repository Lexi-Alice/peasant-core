import { HPGridModel } from "./hp-model.mjs";
import { normalizeCustomTagEntry, normalizeRangeRateValue } from "./combat-tags.mjs";
import { normalizeHaltValues } from "./combat-modifiers.mjs";
import { parseOptionalInteger } from "./helpers.mjs";
const { fields } = foundry.data;

export class PeasantCharacterModel extends foundry.abstract.DataModel {
  static migrateData(source) {
    const data = super.migrateData(source);
    const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object ?? {}, key);
    const migrateOptionalNumbers = (entry) => {
      if (!entry || typeof entry !== "object") return entry;
      const next = { ...entry };
      if (hasOwn(next, "tohit")) next.tohit = parseOptionalInteger(next.tohit, { min: 1 });
      if (hasOwn(next, "accuracy")) next.accuracy = parseOptionalInteger(next.accuracy, { allowSign: true });
      return next;
    };
    const migrateSkillOptionalNumbers = (skill) => {
      if (!skill || typeof skill !== "object") return skill;
      const next = migrateOptionalNumbers(skill);
      if (hasOwn(next, "ap")) next.ap = parseOptionalInteger(next.ap, { min: 0 });
      if (hasOwn(next, "sp")) next.sp = parseOptionalInteger(next.sp, { min: 0 });
      return next;
    };
    const migrateDiceBonus = (rollData) => {
      if (!rollData || typeof rollData !== "object") return rollData;
      const next = { ...rollData };
      const rawDiceValue = String(next.diceValue ?? "").trim();
      const diceValueMatch = rawDiceValue.match(/^(\d+)\s*\+\s*(\d+)$/);
      if (diceValueMatch) {
        next.diceValue = Number.parseInt(diceValueMatch[1], 10) || 0;
        next.diceBonus = Number.parseInt(diceValueMatch[2], 10) || 0;
      } else if (hasOwn(next, "diceBonus") && next.diceBonus == null) {
        next.diceBonus = 0;
      }
      return next;
    };

    if (hasOwn(data, "haltValues")) data.haltValues = normalizeHaltValues(data.haltValues);
    if (hasOwn(data, "naturalHaltValues")) data.naturalHaltValues = normalizeHaltValues(data.naturalHaltValues);
    if (hasOwn(data, "reflexAoeSaveTarget")) data.reflexAoeSaveTarget = parseOptionalInteger(data.reflexAoeSaveTarget, { min: 1 });
    if (hasOwn(data, "initiative")) data.initiative = parseOptionalInteger(data.initiative, { allowSign: true });
    if (hasOwn(data, "uselessCollection")) {
      const sourceValue = (data.uselessCollection && typeof data.uselessCollection === "object")
        ? data.uselessCollection.value
        : data.uselessCollection;
      data.uselessCollection = Math.max(0, Number.parseInt(sourceValue, 10) || 0);
    }

    if (Array.isArray(data?.skills)) {
      data.skills = data.skills.map(migrateSkillOptionalNumbers);
    }

    if (Array.isArray(data?.combatMods?.haltBuffs)) {
      data.combatMods = {
        ...data.combatMods,
        haltBuffs: data.combatMods.haltBuffs.map((buff) => {
          if (!buff || typeof buff !== "object") return buff;
          const next = { ...buff };
          if (hasOwn(next, "values")) next.values = normalizeHaltValues(next.values);
          return next;
        })
      };
    }

    if (Array.isArray(data?.notableCombats)) {
      data.notableCombats = data.notableCombats.map((combat) => {
        if (!combat || typeof combat !== "object") return combat;
        const customTags = Array.isArray(combat.customTags)
          ? combat.customTags.map(normalizeCustomTagEntry).filter((tag) => !!tag.name)
          : [];
        const legacyCustomTag = normalizeCustomTagEntry(combat.customTag || {});
        const normalizedCustomTags = customTags.length > 0
          ? customTags
          : (legacyCustomTag.name ? [legacyCustomTag] : []);
        const migratedDamage = migrateDiceBonus(combat.damage);
        const migratedHeal = migrateDiceBonus(combat.heal);
        const migratedManifest = migrateDiceBonus(combat.manifest);
        const migratedCustomTags = hasOwn(combat, "customTags") || hasOwn(combat, "customTag")
          ? {
              customTags: normalizedCustomTags,
              customTag: normalizedCustomTags[0] ? { ...normalizedCustomTags[0] } : { name: "", value: "" }
            }
          : {};

        return {
          ...migrateOptionalNumbers(combat),
          ...(migratedDamage ? { damage: migratedDamage } : {}),
          ...(migratedHeal ? { heal: migratedHeal } : {}),
          ...(migratedManifest ? { manifest: migratedManifest } : {}),
          ...(hasOwn(combat, "rangeRate") ? { rangeRate: normalizeRangeRateValue(combat.rangeRate) } : {}),
          ...migratedCustomTags
        };
      });
    }

    return data;
  }

  static defineSchema() {
    return {
      editMode: new fields.BooleanField({ initial: false }),
      hp: new fields.EmbeddedDataField(HPGridModel),
      portraitWidth: new fields.NumberField({ initial: 150, integer: true }),
      portraitHeight: new fields.NumberField({ initial: 150, integer: true }),
      portraitOffsetX: new fields.NumberField({ initial: 0, integer: true }),
      portraitOffsetY: new fields.NumberField({ initial: 0, integer: true }),
      portraitScale: new fields.NumberField({ initial: 1, min: 0.1, max: 5 }),
      
      // HALT & Hard Locations
      haltValues: new fields.ArrayField(new fields.NumberField({ integer: true, min: 0, initial: 0 }), { initial: [0, 0, 0, 0] }),
      naturalHaltValues: new fields.ArrayField(new fields.NumberField({ integer: true, min: 0, initial: 0 }), { initial: [0, 0, 0, 0] }),
      hardHead: new fields.BooleanField({ initial: false }),
      hardArms: new fields.BooleanField({ initial: false }),
      hardLegs: new fields.BooleanField({ initial: false }),
      hardTorso: new fields.BooleanField({ initial: false }),
      
      // Natural HALT Hard Locations
      naturalHardHead: new fields.BooleanField({ initial: false }),
      naturalHardArms: new fields.BooleanField({ initial: false }),
      naturalHardLegs: new fields.BooleanField({ initial: false }),
      naturalHardTorso: new fields.BooleanField({ initial: false }),
      
      race: new fields.StringField({ initial: "Human" }),
      customRace: new fields.StringField({ initial: "" }),
      origin: new fields.StringField({ initial: "Grimmstad" }),
      customOrigin: new fields.StringField({ initial: "" }),
      specificOrigin: new fields.StringField({ initial: "Soldier" }),
      customSpecificOrigin: new fields.StringField({ initial: "" }),
      // Attributes
      build: new fields.NumberField({ integer: true, min: 0, max: 9, initial: 0 }),
      reflex: new fields.NumberField({ integer: true, min: 0, max: 9, initial: 0 }),
      reflexAoeSaveEnabled: new fields.BooleanField({ initial: false }),
      reflexAoeSaveTarget: new fields.NumberField({ integer: true, min: 1, nullable: true, initial: null }),
      intuition: new fields.NumberField({ integer: true, min: 0, max: 9, initial: 0 }),
      learn: new fields.NumberField({ integer: true, min: 0, max: 9, initial: 0 }),
      charisma: new fields.NumberField({ integer: true, min: 0, max: 9, initial: 0 }),
      edgeLabelMode: new fields.StringField({ initial: "" }),
      edgeCustomLabel: new fields.StringField({ initial: "" }),
      edge: new fields.SchemaField({
        value: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        max: new fields.NumberField({ integer: true, min: 0, initial: 0 })
      }),
      edgeResources: new fields.ArrayField(new fields.SchemaField({
        labelMode: new fields.StringField({ initial: "edge" }),
        customLabel: new fields.StringField({ initial: "" }),
        value: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        max: new fields.NumberField({ integer: true, min: 0, initial: 0 })
      }), { initial: [] }),
      // Resource fields - MUST use 'value' and 'max' for Foundry token bars to work
      stamina: new fields.SchemaField({
        value: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        max: new fields.NumberField({ integer: true, min: 0, initial: 0 })
      }),
      attunement: new fields.SchemaField({
        value: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        max: new fields.NumberField({ integer: true, min: 0, initial: 0 })
      }),
      capacity: new fields.SchemaField({
        value: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        max: new fields.NumberField({ integer: true, min: 0, initial: 0 })
      }),
      armorCharge: new fields.SchemaField({
        value: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        max: new fields.NumberField({ integer: true, min: 0, initial: 0 })
      }),
      health: new fields.SchemaField({
        value: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        max: new fields.NumberField({ integer: true, min: 0, initial: 0 })
      }),
      movement: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
      initiative: new fields.NumberField({ integer: true, nullable: true, initial: null }),
      // Global AP/SP
      ap: new fields.SchemaField({
        value: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        max: new fields.NumberField({ integer: true, min: 0, initial: 0 })
      }),
      sp: new fields.SchemaField({
        value: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        max: new fields.NumberField({ integer: true, min: 0, initial: 0 })
      }),
      // Combat modifiers (temporary buffs/debuffs that affect all combat rolls)
      combatMods: new fields.SchemaField({
        toHit: new fields.NumberField({ integer: true, initial: 0 }),
        accuracy: new fields.NumberField({ integer: true, initial: 0 }),
        diceRate: new fields.NumberField({ integer: true, initial: 0 }),
        flatDamage: new fields.NumberField({ integer: true, initial: 0 }),
        costMod: new fields.NumberField({ integer: true, initial: 0 }),
        haltBuffs: new fields.ArrayField(new fields.SchemaField({
          type: new fields.StringField({ initial: "" }), // halt, natural, flat, cost, custom
          values: new fields.ArrayField(new fields.NumberField({ integer: true, min: 0, initial: 0 }), { initial: [0, 0, 0, 0] }),
          value: new fields.NumberField({ integer: true, initial: 0 }),
          resourceType: new fields.StringField({ initial: "" }),
          customName: new fields.StringField({ initial: "" })
        }), { initial: [] })
      }),
      // SIR fields
      sirGrimmstad: new fields.StringField({ initial: "" }),
      sirSavonia: new fields.StringField({ initial: "" }),
      sirThingollr: new fields.StringField({ initial: "" }),
      sirRoyce: new fields.StringField({ initial: "" }),
      sirGarren: new fields.StringField({ initial: "" }),
      sirVestinia: new fields.StringField({ initial: "" }),
      sirLupine: new fields.StringField({ initial: "" }),
      sirLeon: new fields.StringField({ initial: "" }),
      sirUrsa: new fields.StringField({ initial: "" }),
      sirDoomi: new fields.StringField({ initial: "" }),
      sirSkeever: new fields.StringField({ initial: "" }),
      // Biography
      alignment: new fields.StringField({ initial: "" }),
      faith: new fields.StringField({ initial: "" }),
      gender: new fields.StringField({ initial: "" }),
      eyes: new fields.StringField({ initial: "" }),
      hair: new fields.StringField({ initial: "" }),
      skin: new fields.StringField({ initial: "" }),
      height: new fields.StringField({ initial: "" }),
      weight: new fields.StringField({ initial: "" }),
      age: new fields.StringField({ initial: "" }),
      ideals: new fields.StringField({ initial: "" }),
      bonds: new fields.StringField({ initial: "" }),
      flaws: new fields.StringField({ initial: "" }),
      personalityTraits: new fields.StringField({ initial: "" }),
      appearance: new fields.StringField({ initial: "" }),
      biography: new fields.StringField({ initial: "" }),
      // Skills
      skills: new fields.ArrayField(new fields.SchemaField({
        type: new fields.StringField({ initial: "standard" }), // standard, stance, perk, etc.
        specialGrade: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        class: new fields.NumberField({ integer: true, min: 1, max: 10, initial: 1 }),
        rank: new fields.StringField({ initial: "0" }), // Can be "0"-"4" or "u"/"U" for untrained
        sig: new fields.BooleanField({ initial: false }),
        usesMax: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        usesCurrent: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        name: new fields.StringField({ initial: "" }),
        tohit: new fields.NumberField({ integer: true, min: 1, nullable: true, initial: null }),
        accuracy: new fields.NumberField({ integer: true, nullable: true, initial: null }),
        ap: new fields.NumberField({ integer: true, min: 0, nullable: true, initial: null }),
        sp: new fields.NumberField({ integer: true, min: 0, nullable: true, initial: null }),
        indent: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        description: new fields.HTMLField({ initial: "" })
      }), { initial: [] }),
      // Flexible Advantages
      flexibleAdvantages: new fields.ArrayField(new fields.StringField(), { initial: [] }),
      flexibleAdvantageDescriptions: new fields.ArrayField(new fields.HTMLField({ initial: "" }), { initial: [] }),
      // Inventory
      currency: new fields.SchemaField({
        gp: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        pp: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        rs: new fields.NumberField({ integer: true, min: 0, initial: 0 })
      }),
      uselessCollection: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
      inventory: new fields.HTMLField({ initial: "" }),
      // Stress counts (how many boxes to show)
      physicalStressCount: new fields.NumberField({ integer: true, min: 0, initial: 4 }),
      mentalStressCount: new fields.NumberField({ integer: true, min: 0, initial: 4 }),
      generalStressCount: new fields.NumberField({ integer: true, min: 0, initial: 8 }),
      // Physical stress - individual fields (up to 20)
      physical0: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      physical1: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      physical2: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      physical3: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      physical4: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      physical5: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      physical6: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      physical7: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      physical8: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      physical9: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      physical10: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      physical11: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      physical12: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      physical13: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      physical14: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      physical15: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      physical16: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      physical17: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      physical18: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      physical19: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      // Mental stress - individual fields (up to 20)
      mental0: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      mental1: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      mental2: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      mental3: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      mental4: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      mental5: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      mental6: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      mental7: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      mental8: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      mental9: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      mental10: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      mental11: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      mental12: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      mental13: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      mental14: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      mental15: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      mental16: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      mental17: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      mental18: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      mental19: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      // General stress - individual fields (up to 20)
      general0: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      general1: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      general2: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      general3: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      general4: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      general5: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      general6: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      general7: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      general8: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      general9: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      general10: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      general11: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      general12: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      general13: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      general14: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      general15: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      general16: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      general17: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      general18: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      general19: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      
      // Notable Combats
      notableCombats: new fields.ArrayField(new fields.SchemaField({
        id: new fields.StringField({ initial: "" }),
        type: new fields.StringField({ initial: "standard" }), // standard, Stance, Perk, Style, Cantrip, Historic, TM, Other
        specialGrade: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        class: new fields.NumberField({ integer: true, min: 1, max: 10, initial: 1 }),
        rank: new fields.StringField({ initial: "0" }), // Can be "0"-"4" or "u"/"U" for untrained
        sig: new fields.BooleanField({ initial: false }),
        usesMax: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        usesCurrent: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        name: new fields.StringField({ initial: "" }),
        img: new fields.StringField({ initial: "" }),
        effectIds: new fields.ArrayField(new fields.StringField({ initial: "" }), { initial: [] }),
        tohit: new fields.NumberField({ integer: true, min: 1, nullable: true, initial: null }),
        accuracy: new fields.NumberField({ integer: true, nullable: true, initial: null }),
        indent: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        description: new fields.HTMLField({ initial: "" }),
        // Tags for combat modifiers - use empty/zero values instead of null for better compatibility
        // DEPRECATED: staminaCost and attunementCost - use resourceCosts array instead
        staminaCost: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        attunementCost: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        // Resource costs array - replaces staminaCost/attunementCost with more options
        resourceCosts: new fields.ArrayField(new fields.SchemaField({
          type: new fields.StringField({ initial: "" }), // Stamina, Attunement, HP, Physical Stress, Mental Stress
          value: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
          damageType: new fields.StringField({ initial: "" }) // For HP: Blunt, Lethal, Critical
        }), { initial: [] }),
        // Speed tag
        speed: new fields.SchemaField({
          type: new fields.StringField({ initial: "" }), // Full Round, Standard, Movement, Reflex, Instant, Split Second
          splitSecondCurrent: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
          splitSecondMax: new fields.NumberField({ integer: true, min: 0, initial: 0 })
        }),
        range: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        rangeRate: new fields.ArrayField(new fields.NumberField({ integer: true, min: 0, nullable: true, initial: null }), { initial: [null, null, null, null] }),
        damage: new fields.SchemaField({
          enabled: new fields.BooleanField({ initial: false }),
          diceCount: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
          diceValue: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
          diceBonus: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
          flat: new fields.NumberField({ integer: true, initial: 0 }),
          type: new fields.StringField({ initial: "" }) // Blunt, Lethal, Hybrid, Crit
        }),
        desperate: new fields.NumberField({ integer: true, initial: 0 }),
        overkill: new fields.BooleanField({ initial: false }),
        magnetism: new fields.SchemaField({
          grade: new fields.NumberField({ integer: true, min: 0, initial: 0 })
        }),
        heal: new fields.SchemaField({
          enabled: new fields.BooleanField({ initial: false }),
          diceCount: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
          diceValue: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
          diceBonus: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
          flat: new fields.NumberField({ integer: true, initial: 0 }),
          type: new fields.StringField({ initial: "" }) // Temporary, Greater
        }),
        manifest: new fields.SchemaField({
          enabled: new fields.BooleanField({ initial: false }),
          diceCount: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
          diceValue: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
          diceBonus: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
          flat: new fields.NumberField({ integer: true, initial: 0 })
        }),
        tagUses: new fields.SchemaField({
          current: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
          max: new fields.NumberField({ integer: true, min: 0, initial: 0 })
        }),
        sections: new fields.SchemaField({
          current: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
          max: new fields.NumberField({ integer: true, min: 0, initial: 0 })
        }),
        aoe: new fields.SchemaField({
          value: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
          type: new fields.StringField({ initial: "" }) // Legacy: Area, Blast, Tile
        }),
        customTag: new fields.SchemaField({
          name: new fields.StringField({ initial: "" }),
          value: new fields.StringField({ initial: "" })
        }),
        customTags: new fields.ArrayField(new fields.SchemaField({
          name: new fields.StringField({ initial: "" }),
          value: new fields.StringField({ initial: "" })
        }), { initial: [] }),
        targetingType: new fields.StringField({ initial: "" }), // Melee, Projectile, Normal Targeting, Smite, AoE, Area Blast, Tile Blast
        defense: new fields.SchemaField({
          responses: new fields.ArrayField(new fields.StringField(), { initial: [] }),
          effectiveness: new fields.SchemaField({
            melee: new fields.SchemaField({
              mosPer: new fields.NumberField({ min: 0, initial: 0 }),
              accuracyPenalty: new fields.NumberField({ integer: true, initial: 0 })
            }),
            projectile: new fields.SchemaField({
              mosPer: new fields.NumberField({ min: 0, initial: 0 }),
              accuracyPenalty: new fields.NumberField({ integer: true, initial: 0 })
            }),
            normal: new fields.SchemaField({
              mosPer: new fields.NumberField({ min: 0, initial: 0 }),
              accuracyPenalty: new fields.NumberField({ integer: true, initial: 0 })
            }),
            smite: new fields.SchemaField({
              mosPer: new fields.NumberField({ min: 0, initial: 0 }),
              accuracyPenalty: new fields.NumberField({ integer: true, initial: 0 })
            }),
            aoe: new fields.SchemaField({
              mosPer: new fields.NumberField({ min: 0, initial: 0 }),
              accuracyPenalty: new fields.NumberField({ integer: true, initial: 0 })
            }),
            areaBlast: new fields.SchemaField({
              mosPer: new fields.NumberField({ min: 0, initial: 0 }),
              accuracyPenalty: new fields.NumberField({ integer: true, initial: 0 })
            }),
            tileBlast: new fields.SchemaField({
              mosPer: new fields.NumberField({ min: 0, initial: 0 }),
              accuracyPenalty: new fields.NumberField({ integer: true, initial: 0 })
            })
          }),
          block: new fields.BooleanField({ initial: false }),
          // Legacy field retained temporarily so older worlds can migrate cleanly to `block`.
          contactless: new fields.BooleanField({ initial: false }),
          blockType: new fields.StringField({ initial: "Shield" }),
          shieldArm: new fields.StringField({ initial: "LeftArm" }),
          hardness: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
          hp: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
          masteryBonus: new fields.BooleanField({ initial: false }),
          // Legacy field retained temporarily while older worlds migrate away from this option.
          alwaysBraced: new fields.BooleanField({ initial: false }),
          appliesDebuff: new fields.BooleanField({ initial: false }),
          debuffToHit: new fields.NumberField({ integer: true, initial: 0 }),
          appliesBefore: new fields.BooleanField({ initial: false })
        }),
        reach: new fields.NumberField({ integer: true, min: 0, initial: 0 }), // Numeric reach value
        stability: new fields.BooleanField({ initial: false }), // Double dice count, halve dice result (flat unaffected)
        strengthen: new fields.BooleanField({ initial: false }), // Stability variant: keep highest natural dice count from doubled roll
        self: new fields.BooleanField({ initial: false }),
        // Tag display order - array of tag type names in display order
        tagOrder: new fields.ArrayField(new fields.StringField(), { initial: [] })
      }), { initial: [] }),
      
      // Conditions / Wounds - separate left/right for arms and legs
      conditions: new fields.SchemaField({
        wounded: new fields.BooleanField({ initial: false }),
        head: new fields.StringField({ initial: "" }), // "", "disabled", "crippled"
        rightArm: new fields.StringField({ initial: "" }),
        leftArm: new fields.StringField({ initial: "" }),
        rightLeg: new fields.StringField({ initial: "" }),
        leftLeg: new fields.StringField({ initial: "" }),
        torso: new fields.StringField({ initial: "" }),
        // Legacy fields for backwards compatibility
        arms: new fields.StringField({ initial: "" }),
        legs: new fields.StringField({ initial: "" })
      })
      ,
      // Blessing state stored as { type: "spring"|"summer"|"fall"|"winter", target: "build"|... }
      blessing: new fields.SchemaField({
        type: new fields.StringField({ initial: "" }),
        target: new fields.StringField({ initial: "" })
      }, { initial: { type: "", target: "" } })
      ,
      // Selected characteristic to receive a -1 To-Hit penalty (stored as human-friendly names: Strength/Dexterity/Mental/Social)
      toHitPenaltyTarget: new fields.StringField({ initial: "" }),
      
      // Temporary HP - current/max where max = maxHP - currentHP (dynamically calculated)
      temporaryHp: new fields.SchemaField({
        value: new fields.NumberField({ integer: true, min: 0, initial: 0 }),
        max: new fields.NumberField({ integer: true, min: 0, initial: 0 })
      }),
      
      // Bolstered HP - simple value, max = number of HP columns
      bolsteredHp: new fields.NumberField({ integer: true, min: 0, initial: 0 })
    };
  }
  
}
