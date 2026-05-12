# Where it's AT — atproto / RDFa browser extension

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

`.github/workflows/build.yml` runs on every push to `main` / PR:

1. Ubuntu runner builds and zips `dist/chrome.zip` and `dist/firefox.zip`, uploaded as workflow artifacts.
2. macOS runner consumes the Chrome build, runs `xcrun safari-web-extension-converter` to scaffold an Xcode project, and does an unsigned Release build to verify everything compiles. The full Xcode project is uploaded as a `safari-xcode-project` artifact.

## Releases

`.github/workflows/release.yml` watches `main` for changes to `package.json`. When the `version` field changes, it builds all three browsers and publishes a GitHub Release. It also creates the corresponding `v<version>` git tag during the release. There's also a `workflow_dispatch` manual trigger with a `force` input for re-running on the current `main` HEAD without bumping the version.

Releasing is just:

```sh
npm version patch        # or minor / major
git push origin main
```

The release contains:

- `where-its-at-<version>-chrome.zip` — load via `chrome://extensions` → Load unpacked
- `where-its-at-<version>-firefox.xpi` — load via `about:debugging` (unsigned; for AMO distribution we'd add `web-ext sign`)
- `where-its-at-<version>-safari.zip` — contains the host `.app` bundle for Safari

If a release already exists for the current version, the workflow no-ops, so re-pushing `main` is safe.

### Safari signing + notarization secrets

The Safari job degrades gracefully:

- No Apple secrets → produces an **unsigned** `.app`. Loadable only via Safari's *Allow Unsigned Extensions* in the Develop menu, useful for personal testing.
- `APPLE_TEAM_ID` + cert secrets → **signed** with Developer ID Application (Gatekeeper-clean once notarized).
- Plus notary secrets → **signed and notarized**, ready for distribution outside the App Store.

Add these in **Settings → Secrets and variables → Actions**:

| Name                         | Type                    | Purpose                                                                       |
| ---------------------------- | ----------------------- | ----------------------------------------------------------------------------- |
| `APPLE_TEAM_ID`              | secret                  | 10-character Apple Developer Team ID                                          |
| `APPLE_CERT_P12_BASE64`      | secret                  | `base64` of the Developer ID Application `.p12` exported from Keychain Access |
| `APPLE_CERT_PASSWORD`        | secret                  | Password used when exporting that `.p12`                                      |
| `APPLE_NOTARY_KEY_ID`        | secret                  | App Store Connect API key ID (10 chars)                                       |
| `APPLE_NOTARY_KEY_ISSUER_ID` | secret                  | App Store Connect API issuer UUID                                             |
| `APPLE_NOTARY_KEY_P8_BASE64` | secret                  | `base64` of the App Store Connect API `.p8` private key                       |
| `APPLE_BUNDLE_ID`            | **variable** (optional) | Override the default bundle identifier `me.byjp.where-its-at`                 |

To prepare the cert secret:

```sh
base64 -i /path/to/DeveloperIDApplication.p12 | pbcopy
```

App Store Connect API keys are created at <https://appstoreconnect.apple.com/access/integrations/api>; download the `.p8` once (Apple won't let you fetch it again) and base64-encode the same way. The key needs at least the **Developer** role for notarization.
