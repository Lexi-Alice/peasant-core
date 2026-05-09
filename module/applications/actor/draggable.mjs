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
