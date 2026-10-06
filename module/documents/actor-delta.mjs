import { migrateLegacyHeraldryData } from "../data/actor/identity-options.mjs";

export class PeasantActorDelta extends ActorDelta {
  static migrateData(source, options) {
    const data = super.migrateData(source, options);
    // Rename token overrides before Foundry merges them with the base Actor.
    if (data.system) data.system = migrateLegacyHeraldryData(data.system);
    return data;
  }
}

export function configurePeasantActorDelta() {
  CONFIG.ActorDelta.documentClass = PeasantActorDelta;
}
