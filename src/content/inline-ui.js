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
        if (typeof FontFace !== 'undefined' && globalThis.chrome?.runtime?.getURL) {
            const font = new FontFace('CareerBuddy Inter',
                `url("${chrome.runtime.getURL('assets/fonts/InterVariable.woff2')}")`, {weight:'100 900'});
            font.load().then(loaded => document.fonts.add(loaded)).catch(() => {});
        }
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
        const mark = document.createElement('img');
        mark.className = 'sja-brand-mark sja-brand-logo';
        mark.alt = '';
        mark.src = globalThis.chrome?.runtime?.getURL
            ? chrome.runtime.getURL('assets/icons/careerbuddy-logo.png') : '/assets/icons/careerbuddy-logo.png';
        const title = document.createElement('strong');
        const career = document.createElement('span');
        career.className = 'sja-brand-career';
        career.textContent = 'Career';
        const buddy = document.createElement('span');
        buddy.className = 'sja-brand-buddy';
        buddy.textContent = 'Buddy';
        title.append(career, buddy);
        title.title = 'Intelligent autofill & resume companion.';
        const brandCopy = document.createElement('div');
        const tagline = document.createElement('div');
        tagline.className = 'sja-panel-tagline';
        tagline.textContent = 'Intelligent autofill & resume companion.';
        brandCopy.append(title, tagline);
        brand.append(mark, brandCopy);
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
        hint.textContent = 'Click or hover a field, then choose AI to fill only that field.';
        body.append(this.pageStatus, this.pageButton, hint);
        this.pagePanel.append(header, body);
        document.body.appendChild(this.pagePanel);
        this.makePanelDraggable(header);
    }

    makePanelDraggable(header) {
        let drag = null;
        const clamp = (left, top) => {
            const rect = this.pagePanel.getBoundingClientRect();
            this.pagePanel.style.left = `${Math.max(8, Math.min(left, window.innerWidth - rect.width - 8))}px`;
            this.pagePanel.style.top = `${Math.max(8, Math.min(top, window.innerHeight - rect.height - 8))}px`;
            this.pagePanel.style.right = 'auto';
            this.pagePanel.style.bottom = 'auto';
        };
        header.addEventListener('pointerdown', event => {
            if (event.button !== 0 || event.target.closest('button')) return;
            const rect = this.pagePanel.getBoundingClientRect();
            drag = {x:event.clientX - rect.left, y:event.clientY - rect.top};
            header.setPointerCapture(event.pointerId);
            event.preventDefault();
        });
        header.addEventListener('pointermove', event => {
            if (drag) clamp(event.clientX - drag.x, event.clientY - drag.y);
        });
        const stop = () => { drag = null; };
        header.addEventListener('pointerup', stop);
        header.addEventListener('pointercancel', stop);
        header.addEventListener('lostpointercapture', stop);
        this.clampPanel = () => {
            if (this.pagePanel.style.left) {
                const rect = this.pagePanel.getBoundingClientRect();
                clamp(rect.left, rect.top);
            }
        };
        window.addEventListener('resize', this.clampPanel);
        this.panelSizeObserver = new ResizeObserver(this.clampPanel);
        this.panelSizeObserver.observe(this.pagePanel);
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
        if (source === FIELD_SOURCE.LLM) return 'inferred';
        if (source === FIELD_SOURCE.USER || confidence >= 0.9) return 'exact';
        if (source === FIELD_SOURCE.LLM || confidence >= 0.7) return 'inferred';
        return 'uncertain';
    }

    addFieldIndicators(element, matchData) {
        if (!element?.isConnected) return;
        matchData = {...matchData, validationError:this.hasValidationError(element)};
        matchData.borderLevel = this.updateFieldBorder(element, matchData);
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
        const level = matchData.validationError ? 'uncertain' : matchData.borderLevel || this.getConfidenceLevel(matchData);
        indicator.classList.add(`sja-confidence-${level}`);
        const labels = {exact:'Filled from profile or entered by you', inferred:'AI answer — review for accuracy', uncertain:'Review this answer', unfilled:'Unfilled'};
        indicator.textContent = matchData.validationError ? 'Needs review' : labels[level];
        indicator.setAttribute('title', matchData.reason || 'Filled from your saved profile');
        return indicator;
    }

    hasValidationError(element) {
        if (element.willValidate && element.validity?.valid === false) return true;
        return typeof autofillEngine !== 'undefined'
            ? autofillEngine.hasFieldError?.(element)
            : element.getAttribute('aria-invalid') === 'true';
    }

    createActionButtons(element, matchData, overlay) {
        const container = document.createElement('div');
        container.className = 'sja-actions-container';
        container.style.cssText = 'pointer-events: auto;';

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
        this.showGenerateModal(element, matchData);
    }

    async buildAIFieldInfo(element) {
        if (!element.isConnected || element.disabled || element.readOnly) {
            throw new Error('This field is no longer editable.');
        }
        const field = fieldExtractor.refreshField(element);
        const optionDetails = await (globalThis.activeAdapter ? activeAdapter.readOptions(field) : autofillEngine.captureFieldOptions(field));
        return this.describeAIField(field, optionDetails);
    }

    describeAIField(field, optionDetails = []) {
        const element = field.element;
        return {
            id: field.id, label: field.label, name: field.name, type: field.type, inputType: element.type,
            placeholder: field.placeholder, hints: field.allHints,
            context: String(field.nearbyText || '').slice(0, 2000),
            options: optionDetails.map(option => option.label), optionDetails,
            constraints: field.constraints, isLongForm: field.isLongForm,
            adapter: field.adapter, recordType: field.recordType, recordIndex: field.recordIndex,
            country: field.country, employer: field.employer, language: field.language,
            currentValue: fieldExtractor.getCurrentValue(element),
            category: globalThis.FieldPolicy?.category(field),
            pageContext: {title: document.title, url: location.origin + location.pathname}
        };
    }

    async fillSelectedFieldWithAI(element, userPrompt = '', isActive = () => true) {
        const before = JSON.stringify(fieldExtractor.getCurrentValue(element));
        const fieldInfo = await this.buildAIFieldInfo(element);
        const response = await chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.LLM_FIELD_GENERATE,
            data: {fieldId: fieldInfo.id, fieldInfo, userPrompt}
        });
        if (response?.value == null || response.value === '') {
            throw new Error(response?.error || 'No supported answer found. Add the missing information to your profile or instructions.');
        }
        if (!isActive()) throw new Error('AI fill cancelled.');
        // A selected field may already contain text, but never overwrite a newer edit.
        if (!element.isConnected || element.disabled || element.readOnly ||
            before !== JSON.stringify(fieldExtractor.getCurrentValue(element))) {
            throw new Error('The field changed while AI was working. Try again to use its latest value.');
        }
        const latest = fieldExtractor.refreshField(element);
        if (latest.label !== fieldInfo.label || latest.type !== fieldInfo.type ||
            JSON.stringify(latest.constraints) !== JSON.stringify(fieldInfo.constraints)) {
            throw new Error('The question changed while AI was working. Try again.');
        }
        if (['dropdown', 'combobox', 'radio'].includes(fieldInfo.type)) {
            const options = await autofillEngine.captureFieldOptions(latest);
            if (!options.some(option => String(option.value) === String(response.value) || option.label === String(response.value))) {
                throw new Error('The available options changed. Try again.');
            }
            if (!isActive() || !element.isConnected || element.disabled || element.readOnly ||
                before !== JSON.stringify(fieldExtractor.getCurrentValue(element))) {
                throw new Error('The field changed or AI fill was cancelled. Try again.');
            }
        }
        const option = fieldInfo.optionDetails.find(option =>
            String(option.value) === String(response.value) || option.label === String(response.value));
        const value = element.tagName !== 'SELECT' && fieldInfo.type !== 'radio' && option
            ? option.label : response.value;
        const result = await (globalThis.FieldPipeline ? FieldPipeline.fill(element,value,fieldInfo.type) : autofillEngine.fill(element, value, fieldInfo.type));
        if (!result.success && !result.entered) {
            throw new Error('Could not confirm the field selection. Review its current value.');
        }
        // Reading validity avoids firing another `invalid` event. Frameworks
        // may clear setCustomValidity asynchronously after input/change.
        const started = Date.now();
        while (element.isConnected && element.willValidate && element.validity?.valid === false && Date.now() - started < 300) {
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        const needsReview = (element.willValidate && element.validity?.valid === false) || result.verified === false;
        const validationMessage = needsReview ? element.validationMessage : '';
        const data = {...fieldInfo, fieldId: fieldInfo.id, value: response.value, intent:response.intent, qualifiers:response.qualifiers,
            confidence: response.confidence, source: FIELD_SOURCE.LLM, reason: response.reason,
            validationError: !!needsReview};
        sessionCache.set(fieldInfo.id, data);
        this.updateConfidenceIndicator(element, data);
        this.highlightField(element, needsReview ? 'uncertain' : 'inferred');
        return {needsReview: !!needsReview, validationMessage};
    }

    // ========== Generate with AI Modal ==========

    /**
     * Show the Generate with AI prompt modal
     * @param {HTMLElement} element - Target field element
     * @param {Object} matchData - Field metadata
     */
    showGenerateModal(element, matchData) {
        this.closeAllModals();

        const freshField = fieldExtractor.refreshField(element);
        const fieldLabel = freshField.label || matchData.label || element.placeholder || 'this field';
        const compactLabel = fieldLabel.replace(/\s+/g, ' ').trim();
        let displayLabel = compactLabel;
        if (compactLabel.length > 100) {
            const prefix = compactLabel.slice(0, 100);
            const wordEnd = prefix.lastIndexOf(' ');
            displayLabel = prefix.slice(0, wordEnd >= 60 ? wordEnd : 100).trimEnd() + '...';
        }

        const modal = document.createElement('div');
        modal.dataset.sjaUi = 'true';
        modal.className = 'sja-modal-overlay';
        modal.innerHTML = `<div class="sja-modal sja-generate-modal">
      <div class="sja-modal-header">
        <h3>Fill this field with AI</h3>
        <button class="sja-modal-close">&times;</button>
      </div>
      <div class="sja-modal-body">
        <p>Selected field: <strong class="sja-selected-field-label">${this.escapeHtml(displayLabel)}</strong></p>
        <div class="sja-modal-field">
          <label for="sja-generate-prompt">Instructions (optional):</label>
          <textarea id="sja-generate-prompt" class="sja-input sja-generate-textarea"
            placeholder="Use my saved profile, or add specific instructions for this answer."
            rows="4"></textarea>
        </div>
        <div id="sja-generate-status" class="sja-generate-status" style="display:none;">
          <span class="sja-generate-spinner">⏳</span>
          <span>Generating...</span>
        </div>
      </div>
      <div class="sja-modal-footer">
        <button class="sja-btn sja-btn-secondary sja-modal-cancel">Cancel</button>
        <button class="sja-btn sja-btn-primary sja-generate-confirm">Fill with AI</button>
      </div>
    </div>`;

        document.body.appendChild(modal);
        this.activeModals.set(element, modal);
        modal.querySelector('.sja-selected-field-label').setAttribute('title', fieldLabel);

        // Event listeners
        const promptTextarea = modal.querySelector('#sja-generate-prompt');
        const generateBtn = modal.querySelector('.sja-generate-confirm');
        const statusDiv = modal.querySelector('#sja-generate-status');

        modal.querySelector('.sja-modal-close').addEventListener('click', () => this.closeModal(element));
        modal.querySelector('.sja-modal-cancel').addEventListener('click', () => this.closeModal(element));
        modal.addEventListener('click', (e) => { if (e.target === modal) this.closeModal(element); });

        generateBtn.addEventListener('click', async () => {
            const userPrompt = promptTextarea.value.trim();
            // Show loading state
            generateBtn.disabled = true;
            generateBtn.textContent = '⏳ Generating...';
            statusDiv.style.display = 'flex';

            try {
                const result = await this.fillSelectedFieldWithAI(element, userPrompt, () => this.activeModals.get(element) === modal);
                this.closeModal(element);
                this.showToast(result.needsReview
                    ? `Value filled. Review the field validation${result.validationMessage ? ': ' + result.validationMessage : '.'}`
                    : 'Selected field filled with AI');
            } catch (error) {
                console.error('[InlineUI] Generate failed:', error);
                this.showToast(error.message || 'AI could not fill this field', 'error');
                generateBtn.disabled = false;
                generateBtn.textContent = 'Fill with AI';
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
        matchData = {...matchData, borderLevel:this.updateFieldBorder(element, matchData)};
        const overlay = this.fieldOverlays.get(element)?.overlay;
        const indicator = overlay?.querySelector('.sja-confidence-indicator');
        if (!indicator) return;
        const next = this.createConfidenceIndicator({...matchData, validationError:this.hasValidationError(element)});
        indicator.replaceWith(next);
    }

    showSaveModal(element, matchData) {
        this.closeAllModals();
        const field = fieldExtractor.refreshField(element);
        const fieldLabel = field.label || matchData.label || field.name || 'Custom field';
        const currentValue = element.type === 'checkbox' ? element.checked : fieldExtractor.getCurrentValue(element);
        const modal = document.createElement('div');
        modal.dataset.sjaUi = 'true';
        modal.className = 'sja-modal-overlay';
        modal.innerHTML = `<div class="sja-modal">
      <div class="sja-modal-header"><h3>💾 Save to Profile</h3><button class="sja-modal-close">&times;</button></div>
      <div class="sja-modal-body">
        <p>Save this value to your profile?</p>
        <div><strong>Field:</strong> <span id="sja-save-field-label"></span></div>
        <div><strong>Value:</strong> <span id="sja-save-field-value"></span></div>
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
        modal.querySelector('#sja-save-field-label').textContent = truncateText(fieldLabel, 100);
        modal.querySelector('#sja-save-field-label').title = fieldLabel;
        modal.querySelector('#sja-save-field-value').textContent = truncateText(String(currentValue ?? ''), 100);
        const profilePath = matchData.profilePath || sessionCache.get(field.id)?.profilePath;
        select.value = Array.from(select.options).some(option => option.value === profilePath) ? profilePath : 'custom';
        modal.querySelector('#sja-custom-key').value = fieldLabel;
        customInput.style.display = select.value === 'custom' ? 'block' : 'none';
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
            const info=await this.buildAIFieldInfo(element);
            const current=fieldExtractor.getCurrentValue(element);
            const option=info.optionDetails.find(option=>String(option.value)===String(current) || option.label===String(current));
            const cached=sessionCache.get(info.id);
            const response = await chrome.runtime.sendMessage({
                type: MESSAGE_TYPES.SAVE_TO_PROFILE,
                data: {path:profilePath,value:element.type==='checkbox'?element.checked:option?.label || current,
                    fieldInfo:info,intent:cached?.intent,qualifiers:cached?.qualifiers}
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
        element.classList.remove('sja-autofilled-exact', 'sja-autofilled-inferred', 'sja-autofilled-uncertain', 'sja-autofilled-unfilled');
        element.classList.add('sja-autofilled', `sja-autofilled-${level}`);
    }

    updateFieldBorder(element, matchData) {
        const value = fieldExtractor.getCurrentValue(element);
        const cached = sessionCache.get(element.dataset.sjaFieldId || matchData.fieldId);
        const answered = value !== '' && value != null && value !== false && !(Array.isArray(value) && !value.length) ||
            element.type === 'checkbox' && cached?.value === false;
        const level = this.hasValidationError(element) || matchData.validationError ? 'uncertain' :
            !answered ? 'unfilled' : this.getConfidenceLevel(matchData);
        this.highlightField(element, level);
        return level;
    }

    removeFieldUI(element) {
        const entry = this.fieldOverlays.get(element);
        entry?.cleanup();
        entry?.overlay.remove();
        this.fieldOverlays.delete(element);
        this.layoutObserver?.unobserve(element);
        if (this.activeField === element) this.activeField = null;
        element.classList.remove('sja-autofilled', 'sja-autofilled-exact', 'sja-autofilled-inferred', 'sja-autofilled-uncertain', 'sja-autofilled-unfilled');
        delete element.dataset.sjaProcessed;
    }

    cleanup() {
        this.closeAllModals();
        for (const element of this.fieldOverlays.keys()) this.removeFieldUI(element);
        this.tooltips.forEach(tooltip => tooltip.remove());
        this.tooltips.clear();
        this.layoutObserver?.disconnect();
        this.panelSizeObserver?.disconnect();
        window.removeEventListener('resize', this.clampPanel);
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
