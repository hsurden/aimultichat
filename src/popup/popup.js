// popup.js

// only import your own config as a true ES module
import { SERVICES } from '../services-config.js';

window.addEventListener('DOMContentLoaded', async () => {
  // --- Element references ---
  const servicesSelect         = document.getElementById('servicesSelect');
  const statusBody             = document.getElementById('statusBody');
  const promptEl               = document.getElementById('prompt');
  const sendButton             = document.getElementById('send');
  const getContentButton       = document.getElementById('getContent');
  const companionButton        = document.getElementById('companionMode');
  const statusDetails          = document.getElementById('status-details');
  const tilingOptions          = document.getElementById('tilingOptions');
  const bottomBroadcastButton  = document.getElementById('bottomBroadcast');
  const bottomGetContentButton = document.getElementById('bottomGetContent');
  const replayButton           = document.getElementById('replay');
  const openAllButton          = document.getElementById('openAll');

  // --- Internal state ---
  const state = {
    targets: new Set(),
    serviceStatuses: {},
    isBottomMode: false,
    isInTileMode: false,
    currentTileLayout: null // 'vertical' or 'bottom'
  };

  // --- Initialize Choices on the <select> (global Choices must already be loaded) ---
  const choices = new window.Choices(servicesSelect, {
    removeItemButton: true,
    placeholder: true,
    placeholderValue: 'Select AI services',
    noChoicesText: 'All Available AI serivices have been selected',
    searchEnabled: false,
    shouldSort: true,
  });

  // Function to populate dropdown with all services (including custom ones)
  async function populateServiceChoices() {
    // Get custom services from storage
    const result = await chrome.storage.local.get(['customServices']);
    const customServices = result.customServices || {};
    
    // Combine default and custom services
    const allServices = { ...SERVICES, ...customServices };
    
    const serviceChoices = Object.entries(allServices).map(([key, svc]) => ({
      value: key,
      label: svc.label
    }));
    
    choices.setChoices(serviceChoices, 'value', 'label', true); // true to replace existing choices
  }
  
  // Populate dropdown initially
  await populateServiceChoices();

  // when selection changes, sync into state.targets
  servicesSelect.addEventListener('change', () => {
    const previousTargets = new Set(state.targets);
    state.targets.clear();
    choices.getValue(true).forEach(v => state.targets.add(v));
    
    // Ensure at least one service remains selected
    if (state.targets.size === 0 && previousTargets.size > 0) {
      // Restore the first previous target
      const firstPrevious = Array.from(previousTargets)[0];
      state.targets.add(firstPrevious);
      choices.setChoiceByValue([firstPrevious]);
    }
    
    chrome.storage.local.set({ checkedServices: [...state.targets] });
    updateCompanionButtonState();
    updateTilingOptionsState();
    renderStatusTable();
    
    // Auto-retile if we're currently in tiling mode and targets changed
    if (state.isInTileMode && state.currentTileLayout && !setsEqual(previousTargets, state.targets)) {
      handleAutoRetile();
    }
  });

  // --- UI helpers ---
  function setsEqual(setA, setB) {
    return setA.size === setB.size && [...setA].every(x => setB.has(x));
  }

  function handleAutoRetile() {
    if (!state.isInTileMode || !state.currentTileLayout) return;
    
    chrome.runtime.sendMessage({
      type: 'AUTO_RETILE',
      targets: [...state.targets],
      layout: state.currentTileLayout
    });
  }

  function updateCompanionButtonState() {
    if (companionButton) companionButton.disabled = state.targets.size !== 1;
  }

  function updateTilingOptionsState() {
    if (tilingOptions) tilingOptions.disabled = state.targets.size === 0;
  }

  async function renderStatusTable() {
    if (!statusBody) return;
    statusBody.innerHTML = '';
    
    // Get all services (default + custom)
    const result = await chrome.storage.local.get(['customServices']);
    const customServices = result.customServices || {};
    const allServices = { ...SERVICES, ...customServices };
    
    for (const key of Object.keys(allServices)) {
      const info = state.serviceStatuses[key] || { tabs: [], status: 'idle' };
      const row       = document.createElement('tr');
      const svcCell   = document.createElement('td');
      const tabsCell  = document.createElement('td');
      const statusCell= document.createElement('td');
      const pill      = document.createElement('span');

      svcCell.textContent  = allServices[key].label;
      tabsCell.textContent = info.tabs.length ? info.tabs.join(', ') : '–';

      pill.className = 'status-pill';
      pill.textContent = info.status;
      if (info.status === 'sent')  pill.classList.add('status-sent');
      if (info.status === 'error') pill.classList.add('status-error');
      if (!state.targets.has(key)) pill.style.opacity = '0.4';

      statusCell.appendChild(pill);
      row.append(svcCell, tabsCell, statusCell);
      statusBody.appendChild(row);
    }
  }

  function updateStateWithStatus(services) {
    for (const [svc, tabs] of Object.entries(services)) {
      if (!state.serviceStatuses[svc]) {
        state.serviceStatuses[svc] = { tabs: [], status: 'idle' };
      }
      state.serviceStatuses[svc].tabs = tabs;
    }
    renderStatusTable();
  }

  // --- Background message listener ---
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === 'STATUS_UPDATE' && msg.status) {
      updateStateWithStatus(msg.status.services);
    }
    if (msg.type === 'SERVICE_FEEDBACK') {
      state.serviceStatuses[msg.service] ??= { tabs: [], status: 'idle' };
      state.serviceStatuses[msg.service].status = msg.status;
      renderStatusTable();
    }
    if (msg.type === 'GET_PAGE_CONTENT_FROM_ICON' && getContentButton) {
      getContentButton.click();
    }
    if (msg.type === 'PASTE_CONTEXT') {
      const block = `"""\n${msg.text.trim()}\n"""\n\n`;
      promptEl.value = block;
      promptEl.dispatchEvent(new Event('input', { bubbles: true }));
      promptEl.focus();
      promptEl.selectionStart = promptEl.selectionEnd = promptEl.value.length;
    }
    if (msg.type === 'TILING_MODE_ENDED') {
      state.isInTileMode = false;
      state.currentTileLayout = null;
    }
    if (msg.type === 'CUSTOM_SERVICES_UPDATED') {
      // Refresh the service dropdown and status table
      populateServiceChoices().then(() => renderStatusTable());
    }
  });

  // --- Action handlers ---
  const handleBroadcast = () => {
    const text = promptEl.value.trim();
    if (!text) return;
    for (const svc of state.targets) {
      state.serviceStatuses[svc] = state.serviceStatuses[svc] || { tabs: [], status: 'idle' };
      state.serviceStatuses[svc].status = 'pending';
    }
    renderStatusTable();
    chrome.runtime.sendMessage({
      type: 'BROADCAST_PROMPT',
      text,
      targets: [...state.targets]
    });
  };

  const handleGetContent = async () => {
    const allTabs      = await chrome.tabs.query({});
    const extensionUrl = chrome.runtime.getURL('');
    const webTabs      = allTabs.filter(t =>
      t.url && t.url.startsWith('http') && !t.url.startsWith(extensionUrl)
    );
    if (!webTabs.length) return alert('No web page tab found.');
    webTabs.sort((a, b) => b.lastAccessed - a.lastAccessed);
    const targetTab = webTabs[0];

    try {
      const frames = await chrome.webNavigation.getAllFrames({ tabId: targetTab.id });
      const results = await chrome.scripting.executeScript({
        target: { tabId: targetTab.id, frameIds: frames.map(f => f.frameId) },
        func: () => document.body?.innerText
      });
      const pageText = results.map(r => r.result).filter(t => t && t.trim()).join('\n\n---\n\n');
      if (!pageText) return alert('No text content found on the page.');

      const block = `Current webpage content """\n${pageText.trim()}\n"""\n\n`;
      promptEl.value = block;
      promptEl.dispatchEvent(new Event('input', { bubbles: true }));
      promptEl.focus();
      promptEl.selectionStart = promptEl.selectionEnd = promptEl.value.length;
    } catch (e) {
      console.error('Injection error:', e);
      alert('Could not retrieve content from the target tab.');
    }
  };

  // --- Wire up buttons & inputs ---
  sendButton             && (sendButton.onclick              = handleBroadcast);
  bottomBroadcastButton  && (bottomBroadcastButton.onclick   = handleBroadcast);
  getContentButton       && (getContentButton.onclick        = handleGetContent);
  bottomGetContentButton && (bottomGetContentButton.onclick  = handleGetContent);
  replayButton           && (replayButton.onclick           = () => {
    chrome.runtime.sendMessage({
      type: 'REPLAY_LAST',
      targets: [...state.targets]
    }, resp => {
      if (chrome.runtime.lastError) console.error(chrome.runtime.lastError);
      else if (resp && !resp.ok)      alert(resp.error);
    });
  });
  openAllButton          && (openAllButton.onclick          = () => {
    const sel            = tilingOptions?.value || 'none';
    const shouldTile     = sel === 'right' || sel === 'bottom';
    const isBottomLayout = sel === 'bottom';
    
    // Track tiling state
    state.isInTileMode = shouldTile;
    state.currentTileLayout = shouldTile ? (isBottomLayout ? 'bottom' : 'vertical') : null;
    
    chrome.runtime.sendMessage({
      type: 'OPEN_SERVICES',
      targets: [...state.targets],
      shouldTile,
      isBottomLayout
    });
  });
  companionButton        && (companionButton.onclick        = () => {
    if (state.targets.size === 1) {
      const [svc] = state.targets;
      chrome.runtime.sendMessage({
        type: 'START_COMPANION_MODE',
        service: svc
      });
    }
  });
  promptEl && (promptEl.addEventListener('input', e => {
    chrome.runtime.sendMessage({
      type: 'SYNC_PROMPT_TEXT',
      text: e.target.value,
      targets: [...state.targets]
    });
  }));
  promptEl && (promptEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendButton?.click();
    }
  }));
  tilingOptions && (tilingOptions.onchange = () => {
    chrome.storage.local.set({ tilingPreference: tilingOptions.value });
  });
  statusDetails && (statusDetails.addEventListener('toggle', () => {
    chrome.storage.local.set({ statusOpen: statusDetails.open });
  }));

  // --- Initialization ---
  (async function initialize() {
    const prefs = await chrome.storage.local.get([
      'checkedServices',
      'tilingPreference',
      'statusOpen',
      'currentPromptText'
    ]);

    // restore services
    if (prefs.checkedServices) {
      state.targets = new Set(prefs.checkedServices);
      choices.setChoiceByValue(prefs.checkedServices);
    } else {
      // Default to only original three services
      state.targets = new Set(['chatgpt','claude','gemini']);
      chrome.storage.local.set({ checkedServices: [...state.targets] });
      choices.setChoiceByValue([...state.targets]);
    }

    // restore other prefs
    prefs.tilingPreference && (tilingOptions.value = prefs.tilingPreference);
    prefs.statusOpen       && (statusDetails.open    = true);
    prefs.currentPromptText && (promptEl.value        = prefs.currentPromptText);

    // bottom‐mode?
    if (new URLSearchParams(window.location.search).get('layout') === 'bottom') {
      document.body.classList.add('bottom-mode');
      state.isBottomMode = true;
      state.isInTileMode = true;
      state.currentTileLayout = 'bottom';
    }

    renderStatusTable();
    updateCompanionButtonState();
    updateTilingOptionsState();

    // fetch latest statuses from background
    chrome.runtime.sendMessage({ type: 'REQUEST_STATUS' });
  })();
});
