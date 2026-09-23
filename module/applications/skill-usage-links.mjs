import { startPeasantEntryUse } from "./combat/skill-entry-use.mjs";

const COLLECTIONS = new Set(["skills", "notableCombats"]);
const ENRICHER_ID = "peasant-core.usage";

export function createPeasantUsageLink({ actorUuid, collection, entryId, usageId }, label) {
  const identifiers = [actorUuid, collection, entryId, usageId].map(value => encodeURIComponent(String(value ?? "")));
  const safeLabel = encodeURIComponent(String(label ?? ""));
  return `@PeasantUsage[${identifiers.join("|")}]{${safeLabel}}`;
}

function parseUsageIdentifiers(encoded) {
  const parts = String(encoded ?? "").split("|");
  if (parts.length !== 4) return null;
  try {
    const [actorUuid, collection, entryId, usageId] = parts.map(decodeURIComponent);
    return actorUuid && COLLECTIONS.has(collection) && entryId && usageId
      ? { actorUuid, collection, entryId, usageId }
      : null;
  } catch (error) {
    return null;
  }
}

export function registerPeasantUsageEnricher() {
  const enrichers = CONFIG?.TextEditor?.enrichers;
  if (!Array.isArray(enrichers) || enrichers.some(item => item.id === ENRICHER_ID)) return;
  enrichers.push({
    id: ENRICHER_ID,
    pattern: /@PeasantUsage\[([^\]\r\n]*)\]\{([^}]*)\}/g,
    enricher: async match => {
      const identifiers = parseUsageIdentifiers(match?.[1]);
      if (!identifiers) return null;
      let label = match[2];
      try {
        label = decodeURIComponent(label);
      } catch (error) {
        /* Hand-authored labels may contain a literal percent sign. */
      }
      const anchor = document.createElement("a");
      anchor.href = "#";
      anchor.classList.add("content-link", "pc-usage-link");
      anchor.dataset.pcUsageLink = "";
      Object.assign(anchor.dataset, identifiers);
      anchor.textContent = label;
      return anchor;
    },
    onRender: element => {
      if (element.dataset?.pcUsageLinksBound) return;
      if (element.dataset) element.dataset.pcUsageLinksBound = "true";
      element.addEventListener("click", async event => {
        const anchor = event.target?.closest?.("a[data-pc-usage-link]");
        if (!anchor) return;
        event.preventDefault();
        await useSkillEntry(anchor.dataset);
      });
    }
  });
}

export async function useSkillEntry({ actorUuid, collection, entryId, usageId = null } = {}) {
  const uuid = String(actorUuid ?? "").trim();
  let actor = null;
  try {
    if (uuid) actor = await fromUuid(uuid);
  } catch (error) {
    /* Treat an invalid UUID as an unavailable actor. */
  }
  if (!actor) {
    ui.notifications?.warn?.("Skill or Notable actor could not be found.");
    return false;
  }
  if (!actor.isOwner) {
    ui.notifications?.warn?.(`You do not have permission to use Skills or Notables for ${actor.name}.`);
    return false;
  }

  const key = String(collection ?? "").trim();
  const id = String(entryId ?? "").trim();
  const entries = COLLECTIONS.has(key) ? actor.system?._source?.[key] ?? actor.system?.[key] : null;
  const entry = Array.isArray(entries) ? entries.find(candidate => String(candidate?.id ?? "").trim() === id) : null;
  if (!entry || !id) {
    ui.notifications?.warn?.("That Skill or Notable is unavailable.");
    return false;
  }

  const selectedId = usageId === null ? null : String(usageId ?? "").trim();
  if (selectedId !== null && selectedId !== "base"
    && !entry.usages?.some(usage => String(usage?.id ?? "").trim() === selectedId)) {
    ui.notifications?.warn?.("That usage is unavailable.");
    return false;
  }
  return startPeasantEntryUse({ actor, ref: { collection: key, entryId: id }, usageId: selectedId });
}
