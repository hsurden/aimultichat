# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

This is a Chrome/Firefox browser extension with no build process - files are loaded directly:
- **Install Extension**: Load unpacked extension from this directory in Chrome/Firefox developer mode
- **Reload Extension**: Use browser extension reload button after code changes
- **No build/test commands available** - extension runs directly from source files

## Architecture Overview

### Extension Structure
This is a Manifest V3 browser extension that broadcasts prompts to multiple AI service tabs simultaneously. 
It also has a companion mode, as opposed to the multi-broadcast mode.  Companion mode is deisgned to sit to the right and watch the pages that the user is on as they browse the web so that they can ask any questions about the current web page without having to manually cut and paste the text.

The extension operates across three main contexts.

**Background Script (`src/background.js`)**
- Service worker managing tab registration and window tiling
- Handles message routing between popup and content scripts  
- Manages three display modes: multi-mode popup, tiled windows (vertical/bottom), and companion mode
- Tracks service tabs in `serviceTabs` object, window management in `tiledWindowIds` Set
- Companion mode creates resized browser windows with small control panel

**Content Scripts (`src/content/content.js` + `src/services-config-content.js`)**
- Injected into AI service pages (ChatGPT, Claude, Gemini, custom services)
- Service detection via hostname matching using regex patterns in SERVICES config
- Text injection into service input fields using CSS selectors  
- Send button automation and Enter key interception for companion mode
- Dynamic service configuration loading from Chrome storage

**Popup Interface (`src/popup/` directory)**
- Mode selection entry point (`mode-selection.html`) offering three modes
- Main popup (`popup.html`) with service selection, prompt input, status table  
- Settings page (`settings.html`) for service configuration and custom service creation
- Uses Choices.js library for multi-select dropdowns

### Service Configuration System
The extension supports both built-in and custom AI services:

**Built-in Services**: Defined in `src/services-config.js` (ES modules) and `src/services-config-content.js` (global scope)
- Each service has: label, hostname regex, input selectors, send button selectors, useEnter flag
- Content scripts use fallback selector arrays to handle UI changes

**Custom Services**: Complete service definitions stored in Chrome storage
- Users can add services like Perplexity, Deepseek via settings UI
- Custom services integrate fully with all extension features
- Configuration overrides stored separately from base service definitions

**Dynamic Configuration**: Service configs can be modified via settings and apply immediately
- Changes broadcast to all tabs via Chrome messaging
- Differential storage (only modifications from defaults stored)
- Export/import functionality for configuration backup

### Message Flow Architecture
- **REGISTER_SERVICE**: Content scripts announce service availability to background
- **BROADCAST_PROMPT**: Popup sends text to background → all registered service tabs
- **SERVICE_FEEDBACK**: Content scripts report success/failure back to popup  
- **UPDATE_SERVICE_CONFIG**: Settings changes propagated to content scripts
- **CUSTOM_SERVICES_UPDATED**: Notification to refresh UI when services added/removed

### Window Management
The extension manages browser windows for tiling modes:
- **Vertical Tiling**: Services in columns with popup on right (1/4 screen width)
- **Bottom Tiling**: Services across top with full-width popup at bottom
- **Companion Mode**: Single service + mini control panel, browser window resized
- Auto-retiling when services added/removed from selection
- Window close detection for cleanup and mode termination

### Key Implementation Details
- Service resolution happens on every page load via hostname matching
- Content scripts handle both contenteditable divs and textarea inputs
- ChatGPT-specific DOM handling for composer height constraints
- Companion mode intercepts Enter key before service handlers
- Real-time text syncing between popup and service inputs (non-companion mode)
- Status tracking with visual pills showing idle/pending/sent/error states

When modifying service configurations, always update both `services-config.js` and `services-config-content.js` to maintain consistency between popup and content script contexts.

## Adding a New AI Service

To add a new built-in AI service to the extension, you must update **4 files**:

### 1. Service Configuration Files (Required)
**File: `src/services-config.js`** - Add service config to SERVICES object:
```javascript
servicename: {
  label: "Service Name",
  match: /hostname\.domain\.com$/,
  inputSelectors: [
    '#input-id',
    'textarea[placeholder*="text"]',
    'div[contenteditable="true"]'
  ],
  sendButtonSelectors: [
    '#send-button-id',
    'button[type="submit"]',
    'button[aria-label*="Send"]'
  ],
  useEnter: true
}
```

**File: `src/services-config-content.js`** - Add identical config to DEFAULT_SERVICES object

### 2. Background Script URL Mapping (Required)
**File: `src/background.js`** - Add case to `getServiceUrl()` function (~line 1142):
```javascript
case 'servicename':
  hostname = 'hostname.domain.com';
  break;
```
Special cases may need custom paths (e.g., Claude needs `/new`, Gemini needs `/app`)

### 3. Content Script Permissions (Required)
**File: `manifest.json`** - Add URL pattern to content_scripts.matches array:
```json
"https://hostname.domain.com/*"
```

### 4. Service Detection Requirements
- **Hostname regex**: Must match the domain where the service runs
- **Input selectors**: Array of CSS selectors for text input fields (textarea, contenteditable divs)
- **Send button selectors**: Array of CSS selectors for submit buttons
- **useEnter flag**: Whether Enter key should trigger send (vs requiring button click)

The extension will automatically detect and register the service when users visit the configured hostname. Test thoroughly as AI service UIs change frequently.