import { escapeHtml } from "../../../utils/chat.mjs";

export function renderNotableCombatTagList($list, activeTags, { editable = true, provisionalTag = null } = {}) {
  $list.empty();

  const rows = provisionalTag ? [...activeTags, provisionalTag] : activeTags;
  if (rows.length === 0) {
    $list.html('<div class="pc-skill-tag-empty">No details configured.</div>');
    return;
  }

  for (const [index, row] of rows.entries()) {
    const provisional = row === provisionalTag;
    const draggable = editable && !provisional;
    const customIndexAttr = Number.isInteger(row.customIndex) ? ` data-custom-index="${row.customIndex}"` : "";
    const customIdAttr = row.customId ? ` data-custom-id="${escapeHtml(row.customId)}"` : "";
    const summary = row.summary
      ? `<span class="pc-skill-tag-summary">${escapeHtml(row.summary)}</span>`
      : "";
    const condition = row.condition
      ? `<span class="pc-skill-tag-condition">${escapeHtml(row.condition)}</span>`
      : "";

    const summaryContent = `
      ${editable ? '<span class="pc-skill-tag-disclosure" aria-hidden="true"><i class="fa-solid fa-chevron-right"></i></span>' : ""}
      <span class="pc-skill-tag-name-line"><span class="pc-skill-tag-name">${escapeHtml(row.label)}</span>${condition}</span>
      ${summary}
    `;
    const summaryControl = editable
      ? `<button type="button" class="pc-skill-tag-row-summary" data-pc-tag-edit data-tooltip="Edit ${escapeHtml(row.label)}" aria-label="Edit ${escapeHtml(row.label)}">${summaryContent}</button>`
      : `<div class="pc-skill-tag-row-summary">${summaryContent}</div>`;
    const rowControls = editable && !provisional ? `
      <button type="button" class="pc-inventory-menu-toggle header-control icon fa-solid fa-ellipsis-vertical"
        data-pc-tag-menu data-tooltip="Detail Options" aria-label="Detail Options"></button>
    ` : "";

    $list.append($(`
      <div class="current-tag-item${draggable ? " editor-tag-draggable" : ""} pc-skill-tag-row${editable ? "" : " pc-skill-tag-row-readonly"}${provisional ? " pc-skill-tag-row-provisional" : ""}"
        data-tag-type="${escapeHtml(row.type)}"
        data-tag-key="${escapeHtml(row.key || row.type)}"
        data-tag-index="${index}"${customIndexAttr}${customIdAttr}${provisional ? " data-pc-tag-provisional" : ""}${draggable ? ' draggable="true"' : ""}>
        ${summaryControl}
        ${rowControls}
      </div>
    `));
  }
}
