export function getPeasantCoreApi() {
  const namespace = game.peasantCore ?? {};
  game.peasantCore = namespace;
  return namespace;
}

export function registerPeasantCoreApi(entries) {
  return Object.assign(getPeasantCoreApi(), entries);
}

export function getPeasantCoreApiFunction(name) {
  return game?.peasantCore?.[name];
}
