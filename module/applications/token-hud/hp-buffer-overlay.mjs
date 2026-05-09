import { findBarBrawlBarByAttribute } from "../../integrations/bar-brawl.mjs";

function getHpBufferData(actor) {
  const temp = Number(actor?.system?.temporaryHp?.value) || 0;
  const bolstered = Number(actor?.system?.bolsteredHp) || 0;
  const buffer = temp + bolstered;
  const max = Number(actor?.system?.health?.max)
    || (Number(actor?.system?.hp?.rows) || 0) * (Number(actor?.system?.hp?.cols) || 0);
  return { buffer, max };
}

function findHealthBarContainer(token) {
  if (!token?.bars) return null;
  const barsContainer = token.bars;
  const healthBar = findBarBrawlBarByAttribute(token.document, "health");
  if (healthBar) {
    return barsContainer.children.find(child => child.name === healthBar.id) || null;
  }
  return barsContainer.children.find(child => child.name === "bar1") || null;
}

function refreshBarCache(bar) {
  try {
    if (bar?.cacheAsBitmap) {
      const res = bar.cacheAsBitmapResolution;
      bar.cacheAsBitmap = false;
      bar.cacheAsBitmapResolution = res;
      bar.cacheAsBitmap = true;
    }
  } catch (e) { /* ignore */ }
}

function renderHpBufferOverlay(token) {
  const actor = token?.actor;
  if (!actor) return true;
  const bar = findHealthBarContainer(token);
  if (!bar) return false;

  const { buffer, max } = getHpBufferData(actor);
  const overlayName = "peasant-buffer-overlay";
  let overlay = bar.getChildByName(overlayName);

  if (!buffer || !max) {
    if (overlay) {
      overlay.destroy({ children: true });
      refreshBarCache(bar);
    }
    return true;
  }

  const pct = Math.min(Math.max(buffer / max, 0), 1);
  if (pct <= 0) {
    if (overlay) {
      overlay.destroy({ children: true });
      refreshBarCache(bar);
    }
    return true;
  }

  const width = (bar.contentWidth || 0) * pct;
  const height = bar.contentHeight || 0;
  if (!width || !height) return false;

  if (!overlay) {
    overlay = new PIXI.Graphics();
    overlay.name = overlayName;
  } else {
    overlay.clear();
  }

  const radius = Math.max(0, Math.min(2, height / 2));
  const startX = Math.max(0, (bar.contentWidth || 0) - width);
  overlay.beginFill(0xC0C0C0, 0.75);
  overlay.drawRoundedRect(0, 0, width, height, radius);
  overlay.endFill();
  overlay.x = startX;
  overlay.y = 0;

  const label = bar.getChildByName(`${bar.name}-text`);
  if (!overlay.parent) {
    if (label) {
      const idx = bar.getChildIndex(label);
      bar.addChildAt(overlay, Math.max(0, idx));
    } else {
      bar.addChild(overlay);
    }
  } else if (label) {
    const idx = bar.getChildIndex(label);
    if (bar.getChildIndex(overlay) > idx) bar.setChildIndex(overlay, idx);
  }

  refreshBarCache(bar);
  return true;
}

export function scheduleHpBufferOverlay(token) {
  if (!token) return;
  if (token._peasantOverlayScheduled) return;
  token._peasantOverlayScheduled = true;

  let attempts = 0;
  const attempt = () => {
    attempts++;
    const done = renderHpBufferOverlay(token);
    if (!done && attempts < 5) {
      setTimeout(attempt, 50);
    } else {
      token._peasantOverlayScheduled = false;
    }
  };
  setTimeout(attempt, 0);
}

export function registerHpBufferOverlayHooks() {
  Hooks.on("drawToken", (token) => {
    try { scheduleHpBufferOverlay(token); } catch (e) { /* ignore */ }
  });

  Hooks.on("refreshToken", (token) => {
    try { scheduleHpBufferOverlay(token); } catch (e) { /* ignore */ }
  });

  Hooks.on("updateActor", (actor, changes) => {
    try {
      const hasTemp = foundry.utils.hasProperty(changes, "system.temporaryHp.value") || foundry.utils.hasProperty(changes, "system.temporaryHp");
      const hasBolstered = foundry.utils.hasProperty(changes, "system.bolsteredHp");
      const hasHealth = foundry.utils.hasProperty(changes, "system.health.value") || foundry.utils.hasProperty(changes, "system.health");
      if (!hasTemp && !hasBolstered && !hasHealth) return;
      const tokens = actor.getActiveTokens?.(true, true) || actor.getActiveTokens?.() || [];
      for (const token of tokens) scheduleHpBufferOverlay(token);
    } catch (e) { /* ignore */ }
  });
}
