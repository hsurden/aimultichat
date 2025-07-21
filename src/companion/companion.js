document.addEventListener('DOMContentLoaded', async () => {
    const copyContextCheckbox = document.getElementById('copy-context-checkbox');
    const toggleButton = document.getElementById('toggle-button');
    const optionsContainer = document.getElementById('options-container');
    const serviceDropdown = document.getElementById('service-dropdown');

    // Load initial settings from storage
    const prefs = await chrome.storage.local.get(['companionSettings', 'defaultCompanionService']);
    const settings = prefs.companionSettings || { copyContext: true, isExpanded: false };
    const currentService = prefs.defaultCompanionService || 'chatgpt';
    
    copyContextCheckbox.checked = settings.copyContext;
    serviceDropdown.value = currentService;
    
    if (settings.isExpanded) {
        optionsContainer.classList.remove('collapsed');
        toggleButton.classList.remove('collapsed');
    }

    // Listen for changes to the service dropdown
    serviceDropdown.addEventListener('change', () => {
        const newService = serviceDropdown.value;
        chrome.storage.local.set({ defaultCompanionService: newService });
        chrome.runtime.sendMessage({
            type: 'SWITCH_COMPANION_SERVICE',
            service: newService
        });
    });

    // Listen for changes to the "Copy Context" checkbox
    copyContextCheckbox.addEventListener('change', () => {
        const newSettings = { 
            copyContext: copyContextCheckbox.checked,
            isExpanded: !optionsContainer.classList.contains('collapsed')
        };
        chrome.runtime.sendMessage({
            type: 'UPDATE_COMPANION_SETTINGS',
            settings: newSettings
        });
    });

    // Handle expand/collapse toggle
    toggleButton.addEventListener('click', () => {
        // This feature is not fully implemented, but we can save the state.
        optionsContainer.classList.toggle('collapsed');
        toggleButton.classList.toggle('collapsed');
        const newSettings = {
            copyContext: copyContextCheckbox.checked,
            isExpanded: !optionsContainer.classList.contains('collapsed')
        };
        // Save the expanded state so it persists
        chrome.storage.local.set({ companionSettings: newSettings });
    });
});
