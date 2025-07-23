document.addEventListener('DOMContentLoaded', async () => {
    const copyContextCheckbox = document.getElementById('copy-context-checkbox');
    const toggleButton = document.getElementById('toggle-button');
    const optionsContainer = document.getElementById('options-container');
    const serviceDropdown = document.getElementById('service-dropdown');
    const refreshButton = document.getElementById('refresh-content');
    const previewText = document.getElementById('preview-text');
    const contentStats = document.getElementById('content-stats');

    // Load initial settings from storage
    const prefs = await chrome.storage.local.get(['companionSettings', 'defaultCompanionService']);
    const settings = prefs.companionSettings || { copyContext: true, isExpanded: false };
    const currentService = prefs.defaultCompanionService || 'chatgpt';
    
    copyContextCheckbox.checked = settings.copyContext;
    serviceDropdown.value = currentService;
    
    if (settings.isExpanded) {
        optionsContainer.classList.remove('collapsed');
        toggleButton.classList.remove('collapsed');
        
        // Resize window to accommodate expanded content on startup
        chrome.windows.getCurrent((window) => {
            chrome.windows.update(window.id, {
                height: 375
            });
        });
    }

    // Request initial content status
    requestContentUpdate();

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
        const wasCollapsed = optionsContainer.classList.contains('collapsed');
        optionsContainer.classList.toggle('collapsed');
        toggleButton.classList.toggle('collapsed');
        
        const newSettings = {
            copyContext: copyContextCheckbox.checked,
            isExpanded: !optionsContainer.classList.contains('collapsed')
        };
        
        // Resize the window to accommodate expanded content
        if (!wasCollapsed) {
            // Collapsing - shrink window
            chrome.windows.getCurrent((window) => {
                chrome.windows.update(window.id, {
                    height: 55
                });
            });
        } else {
            // Expanding - grow window
            chrome.windows.getCurrent((window) => {
                chrome.windows.update(window.id, {
                    height: 175 // 55 base + 120 for expanded content
                });
            });
        }
        
        // Save the expanded state so it persists
        chrome.storage.local.set({ companionSettings: newSettings });
    });

    // Handle refresh button click
    refreshButton.addEventListener('click', () => {
        refreshButton.disabled = true;
        refreshButton.textContent = '⟳ Refreshing...';
        
        chrome.runtime.sendMessage({
            type: 'REFRESH_PAGE_CONTENT'
        }, (response) => {
            refreshButton.disabled = false;
            refreshButton.textContent = '⟳ Refresh';
            
            if (!response || !response.success) {
                console.error('Failed to refresh content:', response?.error);
            }
        });
    });

    // Function to request current content status
    function requestContentUpdate() {
        chrome.runtime.sendMessage({
            type: 'GET_CACHED_CONTENT'
        }, (response) => {
            if (response) {
                updateContentDisplay(response.content, response.url);
            }
        });
    }

    // Function to update content display
    function updateContentDisplay(content, url) {
        console.log('update content');
        if (content && content.trim()) {
            // Show first 100 chars as preview
            const preview = content.substring(0, 400);
            previewText.textContent = content ;
            
            // Show word count and other stats
            const wordCount = content.split(/\s+/).length;
            const charCount = content.length;
            contentStats.textContent = `${wordCount} words, ${charCount} characters`;
            
            // Show truncation info if present
            if (content.includes('[Content truncated')) {
                const match = content.match(/showing first (\d+) words of (\d+) total words/);
                if (match) {
                    contentStats.textContent += ` (truncated from ${match[2]} words)`;
                }
            }
        } else {
            previewText.textContent = 'No content cached';
            contentStats.textContent = '';
        }
    }

    // Listen for content updates from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'CONTENT_CACHE_UPDATED') {
            updateContentDisplay(
                message.hasContent ? message.preview : null, 
                message.url
            );
            
            // Update stats with actual word count from background
            if (message.hasContent && message.wordCount) {
                contentStats.textContent = `${message.wordCount} words`;
            }
            
            sendResponse({ received: true });
        }
    });
});
