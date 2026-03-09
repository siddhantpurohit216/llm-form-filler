/**
 * Inline UI - Injected UI components for autofilled fields
 */

class InlineUI {
    constructor() {
        this.activeModals = new Map();
        this.tooltips = new Map();
        this.initialized = false;
    }

    init() {
        if (this.initialized) return;
        this.initialized = true;
        console.log('[InlineUI] Initialized');
    }

    getConfidenceLevel(matchData) {
        const confidence = matchData.confidence || matchData.matchConfidence || 0;
        const source = matchData.source || matchData.matchSource;
        if (source === FIELD_SOURCE.USER || confidence >= 0.9) return 'exact';
        if (source === FIELD_SOURCE.LLM || confidence >= 0.7) return 'inferred';
        return 'uncertain';
    }

    addFieldIndicators(element, matchData) {
        if (element.dataset.sjaProcessed) return;
        element.dataset.sjaProcessed = 'true';
        element.dataset.sjaFieldId = matchData.fieldId || element.id;

        const wrapper = this.createFieldWrapper(element);
        const indicator = this.createConfidenceIndicator(matchData);
        wrapper.appendChild(indicator);

        const actions = this.createActionButtons(element, matchData);
        wrapper.appendChild(actions);
        this.addTooltip(indicator, matchData);
    }

    createFieldWrapper(element) {
        if (element.parentElement?.classList.contains('sja-field-wrapper')) {
            return element.parentElement;
        }
        const wrapper = document.createElement('div');
        wrapper.className = 'sja-field-wrapper';
        element.parentNode.insertBefore(wrapper, element);
        wrapper.appendChild(element);
        return wrapper;
    }

    createConfidenceIndicator(matchData) {
        const indicator = document.createElement('span');
        indicator.className = 'sja-confidence-indicator';
        const level = this.getConfidenceLevel(matchData);
        indicator.classList.add(`sja-confidence-${level}`);
        const icons = { exact: '🟢', inferred: '🟡', uncertain: '🔴' };
        indicator.textContent = icons[level] || '⚪';
        indicator.setAttribute('role', 'img');
        indicator.setAttribute('aria-label', `Confidence: ${level}`);
        return indicator;
    }

    createActionButtons(element, matchData) {
        const container = document.createElement('div');
        container.className = 'sja-actions-container';
        container.style.display = 'none';

        container.appendChild(this.createButton('✏️', 'Edit', () => {
            element.focus();
            element.select();
        }));

        if (matchData.source === FIELD_SOURCE.LLM || matchData.isLongForm) {
            container.appendChild(this.createButton('🔁', 'Regenerate', () => {
                this.handleRegenerate(element, matchData);
            }));
        }

        container.appendChild(this.createButton('💾', 'Save to Profile', () => {
            this.showSaveModal(element, matchData);
        }));

        const wrapper = element.closest('.sja-field-wrapper');
        if (wrapper) {
            wrapper.addEventListener('mouseenter', () => container.style.display = 'flex');
            wrapper.addEventListener('mouseleave', () => container.style.display = 'none');
            element.addEventListener('focus', () => container.style.display = 'flex');
        }
        return container;
    }

    createButton(icon, label, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'sja-action-btn';
        button.textContent = icon;
        button.setAttribute('aria-label', label);
        button.setAttribute('title', label);
        button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            onClick();
        });
        return button;
    }

    addTooltip(element, matchData) {
        const tooltip = document.createElement('div');
        tooltip.className = 'sja-tooltip';
        const source = matchData.source || matchData.matchSource || 'unknown';
        const confidence = ((matchData.confidence || matchData.matchConfidence || 0) * 100).toFixed(0);
        const reason = matchData.reason || matchData.matchReason || 'No reason provided';
        tooltip.innerHTML = `<div class="sja-tooltip-content">
      <div><strong>Source:</strong> ${source}</div>
      <div><strong>Confidence:</strong> ${confidence}%</div>
      <div><strong>Reason:</strong> ${reason}</div>
    </div>`;

        element.addEventListener('mouseenter', () => {
            document.body.appendChild(tooltip);
            const rect = element.getBoundingClientRect();
            tooltip.style.left = `${rect.left}px`;
            tooltip.style.top = `${rect.bottom + 5}px`;
            tooltip.style.display = 'block';
        });
        element.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
            if (tooltip.parentNode) tooltip.parentNode.removeChild(tooltip);
        });
        this.tooltips.set(element, tooltip);
    }

    async handleRegenerate(element, matchData) {
        element.classList.add('sja-loading');
        element.disabled = true;
        try {
            const response = await chrome.runtime.sendMessage({
                type: MESSAGE_TYPES.LLM_GENERATE,
                data: { fieldId: matchData.fieldId, fieldInfo: { label: matchData.label, type: matchData.type }, regenerate: true }
            });
            if (response?.value) {
                element.value = response.value;
                element.dispatchEvent(new Event('input', { bubbles: true }));
                sessionCache.updateValue(matchData.fieldId, response.value, FIELD_SOURCE.LLM);
                this.updateConfidenceIndicator(element, { ...matchData, confidence: response.confidence || 0.8, source: FIELD_SOURCE.LLM });
            }
        } catch (error) {
            console.error('[InlineUI] Regenerate failed:', error);
        } finally {
            element.classList.remove('sja-loading');
            element.disabled = false;
        }
    }

    updateConfidenceIndicator(element, matchData) {
        const wrapper = element.closest('.sja-field-wrapper');
        if (!wrapper) return;
        const indicator = wrapper.querySelector('.sja-confidence-indicator');
        if (!indicator) return;
        indicator.classList.remove('sja-confidence-exact', 'sja-confidence-inferred', 'sja-confidence-uncertain');
        const level = this.getConfidenceLevel(matchData);
        indicator.classList.add(`sja-confidence-${level}`);
        const icons = { exact: '🟢', inferred: '🟡', uncertain: '🔴' };
        indicator.textContent = icons[level] || '⚪';
    }

    showSaveModal(element, matchData) {
        this.closeAllModals();
        const modal = document.createElement('div');
        modal.className = 'sja-modal-overlay';
        modal.innerHTML = `<div class="sja-modal">
      <div class="sja-modal-header"><h3>💾 Save to Profile</h3><button class="sja-modal-close">&times;</button></div>
      <div class="sja-modal-body">
        <p>Save this value to your profile?</p>
        <div><strong>Value:</strong> <span>${truncateText(element.value, 100)}</span></div>
        <div class="sja-modal-field">
          <label for="sja-profile-path">Save to:</label>
          <select id="sja-profile-path" class="sja-select">
            <optgroup label="Contact">
              <option value="contact.firstName">First Name</option>
              <option value="contact.lastName">Last Name</option>
              <option value="contact.email">Email</option>
              <option value="contact.phone">Phone</option>
            </optgroup>
            <optgroup label="Links">
              <option value="links.linkedin">LinkedIn</option>
              <option value="links.github">GitHub</option>
            </optgroup>
            <optgroup label="Custom">
              <option value="custom">Add as Custom Field...</option>
            </optgroup>
          </select>
        </div>
        <div id="sja-custom-field-input" style="display:none;">
          <label for="sja-custom-key">Custom Field Name:</label>
          <input type="text" id="sja-custom-key" class="sja-input" placeholder="e.g., preferredName">
        </div>
      </div>
      <div class="sja-modal-footer">
        <button class="sja-btn sja-btn-secondary sja-modal-cancel">Cancel</button>
        <button class="sja-btn sja-btn-primary sja-modal-confirm">Save</button>
      </div>
    </div>`;
        document.body.appendChild(modal);
        this.activeModals.set(element, modal);

        const select = modal.querySelector('#sja-profile-path');
        const customInput = modal.querySelector('#sja-custom-field-input');
        if (matchData.profilePath && select.querySelector(`option[value="${matchData.profilePath}"]`)) {
            select.value = matchData.profilePath;
        }
        select.addEventListener('change', () => customInput.style.display = select.value === 'custom' ? 'block' : 'none');
        modal.querySelector('.sja-modal-close').addEventListener('click', () => this.closeModal(element));
        modal.querySelector('.sja-modal-cancel').addEventListener('click', () => this.closeModal(element));
        modal.addEventListener('click', (e) => { if (e.target === modal) this.closeModal(element); });
        modal.querySelector('.sja-modal-confirm').addEventListener('click', async () => {
            let profilePath = select.value;
            if (profilePath === 'custom') {
                const customKey = modal.querySelector('#sja-custom-key').value.trim();
                if (!customKey) { alert('Please enter a custom field name'); return; }
                profilePath = `customFields.${customKey}`;
            }
            await this.saveToProfile(element, profilePath);
            this.closeModal(element);
        });
        select.focus();
    }

    async saveToProfile(element, profilePath) {
        try {
            const response = await chrome.runtime.sendMessage({
                type: MESSAGE_TYPES.SAVE_TO_PROFILE,
                data: { path: profilePath, value: element.value }
            });
            if (response?.success) {
                sessionCache.markAsSaved(element.dataset.sjaFieldId);
                this.updateConfidenceIndicator(element, { confidence: 1.0, source: FIELD_SOURCE.USER });
                this.showToast('✅ Saved to profile!');
            } else throw new Error(response?.error || 'Save failed');
        } catch (error) {
            console.error('[InlineUI] Save failed:', error);
            this.showToast('❌ Failed to save', 'error');
        }
    }

    closeModal(element) {
        const modal = this.activeModals.get(element);
        if (modal?.parentNode) modal.parentNode.removeChild(modal);
        this.activeModals.delete(element);
    }

    closeAllModals() {
        this.activeModals.forEach((_, element) => this.closeModal(element));
    }

    showToast(message, type = 'success') {
        document.querySelectorAll('.sja-toast').forEach(t => t.remove());
        const toast = document.createElement('div');
        toast.className = `sja-toast sja-toast-${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.classList.add('sja-toast-visible'), 10);
        setTimeout(() => { toast.classList.remove('sja-toast-visible'); setTimeout(() => toast.remove(), 300); }, 3000);
    }

    highlightField(element, level = 'inferred') {
        element.classList.add('sja-autofilled', `sja-autofilled-${level}`);
    }

    removeFieldUI(element) {
        const wrapper = element.closest('.sja-field-wrapper');
        if (wrapper?.parentNode) { wrapper.parentNode.insertBefore(element, wrapper); wrapper.remove(); }
        element.classList.remove('sja-autofilled', 'sja-autofilled-exact', 'sja-autofilled-inferred', 'sja-autofilled-uncertain');
        delete element.dataset.sjaProcessed;
        delete element.dataset.sjaFieldId;
    }

    cleanup() {
        this.closeAllModals();
        this.tooltips.forEach(tooltip => { if (tooltip.parentNode) tooltip.parentNode.removeChild(tooltip); });
        this.tooltips.clear();
        document.querySelectorAll('.sja-field-wrapper').forEach(wrapper => {
            const input = wrapper.querySelector('input, select, textarea');
            if (input) this.removeFieldUI(input);
        });
        document.querySelectorAll('.sja-toast').forEach(t => t.remove());
    }
}

const inlineUI = new InlineUI();
if (typeof module !== 'undefined' && module.exports) module.exports = { InlineUI, inlineUI };
