import { setupAdvantageDeleteBackupHandler, setupAdvantageRowControls } from "./advantage-row-controls.mjs";
import { setupSkillDeleteBackupHandler, setupSkillRowControls } from "./skill-row-controls.mjs";

export function setupBasicSkillAdvantageControls(sheet, html, { blurActiveEditableInSheet, collectAdvantagesFromDOM, enqueueSheetUpdate, runQueuedInputUpdate } = {}) {
  const enqueue = enqueueSheetUpdate ?? (async (_queueKey, _label, task) => task());
  const runQueued = runQueuedInputUpdate ?? (async (_input, _queueKey, _label, task) => task());

  setupSkillRowControls(sheet, html, { blurActiveEditableInSheet, enqueue, runQueued });
  setupAdvantageRowControls(sheet, html, { blurActiveEditableInSheet, collectAdvantagesFromDOM, enqueueSheetUpdate });
  setupSkillDeleteBackupHandler(sheet, html, { blurActiveEditableInSheet, enqueue });
  setupAdvantageDeleteBackupHandler(sheet, html, { blurActiveEditableInSheet, collectAdvantagesFromDOM, enqueue });
}
