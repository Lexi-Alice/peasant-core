import { escapeHtml } from "../../../utils/chat.mjs";

export function renderNotableCombatTagList($list, activeTags) {
  $list.empty();

  if (activeTags.length === 0) {
    $list.html('<span style="color:#666;font-style:italic;font-size:12px;">No tags set</span>');
    return;
  }

  activeTags.forEach((tag, idx) => {
    const isDescription = tag.type === 'description';
    const labelClass = isDescription ? 'current-tag-label edit-description-tag' : 'current-tag-label';
    const customIndexAttr = Number.isInteger(tag.customIndex) ? ` data-custom-index="${tag.customIndex}"` : '';
    const tagKey = tag.type === 'custom' && Number.isInteger(tag.customIndex) ? `custom:${tag.customIndex}` : tag.type;
    const $tagItem = $(`
      <div class="current-tag-item editor-tag-draggable combat-tag combat-tag-compact combat-tag-button" data-tag-type="${tag.type}" data-tag-key="${tagKey}" data-tag-index="${idx}"${customIndexAttr} draggable="true" role="button" tabindex="0" title="Right-click to edit this tag" style="display:inline-flex !important; width:auto !important; max-width:max-content !important; flex:0 0 auto !important; margin:0 !important; align-self:flex-start !important; justify-content:flex-start !important;">
        <span class="${labelClass}">${escapeHtml(tag.display)}</span>
        <button type="button" class="remove-tag-btn" data-tag-type="${tag.type}" data-tag-key="${tagKey}"${customIndexAttr} title="Remove tag" draggable="false" aria-label="Remove tag">&times;</button>
      </div>
    `);
    const chipEl = $tagItem[0];
    const removeBtn = $tagItem.find('.remove-tag-btn')[0];
    const setTagHoverState = (active) => {
      chipEl.classList.toggle('tag-hover-active', !!active);

      if (!active) {
        chipEl.style.removeProperty('background');
        chipEl.style.removeProperty('background-color');
        chipEl.style.removeProperty('border-color');
        chipEl.style.removeProperty('color');
        return;
      }

      const hoverSource = removeBtn || chipEl;
      const hoverStyles = getComputedStyle(hoverSource);
      const hoverBg = hoverStyles.getPropertyValue('--button-hover-background-color').trim() || 'rgba(46, 38, 28, 0.75)';
      const hoverBorder = hoverStyles.getPropertyValue('--button-hover-border-color').trim() || '#c9b183';
      const hoverText = hoverStyles.getPropertyValue('--button-hover-text-color').trim() || '#f2dfbd';

      chipEl.style.setProperty('background', hoverBg, 'important');
      chipEl.style.setProperty('background-color', hoverBg, 'important');
      chipEl.style.setProperty('border-color', hoverBorder, 'important');
      chipEl.style.setProperty('color', hoverText, 'important');
    };

    const setRemoveHoverState = (active) => {
      if (!removeBtn) return;
      removeBtn.classList.toggle('tag-hover-active', !!active);
    };

    chipEl.addEventListener('mouseenter', () => setTagHoverState(true));
    chipEl.addEventListener('mouseleave', () => setTagHoverState(false));
    chipEl.addEventListener('focusin', (ev) => {
      if (removeBtn && ev.target === removeBtn) return;
      setTagHoverState(true);
    });
    chipEl.addEventListener('focusout', () => {
      setTimeout(() => {
        if (!chipEl.contains(chipEl.ownerDocument?.activeElement)) setTagHoverState(false);
      }, 0);
    });

    if (removeBtn) {
      removeBtn.addEventListener('mouseenter', () => {
        setTagHoverState(false);
        setRemoveHoverState(true);
      });
      removeBtn.addEventListener('mouseleave', () => {
        setRemoveHoverState(false);
        if (!chipEl.matches(':hover') && !chipEl.contains(chipEl.ownerDocument?.activeElement)) {
          setTagHoverState(false);
        } else {
          setTagHoverState(true);
        }
      });
      removeBtn.addEventListener('focusin', () => {
        setTagHoverState(false);
        setRemoveHoverState(true);
      });
      removeBtn.addEventListener('focusout', () => {
        setRemoveHoverState(false);
        setTimeout(() => {
          const activeElement = chipEl.ownerDocument?.activeElement;
          if (!chipEl.contains(activeElement) && !chipEl.matches(':hover')) {
            setTagHoverState(false);
          } else if (chipEl.contains(activeElement) || chipEl.matches(':hover')) {
            setTagHoverState(true);
          }
        }, 0);
      });
    }

    $list.append($tagItem);
  });
}
