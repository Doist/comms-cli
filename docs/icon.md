# Changing the CLI icon

The icon shows in four places.

| Where                                   | What it shows                                                                    |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| OAuth consent screen (`tdc auth login`) | The URL in `LOGO_URI` (`src/lib/auth-constants.ts`), or an older one (see below) |
| Sign-in result pages in the browser     | The URL in `LOGO_URI`                                                            |
| README (GitHub and npm)                 | `icons/comms-cli.png`                                                            |
| Comms web, Settings → Integrations      | Its own copies in `Doist/comms-web`                                              |

## 1. Export the artwork

The source is the `Size=72, Style=Color` variant of [Service / Comms CLI](https://www.figma.com/design/xo9yAsH8PQUpi0eTJh9pmR/?node-id=15223-1259) in Product Library – Global.

- Export a **512×512 PNG**.
- Don't export SVG. The artwork uses blend modes that SVG export drops, so the tile renders pale.

## 2. Replace the repo file

Overwrite `icons/comms-cli.png` with the new PNG, keeping the name. It's the `LOGO_URI` (consent screen and sign-in result pages) and the README header.

**Never rename or delete it.** `tdc` registers an OAuth client the first time it signs in (one per callback port) and reuses it. Todoist stores the client's `logo_uri` at registration and never refreshes it, so every URL a released version has sent must keep serving the icon. If you ever change `LOGO_URI`, keep the old file in place too. (3.6.1 to 3.6.3 registered `icons/comms-cli_512px.png`, which has since been removed, so clients first registered by those versions show Todoist's fallback icon.)

The consent screen picks up a replaced file as soon as it's on `main` (allow about ten minutes: GitHub's raw files and Todoist's image proxy each cache for five). No release is needed unless `LOGO_URI` itself changes.

## 3. Update Comms web

`Doist/comms-web` keeps its own copies for the CLI card in Settings → Integrations:

- `src/settings/integrations/comms-cli-icon.png` (32×32)
- `src/settings/integrations/comms-cli-icon@2x.png` (64×64)
- `src/settings/integrations/comms-cli-icon@3x.png` (96×96)

Resize the 512px PNG to those sizes and open a PR there.
