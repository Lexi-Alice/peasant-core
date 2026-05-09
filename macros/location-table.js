// Location Table Macro
// Uses the same shared location-table flow as automated attacks so chat output stays identical.

(async () => {
  const drawLocationTable = game.peasantCore?.drawLocationTable;

  if (typeof drawLocationTable === "function") {
    await drawLocationTable();
    return;
  }

  ui.notifications.error("Shared location-table helper is not available.");
})();
