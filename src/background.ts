/// <reference types="chrome" />

interface TabState {
  detected: boolean;
  count: number;
  active: boolean;
}

const tabs = new Map<number, TabState>();

const ICONS = {
  active: {
    "16": "icons/active-16.png",
    "32": "icons/active-32.png",
    "48": "icons/active-48.png",
    "128": "icons/active-128.png",
  },
  inactive: {
    "16": "icons/inactive-16.png",
    "32": "icons/inactive-32.png",
    "48": "icons/inactive-48.png",
    "128": "icons/inactive-128.png",
  },
} as const;

function getState(tabId: number): TabState {
  let state = tabs.get(tabId);
  if (!state) {
    state = { detected: false, count: 0, active: false };
    tabs.set(tabId, state);
  }
  return state;
}

async function applyIcon(tabId: number, detected: boolean): Promise<void> {
  try {
    await chrome.action.setIcon({
      tabId,
      path: detected ? ICONS.active : ICONS.inactive,
    });
  } catch {
    // Tab might have closed; ignore.
  }
}

async function applyTitle(tabId: number, state: TabState): Promise<void> {
  const title = state.detected
    ? `where it's at — ${state.count} atproto reference${state.count === 1 ? "" : "s"} found`
    : "where it's at — no atproto references on this page";
  try {
    await chrome.action.setTitle({ tabId, title });
  } catch {
    // ignore
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") return false;
  const state = getState(tabId);

  if (message?.type === "scan-result") {
    state.count = Number(message.count) || 0;
    state.detected = state.count > 0;
    void applyIcon(tabId, state.detected);
    void applyTitle(tabId, state);
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "open" && typeof message.uri === "string") {
    void chrome.tabs.create({
      url: `https://pdsls.dev/${message.uri}`,
      active: true,
    });
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "deactivate") {
    state.active = false;
    void chrome.tabs
      .sendMessage(tabId, { type: "deactivate" })
      .catch(() => undefined);
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

chrome.action.onClicked.addListener((tab) => {
  if (typeof tab.id !== "number") return;
  const state = getState(tab.id);
  state.active = !state.active;
  void chrome.tabs
    .sendMessage(tab.id, { type: state.active ? "activate" : "deactivate" })
    .catch(() => {
      // No content script (e.g. chrome://, about:, the Web Store).
      state.active = false;
    });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabs.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading") {
    tabs.delete(tabId);
    void applyIcon(tabId, false);
  }
});
