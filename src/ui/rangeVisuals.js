/**
 * @fileoverview Range slider visuals and helpers
 */

import { escapeHtml } from '../utils/format.js';

/**
 * Update a range input's visual fill
 * @param {HTMLInputElement} input
 */
export function updateRangeVisual(input) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const value = Number(input.value || 0);
  const percent = max === min ? 0 : ((value - min) / (max - min)) * 100;
  input.style.setProperty('--range-percent', `${Math.max(0, Math.min(100, percent))}%`);
}

/**
 * Attach visual updates for range inputs
 * @param {ParentNode} root
 */
export function setupRangeVisuals(root = document) {
  const inputs = root.querySelectorAll('input[type="range"]');
  inputs.forEach((input) => {
    updateRangeVisual(input);
    if (input.dataset.rangeVisualBound === 'true') return;
    input.dataset.rangeVisualBound = 'true';
    input.addEventListener('input', () => updateRangeVisual(input));
  });
}

/**
 * Add min/max labels and per-setting reset for property sliders
 * @param {HTMLElement|null} container
 * @param {{
 *  escapeHtml?: (value: string) => string,
 *  onResetDefaultFilter?: (section: string, key: string, value: number) => void
 * }} [options]
 */
export function decoratePropertySliders(container, options = {}) {
  if (!container) return;
  const { escapeHtml: escape = escapeHtml, onResetDefaultFilter } = options;
  const sliders = container.querySelectorAll('input.property-slider');
  sliders.forEach((input) => {
    updateRangeVisual(input);
    if (!input.dataset.rangeVisualBound) {
      input.dataset.rangeVisualBound = 'true';
      input.addEventListener('input', () => updateRangeVisual(input));
    }

    const min = input.min !== '' ? input.min : '0';
    const max = input.max !== '' ? input.max : '100';
    const next = input.nextElementSibling;
    const valueDisplay = next && next.querySelector && next.querySelector('span[id$="-value"]') ? next : null;
    const insertAfter = valueDisplay || input;
    const existing = insertAfter.nextElementSibling;
    if (!existing || !existing.classList.contains('slider-range')) {
      const rangeEl = document.createElement('div');
      rangeEl.className = 'slider-range';
      rangeEl.innerHTML = `<span>${escape(min)}</span><span>${escape(max)}</span>`;
      insertAfter.insertAdjacentElement('afterend', rangeEl);
    }

    const section = input.dataset.filterSection;
    const key = input.dataset.filterKey;
    const defaultValue = input.dataset.defaultValue;
    if (!section || !key || defaultValue === undefined) return;
    if (input.dataset.resetBound === 'true') return;

    const group = input.closest('.property-group');
    if (!group) return;
    const label = group.querySelector('.property-label');
    if (!label) return;

    let labelRow = group.querySelector('.property-label-row');
    if (!labelRow) {
      labelRow = document.createElement('div');
      labelRow.className = 'property-label-row';
      label.parentNode.insertBefore(labelRow, label);
      labelRow.appendChild(label);
    }

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'property-reset';
    resetBtn.textContent = 'Reset';
    const labelText = label.textContent.trim() || 'setting';
    resetBtn.setAttribute('aria-label', `Reset ${labelText}`);
    resetBtn.addEventListener('click', () => {
      const value = parseFloat(defaultValue);
      if (Number.isNaN(value)) return;
      input.value = String(value);
      updateRangeVisual(input);
      if (typeof onResetDefaultFilter === 'function') {
        onResetDefaultFilter(section, key, value);
      }
    });
    labelRow.appendChild(resetBtn);
    input.dataset.resetBound = 'true';
  });
}
