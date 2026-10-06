import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  prepareActorIdentityContext,
  prepareActorSheetBaseContext
} from "../module/data/actor/sheet-display/base.mjs";

globalThis.game = {
  settings: {
    get: (_scope, key) => key === "sirLocationOptions"
      ? {
          version: 2,
          entries: [
            { key: "sirGrimmstad", label: "Grimmstad" },
            { key: "customSirLocation1", label: "Moonfall" }
          ]
        }
      : undefined
  }
};

const actor = {
  system: {
    sirGrimmstad: 3,
    customSirs: { customSirLocation1: -2 }
  },
  getFlag: () => undefined
};
const sourceSystem = {
  sirGrimmstad: 0,
  customSirs: { customSirLocation1: 1 }
};

const viewData = {};
prepareActorSheetBaseContext(viewData, actor, { isEditMode: false, sourceSystem });
assert.equal(
  viewData.sirLocations.find(sir => sir.field === "sirGrimmstad")?.value,
  3,
  "View mode should display the Active Effect-prepared SIR value"
);
assert.equal(
  viewData.sirLocations.find(sir => sir.field === "sirGrimmstad")?.displayValue,
  "+3",
  "Positive built-in SIR values should display with a plus sign"
);
assert.deepEqual(
  viewData.sirLocations.find(sir => sir.key === "customSirLocation1"),
  {
    key: "customSirLocation1",
    field: undefined,
    label: "Moonfall",
    isCustom: true,
    inputName: "system.customSirs.customSirLocation1",
    value: -2,
    displayValue: "-2"
  },
  "View mode should expose a numeric custom SIR row"
);

const editData = {};
prepareActorSheetBaseContext(editData, actor, { isEditMode: true, sourceSystem });
assert.equal(
  editData.sirLocations.find(sir => sir.field === "sirGrimmstad")?.value,
  0,
  "Edit mode should display the stored source SIR value"
);
assert.equal(
  editData.sirLocations.find(sir => sir.key === "customSirLocation1")?.value,
  1,
  "Edit mode should use the stored custom SIR value"
);

const identityData = {};
prepareActorIdentityContext(identityData, {
  system: {
    finalHeraldry: "Custom",
    customFinalHeraldry: "River Clan",
    origin: "Grimmstad",
    specificOrigin: "Soldier"
  }
}, { isEditMode: false });
assert.equal(identityData.displayFinalHeraldry, "River Clan");
assert.equal(identityData.customFinalHeraldrySelected, true);

const actorSheetTemplate = readFileSync(new URL("../templates/actor/character-sheet.html", import.meta.url), "utf8");
assert.match(actorSheetTemplate, /<select name="system\.finalHeraldry"/);
assert.match(actorSheetTemplate, /name="system\.customFinalHeraldry"[^>]*placeholder="Custom Final Heraldry"/);

delete globalThis.game;
