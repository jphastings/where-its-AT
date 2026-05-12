import { defineConfig } from "vite";
import webExtension from "vite-plugin-web-extension";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Browser = "chrome" | "firefox";

function buildManifest(browser: Browser): Record<string, unknown> {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    version: string;
    description: string;
  };

  const base: Record<string, unknown> = {
    manifest_version: 3,
    name: "where it's at",
    version: pkg.version,
    description: pkg.description,
    permissions: ["scripting"],
    host_permissions: ["<all_urls>"],
    action: {
      default_icon: {
        "16": "icons/inactive-16.png",
        "32": "icons/inactive-32.png",
        "48": "icons/inactive-48.png",
        "128": "icons/inactive-128.png",
      },
      default_title: "where it's at — reveal atproto references",
    },
    icons: {
      "16": "icons/inactive-16.png",
      "32": "icons/inactive-32.png",
      "48": "icons/inactive-48.png",
      "128": "icons/inactive-128.png",
    },
    content_scripts: [
      {
        matches: ["<all_urls>"],
        js: ["src/content.ts"],
        run_at: "document_idle",
      },
    ],
    web_accessible_resources: [
      {
        resources: ["icons/*.png"],
        matches: ["<all_urls>"],
      },
    ],
  };

  if (browser === "chrome") {
    base.background = { service_worker: "src/background.ts", type: "module" };
  } else {
    base.background = { scripts: ["src/background.ts"], type: "module" };
    base.browser_specific_settings = {
      gecko: {
        id: "where-its-at@byjp.me",
        strict_min_version: "121.0",
      },
    };
  }

  return base;
}

export default defineConfig(({ mode }) => {
  const browser: Browser = mode === "firefox" ? "firefox" : "chrome";
  return {
    plugins: [
      webExtension({
        manifest: () => buildManifest(browser),
        browser,
      }),
    ],
    build: {
      outDir: resolve(`dist/${browser}`),
      emptyOutDir: true,
    },
  };
});
