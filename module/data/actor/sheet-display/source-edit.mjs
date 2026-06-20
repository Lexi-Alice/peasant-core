import { cloneActorSourceSystem } from "../source-system.mjs";

export function buildPeasantActorSourceContext(actor) {
  return {
    system: cloneActorSourceSystem(actor)
  };
}
