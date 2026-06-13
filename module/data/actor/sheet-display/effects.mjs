function getDefaultEffectIcon() {
  return foundry?.utils?.getProperty?.(CONFIG, "ActiveEffect.documentClass.DEFAULT_ICON")
    || foundry?.utils?.getProperty?.(CONFIG, "ActiveEffect.defaultIcon")
    || "icons/svg/aura.svg";
}

function getActiveEffectTypeLabel(type) {
  const key = CONFIG?.ActiveEffect?.typeLabels?.[type];
  if (key && game?.i18n?.has?.(key)) return game.i18n.localize(key);
  if (type === "base") return "Base";
  if (type === "enchantment") return "Enchantment";
  if (type === "skill") return "Skill";
  return "";
}

function getPeasantEffectCategory(effect) {
  return String(effect?.getFlag?.("peasant-core", "effectCategory") ?? "").trim();
}

function formatSearchText(...parts) {
  return parts.map(part => String(part ?? "").trim().toLowerCase()).filter(Boolean).join(" ");
}

function getEffectStatusLabel(effect) {
  if (effect?.disabled) return "Disabled";
  if (effect?.isTemporary) return "Temporary";
  return "Enabled";
}

function getEffectSourceFallback(effect, actor) {
  const parent = effect?.parent;
  if (!parent || parent === effect) return actor ?? null;
  return parent;
}

async function resolveEffectSource(effect, actor) {
  let source = null;
  if (typeof effect?.getSource === "function") {
    try {
      source = await effect.getSource();
    } catch (err) {
      source = null;
    }
  }

  if (!source) {
    const origin = String(effect?.origin ?? "").trim();
    if (origin && typeof fromUuid === "function") {
      try {
        source = await fromUuid(origin);
      } catch (err) {
        source = null;
      }
    }
  }

  if (source?.documentName === "ActiveEffect") {
    source = source.target ?? source.parent ?? null;
  }
  if (source?.documentName === "Item" && source.parent && source.parent !== actor) {
    source = source.parent;
  }

  return source ?? getEffectSourceFallback(effect, actor);
}

function getEffectSourceName(effect, actor, source) {
  if (!source || source === effect) return "Actor";
  if (source === actor) return actor?.name || "Actor";
  if (source.documentName === "Actor") return source.name || "Actor";
  return source.name || source.label || "Actor";
}

async function prepareActorPassiveEffect(effect, actor, index) {
  const source = await resolveEffectSource(effect, actor);
  const sourceName = getEffectSourceName(effect, actor, source);
  const type = effect?.type || "base";
  const category = getPeasantEffectCategory(effect);
  const typeLabel = category === "skill" ? "Skill" : getActiveEffectTypeLabel(type);
  const status = getEffectStatusLabel(effect);
  const name = effect?.name ?? effect?.label ?? "Effect";
  const subtitle = typeLabel ? `${typeLabel} - ${status}` : status;
  const disabled = !!effect?.disabled;

  return {
    id: effect?.id ?? "",
    uuid: effect?.uuid ?? "",
    name,
    icon: effect?.img || effect?.icon || getDefaultEffectIcon(),
    type,
    typeLabel,
    disabled,
    status,
    subtitle,
    sourceName,
    sourceUuid: source?.uuid ?? "",
    canToggle: !!effect?.uuid && typeof effect?.update === "function",
    toggleTooltip: disabled ? "Enable Effect" : "Disable Effect",
    sort: Number.isFinite(Number(effect?.sort)) ? Number(effect.sort) : index,
    sortName: formatSearchText(name, typeLabel),
    searchText: formatSearchText(name, typeLabel, status, sourceName)
  };
}

function getEffectCollectionKeys(effect) {
  const parentUuid = effect?.parent?.uuid ?? "";
  return [
    effect?.uuid,
    String(effect?.origin ?? "").trim(),
    [parentUuid, effect?.id ?? effect?._id ?? ""].filter(Boolean).join(".")
  ].filter(Boolean);
}

function addEffectToCollection(effects, seen, effect) {
  if (!effect) return;
  const keys = getEffectCollectionKeys(effect);
  if (!keys.length || keys.some(key => seen.has(key))) return;
  for (const key of keys) seen.add(key);
  effects.push(effect);
}

function getActorEffects(actor) {
  const effects = [];
  const seen = new Set();

  for (const effect of actor?.effects ?? []) {
    addEffectToCollection(effects, seen, effect);
  }

  for (const item of actor?.items ?? []) {
    for (const effect of item?.effects ?? []) {
      addEffectToCollection(effects, seen, effect);
    }
  }

  if (typeof actor?.allApplicableEffects === "function") {
    for (const effect of actor.allApplicableEffects()) {
      addEffectToCollection(effects, seen, effect);
    }
  }

  return effects;
}

function sortPreparedEffects(left, right) {
  const bySort = (Number(left?.sort) || 0) - (Number(right?.sort) || 0);
  if (bySort !== 0) return bySort;
  return String(left?.sortName ?? "").localeCompare(String(right?.sortName ?? ""));
}

export async function prepareActorEffectContext(data, actor) {
  const passiveEffects = await Promise.all(getActorEffects(actor).map((effect, index) => (
    prepareActorPassiveEffect(effect, actor, index)
  )));

  data.passiveEffects = passiveEffects.sort(sortPreparedEffects);
  data.hasPassiveEffects = data.passiveEffects.length > 0;
}
