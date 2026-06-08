import { formatThresholdValue } from "../../data/actor/sheet-settings.mjs";
import { getForcePassSpendTypeLabel } from "../../data/actor/stress.mjs";

export async function markRollFailureDueToDefense(rollResult, { label = "Failure due to Defense" } = {}) {
  return updateSkillRollChatCardFromResult(rollResult, { label });
}

export async function updateSkillRollChatCardFromResult(rollResult, { label = null } = {}) {
  if (!rollResult?.chatMessage?.update) return;

  const content = String(rollResult.chatMessage.content || "");
  if (!content) return;

  const container = document.createElement("div");
  container.innerHTML = content;

  const skillRollCard = container.querySelector(".skill-roll-card");
  if (!(skillRollCard instanceof HTMLElement)) return;

  const topRow = skillRollCard.querySelector(":scope > div:nth-child(2) > div");
  const statBoxes = topRow?.children;
  const toHitBox = statBoxes?.[0];
  if (toHitBox instanceof HTMLElement && Number.isFinite(Number(rollResult?.toHit))) {
    const toHitSpans = toHitBox.querySelectorAll("span");
    if (toHitSpans.length >= 2) {
      toHitSpans[1].textContent = `${Number(rollResult.toHit)}+`;
    }
  }

  const mosButton = container.querySelector(".mos-toggle");
  if (mosButton instanceof HTMLElement) {
    const totalMoS = Number(rollResult?.totalMoS);
    if (Number.isFinite(totalMoS)) {
      mosButton.textContent = formatThresholdValue(totalMoS);
    }
    mosButton.style.color = rollResult?.isSuccess ? "#4ade80" : "#f87171";
    mosButton.style.border = rollResult?.isSuccess ? "2px solid #22c55e" : "2px solid #dc2626";
  }

  const rollDetails = container.querySelector(".roll-details");
  if (rollDetails instanceof HTMLElement) {
    const detailLines = Array.from(rollDetails.children).filter((child) => child instanceof HTMLElement);
    const baseMosLine = detailLines.find((child) => child.textContent?.trim().startsWith("Base MoS:"));
    if (baseMosLine instanceof HTMLElement && Number.isFinite(Number(rollResult?.baseMoS))) {
      const baseMoS = Number(rollResult.baseMoS);
      baseMosLine.textContent = `Base MoS: ${baseMoS >= 0 ? "+" : ""}${baseMoS.toFixed(2)}`;
    }

    let accuracyLine = detailLines.find((child) => child.textContent?.trim().startsWith("Accuracy:"));
    const accuracyValue = rollResult?.accuracy;
    const hasAccuracyValue = !(accuracyValue === undefined || accuracyValue === null || accuracyValue === "");
    if (hasAccuracyValue) {
      const normalizedAccuracy = Number.parseInt(accuracyValue, 10) || 0;
      if (!(accuracyLine instanceof HTMLElement)) {
        accuracyLine = document.createElement("div");
        if (baseMosLine instanceof HTMLElement && baseMosLine.nextSibling) {
          rollDetails.insertBefore(accuracyLine, baseMosLine.nextSibling);
        } else {
          rollDetails.appendChild(accuracyLine);
        }
      }
      accuracyLine.textContent = `Accuracy: ${normalizedAccuracy}`;
    } else if (accuracyLine instanceof HTMLElement) {
      accuracyLine.remove();
    }
  }

  const outcome = container.querySelector(".skill-roll-card .roll-details + div");
  if (outcome instanceof HTMLElement) {
    const outcomeLabel = String(label || rollResult?.resultText || (rollResult?.isSuccess ? "Success" : "Failure"));
    outcome.textContent = outcomeLabel;
    outcome.style.background = rollResult?.isSuccess ? "rgba(34, 197, 94, 0.2)" : "rgba(220, 38, 38, 0.2)";
    outcome.style.color = rollResult?.isSuccess ? "#4ade80" : "#f87171";
    outcome.style.border = rollResult?.isSuccess ? "1px solid #22c55e" : "1px solid #dc2626";
  }

  await rollResult.chatMessage.update({ content: container.innerHTML });
}

export async function markRollForcedPass(rollResult, { stressCost = 0, spendType = "general", noteLabel = "Forced Pass", setMoSToZero = true } = {}) {
  if (!rollResult?.chatMessage?.update) return;

  const content = String(rollResult.chatMessage.content || "");
  if (!content) return;

  const container = document.createElement("div");
  container.innerHTML = content;

  const mosButton = container.querySelector(".mos-toggle");
  if (mosButton instanceof HTMLElement) {
    const totalMoS = Number(rollResult?.totalMoS);
    mosButton.textContent = setMoSToZero || !Number.isFinite(totalMoS) ? "0" : formatThresholdValue(totalMoS);
    mosButton.style.color = "#4ade80";
    mosButton.style.border = "2px solid #22c55e";
  }

  const outcome = container.querySelector(".skill-roll-card .roll-details + div");
  if (outcome instanceof HTMLElement) {
    outcome.textContent = "Success";
    outcome.style.background = "rgba(34, 197, 94, 0.2)";
    outcome.style.color = "#4ade80";
    outcome.style.border = "1px solid #22c55e";
  }

  const rollDetails = container.querySelector(".roll-details");
  if (rollDetails instanceof HTMLElement) {
    const detailLines = Array.from(rollDetails.children).filter((child) => child instanceof HTMLElement);
    const baseMosLine = detailLines.find((child) => child.textContent?.trim().startsWith("Base MoS:"));
    if (baseMosLine instanceof HTMLElement && Number.isFinite(Number(rollResult?.baseMoS))) {
      const baseMoS = Number(rollResult.baseMoS);
      baseMosLine.textContent = `Base MoS: ${baseMoS >= 0 ? "+" : ""}${baseMoS.toFixed(2)}`;
    }

    let note = rollDetails.querySelector(".pc-force-pass-note");
    if (!(note instanceof HTMLElement)) {
      note = document.createElement("div");
      note.className = "pc-force-pass-note";
      rollDetails.appendChild(note);
    }
    note.textContent = `${noteLabel}: ${stressCost} ${getForcePassSpendTypeLabel(spendType)}`;
    note.style.color = "#e0e0e0";
    note.style.marginTop = "0";
    note.style.fontWeight = "normal";
  }

  await rollResult.chatMessage.update({ content: container.innerHTML });
}
