import { SERVICES } from './services-config.js';

console.log('[BG] started');

const serviceTabs = {};
let popupWindowId = null;
let tiledWindowIds = new Set();
let companionState = {
    companionWindowId: null, // The main AI service window
    controlPanelWindowId: null, // The tiny control bar window
    companionTabId: null, // The tab ID of the AI service
    service: null,
    lastActiveTabId: null, // The tab the companion is watching
    copyContext: true,
    isExpanded: false,
    lastSentContent: null, // Track the last content sent to avoid unnecessary updates
    originalBrowserWindow: null, // Store original browser window state for restoration
    cachedPageContent: null, // Store current page content without sending to companion
    cachedPageUrl: null // Track which page the cached content is from
};

// Helper function to detect footer-like elements
function isLikelyFooter(element) {
    const tagName = element.tagName.toLowerCase();
    const className = element.className ? element.className.toLowerCase() : '';
    const id = element.id ? element.id.toLowerCase() : '';
    
    // Direct footer tag
    if (tagName === 'footer') {
        return true;
    }
    
    // Common footer class/id patterns
    if (className.includes('footer') || 
        className.includes('site-footer') ||
        className.includes('page-footer') ||
        className.includes('bottom') ||
        className.includes('copyright') ||
        id.includes('footer') ||
        id.includes('copyright')) {
        return true;
    }
    
    // Check if element is positioned at the bottom of the page
    const rect = element.getBoundingClientRect();
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    
    // If element is in the bottom 15% of the page and contains typical footer content
    if (rect.top > windowHeight * 0.85 || 
        (rect.bottom > documentHeight * 0.85 && rect.bottom <= documentHeight)) {
        
        const text = element.textContent || '';
        const textLower = text.toLowerCase();
        
        // Check for common footer text patterns
        if (textLower.includes('copyright') ||
            textLower.includes('©') ||
            textLower.includes('terms of service') ||
            textLower.includes('privacy policy') ||
            textLower.includes('all rights reserved') ||
            textLower.includes('contact us') ||
            textLower.includes('about us') ||
            textLower.match(/\d{4}.*all rights/) ||
            textLower.match(/©.*\d{4}/)) {
            return true;
        }
        
        // If element contains mostly links and is at bottom, likely footer
        const links = element.querySelectorAll('a');
        const textLength = text.replace(/\s+/g, ' ').trim().length;
        if (links.length >= 3 && textLength < 500) {
            return true;
        }
    }
    
    return false;
}

// This function will be injected into the target page to extract text.
function getRenderedTextFromDocument() {
    // First try to get basic text content to ensure we get something
    let fallbackText = document.body ? document.body.innerText || document.body.textContent || '' : '';
    
    try {
        const bodyClone = document.body.cloneNode(true);

        const elementsToRemove = [];
        const walk = document.createTreeWalker(bodyClone, NodeFilter.SHOW_ELEMENT, null, false);
        let node;
        while ((node = walk.nextNode())) {
            const tagName = node.tagName.toLowerCase();
            const className = node.className ? node.className.toLowerCase() : '';
            const id = node.id ? node.id.toLowerCase() : '';

            // Remove script, style, and other non-content elements
            if (['script', 'style', 'noscript', 'meta', 'link', 'title'].includes(tagName)) {
                elementsToRemove.push(node);
                continue;
            }

            // Remove Google-specific elements that often contain JavaScript
            if (className.includes('google') && (className.includes('script') || className.includes('init'))) {
                elementsToRemove.push(node);
                continue;
            }

            // Remove elements with data attributes that suggest JavaScript content
            if (node.hasAttribute('data-jscontroller') || 
                node.hasAttribute('data-ved') || 
                node.hasAttribute('jsaction') ||
                node.hasAttribute('data-async-context')) {
                elementsToRemove.push(node);
                continue;
            }

            // Check for aria-hidden attribute
            if (node.hasAttribute('aria-hidden') && node.getAttribute('aria-hidden') === 'true') {
                elementsToRemove.push(node);
                continue;
            }

            // Remove elements with very specific navigation/utility roles
            const role = node.getAttribute('role');
            if (role && ['banner', 'contentinfo', 'navigation', 'complementary', 'search'].includes(role)) {
                elementsToRemove.push(node);
                continue;
            }

            // Remove common non-content class patterns
            if (className.includes('toolbar') || 
                className.includes('sidebar') || 
                className.includes('advertisement') ||
                className.includes('ads') ||
                className.includes('cookie') ||
                className.includes('popup')) {
                elementsToRemove.push(node);
                continue;
            }

            // Detect footer-like elements
            if (isLikelyFooter(node)) {
                elementsToRemove.push(node);
                continue;
            }
        }

        elementsToRemove.forEach(el => el.remove());

        let text = bodyClone.innerText || bodyClone.textContent || '';
        
        // Clean up the text more aggressively
        text = text
            // Remove JavaScript-like patterns
            .replace(/window\.\w+\s*[&|=]/g, '')
            .replace(/function\s*\([^)]*\)\s*\{[^}]*\}/g, '')
            .replace(/\b\w+\.\w+\([^)]*\);?/g, '')
            // Remove Google-specific initialization code
            .replace(/window\.wiz_\w+\s*&&\s*window\.wiz_\w+\([^)]*\);?/g, '')
            .replace(/window\.IJ_\w+\s*=\s*\[[^\]]*\];?/g, '')
            .replace(/initAft\(\)/g, '')
            .replace(/ccTick\([^)]*\)/g, '')
            // Remove URL-like patterns that are often from JavaScript
            .replace(/https?:\/\/[^\s]*/g, '')
            // Remove data structures that look like JSON/arrays
            .replace(/\[[^\]]*["'][^"']*["'][^\]]*\]/g, '')
            // Clean up extra whitespace
            .replace(/\n\s*\n/g, '\n\n')
            .replace(/\s{3,}/g, ' ')
            .trim();
        
        // If filtered text is too short or still contains obvious JavaScript, use fallback
        if (text.length < 50 || text.includes('window.') || text.includes('function(')) {
            console.log('[AIMultiChat] Using fallback text extraction due to JS contamination');
            // Clean the fallback text too
            fallbackText = fallbackText
                .replace(/window\.\w+.*$/gm, '')
                .replace(/function\s*\([^)]*\).*$/gm, '')
                .replace(/\n\s*\n/g, '\n\n')
                .trim();
            return fallbackText;
        }
        
        return text;
    } catch (e) {
        console.log('[AIMultiChat] Error in content extraction, using fallback:', e.message);
        return fallbackText.replace(/\n\s*\n/g, '\n\n').trim();
    }
}

// --- Listeners for State Tracking ---

chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        chrome.storage.local.set({ companionSettings: { copyContext: true, isExpanded: false } });
        if (chrome.action.setPinnedState) {
            await chrome.action.setPinnedState(true);
        }
    }
    
});

chrome.windows.onRemoved.addListener((closedWindowId) => {
  if (closedWindowId === popupWindowId) {
    popupWindowId = null;
    // If popup closed and we had tiled windows, notify tiling mode ended
    if (tiledWindowIds.size > 0) {
      chrome.runtime.sendMessage({ type: 'TILING_MODE_ENDED' });
    }
  }
  if (tiledWindowIds.has(closedWindowId)) {
    tiledWindowIds.delete(closedWindowId);
    // If all tiled windows are closed, notify tiling mode ended
    if (tiledWindowIds.size === 0) {
      chrome.runtime.sendMessage({ type: 'TILING_MODE_ENDED' });
    }
  }
  // If either the companion or its control panel is closed, stop the mode.
  if (closedWindowId === companionState.companionWindowId || closedWindowId === companionState.controlPanelWindowId) {
    stopCompanionMode();
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  let changed = false;
  Object.keys(serviceTabs).forEach(s => {
    if (serviceTabs[s] && serviceTabs[s].has(tabId)) {
      serviceTabs[s].delete(tabId);
      if (serviceTabs[s].size === 0) {
        delete serviceTabs[s];
      }
      changed = true;
    }
  });
  if (changed) {
    broadcastStatusUpdate();
  }
});

// --- Companion Mode Listeners ---

// Schedules a series of caching operations to capture dynamically loaded content.
function scheduleCompanionCaching(tabId, isNewNavigation = false) {
    const cacheIfActive = () => {
        // Only cache if companion mode is active and it's still the same tab.
        if (companionState.companionWindowId && tabId === companionState.lastActiveTabId) {
            cachePageContentForCompanion(tabId);
        }
    };

    if (isNewNavigation) {
        console.log('[AIMultiChat] Scheduling content caching for new navigation');
        // For new page loads, wait a bit longer before first attempt
        setTimeout(cacheIfActive, 500);  // Initial delay for page to start loading
        setTimeout(cacheIfActive, 2000); // 2-second follow-up for basic content
        setTimeout(cacheIfActive, 5000); // 5-second follow-up for dynamic content
        setTimeout(cacheIfActive, 10000); // 10-second follow-up for very slow content
        setTimeout(cacheIfActive, 15000); // 15-second follow-up for very slow sites like WSJ/NYT
    } else {
        console.log('[AIMultiChat] Scheduling content caching for existing page');
        // For existing pages or tab switches, cache immediately
        cacheIfActive();
        // Then schedule follow-up caching for dynamic content
        setTimeout(cacheIfActive, 1000); // 1-second follow-up
        setTimeout(cacheIfActive, 5000);  // 5-second follow-up for slow-loading content
        setTimeout(cacheIfActive, 10000); // 10-second follow-up for very slow content
    }
}

async function activateCompanionForTab(tabId) {
    if (!companionState.companionWindowId || !tabId || tabId === companionState.companionTabId) {
        return;
    }

    try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab.url?.startsWith('http')) {
            // Clear companion content for non-web pages
            if (companionState.copyContext) {
                sendToCompanion('');
            }
            return;
        }
    } catch (e) {
        console.error(`Companion mode could not get tab ${tabId}: ${e.message}`);
        return; // Tab may have closed
    }

    // Clear cache when switching to a different tab
    if (companionState.lastActiveTabId !== tabId) {
        companionState.cachedPageContent = null;
        companionState.cachedPageUrl = null;
    }
    
    companionState.lastActiveTabId = tabId;

    // Inject the listener to ensure it's active on the target tab.
    try {
        await chrome.scripting.executeScript({
            target: { tabId: tabId, allFrames: true },
            files: ['src/content/selection-listener.js'],
        });
    } catch (e) {
        console.log(`Could not inject selection listener into tab ${tabId}. This is expected for special pages (e.g., chrome web store).`);
    }

    // Only cache content if copyContext is enabled
    if (companionState.copyContext) {
        // Cache the full page content with scheduled retries for dynamic content.
        scheduleCompanionCaching(tabId);
    }
}

chrome.tabs.onActivated.addListener(activeInfo => {
    activateCompanionForTab(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (companionState.companionWindowId && companionState.copyContext && changeInfo.status === 'complete' && tab.url?.startsWith('http')) {
        // Check if this is the currently active tab or the tracked tab
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if ((activeTab && activeTab.id === tabId) || tabId === companionState.lastActiveTabId) {
            console.log('[AIMultiChat] Page load completed, activating companion and scheduling updates');
            // Ensure companion mode is active for this tab
            await activateCompanionForTab(tabId);
            // This is a page that just finished loading, treat as new navigation
            scheduleCompanionCaching(tabId, true);
        }
    }
});

chrome.webNavigation.onHistoryStateUpdated.addListener(details => {
    if (companionState.companionWindowId && companionState.copyContext && details.tabId === companionState.lastActiveTabId && details.frameId === 0) {
        // History state update (SPA navigation), treat as new navigation
        scheduleCompanionCaching(details.tabId, true);
    }
});

chrome.webNavigation.onCompleted.addListener(async (details) => {
    // Ensure it's the main frame and companion mode is active
    if (details.frameId === 0 && companionState.companionWindowId && companionState.copyContext) {
        // Check if this is the currently active tab or the tracked tab
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if ((activeTab && activeTab.id === details.tabId) || details.tabId === companionState.lastActiveTabId) {
            console.log('[AIMultiChat] Navigation completed, activating companion and scheduling updates');
            // Ensure companion mode is active for this tab
            await activateCompanionForTab(details.tabId);
            // Navigation completed, treat as new navigation
            scheduleCompanionCaching(details.tabId, true);
        }
    }
});

// Additional listener for when navigation starts - clears last content so new page will definitely be sent
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
    if (details.frameId === 0 && companionState.companionWindowId) {
        // Check if this is the currently active tab
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab && activeTab.id === details.tabId) {
            console.log('[AIMultiChat] Navigation starting in active tab, clearing content cache and activating companion mode');
            companionState.cachedPageContent = null;
            companionState.cachedPageUrl = null;
            // Activate companion mode for this tab (handles new tabs that weren't tracked before)
            activateCompanionForTab(details.tabId);
        } else if (details.tabId === companionState.lastActiveTabId) {
            console.log('[AIMultiChat] Navigation starting in tracked tab, clearing content cache');
            companionState.cachedPageContent = null;
            companionState.cachedPageUrl = null;
        }
    }
});


// --- Window Management ---

// Remove the action click listener - we'll use context menu instead

function createPopupWindow(windowConfig = {}) {
  const defaults = { width: 420, height: 320 };
  chrome.system.display.getInfo((displays) => {
    if (chrome.runtime.lastError) { console.error(chrome.runtime.lastError); return; }
    const display = displays[0].workArea;
    const margin = 20;
    const url = windowConfig.url || 'src/popup/popup.html';
    const left = windowConfig.left ?? (display.left + display.width - (windowConfig.width ?? defaults.width) - margin);
    const top = windowConfig.top ?? (display.top + display.height - (windowConfig.height ?? defaults.height) - margin);
    const width = windowConfig.width ?? defaults.width;
    const height = windowConfig.height ?? defaults.height;
    chrome.windows.create({ url, type: 'popup', width, height, left, top }, (win) => {
      popupWindowId = win.id;
    });
  });
}



// --- Core Functionality ---

function broadcastStatusUpdate() {
  chrome.storage.local.get('lastPromptText', (data) => {
    const allServicesStatus = {};
    for (const key of Object.keys(SERVICES)) { allServicesStatus[key] = []; }
    for (const [service, tabSet] of Object.entries(serviceTabs)) { allServicesStatus[service] = [...tabSet]; }
    const status = { services: allServicesStatus, lastPrompt: data.lastPromptText || "" };
    chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', status }, () => {
      if (chrome.runtime.lastError) { /* Popup not open, ignore */ }
    });
  });
}

function registerServiceTab(service, tabId) {
  if (!serviceTabs[service]) { serviceTabs[service] = new Set(); }
  serviceTabs[service].add(tabId);
  broadcastStatusUpdate();
}

chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'REGISTER_SERVICE':
      if (sender.tab && msg.service) {
        registerServiceTab(msg.service, sender.tab.id);
        if (companionState.companionTabId === sender.tab.id && companionState.lastActiveTabId && companionState.copyContext) {
            scheduleCompanionCaching(companionState.lastActiveTabId);
        }
        sendResponse({ ok: true });
      }
      break;
    case 'REQUEST_STATUS':
      broadcastStatusUpdate();
      break;
    case 'BROADCAST_PROMPT':
      chrome.storage.local.set({ lastPromptText: msg.text });
      broadcastPrompt(msg.text, msg.targets, 'INJECT_AND_SEND');
      sendResponse({ ok: true });
      break;
    case 'SYNC_PROMPT_TEXT':
      chrome.storage.local.set({ currentPromptText: msg.text });
      broadcastPrompt(msg.text, msg.targets, 'INJECT_TEXT_REALTIME');
      break;
    case 'REPLAY_LAST':
      chrome.storage.local.get('lastPromptText', (data) => {
        if (data.lastPromptText) {
          broadcastPrompt(data.lastPromptText, msg.targets, 'INJECT_AND_SEND');
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: false, error: "No last prompt" });
        }
      });
      return true;
    case 'SERVICE_FEEDBACK':
      chrome.runtime.sendMessage({ type: 'SERVICE_FEEDBACK', service: msg.service, tabId: sender.tab?.id, status: msg.status, error: msg.error || null });
      break;
    case 'OPEN_SERVICES':
      if (msg.targets && msg.targets.length > 0) {
        if (msg.shouldTile && msg.isBottomLayout) { tileWindowsBottom(msg.targets); }
        else if (msg.shouldTile) { tileWindowsVertical(msg.targets); }
        else { openTabsInWindow(msg.targets); }
      }
      break;
    case 'START_COMPANION_MODE':
        startCompanionMode(msg.service);
        break;
    case 'REQUEST_PAGE_CONTENT':
        getFullPageContentFromActiveTab();
        break;
    case 'SELECTION_CONTEXT_UPDATE':
        if (companionState.companionWindowId && sender.tab?.id === companionState.lastActiveTabId) {
            cachePageContentForCompanion(sender.tab.id, msg.text);
        }
        break;
    case 'UPDATE_COMPANION_SETTINGS':
        if (msg.settings) {
            Object.assign(companionState, msg.settings);
            chrome.storage.local.set({ companionSettings: msg.settings });
            if (msg.settings.copyContext && companionState.lastActiveTabId) {
                scheduleCompanionCaching(companionState.lastActiveTabId);
            } else if (!msg.settings.copyContext) {
                companionState.cachedPageContent = null;
                companionState.cachedPageUrl = null;
            }
        }
        break;
    case 'SWITCH_COMPANION_SERVICE':
        if (msg.service && companionState.companionWindowId) {
            // Switch the companion to a different service
            switchCompanionService(msg.service);
        }
        break;
    case 'START_MODE':
        if (msg.mode) {
            handleModeStart(msg.mode);
            sendResponse({ ok: true });
        } else {
            sendResponse({ ok: false, error: "No mode specified" });
        }
        break;
    case 'RETILE_BOTTOM_WINDOWS':
        if (msg.targets && msg.targets.length > 0) {
            // Close existing tiled windows and create new ones with updated services
            tileWindowsBottom(msg.targets);
        }
        break;
    case 'GET_CACHED_CONTENT':
        // Return cached page content for companion mode
        console.log('[AIMultiChat DEBUG] GET_CACHED_CONTENT request received');
        console.log('[AIMultiChat DEBUG] Cached content length:', companionState.cachedPageContent ? companionState.cachedPageContent.length : 'null');
        console.log('[AIMultiChat DEBUG] Cached URL:', companionState.cachedPageUrl);
        
        sendResponse({
            content: companionState.cachedPageContent,
            url: companionState.cachedPageUrl
        });
        break;
    case 'AUTO_RETILE':
        if (msg.targets && msg.targets.length > 0) {
            if (msg.layout === 'bottom') {
                tileWindowsBottom(msg.targets);
            } else if (msg.layout === 'vertical') {
                tileWindowsVertical(msg.targets);
            }
        }
        break;
    case 'UPDATE_SERVICE_CONFIG':
        if (msg.serviceKey && msg.config) {
            // Store the updated config for runtime use
            // This allows content scripts to use updated configurations
            await chrome.storage.local.set({
                [`runtimeServiceConfig_${msg.serviceKey}`]: msg.config
            });
            
            // Notify all tabs of the service config update
            chrome.tabs.query({}, (tabs) => {
                tabs.forEach(tab => {
                    if (tab.url && tab.url.startsWith('http')) {
                        chrome.tabs.sendMessage(tab.id, {
                            type: 'SERVICE_CONFIG_UPDATED',
                            serviceKey: msg.serviceKey,
                            config: msg.config
                        }, () => {
                            // Ignore errors for tabs that don't have content script
                            if (chrome.runtime.lastError) { /* ignore */ }
                        });
                    }
                });
            });
        }
        break;
    case 'ADD_CUSTOM_SERVICE':
        if (msg.serviceKey && msg.config) {
            // Notify all tabs of the new custom service
            chrome.tabs.query({}, (tabs) => {
                tabs.forEach(tab => {
                    if (tab.url && tab.url.startsWith('http')) {
                        chrome.tabs.sendMessage(tab.id, {
                            type: 'ADD_CUSTOM_SERVICE',
                            serviceKey: msg.serviceKey,
                            config: msg.config
                        }, () => {
                            // Ignore errors for tabs that don't have content script
                            if (chrome.runtime.lastError) { /* ignore */ }
                        });
                    }
                });
            });
            
            // Notify popup of custom services update
            chrome.runtime.sendMessage({ type: 'CUSTOM_SERVICES_UPDATED' });
        }
        break;
    case 'REMOVE_CUSTOM_SERVICE':
        if (msg.serviceKey) {
            // Remove service tabs from tracking
            if (serviceTabs[msg.serviceKey]) {
                delete serviceTabs[msg.serviceKey];
                broadcastStatusUpdate();
            }
            
            // Notify all tabs of the service removal
            chrome.tabs.query({}, (tabs) => {
                tabs.forEach(tab => {
                    if (tab.url && tab.url.startsWith('http')) {
                        chrome.tabs.sendMessage(tab.id, {
                            type: 'REMOVE_CUSTOM_SERVICE',
                            serviceKey: msg.serviceKey
                        }, () => {
                            // Ignore errors for tabs that don't have content script
                            if (chrome.runtime.lastError) { /* ignore */ }
                        });
                    }
                });
            });
            
            // Notify popup of custom services update
            chrome.runtime.sendMessage({ type: 'CUSTOM_SERVICES_UPDATED' });
        }
        break;
  }
  return true;
});

function broadcastPrompt(text, targets, messageType) {
  for (const service of targets) {
    const tabs = serviceTabs[service];
    if (!tabs) continue;
    for (const tabId of tabs) {
      chrome.tabs.sendMessage(tabId, { type: messageType, text, service }, () => {
          if (chrome.runtime.lastError) { /* ignore */ }
      });
    }
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'broadcast-last-prompt') {
    const data = await chrome.storage.local.get('lastPromptText');
    if (data.lastPromptText) {
        const targets = Object.keys(serviceTabs);
        broadcastPrompt(data.lastPromptText, targets, 'INJECT_AND_SEND');
    }
  }
});


// --- Context Grabbing Logic ---

async function getFullPageContentFromActiveTab() {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab || !activeTab.url?.startsWith('http')) { return; }
    try {
        const injectionResults = await chrome.scripting.executeScript({
            target: { tabId: activeTab.id, allFrames: true },
            func: getRenderedTextFromDocument,
        });
        if (injectionResults && injectionResults.length > 0) {
            const pageText = injectionResults.map(r => r.result).filter(Boolean).join('\n\n---\n\n');
            if (pageText) { sendTextToPopup(pageText); }
        }
    } catch (e) { console.error("Error injecting script:", e.message); }
}

// --- Companion Mode ---

async function startCompanionMode(service) {
    if (companionState.companionWindowId) { await stopCompanionMode(); }
    
    const lastFocusedWindow = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    if (!lastFocusedWindow) { return; }

    const [activeTab] = await chrome.tabs.query({ active: true, windowId: lastFocusedWindow.id });
    
    const prefs = await chrome.storage.local.get('companionSettings');
    Object.assign(companionState, prefs.companionSettings);

    chrome.system.display.getInfo(async (displays) => {
        const display = displays[0].workArea;
        const companionWidth = 400; // Fixed width instead of 1/3 of screen
        const controlPanelHeight = 55; // Increased by 10px from 45
        const companionTop = display.top + controlPanelHeight;
        const companionHeight = display.height - controlPanelHeight;

        // Calculate dimensions for perfect tiling
        const browserWidth = display.width - companionWidth;
        const companionLeft = display.left + browserWidth;

        // Store original browser window state for restoration
        companionState.originalBrowserWindow = {
            windowId: lastFocusedWindow.id,
            left: lastFocusedWindow.left,
            top: lastFocusedWindow.top,
            width: lastFocusedWindow.width,
            height: lastFocusedWindow.height,
            state: lastFocusedWindow.state
        };

        // Resize the current browser window to tile perfectly with companion
        try {
            await chrome.windows.update(lastFocusedWindow.id, {
                left: display.left,
                top: display.top,
                width: browserWidth,
                height: display.height,
                state: 'normal' // Ensure it's not maximized
            });
            console.log('[AIMultiChat] Resized browser window for companion tiling');
        } catch (e) {
            console.error('[AIMultiChat] Failed to resize browser window:', e.message);
        }

        // Create the main AI companion window first
        const companionWindow = await chrome.windows.create({
            url: guessLandingUrl(service),
            type: 'popup',
            width: companionWidth,
            height: companionHeight,
            left: companionLeft,
            top: companionTop
        });

        // Create the tiny control panel window above it
        const controlPanelWindow = await chrome.windows.create({
            url: 'src/companion/companion.html',
            type: 'popup',
            width: companionWidth,
            height: controlPanelHeight,
            left: companionLeft,
            top: display.top
        });

        companionState.companionWindowId = companionWindow.id;
        companionState.controlPanelWindowId = controlPanelWindow.id;
        companionState.companionTabId = companionWindow.tabs[0].id;
        companionState.service = service;
        
        // Mark the companion tab for Enter key interception
        setTimeout(() => {
            chrome.tabs.sendMessage(companionState.companionTabId, {
                type: 'MARK_AS_COMPANION',
                service: service
            }, () => {
                if (chrome.runtime.lastError) {
                    console.log('[AIMultiChat] Could not mark companion tab (service may still be loading)');
                }
            });
        }, 2000); // Wait 2 seconds for the AI service to load

        // Set up companion mode for current tab content caching
        setTimeout(async () => {
            if (activeTab && companionState.copyContext) {
                console.log('[AIMultiChat] Initial companion setup - starting content caching for current tab');
                // Activate companion for the current tab and start caching content
                await activateCompanionForTab(activeTab.id);
            }
        }, 1000); // Wait 1 second for AI service to load
    });
}

async function stopCompanionMode() {
    // Restore original browser window if we have the info
    if (companionState.originalBrowserWindow) {
        try {
            const windowInfo = companionState.originalBrowserWindow;
            await chrome.windows.update(windowInfo.windowId, {
                left: windowInfo.left,
                top: windowInfo.top,
                width: windowInfo.width,
                height: windowInfo.height,
                state: windowInfo.state
            });
            console.log('[AIMultiChat] Restored browser window to original position');
        } catch (e) {
            console.error('[AIMultiChat] Failed to restore browser window:', e.message);
        }
    }

    if (companionState.companionWindowId) {
        try { await chrome.windows.remove(companionState.companionWindowId); } catch (e) { /* ignore */ }
    }
    if (companionState.controlPanelWindowId) {
        try { await chrome.windows.remove(companionState.controlPanelWindowId); } catch (e) { /* ignore */ }
    }
    companionState = { companionWindowId: null, controlPanelWindowId: null, companionTabId: null, service: null, lastActiveTabId: null, copyContext: true, isExpanded: false, lastSentContent: null, originalBrowserWindow: null, cachedPageContent: null, cachedPageUrl: null };
}

async function switchCompanionService(newService) {
    if (!companionState.companionWindowId || companionState.service === newService) {
        return; // No companion mode active or already using this service
    }
    
    console.log('[AIMultiChat] Switching companion service to:', newService);
    
    // Store current state
    const currentTabId = companionState.lastActiveTabId;
    const currentSettings = {
        copyContext: companionState.copyContext,
        isExpanded: companionState.isExpanded
    };
    
    // Get window dimensions for seamless transition
    const companionWindow = await chrome.windows.get(companionState.companionWindowId);
    const controlPanelWindow = await chrome.windows.get(companionState.controlPanelWindowId);
    
    // Stop current companion mode
    await stopCompanionMode();
    
    // Start new companion mode with the new service
    await startCompanionMode(newService);
    
    // Restore settings
    Object.assign(companionState, currentSettings);
    
    // If there was an active tab and copy context is enabled, send its content
    if (currentTabId && currentSettings.copyContext) {
        scheduleCompanionUpdates(currentTabId);
    }
}

async function cachePageContentForCompanion(tabId, selectedText = null) {
    if (!tabId || !companionState.companionWindowId || !companionState.copyContext) return;
    try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab.url?.startsWith('http')) {
            // Clear cache for non-web pages
            companionState.cachedPageContent = null;
            companionState.cachedPageUrl = null;
            return;
        }
        
        console.log('[AIMultiChat] Caching content from tab:', tab.url);
        
        const injectionResults = await chrome.scripting.executeScript({
            target: { tabId: tabId, allFrames: true },
            func: getRenderedTextFromDocument,
        });
        
        if (injectionResults && injectionResults.length > 0) {
            const fullText = injectionResults.map(r => r.result).filter(Boolean).join('\n\n---\n\n').trim();
            console.log('[AIMultiChat DEBUG] Cached content length:', fullText.length, 'for:', tab.url);
            console.log('[AIMultiChat DEBUG] Content preview:', fullText.substring(0, 200) + '...');
            
            // Cache the content without sending to companion
            companionState.cachedPageContent = fullText;
            companionState.cachedPageUrl = tab.url;
            
            if (selectedText) {
                companionState.cachedPageContent = fullText + '\n\nHighlighted text: ' + selectedText;
                console.log('[AIMultiChat DEBUG] Added selected text to cache');
            }
            
            console.log('[AIMultiChat DEBUG] Final cached content length:', companionState.cachedPageContent.length);
        } else {
            console.log('[AIMultiChat] No content found to cache');
            companionState.cachedPageContent = null;
            companionState.cachedPageUrl = null;
        }
    } catch (e) { 
        console.error("[AIMultiChat] Error caching page content:", e.message);
        companionState.cachedPageContent = null;
        companionState.cachedPageUrl = null;
    }
}

function sendToCompanion(content) {
    if (companionState.companionTabId) {
        // Use INJECT_TEXT_REALTIME for all companion content updates
        // This ensures proper cursor positioning and content handling
        chrome.tabs.sendMessage(companionState.companionTabId, {
            type: 'INJECT_TEXT_REALTIME',
            text: content,
            service: companionState.service
        }, () => { if (chrome.runtime.lastError) { /* Expected error if script not ready */ } });
    }
}

async function handleModeStart(mode) {
    switch (mode) {
        case 'companion':
            // Start companion mode
            const prefs = await chrome.storage.local.get('defaultCompanionService');
            const defaultService = prefs.defaultCompanionService || 'chatgpt';
            startCompanionMode(defaultService);
            break;
            
        case 'bottom':
            // Start tiled bottom mode
            const bottomPrefs = await chrome.storage.local.get('checkedServices');
            const bottomTargets = bottomPrefs.checkedServices || ['chatgpt', 'claude', 'gemini'];
            tileWindowsBottom(bottomTargets);
            break;
            
        case 'right':
            // Start tiled right mode
            const rightPrefs = await chrome.storage.local.get('checkedServices');
            const rightTargets = rightPrefs.checkedServices || ['chatgpt', 'claude', 'gemini'];
            tileWindowsVertical(rightTargets);
            break;
            
        case 'multi-mode':
            // Open the original advanced popup
            createPopupWindow();
            break;
            
        case 'settings':
            // Open settings page
            createPopupWindow({ url: 'src/popup/settings.html', width: 350, height: 450 });
            break;
    }
}

// --- Window and Tab Creation ---

async function openTabsInWindow(targets) {
    for (const serviceKey of targets) {
        await chrome.tabs.create({ url: guessLandingUrl(serviceKey), active: false });
    }
}

function tileWindowsVertical(servicesToTile) {
  chrome.system.display.getInfo(async (displays) => {
    if (chrome.runtime.lastError) { console.error(chrome.runtime.lastError.message); return; }
    const display = displays[0].workArea;
    
    // Close existing tiled windows first
    for (const windowId of tiledWindowIds) {
      try { await chrome.windows.remove(windowId); } catch (e) { /*ignore*/ }
    }
    tiledWindowIds.clear();
    
    const screenWidth = display.width, screenHeight = display.height;
    const popupWidth = Math.floor(screenWidth / 4);
    const servicesAreaWidth = screenWidth - popupWidth;
    const numServices = servicesToTile.length;
    const serviceWindowWidth = numServices > 0 ? Math.floor(servicesAreaWidth / numServices) : 0;
    if (popupWindowId) { try { await chrome.windows.remove(popupWindowId); } catch (e) { /*ignore*/ } popupWindowId = null; }
    for (let i = 0; i < numServices; i++) {
      const serviceKey = servicesToTile[i];
      const newWindow = await chrome.windows.create({ url: guessLandingUrl(serviceKey), left: display.left + i * serviceWindowWidth, top: display.top, width: serviceWindowWidth, height: screenHeight });
      if (newWindow) { tiledWindowIds.add(newWindow.id); }
    }
    createPopupWindow({ left: display.left + servicesAreaWidth, top: display.top, width: popupWidth, height: screenHeight });
  });
}

async function tileWindowsBottom(servicesToTile) {
    chrome.system.display.getInfo(async (displays) => {
        if (chrome.runtime.lastError) { console.error(chrome.runtime.lastError.message); return; }
        const display = displays[0].workArea;
        
        // Close existing tiled windows first
        for (const windowId of tiledWindowIds) {
            try { await chrome.windows.remove(windowId); } catch (e) { /*ignore*/ }
        }
        tiledWindowIds.clear();
        if (popupWindowId) { try { await chrome.windows.remove(popupWindowId); } catch (e) { /*ignore*/ } popupWindowId = null; }
        const bottomPopupHeight = 140;
        const servicesAreaHeight = display.height - bottomPopupHeight;
        const numServices = servicesToTile.length;
        const serviceWindowWidth = numServices > 0 ? Math.floor(display.width / numServices) : 0;
        for (let i = 0; i < numServices; i++) {
            const serviceKey = servicesToTile[i];
            const newWindow = await chrome.windows.create({ url: guessLandingUrl(serviceKey), left: display.left + i * serviceWindowWidth, top: display.top, width: serviceWindowWidth, height: servicesAreaHeight });
            if (newWindow) { tiledWindowIds.add(newWindow.id); }
        }
        createPopupWindow({ url: 'src/popup/popup.html?layout=bottom', left: display.left, top: display.top + servicesAreaHeight, width: display.width, height: bottomPopupHeight });
    });
}

function guessLandingUrl(service) {
  switch (service) {
    case 'chatgpt': return 'https://chatgpt.com/';
    case 'claude': return 'https://claude.ai/new';
    case 'gemini': return 'https://gemini.google.com/app';
    case 'deepseek': return 'https://chat.deepseek.com/';
    case 'grok': return 'https://grok.com/';
    default: return `https://www.${service}.com`;
  }
}
