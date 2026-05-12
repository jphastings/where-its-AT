# where it's at — atproto / RDFa browser extension

A browser extension (Firefox, Chrome, Safari) which highlights elements on webpages that declare their relationship to atproto records using [RDFa `resource` attributes](https://www.w3.org/TR/rdfa-primer/#multiple-items).

```html
<div typeof="schema:Thing" resource="at://did:plc:ephkzpinhaqcabtkugtbzrwu/org.example.lexicon/abc123def">
  Something derived from an atproto record
</div>
```

You can see a page with these RDFa tags on my [atproto Slay the Spire 2 app](https://sts2.byjp.me/did:plc:ephkzpinhaqcabtkugtbzrwu).

## What it does

- The toolbar icon shows a struck-through `@` by default. When any atproto reference is detected on the page it switches to a solid blue `@`.
- Click the toolbar icon to dim the page and "punch out" only the atproto-tagged elements. Hover them to see the `at://` URI; click to open the destination.
- Click the icon again, or press `Esc`, to dismiss the overlay.

### Detected indicators

| Indicator                                                                       | Destination        |
| ------------------------------------------------------------------------------- | ------------------ |
| `[typeof~="schema:Thing"][resource^="at://…"]`                                  | the `resource` URI |
| `[typeof~="schema:Person"][resource^="did:plc:…"]` or `[resource^="did:web:…"]` | `at://{did}`       |
| `[href^="at://…"]` (any element)                                                | the `href` URI     |

By default destinations are opened at `https://pdsls.dev/{at-uri}` in a new tab. Configurable destinations are planned.

## Stack

- TypeScript + Vite + [`vite-plugin-web-extension`](https://github.com/aklinker1/vite-plugin-web-extension)
- pnpm
- Manifest V3 for both Chrome and Firefox (Firefox 121+)
- Safari packaged from the Chrome build via `safari-web-extension-converter`

## Develop

```bash
pnpm install
pnpm icons         # rasterize src/icons/*.svg → public/icons/*.png
pnpm build         # builds both dist/chrome and dist/firefox
```

Load unpacked:

- **Chrome / Edge**: `chrome://extensions` → enable Developer Mode → "Load unpacked" → select `dist/chrome`.
- **Firefox**: `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on…" → select `dist/firefox/manifest.json`.

`pnpm dev` and `pnpm dev:firefox` run the Vite dev server with hot reload (you still load the unpacked extension from `dist/<browser>` once).

## CI builds

`.github/workflows/build.yml` runs on every push / PR:

1. Ubuntu runner builds and zips `dist/chrome.zip` and `dist/firefox.zip` (uploaded as workflow artifacts).
2. macOS runner consumes the Chrome build, runs `xcrun safari-web-extension-converter` to scaffold an Xcode project, and does an unsigned Release build to verify everything compiles. The full Xcode project is uploaded as a `safari-xcode-project` artifact.
