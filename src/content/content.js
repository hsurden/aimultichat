// This file is for the content script and does NOT use exports.

// Add CSS to prevent ChatGPT composer from expanding in height
if (location.hostname === 'chatgpt.com') {
  // Function to inject CSS more aggressively
  function injectFixedHeightCSS() {
    const style = document.createElement('style');
    style.id = 'aimultichat-fixed-height';
    style.textContent = `
      /* Prevent ChatGPT composer form from expanding - more aggressive approach */
      form[data-type="unified-composer"] div[class*="prosemirror"] {
        max-height: 200px !important;
        min-height: 56px !important;
        overflow-y: auto !important;
        resize: none !important;
      }
      
      form[data-type="unified-composer"] .ProseMirror {
        max-height: 200px !important;
        min-height: 56px !important;
        overflow-y: auto !important;
      }
      
      /* Target by data attributes and dynamic classes */
      [data-type="unified-composer"] [class*="_prosemirror-parent_"] {
        max-height: 200px !important;
        overflow-y: auto !important;
      }
      
      /* Fallback for any contenteditable in the composer */
      form[data-type="unified-composer"] [contenteditable="true"] {
        max-height: 200px !important;
        overflow-y: auto !important;
      }
    `;
    
    // Remove existing style if present
    const existing = document.getElementById('aimultichat-fixed-height');
    if (existing) existing.remove();
    
    document.head.appendChild(style);
  }
  
  // Inject immediately
  injectFixedHeightCSS();
  
  // Re-inject on DOM changes (ChatGPT might be overriding)
  const observer = new MutationObserver(() => {
    if (!document.getElementById('aimultichat-fixed-height')) {
      injectFixedHeightCSS();
    }
  });
  
  observer.observe(document.head, { childList: true });
  
  // Also monitor for form changes
  const formObserver = new MutationObserver(() => {
    const form = document.querySelector('form[data-type="unified-composer"]');
    if (form) {
      // Force the height constraint directly on the elements
      const prosemirrorElements = form.querySelectorAll('.ProseMirror, [contenteditable="true"], [class*="prosemirror"]');
      prosemirrorElements.forEach(el => {
        el.style.setProperty('max-height', '200px', 'important');
        el.style.setProperty('overflow-y', 'auto', 'important');
      });
    }
  });
  
  // Start observing once the page loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      formObserver.observe(document.body, { childList: true, subtree: true });
    });
  } else {
    formObserver.observe(document.body, { childList: true, subtree: true });
  }
}

// Identify service
let serviceName = resolveService(location.hostname);
log(`🔍 Debug: hostname=${location.hostname}, serviceName=${serviceName}`);
if (!serviceName) {
  log('❌ Not a monitored domain');
} else {
  log(`✅ Registering service: ${serviceName}`);
  chrome.runtime.sendMessage({ type: 'REGISTER_SERVICE', service: serviceName });
}

let cfg = SERVICES[serviceName] || {};
log(`⚙️ Service config for ${serviceName}:`, cfg);

function log(...a) {
  // For debugging in DevTools
  console.log('[AIMultiChat]', ...a);
}

// Find element using multiple selectors
function findFirst(selectors) {
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) return el;
    } catch (_) { /* ignore invalid selector */ }
  }
  return null;
}

// Insert text handling contenteditable vs textarea
function insertPrompt(inputEl, text) {
  if (!inputEl) throw new Error('Input element missing');
  if (cfg.preFocus) inputEl.focus();

  if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
    // First position at bottom, then insert content
    inputEl.focus();
    inputEl.scrollTop = inputEl.scrollHeight; // Move to bottom first
    inputEl.value = text;
    inputEl.selectionStart = inputEl.selectionEnd = inputEl.value.length; // Cursor at end
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (inputEl.isContentEditable) {
    // For contenteditable divs, clear content and position at bottom
    inputEl.focus();
    
    // Special handling for Quill editor
    if (inputEl.classList.contains('ql-editor')) {
      // Try multiple approaches for Quill
      // Approach 1: Quill API if available
      const quillContainer = inputEl.closest('.ql-container');
      if (quillContainer && quillContainer.__quill) {
        quillContainer.__quill.setText(text);
        quillContainer.__quill.focus();
      } else {
        // Approach 2: DOM manipulation
        inputEl.innerHTML = '<p>' + text.replace(/\n/g, '</p><p>') + '</p>';
        
        // Approach 3: Also try execCommand
        inputEl.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, text);
      }
      
      // Dispatch multiple events that Quill might listen to
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      inputEl.dispatchEvent(new Event('keyup', { bubbles: true }));
      inputEl.dispatchEvent(new Event('blur', { bubbles: true }));
      inputEl.dispatchEvent(new Event('focus', { bubbles: true }));
      
      // Try Angular's change detection if this is Angular
      if (window.ng && window.ng.getComponent) {
        try {
          const component = window.ng.getComponent(inputEl);
          if (component) {
            component.constructor.ɵcmp?.onPush && component.constructor.ɵcmp.onPush();
          }
        } catch (e) {
          // Silent fail for Angular detection
        }
      }
    } else {
      inputEl.textContent = ''; // Clear existing content
      inputEl.scrollTop = inputEl.scrollHeight; // Position at bottom before inserting
      
      // Insert text and immediately position cursor at end
      document.execCommand('insertText', false, text);
      
      // Immediately position cursor at the end without setTimeout
      const selection = window.getSelection();
      if (selection) {
          const range = document.createRange();
          range.selectNodeContents(inputEl);
          range.collapse(false); // false collapses to the end
          selection.removeAllRanges();
          selection.addRange(range);
      }
    }
    
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    // Fallback: set textContent
    inputEl.focus();
    inputEl.scrollTop = inputEl.scrollHeight; // Position at bottom first
    inputEl.textContent = text;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// Attempt to send (Enter or button)
function performSend(inputEl) {
  if (cfg.useEnter) {
    const kd = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    inputEl.dispatchEvent(kd);
    const ku = new KeyboardEvent('keyup', { key: 'Enter', bubbles: true });
    inputEl.dispatchEvent(ku);
    return true;
  }
  const btn = findFirst(cfg.sendButtonSelectors || []);
  if (btn) {
    btn.click();
    return true;
  }
  // Fallback: try Enter anyway
  const kd = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
  inputEl.dispatchEvent(kd);
  return true;
}

// Retry logic with MutationObserver assist
function waitForInput(maxMs = 5000, interval = 100) {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    let el = findFirst(cfg.inputSelectors || []);
    if (el) return resolve(el);

    const observer = new MutationObserver(() => {
      el = findFirst(cfg.inputSelectors || []);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    const timer = setInterval(() => {
      if (el) {
        clearInterval(timer);
        observer.disconnect();
        return;
      }
      el = findFirst(cfg.inputSelectors || []);
      if (el) {
        clearInterval(timer);
        observer.disconnect();
        resolve(el);
      } else if (performance.now() - start > maxMs) {
        clearInterval(timer);
        observer.disconnect();
        reject(new Error('Timeout locating input'));
      }
    }, interval);
  });
}

async function injectAndSend(text) {
  const inputEl = await waitForInput();
  insertPrompt(inputEl, text);
  // Slight delay to allow frameworks (React/Vue) to process
  await new Promise(r => setTimeout(r, 50));
  performSend(inputEl);
}

// Global variable to track companion mode
let isCompanionMode = false;

// Function to get current text from input element
function getInputText(inputEl) {
  if (!inputEl) return '';
  
  if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
    return inputEl.value || '';
  } else if (inputEl.isContentEditable) {
    // For ChatGPT's ProseMirror editor, use a more reliable approach
    let text = '';
    
    // First try to get text from the entire editor content
    text = inputEl.textContent || inputEl.innerText || '';
    
    // If still empty, try looking at the current cursor position and extract text
    if (!text.trim()) {
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer;
        
        // Try to get text from the container or its parent
        if (container.nodeType === Node.TEXT_NODE) {
          text = container.parentElement.textContent || container.parentElement.innerText || '';
        } else if (container.textContent || container.innerText) {
          text = container.textContent || container.innerText || '';
        }
      }
    }
    
    // If still empty, traverse all text nodes in the editor
    if (!text.trim()) {
      const walker = document.createTreeWalker(
        inputEl,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );
      let node;
      const textNodes = [];
      while (node = walker.nextNode()) {
        const nodeText = node.textContent.trim();
        if (nodeText && !nodeText.match(/^\s*$/)) {
          textNodes.push(nodeText);
        }
      }
      text = textNodes.join(' ');
    }
    
    console.log('[AIMultiChat DEBUG] getInputText result:', JSON.stringify(text));
    return text;
  }
  return '';
}

// Keep track of the current text as user types
let currentTypedText = '';

// Track ONLY user input, ignore cached content
let userTypedText = '';
let lastUserInput = '';
let isInsertingCombinedContent = false; // Flag to prevent tracking during our own insertions
let isPerformingSend = false; // Flag to prevent intercepting our own performSend

document.addEventListener('input', (event) => {
  if (!isCompanionMode) return;
  
  // Skip tracking if we're currently inserting combined content
  if (isInsertingCombinedContent) {
    console.log('[AIMultiChat DEBUG] Skipping input tracking during content insertion');
    return;
  }
  
  const inputEl = findFirst(cfg.inputSelectors);
  if (inputEl && (event.target === inputEl || inputEl.contains(event.target))) {
    const currentContent = getInputText(inputEl);
    
    // If the content starts with "Page content", it means cached content was inserted
    // We need to extract only the user's actual typed text
    if (currentContent.startsWith('Page content """')) {
      // Don't track this - it's cached content being inserted
      console.log('[AIMultiChat DEBUG] Ignoring cached content insertion');
      return;
    }
    
    // Track only genuine user input - always update if content exists and isn't cached content
    if (currentContent.trim()) {
      userTypedText = currentContent;
      lastUserInput = currentContent;
      console.log('[AIMultiChat DEBUG] User typed text updated:', JSON.stringify(userTypedText));
    }
  }
});

// Single unified Enter key handler for companion mode
document.addEventListener('keydown', async (event) => {
  if (!isCompanionMode) return;
  
  // Check if Enter was pressed (not Shift+Enter)
  if (event.key === 'Enter' && !event.shiftKey) {
    // Skip if this is our own performSend operation
    if (isPerformingSend) {
      console.log('[AIMultiChat DEBUG] Skipping Enter interception during performSend');
      return;
    }
    
    const inputEl = findFirst(cfg.inputSelectors);
    
    // More flexible check for whether we're in the right input
    const isInInputArea = inputEl && (
      event.target === inputEl || 
      inputEl.contains(event.target) || 
      document.activeElement === inputEl ||
      inputEl.contains(document.activeElement)
    );
    
    if (isInInputArea) {
      console.log('[AIMultiChat DEBUG] Enter key detected in companion mode');
      
      // CRITICAL: Prevent the default Enter behavior immediately and aggressively
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      
      // Capture text right at the moment of Enter press
      const currentText = getInputText(inputEl);
      const textToUse = currentText || userTypedText || '';
      
      console.log('[AIMultiChat DEBUG] Current input text:', JSON.stringify(currentText));
      console.log('[AIMultiChat DEBUG] Tracked user text:', JSON.stringify(userTypedText));
      console.log('[AIMultiChat DEBUG] Final text to use:', JSON.stringify(textToUse));
      
      if (textToUse.trim()) {
        console.log('[AIMultiChat] Companion mode Enter intercepted, requesting cached content');
        
        // Ask background for cached content
        chrome.runtime.sendMessage({
          type: 'GET_CACHED_CONTENT'
        }, (response) => {
          console.log('[AIMultiChat DEBUG] Cached content response length:', response?.content?.length || 0);
          
          // Only proceed if we have cached content to add
          if (response && response.content && response.content.trim()) {
            const finalText = `Page content """\n${response.content}\n"""\n\n${textToUse}`;
            console.log('[AIMultiChat DEBUG] Final combined text length:', finalText.length);
            console.log('[AIMultiChat DEBUG] Final text preview:', finalText.substring(0, 200) + '...');
            
            // Clear the input first to ensure we start fresh
            if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
              inputEl.value = '';
            } else if (inputEl.isContentEditable) {
              inputEl.innerHTML = '';
              inputEl.textContent = '';
            }
            
            // Reset tracking variables
            userTypedText = '';
            currentTypedText = '';
            
            // Wait a moment for the clear to take effect, then insert combined content
            setTimeout(() => {
              console.log('[AIMultiChat DEBUG] Inserting combined text after clear');
              isInsertingCombinedContent = true; // Disable input tracking
              
              // Simplified insertion for ChatGPT - avoid complex insertPrompt function
              if (inputEl.isContentEditable) {
                // For ChatGPT's contenteditable, set innerHTML directly
                inputEl.innerHTML = finalText.replace(/\n/g, '<br>');
                inputEl.focus();
                
                // Position cursor at end
                const range = document.createRange();
                const sel = window.getSelection();
                range.selectNodeContents(inputEl);
                range.collapse(false);
                sel.removeAllRanges();
                sel.addRange(range);
              } else {
                // Fallback for other input types
                inputEl.value = finalText;
                inputEl.focus();
              }
              
              // Then submit after another short delay
              setTimeout(() => {
                console.log('[AIMultiChat DEBUG] About to perform send');
                isPerformingSend = true; // Prevent our handler from intercepting performSend
                performSend(inputEl);
                setTimeout(() => {
                  isPerformingSend = false; // Re-enable Enter interception
                  isInsertingCombinedContent = false; // Re-enable input tracking
                }, 100);
              }, 150);
            }, 50);
          } else {
            console.log('[AIMultiChat] No cached content available, proceeding with user text only');
            // Clear first then insert user text
            if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
              inputEl.value = '';
            } else if (inputEl.isContentEditable) {
              inputEl.innerHTML = '';
              inputEl.textContent = '';
            }
            
            userTypedText = '';
            currentTypedText = '';
            
            setTimeout(() => {
              isInsertingCombinedContent = true; // Disable input tracking
              
              // Simplified insertion for ChatGPT - avoid complex insertPrompt function
              if (inputEl.isContentEditable) {
                inputEl.innerHTML = textToUse.replace(/\n/g, '<br>');
                inputEl.focus();
                
                // Position cursor at end
                const range = document.createRange();
                const sel = window.getSelection();
                range.selectNodeContents(inputEl);
                range.collapse(false);
                sel.removeAllRanges();
                sel.addRange(range);
              } else {
                inputEl.value = textToUse;
                inputEl.focus();
              }
              
              setTimeout(() => {
                isPerformingSend = true; // Prevent our handler from intercepting performSend
                performSend(inputEl);
                setTimeout(() => {
                  isPerformingSend = false; // Re-enable Enter interception
                  isInsertingCombinedContent = false; // Re-enable input tracking
                }, 100);
              }, 50);
            }, 50);
          }
        });
      } else {
        console.log('[AIMultiChat DEBUG] No text to send, preventing default behavior anyway');
        // Even if no text, prevent default to avoid double submission
      }
    }
  }
}, true); // Use capture phase to intercept before ChatGPT's handlers

// Listen for broadcast messages
chrome.runtime.onMessage.addListener((msg) => {
  // Handles the main "Broadcast" action
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

  // Handles real-time text syncing as the user types (and for Companion Mode)
  if (msg.type === 'INJECT_TEXT_REALTIME' && msg.service === serviceName) {
    // Skip real-time injection if this is a companion mode tab
    // In companion mode, we only inject content when user presses Enter
    if (isCompanionMode) {
      console.log('[AIMultiChat DEBUG] Skipping real-time injection in companion mode');
      return;
    }
    
    (async () => {
      try {
        // Use a shorter timeout as this is less critical
        const inputEl = await waitForInput(1000);
        insertPrompt(inputEl, msg.text);
      } catch (e) {
        // It's okay to fail silently here as the user is just typing
        log('Could not find input for real-time sync.');
      }
    })();
  }
  
  // Mark this tab as companion mode
  if (msg.type === 'MARK_AS_COMPANION' && msg.service === serviceName) {
    isCompanionMode = true;
    console.log('[AIMultiChat] Tab marked as companion mode, Enter key interception enabled');
    console.log('[AIMultiChat DEBUG] Service name:', serviceName);
    console.log('[AIMultiChat DEBUG] Available input selectors:', cfg.inputSelectors);
    
    // Test if we can find the input element immediately
    const testInput = findFirst(cfg.inputSelectors);
    console.log('[AIMultiChat DEBUG] Can find input element:', testInput);
    
    // Add an even more aggressive Enter interceptor that runs first
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        // Skip if this is our own performSend operation
        if (isPerformingSend) {
          console.log('[AIMultiChat DEBUG] Aggressive interceptor allowing performSend through');
          return;
        }
        
        const inputEl = findFirst(cfg.inputSelectors);
        const isInInputArea = inputEl && (
          e.target === inputEl || 
          inputEl.contains(e.target) || 
          document.activeElement === inputEl ||
          inputEl.contains(document.activeElement)
        );
        
        if (isInInputArea) {
          console.log('[AIMultiChat DEBUG] Aggressive Enter interception - preventing all handlers');
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        }
      }
    }, true); // Capture phase, highest priority
  }
  
  // Handle service configuration updates
  if (msg.type === 'SERVICE_CONFIG_UPDATED' && msg.serviceKey === serviceName) {
    handleServiceConfigUpdate(msg.serviceKey, msg.config);
    // Update the local cfg reference
    cfg = SERVICES[serviceName] || {};
  }
  
  // Handle custom service addition
  if (msg.type === 'ADD_CUSTOM_SERVICE') {
    handleAddCustomService(msg.serviceKey, msg.config);
    // Re-check if this page should now be recognized as this service
    const newServiceName = resolveService(location.hostname);
    if (newServiceName === msg.serviceKey && newServiceName !== serviceName) {
      // This page now matches the new custom service
      serviceName = newServiceName;
      cfg = SERVICES[serviceName] || {};
      chrome.runtime.sendMessage({ type: 'REGISTER_SERVICE', service: serviceName });
    }
  }
  
  // Handle custom service removal
  if (msg.type === 'REMOVE_CUSTOM_SERVICE' && msg.serviceKey === serviceName) {
    handleRemoveCustomService(msg.serviceKey);
    // This service is no longer available, page will no longer be monitored
    serviceName = null;
    cfg = {};
  }
});

// Initialize custom configurations on script load
(async () => {
  await loadCustomConfigurations();
  // Update the cfg reference after loading custom configs
  cfg = SERVICES[serviceName] || {};
})();