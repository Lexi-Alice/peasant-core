export function getBarBrawlApi() {
  return game?.modules?.get("barbrawl")?.api ?? null;
}

export function getBarBrawlBar(tokenDocument, barId) {
  if (!tokenDocument || !barId) return null;
  const apiBar = getBarBrawlApi()?.getBar?.(tokenDocument, barId);
  if (apiBar) return apiBar;
  return foundry.utils.getProperty(tokenDocument, `flags.barbrawl.resourceBars.${barId}`) ?? null;
}

export function getBarBrawlBars(tokenDocument) {
  if (!tokenDocument) return [];
  const apiBars = getBarBrawlApi()?.getBars?.(tokenDocument);
  if (Array.isArray(apiBars)) return apiBars;
  const flagBars = foundry.utils.getProperty(tokenDocument, "flags.barbrawl.resourceBars");
  if (!flagBars || typeof flagBars !== "object") return [];
  return Object.entries(flagBars).map(([id, bar]) => {
    const safeBar = (bar && typeof bar === "object") ? bar : {};
    return { id, ...safeBar };
  });
}

export function getBarBrawlInputAttribute(tokenDocument, inputName) {
  const name = String(inputName ?? "");
  if (!name) return "";

  const directBar = getBarBrawlBar(tokenDocument, name);
  if (directBar?.attribute) return directBar.attribute;

  const flagMatch = name.match(/^flags\.barbrawl\.resourceBars\.([^\.]+)\.value$/);
  if (!flagMatch) return "";

  const flagBar = getBarBrawlBar(tokenDocument, flagMatch[1]);
  return flagBar?.attribute ?? "";
}

export function findBarBrawlBarByAttribute(tokenDocument, attributeName) {
  const attr = String(attributeName ?? "").split(".").pop();
  if (!attr) return null;
  return getBarBrawlBars(tokenDocument).find(bar => String(bar?.attribute ?? "").split(".").pop() === attr) ?? null;
}
