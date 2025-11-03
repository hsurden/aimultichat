// This content script runs on all pages to listen for text selection.

if (typeof window.hasRunSelectionListener === 'undefined') {
    window.hasRunSelectionListener = true;

    let debounceTimer;

    function handleSelectionChange() {
        // If the runtime or its ID is gone, the extension has been reloaded or uninstalled.
        // In that case, we should remove the event listener to prevent further errors.
        if (!chrome.runtime || !chrome.runtime.id) {
            document.removeEventListener('selectionchange', handleSelectionChange);
            return;
        }

        // Debounce to avoid sending too many messages while dragging.
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            // Check again in case the context was lost during the timeout.
            if (!chrome.runtime || !chrome.runtime.id) {
                return;
            }

            const selection = window.getSelection().toString().trim();
            
            chrome.runtime.sendMessage({
                type: 'SELECTION_CONTEXT_UPDATE',
                text: selection,
            }, (response) => {
                // This callback can be used to handle cases where the background
                // script is not listening, which can happen if the extension is
                // disabled or in an error state. We can check chrome.runtime.lastError.
                if (chrome.runtime.lastError) {
                    // Optional: log an error or handle it silently.
                    // console.log('Could not send selection update:', chrome.runtime.lastError.message);
                }
            });
        }, 250);
    }

    document.addEventListener('selectionchange', handleSelectionChange);
    
    // Also check if this page should be treated as an AI service (for custom services)
    checkForAIService();
}

// Function to check if current page matches any AI service and load functionality
async function checkForAIService() {
    try {
        // Load all services (including custom ones) from storage
        const result = await chrome.storage.local.get(['customServices', 'customServiceConfigs']);
        const customServices = result.customServices || {};
        const customServiceConfigs = result.customServiceConfigs || {};
        
        // Build complete services list
        const DEFAULT_SERVICES = {
            chatgpt: {
                label: "ChatGPT",
                match: /(?:chat\.openai\.com|chatgpt\.com)$/,
                inputSelectors: [
                    '#prompt-textarea',
                    'textarea[data-id="root"]'
                ],
                sendButtonSelectors: [
                    'button[data-testid="send-button"]',
                    'button[aria-label="Send message"]'
                ],
                useEnter: true
            },
            claude: {
                label: "Claude", 
                match: /claude\.ai$/,
                inputSelectors: ['div[contenteditable="true"][data-testid*="composer"]', 'div[contenteditable="true"]', 'textarea'],
                sendButtonSelectors: ['button:has(svg[data-testid="SendIcon"])', 'button[aria-label*="Send"]'],
                useEnter: false
            },
            gemini: {
                label: "Gemini",
                match: /gemini\.google\.com$/,
                inputSelectors: ['div.ql-editor[contenteditable="true"]', 'rich-textarea div[contenteditable="true"]', 'div[contenteditable="true"][data-placeholder*="Gemini"]', 'div[contenteditable="true"]', 'textarea'],
                sendButtonSelectors: ['button[aria-label*="Send message"]', 'button[aria-label*="Send"]', 'button.send-button'],
                useEnter: true,
                preFocus: true
            },
            perplexity: {
                label: "Perplexity",
                match: /perplexity\.ai$/,
                inputSelectors: ['#ask-input', 'div[contenteditable="true"]', '[role="textbox"]', 'textarea'],
                sendButtonSelectors: ['button[aria-label*="Submit"]', 'button[aria-label*="Send"]', 'button[type="submit"]', 'button:has(svg)', '.send-button'],
                useEnter: true,
                preFocus: true
            },
            deepseek: {
                label: "Deepseek",
                match: /chat\.deepseek\.com$/,
                inputSelectors: ['div[contenteditable="true"]', 'textarea[placeholder*="message"]', 'textarea', '[role="textbox"]'],
                sendButtonSelectors: ['button[aria-label*="Send"]', 'button[type="submit"]', 'button:has(svg)', '.send-button'],
                useEnter: true
            },
            grok: {
                label: "Grok",
                match: /grok\.x\.ai$/,
                inputSelectors: ['div[contenteditable="true"]', 'textarea', '[role="textbox"]', 'input[type="text"]'],
                sendButtonSelectors: ['button[aria-label*="Send"]', 'button[type="submit"]', 'button:has(svg)', '.send-button'],
                useEnter: true
            }
        };
        
        let SERVICES = { ...DEFAULT_SERVICES };
        
        // Add custom services
        Object.keys(customServices).forEach(serviceKey => {
            const customService = { ...customServices[serviceKey] };
            
            // Handle regex deserialization for custom services
            if (customService.match && typeof customService.match === 'object' && customService.match.source) {
                customService.match = new RegExp(customService.match.source, customService.match.flags || '');
            }
            
            SERVICES[serviceKey] = customService;
        });
        
        // Apply custom configurations to existing services
        Object.keys(customServiceConfigs).forEach(serviceKey => {
            if (SERVICES[serviceKey]) {
                const baseConfig = DEFAULT_SERVICES[serviceKey] || SERVICES[serviceKey];
                SERVICES[serviceKey] = { ...baseConfig, ...customServiceConfigs[serviceKey] };
                
                // Handle regex conversion for match field if it was stored as serialized object
                if (customServiceConfigs[serviceKey].match && typeof customServiceConfigs[serviceKey].match === 'object' && customServiceConfigs[serviceKey].match.source) {
                    SERVICES[serviceKey].match = new RegExp(customServiceConfigs[serviceKey].match.source, customServiceConfigs[serviceKey].match.flags || '');
                }
            }
        });
        
        // Check if current hostname matches any service
        const hostname = location.hostname.replace(/^www\./, '');
        const matchedService = Object.keys(SERVICES).find(key => SERVICES[key].match.test(hostname));
        
        if (matchedService) {
            // This page is an AI service - load the main content script functionality
            console.log(`[AIMultiChat] Detected AI service: ${matchedService}`);
            
            // Dynamically load and execute the content script
            loadAIServiceScript(matchedService, SERVICES[matchedService]);
        }
        
    } catch (error) {
        console.error('[AIMultiChat] Error checking for AI service:', error);
    }
}

// Function to load AI service functionality for detected services
function loadAIServiceScript(serviceName, serviceConfig) {
    // Avoid double-loading if content script already ran
    if (window.hasRunAIServiceScript) {
        return;
    }
    window.hasRunAIServiceScript = true;
    
    let cfg = serviceConfig;
    let isCompanionMode = false;
    
    // Register this service with background script
    chrome.runtime.sendMessage({ type: 'REGISTER_SERVICE', service: serviceName });
    
    function log(...args) {
        console.log('[AIMultiChat]', ...args);
    }
    
    function findFirst(selectors) {
        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el) return el;
        }
        return null;
    }
    
    async function waitForInput(timeout = 5000) {
        return new Promise((resolve, reject) => {
            const check = () => {
                const inputEl = findFirst(cfg.inputSelectors);
                if (inputEl) {
                    resolve(inputEl);
                } else {
                    setTimeout(check, 100);
                }
            };
            check();
            setTimeout(() => reject(new Error('Input not found')), timeout);
        });
    }
    
    function insertPrompt(inputEl, text) {
        if (!inputEl) return;
        
        if (inputEl.isContentEditable) {
            inputEl.innerHTML = text.replace(/\n/g, '<br>');
            inputEl.focus();
            
            // Position cursor at end
            const range = document.createRange();
            const sel = window.getSelection();
            range.selectNodeContents(inputEl);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
        } else {
            inputEl.value = text;
            inputEl.focus();
        }
        
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
    
    function performSend(inputEl) {
        const sendButton = findFirst(cfg.sendButtonSelectors);
        if (sendButton && !sendButton.disabled) {
            sendButton.click();
        } else if (cfg.useEnter) {
            ['keydown', 'keypress', 'keyup'].forEach(type => {
                const enterEvent = new KeyboardEvent(type, {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    charCode: 13,
                    bubbles: true,
                    cancelable: true
                });
                ['keyCode', 'which', 'charCode'].forEach(prop => {
                    if (enterEvent[prop] !== 13) {
                        Object.defineProperty(enterEvent, prop, {
                            value: 13,
                            writable: false,
                            configurable: true
                        });
                    }
                });
                inputEl.dispatchEvent(enterEvent);
            });
        }
    }
    
    async function injectAndSend(text) {
        try {
            const inputEl = await waitForInput();
            insertPrompt(inputEl, text);
            
            setTimeout(() => {
                performSend(inputEl);
            }, 100);
            
        } catch (error) {
            throw new Error(`Failed to inject text: ${error.message}`);
        }
    }
    
    // Message listener for broadcast functionality
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'INJECT_AND_SEND' && msg.service === serviceName) {
            (async () => {
                try {
                    await injectAndSend(msg.text);
                    chrome.runtime.sendMessage({
                        type: 'SERVICE_FEEDBACK',
                        service: serviceName,
                        status: 'sent'
                    });
                } catch (e) {
                    chrome.runtime.sendMessage({
                        type: 'SERVICE_FEEDBACK',
                        service: serviceName,
                        status: 'error',
                        error: e.message
                    });
                }
            })();
        }
        
        if (msg.type === 'INJECT_TEXT_REALTIME' && msg.service === serviceName) {
            if (isCompanionMode) {
                return;
            }
            
            (async () => {
                try {
                    const inputEl = await waitForInput(1000);
                    insertPrompt(inputEl, msg.text);
                } catch (e) {
                    log('Could not find input for real-time sync.');
                }
            })();
        }
        
        if (msg.type === 'MARK_AS_COMPANION' && msg.service === serviceName) {
            isCompanionMode = true;
            log('Tab marked as companion mode');
        }
        
        // Handle service config updates
        if (msg.type === 'SERVICE_CONFIG_UPDATED' && msg.serviceKey === serviceName) {
            cfg = msg.config;
        }
        
        if (msg.type === 'ADD_CUSTOM_SERVICE') {
            // Reload page detection in case this page now matches a new service
            checkForAIService();
        }
    });
    
    log(`AI service functionality loaded for ${serviceName}`);
}
