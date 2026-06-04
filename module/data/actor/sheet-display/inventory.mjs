export const PC_INVENTORY_SECTION_DEFINITIONS = Object.freeze([
  { type: "weapon", label: "Weapons", singularLabel: "Weapon", icon: "fa-solid fa-sword" },
  { type: "equipment", label: "Equipment", singularLabel: "Equipment", icon: "fa-solid fa-shield-halved" },
  { type: "tool", label: "Tools", singularLabel: "Tool", icon: "fa-solid fa-toolbox" },
  { type: "consumable", label: "Consumables", singularLabel: "Consumable", icon: "fa-solid fa-flask" },
  { type: "loot", label: "Loot", singularLabel: "Loot", icon: "fa-solid fa-coins" }
]);

const LOOT_CATEGORY_LABELS = Object.freeze({
  "art-object": "Art Object",
  "adventuring-gear": "Adventuring Gear",
  gemstone: "Gemstone",
  titanite: "Titanite",
  junk: "Junk",
  material: "Material",
  resource: "Resource",
  "trade-good": "Trade Good",
  treasure: "Treasure"
});

const INVENTORY_CURRENCY_DEFINITIONS = Object.freeze([
  { key: "gp", label: "GP", tooltip: "Gold Piece", icon: "systems/peasant-core/ui/currency/gp.webp" },
  { key: "pp", label: "PP", tooltip: "Platinum Piece", icon: "systems/peasant-core/ui/currency/pp.webp" },
  { key: "rs", label: "RS", tooltip: "Red Steel", icon: "systems/peasant-core/ui/currency/rs.webp" }
]);

const EQUIPPABLE_ITEM_TYPES = new Set(["weapon", "equipment", "tool", "consumable"]);

function getDefaultItemImage() {
  return foundry?.utils?.getProperty?.(CONFIG, "Item.documentClass.DEFAULT_ICON")
    || foundry?.utils?.getProperty?.(CONFIG, "Item.defaultIcon")
    || "icons/svg/item-bag.svg";
}

function formatNumberInput(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : String(fallback);
}

function getLootCategoryLabel(category) {
  return LOOT_CATEGORY_LABELS[String(category ?? "")] ?? "Loot";
}

function getItemSubtitle(item, definition) {
  if (item.type === "loot") return getLootCategoryLabel(item.system?.category);
  return definition?.singularLabel ?? item.type;
}

function getItemSearchText(item, definition) {
  return [
    item.name,
    item.type,
    definition?.label,
    definition?.singularLabel,
    item.type === "loot" ? getLootCategoryLabel(item.system?.category) : ""
  ].filter(Boolean).join(" ").toLowerCase();
}

function getEmptyItemMetric(label) {
  return {
    kind: "none",
    label,
    hasValue: false,
    display: "-"
  };
}

function getItemMetric({ kind, label, current, max }) {
  const safeCurrent = Math.max(0, Number.parseInt(current, 10) || 0);
  const safeMax = Math.max(0, Number.parseInt(max, 10) || 0);
  return {
    kind,
    label,
    hasValue: safeCurrent !== 0 || safeMax !== 0,
    current: safeCurrent,
    max: safeMax,
    currentInput: formatNumberInput(safeCurrent),
    maxInput: formatNumberInput(safeMax)
  };
}

function getItemSunder(item) {
  if (!["weapon", "equipment", "tool"].includes(item.type)) return getEmptyItemMetric("Sunder");
  return getItemMetric({
    kind: "sunder",
    label: "Sunder",
    current: item.system?.sunder?.current,
    max: item.system?.sunder?.max
  });
}

function getItemCharges(item) {
  if (item.type !== "consumable") return getEmptyItemMetric("Charges");
  return getItemMetric({
    kind: "uses",
    label: "Charges",
    current: item.system?.uses?.value,
    max: item.system?.uses?.max
  });
}

function sortItems(left, right) {
  const leftSort = Number(left?.sort ?? 0);
  const rightSort = Number(right?.sort ?? 0);
  if (leftSort !== rightSort) return leftSort - rightSort;
  return String(left?.name ?? "").localeCompare(String(right?.name ?? ""));
}

async function prepareInventoryItem(item, definition) {
  const name = item.name ?? "";
  const canEquip = EQUIPPABLE_ITEM_TYPES.has(item.type);
  const equipped = canEquip && !!item.system?.equipped;
  return {
    id: item.id,
    uuid: item.uuid,
    name,
    type: item.type,
    sort: Number(item.sort ?? 0),
    sortName: String(name).toLowerCase(),
    img: item.img || getDefaultItemImage(),
    subtitle: getItemSubtitle(item, definition),
    searchText: getItemSearchText(item, definition),
    hasEquippedMarker: canEquip,
    equipped,
    equippedTooltip: equipped ? "Unequip" : "Equip",
    quantity: Math.max(0, Number.parseInt(item.system?.quantity, 10) || 0),
    quantityInput: formatNumberInput(item.system?.quantity, 1),
    sunder: getItemSunder(item),
    charges: getItemCharges(item)
  };
}

function sortPreparedItems(left, right) {
  const leftSort = Number(left?.sort ?? 0);
  const rightSort = Number(right?.sort ?? 0);
  if (leftSort !== rightSort) return leftSort - rightSort;
  return String(left?.name ?? "").localeCompare(String(right?.name ?? ""));
}

export async function prepareActorInventoryContext(data, actor) {
  const items = Array.from(actor?.items ?? []);
  const currency = actor?.system?.currency ?? {};
  const uselessCollectionRaw = actor?.system?.uselessCollection;
  const uselessCollection = (uselessCollectionRaw && typeof uselessCollectionRaw === "object")
    ? uselessCollectionRaw.value
    : uselessCollectionRaw;
  const sections = [];

  for (const definition of PC_INVENTORY_SECTION_DEFINITIONS) {
    const sectionItems = items
      .filter(item => item.type === definition.type)
      .sort(sortItems);
    const preparedItems = await Promise.all(sectionItems.map(item => prepareInventoryItem(item, definition)));
    const visible = preparedItems.length > 0;
    sections.push({
      ...definition,
      count: preparedItems.length,
      visible,
      items: preparedItems
    });
  }

  data.inventorySections = sections;
  data.inventoryFlatSection = {
    type: "contents",
    label: "Contents",
    icon: "fa-solid fa-layer-group",
    count: sections.reduce((total, section) => total + section.count, 0),
    visible: sections.some(section => section.count > 0),
    items: sections.flatMap(section => section.items).sort(sortPreparedItems)
  };
  data.hasInventoryItems = sections.some(section => section.count > 0);
  data.inventoryDropEnabled = !!data.editable;
  data.inventoryCurrency = INVENTORY_CURRENCY_DEFINITIONS.map((entry) => ({
    ...entry,
    value: Math.max(0, Number.parseInt(currency[entry.key], 10) || 0)
  }));
  data.inventoryUselessCollection = Math.max(0, Number.parseInt(uselessCollection, 10) || 0);
}
