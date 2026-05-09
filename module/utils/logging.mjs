const SYSTEM_ID = "peasant-core";
const DEBUG_SETTING = "debugLogging";

export function registerDebugLoggingSetting() {
  game.settings.register(SYSTEM_ID, DEBUG_SETTING, {
    name: "Debug Logging",
    hint: "Emit verbose Peasant Core diagnostics to the browser console.",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });
}

function isDebugLoggingEnabled() {
  try {
    return !!game.settings.get(SYSTEM_ID, DEBUG_SETTING);
  } catch (e) {
    return false;
  }
}

export const pcLog = {
  debug: (...args) => {
    if (isDebugLoggingEnabled()) console.debug(...args);
  },
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args)
};
