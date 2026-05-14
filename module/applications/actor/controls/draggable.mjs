export function makeDraggable(element, handle) {
  let isDragging = false;
  let currentX;
  let currentY;
  let initialX;
  let initialY;
  let xOffset = 0;
  let yOffset = 0;
  const dragDocument = element?.ownerDocument ?? handle?.ownerDocument ?? document;

  handle.addEventListener("mousedown", dragStart);
  dragDocument.addEventListener("mousemove", drag);
  dragDocument.addEventListener("mouseup", dragEnd);

  function dragStart(event) {
    if (event.target?.closest?.(".header-control, button, a, input, select, textarea, label")) return;
    initialX = event.clientX - xOffset;
    initialY = event.clientY - yOffset;
    isDragging = true;
  }

  function drag(event) {
    if (!isDragging) return;
    event.preventDefault();
    currentX = event.clientX - initialX;
    currentY = event.clientY - initialY;
    xOffset = currentX;
    yOffset = currentY;
    element.style.transform = `translate(${currentX}px, ${currentY}px)`;
  }

  function dragEnd() {
    isDragging = false;
  }
}

export function setupSheetDraggablePopups(html) {
  const pairs = [
    [".wounds-menu", ".wounds-menu-handle"],
    [".blessing-menu", ".blessing-menu-handle"],
    [".damage-controls", ".damage-controls-handle"],
    [".heal-controls", ".heal-controls-handle"],
    [".stress-damage-controls", ".stress-damage-controls-handle"],
    [".stress-heal-controls", ".stress-heal-controls-handle"]
  ];

  for (const [panelSelector, handleSelector] of pairs) {
    const panel = html.find(panelSelector)[0];
    const handle = html.find(handleSelector)[0];
    if (panel && handle) makeDraggable(panel, handle);
  }
}

export function applyInheritedThemeClasses($container, ...sources) {
  const inheritedThemeClasses = new Set(["themed"]);
  for (const source of sources) {
    const className = getClassName(source);
    for (const token of String(className || "").split(/\s+/)) {
      if (!token) continue;
      if (token.startsWith("theme-")) inheritedThemeClasses.add(token);
    }
  }
  $container.addClass(Array.from(inheritedThemeClasses).join(" "));
}

export function setupFixedWindowDrag(containerEl, handleEl, { dragDocument = null, ignoreSelector = "" } = {}) {
  if (!containerEl || !handleEl) return () => {};
  const doc = dragDocument ?? containerEl.ownerDocument ?? handleEl.ownerDocument ?? document;
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  const onMouseDown = (event) => {
    if (ignoreSelector && event.target?.closest?.(ignoreSelector)) return;
    isDragging = true;
    const rect = containerEl.getBoundingClientRect();
    dragOffsetX = event.clientX - rect.left;
    dragOffsetY = event.clientY - rect.top;
    containerEl.style.transform = "none";
    containerEl.style.left = `${rect.left}px`;
    containerEl.style.top = `${rect.top}px`;
    event.preventDefault();
  };

  const onMouseMove = (event) => {
    if (!isDragging) return;
    containerEl.style.left = `${event.clientX - dragOffsetX}px`;
    containerEl.style.top = `${event.clientY - dragOffsetY}px`;
  };

  const onMouseUp = () => {
    isDragging = false;
  };

  handleEl.addEventListener("mousedown", onMouseDown);
  doc.addEventListener("mousemove", onMouseMove);
  doc.addEventListener("mouseup", onMouseUp);

  return () => {
    handleEl.removeEventListener("mousedown", onMouseDown);
    doc.removeEventListener("mousemove", onMouseMove);
    doc.removeEventListener("mouseup", onMouseUp);
  };
}

function getClassName(source) {
  if (!source) return "";
  if (typeof source === "string") return source;
  const element = source?.element ?? source;
  if (element instanceof jQuery) return element[0]?.className || "";
  if (Array.isArray(element)) return getClassName(element[0]);
  if (element?.[0]?.className != null) return element[0].className;
  return element?.className || "";
}
