export function ensureSlideToggleElement(targetWindow = globalThis) {
  const registry = targetWindow?.customElements;
  if (!registry || registry.get("slide-toggle")) return;

  const WindowHTMLElement = targetWindow?.HTMLElement ?? HTMLElement;
  const targetElements = targetWindow?.foundry?.applications?.elements
    ?? ((targetWindow === globalThis) ? foundry?.applications?.elements : null);
  const isUsableElementBase = (base) => typeof base === "function"
    && (base === WindowHTMLElement || base.prototype instanceof WindowHTMLElement);
  const AbstractFormInputElement = isUsableElementBase(targetElements?.AbstractFormInputElement)
    ? targetElements.AbstractFormInputElement
    : null;
  const AdoptableHTMLElement = isUsableElementBase(targetElements?.AdoptableHTMLElement)
    ? targetElements.AdoptableHTMLElement
    : null;
  const BaseElement = AbstractFormInputElement ?? AdoptableHTMLElement ?? WindowHTMLElement;
  const usesFoundryFormBase = !!AbstractFormInputElement;

  class PeasantCoreSlideToggleElement extends BaseElement {
    static tagName = "slide-toggle";
    static formAssociated = usesFoundryFormBase;

    static get observedAttributes() {
      return ["checked", "disabled"];
    }

    #fallbackController = null;

    constructor() {
      super();
      this._value = this.getAttribute("value");
      if (this._internals) this._internals.role = "switch";
    }

    connectedCallback() {
      if (usesFoundryFormBase && (typeof super.connectedCallback === "function")) {
        super.connectedCallback();
      } else {
        this.replaceChildren(...this._buildElements());
        this._refresh();
        this._activateListeners();
      }
      if (!this.hasAttribute("tabindex")) this.tabIndex = 0;
    }

    disconnectedCallback() {
      super.disconnectedCallback?.();
      this.#fallbackController?.abort();
      this.#fallbackController = null;
    }

    attributeChangedCallback(attrName, oldValue, newValue) {
      if (oldValue === newValue) return;
      super.attributeChangedCallback?.(attrName, oldValue, newValue);
      this._refresh();
    }

    get checked() {
      return this.hasAttribute("checked");
    }

    set checked(value) {
      this.toggleAttribute("checked", !!value);
      this._refresh();
    }

    get disabled() {
      return usesFoundryFormBase ? super.disabled : this.hasAttribute("disabled");
    }

    set disabled(value) {
      this.toggleAttribute("disabled", !!value);
    }

    get value() {
      return this._getValue();
    }

    set value(value) {
      this._setValue(value);
      this._refresh();
    }

    _getValue() {
      if (typeof this._value === "string") return this._value;
      return this.checked;
    }

    _setValue(value) {
      this._value = value;
    }

    _buildElements() {
      const ownerDocument = this.ownerDocument ?? targetWindow?.document ?? document;
      const track = ownerDocument.createElement("div");
      track.classList.add("slide-toggle-track");
      const thumb = ownerDocument.createElement("div");
      thumb.classList.add("slide-toggle-thumb");
      track.append(thumb);
      return [track];
    }

    _activateListeners() {
      const signal = usesFoundryFormBase ? this.abortSignal : this.#getFallbackSignal();
      if (!usesFoundryFormBase) this.addEventListener("click", this._onClick.bind(this), { signal });
      this.addEventListener("keydown", this.#onKeydown, { signal });
    }

    _refresh() {
      const checked = this.checked;
      const disabled = this.disabled;
      this.setAttribute("role", "switch");
      this.setAttribute("aria-checked", checked ? "true" : "false");
      if (disabled) this.setAttribute("aria-disabled", "true");
      else this.removeAttribute("aria-disabled");
      if (this._internals) {
        this._internals.ariaChecked = `${checked}`;
        this._internals.setFormValue(this._getValue());
      }
    }

    _toggleDisabled() {
      this._refresh();
    }

    _onClick(event) {
      event.preventDefault();
      if (this.disabled) return;
      this.checked = !this.checked;
      const EventConstructor = this.ownerDocument?.defaultView?.Event ?? targetWindow?.Event ?? Event;
      this.dispatchEvent(new EventConstructor("input", { bubbles: true, cancelable: true }));
      this.dispatchEvent(new EventConstructor("change", { bubbles: true, cancelable: true }));
    }

    #onKeydown = (event) => {
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      this.click();
    };

    #getFallbackSignal() {
      const AbortControllerClass = this.ownerDocument?.defaultView?.AbortController
        ?? targetWindow?.AbortController
        ?? AbortController;
      this.#fallbackController ??= new AbortControllerClass();
      return this.#fallbackController.signal;
    }
  }

  registry.define(PeasantCoreSlideToggleElement.tagName, PeasantCoreSlideToggleElement);
}
