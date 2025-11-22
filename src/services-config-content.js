// This file is for the content script and does NOT use exports.
// AI Service Configuration - Content Script Version
// To add a new service:
// 1. Add service config here and in services-config.js (same config)
// 2. Add specific URL to manifest.json content_scripts.matches (if not covered by patterns)  
// 3. Add case to getServiceUrl() in background.js if needed
// 4. The extension will automatically detect and register the service

const DEFAULT_SERVICES = {
  chatgpt: {
    label: "ChatGPT",
    match: /(?:chat\.openai\.com|chatgpt\.com)$/,
    inputSelectors: [
        '#prompt-textarea',
        'textarea[data-id="root"]',
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
    inputSelectors: [
      'div[contenteditable="true"][data-testid*="composer"]',
      'div[contenteditable="true"]',
      'textarea'
    ],
    sendButtonSelectors: [
      'button:has(svg[data-testid="SendIcon"])',
      'button[aria-label*="Send"]'
    ],
    useEnter: false // Changed from true to false
  },
  gemini: {
    label: "Gemini",
    match: /gemini\.google\.com$/,
    inputSelectors: [
      'div.ql-editor[contenteditable="true"]',
      'rich-textarea div[contenteditable="true"]',
      'div[contenteditable="true"][data-placeholder*="Gemini"]',
      'div[contenteditable="true"]',
      'textarea'
    ],
    sendButtonSelectors: [
      'button.send-button[aria-label="Send message"]:not(.stop)',
      'button.send-button.submit',
      'button[aria-label="Send message"]:not(.stop)',
      '.send-button-container button.submit',
      'button[aria-label="Send message"]'
    ],
    useEnter: true,
    preFocus: true
  },
  perplexity: {
    label: "Perplexity",
    match: /perplexity\.ai$/,
    inputSelectors: [
      '#ask-input',
      'div[contenteditable="true"]',
      '[role="textbox"]',
      'textarea'
    ],
    sendButtonSelectors: [
      'button[aria-label*="Submit"]',
      'button[aria-label*="Send"]',
      'button[type="submit"]',
      'button:has(svg)',
      '.send-button'
    ],
    useEnter: true,
    preFocus: true
  },
  deepseek: {
    label: "Deepseek",
    match: /(chat\.)?deepseek\.com$/,
    inputSelectors: [
      'div[contenteditable="true"]',
      'textarea[placeholder*="message"]',
      'textarea',
      '[role="textbox"]'
    ],
    sendButtonSelectors: [
      'button[aria-label*="Send"]',
      'button[type="submit"]',
      'button:has(svg)',
      '.send-button'
    ],
    useEnter: true
  },
  grok: {
    label: "Grok",
    match: /(grok\.x\.ai|grok\.com)$/,
    inputSelectors: [
      'textarea[aria-label="Ask Grok anything"]',
      '.query-bar textarea',
      'div[contenteditable="true"]',
      'textarea',
      '[role="textbox"]',
      'input[type="text"]'
    ],
    sendButtonSelectors: [
      'button[aria-label*="Send"]',
      'button[type="submit"]',
      'button:has(svg)',
      '.send-button'
    ],
    useEnter: true
  },
  zai: {
    label: "Z AI",
    match: /chat\.z\.ai$/,
    inputSelectors: [
      '#chat-input',
      'textarea[placeholder*="How can I help you today?"]',
      'textarea',
      'div[contenteditable="true"]'
    ],
    sendButtonSelectors: [
      '#send-message-button',
      'button[type="submit"]',
      'button[aria-label*="Send"]',
      'button:has(svg)',
      '.sendMessageButton'
    ],
    useEnter: true
  },
  qwen: {
    label: "Qwen",
    match: /chat\.qwen\.ai$/,
    inputSelectors: [
      '#chat-input',
      'textarea[placeholder*="How can I help you today?"]',
      '.text-area-box-web',
      'textarea',
      'div[contenteditable="true"]'
    ],
    sendButtonSelectors: [
      'button[type="submit"]',
      'button[aria-label*="Send"]',
      'button:has(svg)',
      '.send-button'
    ],
    useEnter: true
  },
  kimi: {
  label: "Kimi",
  match: /kimi\.com$/,
  inputSelectors: [
    '#chat-input',
    'div.chat-input-editor',
    'div.chat-input-editor-container div.chat-input-editor',
    'div.chat-input-editor-container div[contenteditable="true"]',
    'textarea[placeholder*="Ask Anything..."]',
    '.text-area-box-web',
    'textarea',
    'div[contenteditable="true"]'
  ],
  sendButtonSelectors: [
    'button[type="submit"]',
    'button[aria-label*="Send"]',
    'button:has(svg)',
    '.send-button'
  ],
  useEnter: true
},
};

let SERVICES = { ...DEFAULT_SERVICES };

// Load custom configurations from storage
async function loadCustomConfigurations() {
  try {
    const result = await chrome.storage.local.get(['customServiceConfigs', 'customServices']);
    const customConfigs = result.customServiceConfigs || {};
    const customServices = result.customServices || {};
    
    // Add completely custom services
    Object.keys(customServices).forEach(serviceKey => {
      SERVICES[serviceKey] = { ...customServices[serviceKey] };
      
      // Handle regex conversion for match field if it was stored as serialized object
      if (customServices[serviceKey].match && typeof customServices[serviceKey].match === 'object' && customServices[serviceKey].match.source) {
        SERVICES[serviceKey].match = new RegExp(customServices[serviceKey].match.source, customServices[serviceKey].match.flags || '');
      }
    });
    
    // Apply custom configurations to existing services
    Object.keys(customConfigs).forEach(serviceKey => {
      if (SERVICES[serviceKey]) {
        const baseConfig = DEFAULT_SERVICES[serviceKey] || SERVICES[serviceKey];
        SERVICES[serviceKey] = { ...baseConfig, ...customConfigs[serviceKey] };
        
        // Handle regex conversion for match field if it was stored as serialized object
        if (customConfigs[serviceKey].match && typeof customConfigs[serviceKey].match === 'object' && customConfigs[serviceKey].match.source) {
          SERVICES[serviceKey].match = new RegExp(customConfigs[serviceKey].match.source, customConfigs[serviceKey].match.flags || '');
        }
      }
    });
  } catch (error) {
    console.error('Error loading custom service configurations:', error);
  }
}

// Handle service config updates from settings
function handleServiceConfigUpdate(serviceKey, config) {
  if (SERVICES[serviceKey]) {
    SERVICES[serviceKey] = { ...config };
    console.log(`[AIMultiChat] Updated configuration for ${serviceKey}:`, SERVICES[serviceKey]);
  }
}

// Handle adding new custom services
function handleAddCustomService(serviceKey, config) {
  SERVICES[serviceKey] = { ...config };
  console.log(`[AIMultiChat] Added custom service ${serviceKey}:`, SERVICES[serviceKey]);
}

// Handle removing custom services
function handleRemoveCustomService(serviceKey) {
  if (SERVICES[serviceKey] && !DEFAULT_SERVICES[serviceKey]) {
    delete SERVICES[serviceKey];
    console.log(`[AIMultiChat] Removed custom service ${serviceKey}`);
  }
}

function resolveService(hostname) {
  const host = hostname.replace(/^www\./, '');
  console.log(`[AIMultiChat] 🔍 Resolving: ${hostname} → ${host}`);
  
  // Debug: show all service patterns
  Object.keys(SERVICES).forEach(k => {
    const matches = SERVICES[k].match.test(host);
    console.log(`[AIMultiChat] 🎯 ${k}: ${SERVICES[k].match} → ${matches ? '✅' : '❌'}`);
  });
  
  return Object.keys(SERVICES).find(k => SERVICES[k].match.test(host));
}
