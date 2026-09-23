import { delegate, toElement } from "../../dom.mjs";

export function setupSkillUsageSelectionControls(container, { onSelect } = {}) {
  const root = toElement(container);
  if (!root) return;

  delegate(root, "change", "[data-pc-usage-select]", (_event, select) => {
    const usageId = String(select.value ?? "").trim();
    onSelect?.(usageId);
  });
}
