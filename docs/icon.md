# Changing the CLI icon

The icon shows in four places.

| Where                                   | What it shows                                                           |
| --------------------------------------- | ----------------------------------------------------------------------- |
| OAuth consent screen (`tdc auth login`) | `logo_uri` in `oauth/client-metadata.json`, or an older URL (see below) |
| Sign-in result pages in the browser     | The URL in `LOGO_URI`                                                   |
| README (GitHub and npm)                 | `icons/comms-cli.png`                                                   |
| Comms web, Settings → Integrations      | Its own copies in `Doist/comms-web`                                     |

## 1. Export the artwork

The source is the `Size=72, Style=Color` variant of [Service / Comms CLI](https://www.figma.com/design/xo9yAsH8PQUpi0eTJh9pmR/?node-id=15223-1259) in Product Library – Global.

- Export a **512×512 PNG**.
- Don't export SVG. The artwork uses blend modes that SVG export drops, so the tile renders pale.

## 2. Replace the repo file

Overwrite `icons/comms-cli.png` with the new PNG, keeping the name. It's the `LOGO_URI` (sign-in result pages), the `logo_uri` in the client metadata document (consent screen) and the README header.

**Never rename or delete it.** `tdc` signs in with its client ID metadata document (`oauth/client-metadata.json`), which Todoist re-reads (caching it for up to an hour), so the consent screen follows the document's `logo_uri`. But versions before the switch to that document registered an OAuth client through DCR instead, and Todoist stores a DCR client's `logo_uri` at registration and never refreshes it, so every URL a released version has sent must keep serving the icon. If you ever change `LOGO_URI` and the document's `logo_uri` (keep them equal; a test checks), keep the old file in place too. (1.0.0 to 1.4.0 used a commit-pinned URL that no longer resolves, and 3.6.1 to 3.6.4 registered `icons/comms-cli_512px.png`, which has since been removed, so clients first registered by those versions show Todoist's fallback icon.)

The consent screen picks up a replaced file as soon as it's on `main` (allow about ten minutes: GitHub's raw files and Todoist's image proxy each cache for five). No release is needed unless `LOGO_URI` itself changes.

## 3. Update Comms web

`Doist/comms-web` keeps its own copies for the CLI card in Settings → Integrations:

- `src/settings/integrations/comms-cli-icon.png` (32×32)
- `src/settings/integrations/comms-cli-icon@2x.png` (64×64)
- `src/settings/integrations/comms-cli-icon@3x.png` (96×96)

Resize the 512px PNG to those sizes and open a PR there.
