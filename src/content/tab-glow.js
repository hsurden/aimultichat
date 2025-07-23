// Tab glow effect for companion mode
// This script adds a subtle glow around the page frame when companion mode is active

// Prevent duplicate injection
if (!window.aiMultiChatGlowInjected) {
    window.aiMultiChatGlowInjected = true;

let glowEnabled = false;
let glowElement = null;

function createGlowEffect() {
    if (glowElement) return; // Already exists
    
    // Create the glow overlay
    glowElement = document.createElement('div');
    glowElement.id = 'aimultichat-companion-glow';
    glowElement.style.cssText = `
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        pointer-events: none !important;
        z-index: 2147483647 !important;
        border: 3px solid rgba(59, 130, 246, 0.4) !important;
        box-shadow: 
            inset 0 0 20px rgba(59, 130, 246, 0.2),
            0 0 30px rgba(59, 130, 246, 0.3) !important;
        border-radius: 8px !important;
        animation: aimultichat-pulse 3s ease-in-out infinite !important;
        backdrop-filter: none !important;
        background: transparent !important;
    `;
    
    // Add keyframe animation
    if (!document.getElementById('aimultichat-glow-styles')) {
        const style = document.createElement('style');
        style.id = 'aimultichat-glow-styles';
        style.textContent = `
            @keyframes aimultichat-pulse {
                0%, 100% { 
                    border-color: rgba(59, 130, 246, 0.4);
                    box-shadow: 
                        inset 0 0 20px rgba(59, 130, 246, 0.2),
                        0 0 30px rgba(59, 130, 246, 0.3);
                }
                50% { 
                    border-color: rgba(59, 130, 246, 0.6);
                    box-shadow: 
                        inset 0 0 30px rgba(59, 130, 246, 0.3),
                        0 0 40px rgba(59, 130, 246, 0.4);
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    document.body.appendChild(glowElement);
}

function removeGlowEffect() {
    if (glowElement) {
        glowElement.remove();
        glowElement = null;
    }
    
    const styles = document.getElementById('aimultichat-glow-styles');
    if (styles) {
        styles.remove();
    }
}

function enableGlow() {
    if (!glowEnabled) {
        glowEnabled = true;
        createGlowEffect();
        console.log('[AIMultiChat] Tab glow effect enabled');
    }
}

function disableGlow() {
    if (glowEnabled) {
        glowEnabled = false;
        removeGlowEffect();
        console.log('[AIMultiChat] Tab glow effect disabled');
    }
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'ENABLE_TAB_GLOW') {
        enableGlow();
        sendResponse({ success: true });
    } else if (message.type === 'DISABLE_TAB_GLOW') {
        disableGlow();
        sendResponse({ success: true });
    }
});

// Clean up when page unloads
window.addEventListener('beforeunload', () => {
    disableGlow();
});

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
    if (document.hidden && glowEnabled) {
        // Fade out glow when tab becomes inactive
        if (glowElement) {
            glowElement.style.opacity = '0.3';
        }
    } else if (!document.hidden && glowEnabled) {
        // Restore glow when tab becomes active
        if (glowElement) {
            glowElement.style.opacity = '1';
        }
    }
});

} // End of duplicate injection check