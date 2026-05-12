/// <reference types="chrome" />

import { loadAction, resolveAction } from "./config";

interface DetectedItem {
  el: Element;
  atUri: string;
}

interface State {
  active: boolean;
  items: DetectedItem[];
  overlay: HTMLDivElement | null;
  zones: HTMLDivElement | null;
  tooltip: HTMLDivElement | null;
  hoveredZone: HTMLDivElement | null;
}

const STATE: State = {
  active: false,
  items: [],
  overlay: null,
  zones: null,
  tooltip: null,
  hoveredZone: null,
};

const OVERLAY_ID = "__wia-overlay";
const ZONES_ID = "__wia-zones";
const TOOLTIP_ID = "__wia-tooltip";
const STYLE_ID = "__wia-style";

const SELECTORS = [
  '[typeof~="schema:Thing"][resource^="at://"]',
  '[typeof~="schema:Person"][resource^="did:plc:"]',
  '[typeof~="schema:Person"][resource^="did:web:"]',
  '[href^="at://"]',
];

function deriveAtUri(el: Element): string | null {
  const resource = el.getAttribute("resource");
  const href = el.getAttribute("href");
  const typeofAttr = (el.getAttribute("typeof") ?? "").split(/\s+/);

  if (resource?.startsWith("at://")) {
    return resource;
  }
  if (
    typeofAttr.includes("schema:Person") &&
    resource &&
    (resource.startsWith("did:plc:") || resource.startsWith("did:web:"))
  ) {
    return `at://${resource}`;
  }
  if (href?.startsWith("at://")) {
    return href;
  }
  return null;
}

function findItems(): DetectedItem[] {
  const seen = new Set<Element>();
  const items: DetectedItem[] = [];
  for (const selector of SELECTORS) {
    document.querySelectorAll(selector).forEach((el) => {
      if (seen.has(el)) return;
      const atUri = deriveAtUri(el);
      if (!atUri) return;
      seen.add(el);
      items.push({ el, atUri });
    });
  }
  return items;
}

function sendScanResult(count: number): void {
  console.log(`[where-its-at] content scan: ${count} reference(s)`);
  try {
    chrome.runtime
      .sendMessage({ type: "scan-result", count })
      .then((response) => {
        console.log(`[where-its-at] background ack:`, response);
      })
      .catch((err) => {
        console.warn(
          "[where-its-at] sendMessage rejected — background never replied:",
          err,
        );
      });
  } catch (err) {
    // The extension may have been reloaded; the runtime is then invalidated.
    console.warn("[where-its-at] sendMessage threw:", err);
  }
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = OVERLAY_CSS;
  (document.head ?? document.documentElement).appendChild(style);
}

function createOverlay(): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.innerHTML = `
    <svg width="100%" height="100%" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <mask id="__wia-mask" maskUnits="userSpaceOnUse">
          <rect x="0" y="0" width="100%" height="100%" fill="white"/>
          <g id="__wia-cutouts"></g>
        </mask>
      </defs>
      <rect x="0" y="0" width="100%" height="100%" fill="var(--wia-overlay-color)" mask="url(#__wia-mask)"/>
    </svg>
  `;
  return overlay;
}

function createZones(): HTMLDivElement {
  const zones = document.createElement("div");
  zones.id = ZONES_ID;
  return zones;
}

function createTooltip(): HTMLDivElement {
  const tooltip = document.createElement("div");
  tooltip.id = TOOLTIP_ID;
  tooltip.hidden = true;
  return tooltip;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function updateLayout(): void {
  if (!STATE.active || !STATE.overlay || !STATE.zones) return;

  const cutouts = STATE.overlay.querySelector("#__wia-cutouts");
  const zonesEl = STATE.zones;
  if (!cutouts) return;

  // Remove old zones; rebuild fresh each pass keeps DOM order tied to items.
  while (zonesEl.firstChild) zonesEl.removeChild(zonesEl.firstChild);

  const PADDING = 4;
  const RADIUS = 6;
  const fragments: string[] = [];

  STATE.items.forEach((item, index) => {
    const rect = item.el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const x = rect.left - PADDING;
    const y = rect.top - PADDING;
    const w = rect.width + PADDING * 2;
    const h = rect.height + PADDING * 2;

    fragments.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${RADIUS}" ry="${RADIUS}" fill="black"/>`,
    );

    const zone = document.createElement("div");
    zone.className = "__wia-zone";
    zone.dataset.uri = item.atUri;
    zone.dataset.index = String(index);
    zone.style.left = `${x}px`;
    zone.style.top = `${y}px`;
    zone.style.width = `${w}px`;
    zone.style.height = `${h}px`;
    zone.style.borderRadius = `${RADIUS}px`;
    zonesEl.appendChild(zone);
  });

  cutouts.innerHTML = fragments.join("");
}

function positionTooltip(zone: HTMLDivElement): void {
  const tooltip = STATE.tooltip;
  if (!tooltip) return;
  tooltip.textContent = zone.dataset.uri ?? "";
  tooltip.hidden = false;

  const zoneRect = zone.getBoundingClientRect();
  const tipRect = tooltip.getBoundingClientRect();
  const margin = 8;

  let top = zoneRect.top - tipRect.height - margin;
  if (top < margin) {
    top = zoneRect.bottom + margin;
  }
  if (top + tipRect.height > window.innerHeight - margin) {
    top = clamp(zoneRect.top + margin, margin, window.innerHeight - tipRect.height - margin);
  }

  let left = zoneRect.left + zoneRect.width / 2 - tipRect.width / 2;
  left = clamp(left, margin, window.innerWidth - tipRect.width - margin);

  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
}

function hideTooltip(): void {
  if (STATE.tooltip) STATE.tooltip.hidden = true;
}

function onZoneMouseOver(event: MouseEvent): void {
  const target = (event.target as HTMLElement | null)?.closest<HTMLDivElement>(
    ".__wia-zone",
  );
  if (!target) return;
  STATE.hoveredZone = target;
  target.classList.add("__wia-zone--hover");
  positionTooltip(target);
}

function onZoneMouseOut(event: MouseEvent): void {
  const target = (event.target as HTMLElement | null)?.closest<HTMLDivElement>(
    ".__wia-zone",
  );
  if (!target) return;
  const related = (event.relatedTarget as HTMLElement | null)?.closest?.(
    ".__wia-zone",
  );
  if (related === target) return;
  target.classList.remove("__wia-zone--hover");
  if (STATE.hoveredZone === target) STATE.hoveredZone = null;
  hideTooltip();
}

function flashTooltip(message: string, durationMs: number): void {
  const tooltip = STATE.tooltip;
  if (!tooltip) return;
  const previous = tooltip.textContent;
  tooltip.textContent = message;
  setTimeout(() => {
    if (!STATE.tooltip) return;
    if (STATE.hoveredZone) {
      STATE.tooltip.textContent = STATE.hoveredZone.dataset.uri ?? previous ?? "";
    } else {
      hideTooltip();
    }
  }, durationMs);
}

function onZoneClick(event: MouseEvent): void {
  const target = (event.target as HTMLElement | null)?.closest<HTMLDivElement>(
    ".__wia-zone",
  );
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  const uri = target.dataset.uri;
  if (!uri) return;

  void (async () => {
    const action = await loadAction();
    const resolved = resolveAction(action, uri);
    if (resolved.kind === "copy") {
      try {
        await navigator.clipboard.writeText(resolved.uri);
        flashTooltip("Copied!", 900);
      } catch (err) {
        console.warn("[where-its-at] clipboard write failed:", err);
        flashTooltip("Copy failed", 1200);
      }
      return;
    }
    void chrome.runtime
      .sendMessage({ type: "open", url: resolved.url })
      .catch(() => undefined);
  })();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  if (!STATE.active) return;
  event.preventDefault();
  event.stopPropagation();
  void chrome.runtime
    .sendMessage({ type: "deactivate" })
    .catch(() => undefined);
}

let layoutRaf = 0;
function scheduleLayout(): void {
  if (layoutRaf) return;
  layoutRaf = requestAnimationFrame(() => {
    layoutRaf = 0;
    updateLayout();
    if (STATE.hoveredZone) positionTooltip(STATE.hoveredZone);
  });
}

function activate(): void {
  if (STATE.active) return;
  clearTimeout(scanTimer);
  STATE.items = findItems();
  if (STATE.items.length === 0) {
    sendScanResult(0);
    return;
  }
  STATE.active = true;
  ensureStyle();

  STATE.overlay = createOverlay();
  STATE.zones = createZones();
  STATE.tooltip = createTooltip();
  document.documentElement.appendChild(STATE.overlay);
  document.documentElement.appendChild(STATE.zones);
  document.documentElement.appendChild(STATE.tooltip);

  STATE.zones.addEventListener("mouseover", onZoneMouseOver);
  STATE.zones.addEventListener("mouseout", onZoneMouseOut);
  STATE.zones.addEventListener("click", onZoneClick);
  window.addEventListener("scroll", scheduleLayout, true);
  window.addEventListener("resize", scheduleLayout);
  window.addEventListener("keydown", onKeyDown, true);

  updateLayout();
}

function deactivate(): void {
  if (!STATE.active) return;
  STATE.active = false;
  STATE.overlay?.remove();
  STATE.zones?.remove();
  STATE.tooltip?.remove();
  STATE.overlay = null;
  STATE.zones = null;
  STATE.tooltip = null;
  STATE.hoveredZone = null;
  window.removeEventListener("scroll", scheduleLayout, true);
  window.removeEventListener("resize", scheduleLayout);
  window.removeEventListener("keydown", onKeyDown, true);
}

let scanTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleScan(): void {
  // While the overlay is engaged we rebuild zone divs on every layout pass,
  // which would itself satisfy the MutationObserver and cause a feedback loop
  // (rescan → rebuild zones → mutation → rescan). updateLayout is already
  // driven by scroll/resize via rAF, so skipping mutation-driven rescans
  // here is safe.
  if (STATE.active) return;
  clearTimeout(scanTimer);
  scanTimer = setTimeout(() => {
    const items = findItems();
    STATE.items = items;
    sendScanResult(items.length);
  }, 400);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "activate") {
    activate();
    sendResponse({ ok: true, count: STATE.items.length });
    return false;
  }
  if (message?.type === "deactivate") {
    deactivate();
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

const observer = new MutationObserver(scheduleScan);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["typeof", "resource", "href"],
});

// Initial scan
STATE.items = findItems();
sendScanResult(STATE.items.length);

// CSS is injected via JS (rather than declared as a manifest content_script CSS file)
// so the same source file owns layout + styling and we can use CSS variables that
// are dynamically driven by prefers-color-scheme.
const OVERLAY_CSS = `
  :root {
    --wia-overlay-color: rgba(255, 255, 255, 0.72);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --wia-overlay-color: rgba(0, 0, 0, 0.72);
    }
  }
  #${OVERLAY_ID} {
    position: fixed;
    inset: 0;
    z-index: 2147483640;
    pointer-events: none;
    color-scheme: light dark;
  }
  #${OVERLAY_ID} svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  #${ZONES_ID} {
    position: fixed;
    inset: 0;
    z-index: 2147483641;
    pointer-events: none;
  }
  .__wia-zone {
    position: absolute;
    pointer-events: auto;
    cursor: pointer;
  }
  .__wia-zone--hover {
    box-shadow:
      0 0 0 2px rgba(0, 133, 255, 0.95),
      0 0 0 6px rgba(0, 133, 255, 0.25),
      0 8px 24px rgba(0, 0, 0, 0.25);
  }
  #${TOOLTIP_ID} {
    position: fixed;
    z-index: 2147483642;
    background: #0085ff;
    color: white;
    padding: 6px 10px;
    border-radius: 6px;
    font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    pointer-events: none;
    max-width: min(60vw, 480px);
    word-break: break-all;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  }
`;
