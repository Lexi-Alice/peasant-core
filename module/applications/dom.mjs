export function toElement(source) {
  const candidate = source?.element ?? source;
  if (!candidate) return null;
  if (candidate.nodeType === 1 && typeof candidate.querySelector === "function") return candidate;
  if (typeof jQuery !== "undefined" && candidate instanceof jQuery) return candidate[0] ?? null;
  if (Array.isArray(candidate)) return toElement(candidate[0]);
  const first = candidate?.[0];
  return first?.nodeType === 1 && typeof first.querySelector === "function" ? first : null;
}

export function qs(root, selector) {
  return toElement(root)?.querySelector(selector) ?? null;
}

export function qsa(root, selector) {
  return Array.from(toElement(root)?.querySelectorAll(selector) ?? []);
}

export function delegate(root, type, selector, handler, options) {
  const element = toElement(root);
  if (!element) return () => {};
  const listener = (event) => {
    const target = event.target?.closest?.(selector);
    if (!target || !element.contains(target)) return;
    return handler(event, target);
  };
  element.addEventListener(type, listener, options);
  return () => element.removeEventListener(type, listener, options);
}

export function readStringInput(root, selector, fallback = "") {
  const input = typeof selector === "string" ? qs(root, selector) : selector;
  return String(input?.value ?? fallback);
}

export function readNumberInput(root, selector, fallback = 0) {
  const value = Number.parseInt(readStringInput(root, selector, ""), 10);
  return Number.isFinite(value) ? value : fallback;
}

export function setHidden(element, hidden) {
  if (!element) return;
  element.hidden = !!hidden;
  if (hidden) element.setAttribute("aria-hidden", "true");
  else element.removeAttribute("aria-hidden");
}
