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
  const blessing = system.blessing || {};
  const baseSaves = {
    build: 18 - (attrVals.build * 2),
    reflex: 18 - (attrVals.reflex * 2),
    intuition: 18 - (attrVals.intuition * 2),
    learn: 18 - (attrVals.learn * 2),
    charisma: 18 - (attrVals.charisma * 2)
  };

  if (blessing.type === "spring") baseSaves.learn = 16 - (attrVals.learn * 2);

  return baseSaves;
}

export function getOmniWorstSaveTarget(system) {
  return Math.max(...Object.values(computeBaseSaves(system)));
}

export function computeBaseAttrToHits(system) {
  const attrVals = getAttributeValues(system);
  const strBase = 18 - attrVals.build - attrVals.reflex;
  const dexBase = 18 - attrVals.reflex - attrVals.intuition;
  const mntBase = 18 - attrVals.intuition - attrVals.learn;
  const socBase = 18 - attrVals.intuition - attrVals.charisma;

  const penaltyTarget = system.toHitPenaltyTarget || "";
  const str = (penaltyTarget === "Strength") ? (strBase - 1) : strBase;
  const dex = (penaltyTarget === "Dexterity") ? (dexBase - 1) : dexBase;
  const mnt = (penaltyTarget === "Mental") ? (mntBase - 1) : mntBase;
  const soc = (penaltyTarget === "Social") ? (socBase - 1) : socBase;

  return { Strength: str, Dexterity: dex, Mental: mnt, Social: soc };
}
