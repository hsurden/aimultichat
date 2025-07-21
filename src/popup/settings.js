// Import services config
import { SERVICES } from '../services-config.js';

document.addEventListener('DOMContentLoaded', async () => {
    // Load current settings
    const prefs = await chrome.storage.local.get(['checkedServices', 'defaultCompanionService', 'customServiceConfigs']);
    const checkedServices = prefs.checkedServices || ['chatgpt', 'claude', 'gemini'];
    const defaultCompanionService = prefs.defaultCompanionService || 'chatgpt';
    const customServiceConfigs = prefs.customServiceConfigs || {};
    
    // Helper function to get display URL from match pattern
    function getDisplayUrl(match) {
        if (!match) return 'Unknown URL';
        
        let source;
        if (typeof match === 'string') {
            source = match;
        } else if (match.source) {
            source = match.source;
        } else if (match instanceof RegExp) {
            source = match.source;
        } else {
            return 'Unknown URL';
        }
        
        return source.replace(/\\\./g, '.').replace(/\$$/, '').replace(/^\^/, '');
    }

    // Helper function to get regex source for editing
    function getRegexSource(match) {
        if (!match) return '';
        
        if (typeof match === 'string') {
            return match;
        } else if (match.source) {
            return match.source;
        } else if (match instanceof RegExp) {
            return match.source;
        }
        
        return '';
    }

    // Populate service toggles dynamically
    function populateServiceToggles() {
        const serviceTogglesContainer = document.querySelector('.service-toggles');
        serviceTogglesContainer.innerHTML = ''; // Clear existing toggles
        
        Object.entries(serviceConfigs).forEach(([serviceKey, serviceConfig]) => {
            const toggle = document.createElement('label');
            toggle.className = 'service-toggle';
            toggle.innerHTML = `
                <input type="checkbox" id="${serviceKey}-toggle" value="${serviceKey}">
                <span class="toggle-slider"></span>
                <div class="service-info">
                    <div class="service-name">${serviceConfig.label}</div>
                    <div class="service-url">${getDisplayUrl(serviceConfig.match)}</div>
                </div>
            `;
            serviceTogglesContainer.appendChild(toggle);
            
            // Set checked state
            const checkbox = toggle.querySelector('input');
            checkbox.checked = checkedServices.includes(serviceKey);
        });
    }
    
    // Populate companion service selector
    function populateCompanionSelect() {
        const companionSelect = document.getElementById('companion-service-select');
        companionSelect.innerHTML = '';
        
        Object.entries(serviceConfigs).forEach(([serviceKey, serviceConfig]) => {
            const option = document.createElement('option');
            option.value = serviceKey;
            option.textContent = serviceConfig.label;
            companionSelect.appendChild(option);
        });
        
        companionSelect.value = defaultCompanionService;
        
        // Add event listener for companion service changes
        companionSelect.addEventListener('change', () => {
            chrome.storage.local.set({ defaultCompanionService: companionSelect.value });
        });
    }
    
    // Handle service toggle changes using event delegation
    document.querySelector('.service-toggles').addEventListener('change', (e) => {
        if (e.target.type === 'checkbox') {
            const selectedServices = Array.from(document.querySelectorAll('input[type="checkbox"]:checked'))
                .map(cb => cb.value);
            
            // Ensure at least one service is selected
            if (selectedServices.length === 0) {
                e.target.checked = true;
                return;
            }
            
            chrome.storage.local.set({ checkedServices: selectedServices });
        }
    });
    
    // Handle back button
    document.getElementById('back-button').addEventListener('click', () => {
        window.location.href = 'mode-selection.html';
    });
    
    // Service Configuration Management
    let currentService = 'chatgpt';
    let serviceConfigs = { ...SERVICES };
    let customServices = {}; // Track completely custom services
    
    // Load custom services and configurations
    const result = await chrome.storage.local.get(['customServices']);
    customServices = result.customServices || {};
    
    // Merge custom services into serviceConfigs
    Object.keys(customServices).forEach(serviceKey => {
        const customService = { ...customServices[serviceKey] };
        
        // Handle regex deserialization for custom services
        if (customService.match && typeof customService.match === 'object' && customService.match.source) {
            customService.match = new RegExp(customService.match.source, customService.match.flags || '');
        }
        
        serviceConfigs[serviceKey] = customService;
    });
    
    // Apply any custom configurations to existing services
    Object.keys(customServiceConfigs).forEach(serviceKey => {
        if (serviceConfigs[serviceKey]) {
            serviceConfigs[serviceKey] = { ...serviceConfigs[serviceKey], ...customServiceConfigs[serviceKey] };
        }
    });
    
    // Set up the dynamic UI after serviceConfigs is fully initialized
    populateServiceToggles();
    populateCompanionSelect();
    
    function createServiceEditor(serviceKey) {
        const service = serviceConfigs[serviceKey];
        const editor = document.getElementById('service-editor');
        
        editor.innerHTML = `
            <div class="config-field">
                <div class="config-field-label">Service Label</div>
                <div class="config-field-description">Display name for the service</div>
                <input type="text" class="config-input" id="label-input" value="${service.label}" style="min-height: auto;">
            </div>
            
            <div class="config-field">
                <div class="config-field-label">URL Pattern (RegExp)</div>
                <div class="config-field-description">Regular expression to match service URLs</div>
                <input type="text" class="config-input" id="match-input" value="${getRegexSource(service.match)}" style="min-height: auto;">
            </div>
            
            <div class="config-field">
                <div class="config-field-label">Input Selectors</div>
                <div class="config-field-description">CSS selectors for input fields (one per line)</div>
                <textarea class="config-input" id="input-selectors">${service.inputSelectors.join('\\n')}</textarea>
            </div>
            
            <div class="config-field">
                <div class="config-field-label">Send Button Selectors</div>
                <div class="config-field-description">CSS selectors for send buttons (one per line)</div>
                <textarea class="config-input" id="send-selectors">${service.sendButtonSelectors.join('\\n')}</textarea>
            </div>
            
            <div class="config-checkbox">
                <input type="checkbox" id="use-enter" ${service.useEnter ? 'checked' : ''}>
                <label for="use-enter">Use Enter key to send</label>
            </div>
            
            ${service.preFocus !== undefined ? `
            <div class="config-checkbox">
                <input type="checkbox" id="pre-focus" ${service.preFocus ? 'checked' : ''}>
                <label for="pre-focus">Pre-focus input field</label>
            </div>
            ` : ''}
        `;
        
        // Add event listeners for auto-save
        editor.querySelectorAll('input, textarea').forEach(input => {
            input.addEventListener('input', () => saveServiceConfig(serviceKey));
            input.addEventListener('change', () => saveServiceConfig(serviceKey));
        });
    }
    
    function saveServiceConfig(serviceKey) {
        const editor = document.getElementById('service-editor');
        const labelInput = editor.querySelector('#label-input');
        const matchInput = editor.querySelector('#match-input');
        const inputSelectors = editor.querySelector('#input-selectors');
        const sendSelectors = editor.querySelector('#send-selectors');
        const useEnter = editor.querySelector('#use-enter');
        const preFocus = editor.querySelector('#pre-focus');
        
        try {
            // Validate regex
            new RegExp(matchInput.value);
            
            const updatedConfig = {
                label: labelInput.value.trim(),
                match: new RegExp(matchInput.value),
                inputSelectors: inputSelectors.value.split('\\n').filter(s => s.trim()),
                sendButtonSelectors: sendSelectors.value.split('\\n').filter(s => s.trim()),
                useEnter: useEnter.checked
            };
            
            if (preFocus) {
                updatedConfig.preFocus = preFocus.checked;
            }
            
            // Update local config
            serviceConfigs[serviceKey] = updatedConfig;
            
            // Save custom modifications to storage
            const customConfig = {};
            const original = SERVICES[serviceKey];
            
            // Only store differences from original
            if (updatedConfig.label !== original.label) customConfig.label = updatedConfig.label;
            if (updatedConfig.match.source !== original.match.source) {
                // Store regex as serializable object
                customConfig.match = { 
                    source: updatedConfig.match.source, 
                    flags: updatedConfig.match.flags || '' 
                };
            }
            if (JSON.stringify(updatedConfig.inputSelectors) !== JSON.stringify(original.inputSelectors)) {
                customConfig.inputSelectors = updatedConfig.inputSelectors;
            }
            if (JSON.stringify(updatedConfig.sendButtonSelectors) !== JSON.stringify(original.sendButtonSelectors)) {
                customConfig.sendButtonSelectors = updatedConfig.sendButtonSelectors;
            }
            if (updatedConfig.useEnter !== original.useEnter) customConfig.useEnter = updatedConfig.useEnter;
            if (updatedConfig.preFocus !== original.preFocus) customConfig.preFocus = updatedConfig.preFocus;
            
            const allCustomConfigs = { ...customServiceConfigs };
            if (Object.keys(customConfig).length > 0) {
                allCustomConfigs[serviceKey] = customConfig;
            } else {
                delete allCustomConfigs[serviceKey];
            }
            
            chrome.storage.local.set({ customServiceConfigs: allCustomConfigs });
            
            // Send update to background script
            chrome.runtime.sendMessage({
                type: 'UPDATE_SERVICE_CONFIG',
                serviceKey,
                config: updatedConfig
            });
            
        } catch (error) {
            console.error('Invalid configuration:', error);
            // Could add visual feedback here
        }
    }
    
    function resetServiceToDefault(serviceKey) {
        // Check if this is a custom service (can't reset custom services to default)
        if (customServices[serviceKey]) {
            alert('Custom services cannot be reset to default. Use the delete button instead.');
            return;
        }
        
        const originalConfig = SERVICES[serviceKey];
        serviceConfigs[serviceKey] = { ...originalConfig };
        
        // Remove from custom configs
        const allCustomConfigs = { ...customServiceConfigs };
        delete allCustomConfigs[serviceKey];
        chrome.storage.local.set({ customServiceConfigs: allCustomConfigs });
        
        // Update UI
        createServiceEditor(serviceKey);
        
        // Send update to background script
        chrome.runtime.sendMessage({
            type: 'UPDATE_SERVICE_CONFIG',
            serviceKey,
            config: originalConfig
        });
    }
    
    function createCustomService(serviceKey, serviceData) {
        // Validate input
        if (!serviceKey || !serviceData.label || !serviceData.match) {
            alert('Please fill in all required fields.');
            return false;
        }
        
        // Check if service key already exists
        if (serviceConfigs[serviceKey]) {
            alert('A service with this key already exists. Please choose a different key.');
            return false;
        }
        
        try {
            // Validate regex
            new RegExp(serviceData.match);
            
            const newService = {
                label: serviceData.label.trim(),
                match: new RegExp(serviceData.match),
                inputSelectors: serviceData.inputSelectors || [
                    'div[contenteditable="true"]',
                    '#ask-input', // Perplexity
                    'textarea',
                    'input[type="text"]',
                    '[role="textbox"]'
                ],
                sendButtonSelectors: serviceData.sendButtonSelectors || [
                    'button[type="submit"]',
                    'button[aria-label*="Send"]',
                    'button[aria-label*="send"]',
                    'button:has(svg)',
                    'button.send-button'
                ],
                useEnter: serviceData.useEnter !== false, // default to true
                preFocus: serviceData.preFocus || false
            };
            
            // Create serializable version for storage
            const storableService = {
                ...newService,
                match: {
                    source: newService.match.source,
                    flags: newService.match.flags || ''
                }
            };
            
            // Add to configurations
            serviceConfigs[serviceKey] = newService;
            customServices[serviceKey] = storableService;
            
            // Save to storage
            chrome.storage.local.set({ customServices });
            
            // Add tab to UI
            addServiceTab(serviceKey, newService.label, true);
            
            // Send to background script
            chrome.runtime.sendMessage({
                type: 'ADD_CUSTOM_SERVICE',
                serviceKey,
                config: newService
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.log('Background script not responding:', chrome.runtime.lastError);
                }
            });
            
            return true;
        } catch (error) {
            alert('Invalid URL pattern (regex): ' + error.message);
            return false;
        }
    }
    
    function deleteCustomService(serviceKey) {
        if (!customServices[serviceKey]) {
            alert('Only custom services can be deleted.');
            return;
        }
        
        if (!confirm(`Delete custom service "${serviceConfigs[serviceKey].label}"? This cannot be undone.`)) {
            return;
        }
        
        // Remove from configurations
        delete serviceConfigs[serviceKey];
        delete customServices[serviceKey];
        
        // Save to storage
        chrome.storage.local.set({ customServices });
        
        // Remove from UI
        removeServiceTab(serviceKey);
        
        // If this was the current service, switch to default
        if (currentService === serviceKey) {
            switchToService('chatgpt');
        }
        
        // Send to background script
        chrome.runtime.sendMessage({
            type: 'REMOVE_CUSTOM_SERVICE',
            serviceKey
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.log('Background script not responding:', chrome.runtime.lastError);
            }
        });
        
        // Refresh the settings UI to remove the deleted service
        populateServiceToggles();
        populateCompanionSelect();
    }
    
    function addServiceTab(serviceKey, label, isCustom = false) {
        const tabsContainer = document.getElementById('service-tabs');
        const tab = document.createElement('button');
        tab.className = `config-tab${isCustom ? ' custom-service' : ''}`;
        tab.dataset.service = serviceKey;
        tab.textContent = label;
        
        if (isCustom) {
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-service-btn';
            deleteBtn.innerHTML = '×';
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                deleteCustomService(serviceKey);
            };
            tab.appendChild(deleteBtn);
        }
        
        tab.addEventListener('click', () => {
            document.querySelectorAll('.config-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentService = serviceKey;
            createServiceEditor(currentService);
        });
        
        tabsContainer.appendChild(tab);
    }
    
    function removeServiceTab(serviceKey) {
        const tab = document.querySelector(`[data-service="${serviceKey}"]`);
        if (tab) {
            tab.remove();
        }
    }
    
    function switchToService(serviceKey) {
        const tab = document.querySelector(`[data-service="${serviceKey}"]`);
        if (tab) {
            tab.click();
        }
    }
    
    // Tab switching
    document.querySelectorAll('.config-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.config-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentService = tab.dataset.service;
            createServiceEditor(currentService);
        });
    });
    
    // Reset button
    document.getElementById('reset-service-btn').addEventListener('click', () => {
        if (confirm(`Reset ${serviceConfigs[currentService].label} to default configuration?`)) {
            resetServiceToDefault(currentService);
        }
    });
    
    // Export configuration
    document.getElementById('export-config-btn').addEventListener('click', () => {
        const exportData = {
            version: '1.0',
            timestamp: new Date().toISOString(),
            services: customServiceConfigs
        };
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'aimultichat-service-config.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });
    
    // Import configuration
    document.getElementById('import-config-btn').addEventListener('click', () => {
        document.getElementById('config-file-input').click();
    });
    
    // New service form handlers
    document.getElementById('add-new-service-btn').addEventListener('click', () => {
        document.getElementById('new-service-form').style.display = 'block';
        document.getElementById('add-new-service-btn').style.display = 'none';
        document.getElementById('new-service-key').focus();
    });
    
    document.getElementById('cancel-new-service-btn').addEventListener('click', () => {
        document.getElementById('new-service-form').style.display = 'none';
        document.getElementById('add-new-service-btn').style.display = 'block';
        // Clear form
        document.getElementById('new-service-key').value = '';
        document.getElementById('new-service-label').value = '';
        document.getElementById('new-service-match').value = '';
    });
    
    document.getElementById('save-new-service-btn').addEventListener('click', () => {
        const serviceKey = document.getElementById('new-service-key').value.trim().toLowerCase();
        const serviceData = {
            label: document.getElementById('new-service-label').value.trim(),
            match: document.getElementById('new-service-match').value.trim()
        };
        
        if (createCustomService(serviceKey, serviceData)) {
            // Success - hide form and clear inputs
            document.getElementById('new-service-form').style.display = 'none';
            document.getElementById('add-new-service-btn').style.display = 'block';
            document.getElementById('new-service-key').value = '';
            document.getElementById('new-service-label').value = '';
            document.getElementById('new-service-match').value = '';
            
            // Switch to the newly created service
            switchToService(serviceKey);
            
            // Refresh the settings UI to include the new service
            populateServiceToggles();
            populateCompanionSelect();
        }
    });
    
    document.getElementById('config-file-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const importData = JSON.parse(e.target.result);
                
                if (importData.services) {
                    // Validate imported configs
                    const validConfigs = {};
                    Object.keys(importData.services).forEach(serviceKey => {
                        if (SERVICES[serviceKey]) {
                            validConfigs[serviceKey] = importData.services[serviceKey];
                        }
                    });
                    
                    // Save imported configs
                    chrome.storage.local.set({ customServiceConfigs: validConfigs });
                    
                    // Update local state
                    Object.assign(customServiceConfigs, validConfigs);
                    Object.keys(validConfigs).forEach(serviceKey => {
                        serviceConfigs[serviceKey] = { ...SERVICES[serviceKey], ...validConfigs[serviceKey] };
                    });
                    
                    // Refresh current editor
                    createServiceEditor(currentService);
                    
                    alert('Configuration imported successfully!');
                } else {
                    alert('Invalid configuration file format.');
                }
            } catch (error) {
                console.error('Import error:', error);
                alert('Error importing configuration file.');
            }
        };
        reader.readAsText(file);
    });
    
    // Add custom service tabs to UI
    Object.keys(customServices).forEach(serviceKey => {
        addServiceTab(serviceKey, customServices[serviceKey].label, true);
    });
    
    // Initialize service editor
    createServiceEditor(currentService);
});