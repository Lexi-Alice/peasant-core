export async function performPeasantShortRest(sheet) {
  if (!canUseRestControls(sheet)) return;

  await sheet.actor.performPeasantShortRest?.();
  ui.notifications?.info?.("Short rest complete.");
}

export async function performPeasantLongRest(sheet) {
  if (!canUseRestControls(sheet)) return;

  await sheet.actor.performPeasantLongRest?.();
  ui.notifications?.info?.("Long rest complete.");
}

export async function confirmPeasantRest(sheet, restType) {
  const normalizedType = String(restType ?? "").trim().toLowerCase();
  if (normalizedType === "short") return confirmPeasantShortRest(sheet);
  if (normalizedType === "long") return confirmPeasantLongRest(sheet);

  ui.notifications?.warn?.("Unknown rest type.");
}

export async function confirmPeasantShortRest(sheet) {
  if (!canUseRestControls(sheet)) return;

  return sheet._renderDialog({
    title: "Short Rest",
    content: `
      <div style="padding: 4px 2px;">
        <p style="margin: 0; color: #e0e0e0;">Take a short rest and refresh stamina, attunement, armor charge, and short stresses?</p>
      </div>
    `,
    buttons: {
      yes: {
        icon: '<i class="fas fa-check"></i>',
        label: "Yes",
        callback: async () => {
          await performPeasantShortRest(sheet);
        }
      }
    },
    default: "yes"
  }, { classes: ["peasant-macro-dialog"] });
}

export async function confirmPeasantLongRest(sheet) {
  if (!canUseRestControls(sheet)) return;

  return sheet._renderDialog({
    title: "Long Rest",
    content: `
      <div style="padding: 4px 2px;">
        <p style="margin: 0 0 6px; color: #e0e0e0;">Take a long rest and refresh stamina, attunement, capacity, armor charge, short stress,</p>
        <p style="margin: 0; color: #e0e0e0;">set temporary HP to damaged HP, apply a cycle of natural healing, and general stress recovery?</p>
      </div>
    `,
    buttons: {
      yes: {
        icon: '<i class="fas fa-check"></i>',
        label: "Yes",
        callback: async () => {
          await performPeasantLongRest(sheet);
        }
      }
    },
    default: "yes"
  }, { classes: ["peasant-macro-dialog"] });
}

export async function confirmPeasantResourceRefresh(sheet, { title = "Refresh Resources", message = "Refresh resources and clear damage, stress, and wounds?" } = {}) {
  if (!canUseRestControls(sheet)) return;

  return sheet._renderDialog({
    title,
    content: `
      <div style="padding: 4px 2px;">
        <p style="margin: 0; color: #e0e0e0;">${sheet._escapeHtml(message)}</p>
      </div>
    `,
    buttons: {
      yes: {
        icon: '<i class="fas fa-check"></i>',
        label: "Yes",
        callback: async () => {
          await refreshPeasantResourcesAndResetTracks(sheet);
        }
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: "Cancel"
      }
    },
    default: "yes"
  }, { classes: ["peasant-macro-dialog"] });
}

export async function refreshPeasantResourcesAndResetTracks(sheet) {
  if (!canUseRestControls(sheet)) return;

  await sheet.actor.refreshPeasantResourcesAndResetTracks?.();
  ui.notifications?.info?.("Resources refreshed.");
}

function canUseRestControls(sheet) {
  return !!(sheet?.actor?.isOwner || game.user?.isGM);
}
