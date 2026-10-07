/**
 * Inline UI - Injected UI components for autofilled fields
 * Includes confidence indicators, action buttons, and "Generate with AI" feature
 */

class InlineUI {
    constructor() {
        this.activeModals = new Map();
        this.tooltips = new Map();
        this.initialized = false;
        this.fieldOverlays = new Map();
        this.activeField = null;
        this.positionFrame = null;
    }

    init() {
        if (this.initialized) return;
        this.initialized = true;
        this.reposition = () => {
            if (this.positionFrame !== null) return;
            this.positionFrame = requestAnimationFrame(() => {
                this.positionFrame = null;
                for (const [element, entry] of this.fieldOverlays) {
                    if (!element.isConnected) this.removeFieldUI(element);
                    else if (this.activeField === element) this.positionOverlay(entry.overlay, element);
                }
            });
        };
        window.addEventListener('scroll', this.reposition, true);
        window.addEventListener('resize', this.reposition);
        this.layoutObserver = new ResizeObserver(this.reposition);
        this.layoutObserver.observe(document.body);
        console.log('[InlineUI] Initialized');
    }

    showPageStatus(text, onAutofill) {
        if (window.top !== window) return;
        this.pagePanel = document.createElement('aside');
        this.pagePanel.className = 'sja-page-status';
        this.pagePanel.dataset.sjaUi = 'true';
        const header = document.createElement('div');
        header.className = 'sja-panel-header';
        const brand = document.createElement('div');
        brand.className = 'sja-panel-brand';
        const mark = document.createElement('span');
        mark.className = 'sja-brand-mark';
        mark.textContent = '✓';
        const title = document.createElement('strong');
        title.textContent = 'Smart Job Autofill';
        brand.append(mark, title);
        const collapse = document.createElement('button');
        collapse.className = 'sja-panel-toggle';
        collapse.type = 'button';
        collapse.textContent = '−';
        collapse.setAttribute('aria-label', 'Minimize autofill panel');
        collapse.setAttribute('aria-expanded', 'true');
        collapse.addEventListener('click', () => {
            const minimized = this.pagePanel.classList.toggle('sja-panel-minimized');
            collapse.textContent = minimized ? '+' : '−';
            collapse.setAttribute('aria-expanded', String(!minimized));
            collapse.setAttribute('aria-label', minimized ? 'Expand autofill panel' : 'Minimize autofill panel');
        });
        header.append(brand, collapse);
        const body = document.createElement('div');
        body.className = 'sja-panel-body';
        this.pageStatus = document.createElement('div');
        this.pageStatus.setAttribute('role', 'status');
        this.pageStatus.textContent = text;
        this.pageButton = document.createElement('button');
        this.pageButton.className = 'sja-panel-autofill';
        this.pageButton.type = 'button';
        this.pageButton.textContent = 'Autofill this page';
        this.pageButton.addEventListener('click', onAutofill);
        const hint = document.createElement('p');
        hint.className = 'sja-panel-hint';
        hint.textContent = 'Hover a field to edit, save, or use AI.';
        body.append(this.pageStatus, this.pageButton, hint);
        this.pagePanel.append(header, body);
        document.body.appendChild(this.pagePanel);
    }

    updatePageStatus(text, busy = false) {
        if (this.pageStatus) this.pageStatus.textContent = text;
        this.setPageBusy(busy);
    }

    setPageBusy(busy) {
        if (this.pageButton) {
            this.pageButton.disabled = busy;
            this.pageButton.textContent = busy ? 'Filling…' : 'Autofill this page';
        }
    }

    getConfidenceLevel(matchData) {
        const confidence = matchData.confidence || matchData.matchConfidence || 0;
        const source = matchData.source || matchData.matchSource;
        if (source === FIELD_SOURCE.USER || confidence >= 0.9) return 'exact';
        if (source === FIELD_SOURCE.LLM || confidence >= 0.7) return 'inferred';
        return 'uncertain';
    }

    addFieldIndicators(element, matchData) {
        if (!element?.isConnected) return;
        matchData = {...matchData, validationError:this.hasValidationError(element)};
        const existing = this.fieldOverlays.get(element);
        if (existing) {
            this.updateConfidenceIndicator(element, matchData);
            return;
        }
        element.dataset.sjaProcessed = 'true';
        element.dataset.sjaFieldId = matchData.fieldId || element.dataset.sjaFieldId || element.id;
        const overlay = this.createFloatingOverlay(element, matchData);
        document.body.appendChild(overlay);
        const show = () => {
            this.updateConfidenceIndicator(element, matchData);
            if (this.activeField && this.activeField !== element) {
                const previous = this.fieldOverlays.get(this.activeField);
                if (previous) previous.overlay.hidden = true;
            }
            this.activeField = element;
            overlay.hidden = false;
            this.positionOverlay(overlay, element);
        };
        let hideTimer;
        const hide = () => {
            clearTimeout(hideTimer);
            hideTimer = setTimeout(() => {
                if (document.activeElement === element || overlay.contains(document.activeElement) || overlay.matches(':hover') || element.matches(':hover')) return;
                overlay.hidden = true;
                if (this.activeField === element) this.activeField = null;
            }, 160);
        };
        element.addEventListener('focus', show);
        element.addEventListener('mouseenter', show);
        element.addEventListener('blur', hide);
        element.addEventListener('mouseleave', hide);
        overlay.addEventListener('mouseenter', () => clearTimeout(hideTimer));
        overlay.addEventListener('mouseleave', hide);
        overlay.addEventListener('focusout', hide);
        overlay.addEventListener('keydown', event => {
            if (event.key === 'Escape') { overlay.hidden = true; this.activeField = null; }
        });
        this.fieldOverlays.set(element, {overlay, cleanup:() => {
            clearTimeout(hideTimer);
            element.removeEventListener('focus', show);
            element.removeEventListener('mouseenter', show);
            element.removeEventListener('blur', hide);
            element.removeEventListener('mouseleave', hide);
        }});
        this.layoutObserver?.observe(element);
    }

    createFloatingOverlay(element, matchData) {
        const overlay = document.createElement('div');
        overlay.className = 'sja-field-overlay';
        overlay.dataset.sjaUi = 'true';
        overlay.hidden = true;
        overlay.setAttribute('role', 'toolbar');
        overlay.setAttribute('aria-label', `Autofill actions for ${matchData.label || 'field'}`);
        overlay.append(this.createConfidenceIndicator(matchData), this.createActionButtons(element, matchData, overlay));
        return overlay;
    }

    positionOverlay(overlay, element) {
        const rect = element.getBoundingClientRect();
        // Off-screen fields must never produce controls stacked on a screen edge.
        if (!element.isConnected || !isElementVisible(element) || rect.bottom <= 0 ||
            rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) {
            overlay.hidden = true;
            return;
        }
        const width = overlay.getBoundingClientRect().width || 280;
        const height = overlay.getBoundingClientRect().height || 40;
        const left = Math.max(8, Math.min(rect.right-width, window.innerWidth-width-8));
        const below = rect.bottom+6;
        const top = below+height < window.innerHeight-8 ? below : Math.max(8, rect.top-height-6);
        overlay.style.left = `${left}px`;
        overlay.style.top = `${top}px`;
    }

    createConfidenceIndicator(matchData) {
        const indicator = document.createElement('span');
        indicator.className = 'sja-confidence-indicator';
        const level = matchData.validationError ? 'uncertain' : this.getConfidenceLevel(matchData);
        indicator.classList.add(`sja-confidence-${level}`);
        const labels = {exact:'✓ Filled', inferred:'AI draft', uncertain:'Review'};
        indicator.textContent = matchData.validationError ? 'Needs review' : labels[level];
        indicator.setAttribute('title', matchData.reason || 'Filled from your saved profile');
        return indicator;
    }

    hasValidationError(element) {
        return typeof autofillEngine !== 'undefined'
            ? autofillEngine.hasFieldError?.(element)
            : element.getAttribute('aria-invalid') === 'true';
    }

    createActionButtons(element, matchData, overlay) {
        const container = document.createElement('div');
        container.className = 'sja-actions-container';
        container.style.cssText = 'pointer-events: auto;';

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
        button.textContent = ({'Generate with AI':'AI', 'Save to Profile':'Save', 'Regenerate':'Retry'})[label] || label;
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
                const result = await autofillEngine.fill(element, response.value, matchData.type || 'text');
                if (!result.success) throw new Error('Could not fill this field');
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
        modal.dataset.sjaUi = 'true';
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
                    const result = await autofillEngine.fill(element, response.value, matchData.type || 'text');
                if (!result.success) throw new Error('Could not fill this field');

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
        const overlay = this.fieldOverlays.get(element)?.overlay;
        const indicator = overlay?.querySelector('.sja-confidence-indicator');
        if (!indicator) return;
        const next = this.createConfidenceIndicator({...matchData, validationError:this.hasValidationError(element)});
        indicator.replaceWith(next);
    }

    showSaveModal(element, matchData) {
        this.closeAllModals();
        const modal = document.createElement('div');
        modal.dataset.sjaUi = 'true';
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
        const entry = this.fieldOverlays.get(element);
        entry?.cleanup();
        entry?.overlay.remove();
        this.fieldOverlays.delete(element);
        this.layoutObserver?.unobserve(element);
        if (this.activeField === element) this.activeField = null;
        element.classList.remove('sja-autofilled', 'sja-autofilled-exact', 'sja-autofilled-inferred', 'sja-autofilled-uncertain');
        delete element.dataset.sjaProcessed;
    }

    cleanup() {
        this.closeAllModals();
        for (const element of this.fieldOverlays.keys()) this.removeFieldUI(element);
        this.tooltips.forEach(tooltip => tooltip.remove());
        this.tooltips.clear();
        this.layoutObserver?.disconnect();
        window.removeEventListener('scroll', this.reposition, true);
        window.removeEventListener('resize', this.reposition);
        if (this.positionFrame !== null) cancelAnimationFrame(this.positionFrame);
        this.positionFrame = null;
        this.pagePanel?.remove();
        document.querySelectorAll('.sja-toast').forEach(toast => toast.remove());
        this.initialized = false;
    }

}

const inlineUI = new InlineUI();
if (typeof module !== 'undefined' && module.exports) module.exports = { InlineUI, inlineUI };
