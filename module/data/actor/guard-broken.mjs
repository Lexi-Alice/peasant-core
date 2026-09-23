import { DEFENSIVE_REFLEXES_TO_HIT_KEY } from "../active-effect/key-policy.mjs";

export function createGuardBrokenEffectData(combat = null) {
  const ActiveEffectClass = globalThis.ActiveEffect?.implementation ?? globalThis.ActiveEffect;
  const start = ActiveEffectClass?.getEffectStart?.(combat) || {
    combat: combat?.id || null,
    combatant: null,
    initiative: null,
    round: combat?.round ?? null,
    time: Number(globalThis.game?.time?.worldTime) || 0,
    turn: combat?.turn ?? null
  };
  return {
    name: "Guard-Broken",
    type: "skill",
    disabled: false,
    start,
    duration: { value: 1, units: "rounds", expiry: "roundEnd", expired: false },
    flags: { "peasant-core": { guardBroken: true } },
    changes: [{
      key: DEFENSIVE_REFLEXES_TO_HIT_KEY,
      mode: globalThis.CONST?.ACTIVE_EFFECT_MODES?.ADD ?? 2,
      value: 4,
      priority: 20
    }]
  };
}
