import { collectPeasantActiveEffectKeys, getPeasantActiveEffectKeyMetadata } from "../../data/active-effect/key-policy.mjs";

export { collectPeasantActiveEffectKeys };

function compareKeys(a, b) {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

export class PeasantActiveEffectKeyBrowser {
  constructor({ keys = [] } = {}) {
    this.keys = keys;
    this.filteredKeys = keys;
    this.selectedIndex = 0;
    this.currentInput = null;
    this.browserElement = null;
    this.contentElement = null;
  }

  setKeys(keys = []) {
    this.keys = [...keys].sort(compareKeys);
    this.filteredKeys = this.filterKeys(this.currentInput?.value ?? "");
  }

  setInput(input) {
    this.currentInput = input;
  }

  update() {
    if (!this.currentInput) return;
    if (!this.browserElement) this.createBrowser();
    this.filteredKeys = this.filterKeys(this.currentInput.value);
    this.renderKeys();
    this.selectIndex(this.filteredKeys.length ? 0 : -1);
    this.show();
    this.positionBrowser();
  }

  hide() {
    if (this.browserElement) this.browserElement.hidden = true;
  }

  destroy() {
    document.removeEventListener("click", this.#onDocumentClick);
    document.removeEventListener("keydown", this.#onDocumentKeyDown);
    document.removeEventListener("scroll", this.#onDocumentScroll, true);
    window.removeEventListener("resize", this.#onWindowResize);
    this.browserElement?.remove();
    this.browserElement = null;
    this.contentElement = null;
    this.currentInput = null;
  }

  createBrowser() {
    this.browserElement = document.createElement("div");
    this.browserElement.classList.add("pc-ae-key-browser");
    this.browserElement.hidden = true;

    this.contentElement = document.createElement("div");
    this.contentElement.classList.add("pc-ae-key-browser-content");
    this.browserElement.appendChild(this.contentElement);

    this.browserElement.addEventListener("mousedown", event => event.preventDefault());
    this.browserElement.addEventListener("click", this.#onBrowserClick);
    document.addEventListener("click", this.#onDocumentClick);
    document.addEventListener("keydown", this.#onDocumentKeyDown);
    document.addEventListener("scroll", this.#onDocumentScroll, true);
    window.addEventListener("resize", this.#onWindowResize);
    document.body.appendChild(this.browserElement);
  }

  filterKeys(query) {
    const value = String(query ?? "").trim().toLocaleLowerCase();
    if (!value) return [...this.keys];
    return this.keys.filter(key => key.toLocaleLowerCase().includes(value));
  }

  renderKeys() {
    if (!this.contentElement) return;
    this.contentElement.innerHTML = "";

    if (!this.filteredKeys.length) {
      const empty = document.createElement("div");
      empty.classList.add("pc-ae-key-option", "pc-ae-key-option-empty");
      empty.textContent = "No matching keys";
      this.contentElement.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    this.filteredKeys.forEach((key, index) => {
      const option = document.createElement("div");
      const metadata = getPeasantActiveEffectKeyMetadata(key);
      option.classList.add("pc-ae-key-option");
      option.dataset.index = String(index);
      option.dataset.key = key;
      option.dataset.category = metadata.category;
      option.title = metadata.title;
      option.textContent = key;
      fragment.appendChild(option);
    });
    this.contentElement.appendChild(fragment);
  }

  show() {
    if (this.browserElement) this.browserElement.hidden = false;
  }

  isVisible() {
    return !!this.browserElement && !this.browserElement.hidden;
  }

  positionBrowser() {
    if (!this.browserElement || !this.currentInput) return;

    const rect = this.currentInput.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 8;
    const maxWidth = Math.min(420, viewportWidth - (margin * 2));
    const width = Math.max(Math.min(rect.width, maxWidth), Math.min(260, maxWidth));
    const left = Math.min(
      Math.max(window.scrollX + margin, window.scrollX + rect.left),
      window.scrollX + viewportWidth - width - margin
    );
    const availableHeight = viewportHeight - rect.bottom - margin;
    const maxHeight = Math.max(120, Math.min(400, availableHeight));

    this.browserElement.style.width = `${width}px`;
    this.browserElement.style.left = `${left}px`;
    this.browserElement.style.top = `${window.scrollY + rect.bottom}px`;
    if (this.contentElement) this.contentElement.style.maxHeight = `${maxHeight}px`;
  }

  selectIndex(index) {
    if (!this.contentElement) return;
    this.contentElement.querySelector(".pc-ae-key-option.selected")?.classList.remove("selected");
    this.selectedIndex = index;
    if (index < 0) return;

    const option = this.contentElement.querySelector(`.pc-ae-key-option[data-index="${index}"]`);
    if (!option) return;
    option.classList.add("selected");
    option.scrollIntoView({ block: "nearest" });
  }

  navigate(direction) {
    if (!this.filteredKeys.length) return;
    const nextIndex = (this.selectedIndex + direction + this.filteredKeys.length) % this.filteredKeys.length;
    this.selectIndex(nextIndex);
  }

  applySelectedKey() {
    const key = this.filteredKeys[this.selectedIndex];
    if (!key || !this.currentInput) return;

    this.currentInput.value = key;
    this.currentInput.dispatchEvent(new Event("input", { bubbles: true }));
    this.currentInput.dispatchEvent(new Event("change", { bubbles: true }));
    this.hide();
    this.currentInput.focus();
  }

  #onBrowserClick = event => {
    const option = event.target?.closest?.(".pc-ae-key-option[data-index]");
    if (!option || !this.browserElement?.contains(option)) return;

    this.selectIndex(Number(option.dataset.index));
    this.applySelectedKey();
  };

  #onDocumentClick = event => {
    if (!this.isVisible()) return;
    const target = event.target;
    if (this.browserElement?.contains(target) || target === this.currentInput) return;
    this.hide();
  };

  #onDocumentKeyDown = event => {
    if (!this.isVisible()) return;
    if (document.activeElement !== this.currentInput && !this.browserElement?.contains(document.activeElement)) return;

    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        this.navigate(-1);
        break;
      case "ArrowDown":
        event.preventDefault();
        this.navigate(1);
        break;
      case "Enter":
        event.preventDefault();
        this.applySelectedKey();
        break;
      case "Escape":
        event.preventDefault();
        this.hide();
        break;
      case "Tab":
        this.hide();
        break;
    }
  };

  #onDocumentScroll = () => {
    if (this.isVisible()) this.positionBrowser();
  };

  #onWindowResize = () => {
    if (this.isVisible()) this.positionBrowser();
  };
}
