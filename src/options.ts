/// <reference types="chrome" />

import { type ClickAction, loadAction, saveAction } from "./config";

const PLACEHOLDER = "{at-uri}";

const radios = document.querySelectorAll<HTMLInputElement>(
  'input[name="action"]',
);
const customWrap = document.getElementById("custom-input") as HTMLDivElement;
const templateInput = document.getElementById("template") as HTMLInputElement;
const customError = document.getElementById("custom-error") as HTMLSpanElement;
const statusEl = document.getElementById("status") as HTMLDivElement;

let statusTimer: ReturnType<typeof setTimeout> | undefined;

function getSelectedKind(): ClickAction["kind"] | null {
  for (const r of radios) {
    if (r.checked) return r.value as ClickAction["kind"];
  }
  return null;
}

function syncCustomVisibility(kind: ClickAction["kind"] | null): void {
  const isCustom = kind === "custom";
  customWrap.classList.toggle("shown", isCustom);
  templateInput.disabled = !isCustom;
  if (!isCustom) customError.textContent = "";
}

function validateTemplate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Enter a URL";
  if (!trimmed.includes(PLACEHOLDER)) {
    return `Template must contain ${PLACEHOLDER}`;
  }
  return null;
}

function showStatus(): void {
  statusEl.classList.add("shown");
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => statusEl.classList.remove("shown"), 1500);
}

function buildAction(): ClickAction | { error: string } {
  const kind = getSelectedKind();
  if (!kind) return { error: "No selection" };
  if (kind === "custom") {
    const err = validateTemplate(templateInput.value);
    if (err) return { error: err };
    return { kind: "custom", template: templateInput.value.trim() };
  }
  return { kind };
}

async function persist(): Promise<void> {
  const result = buildAction();
  if ("error" in result) {
    customError.textContent = result.error;
    return;
  }
  customError.textContent = "";
  await saveAction(result);
  showStatus();
}

async function init(): Promise<void> {
  const action = await loadAction();
  for (const r of radios) {
    r.checked = r.value === action.kind;
  }
  if (action.kind === "custom") {
    templateInput.value = action.template;
  }
  syncCustomVisibility(action.kind);

  for (const r of radios) {
    r.addEventListener("change", () => {
      const kind = getSelectedKind();
      syncCustomVisibility(kind);
      if (kind === "custom" && !templateInput.value) {
        templateInput.focus();
        return;
      }
      void persist();
    });
  }

  templateInput.addEventListener("input", () => {
    if (getSelectedKind() !== "custom") return;
    void persist();
  });
}

void init();
