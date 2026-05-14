export function setupSheetKeyboardNavigation(sheet, html, { sheetDocument } = {}) {
  if (!sheetDocument) return;

  const getEditModeInputs = () => {
    const allInputs = html.find('input:not([type="checkbox"]):not([type="hidden"]), select, .advantage-input, .editor-content[contenteditable="true"], .ProseMirror[contenteditable="true"]').toArray();

    const filtered = allInputs.filter(el => {
      try {
        const $el = $(el);

        if ($el.closest(".hidden").length) return false;
        if ($el.closest('[style*="display: none"]').length) return false;
        if ($el.closest('[style*="display:none"]').length) return false;

        if ($el.closest(".blessing-menu, .wounds-menu, .damage-controls, .heal-controls, .stress-damage-controls, .stress-heal-controls").length) return false;

        if ($el.hasClass("skill-select")) return false;

        const name = $el.attr("name") || "";
        if (name === "system.race" || name === "system.origin" || name === "system.specificOrigin") return false;

        if ($el.hasClass("edge-base-label-mode") || $el.hasClass("edge-resource-label-mode") || $el.hasClass("edge-label-mode")) return false;

        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;

        return true;
      } catch (e) { return false; }
    });

    return sortByVisualPosition(filtered);
  };

  const getViewModeElements = () => {
    const selectors = [
      ".damage-toggle",
      ".heal-toggle",
      ".stress-damage-toggle",
      ".stress-heal-toggle",
      ".stress-refresh",
      ".hp-tn-clickable",
      ".attr-save-clickable",
      ".attr-reflex-aoe-save-clickable",
      ".attr-tohit-clickable",
      'input[name="system.stamina.value"]',
      'input[name="system.attunement.value"]',
      'input[name="system.capacity.value"]',
      'input[name="system.edge.value"]',
      ".edge-resource-current",
      ".bolstered-hp-input",
      ".temporary-hp-input",
      ".combat-mod-input",
      'input[name="system.combatMods.toHit"]',
      'input[name="system.combatMods.accuracy"]',
      'input[name="system.combatMods.diceRate"]',
      ".combat-flat-buff-input",
      ".combat-cost-buff-value",
      ".combat-cost-buff-resource",
      ".combat-halt-buff-input",
      ".add-combat-halt-buff",
      ".remove-combat-halt-buff",
      ".resource-refresh",
      ".initiative-clickable",
      ".skill-name-wrapper[tabindex]",
      ".skill-roll-clickable[tabindex]",
      ".skill-uses-current",
      ".combat-name-wrapper[tabindex]",
      ".combat-roll-clickable[tabindex]",
      ".combat-tag-rollable",
      ".combat-uses-current",
      ".combat-tag-uses-current"
    ];

    const allElements = html.find(selectors.join(", ")).toArray();

    const filtered = allElements.filter(el => {
      try {
        const $el = $(el);

        if ($el.closest(".hidden").length) return false;
        if ($el.closest('[style*="display: none"]').length) return false;
        if ($el.closest('[style*="display:none"]').length) return false;

        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;

        return true;
      } catch (e) { return false; }
    });

    return sortByVisualPosition(filtered);
  };

  const sortByVisualPosition = (elements) => {
    const withPos = elements.map(el => {
      const rect = el.getBoundingClientRect();
      return { el, top: rect.top, left: rect.left };
    });

    withPos.sort((a, b) => {
      if (Math.abs(a.top - b.top) < 10) {
        return a.left - b.left;
      }
      return a.top - b.top;
    });

    return withPos.map(p => p.el);
  };

  const findNextElement = (currentEl, direction, elements) => {
    if (elements.length === 0) return null;

    const currentIndex = elements.indexOf(currentEl);

    if (currentIndex === -1) {
      const currentRect = currentEl.getBoundingClientRect();
      let bestIndex = 0;
      let bestDist = Infinity;

      for (let i = 0; i < elements.length; i++) {
        const rect = elements[i].getBoundingClientRect();
        const dist = Math.abs(rect.top - currentRect.top) * 2 + Math.abs(rect.left - currentRect.left);
        if (dist < bestDist) {
          bestDist = dist;
          bestIndex = i;
        }
      }

      if (direction === "right" || direction === "down") {
        return elements[Math.min(bestIndex + 1, elements.length - 1)] || null;
      }
      return elements[Math.max(bestIndex - 1, 0)] || null;
    }

    if (direction === "left") {
      return currentIndex > 0 ? elements[currentIndex - 1] : null;
    }
    if (direction === "right") {
      return currentIndex < elements.length - 1 ? elements[currentIndex + 1] : null;
    }

    const currentRect = currentEl.getBoundingClientRect();
    let bestCandidate = null;
    let bestScore = Infinity;
    const minVerticalDiff = 15;

    for (let i = 0; i < elements.length; i++) {
      if (i === currentIndex) continue;
      const rect = elements[i].getBoundingClientRect();

      if (direction === "up") {
        if (rect.top >= currentRect.top - minVerticalDiff) continue;
        const vertDist = currentRect.top - rect.top;
        const horizDist = Math.abs(rect.left - currentRect.left);
        const score = vertDist + horizDist * 0.5;
        if (score < bestScore) {
          bestScore = score;
          bestCandidate = elements[i];
        }
      } else if (direction === "down") {
        if (rect.top <= currentRect.top + minVerticalDiff) continue;
        const vertDist = rect.top - currentRect.top;
        const horizDist = Math.abs(rect.left - currentRect.left);
        const score = vertDist + horizDist * 0.5;
        if (score < bestScore) {
          bestScore = score;
          bestCandidate = elements[i];
        }
      }
    }

    return bestCandidate;
  };

  const focusElement = (el) => {
    if (!el) return;
    el.focus();
    if (el.tagName === "INPUT" && el.select) {
      try { el.select(); } catch (e) { /* ignore */ }
    }
    if (el.tagName !== "INPUT" && el.tagName !== "SELECT") {
      if (!el.hasAttribute("tabindex")) {
        el.setAttribute("tabindex", "-1");
      }
    }
  };

  const handleArrowKey = (ev) => {
    const sheetRoot = html?.[0] ?? null;
    const eventTarget = ev.target;
    if (sheetRoot && eventTarget && eventTarget !== sheetRoot && !sheetRoot.contains(eventTarget)) return;

    const isEditMode = sheet?.isEditMode;
    const el = ev.target;
    if (!el) return;

    const tag = el.tagName;
    const isContentEditable = el.isContentEditable || el.classList?.contains("ProseMirror") || el.classList?.contains("editor-content");

    const isNavigableElement = (
      tag === "INPUT" ||
      tag === "SELECT" ||
      tag === "BUTTON" ||
      isContentEditable ||
      el.classList?.contains("attr-save-clickable") ||
      el.classList?.contains("attr-reflex-aoe-save-clickable") ||
      el.classList?.contains("attr-tohit-clickable") ||
      el.classList?.contains("hp-tn-clickable") ||
      el.classList?.contains("skill-roll-clickable") ||
      el.classList?.contains("initiative-clickable") ||
      el.classList?.contains("damage-toggle") ||
      el.classList?.contains("heal-toggle") ||
      el.classList?.contains("stress-damage-toggle") ||
      el.classList?.contains("stress-heal-toggle") ||
      el.classList?.contains("stress-refresh") ||
      el.classList?.contains("resource-refresh") ||
      el.classList?.contains("combat-roll-clickable") ||
      el.classList?.contains("combat-tag-rollable") ||
      el.classList?.contains("skill-name-wrapper") ||
      el.classList?.contains("combat-name-wrapper") ||
      el.classList?.contains("combat-mod-input") ||
      el.classList?.contains("bolstered-hp-input") ||
      el.classList?.contains("temporary-hp-input")
    );

    if (ev.ctrlKey || ev.metaKey || ev.shiftKey) return;

    const key = ev.key;

    if (!isEditMode && (key === "Enter" || key === " ")) {
      if (el.tagName !== "INPUT" && el.tagName !== "SELECT") {
        ev.preventDefault();
        el.click();
        return;
      }
    }

    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) return;

    const elements = isEditMode ? getEditModeInputs() : getViewModeElements();

    if (!isNavigableElement && elements.length > 0) {
      ev.preventDefault();
      if (key === "ArrowDown" || key === "ArrowRight") {
        focusElement(elements[0]);
      } else {
        focusElement(elements[elements.length - 1]);
      }
      return;
    }

    if (isEditMode) {
      if (!(tag === "INPUT" || tag === "SELECT" || isContentEditable)) return;

      if (tag === "INPUT" && el.type === "number") {
        if (key === "ArrowUp" || key === "ArrowDown") {
          ev.preventDefault();
          const direction = key === "ArrowUp" ? "up" : "down";
          const nextEl = findNextElement(el, direction, elements);
          if (nextEl) focusElement(nextEl);
          return;
        }
        if (key === "ArrowLeft" || key === "ArrowRight") {
          ev.preventDefault();
          const direction = key === "ArrowLeft" ? "left" : "right";
          const nextEl = findNextElement(el, direction, elements);
          if (nextEl) focusElement(nextEl);
          return;
        }
      }

      if (tag === "SELECT") {
        if (key === "ArrowUp" || key === "ArrowDown") return;
        ev.preventDefault();
        const direction = key === "ArrowLeft" ? "left" : "right";
        const nextEl = findNextElement(el, direction, elements);
        if (nextEl) focusElement(nextEl);
        return;
      }

      if (isContentEditable) {
        if (key === "ArrowUp" || key === "ArrowDown") {
          ev.preventDefault();
          const direction = key === "ArrowUp" ? "up" : "down";
          const nextEl = findNextElement(el, direction, elements);
          if (nextEl) focusElement(nextEl);
        }
        return;
      }

      let direction = null;
      const selStart = (typeof el.selectionStart === "number") ? el.selectionStart : null;
      const selEnd = (typeof el.selectionEnd === "number") ? el.selectionEnd : null;
      if (selStart !== null && selEnd !== null && selStart !== selEnd) return;
      if (key === "ArrowUp") direction = "up";
      else if (key === "ArrowDown") direction = "down";
      else if (key === "ArrowLeft") {
        if (selStart === 0 && selEnd === 0) {
          direction = "left";
        }
      } else if (key === "ArrowRight") {
        const len = (el.value || "").length;
        if (selStart === len && selEnd === len) {
          direction = "right";
        }
      }

      if (!direction) return;

      ev.preventDefault();
      const nextEl = findNextElement(el, direction, elements);
      if (nextEl) focusElement(nextEl);
      return;
    }

    let direction = null;
    if (key === "ArrowUp") direction = "up";
    else if (key === "ArrowDown") direction = "down";
    else if (key === "ArrowLeft") direction = "left";
    else if (key === "ArrowRight") direction = "right";

    if (!direction) return;

    if (tag === "INPUT") {
      const isNumberInput = el.type === "number";

      if (!isNumberInput) {
        const selStart = (typeof el.selectionStart === "number") ? el.selectionStart : null;
        const selEnd = (typeof el.selectionEnd === "number") ? el.selectionEnd : null;
        if (selStart !== null && selEnd !== null && selStart !== selEnd) return;
        if (key === "ArrowLeft" && selStart !== 0) return;
        if (key === "ArrowRight") {
          const len = (el.value || "").length;
          if (selStart !== len) return;
        }
      }

      if (isNumberInput && (key === "ArrowUp" || key === "ArrowDown")) {
        ev.preventDefault();
      }
    }

    ev.preventDefault();
    const nextEl = findNextElement(el, direction, elements);
    if (nextEl) focusElement(nextEl);
  };

  sheet._teardownSheetEventBindings();
  sheetDocument.addEventListener("keydown", handleArrowKey, true);
  sheet._sheetKeydownRoot = sheetDocument;
  sheet._sheetKeydownHandler = handleArrowKey;
}
