document.addEventListener('DOMContentLoaded', () => {
    // Handle menu item clicks
    document.querySelectorAll('.menu-item').forEach(button => {
        button.addEventListener('click', () => {
            const mode = button.dataset.mode;
            handleModeSelection(mode);
        });
    });
});

function handleModeSelection(mode) {
    // Send message to background script to handle the mode
    chrome.runtime.sendMessage({
        type: 'START_MODE',
        mode: mode
    }, (response) => {
        // Check for chrome.runtime.lastError
        if (chrome.runtime.lastError) {
            console.error('[AIMultiChat] Runtime error:', chrome.runtime.lastError.message);
            // Still close the popup even if there was an error
            window.close();
        } else {
            // Close the popup
            window.close();
        }
    });
}