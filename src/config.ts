/// <reference types="chrome" />

export type ClickAction =
  | { kind: "copy" }
  | { kind: "pdsls" }
  | { kind: "taproot" }
  | { kind: "custom"; template: string };

export const DEFAULT_ACTION: ClickAction = { kind: "pdsls" };

export const STORAGE_KEY = "clickAction";

const PLACEHOLDER = "{at-uri}";

export function isValidAction(value: unknown): value is ClickAction {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "copy" || kind === "pdsls" || kind === "taproot") return true;
  if (kind === "custom") {
    const tpl = (value as { template?: unknown }).template;
    return typeof tpl === "string" && tpl.includes(PLACEHOLDER);
  }
  return false;
}

export async function loadAction(): Promise<ClickAction> {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY];
  return isValidAction(stored) ? stored : DEFAULT_ACTION;
}

export async function saveAction(action: ClickAction): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEY]: action });
}

export type ResolvedAction =
  | { kind: "url"; url: string }
  | { kind: "copy"; uri: string };

export function visitLabel(action: ClickAction): string | null {
  switch (action.kind) {
    case "copy":
      return null;
    case "pdsls":
      return "Visit PDSls";
    case "taproot":
      return "Visit Taproot";
    case "custom": {
      try {
        const url = new URL(action.template.split(PLACEHOLDER).join("x"));
        return `Visit ${url.hostname.replace(/^www\./, "")}`;
      } catch {
        return "Visit link";
      }
    }
  }
}

export function resolveAction(action: ClickAction, uri: string): ResolvedAction {
  switch (action.kind) {
    case "copy":
      return { kind: "copy", uri };
    case "pdsls":
      return { kind: "url", url: `https://pdsls.dev/${uri}` };
    case "taproot":
      return { kind: "url", url: `https://atproto.at/uri/${uri}` };
    case "custom":
      return { kind: "url", url: action.template.split(PLACEHOLDER).join(uri) };
  }
}
