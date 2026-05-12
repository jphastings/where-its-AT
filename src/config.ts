/// <reference types="chrome" />

const PLACEHOLDER = "{at-uri}";

// {at-uri} substitutes the URI *without* the at:// scheme prefix, so templates
// that need the scheme include it literally (e.g. ".../at://{at-uri}"). Lets
// destinations like aturi.to that take a path segment work in the same shape
// as those that want the full at-uri.
const BUILT_INS = {
  pdsls: {
    template: "https://pdsls.dev/at://{at-uri}",
    label: "Visit PDSls",
  },
  taproot: {
    template: "https://atproto.at/uri/at://{at-uri}",
    label: "Visit Taproot",
  },
  atptools: {
    template: "https://atp.tools/at://{at-uri}",
    label: "Visit @tools",
  },
  aturi: {
    template: "https://aturi.to/profile/{at-uri}",
    label: "Visit aturi",
  },
  anisota: {
    template: "https://anisota.net/explorer/{at-uri}",
    label: "Visit Anisota Explorer",
  },
} as const;

export type BuiltInKind = keyof typeof BUILT_INS;

export type ClickAction =
  | { kind: "copy" }
  | { kind: BuiltInKind }
  | { kind: "custom"; template: string };

export const DEFAULT_ACTION: ClickAction = { kind: "pdsls" };

export const STORAGE_KEY = "clickAction";

function isBuiltInKind(value: unknown): value is BuiltInKind {
  return typeof value === "string" && value in BUILT_INS;
}

const AT_SCHEME = "at://"

function stripScheme(uri: string): string {
  return uri.startsWith(AT_SCHEME) ? uri.slice(AT_SCHEME.length) : uri;
}

function applyTemplate(template: string, uri: string): string {
  return template.split(PLACEHOLDER).join(stripScheme(uri));
}

export function isValidAction(value: unknown): value is ClickAction {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "copy") return true;
  if (isBuiltInKind(kind)) return true;
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
  if (action.kind === "copy") return null;
  if (action.kind === "custom") {
    try {
      const url = new URL(applyTemplate(action.template, "x"));
      return `Visit ${url.hostname.replace(/^www\./, "")}`;
    } catch {
      return "Visit link";
    }
  }
  return BUILT_INS[action.kind].label;
}

export function resolveAction(action: ClickAction, uri: string): ResolvedAction {
  if (action.kind === "copy") return { kind: "copy", uri };
  const template =
    action.kind === "custom" ? action.template : BUILT_INS[action.kind].template;
  return { kind: "url", url: applyTemplate(template, uri) };
}
