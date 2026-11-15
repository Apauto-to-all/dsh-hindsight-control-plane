# DSH Hindsight Console

[简体中文](README.md) · **English**

Embed the Hindsight memory console into the DeepSeek Harness main panel: one click in the sidebar brings up the full console — no separate browser window. The console is launched by the host via `npx` and starts and stops with the plugin.

## Features

- **One button.** A Hindsight entry appears in the sidebar; clicking it fills the main area.
- **Self-launching.** The host runs `npx -y @vectorize-io/hindsight-control-plane@<version>`; when the plugin unloads, the whole process tree is taken down with it.
- **Self-healing ports.** Before launching, the port is probed: an instance that already answers is reused; an old instance holding the port is waited out; the holder is killed only after verifying it is this console's own `node` process. A second console is never started side by side — two consoles fighting over one port will both hang.
- **Keep your page across panel switches.** Switch to a conversation and back — you return to the page you left (within the same DSH page session).
- **Settings live on the plugin page.** Four launch options, applied immediately, persisted to the profile's patch layer.

## Install

```bash
dsh plugin --profile web add dsh-hindsight-control-plane
```

**GUI**: Plugins page in the sidebar → "Add Plugin" → enter `dsh-hindsight-control-plane` → install → restart DSH. The Desktop build uses the `desktop` profile by default; replace `web` with `desktop` in the command above.

The console itself is downloaded from npm at runtime, so you need a Node environment with npm access.

## Settings

The card on the plugin page (Settings → Plugins → Hindsight) — all four fields land on the launch command line:

| Field | CLI flag | When empty |
| --- | --- | --- |
| Memory service URL | `--api-url` | console's own default |
| Console port | `--port` | console default `9999` |
| Bind address | `--hostname` | `127.0.0.1` (this machine only) |
| Package version | `@<version>` | `latest` |

The actual command is shown under the card; unset options simply don't appear in it. Settings are stored in the profile's `cordis.patch.yml`, not in a plugin-private JSON file.

**The bind address defaults to this machine only.** The console has no authentication and its own default is `0.0.0.0` — anyone on the same network could read your memory data — so when the field is empty the plugin always passes `--hostname 127.0.0.1`. To open it from another device, set the field to `0.0.0.0` and browse to `http://<this machine's LAN IP>:<port>` with the firewall allowing it; the iframe inside the panel always goes through `127.0.0.1`.

## How it works

```
DSH host process
 └── cmd.exe / npx → node → Next.js console (listening on 127.0.0.1:<port>)

DSH page in the browser
 └── iframe in the panel → http://127.0.0.1:<port>
```

The two sides communicate through exactly two host routes:

- `GET /dsh-hindsight-control-plane/url` — the panel asks: what is the address
- `GET|POST /dsh-hindsight-control-plane/settings` — the settings card reads and writes

Saving goes through `configEditor.edit()`: it persists to the profile's patch layer and makes the Loader re-reconcile that row, so the plugin executes once more with the new config and starts a fresh console. That is why saving does not restart anything itself — otherwise two processes would fight over the same port.

### Why the iframe isn't in the React tree

When the panel unmounts, React tears the iframe down with it, and the console reloads to its home page. Parking the iframe elsewhere doesn't work either — moving it in the DOM also reloads it (verified experimentally).

So the iframe lives permanently in a fixed layer under `document.body`, and the panel keeps only a placeholder: when the panel appears, the layer is positioned over the placeholder's rect; when it leaves, the layer is moved off-screen (not `display:none` — that squashes the viewport and resets the scroll position). Throughout, that browsing context is never moved or destroyed.

## Known limitations

- **Back to the home page after refreshing or restarting DSH.** The console is on `127.0.0.1:<port>` while DSH is on another port; they are cross-origin, so the page cannot read the iframe's address and has nothing to restore from.
- **An orphaned console when DSH is killed hard** (Windows does not reap children of killed parents). The next launch reuses or clears it; nothing gets stuck.
- **Windows is the primary verified path.** macOS / Linux take a simpler branch (plain `spawn`, `SIGTERM`), untested.

## Development

```
lib/index.js     entry: apply, the two routes, finding the Loader row
lib/settings.js  how settings are normalized, validated, and which address they yield
lib/console.js   how the console command is built, when not to launch, how to stop
lib/process.js   is the port listening, who holds it, how to see it off
lib/http.js      read request bodies, reply JSON
lib/client.js    the browser half (single file, 6 sections)
```

No build step: the host half is plain ESM; the browser half is `lib/client.js`, loaded by DSH straight from the plugin directory. Editing the client needs no reinstall — it hot-reloads; editing the host half needs one plugin reload.

The client half deliberately stays a single file — DSH loads exactly one client file per package, and splitting it would mean pulling in a bundler. Sections inside the file stand in for modules; the file header has a table of contents.

## License

MIT, see [LICENSE](LICENSE).

The console itself is [`@vectorize-io/hindsight-control-plane`](https://www.npmjs.com/package/@vectorize-io/hindsight-control-plane), distributed under its own license (ISC); this repo only launches it and embeds it in the panel.
