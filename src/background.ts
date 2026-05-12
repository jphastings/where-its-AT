/// <reference types="chrome" />

import { loadAction, resolveAction, visitLabel } from "./config";

interface TabState {
  detected: boolean;
  count: number;
  engaged: boolean;
}

const tabs = new Map<number, TabState>();

const MENU_PARENT_ID = "wia-parent";
const MENU_VISIT_ID = "wia-visit";
const MENU_COPY_ID = "wia-copy";
const MENU_CONTEXTS: NonNullable<chrome.contextMenus.CreateProperties["contexts"]> = [
  "page",
  "link",
  "selection",
  "image",
  "video",
  "audio",
];

let currentAtUri: string | null = null;
let currentVisitUrl: string | null = null;
let currentTabId: number | null = null;
let clickedListenerRegistered = false;
let shownListenerRegistered = false;

const ICONS = {
  inactive: {
    "16": "icons/inactive-16.png",
    "32": "icons/inactive-32.png",
    "48": "icons/inactive-48.png",
    "128": "icons/inactive-128.png",
  },
  detected: {
    "16": "icons/detected-16.png",
    "32": "icons/detected-32.png",
    "48": "icons/detected-48.png",
    "128": "icons/detected-128.png",
  },
  engaged: {
    "16": "icons/engaged-16.png",
    "32": "icons/engaged-32.png",
    "48": "icons/engaged-48.png",
    "128": "icons/engaged-128.png",
  },
} as const;

type IconPaths = (typeof ICONS)[keyof typeof ICONS];
type IconName = keyof typeof ICONS;

function getState(tabId: number): TabState {
  let state = tabs.get(tabId);
  if (!state) {
    state = { detected: false, count: 0, engaged: false };
    tabs.set(tabId, state);
  }
  return state;
}

function pickIconName(state: TabState): IconName {
  if (state.engaged) return "engaged";
  if (state.detected) return "detected";
  return "inactive";
}

function pickIcon(state: TabState): IconPaths {
  return ICONS[pickIconName(state)];
}

function pickTitle(state: TabState): string {
  if (state.engaged) {
    return `Where it's AT — overlay active (${state.count} reference${state.count === 1 ? "" : "s"})`;
  }
  if (state.detected) {
    return `Where it's AT — ${state.count} atproto reference${state.count === 1 ? "" : "s"} found`;
  }
  return "Where it's AT — no atproto references on this page";
}

// chrome.action.setIcon({ path }) in Chrome MV3 service workers resolves paths
// relative to the service worker's own URL rather than the extension root,
// so the asset never loads when the SW lives in a subdirectory. Side-stepping
// that by fetching the PNGs ourselves and handing setIcon ImageData. Cached
// so each variant is only decoded once.
const imageDataCache = new Map<string, ImageData>();

async function loadImageData(relativePath: string): Promise<ImageData> {
  const cached = imageDataCache.get(relativePath);
  if (cached) return cached;
  const url = chrome.runtime.getURL(relativePath);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetch ${url} → ${response.status}`);
  }
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("OffscreenCanvas 2D context unavailable");
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  imageDataCache.set(relativePath, data);
  return data;
}

async function getIconImageData(
  name: IconName,
): Promise<Record<string, ImageData>> {
  const paths = ICONS[name];
  const entries = await Promise.all(
    Object.entries(paths).map(async ([size, path]) => {
      const data = await loadImageData(path);
      return [size, data] as const;
    }),
  );
  return Object.fromEntries(entries);
}

async function refresh(tabId: number): Promise<void> {
  const state = getState(tabId);
  const iconName = pickIconName(state);
  try {
    const imageData = await getIconImageData(iconName);
    await Promise.all([
      chrome.action.setIcon({ tabId, imageData }),
      chrome.action.setTitle({ tabId, title: pickTitle(state) }),
    ]);
  } catch (err) {
    console.warn(`[where-its-at] refresh failed for tab=${tabId}:`, err);
  }
}

// Chrome exposes the API as chrome.contextMenus; Firefox exposes it as
// chrome.menus (the canonical WebExtensions name). We grab whichever exists
// so the rest of the file can be browser-agnostic. Both browsers share the
// same shape for the calls we use (create/update/removeAll/onClicked).
type MenusApi = typeof chrome.contextMenus & {
  refresh?: () => void;
  onShown?: chrome.events.Event<() => void>;
};
const menusApi: MenusApi | undefined =
  (chrome.contextMenus as MenusApi | undefined) ??
  (chrome as unknown as { menus?: MenusApi }).menus;

// Firefox-only; refresh re-renders an open menu so updates made inside the
// onShown handler appear in the current display.
function refreshMenu(): void {
  if (!menusApi?.refresh) return;
  try {
    menusApi.refresh();
  } catch {
    // ignore
  }
}

function onContextMenuClicked(info: chrome.contextMenus.OnClickData): void {
  if (info.menuItemId === MENU_COPY_ID) {
    if (currentAtUri && currentTabId != null) {
      void chrome.tabs
        .sendMessage(currentTabId, { type: "copy-uri", uri: currentAtUri })
        .catch(() => undefined);
    }
    return;
  }
  if (info.menuItemId === MENU_VISIT_ID) {
    if (currentVisitUrl) {
      void chrome.tabs.create({ url: currentVisitUrl, active: true });
    }
  }
}

async function setupContextMenus(): Promise<void> {
  if (!menusApi) return;
  // Chrome auto-groups multiple items from one extension under a submenu
  // named after the extension, with the extension's icon next to it. Firefox
  // doesn't auto-group, so we create the parent ourselves. Doing it
  // unconditionally gives both browsers the same shape ("Where it's AT" →
  // Visit … / Copy …). Firefox additionally supports a per-item `icons` key
  // (Chrome's type forbids it), which we set on the parent only.
  const parentIcons: { icons?: Record<string, string> } = menusApi.onShown
    ? { icons: { "16": "icons/detected-16.png", "32": "icons/detected-32.png" } }
    : {};
  try {
    await new Promise<void>((resolve) => menusApi.removeAll(resolve));
    menusApi.create({
      id: MENU_PARENT_ID,
      title: "Where it's AT",
      contexts: MENU_CONTEXTS,
      visible: false,
      ...parentIcons,
    });
    menusApi.create({
      id: MENU_VISIT_ID,
      parentId: MENU_PARENT_ID,
      title: "Visit",
      contexts: MENU_CONTEXTS,
      visible: false,
    });
    menusApi.create({
      id: MENU_COPY_ID,
      parentId: MENU_PARENT_ID,
      title: "Copy AT URI",
      contexts: MENU_CONTEXTS,
      visible: false,
    });
  } catch (err) {
    console.warn("[where-its-at] setupContextMenus failed:", err);
    return;
  }
  if (!clickedListenerRegistered) {
    menusApi.onClicked.addListener(onContextMenuClicked);
    clickedListenerRegistered = true;
  }
  // Firefox exposes menus.onShown so we can refresh the menu just before it
  // displays — belt-and-braces against the async-update race on first show.
  if (menusApi.onShown && !shownListenerRegistered) {
    menusApi.onShown.addListener(refreshMenu);
    shownListenerRegistered = true;
  }
}

async function applyContextTarget(
  atUri: string | null,
  tabId: number | null,
): Promise<void> {
  if (!menusApi) return;
  try {
    if (!atUri) {
      currentAtUri = null;
      currentVisitUrl = null;
      currentTabId = null;
      menusApi.update(MENU_PARENT_ID, { visible: false });
      menusApi.update(MENU_VISIT_ID, { visible: false });
      menusApi.update(MENU_COPY_ID, { visible: false });
      refreshMenu();
      return;
    }
    const action = await loadAction();
    const resolved = resolveAction(action, atUri);
    const label = visitLabel(action);
    currentAtUri = atUri;
    currentTabId = tabId;
    menusApi.update(MENU_PARENT_ID, { visible: true });
    if (resolved.kind === "url") {
      currentVisitUrl = resolved.url;
      menusApi.update(MENU_VISIT_ID, {
        visible: true,
        title: label ?? "Visit",
      });
    } else {
      currentVisitUrl = null;
      menusApi.update(MENU_VISIT_ID, { visible: false });
    }
    menusApi.update(MENU_COPY_ID, { visible: true });
    refreshMenu();
  } catch (err) {
    console.warn("[where-its-at] applyContextTarget failed:", err);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") {
    console.warn("[where-its-at] ignoring message without tabId:", message);
    return false;
  }
  const state = getState(tabId);

  if (message?.type === "scan-result") {
    state.count = Number(message.count) || 0;
    state.detected = state.count > 0;
    if (!state.detected) state.engaged = false;
    void refresh(tabId);
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "open" && typeof message.url === "string") {
    void chrome.tabs.create({ url: message.url, active: true });
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "deactivate") {
    state.engaged = false;
    void chrome.tabs
      .sendMessage(tabId, { type: "deactivate" })
      .catch(() => undefined);
    void refresh(tabId);
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "context-target") {
    const atUri = typeof message.atUri === "string" ? message.atUri : null;
    void applyContextTarget(atUri, tabId);
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

chrome.action.onClicked.addListener((tab) => {
  if (typeof tab.id !== "number") return;
  const tabId = tab.id;
  const state = getState(tabId);

  if (state.engaged) {
    state.engaged = false;
    void chrome.tabs
      .sendMessage(tabId, { type: "deactivate" })
      .catch(() => undefined);
  } else if (state.detected) {
    state.engaged = true;
    void chrome.tabs.sendMessage(tabId, { type: "activate" }).catch(() => {
      state.engaged = false;
      void refresh(tabId);
    });
  }
  // No-op when nothing is detected.
  void refresh(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabs.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading") {
    tabs.delete(tabId);
    void refresh(tabId);
  }
});

// After install or extension reload, content scripts that were already running
// in open tabs are orphaned (their chrome.runtime context has been invalidated),
// so they can no longer send us scan results. Inject a fresh copy into every
// eligible existing tab so the icon updates without needing a page reload.
async function reinjectExistingTabs(): Promise<void> {
  const allTabs = await chrome.tabs.query({});
  await Promise.all(
    allTabs.map(async (tab) => {
      if (typeof tab.id !== "number" || !tab.url) return;
      if (!/^https?:|^file:/.test(tab.url)) return;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: false },
          files: ["src/content.js"],
        });
      } catch {
        // Some pages (chrome.google.com/webstore, view-source:, the Web Store,
        // PDF viewer, etc.) refuse injection; that's expected.
      }
    }),
  );
}

chrome.runtime.onInstalled.addListener(() => {
  void reinjectExistingTabs();
});

void setupContextMenus();
