// AI Service Configuration
// To add a new service:
// 1. Add service config here and in services-config-content.js
// 2. Add specific URL to manifest.json content_scripts.matches (if not covered by patterns)
// 3. Add case to getServiceUrl() in background.js if needed
// 4. The extension will automatically detect and register the service

export const SERVICES = {
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
};