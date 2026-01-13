# AI Multi-Broadcast 🚀

> Send one prompt, get answers from multiple AI services simultaneously

Stop copy-pasting the same prompt across ChatGPT, Claude, Gemini, and other AI services. AI Multi-Broadcast is a browser extension that broadcasts your prompts to multiple AI services at once, letting you compare responses side-by-side instantly.

## ✨ Features

### 🎯 Three Powerful Modes

**Multi-Broadcast Mode**
- Send prompts to multiple AI services simultaneously
- Auto-tile windows for easy comparison
- Real-time status tracking for each service
- Support for 15+ AI services out of the box

**Companion Mode**
- AI assistant that follows you as you browse
- Ask questions about any webpage instantly
- No more copy-pasting web content
- Floating control panel that stays out of your way

**Custom Services**
- Add any AI service via the settings page
- Configure input selectors and send buttons
- Export/import your custom configurations
- Full integration with all extension features

### 🤖 Supported AI Services

- **ChatGPT** (OpenAI)
- **Claude** (Anthropic)
- **Gemini** (Google)
- **Perplexity AI**
- **DeepSeek**
- **Grok** (X.AI)
- **Kimi**
- **Qwen**
- **Microsoft Copilot**
- **You.com**
- **Phind**
- **Poe**
- **Character.AI**
- **...and more via custom services!**

### 🎨 Smart Features

- **Window Tiling**: Automatically arranges AI service tabs in vertical or horizontal layouts
- **Status Tracking**: Visual indicators show which services received your prompt successfully
- **Keyboard Shortcuts**: `Alt+Shift+Y` to re-broadcast your last prompt
- **Text Selection**: Right-click any selected text to broadcast it instantly
- **File Upload**: Upload files and discuss them across multiple AI services
- **Persistent Settings**: Your service selections and preferences are saved

## 🚀 Installation

### From Source (Chrome/Firefox)

1. Clone this repository:
   ```bash
   git clone https://github.com/hsurden/aimultichat.git
   cd aimultichat
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Load the extension in your browser:

   **Chrome:**
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `aimultichat` folder

   **Firefox:**
   - Open `about:debugging#/runtime/this-firefox`
   - Click "Load Temporary Add-on"
   - Select any file in the `aimultichat` folder

## 📖 How to Use

### Multi-Broadcast Mode

1. Click the extension icon and select "Multi-Broadcast Mode"
2. Check the AI services you want to use
3. Choose your preferred window layout (Vertical/Bottom)
4. Type your prompt and click "Broadcast to Selected Services"
5. Watch as your prompt is sent to all selected services simultaneously

### Companion Mode

1. Click the extension icon and select "Companion Mode"
2. Choose your preferred AI service
3. A small control panel appears that follows you as you browse
4. Ask questions about any webpage you're viewing
5. The AI can see and understand the current page content

### Adding Custom Services

1. Click the extension icon and go to Settings
2. Scroll to "Add Custom Service"
3. Enter the service details:
   - Service name
   - Website hostname (e.g., `example.ai`)
   - CSS selector for input field
   - CSS selector for send button
4. Save and start using your custom service immediately

## 🛠️ Technical Details

This is a Manifest V3 browser extension built with vanilla JavaScript. No build process required - all files run directly from source.

**Key Components:**
- `background.js` - Service worker managing tab registration and window tiling
- `content.js` - Content scripts injected into AI service pages
- `popup.js` - User interface for service selection and prompt input
- `services-config.js` - Configuration for supported AI services

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

- **Add new AI services**: Update `services-config.js` and `manifest.json`
- **Report bugs**: Open an issue with details and reproduction steps
- **Suggest features**: Share your ideas in the issues section
- **Improve documentation**: Help make the README even better

## 📋 Roadmap

- [ ] Chrome Web Store publication
- [ ] Firefox Add-ons publication
- [ ] Response comparison view
- [ ] Export conversation history
- [ ] Prompt templates library
- [ ] Dark mode support

## 📄 License

ISC License - see LICENSE file for details

## 🙏 Acknowledgments

Built with:
- [Choices.js](https://github.com/Choices-js/Choices) - Multi-select dropdowns
- Love for AI and productivity tools

---

**Made with ❤️ by developers who got tired of copy-pasting prompts**

Star ⭐ this repo if you find it useful!