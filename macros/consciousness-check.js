const { performConsciousnessCheck } = await import("/systems/peasant-core/module/dice/rolls.mjs");

const tn = await game.user.getFlag("peasant-core", "lastConsciousnessTN") || 7;
const speaker = ChatMessage.getSpeaker();
const speakerActor =
  (speaker?.actor ? game.actors?.get?.(speaker.actor) : null) ||
  (speaker?.token ? canvas?.tokens?.get?.(speaker.token)?.actor : null) ||
  canvas?.tokens?.controlled?.[0]?.actor ||
  game.user?.character ||
  null;
const asSave = !!speakerActor?.getFlag?.("peasant-core", "rollConsciousnessAsSaves");

await performConsciousnessCheck({ tn, asSave, speaker });
try { await game.user.unsetFlag("peasant-core", "lastConsciousnessTN"); } catch (e) {}
