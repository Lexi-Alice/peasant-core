import { absorbBolsteredFromCounts, absorbTempHpFromCounts, applyDamageResistanceToCounts, splitDamageCounts, sumDamageCounts, toSimplifiedHpDamageFromCountsWithResistance, toSimplifiedHpDamageWithResistance } from "../data/actor/damage.mjs";
import {
  COMBAT_HALT_BUFF_TYPE_COST,
  COMBAT_HALT_BUFF_TYPE_CUSTOM,
  COMBAT_HALT_BUFF_TYPE_FLAT,
  COMBAT_HALT_BUFF_TYPE_HALT,
  COMBAT_HALT_BUFF_TYPE_NATURAL,
  getCombatHaltBuffTotals,
  normalizeHaltValues,
  parseHaltSlashValues,
  sanitizeCombatCostResourceType,
  sanitizeCombatHaltBuffs,
  sanitizeCombatHaltBuffType
} from "../data/actor/combat-modifiers.mjs";
import { createDefaultCombatDefense, normalizeCombatDefense } from "../data/actor/combat-defense.mjs";
import { COMBAT_FULL_TAG_ORDER, getCombatCustomTags, normalizeCombatMagnetism, normalizeCombatTargetingType, normalizeRangeRateValue, syncCombatCustomTags } from "../data/actor/combat-tags.mjs";
import { getDefaultEdgeLabelMode, normalizeEdgeResourceEntry, sanitizeEdgeLabelMode } from "../data/actor/edge-resources.mjs";
import { getActorBolsteredMax, getActorHealthMax, isPeasantCharacterType, isSimplifiedHpActor, parseOptionalInteger } from "../data/actor/helpers.mjs";
import { parseHpValueCommand } from "../data/actor/hp-commands.mjs";
import { applyCombatStressDamageForActor } from "../data/actor/stress.mjs";
import { TARGETED_DAMAGE_HALT_INDEX_MAP, TARGETED_DAMAGE_HARD_FLAG_MAP, getArmorChargeMultiplier, getTargetedDamageConditionKey, getTargetedDamageLocationDisplay, getWoundThresholdMultipliers, normalizeAppliedDamageType } from "../data/actor/targeted-damage.mjs";
import { pcLog } from "../utils/logging.mjs";

export class PeasantActor extends Actor {
  static RESOURCE_NAMES = Object.freeze(["stamina", "attunement", "capacity", "edge"]);
  static STRESS_TYPES = Object.freeze(["physical", "mental", "general"]);
  static CONDITION_KEYS = Object.freeze(["wounded", "head", "rightArm", "leftArm", "rightLeg", "leftLeg", "torso", "arms", "legs"]);
  static WOUND_STATUSES = Object.freeze(["disabled", "crippled"]);
  static BLESSING_TYPES = Object.freeze(["spring", "summer", "fall", "winter"]);
  static BLESSING_TARGETS = Object.freeze(["build", "reflex", "intuition", "learn", "charisma"]);
  static TO_HIT_PENALTY_TARGETS = Object.freeze(["Strength", "Dexterity", "Mental", "Social"]);
  static HARD_LOCATION_NAMES = Object.freeze(["Head", "Arms", "Legs", "Torso"]);

  prepareDerivedData() {
    super.prepareDerivedData();

    pcLog.debug("prepareDerivedData called for actor:", this.name, "type:", this.type);

    if (isPeasantCharacterType(this.type) && isSimplifiedHpActor(this)) {
      const maxHealth = getActorHealthMax(this);
      const currentHealthRaw = Number(this.system?.health?.value);
      const currentHealth = Number.isFinite(currentHealthRaw)
        ? Math.max(0, Math.min(currentHealthRaw, maxHealth))
        : maxHealth;

      this.system.health = {
        value: currentHealth,
        max: maxHealth
      };

      const tempHpMax = Math.max(0, maxHealth - currentHealth);
      const currentTempHp = this.system.temporaryHp?.value || 0;
      this.system.temporaryHp = {
        value: Math.min(currentTempHp, tempHpMax),
        max: tempHpMax
      };
    } else if (isPeasantCharacterType(this.type) && this.system.hp && this.system.hp.grid) {
      const totalCells = this.system.hp.rows * this.system.hp.cols;
      let regularCells = 0;

      for (let row of this.system.hp.grid) {
        for (let cell of row) {
          if (cell === 0) regularCells++;
        }
      }

      this.system.health = {
        value: regularCells,
        max: totalCells
      };

      const tempHpMax = totalCells - regularCells;
      const currentTempHp = this.system.temporaryHp?.value || 0;
      this.system.temporaryHp = {
        value: Math.min(currentTempHp, tempHpMax),
        max: tempHpMax
      };

      pcLog.debug("Health calculated in Actor:", this.name, "- value:", regularCells, "max:", totalCells);
    } else {
      pcLog.debug("Health NOT calculated - type:", this.type, "has hp:", !!this.system.hp, "has grid:", !!this.system.hp?.grid);
    }
  }

  async _applyPeasantSimplifiedHpDamageValue(scaledDamage) {
    const maxHealth = getActorHealthMax(this);
    const currentHealthRaw = Number(this.system?.health?.value);
    const currentHealth = Number.isFinite(currentHealthRaw)
      ? Math.max(0, Math.min(currentHealthRaw, maxHealth))
      : maxHealth;
    const damageValue = Math.max(0, Math.floor(Number(scaledDamage) || 0));

    if (damageValue <= 0) {
      return { ok: true, value: currentHealth, scaledDamage: 0, tempUsed: 0, bolsteredUsed: 0 };
    }

    let remaining = damageValue;
    let tempHp = Math.max(0, Number(this.system?.temporaryHp?.value) || 0);
    let bolsteredHp = Math.max(0, Number(this.system?.bolsteredHp) || 0);

    const tempUsed = Math.min(tempHp, remaining);
    tempHp -= tempUsed;
    remaining -= tempUsed;

    const bolsteredUsed = Math.min(bolsteredHp, remaining);
    bolsteredHp -= bolsteredUsed;
    remaining -= bolsteredUsed;

    const newHealth = Math.max(0, currentHealth - remaining);
    const newTempHpMax = Math.max(0, maxHealth - newHealth);
    const newTempHpValue = Math.min(tempHp, newTempHpMax);
    const bolsteredCap = getActorBolsteredMax(this);

    await this.update({
      "system.health.value": newHealth,
      "system.health.max": maxHealth,
      "system.temporaryHp.value": newTempHpValue,
      "system.temporaryHp.max": newTempHpMax,
      "system.bolsteredHp": Math.max(0, Math.min(bolsteredHp, bolsteredCap))
    });

    return { ok: true, value: newHealth, scaledDamage: damageValue, tempUsed, bolsteredUsed };
  }

  async applyPeasantDamage(amount, dmgType, hardLocation = false) {
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, message: "Damage amount must be positive." };

    if (isSimplifiedHpActor(this)) {
      const scaledDamage = toSimplifiedHpDamageWithResistance(amount, dmgType, this, hardLocation);
      return this._applyPeasantSimplifiedHpDamageValue(scaledDamage);
    }

    const hp = this?.system?.hp;
    if (!hp?.grid || !Number.isFinite(hp.rows) || !Number.isFinite(hp.cols)) {
      return { ok: false, message: "HP grid is not available for this actor." };
    }
    if (typeof hp.applyDamage !== "function") {
      return { ok: false, message: "HP grid is not available for this actor." };
    }

    let remaining = amount;
    let tempHp = Number(this.system.temporaryHp?.value) || 0;
    let bolsteredHp = Number(this.system.bolsteredHp) || 0;

    if (tempHp > 0 && remaining > 0) {
      const used = Math.min(tempHp, remaining);
      tempHp -= used;
      remaining -= used;
    }

    if (bolsteredHp > 0 && remaining > 0) {
      const used = Math.min(bolsteredHp, remaining);
      bolsteredHp -= used;
      remaining -= used;
    }

    if (remaining > 0) hp.applyDamage(dmgType, remaining, hardLocation);

    const totalCells = hp.rows * hp.cols;
    let regularCells = 0;
    for (let row of hp.grid) for (let cell of row) if (cell === 0) regularCells++;
    const newTempHpMax = totalCells - regularCells;
    const newTempHpValue = Math.min(tempHp, newTempHpMax);

    await this.update({
      "system.hp.grid": hp.grid.map(row => [...row]),
      "system.health.value": regularCells,
      "system.health.max": totalCells,
      "system.temporaryHp.value": newTempHpValue,
      "system.temporaryHp.max": newTempHpMax,
      "system.bolsteredHp": bolsteredHp
    });

    return { ok: true, value: regularCells };
  }

  async applyPeasantTargetedDamage({
    amount,
    type,
    location = "Torso",
    isAP = false,
    useArmorCharge = false,
    ignoreHaltReduction = false,
    woundLocation = null,
    suppressLocationBreaks = false
  } = {}) {
    const normalizedType = normalizeAppliedDamageType(type);
    if (normalizedType === "flexible") {
      return { ok: false, message: "Flexible damage needs a concrete damage type before it can be applied." };
    }

    const damageAmount = Number(amount);
    if (!Number.isFinite(damageAmount) || damageAmount <= 0) {
      return { ok: false, message: "Damage amount must be positive." };
    }

    const locKey = getTargetedDamageConditionKey(location);
    const woundLoc = woundLocation || location;
    const woundLocKey = getTargetedDamageConditionKey(woundLoc);
    const locationDisplay = getTargetedDamageLocationDisplay(location);
    const haltIndex = TARGETED_DAMAGE_HALT_INDEX_MAP[location] ?? 0;
    const isHybrid = normalizedType === "hybrid";

    let netDamage = damageAmount;
    let haltUsed = 0;

    const haltParts = parseHaltSlashValues(this.system?.haltValues || "0/0/0/0");
    const naturalHaltParts = parseHaltSlashValues(this.system?.naturalHaltValues || "0/0/0/0");
    const combatHaltTotals = getCombatHaltBuffTotals(this.system?.combatMods?.haltBuffs);
    const armorHaltBuffs = combatHaltTotals[COMBAT_HALT_BUFF_TYPE_HALT] || [0, 0, 0, 0];
    const naturalHaltBuffs = combatHaltTotals[COMBAT_HALT_BUFF_TYPE_NATURAL] || [0, 0, 0, 0];

    if (!ignoreHaltReduction) {
      const naturalHalt = (Number.parseInt(naturalHaltParts[haltIndex], 10) || 0) + (naturalHaltBuffs[haltIndex] || 0);
      let armorHalt = (Number.parseInt(haltParts[haltIndex], 10) || 0) + (armorHaltBuffs[haltIndex] || 0);
      if (useArmorCharge) armorHalt *= getArmorChargeMultiplier(this);

      haltUsed += naturalHalt;
      if (!isAP) haltUsed += armorHalt;
      netDamage = Math.max(0, damageAmount - haltUsed);
    }

    let isHard = false;
    if (isHybrid) {
      isHard = true;
    } else {
      const flags = TARGETED_DAMAGE_HARD_FLAG_MAP[location] || { hard: "", naturalHard: "" };
      isHard = !!this.system?.[flags.hard] || !!this.system?.[flags.naturalHard];
    }

    const rawCounts = splitDamageCounts(netDamage, normalizedType);

    if (isSimplifiedHpActor(this)) {
      const scaledDamage = toSimplifiedHpDamageFromCountsWithResistance(rawCounts, this, isHard);
      const result = await this._applyPeasantSimplifiedHpDamageValue(scaledDamage);
      return {
        ...result,
        location,
        locationDisplay,
        haltUsed,
        netDamage,
        normalizedType,
        isHybrid,
        damageToGrid: result?.scaledDamage ?? scaledDamage,
        isHard,
        useArmorCharge,
        isAP,
        ignoreHaltReduction
      };
    }

    const resistedCounts = applyDamageResistanceToCounts(rawCounts, this);
    const resistedNetDamage = sumDamageCounts(resistedCounts);

    let tempHp = this.system?.temporaryHp?.value || 0;
    let bolsteredHp = this.system?.bolsteredHp || 0;
    let tempHpUsed = 0;
    let bolsteredHpUsed = 0;

    let remainingCounts = resistedCounts;
    if (resistedNetDamage > 0) {
      const tempResult = absorbTempHpFromCounts(remainingCounts, tempHp);
      remainingCounts = tempResult.remaining;
      tempHpUsed = tempResult.tempUsed;
      tempHp = tempResult.tempRemaining;

      const bolsteredResult = absorbBolsteredFromCounts(remainingCounts, bolsteredHp);
      remainingCounts = bolsteredResult.remaining;
      bolsteredHpUsed = bolsteredResult.bolsteredUsed;
      bolsteredHp = bolsteredResult.bolsteredRemaining;
    }

    const damageToGrid = sumDamageCounts(remainingCounts);
    const hp = this.system?.hp;
    if (!hp?.grid || !Number.isFinite(hp.rows) || !Number.isFinite(hp.cols) || typeof hp.applyDamage !== "function") {
      return { ok: false, message: "HP grid is not available for this actor." };
    }

    const hpCols = hp.cols || 7;
    const woundMult = getWoundThresholdMultipliers(this);
    let woundMultiplier = woundMult.head;
    if (woundLoc === "Torso") woundMultiplier = woundMult.torso;
    else if (woundLoc === "RightArm" || woundLoc === "LeftArm") woundMultiplier = woundMult.arms;
    else if (woundLoc === "RightLeg" || woundLoc === "LeftLeg") woundMultiplier = woundMult.legs;
    const woundThreshold = hpCols * woundMultiplier;

    const isAlreadyWounded = this.system?.conditions?.wounded;
    const currentLocStatus = this.system?.conditions?.[suppressLocationBreaks ? woundLocKey : locKey];

    const disabledMult = isAlreadyWounded ? 1 : 2;
    const crippledMult = isAlreadyWounded ? 2 : 3;
    const disabledThreshold = woundThreshold * disabledMult;
    const crippledThreshold = woundThreshold * crippledMult;

    let newWoundedState = isAlreadyWounded;
    let newLocStatus = currentLocStatus;
    let breakOccurred = false;
    let breakType = "";
    const events = [];

    if (damageToGrid > 0) {
      if (damageToGrid >= woundThreshold && !isAlreadyWounded) {
        newWoundedState = true;
        events.push("Became Wounded!");
      }

      if (!suppressLocationBreaks && (damageToGrid >= crippledThreshold || (damageToGrid >= disabledThreshold && currentLocStatus === "disabled"))) {
        if (newLocStatus !== "crippled") {
          newLocStatus = "crippled";
          breakOccurred = true;
          breakType = "Crippled";
          events.push(`${breakType} ${locationDisplay}!`);
        }
      } else if (!suppressLocationBreaks && damageToGrid >= disabledThreshold) {
        if (newLocStatus !== "disabled" && newLocStatus !== "crippled") {
          newLocStatus = "disabled";
          breakOccurred = true;
          breakType = "Disabled";
          events.push(`${breakType} ${locationDisplay}!`);
        }
      }
    }

    const conditionUpdates = {};
    if (newWoundedState !== isAlreadyWounded) conditionUpdates["system.conditions.wounded"] = newWoundedState;
    if (!suppressLocationBreaks && newLocStatus !== currentLocStatus) conditionUpdates[`system.conditions.${locKey}`] = newLocStatus;
    if (Object.keys(conditionUpdates).length > 0) await this.update(conditionUpdates);

    const gridDamageType = isHybrid ? "lethal" : normalizedType;
    if (damageToGrid > 0) {
      if (breakOccurred) {
        const halfDamage = Math.floor(damageToGrid / 2);
        const otherHalf = damageToGrid - halfDamage;
        hp.applyDamage(gridDamageType, otherHalf, isHard);
        hp.applyDamage("critical", halfDamage, isHard);
      } else {
        if (remainingCounts.critical > 0) hp.applyDamage("critical", remainingCounts.critical, false);
        if (remainingCounts.lethal > 0) {
          const hardForLethal = isHybrid ? false : isHard;
          hp.applyDamage("lethal", remainingCounts.lethal, hardForLethal);
        }
        if (remainingCounts.blunt > 0) hp.applyDamage("blunt", remainingCounts.blunt, false);
      }
    }

    const totalCells = hp.rows * hp.cols;
    let regularCells = 0;
    for (const rowData of hp.grid) {
      for (const cellState of rowData) {
        if (cellState === 0) regularCells++;
      }
    }

    const newTempHpMax = totalCells - regularCells;
    const newTempHpValue = Math.min(tempHp, newTempHpMax);

    await this.update({
      "system.hp.grid": hp.grid.map(row => [...row]),
      "system.health.value": regularCells,
      "system.health.max": totalCells,
      "system.temporaryHp.value": newTempHpValue,
      "system.temporaryHp.max": newTempHpMax,
      "system.bolsteredHp": bolsteredHp
    });

    return {
      ok: true,
      value: regularCells,
      location,
      locationDisplay,
      haltUsed,
      netDamage,
      normalizedType,
      isHybrid,
      damageToGrid,
      isHard,
      useArmorCharge,
      isAP,
      ignoreHaltReduction,
      tempHpUsed,
      bolsteredHpUsed,
      breakOccurred,
      events
    };
  }

  async applyPeasantLocationlessDamage({
    amount,
    type
  } = {}) {
    const normalizedType = normalizeAppliedDamageType(type);
    if (normalizedType === "flexible") {
      return { ok: false, message: "Flexible damage needs a concrete damage type before it can be applied." };
    }

    const damageAmount = Number(amount);
    if (!Number.isFinite(damageAmount) || damageAmount <= 0) {
      return { ok: false, message: "Damage amount must be positive." };
    }

    const rawCounts = splitDamageCounts(damageAmount, normalizedType);

    if (isSimplifiedHpActor(this)) {
      const scaledDamage = toSimplifiedHpDamageFromCountsWithResistance(rawCounts, this, false);
      const result = await this._applyPeasantSimplifiedHpDamageValue(scaledDamage);
      return {
        ...result,
        locationless: true,
        haltUsed: 0,
        netDamage: damageAmount,
        normalizedType,
        isHybrid: normalizedType === "hybrid",
        damageToGrid: result?.scaledDamage ?? scaledDamage,
        isHard: false,
        useArmorCharge: false,
        isAP: false,
        ignoreHaltReduction: true
      };
    }

    const resistedCounts = applyDamageResistanceToCounts(rawCounts, this);
    const resistedDamage = sumDamageCounts(resistedCounts);

    let tempHp = this.system?.temporaryHp?.value || 0;
    let bolsteredHp = this.system?.bolsteredHp || 0;
    let tempHpUsed = 0;
    let bolsteredHpUsed = 0;

    let remainingCounts = resistedCounts;
    if (resistedDamage > 0) {
      const tempResult = absorbTempHpFromCounts(remainingCounts, tempHp);
      remainingCounts = tempResult.remaining;
      tempHpUsed = tempResult.tempUsed;
      tempHp = tempResult.tempRemaining;

      const bolsteredResult = absorbBolsteredFromCounts(remainingCounts, bolsteredHp);
      remainingCounts = bolsteredResult.remaining;
      bolsteredHpUsed = bolsteredResult.bolsteredUsed;
      bolsteredHp = bolsteredResult.bolsteredRemaining;
    }

    const damageToGrid = sumDamageCounts(remainingCounts);
    const hp = this.system?.hp;
    if (!hp?.grid || !Number.isFinite(hp.rows) || !Number.isFinite(hp.cols) || typeof hp.applyDamage !== "function") {
      return { ok: false, message: "HP grid is not available for this actor." };
    }

    if (remainingCounts.critical > 0) hp.applyDamage("critical", remainingCounts.critical, false);
    if (remainingCounts.lethal > 0) hp.applyDamage("lethal", remainingCounts.lethal, false);
    if (remainingCounts.blunt > 0) hp.applyDamage("blunt", remainingCounts.blunt, false);

    const totalCells = hp.rows * hp.cols;
    let regularCells = 0;
    for (const rowData of hp.grid) {
      for (const cellState of rowData) {
        if (cellState === 0) regularCells++;
      }
    }

    const newTempHpMax = totalCells - regularCells;
    const newTempHpValue = Math.min(tempHp, newTempHpMax);

    await this.update({
      "system.hp.grid": hp.grid.map(row => [...row]),
      "system.health.value": regularCells,
      "system.health.max": totalCells,
      "system.temporaryHp.value": newTempHpValue,
      "system.temporaryHp.max": newTempHpMax,
      "system.bolsteredHp": bolsteredHp
    });

    return {
      ok: true,
      value: regularCells,
      locationless: true,
      haltUsed: 0,
      netDamage: damageAmount,
      normalizedType,
      isHybrid: normalizedType === "hybrid",
      damageToGrid,
      isHard: false,
      useArmorCharge: false,
      isAP: false,
      ignoreHaltReduction: true,
      tempHpUsed,
      bolsteredHpUsed,
      breakOccurred: false,
      events: []
    };
  }

  async applyPeasantHeal(amount, healType) {
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, message: "Heal amount must be positive." };
    if (healType !== "temporary" && healType !== "greater") {
      return { ok: false, message: "Heal type must be temporary or greater." };
    }

    if (isSimplifiedHpActor(this)) {
      const maxHealth = getActorHealthMax(this);
      const currentHealthRaw = Number(this.system?.health?.value);
      const currentHealth = Number.isFinite(currentHealthRaw)
        ? Math.max(0, Math.min(currentHealthRaw, maxHealth))
        : maxHealth;

      const currentTempHp = Math.max(0, Number(this.system?.temporaryHp?.value) || 0);
      const tempHpMax = Math.max(0, maxHealth - currentHealth);
      const bolsteredCap = getActorBolsteredMax(this);
      let updates = {};

      if (healType === "temporary") {
        const canGrantTempHp = Math.max(0, tempHpMax - currentTempHp);
        const tempHpGranted = Math.min(amount, canGrantTempHp);
        updates["system.temporaryHp.value"] = currentTempHp + tempHpGranted;
        updates["system.temporaryHp.max"] = tempHpMax;
        updates["system.health.value"] = currentHealth;
        updates["system.health.max"] = maxHealth;
        await this.update(updates);
        return { ok: true, value: currentHealth };
      }

      let remaining = amount;
      const canGrantTempHp = Math.max(0, tempHpMax - currentTempHp);
      const tempHpGranted = Math.min(remaining, canGrantTempHp);
      remaining -= tempHpGranted;

      const missingHp = Math.max(0, maxHealth - currentHealth);
      const hpHealed = Math.min(remaining, missingHp);
      remaining -= hpHealed;
      const newHealth = Math.min(maxHealth, currentHealth + hpHealed);

      let newBolsteredHp = Math.max(0, Number(this.system?.bolsteredHp) || 0);
      if (remaining > 0) {
        const bolsteredGain = Math.floor(remaining / 2);
        newBolsteredHp = Math.min(bolsteredCap, newBolsteredHp + bolsteredGain);
      }

      const newTempHpMax = Math.max(0, maxHealth - newHealth);
      const newTempHpValue = Math.min(currentTempHp + tempHpGranted, newTempHpMax);

      updates["system.health.value"] = newHealth;
      updates["system.health.max"] = maxHealth;
      updates["system.temporaryHp.value"] = newTempHpValue;
      updates["system.temporaryHp.max"] = newTempHpMax;
      updates["system.bolsteredHp"] = newBolsteredHp;
      await this.update(updates);
      return { ok: true, value: newHealth };
    }

    const hpData = this.system?.hp;
    if (!hpData?.grid || !Number.isFinite(hpData.rows) || !Number.isFinite(hpData.cols)) {
      return { ok: false, message: "HP grid is not available for this actor." };
    }

    const hp = JSON.parse(JSON.stringify(hpData || { rows: 0, cols: 0, grid: [] }));
    const totalCells = hp.rows * hp.cols;
    let regularCells = 0;
    for (let row of hp.grid) for (let cell of row) if (cell === 0) regularCells++;

    const tempHpMax = totalCells - regularCells;
    const currentTempHp = this.system.temporaryHp?.value || 0;
    let updates = {};
    let remaining = amount;
    let tempHpGranted = 0;
    let bolsteredHpGenerated = 0;

    if (healType === "temporary") {
      const canGrantTempHp = Math.max(0, tempHpMax - currentTempHp);
      tempHpGranted = Math.min(remaining, canGrantTempHp);
      const newTempHpValue = currentTempHp + tempHpGranted;
      updates["system.temporaryHp.value"] = newTempHpValue;
      updates["system.temporaryHp.max"] = tempHpMax;
    } else if (healType === "greater") {
      const canGrantTempHp = Math.max(0, tempHpMax - currentTempHp);
      tempHpGranted = Math.min(remaining, canGrantTempHp);
      remaining -= tempHpGranted;

      for (let r = hp.rows - 1; r >= 0 && remaining > 0; r--) {
        for (let c = hp.cols - 1; c >= 0 && remaining > 0; c--) {
          if (hp.grid[r][c] > 0) {
            hp.grid[r][c] = 0;
            remaining--;
          }
        }
      }

      if (remaining > 0) bolsteredHpGenerated = Math.min(Math.floor(remaining / 2), hp.cols);

      regularCells = 0;
      for (let row of hp.grid) for (let cell of row) if (cell === 0) regularCells++;
      const newTempHpMax = totalCells - regularCells;
      const newTempHpValue = Math.min(currentTempHp + tempHpGranted, newTempHpMax);

      updates["system.hp.grid"] = hp.grid.map(row => [...row]);
      updates["system.health.value"] = regularCells;
      updates["system.health.max"] = totalCells;
      updates["system.temporaryHp.value"] = newTempHpValue;
      updates["system.temporaryHp.max"] = newTempHpMax;
      if (bolsteredHpGenerated > 0) updates["system.bolsteredHp"] = bolsteredHpGenerated;
    }

    await this.update(updates);
    return { ok: true, value: regularCells };
  }

  async applyPeasantHpValueCommand(raw) {
    const cmd = parseHpValueCommand(raw);
    if (!cmd) {
      return { ok: false, message: "Use +# or -# (optional: L, B, C, H for damage; G for greater heal)." };
    }

    if (cmd.sign === "-") {
      const suffix = cmd.suffix || "L";
      let dmgType = "lethal";
      let hard = false;
      if (suffix === "B") dmgType = "blunt";
      else if (suffix === "C") dmgType = "critical";
      else if (suffix === "H") { dmgType = "lethal"; hard = true; }
      else if (suffix !== "L") {
        return { ok: false, message: "Damage type must be L, B, C, or H." };
      }
      return this.applyPeasantDamage(cmd.amount, dmgType, hard);
    }

    if (cmd.suffix && cmd.suffix !== "G") {
      return { ok: false, message: "Heal modifier must be G for Greater Heal." };
    }
    const healType = cmd.suffix === "G" ? "greater" : "temporary";
    return this.applyPeasantHeal(cmd.amount, healType);
  }

  async applyPeasantCombatResourceCosts(combat, costModifiersByType = {}) {
    const resourceCosts = Array.isArray(combat?.resourceCosts) ? combat.resourceCosts : [];

    for (const cost of resourceCosts) {
      const baseCostValue = Number.parseInt(cost?.value, 10) || 0;
      if (!cost?.type || baseCostValue <= 0) continue;

      const costType = sanitizeCombatCostResourceType(cost.type);
      let remaining = Math.max(0, baseCostValue + (costModifiersByType[costType] || 0));
      if (remaining <= 0) continue;

      switch (costType) {
        case "Stamina": {
          const currentStamina = this.system?.stamina?.value || 0;
          if (currentStamina >= remaining) {
            await this.update({ "system.stamina.value": currentStamina - remaining });
          } else {
            if (currentStamina > 0) {
              await this.update({ "system.stamina.value": 0 });
              remaining -= currentStamina;
            }
            if (remaining > 0) {
              const overflow = await applyCombatStressDamageForActor(this, "physical", remaining);
              if (overflow > 0) {
                await applyCombatStressDamageForActor(this, "general", overflow);
              }
            }
          }
          break;
        }

        case "Attunement": {
          const currentAttunement = this.system?.attunement?.value || 0;
          if (currentAttunement >= remaining) {
            await this.update({ "system.attunement.value": currentAttunement - remaining });
          } else {
            if (currentAttunement > 0) {
              await this.update({ "system.attunement.value": 0 });
              remaining -= currentAttunement;
            }

            const currentCapacity = this.system?.capacity?.value || 0;
            if (currentCapacity >= remaining) {
              await this.update({ "system.capacity.value": currentCapacity - remaining });
              remaining = 0;
            } else {
              if (currentCapacity > 0) {
                await this.update({ "system.capacity.value": 0 });
                remaining -= currentCapacity;
              }

              if (remaining > 0) {
                const stressOverflow = await applyCombatStressDamageForActor(this, "mental", remaining);
                if (stressOverflow > 0) {
                  await applyCombatStressDamageForActor(this, "general", stressOverflow);
                }

                await this.applyPeasantResourceHpDamage(remaining, "blunt");
              }
            }
          }
          break;
        }

        case "HP": {
          const dmgType = cost?.damageType?.toLowerCase() || "blunt";
          await this.applyPeasantResourceHpDamage(remaining, dmgType);
          break;
        }

        case "Physical Stress": {
          const overflow = await applyCombatStressDamageForActor(this, "physical", remaining);
          if (overflow > 0) {
            await applyCombatStressDamageForActor(this, "general", overflow);
          }
          break;
        }

        case "Mental Stress": {
          const overflow = await applyCombatStressDamageForActor(this, "mental", remaining);
          if (overflow > 0) {
            await applyCombatStressDamageForActor(this, "general", overflow);
          }
          break;
        }
      }
    }

    return { ok: true };
  }

  async applyPeasantResourceHpDamage(amount, dmgType) {
    if (isSimplifiedHpActor(this)) {
      return this.applyPeasantDamage(amount, dmgType, false);
    }

    const hp = this.system?.hp;
    if (hp?.applyDamage) {
      hp.applyDamage(dmgType, amount, false);
      const totalCells = hp.rows * hp.cols;
      let regularCells = 0;
      for (const row of hp.grid) {
        for (const cell of row) {
          if (cell === 0) regularCells++;
        }
      }
      await this.update({
        "system.hp.grid": hp.grid.map((row) => [...row]),
        "system.health.value": regularCells,
        "system.health.max": totalCells
      });
    }

    return { ok: true };
  }

  async consumePeasantCombatUse(combatIndex) {
    const combats = JSON.parse(JSON.stringify(this.system?.notableCombats || []));
    if (!combats[combatIndex]) return { ok: false, changed: false };

    let changed = false;

    if (combats[combatIndex].sig) {
      const currentUses = Number.parseInt(combats[combatIndex].usesCurrent, 10) || 0;
      if (currentUses > 0) {
        combats[combatIndex].usesCurrent = Math.max(0, currentUses - 1);
        changed = true;
      }
    }

    const tagUsesMax = Number.parseInt(combats[combatIndex]?.tagUses?.max, 10) || 0;
    const tagUsesCurrent = Number.parseInt(combats[combatIndex]?.tagUses?.current, 10) || 0;
    if (tagUsesMax > 0 && tagUsesCurrent > 0) {
      combats[combatIndex].tagUses = combats[combatIndex].tagUses || { current: 0, max: tagUsesMax };
      combats[combatIndex].tagUses.current = Math.max(0, tagUsesCurrent - 1);
      changed = true;
    }

    if (!changed) return { ok: true, changed: false };

    await this.update({ "system.notableCombats": combats });
    return { ok: true, changed: true };
  }

  static createDefaultPeasantCombatEntry(entry = {}) {
    const existing = (entry && typeof entry === "object") ? entry : {};
    const defaults = {
      type: "standard",
      specialGrade: 0,
      class: 1,
      rank: "0",
      sig: false,
      name: "",
      tohit: null,
      accuracy: null,
      usesMax: 0,
      usesCurrent: 0,
      indent: 0,
      description: "",
      staminaCost: 0,
      attunementCost: 0,
      range: 0,
      rangeRate: [null, null, null, null],
      resourceCosts: [],
      speed: { type: "", splitSecondCurrent: 0, splitSecondMax: 0 },
      damage: { enabled: false, diceCount: 0, diceValue: 0, diceBonus: 0, flat: 0, type: "" },
      overkill: false,
      magnetism: { grade: 0 },
      heal: { enabled: false, diceCount: 0, diceValue: 0, diceBonus: 0, flat: 0, type: "" },
      manifest: { enabled: false, diceCount: 0, diceValue: 0, diceBonus: 0, flat: 0 },
      tagUses: { current: 0, max: 0 },
      sections: { current: 0, max: 0 },
      aoe: { value: 0, type: "" },
      customTags: [],
      customTag: { name: "", value: "" },
      targetingType: "",
      defense: createDefaultCombatDefense(),
      reach: 0,
      stability: false,
      strengthen: false,
      self: false,
      tagOrder: []
    };

    const merged = { ...defaults, ...existing };
    merged.resourceCosts = Array.isArray(existing.resourceCosts) ? existing.resourceCosts : [];
    merged.speed = { ...defaults.speed, ...(existing.speed || {}) };
    merged.damage = { ...defaults.damage, ...(existing.damage || {}) };
    merged.magnetism = normalizeCombatMagnetism(existing.magnetism);
    merged.heal = { ...defaults.heal, ...(existing.heal || {}) };
    merged.manifest = { ...defaults.manifest, ...(existing.manifest || {}) };
    merged.tagUses = { ...defaults.tagUses, ...(existing.tagUses || {}) };
    merged.sections = { ...defaults.sections, ...(existing.sections || {}) };
    merged.aoe = { ...defaults.aoe, ...(existing.aoe || {}) };
    merged.defense = normalizeCombatDefense(existing.defense);
    merged.targetingType = normalizeCombatTargetingType(merged.targetingType) || String(merged.targetingType ?? "");
    merged.tagOrder = Array.isArray(existing.tagOrder)
      ? existing.tagOrder.filter((tagType) => COMBAT_FULL_TAG_ORDER.includes(tagType))
      : [];
    merged.tohit = parseOptionalInteger(merged.tohit, { min: 1 });
    merged.accuracy = parseOptionalInteger(merged.accuracy, { allowSign: true });
    merged.rangeRate = normalizeRangeRateValue(merged.rangeRate);
    syncCombatCustomTags(merged);
    if (!merged.stability) merged.strengthen = false;
    return merged;
  }

  getPeasantNotableCombatsForUpdate() {
    return JSON.parse(JSON.stringify(Array.isArray(this.system?.notableCombats) ? this.system.notableCombats : []));
  }

  ensurePeasantNotableCombatAt(combats, index) {
    const numericIndex = Number.parseInt(index, 10);
    if (!Number.isFinite(numericIndex) || numericIndex < 0) return null;
    while (combats.length <= numericIndex) combats.push(PeasantActor.createDefaultPeasantCombatEntry());
    combats[numericIndex] = PeasantActor.createDefaultPeasantCombatEntry(combats[numericIndex]);
    return combats[numericIndex];
  }

  async setPeasantNotableCombats(combats, options = {}) {
    const list = Array.isArray(combats) ? JSON.parse(JSON.stringify(combats)) : [];
    await this.update({ "system.notableCombats": list }, options);
    return { ok: true, changed: true, combats: list };
  }

  async addPeasantNotableCombat(options = { render: false }) {
    const combats = this.getPeasantNotableCombatsForUpdate();
    combats.push(PeasantActor.createDefaultPeasantCombatEntry());
    return this.setPeasantNotableCombats(combats, options);
  }

  async removePeasantNotableCombat(index, options = { render: false }) {
    const numericIndex = Number.parseInt(index, 10);
    if (!Number.isFinite(numericIndex) || numericIndex < 0) return { ok: false, changed: false };
    const combats = this.getPeasantNotableCombatsForUpdate();
    if (numericIndex >= combats.length) return { ok: false, changed: false };
    combats.splice(numericIndex, 1);
    return this.setPeasantNotableCombats(combats, options);
  }

  async reorderPeasantNotableCombat(fromIndex, toIndex, options = { render: false }) {
    const from = Number.parseInt(fromIndex, 10);
    let to = Number.parseInt(toIndex, 10);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return { ok: false, changed: false };

    const combats = this.getPeasantNotableCombatsForUpdate();
    if (from < 0 || from >= combats.length) return { ok: false, changed: false };
    const [moved] = combats.splice(from, 1);
    if (from < to) to--;
    to = Math.max(0, Math.min(to, combats.length));
    combats.splice(to, 0, moved);
    return this.setPeasantNotableCombats(combats, options);
  }

  async updatePeasantNotableCombat(index, patch, options = { render: false }) {
    const combats = this.getPeasantNotableCombatsForUpdate();
    const combat = this.ensurePeasantNotableCombatAt(combats, index);
    if (!combat) return { ok: false, changed: false };
    Object.assign(combat, patch && typeof patch === "object" ? patch : {});
    return this.setPeasantNotableCombats(combats, options);
  }

  async setPeasantNotableCombatType(index, rawType, { clearStandardFields = false, render = false } = {}) {
    const type = String(rawType ?? "standard").trim() || "standard";
    const combats = this.getPeasantNotableCombatsForUpdate();
    const combat = this.ensurePeasantNotableCombatAt(combats, index);
    if (!combat) return { ok: false, changed: false };

    if (type === "standard") {
      combat.type = "standard";
      combat.class = combat.class || 1;
      combat.rank = combat.rank !== undefined ? String(combat.rank) : "0";
      combat.sig = combat.sig || false;
      combat.usesMax = combat.usesMax || 0;
      combat.usesCurrent = combat.usesCurrent || 0;
    } else {
      combat.type = type;
      if (clearStandardFields) {
        delete combat.class;
        delete combat.rank;
        delete combat.sig;
        delete combat.usesMax;
        delete combat.usesCurrent;
      }
    }

    return this.setPeasantNotableCombats(combats, { render });
  }

  async changePeasantNotableCombatIndent(index, delta, options = { render: false }) {
    const combats = this.getPeasantNotableCombatsForUpdate();
    const combat = this.ensurePeasantNotableCombatAt(combats, index);
    if (!combat) return { ok: false, changed: false };
    combat.indent = Math.max(0, (Number.parseInt(combat.indent, 10) || 0) + (Number.parseInt(delta, 10) || 0));
    return this.setPeasantNotableCombats(combats, options);
  }

  async setPeasantNotableCombatSig(index, enabled, options = { render: false }) {
    return this.updatePeasantNotableCombat(index, { sig: !!enabled }, options);
  }

  async setPeasantNotableCombatMainFields(index, fields = {}, options = { render: false }) {
    const patch = {};
    if ("class" in fields) patch.class = Number.parseInt(fields.class, 10) || 1;
    if ("rank" in fields) {
      const rankRaw = String(fields.rank ?? "").trim();
      patch.rank = rankRaw.toLowerCase() === "u" ? rankRaw : (Number.parseInt(rankRaw, 10) || 0);
    }
    if ("name" in fields) patch.name = String(fields.name ?? "");
    if ("tohit" in fields) patch.tohit = parseOptionalInteger(fields.tohit, { min: 1 });
    if ("accuracy" in fields) patch.accuracy = parseOptionalInteger(fields.accuracy, { allowSign: true });
    if ("specialGrade" in fields) patch.specialGrade = Math.max(0, Number.parseInt(fields.specialGrade, 10) || 0);
    return this.updatePeasantNotableCombat(index, patch, options);
  }

  async setPeasantNotableCombatUsesMax(index, rawValue, options = { render: false }) {
    return this.updatePeasantNotableCombat(index, { usesMax: Number.parseInt(rawValue, 10) || 0 }, options);
  }

  async setPeasantNotableCombatUsesCurrent(index, rawValue, options = { render: false }) {
    const combat = this.getPeasantNotableCombatsForUpdate()[Number.parseInt(index, 10)];
    const max = Number.parseInt(combat?.usesMax, 10) || 0;
    const value = Math.min(Number.parseInt(rawValue, 10) || 0, Math.max(0, max));
    return this.updatePeasantNotableCombat(index, { usesCurrent: value }, options);
  }

  async setPeasantNotableCombatSectionsCurrent(index, rawValue, options = { render: false }) {
    const combats = this.getPeasantNotableCombatsForUpdate();
    const combat = this.ensurePeasantNotableCombatAt(combats, index);
    if (!combat) return { ok: false, changed: false };
    const max = Number.parseInt(combat.sections?.max, 10) || 0;
    combat.sections = combat.sections || { current: 0, max };
    combat.sections.current = Math.max(0, Math.min(Number.parseInt(rawValue, 10) || 0, max));
    return this.setPeasantNotableCombats(combats, options);
  }

  async setPeasantNotableCombatSplitSecondCurrent(index, rawValue, options = { render: false }) {
    const combats = this.getPeasantNotableCombatsForUpdate();
    const combat = this.ensurePeasantNotableCombatAt(combats, index);
    if (!combat) return { ok: false, changed: false };
    const max = Number.parseInt(combat.speed?.splitSecondMax, 10) || 0;
    combat.speed = combat.speed || { type: "", splitSecondCurrent: 0, splitSecondMax: max };
    combat.speed.splitSecondCurrent = Math.max(0, Math.min(Number.parseInt(rawValue, 10) || 0, max));
    return this.setPeasantNotableCombats(combats, options);
  }

  async setPeasantNotableCombatTagUsesCurrent(index, rawValue, options = { render: false }) {
    const combats = this.getPeasantNotableCombatsForUpdate();
    const numericIndex = Number.parseInt(index, 10);
    if (!Number.isFinite(numericIndex) || numericIndex < 0 || numericIndex >= combats.length || !combats[numericIndex].tagUses) {
      return { ok: false, changed: false };
    }
    combats[numericIndex].tagUses.current = Math.max(0, Number.parseInt(rawValue, 10) || 0);
    return this.setPeasantNotableCombats(combats, options);
  }

  async reorderPeasantNotableCombatCustomTag(index, fromCustomIndex, toCustomIndex, { insertAfter = false, render = false } = {}) {
    const combats = this.getPeasantNotableCombatsForUpdate();
    const numericIndex = Number.parseInt(index, 10);
    if (!Number.isFinite(numericIndex) || numericIndex < 0 || numericIndex >= combats.length) return { ok: false, changed: false };
    const combat = combats[numericIndex] || {};
    const from = Number.parseInt(fromCustomIndex, 10);
    let to = Number.parseInt(toCustomIndex, 10);
    if (!combat || !Number.isFinite(from) || !Number.isFinite(to)) return { ok: false, changed: false };

    const customTags = getCombatCustomTags(combat);
    if (customTags.length <= 1 || from < 0 || from >= customTags.length || to < 0 || to >= customTags.length) {
      return { ok: false, changed: false };
    }

    if (insertAfter) to += 1;
    if (from < to) to -= 1;
    to = Math.max(0, Math.min(customTags.length - 1, to));

    const [moved] = customTags.splice(from, 1);
    customTags.splice(to, 0, moved);
    combat.customTags = customTags;
    syncCombatCustomTags(combat);
    combats[numericIndex] = combat;
    return this.setPeasantNotableCombats(combats, { render });
  }

  async reorderPeasantNotableCombatTag(index, draggedType, targetType, { insertAfter = false, render = false } = {}) {
    const combats = this.getPeasantNotableCombatsForUpdate();
    const numericIndex = Number.parseInt(index, 10);
    if (!Number.isFinite(numericIndex) || numericIndex < 0 || numericIndex >= combats.length) return { ok: false, changed: false };
    const combat = combats[numericIndex] || {};
    const dragged = String(draggedType ?? "").trim();
    const target = String(targetType ?? "").trim();
    if (!combat || !dragged || !target || dragged === target) return { ok: false, changed: false };

    const fullDefaultOrder = [...COMBAT_FULL_TAG_ORDER];
    const currentOrder = (Array.isArray(combat.tagOrder) && combat.tagOrder.length > 0)
      ? [...combat.tagOrder]
      : [...fullDefaultOrder];

    for (const tagType of fullDefaultOrder) {
      if (!currentOrder.includes(tagType)) currentOrder.push(tagType);
    }

    const draggedIndex = currentOrder.indexOf(dragged);
    if (draggedIndex > -1) currentOrder.splice(draggedIndex, 1);

    let targetIndex = currentOrder.indexOf(target);
    if (targetIndex === -1) targetIndex = currentOrder.length;
    if (insertAfter) targetIndex += 1;

    currentOrder.splice(targetIndex, 0, dragged);
    combat.tagOrder = currentOrder;
    combats[numericIndex] = combat;
    return this.setPeasantNotableCombats(combats, { render });
  }

  async removePeasantNotableCombatTag(index, rawTagType, { customIndex = null, render = false } = {}) {
    const combats = this.getPeasantNotableCombatsForUpdate();
    const numericIndex = Number.parseInt(index, 10);
    if (!Number.isFinite(numericIndex) || numericIndex < 0 || numericIndex >= combats.length) return { ok: false, changed: false };

    const combat = combats[numericIndex] || {};
    const tagType = String(rawTagType ?? "").trim();
    switch (tagType) {
      case "description":
        combat.description = "";
        break;
      case "resourceCosts":
        combat.resourceCosts = [];
        break;
      case "speed":
        combat.speed = { type: "", splitSecondCurrent: 0, splitSecondMax: 0 };
        break;
      case "staminaCost":
        combat.staminaCost = 0;
        break;
      case "attunementCost":
        combat.attunementCost = 0;
        break;
      case "range":
        combat.range = 0;
        break;
      case "rangeRate":
        combat.rangeRate = [null, null, null, null];
        break;
      case "damage":
        combat.damage = { enabled: false, diceCount: 0, diceValue: 0, diceBonus: 0, flat: 0, type: "" };
        break;
      case "overkill":
        combat.overkill = false;
        break;
      case "magnetism":
        combat.magnetism = { grade: 0 };
        break;
      case "heal":
        combat.heal = { enabled: false, diceCount: 0, diceValue: 0, diceBonus: 0, flat: 0, type: "" };
        break;
      case "manifest":
        combat.manifest = { enabled: false, diceCount: 0, diceValue: 0, diceBonus: 0, flat: 0 };
        break;
      case "tagUses":
        combat.tagUses = { current: 0, max: 0 };
        break;
      case "sections":
        combat.sections = { current: 0, max: 0 };
        break;
      case "aoe":
        combat.aoe = { value: 0, type: "" };
        break;
      case "targetingType":
        combat.targetingType = "";
        combat.aoe = { value: 0, type: "" };
        break;
      case "defense":
        combat.defense = createDefaultCombatDefense();
        break;
      case "reach":
        combat.reach = 0;
        break;
      case "stability":
        combat.stability = false;
        combat.strengthen = false;
        break;
      case "strengthen":
        combat.strengthen = false;
        break;
      case "custom": {
        const customTags = getCombatCustomTags(combat);
        const numericCustomIndex = Number.parseInt(customIndex, 10);
        if (Number.isFinite(numericCustomIndex) && numericCustomIndex >= 0 && numericCustomIndex < customTags.length) {
          customTags.splice(numericCustomIndex, 1);
        } else {
          customTags.length = 0;
        }
        combat.customTags = customTags;
        syncCombatCustomTags(combat);
        break;
      }
      case "self":
        combat.self = false;
        break;
      default:
        return { ok: false, changed: false };
    }

    combats[numericIndex] = combat;
    return this.setPeasantNotableCombats(combats, { render });
  }

  async setPeasantNotableCombatTag(index, rawTagType, data = {}, { mode = "add", customIndex = null, render = false } = {}) {
    const combats = this.getPeasantNotableCombatsForUpdate();
    const combat = this.ensurePeasantNotableCombatAt(combats, index);
    if (!combat) return { ok: false, changed: false };

    const tagType = String(rawTagType ?? "").trim();
    switch (tagType) {
      case "resourceCosts":
        combat.resourceCosts = Array.isArray(data.resourceCosts) ? data.resourceCosts : [];
        break;
      case "speed":
        combat.speed = {
          type: String(data.speed?.type ?? ""),
          splitSecondCurrent: Number.parseInt(data.speed?.splitSecondCurrent, 10) || 0,
          splitSecondMax: Number.parseInt(data.speed?.splitSecondMax, 10) || 0
        };
        break;
      case "staminaCost":
        combat.staminaCost = Number.parseInt(data.staminaCost, 10) || 0;
        break;
      case "attunementCost":
        combat.attunementCost = Number.parseInt(data.attunementCost, 10) || 0;
        break;
      case "range":
        combat.range = Number.parseInt(data.range, 10) || 0;
        break;
      case "rangeRate":
        combat.rangeRate = normalizeRangeRateValue(data.rangeRate);
        break;
      case "damage":
        combat.damage = {
          enabled: true,
          diceCount: Number.parseInt(data.damage?.diceCount, 10) || 0,
          diceValue: Number.parseInt(data.damage?.diceValue, 10) || 0,
          diceBonus: Number.parseInt(data.damage?.diceBonus, 10) || 0,
          flat: Number.parseInt(data.damage?.flat, 10) || 0,
          type: String(data.damage?.type ?? "")
        };
        break;
      case "overkill":
        combat.overkill = true;
        break;
      case "magnetism":
        combat.magnetism = normalizeCombatMagnetism(data.magnetism);
        break;
      case "heal":
        combat.heal = {
          enabled: true,
          diceCount: Number.parseInt(data.heal?.diceCount, 10) || 0,
          diceValue: Number.parseInt(data.heal?.diceValue, 10) || 0,
          diceBonus: Number.parseInt(data.heal?.diceBonus, 10) || 0,
          flat: Number.parseInt(data.heal?.flat, 10) || 0,
          type: String(data.heal?.type ?? "")
        };
        break;
      case "manifest":
        combat.manifest = {
          enabled: true,
          diceCount: Number.parseInt(data.manifest?.diceCount, 10) || 0,
          diceValue: Number.parseInt(data.manifest?.diceValue, 10) || 0,
          diceBonus: Number.parseInt(data.manifest?.diceBonus, 10) || 0,
          flat: Number.parseInt(data.manifest?.flat, 10) || 0
        };
        break;
      case "tagUses":
        combat.tagUses = {
          current: Number.parseInt(data.tagUses?.current, 10) || 0,
          max: Number.parseInt(data.tagUses?.max, 10) || 0
        };
        break;
      case "sections":
        combat.sections = {
          current: Number.parseInt(data.sections?.current, 10) || 0,
          max: Number.parseInt(data.sections?.max, 10) || 0
        };
        break;
      case "aoe":
        combat.aoe = {
          value: Number.parseInt(data.aoe?.value, 10) || 0,
          type: String(data.aoe?.type ?? "")
        };
        break;
      case "targetingType":
        combat.targetingType = normalizeCombatTargetingType(data.targetingType) || String(data.targetingType ?? "");
        combat.aoe = { value: 0, type: "" };
        break;
      case "defense":
        combat.defense = normalizeCombatDefense(data.defense);
        break;
      case "reach":
        combat.reach = Number.parseInt(data.reach, 10) || 0;
        break;
      case "stability":
        combat.stability = true;
        break;
      case "strengthen":
        if (!combat.stability) return { ok: false, changed: false };
        combat.strengthen = true;
        break;
      case "custom": {
        const name = String(data.name ?? "").trim();
        if (!name) return { ok: false, changed: false };
        const value = String(data.value ?? "").trim();
        const customTags = getCombatCustomTags(combat);
        const numericCustomIndex = Number.parseInt(customIndex, 10);
        if (mode === "edit" && Number.isFinite(numericCustomIndex) && numericCustomIndex >= 0 && numericCustomIndex < customTags.length) {
          customTags[numericCustomIndex] = { name, value };
        } else {
          customTags.push({ name, value });
        }
        combat.customTags = customTags;
        syncCombatCustomTags(combat);
        break;
      }
      case "self":
        combat.self = true;
        break;
      default:
        return { ok: false, changed: false };
    }

    if (Array.isArray(combat.tagOrder) && combat.tagOrder.length > 0 && !combat.tagOrder.includes(tagType)) {
      combat.tagOrder.push(tagType);
    }

    return this.setPeasantNotableCombats(combats, { render });
  }

  async setPeasantNotableCombatDescription(index, description, options = {}) {
    return this.updatePeasantNotableCombat(index, { description: String(description ?? "") }, options);
  }

  getPeasantResourceName(rawName) {
    const name = String(rawName ?? "").trim();
    return PeasantActor.RESOURCE_NAMES.includes(name) ? name : "";
  }

  async setPeasantResourceMax(rawName, rawMax, { fillOnlyWhenEmpty = false } = {}) {
    const resourceName = this.getPeasantResourceName(rawName);
    if (!resourceName) return { ok: false, message: "Unknown resource." };

    const max = Math.max(0, Number.parseInt(rawMax, 10) || 0);
    const currentValue = Math.max(0, Number(this.system?.[resourceName]?.value) || 0);
    if (fillOnlyWhenEmpty && currentValue > 0) return { ok: true, changed: false, value: currentValue, max };

    const nextValue = currentValue <= 0 ? max : Math.min(currentValue, max);
    await this.update({
      [`system.${resourceName}.value`]: nextValue,
      [`system.${resourceName}.max`]: max
    });
    return { ok: true, changed: true, value: nextValue, max };
  }

  async setPeasantResourceValue(rawName, rawValue) {
    const resourceName = this.getPeasantResourceName(rawName);
    if (!resourceName) return { ok: false, message: "Unknown resource." };

    const max = Math.max(0, Number(this.system?.[resourceName]?.max) || 0);
    const value = Math.max(0, Math.min(Number.parseInt(rawValue, 10) || 0, max));
    await this.update({ [`system.${resourceName}.value`]: value });
    return { ok: true, changed: true, value, max };
  }

  async refreshPeasantResource(rawName) {
    const resourceName = this.getPeasantResourceName(rawName);
    if (!resourceName) return { ok: false, message: "Unknown resource." };

    const max = Math.max(0, Number(this.system?.[resourceName]?.max) || 0);
    await this.update({ [`system.${resourceName}.value`]: max });
    return { ok: true, changed: true, value: max, max };
  }

  async setPeasantBolsteredHp(rawValue) {
    const max = getActorBolsteredMax(this);
    const value = Math.max(0, Math.min(Number.parseInt(rawValue, 10) || 0, max));
    await this.update({ "system.bolsteredHp": value });
    return { ok: true, changed: true, value, max };
  }

  async setPeasantTemporaryHpValue(rawValue, { expandMax = false } = {}) {
    const requested = Math.max(0, Number.parseInt(rawValue, 10) || 0);
    const currentMax = Math.max(0, Number(this.system?.temporaryHp?.max) || 0);
    const max = expandMax ? Math.max(currentMax, requested) : currentMax;
    const value = Math.min(requested, max);
    const update = { "system.temporaryHp.value": value };
    if (expandMax) update["system.temporaryHp.max"] = max;
    await this.update(update);
    return { ok: true, changed: true, value, max };
  }

  async setPeasantSimplifiedHealthMax(rawMax) {
    if (!isSimplifiedHpActor(this)) return { ok: false, message: "Actor does not use simplified HP." };

    const max = Math.max(1, Number.parseInt(rawMax, 10) || 1);
    const currentValue = Math.max(0, Number(this.system?.health?.value) || 0);
    const value = Math.min(currentValue, max);
    const currentTemp = Math.max(0, Number(this.system?.temporaryHp?.value) || 0);
    const tempMax = Math.max(0, max - value);
    const bolstered = Math.max(0, Number(this.system?.bolsteredHp) || 0);

    await this.update({
      "system.health.max": max,
      "system.health.value": value,
      "system.temporaryHp.max": tempMax,
      "system.temporaryHp.value": Math.min(currentTemp, tempMax),
      "system.bolsteredHp": Math.min(bolstered, max)
    });
    return { ok: true, changed: true, value, max, tempMax };
  }

  async setPeasantSimplifiedHealthValue(rawValue) {
    if (!isSimplifiedHpActor(this)) return { ok: false, message: "Actor does not use simplified HP." };

    const max = getActorHealthMax(this);
    const value = Math.max(0, Math.min(Number.parseInt(rawValue, 10) || 0, max));
    const currentTemp = Math.max(0, Number(this.system?.temporaryHp?.value) || 0);
    const tempMax = Math.max(0, max - value);
    await this.update({
      "system.health.value": value,
      "system.temporaryHp.max": tempMax,
      "system.temporaryHp.value": Math.min(currentTemp, tempMax)
    });
    return { ok: true, changed: true, value, max, tempMax };
  }

  async updatePeasantHpGrid(grid, rows, cols) {
    if (isSimplifiedHpActor(this)) return { ok: false, message: "Actor uses simplified HP." };

    const safeRows = Math.max(1, Number(rows) || 1);
    const safeCols = Math.max(1, Number(cols) || 1);
    const safeGrid = Array.from({ length: safeRows }, (_, rowIndex) => {
      const row = Array.isArray(grid?.[rowIndex]) ? grid[rowIndex] : [];
      return Array.from({ length: safeCols }, (_, colIndex) => {
        const value = Number(row[colIndex]) || 0;
        return Math.max(0, Math.min(3, value));
      });
    });

    const totalCells = safeRows * safeCols;
    let regularCells = 0;
    for (const row of safeGrid) {
      for (const cell of row) {
        if (cell === 0) regularCells++;
      }
    }

    const tempMax = Math.max(0, totalCells - regularCells);
    const currentTemp = Math.max(0, Number(this.system?.temporaryHp?.value) || 0);

    await this.update({
      "system.hp.rows": safeRows,
      "system.hp.cols": safeCols,
      "system.hp.grid": safeGrid.map(row => [...row]),
      "system.health.value": regularCells,
      "system.health.max": totalCells,
      "system.temporaryHp.value": Math.min(currentTemp, tempMax),
      "system.temporaryHp.max": tempMax
    });

    return { ok: true, changed: true, rows: safeRows, cols: safeCols, grid: safeGrid, value: regularCells, max: totalCells, tempMax };
  }

  async resizePeasantHpGrid(rowDelta = 0, colDelta = 0) {
    const hp = this.system?.hp ?? {};
    const currentRows = Math.max(1, Number(hp.rows) || 1);
    const currentCols = Math.max(1, Number(hp.cols) || 1);
    const rows = Math.max(1, currentRows + (Number(rowDelta) || 0));
    const cols = Math.max(1, currentCols + (Number(colDelta) || 0));
    const sourceGrid = Array.isArray(hp.grid) ? hp.grid : [];
    const grid = Array.from({ length: rows }, (_, rowIndex) => {
      const row = Array.isArray(sourceGrid[rowIndex]) ? sourceGrid[rowIndex] : [];
      return Array.from({ length: cols }, (_, colIndex) => Number(row[colIndex]) || 0);
    });

    return this.updatePeasantHpGrid(grid, rows, cols);
  }

  async setPeasantHpGridCell(row, col, rawValue) {
    const hp = this.system?.hp ?? {};
    const rows = Math.max(1, Number(hp.rows) || 1);
    const cols = Math.max(1, Number(hp.cols) || 1);
    const numericRow = Number.parseInt(row, 10);
    const numericCol = Number.parseInt(col, 10);
    if (!Number.isFinite(numericRow) || !Number.isFinite(numericCol)) return { ok: false, changed: false };
    if (numericRow < 0 || numericCol < 0 || numericRow >= rows || numericCol >= cols) return { ok: false, changed: false };

    const sourceGrid = Array.isArray(hp.grid) ? hp.grid : [];
    const grid = Array.from({ length: rows }, (_, rowIndex) => {
      const sourceRow = Array.isArray(sourceGrid[rowIndex]) ? sourceGrid[rowIndex] : [];
      return Array.from({ length: cols }, (_, colIndex) => Number(sourceRow[colIndex]) || 0);
    });
    grid[numericRow][numericCol] = Math.max(0, Math.min(3, Number(rawValue) || 0));

    return this.updatePeasantHpGrid(grid, rows, cols);
  }

  async cyclePeasantHpGridCell(row, col) {
    const numericRow = Number.parseInt(row, 10);
    const numericCol = Number.parseInt(col, 10);
    if (!Number.isFinite(numericRow) || !Number.isFinite(numericCol)) return { ok: false, changed: false };

    const current = Number(this.system?.hp?.grid?.[numericRow]?.[numericCol]) || 0;
    return this.setPeasantHpGridCell(numericRow, numericCol, (current + 1) % 4);
  }

  getPeasantStressType(rawType) {
    const type = String(rawType ?? "").trim().toLowerCase();
    return PeasantActor.STRESS_TYPES.includes(type) ? type : "physical";
  }

  async setPeasantStressGridSize(rawType, rawCount = 0) {
    const type = this.getPeasantStressType(rawType);
    const countField = `${type}StressCount`;
    const currentCount = Math.max(0, Number(this.system?.[countField]) || 0);
    const count = Math.max(0, Number.parseInt(rawCount, 10) || 0);
    const updateData = { [`system.${countField}`]: count };

    for (let index = currentCount; index < count; index++) {
      if (this.system?.[`${type}${index}`] === undefined) {
        updateData[`system.${type}${index}`] = 0;
      }
    }

    await this.update(updateData);
    return { ok: true, changed: true, type, count };
  }

  async resizePeasantStressGrid(rawType, delta = 0) {
    const type = this.getPeasantStressType(rawType);
    const countField = `${type}StressCount`;
    const currentCount = Math.max(0, Number(this.system?.[countField]) || 0);
    return this.setPeasantStressGridSize(type, currentCount + (Number(delta) || 0));
  }

  async setPeasantStressCell(rawType, rawIndex, rawValue) {
    const type = this.getPeasantStressType(rawType);
    const index = Number.parseInt(rawIndex, 10);
    const count = Math.max(0, Number(this.system?.[`${type}StressCount`]) || 0);
    if (!Number.isFinite(index) || index < 0 || index >= count) return { ok: false, changed: false };

    const value = Math.max(0, Math.min(3, Number(rawValue) || 0));
    await this.update({ [`system.${type}${index}`]: value });
    return { ok: true, changed: true, type, index, value };
  }

  async cyclePeasantStressCell(rawType, rawIndex) {
    const type = this.getPeasantStressType(rawType);
    const index = Number.parseInt(rawIndex, 10);
    if (!Number.isFinite(index)) return { ok: false, changed: false };

    const current = Number(this.system?.[`${type}${index}`]) || 0;
    return this.setPeasantStressCell(type, index, (current + 1) % 4);
  }

  async refreshPeasantStressTrack(rawType) {
    const type = this.getPeasantStressType(rawType);
    const count = Math.max(0, Number(this.system?.[`${type}StressCount`]) || 0);
    const updateData = {};
    for (let index = 0; index < count; index++) updateData[`system.${type}${index}`] = 0;
    if (Object.keys(updateData).length) await this.update(updateData);
    return { ok: true, changed: Object.keys(updateData).length > 0, type, count };
  }

  async applyPeasantStressDamage(rawType, amount = 1) {
    const type = this.getPeasantStressType(rawType);
    const stressAmount = Math.max(0, Number(amount) || 0);
    if (stressAmount <= 0) return { ok: false, changed: false, type, overflow: 0 };

    const overflow = await applyCombatStressDamageForActor(this, type, stressAmount);
    return { ok: overflow <= 0, changed: overflow < stressAmount, type, overflow };
  }

  async applyPeasantStressHeal(rawType, amount = 1) {
    const type = this.getPeasantStressType(rawType);
    let remaining = Math.max(0, Number(amount) || 0);
    if (remaining <= 0) return { ok: false, changed: false, type };

    const count = Math.max(0, Number(this.system?.[`${type}StressCount`]) || 0);
    const states = Array.from({ length: count }, (_, index) => {
      const current = Number(this.system?.[`${type}${index}`]) || 0;
      return Math.max(0, Math.min(3, current));
    });

    for (const target of [3, 2, 1]) {
      for (let index = states.length - 1; index >= 0 && remaining > 0; index--) {
        if (states[index] !== target) continue;
        states[index] = target - 1;
        remaining--;
      }
    }

    const updates = {};
    states.forEach((value, index) => {
      updates[`system.${type}${index}`] = value;
    });
    if (Object.keys(updates).length) await this.update(updates);
    return { ok: true, changed: Object.keys(updates).length > 0, type, remaining };
  }

  addPeasantResourceRefreshUpdates(updateData, resourceNames) {
    for (const resourceName of resourceNames) {
      const maxValue = Math.max(0, Number(this.system?.[resourceName]?.max) || 0);
      updateData[`system.${resourceName}.value`] = maxValue;
    }
    return updateData;
  }

  addPeasantStressClearUpdates(updateData, stressTypes) {
    for (const stressType of stressTypes) {
      const count = Math.max(0, Number(this.system?.[`${stressType}StressCount`]) || 0);
      for (let index = 0; index < count; index++) {
        updateData[`system.${stressType}${index}`] = 0;
      }
    }
    return updateData;
  }

  addPeasantStressRecoveryUpdates(updateData, stressType, amount) {
    let remaining = Math.max(0, Number(amount) || 0);
    const count = Math.max(0, Number(this.system?.[`${stressType}StressCount`]) || 0);
    const state = Array.from({ length: count }, (_, index) => {
      const field = `${stressType}${index}`;
      const current = Number(updateData[`system.${field}`] ?? this.system?.[field]) || 0;
      return { field, current: Math.max(0, Math.min(3, current)) };
    });

    for (let value = 3; value >= 1 && remaining > 0; value--) {
      for (let index = state.length - 1; index >= 0 && remaining > 0; index--) {
        const cell = state[index];
        while (cell.current >= value && cell.current > 0 && remaining > 0) {
          cell.current -= 1;
          updateData[`system.${cell.field}`] = cell.current;
          remaining -= 1;
        }
      }
    }

    return updateData;
  }

  countPeasantRegularHpCells(grid) {
    let regularCells = 0;
    for (const row of grid) {
      if (!Array.isArray(row)) continue;
      for (const cell of row) if ((Number(cell) || 0) === 0) regularCells++;
    }
    return regularCells;
  }

  addPeasantLongRestHpRecoveryUpdates(updateData) {
    if (isSimplifiedHpActor(this)) {
      const maxHealth = Math.max(0, Number(this.system?.health?.max) || getActorHealthMax(this) || 0);
      const currentHealth = Math.max(0, Math.min(Number(this.system?.health?.value) || 0, maxHealth));
      const missingHealth = Math.max(0, maxHealth - currentHealth);
      const healed = Math.min(2, missingHealth);
      const nextHealth = currentHealth + healed;
      const tempMax = Math.max(0, maxHealth - nextHealth);

      updateData["system.health.max"] = maxHealth;
      updateData["system.health.value"] = nextHealth;
      updateData["system.temporaryHp.max"] = tempMax;
      updateData["system.temporaryHp.value"] = tempMax;
      return updateData;
    }

    const hp = this.system?.hp;
    const rows = Math.max(0, Number(hp?.rows) || 0);
    const cols = Math.max(0, Number(hp?.cols) || 0);
    const sourceGrid = Array.isArray(hp?.grid) ? hp.grid : [];
    const grid = Array.from({ length: rows }, (_, rowIndex) => {
      const row = Array.isArray(sourceGrid[rowIndex]) ? sourceGrid[rowIndex] : [];
      return Array.from({ length: cols }, (_, colIndex) => Math.max(0, Math.min(3, Number(row[colIndex]) || 0)));
    });

    const healCells = (targetValue, amount) => {
      let remaining = amount;
      for (let rowIndex = rows - 1; rowIndex >= 0 && remaining > 0; rowIndex--) {
        for (let colIndex = cols - 1; colIndex >= 0 && remaining > 0; colIndex--) {
          if (grid[rowIndex][colIndex] !== targetValue) continue;
          grid[rowIndex][colIndex] = 0;
          remaining -= 1;
        }
      }
      return amount - remaining;
    };

    const hasBlunt = grid.some(row => row.some(cell => cell === 1));
    const hasLethal = grid.some(row => row.some(cell => cell === 2));
    if (hasBlunt) healCells(1, 2);
    else if (hasLethal) healCells(2, 1);

    const totalCells = rows * cols;
    const regularCells = this.countPeasantRegularHpCells(grid);
    const tempMax = Math.max(0, totalCells - regularCells);

    updateData["system.hp.grid"] = grid.map(row => [...row]);
    updateData["system.health.value"] = regularCells;
    updateData["system.health.max"] = totalCells;
    updateData["system.temporaryHp.max"] = tempMax;
    updateData["system.temporaryHp.value"] = tempMax;
    return updateData;
  }

  async performPeasantShortRest() {
    const updateData = {};
    this.addPeasantResourceRefreshUpdates(updateData, ["stamina", "attunement"]);
    this.addPeasantStressClearUpdates(updateData, ["physical", "mental"]);

    await this.update(updateData);
    return { ok: true, changed: true };
  }

  async performPeasantLongRest() {
    const updateData = {};
    this.addPeasantResourceRefreshUpdates(updateData, ["stamina", "attunement", "capacity"]);
    this.addPeasantStressClearUpdates(updateData, ["physical", "mental"]);
    this.addPeasantLongRestHpRecoveryUpdates(updateData);
    this.addPeasantStressRecoveryUpdates(updateData, "general", 3);

    await this.update(updateData);
    return { ok: true, changed: true };
  }

  async refreshPeasantResourcesAndResetTracks() {
    const updateData = {};

    this.addPeasantResourceRefreshUpdates(updateData, ["stamina", "attunement", "capacity"]);
    this.addPeasantStressClearUpdates(updateData, ["physical", "mental", "general"]);

    updateData["system.conditions.wounded"] = false;
    for (const key of ["head", "rightArm", "leftArm", "rightLeg", "leftLeg", "torso", "arms", "legs"]) {
      updateData[`system.conditions.${key}`] = "";
    }

    if (isSimplifiedHpActor(this)) {
      const maxHp = Math.max(0, Number(this.system?.health?.max) || getActorHealthMax(this) || 0);
      updateData["system.health.max"] = maxHp;
      updateData["system.health.value"] = maxHp;
    } else {
      const rows = Math.max(0, Number(this.system?.hp?.rows) || 0);
      const cols = Math.max(0, Number(this.system?.hp?.cols) || 0);
      const totalCells = rows * cols;
      const cleanGrid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
      updateData["system.hp.grid"] = cleanGrid;
      updateData["system.health.value"] = totalCells;
      updateData["system.health.max"] = totalCells;
    }

    updateData["system.temporaryHp.value"] = 0;
    updateData["system.temporaryHp.max"] = 0;

    await this.update(updateData);
    return { ok: true, changed: true };
  }

  getPeasantConditionKey(rawKey) {
    const key = String(rawKey ?? "").trim();
    return PeasantActor.CONDITION_KEYS.includes(key) ? key : "";
  }

  hasPeasantConditions() {
    const conditions = this.system?.conditions || {};
    return PeasantActor.CONDITION_KEYS.some((key) => {
      if (key === "wounded") return !!conditions.wounded;
      return !!conditions[key];
    });
  }

  async clearPeasantCondition(rawKey) {
    const key = this.getPeasantConditionKey(rawKey);
    if (!key) return { ok: false, changed: false };

    const update = key === "wounded"
      ? { "system.conditions.wounded": false }
      : { [`system.conditions.${key}`]: "" };
    await this.update(update);
    return { ok: true, changed: true, hasConditions: this.hasPeasantConditions() };
  }

  async addPeasantWound(rawWoundType) {
    const woundType = String(rawWoundType ?? "").trim();
    if (woundType === "wounded") {
      await this.update({ "system.conditions.wounded": true });
      return { ok: true, changed: true, hasConditions: true };
    }

    const [rawStatus, rawLocation] = woundType.split(":");
    const status = String(rawStatus ?? "").trim();
    const location = this.getPeasantConditionKey(rawLocation);
    if (!PeasantActor.WOUND_STATUSES.includes(status) || !location || location === "wounded") {
      return { ok: false, changed: false };
    }

    await this.update({ [`system.conditions.${location}`]: status });
    return { ok: true, changed: true, hasConditions: true, location, status };
  }

  async resetPeasantConditions() {
    const update = { "system.conditions.wounded": false };
    for (const key of PeasantActor.CONDITION_KEYS) {
      if (key !== "wounded") update[`system.conditions.${key}`] = "";
    }
    await this.update(update);
    return { ok: true, changed: true };
  }

  async setPeasantBlessing(rawType = "", rawTarget = "") {
    const type = String(rawType ?? "").trim().toLowerCase();
    const target = String(rawTarget ?? "").trim();
    const safeType = PeasantActor.BLESSING_TYPES.includes(type) ? type : "";
    const safeTarget = safeType && PeasantActor.BLESSING_TARGETS.includes(target) ? target : "";

    const blessing = safeType ? { type: safeType, target: safeTarget } : { type: "", target: "" };
    await this.update({ "system.blessing": blessing });
    return { ok: true, changed: true, blessing };
  }

  async clearPeasantBlessing() {
    return this.setPeasantBlessing("", "");
  }

  getPeasantToHitPenaltyTarget(rawTarget) {
    const target = String(rawTarget ?? "").trim();
    return PeasantActor.TO_HIT_PENALTY_TARGETS.includes(target) ? target : "";
  }

  async setPeasantToHitPenaltyTarget(rawTarget) {
    const target = this.getPeasantToHitPenaltyTarget(rawTarget);
    try {
      this.system.toHitPenaltyTarget = target;
    } catch (e) {
      // Ignore local model write failures; update below remains authoritative.
    }
    await this.update({ "system.toHitPenaltyTarget": target });
    return { ok: true, changed: true, target };
  }

  async togglePeasantToHitPenaltyTarget(rawTarget) {
    const target = this.getPeasantToHitPenaltyTarget(rawTarget);
    const current = this.getPeasantToHitPenaltyTarget(this.system?.toHitPenaltyTarget);
    return this.setPeasantToHitPenaltyTarget(current === target ? "" : target);
  }

  async setPeasantReflexAoeSave(enabled, rawTarget = "", options = {}) {
    const isEnabled = !!enabled;
    const target = isEnabled ? parseOptionalInteger(rawTarget, { min: 1 }) : null;
    await this.update({
      "system.reflexAoeSaveEnabled": isEnabled,
      "system.reflexAoeSaveTarget": target
    }, options);
    return { ok: true, changed: true, enabled: isEnabled, target };
  }

  async togglePeasantHardLocation(rawLocation, rawType = "halt") {
    const location = String(rawLocation ?? "").trim();
    if (!PeasantActor.HARD_LOCATION_NAMES.includes(location)) return { ok: false, changed: false };

    const field = String(rawType ?? "").trim() === "natural"
      ? `naturalHard${location}`
      : `hard${location}`;
    const value = !this.system?.[field];
    await this.update({ [`system.${field}`]: value });
    return { ok: true, changed: true, field, value };
  }

  async setPeasantMovement(rawValue) {
    const movement = Math.max(0, Number.parseInt(rawValue, 10) || 0);
    await this.update({ "system.movement": movement });
    return { ok: true, changed: true, movement };
  }

  async setPeasantInitiative(rawValue, options = {}) {
    const initiative = parseOptionalInteger(rawValue, { allowSign: true });
    await this.update({ "system.initiative": initiative }, options);
    return { ok: true, changed: true, initiative };
  }

  async setPeasantHaltValues(rawValues, { natural = false, render = false } = {}) {
    const field = natural ? "naturalHaltValues" : "haltValues";
    const values = normalizeHaltValues(rawValues);
    await this.update({ [`system.${field}`]: values }, { render });
    return { ok: true, changed: true, field, values };
  }

  async applyPeasantSimplifiedHpDefaults() {
    if (this?.type && !isPeasantCharacterType(this.type)) return { ok: false, changed: false };

    const rows = Number(this.system?.hp?.rows) || 0;
    const cols = Number(this.system?.hp?.cols) || 0;
    const fallbackMax = rows * cols;
    const currentMaxRaw = Number(this.system?.health?.max);
    const max = Number.isFinite(currentMaxRaw) && currentMaxRaw > 0 ? currentMaxRaw : fallbackMax;
    const value = max;
    const currentTemp = Math.max(0, Number(this.system?.temporaryHp?.value) || 0);
    const tempMax = Math.max(0, max - value);
    const tempValue = Math.min(currentTemp, tempMax);
    const bolstered = Math.max(0, Math.min(Number(this.system?.bolsteredHp) || 0, max));
    const conditionUpdates = { "system.conditions.wounded": false };
    for (const key of PeasantActor.CONDITION_KEYS) {
      if (key !== "wounded") conditionUpdates[`system.conditions.${key}`] = "";
    }

    await this.update({
      "system.health.value": value,
      "system.health.max": max,
      "system.temporaryHp.value": tempValue,
      "system.temporaryHp.max": tempMax,
      "system.bolsteredHp": bolstered,
      ...conditionUpdates
    });

    return { ok: true, changed: true, value, max, tempMax };
  }

  getPeasantCombatHaltBuffsForUpdate() {
    return sanitizeCombatHaltBuffs(this.system?.combatMods?.haltBuffs);
  }

  hasPeasantCombatHaltBuffType(buffs, rawType) {
    const type = sanitizeCombatHaltBuffType(rawType);
    return buffs.some(buff => sanitizeCombatHaltBuffType(buff?.type) === type);
  }

  hasPeasantCombatCostBuffResource(buffs, rawResourceType) {
    const resourceType = sanitizeCombatCostResourceType(rawResourceType);
    return buffs.some(buff =>
      sanitizeCombatHaltBuffType(buff?.type) === COMBAT_HALT_BUFF_TYPE_COST &&
      sanitizeCombatCostResourceType(buff?.resourceType) === resourceType
    );
  }

  async addPeasantCombatHaltBuff(rawType, { resourceType = "", customName = "", value = 0 } = {}, options = {}) {
    const type = sanitizeCombatHaltBuffType(rawType);
    const buffs = this.getPeasantCombatHaltBuffsForUpdate();
    let entry = { type, values: "0/0/0/0", value: 0, resourceType: "", customName: "" };

    if (type === COMBAT_HALT_BUFF_TYPE_COST) {
      const safeResourceType = sanitizeCombatCostResourceType(resourceType);
      if (this.hasPeasantCombatCostBuffResource(buffs, safeResourceType)) {
        return { ok: false, changed: false, reason: "duplicate-cost", resourceType: safeResourceType };
      }
      entry.resourceType = safeResourceType;
    } else if (type === COMBAT_HALT_BUFF_TYPE_CUSTOM) {
      entry.value = Number.parseInt(value, 10) || 0;
      entry.customName = String(customName ?? "").trim() || "Custom";
    } else {
      const singleUseTypes = [COMBAT_HALT_BUFF_TYPE_HALT, COMBAT_HALT_BUFF_TYPE_NATURAL, COMBAT_HALT_BUFF_TYPE_FLAT];
      if (singleUseTypes.includes(type) && this.hasPeasantCombatHaltBuffType(buffs, type)) {
        return { ok: false, changed: false, reason: "duplicate-type", type };
      }
    }

    buffs.push(entry);
    await this.update({ "system.combatMods.haltBuffs": sanitizeCombatHaltBuffs(buffs) }, options);
    return { ok: true, changed: true, entry, buffs };
  }

  async removePeasantCombatHaltBuff(index, options = { render: false }) {
    const numericIndex = Number.parseInt(index, 10);
    if (!Number.isFinite(numericIndex) || numericIndex < 0) return { ok: false, changed: false };

    const buffs = this.getPeasantCombatHaltBuffsForUpdate();
    if (numericIndex >= buffs.length) return { ok: false, changed: false };

    const [removed] = buffs.splice(numericIndex, 1);
    await this.update({ "system.combatMods.haltBuffs": buffs }, options);
    return { ok: true, changed: true, removed, buffs };
  }

  async updatePeasantCombatHaltBuff(index, patch, options = { render: false }) {
    const numericIndex = Number.parseInt(index, 10);
    if (!Number.isFinite(numericIndex) || numericIndex < 0) return { ok: false, changed: false };

    const buffs = this.getPeasantCombatHaltBuffsForUpdate();
    if (numericIndex >= buffs.length) return { ok: false, changed: false };

    buffs[numericIndex] = { ...buffs[numericIndex], ...patch };
    const sanitized = sanitizeCombatHaltBuffs(buffs);
    await this.update({ "system.combatMods.haltBuffs": sanitized }, options);
    return { ok: true, changed: true, entry: sanitized[numericIndex], buffs: sanitized };
  }

  async setPeasantCombatHaltBuffValues(index, rawValues, options = { render: false }) {
    return this.updatePeasantCombatHaltBuff(index, { values: normalizeHaltValues(rawValues) }, options);
  }

  async setPeasantCombatHaltBuffValue(index, rawValue, options = { render: false }) {
    const current = this.getPeasantCombatHaltBuffsForUpdate()[Number.parseInt(index, 10)];
    const type = sanitizeCombatHaltBuffType(current?.type);
    if (type !== COMBAT_HALT_BUFF_TYPE_FLAT && type !== COMBAT_HALT_BUFF_TYPE_COST && type !== COMBAT_HALT_BUFF_TYPE_CUSTOM) {
      return { ok: false, changed: false };
    }

    return this.updatePeasantCombatHaltBuff(index, { value: Number.parseInt(rawValue, 10) || 0 }, options);
  }

  async setPeasantCombatCustomBuffName(index, rawName, options = { render: false }) {
    const current = this.getPeasantCombatHaltBuffsForUpdate()[Number.parseInt(index, 10)];
    if (sanitizeCombatHaltBuffType(current?.type) !== COMBAT_HALT_BUFF_TYPE_CUSTOM) return { ok: false, changed: false };

    return this.updatePeasantCombatHaltBuff(index, { customName: String(rawName ?? "").trim() || "Custom" }, options);
  }

  async setPeasantCombatCostBuffResource(index, rawResourceType, options = { render: false }) {
    const numericIndex = Number.parseInt(index, 10);
    if (!Number.isFinite(numericIndex) || numericIndex < 0) return { ok: false, changed: false };

    const buffs = this.getPeasantCombatHaltBuffsForUpdate();
    if (numericIndex >= buffs.length) return { ok: false, changed: false };
    if (sanitizeCombatHaltBuffType(buffs[numericIndex]?.type) !== COMBAT_HALT_BUFF_TYPE_COST) return { ok: false, changed: false };

    const resourceType = sanitizeCombatCostResourceType(rawResourceType);
    const hasDuplicate = buffs.some((buff, index) =>
      index !== numericIndex &&
      sanitizeCombatHaltBuffType(buff.type) === COMBAT_HALT_BUFF_TYPE_COST &&
      sanitizeCombatCostResourceType(buff.resourceType) === resourceType
    );
    if (hasDuplicate) return { ok: false, changed: false, reason: "duplicate-cost", resourceType };

    return this.updatePeasantCombatHaltBuff(numericIndex, { resourceType }, options);
  }

  static createDefaultPeasantSkillEntry(entry = {}) {
    const existing = (entry && typeof entry === "object") ? entry : {};
    const merged = {
      type: "standard",
      specialGrade: 0,
      class: 1,
      rank: "0",
      sig: false,
      name: "",
      tohit: null,
      accuracy: null,
      ap: null,
      sp: null,
      usesMax: 0,
      usesCurrent: 0,
      indent: 0,
      description: "",
      ...existing
    };
    merged.tohit = parseOptionalInteger(merged.tohit, { min: 1 });
    merged.accuracy = parseOptionalInteger(merged.accuracy, { allowSign: true });
    merged.ap = parseOptionalInteger(merged.ap, { min: 0 });
    merged.sp = parseOptionalInteger(merged.sp, { min: 0 });
    return merged;
  }

  getPeasantSkillsForUpdate() {
    const skills = JSON.parse(JSON.stringify(Array.isArray(this.system?.skills) ? this.system.skills : []));
    return skills.map(skill => PeasantActor.createDefaultPeasantSkillEntry(skill));
  }

  ensurePeasantSkillEntryAt(skills, index) {
    const numericIndex = Number.parseInt(index, 10);
    if (!Number.isFinite(numericIndex) || numericIndex < 0) return null;
    while (skills.length <= numericIndex) skills.push(PeasantActor.createDefaultPeasantSkillEntry());
    skills[numericIndex] = PeasantActor.createDefaultPeasantSkillEntry(skills[numericIndex]);
    return skills[numericIndex];
  }

  async setPeasantSkills(skills, options = {}) {
    const list = Array.isArray(skills)
      ? skills.map(skill => PeasantActor.createDefaultPeasantSkillEntry(skill))
      : [];
    await this.update({ "system.skills": list }, options);
    return { ok: true, changed: true, skills: list };
  }

  async addPeasantSkill(entry = {}, options = {}) {
    const skills = this.getPeasantSkillsForUpdate();
    skills.push(PeasantActor.createDefaultPeasantSkillEntry(entry));
    return this.setPeasantSkills(skills, options);
  }

  async removePeasantSkill(index, options = {}) {
    const numericIndex = Number.parseInt(index, 10);
    if (!Number.isFinite(numericIndex) || numericIndex < 0) return { ok: false, changed: false };
    const skills = this.getPeasantSkillsForUpdate();
    if (numericIndex >= skills.length) return { ok: false, changed: false };
    skills.splice(numericIndex, 1);
    return this.setPeasantSkills(skills, options);
  }

  async reorderPeasantSkill(fromIndex, toIndex, options = {}) {
    const from = Number.parseInt(fromIndex, 10);
    let to = Number.parseInt(toIndex, 10);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return { ok: false, changed: false };

    const skills = this.getPeasantSkillsForUpdate();
    if (from < 0 || from >= skills.length) return { ok: false, changed: false };
    const [moved] = skills.splice(from, 1);
    if (from < to) to--;
    to = Math.max(0, Math.min(to, skills.length));
    skills.splice(to, 0, moved);
    return this.setPeasantSkills(skills, options);
  }

  async updatePeasantSkill(index, patch, options = {}) {
    const skills = this.getPeasantSkillsForUpdate();
    const skill = this.ensurePeasantSkillEntryAt(skills, index);
    if (!skill) return { ok: false, changed: false };
    Object.assign(skill, patch && typeof patch === "object" ? patch : {});
    return this.setPeasantSkills(skills, options);
  }

  async setPeasantSkillType(index, rawType, options = {}) {
    const type = String(rawType ?? "standard").trim() || "standard";
    const skills = this.getPeasantSkillsForUpdate();
    const skill = this.ensurePeasantSkillEntryAt(skills, index);
    if (!skill) return { ok: false, changed: false };

    if (type === "standard") {
      skill.type = "standard";
      skill.class = skill.class || 1;
      skill.rank = skill.rank !== undefined ? String(skill.rank) : "0";
      skill.sig = skill.sig || false;
      skill.usesMax = skill.usesMax || 0;
      skill.usesCurrent = skill.usesCurrent || 0;
    } else {
      skill.type = type;
      if (type === "Other") {
        delete skill.class;
        delete skill.rank;
        delete skill.sig;
        delete skill.usesMax;
        delete skill.usesCurrent;
      }
    }

    return this.setPeasantSkills(skills, options);
  }

  async changePeasantSkillIndent(index, delta, options = {}) {
    const skills = this.getPeasantSkillsForUpdate();
    const skill = this.ensurePeasantSkillEntryAt(skills, index);
    if (!skill) return { ok: false, changed: false };
    skill.indent = Math.max(0, (Number.parseInt(skill.indent, 10) || 0) + (Number.parseInt(delta, 10) || 0));
    return this.setPeasantSkills(skills, options);
  }

  async setPeasantSkillUsesMax(index, rawValue, options = { render: false }) {
    const skills = this.getPeasantSkillsForUpdate();
    const skill = this.ensurePeasantSkillEntryAt(skills, index);
    if (!skill) return { ok: false, changed: false };

    const value = Number.parseInt(rawValue, 10) || 0;
    const current = Number.parseInt(skill.usesCurrent, 10) || 0;
    skill.usesMax = value;
    if (!current) skill.usesCurrent = value;
    else if (current > value) skill.usesCurrent = value;
    return this.setPeasantSkills(skills, options);
  }

  async setPeasantSkillUsesCurrent(index, rawValue, options = { render: false }) {
    const skills = this.getPeasantSkillsForUpdate();
    const skill = this.ensurePeasantSkillEntryAt(skills, index);
    if (!skill) return { ok: false, changed: false };

    const max = Number.parseInt(skill.usesMax, 10) || 0;
    skill.usesCurrent = Math.min(Number.parseInt(rawValue, 10) || 0, Math.max(0, max));
    return this.setPeasantSkills(skills, options);
  }

  async setPeasantSkillToHitAccuracy(index, { tohit = "", accuracy = "" } = {}, options = { render: false }) {
    return this.updatePeasantSkill(index, {
      tohit: parseOptionalInteger(tohit, { min: 1 }),
      accuracy: parseOptionalInteger(accuracy, { allowSign: true })
    }, options);
  }

  async setPeasantSkillMainFields(index, fields = {}, options = { render: false }) {
    const patch = {};
    if ("class" in fields) patch.class = Number.parseInt(fields.class, 10) || 1;
    if ("rank" in fields) {
      const rankRaw = String(fields.rank ?? "").trim();
      patch.rank = rankRaw.toLowerCase() === "u" ? rankRaw : (Number.parseInt(rankRaw, 10) || 0);
    }
    if ("name" in fields) patch.name = String(fields.name ?? "");
    if ("ap" in fields) patch.ap = parseOptionalInteger(fields.ap, { min: 0 });
    if ("sp" in fields) patch.sp = parseOptionalInteger(fields.sp, { min: 0 });
    if ("specialGrade" in fields) patch.specialGrade = Math.max(0, Number.parseInt(fields.specialGrade, 10) || 0);
    return this.updatePeasantSkill(index, patch, options);
  }

  async setPeasantSkillDescription(index, description, options = {}) {
    return this.updatePeasantSkill(index, { description: String(description ?? "") }, options);
  }

  async consumePeasantSkillUse(index, options = {}) {
    const skills = this.getPeasantSkillsForUpdate();
    const numericIndex = Number.parseInt(index, 10);
    if (!Number.isFinite(numericIndex) || numericIndex < 0 || numericIndex >= skills.length) return { ok: false, changed: false };
    if (!skills[numericIndex]?.sig) return { ok: true, changed: false, skills };

    const current = Number.parseInt(skills[numericIndex].usesCurrent, 10) || 0;
    if (current <= 0) return { ok: true, changed: false, skills };

    skills[numericIndex].usesCurrent = Math.max(0, current - 1);
    await this.update({ "system.skills": skills }, options);
    return { ok: true, changed: true, skills };
  }

  getPeasantFlexibleAdvantagesForUpdate(names = null, descriptions = null) {
    const sourceNames = Array.isArray(names) ? names : (Array.isArray(this.system?.flexibleAdvantages) ? this.system.flexibleAdvantages : []);
    const sourceDescriptions = Array.isArray(descriptions)
      ? descriptions
      : (Array.isArray(this.system?.flexibleAdvantageDescriptions) ? this.system.flexibleAdvantageDescriptions : []);
    const safeNames = sourceNames.map(entry => {
      if (typeof entry === "string") return entry;
      return String(entry?.name ?? "");
    });
    const safeDescriptions = sourceDescriptions.map(entry => String(entry ?? ""));
    while (safeDescriptions.length < safeNames.length) safeDescriptions.push("");
    if (safeDescriptions.length > safeNames.length) safeDescriptions.length = safeNames.length;
    return { names: safeNames, descriptions: safeDescriptions };
  }

  async setPeasantFlexibleAdvantages(names, descriptions, options = {}) {
    const safe = this.getPeasantFlexibleAdvantagesForUpdate(names, descriptions);
    await this.update({
      "system.flexibleAdvantages": safe.names,
      "system.flexibleAdvantageDescriptions": safe.descriptions
    }, options);
    return { ok: true, changed: true, ...safe };
  }

  async addPeasantFlexibleAdvantage(names = null, descriptions = null, options = {}) {
    const safe = this.getPeasantFlexibleAdvantagesForUpdate(names, descriptions);
    safe.names.push("");
    safe.descriptions.push("");
    return this.setPeasantFlexibleAdvantages(safe.names, safe.descriptions, options);
  }

  async removePeasantFlexibleAdvantage(index, names = null, descriptions = null, options = {}) {
    const numericIndex = Number.parseInt(index, 10);
    if (!Number.isFinite(numericIndex) || numericIndex < 0) return { ok: false, changed: false };
    const safe = this.getPeasantFlexibleAdvantagesForUpdate(names, descriptions);
    if (numericIndex >= safe.names.length) return { ok: false, changed: false };
    safe.names.splice(numericIndex, 1);
    safe.descriptions.splice(numericIndex, 1);
    return this.setPeasantFlexibleAdvantages(safe.names, safe.descriptions, options);
  }

  async reorderPeasantFlexibleAdvantage(fromIndex, toIndex, names = null, descriptions = null, options = {}) {
    const from = Number.parseInt(fromIndex, 10);
    let to = Number.parseInt(toIndex, 10);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return { ok: false, changed: false };
    const safe = this.getPeasantFlexibleAdvantagesForUpdate(names, descriptions);
    if (from < 0 || from >= safe.names.length) return { ok: false, changed: false };

    const [movedName] = safe.names.splice(from, 1);
    const [movedDescription] = safe.descriptions.splice(from, 1);
    if (from < to) to--;
    to = Math.max(0, Math.min(to, safe.names.length));
    safe.names.splice(to, 0, movedName);
    safe.descriptions.splice(to, 0, movedDescription);
    return this.setPeasantFlexibleAdvantages(safe.names, safe.descriptions, options);
  }

  async setPeasantFlexibleAdvantageDescription(index, description, options = {}) {
    const numericIndex = Number.parseInt(index, 10);
    if (!Number.isFinite(numericIndex) || numericIndex < 0) return { ok: false, changed: false };
    const safe = this.getPeasantFlexibleAdvantagesForUpdate();
    while (safe.descriptions.length <= numericIndex) safe.descriptions.push("");
    while (safe.names.length <= numericIndex) safe.names.push("");
    safe.descriptions[numericIndex] = String(description ?? "");
    return this.setPeasantFlexibleAdvantages(safe.names, safe.descriptions, options);
  }

  getPeasantEdgeBaseMode() {
    return sanitizeEdgeLabelMode(this.system?.edgeLabelMode, getDefaultEdgeLabelMode(this));
  }

  getPeasantEdgeResourcesForUpdate() {
    const baseMode = this.getPeasantEdgeBaseMode();
    const existing = Array.isArray(this.system?.edgeResources) ? this.system.edgeResources : [];
    return existing.map(entry => normalizeEdgeResourceEntry(entry, baseMode));
  }

  getPeasantEdgeResource(index) {
    const numericIndex = Number.parseInt(index, 10);
    if (!Number.isFinite(numericIndex) || numericIndex < 0) return null;
    const resources = this.getPeasantEdgeResourcesForUpdate();
    return resources[numericIndex] ? { ...resources[numericIndex] } : null;
  }

  async addPeasantEdgeResource() {
    const resources = this.getPeasantEdgeResourcesForUpdate();
    const baseMode = this.getPeasantEdgeBaseMode();
    resources.push({ labelMode: baseMode, customLabel: "", value: 0, max: 0 });
    await this.update({ "system.edgeResources": resources });
    return { ok: true, changed: true, resources };
  }

  async removePeasantEdgeResource(index) {
    const numericIndex = Number.parseInt(index, 10);
    if (!Number.isFinite(numericIndex) || numericIndex < 0) return { ok: false, changed: false };
    const resources = this.getPeasantEdgeResourcesForUpdate();
    if (numericIndex >= resources.length) return { ok: false, changed: false };
    resources.splice(numericIndex, 1);
    await this.update({ "system.edgeResources": resources });
    return { ok: true, changed: true, resources };
  }

  async setPeasantEdgeLabelMode(rawMode) {
    const mode = sanitizeEdgeLabelMode(rawMode, getDefaultEdgeLabelMode(this));
    await this.update({ "system.edgeLabelMode": mode });
    return { ok: true, changed: true, mode };
  }

  async setPeasantEdgeCustomLabel(rawLabel) {
    const label = String(rawLabel ?? "").trim();
    await this.update({ "system.edgeCustomLabel": label });
    return { ok: true, changed: true, label };
  }

  async updatePeasantEdgeResource(index, patch, options = {}) {
    const numericIndex = Number.parseInt(index, 10);
    if (!Number.isFinite(numericIndex) || numericIndex < 0) return { ok: false, changed: false };
    const resources = this.getPeasantEdgeResourcesForUpdate();
    if (numericIndex >= resources.length) return { ok: false, changed: false };

    const baseMode = this.getPeasantEdgeBaseMode();
    resources[numericIndex] = normalizeEdgeResourceEntry({ ...resources[numericIndex], ...patch }, baseMode);
    await this.update({ "system.edgeResources": resources }, options);
    return { ok: true, changed: true, entry: resources[numericIndex], resources };
  }

  async setPeasantEdgeResourceLabelMode(index, rawMode, options = { render: false }) {
    const current = this.getPeasantEdgeResource(index);
    if (!current) return { ok: false, changed: false };
    return this.updatePeasantEdgeResource(index, {
      labelMode: sanitizeEdgeLabelMode(rawMode, current.labelMode)
    }, options);
  }

  async setPeasantEdgeResourceCustomLabel(index, rawLabel, options = { render: false }) {
    return this.updatePeasantEdgeResource(index, {
      customLabel: String(rawLabel ?? "").trim()
    }, options);
  }

  async setPeasantEdgeResourceValue(index, rawValue, options = { render: false }) {
    const current = this.getPeasantEdgeResource(index);
    if (!current) return { ok: false, changed: false };
    const max = Math.max(0, Number.parseInt(current.max, 10) || 0);
    const value = Math.max(0, Math.min(Number.parseInt(rawValue, 10) || 0, max));
    return this.updatePeasantEdgeResource(index, { value }, options);
  }

  async setPeasantEdgeResourceMax(index, rawMax, options = { render: false }) {
    const current = this.getPeasantEdgeResource(index);
    if (!current) return { ok: false, changed: false };
    const max = Math.max(0, Number.parseInt(rawMax, 10) || 0);
    const value = Math.min(Math.max(0, Number.parseInt(current.value, 10) || 0), max);
    return this.updatePeasantEdgeResource(index, { value, max }, options);
  }

  getBarAttribute(barName, options = {}) {
    const data = super.getBarAttribute(barName, options);
    if (!data) return null;

    const customColors = {
      health: { bar: [1, 0, 0], value: [0, 1, 0] },
      stamina: { bar: [0, 0.2, 0], value: [0, 0.4, 0] },
      attunement: { bar: [0.12, 0.56, 1], value: [0.24, 0.68, 1] },
      capacity: { bar: [1, 0.55, 0], value: [1, 0.7, 0.2] },
      edge: { bar: [0.5, 0.5, 0.5], value: [1, 1, 1] }
    };

    const attrName = barName.split(".").pop();
    if (customColors[attrName]) {
      data.color = customColors[attrName].value;
      data.bgColor = customColors[attrName].bar;
    }

    return data;
  }
}
