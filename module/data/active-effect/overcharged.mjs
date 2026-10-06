import { getActorSourceSystem, withPeasantActorStateWriteContext } from "../actor/source-system.mjs";

export const OVERCHARGED_KEY = "system.conditions.overcharged";

export function isOverchargedEffect(effect) {
  return effect?.getFlag?.("peasant-core", "overcharged") === true
    || effect?.flags?.["peasant-core"]?.overcharged === true;
}

function createOverchargedEffectSource() {
  return {
    name: "Overcharged",
    type: "base",
    img: "icons/svg/lightning.svg",
    description: "<p>Prevents Natural Healing and General Stress recovery on the next Long Rest. Removed after that rest. Disabling or deleting this effect ends Overcharged.</p>",
    disabled: false,
    transfer: false,
    showIcon: globalThis.CONST?.ACTIVE_EFFECT_SHOW_ICON?.ALWAYS ?? 2,
    system: { changes: [{ key: OVERCHARGED_KEY, type: "override", value: true, priority: 50 }] },
    flags: { "peasant-core": { overcharged: true } }
  };
}

export async function applyOverchargedEffect(actor) {
  const source = createOverchargedEffectSource();
  let effect = Array.from(actor.effects ?? []).find(isOverchargedEffect);
  if (effect) {
    await effect.update({ disabled: false, "system.changes": source.system.changes });
  } else {
    [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [source]);
    if (!effect) throw new Error("Could not create Overcharged effect.");
  }

  // Retire the legacy stored flag so disabling/deleting the effect restores false.
  const actorSource = getActorSourceSystem(actor);
  if (actorSource?.conditions?.overcharged === true) {
    await actor.update({ [OVERCHARGED_KEY]: false }, withPeasantActorStateWriteContext());
  }
  return effect;
}

export async function removeOverchargedEffects(actor) {
  const ids = Array.from(actor.effects ?? []).filter(isOverchargedEffect).map(effect => effect.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
}
