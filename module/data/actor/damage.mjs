export function splitDamageCounts(amount, type) {
  const total = Math.max(0, Number(amount) || 0);
  const counts = { critical: 0, lethal: 0, blunt: 0 };
  switch (type) {
    case "critical":
      counts.critical = total;
      break;
    case "lethal":
      counts.lethal = total;
      break;
    case "blunt":
      counts.blunt = total;
      break;
    case "hybrid": {
      const lethal = Math.ceil(total / 2);
      const blunt = Math.floor(total / 2);
      counts.lethal = lethal;
      counts.blunt = blunt;
      break;
    }
    default:
      counts.lethal = total;
      break;
  }
  return counts;
}

export function toSimplifiedHpDamage(amount, type, hardLocation = false) {
  const raw = Math.max(0, Number(amount) || 0);
  if (raw <= 0) return 0;

  const counts = splitDamageCounts(raw, String(type || "").toLowerCase());
  if (hardLocation && counts.lethal > 0) {
    const convertedToBlunt = Math.floor(counts.lethal / 2);
    counts.lethal -= convertedToBlunt;
    counts.blunt += convertedToBlunt;
  }

  return (counts.blunt || 0) + ((counts.lethal || 0) * 2) + ((counts.critical || 0) * 4);
}

export function sumDamageCounts(counts) {
  return (counts?.critical || 0) + (counts?.lethal || 0) + (counts?.blunt || 0);
}

export function absorbTempHpFromCounts(counts, tempHp) {
  let remaining = { ...counts };
  let tempRemaining = Math.max(0, Number(tempHp) || 0);
  let tempUsed = 0;

  const absorb = (type, cost) => {
    if (tempRemaining <= 0 || remaining[type] <= 0) return;
    const canAbsorb = Math.min(remaining[type], Math.floor(tempRemaining / cost));
    if (canAbsorb > 0) {
      remaining[type] -= canAbsorb;
      tempRemaining -= canAbsorb * cost;
      tempUsed += canAbsorb * cost;
    }
  };

  absorb("critical", 4);
  absorb("lethal", 2);
  absorb("blunt", 1);

  return { remaining, tempRemaining, tempUsed };
}

export function absorbBolsteredFromCounts(counts, bolsteredHp) {
  let remaining = { ...counts };
  let bolsteredRemaining = Math.max(0, Number(bolsteredHp) || 0);
  let bolsteredUsed = 0;

  const absorb = (type) => {
    if (bolsteredRemaining <= 0 || remaining[type] <= 0) return;
    const use = Math.min(remaining[type], bolsteredRemaining);
    if (use > 0) {
      remaining[type] -= use;
      bolsteredRemaining -= use;
      bolsteredUsed += use;
    }
  };

  absorb("critical");
  absorb("lethal");
  absorb("blunt");

  return { remaining, bolsteredRemaining, bolsteredUsed };
}
