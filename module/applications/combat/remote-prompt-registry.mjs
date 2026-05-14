import { pcLog } from "../../utils/logging.mjs";

const ACTIVE_REMOTE_PROMPTS = new Map();
const CANCELLED_REMOTE_PROMPTS = new Set();

export function registerActiveRemotePrompt(promptId, closer) {
  const key = String(promptId || "").trim();
  if (!key || typeof closer !== "function") return;
  ACTIVE_REMOTE_PROMPTS.set(key, closer);
  if (CANCELLED_REMOTE_PROMPTS.has(key)) {
    CANCELLED_REMOTE_PROMPTS.delete(key);
    queueMicrotask(() => {
      void closer({ selection: "close", chainCancelled: true });
    });
  }
}

export function unregisterActiveRemotePrompt(promptId, closer = null) {
  const key = String(promptId || "").trim();
  if (!key) return;
  if (closer && ACTIVE_REMOTE_PROMPTS.get(key) !== closer) return;
  ACTIVE_REMOTE_PROMPTS.delete(key);
}

export async function closeActiveRemotePrompt(promptId, result = {}) {
  const key = String(promptId || "").trim();
  if (!key) return false;
  const closer = ACTIVE_REMOTE_PROMPTS.get(key);
  if (typeof closer !== "function") {
    CANCELLED_REMOTE_PROMPTS.add(key);
    return false;
  }
  try {
    await closer(result);
    return true;
  } catch (e) {
    pcLog.debug("Peasant Core | Failed to close active remote prompt", { promptId: key, error: e });
    return false;
  }
}
