import { SERVICES } from './services-config.js';

console.log('[BG] started');

const serviceTabs = {};
let popupWindowId = null;
let tiledWindowIds = new Set();
const BOTTOM_POPUP_HEIGHT = 140;
const VERTICAL_POPUP_DIVISOR = 4;
let tiledLayoutState = {
    layout: null,
    services: [],
    displayId: null,
    windows: []
};

function getDisplaysAsync() {
    return new Promise((resolve) => {
        chrome.system.display.getInfo((displays) => {
            if (chrome.runtime.lastError || !displays) {
                console.error('[AIMultiChat] Could not retrieve displays for retile:', chrome.runtime.lastError?.message);
                resolve([]);
            } else {
                resolve(displays);
            }
        });
    });
}

async function safeUpdateWindow(windowId, updateInfo) {
    try {
        await chrome.windows.update(windowId, updateInfo);
    } catch (error) {
        console.warn(`[AIMultiChat] Failed to update window ${windowId}:`, error?.message);
    }
}

function getServiceKeyFromUrl(url) {
    if (!url || !url.startsWith('http')) {
        return null;
    }
    try {
        const host = new URL(url).hostname.replace(/^www\./, '');
        return Object.keys(SERVICES).find(key => SERVICES[key].match.test(host)) || null;
    } catch (e) {
        return null;
    }
}

async function rebuildServiceTabRegistry() {
    try {
        Object.keys(serviceTabs).forEach(key => delete serviceTabs[key]);
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
            const serviceKey = getServiceKeyFromUrl(tab.url);
            if (!serviceKey) { continue; }
            if (!serviceTabs[serviceKey]) {
                serviceTabs[serviceKey] = new Set();
            }
            serviceTabs[serviceKey].add(tab.id);
        }
        broadcastStatusUpdate();
    } catch (error) {
        console.error('[AIMultiChat] Failed to rebuild service registry:', error);
    }
}

chrome.runtime.onInstalled.addListener(() => rebuildServiceTabRegistry());
chrome.runtime.onStartup.addListener(() => rebuildServiceTabRegistry());
rebuildServiceTabRegistry();

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


// This function will be injected into the target page to extract text.
function getRenderedTextFromDocument() {

    // Helper function to detect header-like text patterns
    function isLikelyHeaderText(textChunk, position = 'unknown') {
        const textLower = textChunk.toLowerCase();

        // Clear header indicators
        if (textLower.includes('skip to') ||
            textLower.includes('skip navigation') ||
            textLower.includes('subscription') ||
            textLower.includes('subscribe') ||
            textLower.includes('login') ||
            textLower.includes('log out') ||
            textLower.includes('profile') ||
            textLower.includes('customer service') ||
            textLower.includes('main menu')) {
            return true;
        }

        // NYTimes specific patterns
        if (textLower.includes('u.s.international') ||
            textLower.includes('give the times') ||
            textLower.match(/skip to content.*search/i)) {
            return true;
        }

        // If it's at the beginning and has lots of navigation words (more restrictive)
        if (position === 'beginning') {
            const navWords = ['home', 'news', 'sports', 'business', 'politics', 'world', 'opinion', 'search', 'subscribe', 'login', 'account'];
            const foundNavWords = navWords.filter(word => textLower.includes(word)).length;
            // Require more navigation words and shorter text to be considered header
            if (foundNavWords >= 6 && textChunk.length < 200) {
                return true;
            }
        }

        return false;
    }

    // Helper function to detect footer-like text patterns  
    function isLikelyFooterText(textChunk, position = 'unknown') {
        const textLower = textChunk.toLowerCase();

        console.log('[AIMultiChat] Checking footer text:', "position ", position, "text: ", textLower.substring(0, 100));

        // Clear footer indicators
        if (textLower.includes('copyright') ||
            textLower.includes('contact us') ||
            textLower.includes('cookie') ||
            textLower.includes('©') ||
            textLower.includes('terms of service') ||
            textLower.includes('privacy policy') ||
            textLower.includes('all rights reserved') ||
            textLower.match(/©.*\d{4}/) ||
            textLower.match(/\d{4}.*all rights/)) {
            return true;
        }

        // If it's at the end and has lots of footer-like links (more restrictive)
        if (position === 'end') {
            const footerWords = ['contact', 'about', 'careers', 'terms', 'privacy', 'help', 'support', 'legal'];
            const foundFooterWords = footerWords.filter(word => textLower.includes(word)).length;
            // Require more footer words and shorter text to be considered footer
            if (foundFooterWords >= 4 && textChunk.length < 400) {
                return true;
            }
        }

        return false;
    }

    // First try to get basic text content to ensure we get something
    let text = document.body ? document.body.innerText || document.body.textContent || '' : '';

    try {
        // Split text into paragraphs for gentler filtering
        let lines = text.split('\n').filter(line => line.trim().length > 0);

        console.log('[AIMultiChat] Original lines:', lines.length);

        // Filter out header-like content at the beginning (more conservative)
        let startIndex = 0;
        let consecutiveHeaderLines = 0;
        for (let i = 0; i < Math.min(lines.length, 15); i++) {  // Check first 15 lines max
            if (isLikelyHeaderText(lines[i], 'beginning')) {
                console.log('[AIMultiChat] Removing header line:', lines[i].substring(0, 100));
                consecutiveHeaderLines++;
                // Only remove if we haven't removed too many lines already
                if (consecutiveHeaderLines <= 10) {
                    startIndex = i + 1;
                }
            } else if (lines[i].length > 30) {
                // Found substantial content, stop removing
                console.log('[AIMultiChat] Found content line, stopping header removal:', lines[i].substring(0, 100));
                break;
            }
        }

        // Safety check - don't remove more than 80% of content
        if (startIndex > lines.length * 0.8) {
            console.log('[AIMultiChat] Header filtering too aggressive, resetting startIndex from', startIndex, 'to 0');
            startIndex = 0;
        }

        // Filter out footer-like content at the end by deleting as detected
        for (let i = lines.length - 1; i >= Math.max(0, lines.length - 25); i--) {  // Check last 25 lines max
            if (isLikelyFooterText(lines[i], 'end')) {
                console.log('[AIMultiChat] Removing footer line:', lines[i].substring(0, 100));
                lines.splice(i, 1);  // Delete the footer line immediately
            } else if (lines[i].length > 40) {
                // Found substantial content, stop removing
                console.log('[AIMultiChat] Found content line, stopping footer removal:', lines[i].substring(0, 100));
                break;
            }
        }

        // Keep only the content after header
        lines = lines.slice(startIndex);
        text = lines.join('\n');

        console.log('[AIMultiChat] After line filtering:', lines.length, 'lines remaining');

        // Apply regex-based cleanup for remaining header/nav patterns
        text = text
            .replace(/window\.\w+.*$/gm, '')
            .replace(/function\s*\([^)]*\).*$/gm, '')
            // Apply specific pattern filtering
            .replace(/SKIP TO CONTENT\s*SKIP TO SITE INDEX\s*SEARCH\s*/gi, '')
            .replace(/U\.S\.\s*INTERNATIONAL\s*CANADA\s*ESPAÑOL\s*中文\s*/gi, '')
            .replace(/U\.S\.INTERNATIONAL\s*CANADA\s*ESPAÑOL\s*中文\s*/gi, '')
            .replace(/GIVE THE TIMES\s*Account\s*/gi, '')
            .replace(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+[A-Za-z]+\s+\d{1,2},?\s+\d{4}\s*/gi, '')
            .replace(/Today's Paper\s*/gi, '')
            .replace(/(?:Nasdaq|S&P 500|Dow)\s*[+-]?\d+\.?\d*%?\s*/gi, '')
            .replace(/U\.S\.\s*World\s*Business\s*Arts\s*Lifestyle\s*Opinion\s*Audio\s*Games\s*Cooking\s*Wirecutter\s*The Athletic\s*/gi, '')
            .replace(/New York Times\s*-\s*(?:T|Top Stories)\s*/gi, '')
            .replace(/The New York Times\s*/gi, '')
            // Clean up whitespace
            .replace(/\n\s*\n/g, '\n\n')
            .replace(/\s{3,}/g, ' ')
            .trim();

        return text;
    } catch (e) {
        console.log('[AIMultiChat] Error in content extraction, using fallback:', e.message);
        // Apply the same filtering to the final fallback
        return text
            .replace(/SKIP TO CONTENT\s*SKIP TO SITE INDEX\s*SEARCH\s*/gi, '')
            .replace(/U\.S\.\s*INTERNATIONAL\s*CANADA\s*ESPAÑOL\s*中文\s*/gi, '')
            .replace(/U\.S\.INTERNATIONAL\s*CANADA\s*ESPAÑOL\s*中文\s*/gi, '')
            .replace(/GIVE THE TIMES\s*Account\s*/gi, '')
            .replace(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+[A-Za-z]+\s+\d{1,2},?\s+\d{4}\s*/gi, '')
            .replace(/Today's Paper\s*/gi, '')
            .replace(/(?:Nasdaq|S&P 500|Dow)\s*[+-]?\d+\.?\d*%?\s*/gi, '')
            .replace(/U\.S\.\s*World\s*Business\s*Arts\s*Lifestyle\s*Opinion\s*Audio\s*Games\s*Cooking\s*Wirecutter\s*The Athletic\s*/gi, '')
            .replace(/New York Times\s*-\s*(?:T|Top Stories)\s*/gi, '')
            .replace(/The New York Times\s*/gi, '')
            .replace(/^.*?SKIP TO CONTENT.*?(?:New York Times|The Athletic).*?(?=Trump|[A-Z][a-z]+\s+[A-Z][a-z]+)/gmi, '')
            .replace(/^.*?GIVE THE TIMES.*?Account.*?(?=Trump|[A-Z][a-z]+\s+[A-Z][a-z]+)/gmi, '')
            .replace(/\n\s*\n/g, '\n\n')
            .replace(/\s{3,}/g, ' ')
            .trim();
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
    //console.log(`[BG DEBUG] Tab ${tabId} was closed`);
    let changed = false;
    let removedFrom = [];

    Object.keys(serviceTabs).forEach(s => {
        if (serviceTabs[s] && serviceTabs[s].has(tabId)) {
            serviceTabs[s].delete(tabId);
            removedFrom.push(s);
            if (serviceTabs[s].size === 0) {
                delete serviceTabs[s];
                console.log(`[BG DEBUG] Service ${s} has no tabs left after tab closure, removing service`);
            }
            changed = true;
        }
    });

    if (removedFrom.length > 0) {
        console.log(`[BG DEBUG] Closed tab ${tabId} was registered for services: ${removedFrom.join(', ')}`);
    }

    if (changed) {
        broadcastStatusUpdate();
    }
});

// --- Tab Glow Functions ---

function enableTabGlow(tabId) {
    if (!tabId) return;
    chrome.tabs.sendMessage(tabId, {
        type: 'ENABLE_TAB_GLOW'
    }, () => {
        if (chrome.runtime.lastError) {
            console.log('[AIMultiChat] Could not enable tab glow (script may not be ready)');
        } else {
            console.log('[AIMultiChat] Tab glow enabled for tab', tabId);
        }
    });
}

function disableTabGlow(tabId) {
    if (!tabId) return;
    chrome.tabs.sendMessage(tabId, {
        type: 'DISABLE_TAB_GLOW'
    }, () => {
        if (chrome.runtime.lastError) {
            // Ignore errors for tabs that might be closed or don't have the script
        } else {
            console.log('[AIMultiChat] Tab glow disabled for tab', tabId);
        }
    });
}

// --- Companion Mode Listeners ---

// Schedules a series of caching operations to capture dynamically loaded content.
function scheduleCompanionCaching(tabId, isNewNavigation = false) {
    console.log('[COMPANION TRACE] scheduleCompanionCaching called:', tabId, 'isNewNavigation:', isNewNavigation, 'lastActiveTabId:', companionState.lastActiveTabId, 'companionWindowId:', companionState.companionWindowId);

    const cacheIfActive = () => {
        // Only cache if companion mode is active and it's still the same tab.
        console.log('[COMPANION TRACE] cacheIfActive check - companionWindowId:', companionState.companionWindowId, 'tabId:', tabId, 'lastActiveTabId:', companionState.lastActiveTabId);
        if (companionState.companionWindowId && tabId === companionState.lastActiveTabId) {
            console.log('[COMPANION TRACE] Conditions met, calling cachePageContentForCompanion for tab:', tabId);
            cachePageContentForCompanion(tabId);
        } else {
            console.log('[COMPANION TRACE] Skipping cache - companion inactive or tab changed');
        }
    };

    if (isNewNavigation) {
        console.log('[COMPANION TRACE] Scheduling content caching for new navigation, tab:', tabId);
        // For new page loads, wait a bit longer before first attempt
        setTimeout(cacheIfActive, 500);  // Initial delay for page to start loading
        setTimeout(cacheIfActive, 2000); // 2-second follow-up for basic content
        setTimeout(cacheIfActive, 5000); // 5-second follow-up for dynamic content
        setTimeout(cacheIfActive, 10000); // 10-second follow-up for very slow content
        setTimeout(cacheIfActive, 15000); // 15-second follow-up for very slow sites like WSJ/NYT
    } else {
        console.log('[COMPANION TRACE] Scheduling content caching for existing page, tab:', tabId);
        // For existing pages or tab switches, cache immediately
        cacheIfActive();
        // Then schedule follow-up caching for dynamic content
        setTimeout(cacheIfActive, 1000); // 1-second follow-up
        setTimeout(cacheIfActive, 5000);  // 5-second follow-up for slow-loading content
        setTimeout(cacheIfActive, 10000); // 10-second follow-up for very slow content
    }
}

async function activateCompanionForTab(tabId) {
    console.log('[COMPANION TRACE] activateCompanionForTab called:', tabId, 'companionWindowId:', companionState.companionWindowId, 'companionTabId:', companionState.companionTabId);
    if (!companionState.companionWindowId || !tabId || tabId === companionState.companionTabId) {
        console.log('[COMPANION TRACE] Skipping activation - no companion window, no tabId, or tab is companion tab');
        return;
    }

    try {
        const tab = await chrome.tabs.get(tabId);
        console.log('[COMPANION TRACE] Got tab info:', tab.url);
        if (!tab.url?.startsWith('http')) {
            console.log('[COMPANION TRACE] Non-web page, clearing content and disabling glow');
            // Clear companion content for non-web pages
            if (companionState.copyContext) {
                sendToCompanion('');
            }
            // Disable glow for non-web pages
            disableTabGlow(tabId);
            return;
        }
    } catch (e) {
        console.error(`[COMPANION TRACE] Could not get tab ${tabId}: ${e.message}`);
        return; // Tab may have closed
    }

    // Clear cache when switching to a different tab
    if (companionState.lastActiveTabId !== tabId) {
        console.log('[COMPANION TRACE] Switching from tab', companionState.lastActiveTabId, 'to tab', tabId);
        companionState.cachedPageContent = null;
        companionState.cachedPageUrl = null;
        // Disable glow on previous tab
        if (companionState.lastActiveTabId) {
            disableTabGlow(companionState.lastActiveTabId);
        }
    }

    companionState.lastActiveTabId = tabId;
    console.log('[COMPANION TRACE] Updated lastActiveTabId to:', tabId);

    // Inject the tab glow script (only if not already injected)
    try {
        await chrome.scripting.executeScript({
            target: { tabId: tabId, allFrames: false },
            files: ['src/content/tab-glow.js'],
        });
        console.log('[COMPANION TRACE] Tab glow script injected successfully for tab:', tabId);

        // Enable the glow effect
        enableTabGlow(tabId);
    } catch (e) {
        // If injection fails, it might already be injected, so try to enable glow anyway
        console.log(`[COMPANION TRACE] Could not inject tab glow script into tab ${tabId}. Trying to enable glow anyway.`);
        enableTabGlow(tabId);
    }

    // Inject the listener to ensure it's active on the target tab.
    try {
        await chrome.scripting.executeScript({
            target: { tabId: tabId, allFrames: true },
            files: ['src/content/selection-listener.js'],
        });
        console.log('[COMPANION TRACE] Selection listener injected successfully for tab:', tabId);
    } catch (e) {
        console.log(`[COMPANION TRACE] Could not inject selection listener into tab ${tabId}. This is expected for special pages (e.g., chrome web store).`);
    }

    // Only cache content if copyContext is enabled
    if (companionState.copyContext) {
        console.log('[COMPANION TRACE] copyContext enabled, scheduling content caching for tab:', tabId);
        // Cache the full page content with scheduled retries for dynamic content.
        scheduleCompanionCaching(tabId);
    } else {
        console.log('[COMPANION TRACE] copyContext disabled, skipping content caching');
    }
}

chrome.tabs.onActivated.addListener(activeInfo => {
    console.log('[COMPANION TRACE] Tab activated:', activeInfo.tabId, 'companion active:', !!companionState.companionWindowId);
    activateCompanionForTab(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    console.log('[COMPANION TRACE] Tab updated:', tabId, 'changeInfo:', changeInfo, 'companion active:', !!companionState.companionWindowId, 'copyContext:', companionState.copyContext);
    if (companionState.companionWindowId && companionState.copyContext && changeInfo.status === 'complete' && tab.url?.startsWith('http')) {
        // Check if this is the currently active tab or the tracked tab
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        console.log('[COMPANION TRACE] Page load completed for tab:', tabId, 'activeTab:', activeTab?.id, 'lastActiveTabId:', companionState.lastActiveTabId);
        if ((activeTab && activeTab.id === tabId) || tabId === companionState.lastActiveTabId) {
            console.log('[COMPANION TRACE] Activating companion and scheduling updates for tab:', tabId);
            // Ensure companion mode is active for this tab
            await activateCompanionForTab(tabId);
            // This is a page that just finished loading, treat as new navigation
            scheduleCompanionCaching(tabId, true);
        }
    }
});

chrome.webNavigation.onHistoryStateUpdated.addListener(details => {
    console.log('[COMPANION TRACE] History state updated:', details.tabId, 'lastActiveTabId:', companionState.lastActiveTabId, 'companion active:', !!companionState.companionWindowId);
    if (companionState.companionWindowId && companionState.copyContext && details.tabId === companionState.lastActiveTabId && details.frameId === 0) {
        console.log('[COMPANION TRACE] SPA navigation detected, scheduling caching for tab:', details.tabId);
        // History state update (SPA navigation), treat as new navigation
        scheduleCompanionCaching(details.tabId, true);
    }
});

chrome.webNavigation.onCompleted.addListener(async (details) => {
    console.log('[COMPANION TRACE] Navigation completed:', details.tabId, 'frameId:', details.frameId, 'companion active:', !!companionState.companionWindowId);
    // Ensure it's the main frame and companion mode is active
    if (details.frameId === 0 && companionState.companionWindowId && companionState.copyContext) {
        // Check if this is the currently active tab or the tracked tab
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        console.log('[COMPANION TRACE] Navigation completed - activeTab:', activeTab?.id, 'lastActiveTabId:', companionState.lastActiveTabId);
        if ((activeTab && activeTab.id === details.tabId) || details.tabId === companionState.lastActiveTabId) {
            console.log('[COMPANION TRACE] Navigation completed for tracked tab, activating companion and scheduling updates');
            // Ensure companion mode is active for this tab
            await activateCompanionForTab(details.tabId);
            // Navigation completed, treat as new navigation
            scheduleCompanionCaching(details.tabId, true);
        }
    }

    // Check if tab navigated to an AI service and trigger re-registration
    if (details.frameId === 0) {
        try {
            const hostname = new URL(details.url).hostname.replace(/^www\./, '');

            // Check if the new URL matches any AI service
            for (const serviceKey of Object.keys(SERVICES)) {
                if (SERVICES[serviceKey].match.test(hostname)) {
                    console.log(`[AIMultiChat] Tab ${details.tabId} navigated to AI service ${serviceKey}, content script should re-register`);
                    // The content script will handle re-registration automatically when it loads
                    // We just log this for debugging purposes
                    break;
                }
            }
        } catch (e) {
            // Invalid URL, ignore
        }
    }
});

// Additional listener for when navigation starts - clears last content so new page will definitely be sent
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
    console.log('[COMPANION TRACE] Before navigate:', details.tabId, 'frameId:', details.frameId, 'companion active:', !!companionState.companionWindowId);
    if (details.frameId === 0 && companionState.companionWindowId) {
        // Check if this is the currently active tab
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        console.log('[COMPANION TRACE] Before navigate - activeTab:', activeTab?.id, 'lastActiveTabId:', companionState.lastActiveTabId);
        if (activeTab && activeTab.id === details.tabId) {
            console.log('[COMPANION TRACE] Navigation starting in active tab, clearing content cache and activating companion mode');
            companionState.cachedPageContent = null;
            companionState.cachedPageUrl = null;
            // Activate companion mode for this tab (handles new tabs that weren't tracked before)
            activateCompanionForTab(details.tabId);
        } else if (details.tabId === companionState.lastActiveTabId) {
            console.log('[COMPANION TRACE] Navigation starting in tracked tab, clearing content cache');
            companionState.cachedPageContent = null;
            companionState.cachedPageUrl = null;
        }
    }

    // Check if tab is navigating away from an AI service
    if (details.frameId === 0) {
        try {
            const hostname = new URL(details.url).hostname.replace(/^www\./, '');
            let isAIService = false;

            // Check if the new URL matches any AI service
            for (const serviceKey of Object.keys(SERVICES)) {
                if (SERVICES[serviceKey].match.test(hostname)) {
                    isAIService = true;
                    break;
                }
            }

            // If navigating away from AI service, clean up service registration
            if (!isAIService) {
                let changed = false;
                Object.keys(serviceTabs).forEach(serviceKey => {
                    if (serviceTabs[serviceKey] && serviceTabs[serviceKey].has(details.tabId)) {
                        console.log(`[AIMultiChat] Tab ${details.tabId} navigating away from AI service, removing ${serviceKey} registration`);
                        serviceTabs[serviceKey].delete(details.tabId);
                        if (serviceTabs[serviceKey].size === 0) {
                            delete serviceTabs[serviceKey];
                        }
                        changed = true;
                    }
                });
                if (changed) {
                    broadcastStatusUpdate();
                }
            }
        } catch (e) {
            // Invalid URL, ignore
        }
    }
});


// --- Window Management ---

// Remove the action click listener - we'll use context menu instead

// Helper function to find which display contains a given window
function getDisplayForWindow(windowInfo, displays) {
    // Check if window has valid position
    if (windowInfo.left === undefined || windowInfo.top === undefined) {
        return displays[0]; // Fallback to primary display
    }

    // Find the display that contains the window's center point
    const windowCenterX = windowInfo.left + (windowInfo.width || 0) / 2;
    const windowCenterY = windowInfo.top + (windowInfo.height || 0) / 2;

    for (const display of displays) {
        const bounds = display.workArea;
        if (windowCenterX >= bounds.left &&
            windowCenterX < bounds.left + bounds.width &&
            windowCenterY >= bounds.top &&
            windowCenterY < bounds.top + bounds.height) {
            return display;
        }
    }

    // If no display contains the window center, return the primary display
    return displays[0];
}

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
    //console.log(`[BG DEBUG] Registering tab ${tabId} for service: ${service}`);
    if (!serviceTabs[service]) {
        serviceTabs[service] = new Set();
        console.log(`[BG DEBUG] Created new service entry for: ${service}`);
    }

    const wasAlreadyRegistered = serviceTabs[service].has(tabId);
    serviceTabs[service].add(tabId);

    if (wasAlreadyRegistered) {
        console.log(`[BG DEBUG] Tab ${tabId} was already registered for ${service} (re-registration)`);
    } else {
        console.log(`[BG DEBUG] Successfully registered new tab ${tabId} for ${service}`);
    }

    console.log(`[BG DEBUG] Service ${service} now has ${serviceTabs[service].size} tabs: [${[...serviceTabs[service]].join(', ')}]`);
    broadcastStatusUpdate();
}

// Separate non-async listener for discuss feature (async listeners can't use sendResponse properly)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'EXTRACT_ALL_RESPONSES') {
        console.log('[AIMultiChat DISCUSS] EXTRACT_ALL_RESPONSES received, targets:', msg.targets);
        console.log('[AIMultiChat DISCUSS] Current serviceTabs:', JSON.stringify(serviceTabs));

        const responses = {};

        if (!msg.targets || msg.targets.length === 0) {
            console.log('[AIMultiChat DISCUSS] No targets, sending empty response');
            sendResponse(responses);
            return false;
        }

        let pending = 0;
        let completed = 0;

        for (const service of msg.targets) {
            const tabSet = serviceTabs[service];
            const tabs = tabSet ? Array.from(tabSet) : [];
            console.log(`[AIMultiChat DISCUSS] Service ${service} has tabs:`, tabs);

            if (tabs.length > 0) {
                pending++;
                const tabId = tabs[0];
                console.log(`[AIMultiChat DISCUSS] Sending EXTRACT_RESPONSE to ${service} tab ${tabId}`);

                chrome.tabs.sendMessage(tabId, {
                    type: 'EXTRACT_RESPONSE',
                    service: service
                }, (response) => {
                    completed++;
                    if (chrome.runtime.lastError) {
                        console.log(`[AIMultiChat DISCUSS] Error extracting from ${service}:`, chrome.runtime.lastError.message);
                    } else if (response && response.success) {
                        console.log(`[AIMultiChat DISCUSS] Got response from ${service}:`, response.response?.substring(0, 100));
                        responses[service] = {
                            label: response.label,
                            response: response.response
                        };
                    } else {
                        console.log(`[AIMultiChat DISCUSS] No/invalid response from ${service}:`, response);
                    }

                    if (completed === pending) {
                        console.log('[AIMultiChat DISCUSS] All responses collected:', Object.keys(responses));
                        sendResponse(responses);
                    }
                });
            }
        }

        if (pending === 0) {
            console.log('[AIMultiChat DISCUSS] No pending requests');
            sendResponse(responses);
            return false;
        }

        return true; // Keep channel open for async response
    }

    if (msg.type === 'DISCUSS_BROADCAST') {
        if (msg.responses && msg.targets && msg.targets.length > 0) {
            for (const targetService of msg.targets) {
                const tabSet = serviceTabs[targetService];
                const tabs = tabSet ? Array.from(tabSet) : [];
                if (tabs.length === 0) continue;

                const otherResponses = Object.entries(msg.responses)
                    .filter(([svc]) => svc !== targetService)
                    .map(([svc, data]) => {
                        const label = data.label || svc;
                        return `${label}'s Response:\n"""\n${data.response}\n"""`;
                    })
                    .join('\n\n');

                if (!otherResponses) continue;

                const discussPrompt = `Here are the perspectives on the same issue from other LLMs. Tell me what you think compared to your own analysis, taking the strengths and discarding the weaknesses of their and your approach. Synthesize the strengths of all.\n\n${otherResponses}`;

                for (const tabId of tabs) {
                    chrome.tabs.sendMessage(tabId, {
                        type: 'INJECT_AND_SEND',
                        service: targetService,
                        text: discussPrompt
                    }, () => {
                        if (chrome.runtime.lastError) {
                            console.log(`[AIMultiChat] Error sending discuss to ${targetService}:`, chrome.runtime.lastError.message);
                        }
                    });
                }
            }
            sendResponse({ ok: true });
        }
        return false;
    }

    // Not handled by this listener
    return false;
});

chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
    // These are handled by the non-async listener above
    if (msg.type === 'EXTRACT_ALL_RESPONSES' || msg.type === 'DISCUSS_BROADCAST') {
        return false;
    }

    switch (msg.type) {
        case 'REGISTER_SERVICE':
            if (sender.tab && msg.service) {
                console.log('[COMPANION TRACE] Service registered:', msg.service, 'for tab:', sender.tab.id, 'companionTabId:', companionState.companionTabId);
                registerServiceTab(msg.service, sender.tab.id);
                if (companionState.companionTabId === sender.tab.id && companionState.lastActiveTabId && companionState.copyContext) {
                    console.log('[COMPANION TRACE] Companion tab registered, scheduling caching for lastActiveTabId:', companionState.lastActiveTabId);
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
        case 'BROADCAST_FILE_UPLOAD':
            if (msg.fileData && msg.targets) {
                for (const service of msg.targets) {
                    const tabSet = serviceTabs[service];
                    if (!tabSet) continue;
                    for (const tabId of tabSet) {
                        chrome.tabs.sendMessage(tabId, {
                            type: 'UPLOAD_FILE',
                            service: service,
                            fileData: msg.fileData
                        });
                    }
                }
            }
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
                console.log('[COMPANION TRACE] Updating companion settings:', msg.settings, 'lastActiveTabId:', companionState.lastActiveTabId);
                Object.assign(companionState, msg.settings);
                chrome.storage.local.set({ companionSettings: msg.settings });
                if (msg.settings.copyContext && companionState.lastActiveTabId) {
                    console.log('[COMPANION TRACE] copyContext enabled, scheduling caching for lastActiveTabId:', companionState.lastActiveTabId);
                    scheduleCompanionCaching(companionState.lastActiveTabId);
                } else if (!msg.settings.copyContext) {
                    console.log('[COMPANION TRACE] copyContext disabled, clearing cached content');
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
        case 'REFRESH_PAGE_CONTENT':
            // Manual refresh of page content for companion mode
            if (companionState.companionWindowId && companionState.lastActiveTabId) {
                console.log('[AIMultiChat] Manual refresh requested for tab:', companionState.lastActiveTabId);
                scheduleCompanionCaching(companionState.lastActiveTabId);
                sendResponse({ success: true });
            } else {
                sendResponse({ success: false, error: 'No active tab to refresh' });
            }
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
        case 'RAISE_AND_RETILE':
            raiseAndRetileTiledWindows();
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
    //console.log('[BG DEBUG] Broadcasting prompt to targets:', targets);
    //console.log('[BG DEBUG] Current serviceTabs state:', JSON.stringify(serviceTabs));

    for (const service of targets) {
        const tabs = serviceTabs[service];
        //console.log(`[BG DEBUG] Service ${service} has tabs:`, tabs ? [...tabs] : 'none');

        if (!tabs) {
            console.log(`[BG DEBUG] No tabs registered for service: ${service}`);
            continue;
        }

        for (const tabId of tabs) {
            //console.log(`[BG DEBUG] Sending message to tab ${tabId} for service ${service}`);
            chrome.tabs.sendMessage(tabId, { type: messageType, text, service }, (response) => {
                if (chrome.runtime.lastError) {

                    // Send failure feedback to popup
                    chrome.runtime.sendMessage({
                        type: 'SERVICE_FEEDBACK',
                        service: service,
                        tabId: tabId,
                        status: 'error',
                        error: chrome.runtime.lastError.message
                    });
                } else {
                    console.log(`[BG DEBUG] Message sent successfully to tab ${tabId}`);
                }
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
        // Find the display that contains the current browser window
        const currentDisplay = getDisplayForWindow(lastFocusedWindow, displays);
        const display = currentDisplay.workArea;

        const companionWidth = 400; // Fixed width instead of 1/3 of screen
        const controlPanelHeight = 55; // Base height, will expand when options are shown
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
            url: getServiceUrl(service),
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
    // Disable glow on the last active tab
    if (companionState.lastActiveTabId) {
        disableTabGlow(companionState.lastActiveTabId);
    }

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
        scheduleCompanionCaching(currentTabId);
    }
}

// Helper function to truncate content to approximately 3500 words
function truncateToWordLimit(text, maxWords = 3500) {
    if (!text) return text;

    const words = text.trim().split(/\s+/);
    if (words.length <= maxWords) {
        return text;
    }

    const truncated = words.slice(0, maxWords).join(' ');
    return truncated + '\n\n[Content truncated - showing first ' + maxWords + ' words of ' + words.length + ' total words]';
}

async function cachePageContentForCompanion(tabId, selectedText = null) {
    console.log('[COMPANION TRACE] cachePageContentForCompanion called:', tabId, 'companionWindowId:', companionState.companionWindowId, 'copyContext:', companionState.copyContext);
    if (!tabId || !companionState.companionWindowId || !companionState.copyContext) {
        console.log('[COMPANION TRACE] Skipping cache - missing conditions');
        return;
    }
    try {
        const tab = await chrome.tabs.get(tabId);
        console.log('[COMPANION TRACE] Tab URL:', tab.url);
        if (!tab.url?.startsWith('http')) {
            console.log('[COMPANION TRACE] Non-web URL, clearing cache');
            // Clear cache for non-web pages
            companionState.cachedPageContent = null;
            companionState.cachedPageUrl = null;
            // Notify companion panel of content update
            notifyCompanionPanelOfContentUpdate(null, tab.url);
            return;
        }

        console.log('[COMPANION TRACE] Starting content extraction for tab:', tab.url);

        const injectionResults = await chrome.scripting.executeScript({
            target: { tabId: tabId, allFrames: true },
            func: getRenderedTextFromDocument,
        });

        if (injectionResults && injectionResults.length > 0) {
            let fullText = injectionResults.map(r => r.result).filter(Boolean).join('\n\n---\n\n').trim();

            // Apply size limits - truncate to ~3500 words
            fullText = truncateToWordLimit(fullText, 3500);

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

            // Notify companion panel of content update
            notifyCompanionPanelOfContentUpdate(companionState.cachedPageContent, tab.url);
        } else {
            console.log('[COMPANION TRACE] No content found to cache for tab:', tabId);
            companionState.cachedPageContent = null;
            companionState.cachedPageUrl = null;
            // Notify companion panel of content update
            notifyCompanionPanelOfContentUpdate(null, tab.url);
        }
    } catch (e) {
        console.error("[COMPANION TRACE] Error caching page content for tab", tabId, ":", e.message);
        companionState.cachedPageContent = null;
        companionState.cachedPageUrl = null;
        // Notify companion panel of content update
        notifyCompanionPanelOfContentUpdate(null, tab?.url);
    }
}

// Helper function to notify companion panel of content updates
function notifyCompanionPanelOfContentUpdate(content, url) {
    if (!companionState.controlPanelWindowId) return;

    chrome.tabs.query({ windowId: companionState.controlPanelWindowId }, (tabs) => {
        if (tabs && tabs.length > 0) {
            // const preview = content ? content.substring(0, 500) + '...' : '';
            const preview = content;
            chrome.tabs.sendMessage(tabs[0].id, {
                type: 'CONTENT_CACHE_UPDATED',
                hasContent: !!content,
                preview: preview,
                url: url,
                wordCount: content ? content.split(/\s+/).length : 0
            }, () => {
                if (chrome.runtime.lastError) {
                    // Control panel script may not be ready yet
                }
            });
        }
    });
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
        await chrome.tabs.create({ url: getServiceUrl(serviceKey), active: false });
    }
}

async function tileWindowsVertical(servicesToTile) {
    // Get the currently focused window to determine which screen to use
    const lastFocusedWindow = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });

    chrome.system.display.getInfo(async (displays) => {
        if (chrome.runtime.lastError) { console.error(chrome.runtime.lastError.message); return; }

        // Find the display that contains the current browser window
        const currentDisplay = lastFocusedWindow ? getDisplayForWindow(lastFocusedWindow, displays) : displays[0];
        const display = currentDisplay.workArea;

        // Close existing tiled windows first
        for (const windowId of tiledWindowIds) {
            try { await chrome.windows.remove(windowId); } catch (e) { /*ignore*/ }
        }
        tiledWindowIds.clear();

        // Filter out invalid services - only keep services defined in SERVICES config
        const filteredServices = servicesToTile.filter(service => {
            const isValid = typeof service === 'string' &&
                service.length > 0 &&
                service.length < 50 &&
                SERVICES.hasOwnProperty(service);
            if (!isValid) {
                console.warn(`[AIMultiChat] Filtering out invalid service: ${service}`);
            }
            return isValid;
        });

        if (filteredServices.length === 0) {
            console.warn('[AIMultiChat] No valid services to tile, using defaults');
            filteredServices.push('chatgpt', 'claude', 'gemini');
        }

        const displayId = currentDisplay.id;
        const screenWidth = display.width, screenHeight = display.height;
        const popupWidth = Math.floor(screenWidth / VERTICAL_POPUP_DIVISOR);
        const servicesAreaWidth = screenWidth - popupWidth;
        const numServices = filteredServices.length;
        const serviceWindowWidth = numServices > 0 ? Math.floor(servicesAreaWidth / numServices) : 0;
        if (popupWindowId) { try { await chrome.windows.remove(popupWindowId); } catch (e) { /*ignore*/ } popupWindowId = null; }
        const layoutState = {
            layout: 'vertical',
            services: [...filteredServices],
            displayId,
            windows: []
        };

        for (let i = 0; i < numServices; i++) {
            const serviceKey = filteredServices[i];
            const newWindow = await chrome.windows.create({ url: getServiceUrl(serviceKey), left: display.left + i * serviceWindowWidth, top: display.top, width: serviceWindowWidth, height: screenHeight });
            if (newWindow) {
                tiledWindowIds.add(newWindow.id);
                layoutState.windows.push({ windowId: newWindow.id, serviceKey });
            }
        }
        tiledLayoutState = layoutState;
        createPopupWindow({ left: display.left + servicesAreaWidth, top: display.top, width: popupWidth, height: screenHeight });
    });
}

async function tileWindowsBottom(servicesToTile) {
    // Get the currently focused window to determine which screen to use
    const lastFocusedWindow = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });

    chrome.system.display.getInfo(async (displays) => {
        if (chrome.runtime.lastError) { console.error(chrome.runtime.lastError.message); return; }

        // Find the display that contains the current browser window
        const currentDisplay = lastFocusedWindow ? getDisplayForWindow(lastFocusedWindow, displays) : displays[0];
        const display = currentDisplay.workArea;

        // Close existing tiled windows first
        for (const windowId of tiledWindowIds) {
            try { await chrome.windows.remove(windowId); } catch (e) { /*ignore*/ }
        }
        tiledWindowIds.clear();
        if (popupWindowId) { try { await chrome.windows.remove(popupWindowId); } catch (e) { /*ignore*/ } popupWindowId = null; }

        // Filter out invalid services - only keep services defined in SERVICES config
        const filteredServices = servicesToTile.filter(service => {
            const isValid = typeof service === 'string' &&
                service.length > 0 &&
                service.length < 50 &&
                SERVICES.hasOwnProperty(service);
            if (!isValid) {
                console.warn(`[AIMultiChat] Filtering out invalid service: ${service}`);
            }
            return isValid;
        });

        if (filteredServices.length === 0) {
            console.warn('[AIMultiChat] No valid services to tile, using defaults');
            filteredServices.push('chatgpt', 'claude', 'gemini');
        }

        const bottomPopupHeight = BOTTOM_POPUP_HEIGHT;
        const displayId = currentDisplay.id;
        const servicesAreaHeight = display.height - bottomPopupHeight;
        const numServices = filteredServices.length;
        const serviceWindowWidth = numServices > 0 ? Math.floor(display.width / numServices) : 0;
        const layoutState = {
            layout: 'bottom',
            services: [...filteredServices],
            displayId,
            windows: []
        };
        for (let i = 0; i < numServices; i++) {
            const serviceKey = filteredServices[i];
            const newWindow = await chrome.windows.create({ url: getServiceUrl(serviceKey), left: display.left + i * serviceWindowWidth, top: display.top, width: serviceWindowWidth, height: servicesAreaHeight });
            if (newWindow) {
                tiledWindowIds.add(newWindow.id);
                layoutState.windows.push({ windowId: newWindow.id, serviceKey });
            }
        }
        tiledLayoutState = layoutState;
        createPopupWindow({ url: 'src/popup/popup.html?layout=bottom', left: display.left, top: display.top + servicesAreaHeight, width: display.width, height: bottomPopupHeight });
    });
}

async function applyBottomLayout(workArea) {
    const entries = tiledLayoutState.windows;
    if (!entries.length) { return; }
    const servicesAreaHeight = Math.max(1, workArea.height - BOTTOM_POPUP_HEIGHT);
    const totalWidth = Math.max(1, workArea.width);
    const serviceWidth = Math.max(1, Math.floor(totalWidth / entries.length));

    for (let i = 0; i < entries.length; i++) {
        const left = workArea.left + i * serviceWidth;
        const width = i === entries.length - 1
            ? Math.max(1, totalWidth - (serviceWidth * i))
            : serviceWidth;
        await safeUpdateWindow(entries[i].windowId, {
            left,
            top: workArea.top,
            width,
            height: servicesAreaHeight,
            state: 'normal'
        });
    }

    if (popupWindowId) {
        await safeUpdateWindow(popupWindowId, {
            left: workArea.left,
            top: workArea.top + servicesAreaHeight,
            width: workArea.width,
            height: BOTTOM_POPUP_HEIGHT,
            state: 'normal'
        });
    }
}

async function applyVerticalLayout(workArea) {
    const entries = tiledLayoutState.windows;
    if (!entries.length) { return; }
    const screenWidth = Math.max(1, workArea.width);
    const screenHeight = Math.max(1, workArea.height);
    const popupWidth = Math.max(1, Math.floor(screenWidth / VERTICAL_POPUP_DIVISOR));
    const servicesAreaWidth = Math.max(1, screenWidth - popupWidth);
    const serviceWidth = Math.max(1, Math.floor(servicesAreaWidth / entries.length));

    for (let i = 0; i < entries.length; i++) {
        const left = workArea.left + i * serviceWidth;
        const width = i === entries.length - 1
            ? Math.max(1, servicesAreaWidth - serviceWidth * i)
            : serviceWidth;
        await safeUpdateWindow(entries[i].windowId, {
            left,
            top: workArea.top,
            width,
            height: screenHeight,
            state: 'normal'
        });
    }

    if (popupWindowId) {
        await safeUpdateWindow(popupWindowId, {
            left: workArea.left + servicesAreaWidth,
            top: workArea.top,
            width: popupWidth,
            height: screenHeight,
            state: 'normal'
        });
    }
}

async function raiseAndRetileTiledWindows() {
    if (!tiledLayoutState.layout || tiledLayoutState.windows.length === 0) {
        console.log('[AIMultiChat] No tiled layout to retile');
        return;
    }

    const displays = await getDisplaysAsync();
    if (displays.length === 0) {
        console.warn('[AIMultiChat] Unable to retile because no displays were returned');
        return;
    }

    const targetDisplay = displays.find(d => d.id === tiledLayoutState.displayId) || displays[0];
    if (!targetDisplay) {
        console.warn('[AIMultiChat] Unable to locate target display for retile');
        return;
    }

    tiledLayoutState.displayId = targetDisplay.id;
    const workArea = targetDisplay.workArea;

    for (const entry of tiledLayoutState.windows) {
        try {
            await chrome.windows.get(entry.windowId);
        } catch (error) {
            console.log('[AIMultiChat] Missing tiled window during retile, rebuilding layout');
            if (tiledLayoutState.layout === 'bottom') {
                tileWindowsBottom(tiledLayoutState.services);
            } else if (tiledLayoutState.layout === 'vertical') {
                tileWindowsVertical(tiledLayoutState.services);
            }
            return;
        }
    }

    if (tiledLayoutState.layout === 'bottom') {
        await applyBottomLayout(workArea);
    } else if (tiledLayoutState.layout === 'vertical') {
        await applyVerticalLayout(workArea);
    }
}

function getServiceUrl(serviceKey) {
    // Use SERVICES config to get proper URLs instead of guessing
    const serviceConfig = SERVICES[serviceKey];
    if (!serviceConfig) {
        console.warn(`[AIMultiChat] Unknown service: ${serviceKey}. Falling back to ChatGPT.`);
        return 'https://chatgpt.com/';
    }

    // Extract hostname from the regex pattern and construct URL
    const match = serviceConfig.match;
    let hostname;

    switch (serviceKey) {
        case 'chatgpt':
            hostname = 'chatgpt.com';
            break;
        case 'claude':
            hostname = 'claude.ai';
            return 'https://claude.ai/new'; // Claude needs the /new path
        case 'gemini':
            hostname = 'gemini.google.com';
            return 'https://gemini.google.com/app'; // Gemini needs the /app path
        case 'perplexity':
            hostname = 'perplexity.ai';
            break;
        case 'deepseek':
            hostname = 'chat.deepseek.com';
            break;
        case 'grok':
            hostname = 'grok.com';
            break;
        case 'zai':
            hostname = 'chat.z.ai';
            break;
        case 'qwen':
            hostname = 'chat.qwen.ai';
            break;
        case 'kimi':
            hostname = 'kimi.com';
            break;
        default:
            // Try to extract hostname from regex if possible
            const regexStr = match.toString();
            const hostMatch = regexStr.match(/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
            if (hostMatch) {
                hostname = hostMatch[1].replace(/\\\./g, '.');
            } else {
                console.warn(`[AIMultiChat] Could not determine URL for service: ${serviceKey}`);
                return 'https://chatgpt.com/';
            }
    }

    return `https://${hostname}/`;
}
