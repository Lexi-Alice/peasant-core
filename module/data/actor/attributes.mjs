function getAttributeValues(system) {
  return {
    build: system.build || 0,
    reflex: system.reflex || 0,
    intuition: system.intuition || 0,
    learn: system.learn || 0,
    charisma: system.charisma || 0
  };
}

export function computeBaseSaves(system) {
  const attrVals = getAttributeValues(system);
  const blessing = system.blessing || { type: null, target: null };
  const baseSaves = {
    build: 18 - (attrVals.build * 2),
    reflex: 18 - (attrVals.reflex * 2),
    intuition: 18 - (attrVals.intuition * 2),
    learn: 18 - (attrVals.learn * 2),
    charisma: 18 - (attrVals.charisma * 2)
  };

  if (blessing.type === "spring" && blessing.target) {
    const t = blessing.target;
    if (baseSaves[t] !== undefined) baseSaves[t] = 16 - (attrVals[t] * 2);
  }

  if (blessing.type === "fall" && blessing.target) {
    const t = blessing.target;
    const otherSaves = Object.entries(baseSaves).filter(([k]) => k !== t).map(([, v]) => v);
    if (otherSaves.length > 0) baseSaves[t] = Math.min(...otherSaves);
  }

  return baseSaves;
}

export function computeBaseAttrToHits(system) {
  const attrVals = getAttributeValues(system);
  const blessing = system.blessing || { type: null, target: null };
  const isSummer = blessing.type === "summer" && blessing.target;
  const blessedValue = isSummer ? (attrVals[blessing.target] || 0) : 0;

  const strBase = isSummer ? (22 - attrVals.build - attrVals.reflex - blessedValue) : (18 - attrVals.build - attrVals.reflex);
  const dexBase = isSummer ? (22 - attrVals.reflex - attrVals.intuition - blessedValue) : (18 - attrVals.reflex - attrVals.intuition);
  const mntBase = isSummer ? (22 - attrVals.intuition - attrVals.learn - blessedValue) : (18 - attrVals.intuition - attrVals.learn);
  const socBase = isSummer ? (22 - attrVals.intuition - attrVals.charisma - blessedValue) : (18 - attrVals.intuition - attrVals.charisma);

  const penaltyTarget = system.toHitPenaltyTarget || "";
  const str = (penaltyTarget === "Strength") ? (strBase - 1) : strBase;
  const dex = (penaltyTarget === "Dexterity") ? (dexBase - 1) : dexBase;
  const mnt = (penaltyTarget === "Mental") ? (mntBase - 1) : mntBase;
  const soc = (penaltyTarget === "Social") ? (socBase - 1) : socBase;

  return { Strength: str, Dexterity: dex, Mental: mnt, Social: soc };
}
