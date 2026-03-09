/**
 * Inline UI - Injected UI components for autofilled fields
 * Includes confidence indicators, action buttons, and "Generate with AI" feature
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
        try {
            if (!element || !element.isConnected) return;
            if (element.dataset.sjaProcessed) return;
            element.dataset.sjaProcessed = 'true';
            element.dataset.sjaFieldId = matchData.fieldId || element.id;

            // Create a floating overlay anchored to the element's position
            // NOTE: We NEVER move or wrap React's elements — we float independently
            const overlay = this.createFloatingOverlay(element, matchData);
            document.body.appendChild(overlay);
            this.positionOverlay(overlay, element);

            // Reposition on scroll/resize
            const reposition = () => {
                if (!element.isConnected) {
                    overlay.remove();
                    window.removeEventListener('scroll', reposition, true);
                    return;
                }
                this.positionOverlay(overlay, element);
            };
            window.addEventListener('scroll', reposition, true);
            window.addEventListener('resize', reposition);

        } catch (e) {
            // Silently skip — unexpected DOM state
        }
    }

    /**
     * Create a floating overlay that sits on top of the field without touching it
     */
    createFloatingOverlay(element, matchData) {
        const overlay = document.createElement('div');
        overlay.className = 'sja-field-overlay';
        overlay.style.cssText = `
            position: fixed;
            z-index: 2147483647;
            display: flex;
            align-items: center;
            gap: 4px;
            pointer-events: none;
        `;

        const indicator = this.createConfidenceIndicator(matchData);
        indicator.style.pointerEvents = 'auto';
        overlay.appendChild(indicator);

        const actions = this.createActionButtons(element, matchData, overlay);
        overlay.appendChild(actions);
        this.addTooltip(indicator, matchData);

        // Show/hide action buttons on element focus/hover
        element.addEventListener('focus', () => actions.style.display = 'flex');
        element.addEventListener('blur', () => setTimeout(() => actions.style.display = 'none', 200));
        element.addEventListener('mouseenter', () => actions.style.display = 'flex');
        element.addEventListener('mouseleave', () => setTimeout(() => {
            if (!actions.matches(':hover')) actions.style.display = 'none';
        }, 200));
        actions.addEventListener('mouseenter', () => actions.style.display = 'flex');
        actions.addEventListener('mouseleave', () => actions.style.display = 'none');

        return overlay;
    }

    positionOverlay(overlay, element) {
        try {
            const rect = element.getBoundingClientRect();
            overlay.style.top = `${rect.top + window.scrollY + 4}px`;
            overlay.style.left = `${rect.right + window.scrollX - 80}px`;
            // Revert to fixed coords without scroll offset for fixed-position overlay
            overlay.style.top = `${rect.top + 4}px`;
            overlay.style.left = `${rect.right - 80}px`;
        } catch (e) { /* ignore */ }
    }

    // REMOVED: createFieldWrapper — we no longer move/wrap elements

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

    createActionButtons(element, matchData, overlay) {
        const container = document.createElement('div');
        container.className = 'sja-actions-container';
        container.style.cssText = 'display:none; pointer-events: auto;';

        // Edit button
        container.appendChild(this.createButton('✏️', 'Edit', () => {
            element.focus();
            if (element.select) element.select();
        }));

        // Regenerate button (for LLM/long-form fields)
        if (matchData.source === FIELD_SOURCE.LLM || matchData.isLongForm) {
            container.appendChild(this.createButton('🔁', 'Regenerate', () => {
                this.handleRegenerate(element, matchData);
            }));
        }

        // Generate with AI button (available for all fields)
        container.appendChild(this.createButton('✨', 'Generate with AI', () => {
            this.showGenerateModal(element, matchData);
        }));

        // Save to Profile button
        container.appendChild(this.createButton('💾', 'Save to Profile', () => {
            this.showSaveModal(element, matchData);
        }));

        return container;
    }

    createButton(icon, label, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'sja-action-btn';
        if (label === 'Generate with AI') {
            button.className = 'sja-action-btn sja-btn-generate';
        }
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
                autofillEngine.fill(element, response.value, matchData.type || 'text');
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

    // ========== Generate with AI Modal ==========

    /**
     * Show the Generate with AI prompt modal
     * @param {HTMLElement} element - Target field element
     * @param {Object} matchData - Field metadata
     */
    showGenerateModal(element, matchData) {
        this.closeAllModals();

        const fieldLabel = matchData.label || element.placeholder || 'this field';

        const modal = document.createElement('div');
        modal.className = 'sja-modal-overlay';
        modal.innerHTML = `<div class="sja-modal sja-generate-modal">
      <div class="sja-modal-header">
        <h3>✨ Generate with AI</h3>
        <button class="sja-modal-close">&times;</button>
      </div>
      <div class="sja-modal-body">
        <p>Generate AI content for: <strong>${this.escapeHtml(fieldLabel)}</strong></p>
        <div class="sja-modal-field">
          <label for="sja-generate-prompt">Your instructions:</label>
          <textarea id="sja-generate-prompt" class="sja-input sja-generate-textarea"
            placeholder="e.g., Write a professional cover letter under 600 characters for this job."
            rows="4"></textarea>
        </div>
        <div id="sja-generate-status" class="sja-generate-status" style="display:none;">
          <span class="sja-generate-spinner">⏳</span>
          <span>Generating...</span>
        </div>
      </div>
      <div class="sja-modal-footer">
        <button class="sja-btn sja-btn-secondary sja-modal-cancel">Cancel</button>
        <button class="sja-btn sja-btn-primary sja-generate-confirm">✨ Generate</button>
      </div>
    </div>`;

        document.body.appendChild(modal);
        this.activeModals.set(element, modal);

        // Event listeners
        const promptTextarea = modal.querySelector('#sja-generate-prompt');
        const generateBtn = modal.querySelector('.sja-generate-confirm');
        const statusDiv = modal.querySelector('#sja-generate-status');

        modal.querySelector('.sja-modal-close').addEventListener('click', () => this.closeModal(element));
        modal.querySelector('.sja-modal-cancel').addEventListener('click', () => this.closeModal(element));
        modal.addEventListener('click', (e) => { if (e.target === modal) this.closeModal(element); });

        generateBtn.addEventListener('click', async () => {
            const userPrompt = promptTextarea.value.trim();
            if (!userPrompt) {
                promptTextarea.focus();
                promptTextarea.classList.add('sja-input-error');
                setTimeout(() => promptTextarea.classList.remove('sja-input-error'), 1500);
                return;
            }

            // Show loading state
            generateBtn.disabled = true;
            generateBtn.textContent = '⏳ Generating...';
            statusDiv.style.display = 'flex';

            try {
                const response = await chrome.runtime.sendMessage({
                    type: MESSAGE_TYPES.LLM_FIELD_GENERATE,
                    data: {
                        fieldId: matchData.fieldId || element.id,
                        fieldInfo: {
                            label: matchData.label || fieldLabel,
                            type: matchData.type || 'text',
                            maxLength: element.maxLength > 0 ? element.maxLength : null
                        },
                        userPrompt: userPrompt
                    }
                });

                if (response?.value) {
                    // Fill the field using the autofill engine
                    autofillEngine.fill(element, response.value, matchData.type || 'text');

                    // Update cache
                    sessionCache.set(matchData.fieldId || element.id, {
                        value: response.value,
                        confidence: response.confidence || 0.85,
                        source: FIELD_SOURCE.LLM,
                        reason: `AI generated: ${userPrompt.substring(0, 50)}`
                    });

                    // Update indicator
                    this.updateConfidenceIndicator(element, {
                        confidence: response.confidence || 0.85,
                        source: FIELD_SOURCE.LLM
                    });

                    this.highlightField(element, 'inferred');
                    this.closeModal(element);
                    this.showToast('✨ Content generated!');
                } else {
                    const errorMsg = response?.error || 'Generation failed. Check your API key.';
                    this.showToast(`❌ ${errorMsg}`, 'error');
                    generateBtn.disabled = false;
                    generateBtn.textContent = '✨ Generate';
                    statusDiv.style.display = 'none';
                }
            } catch (error) {
                console.error('[InlineUI] Generate failed:', error);
                this.showToast('❌ Generation failed', 'error');
                generateBtn.disabled = false;
                generateBtn.textContent = '✨ Generate';
                statusDiv.style.display = 'none';
            }
        });

        // Focus the textarea
        promptTextarea.focus();
    }

    /**
     * Escape HTML to prevent XSS in modal content
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ========== Existing UI Methods ==========

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
        <div><strong>Value:</strong> <span>${truncateText(element.value || element.textContent || '', 100)}</span></div>
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
                data: { path: profilePath, value: element.value || element.textContent || '' }
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
            const input = wrapper.querySelector('input, select, textarea, [contenteditable]');
            if (input) this.removeFieldUI(input);
        });
        document.querySelectorAll('.sja-toast').forEach(t => t.remove());
    }
}

const inlineUI = new InlineUI();
if (typeof module !== 'undefined' && module.exports) module.exports = { InlineUI, inlineUI };
