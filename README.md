# PWA Icon Matcher

A lightweight, native GNOME Shell extension that automatically detects Progressive Web App (PWA) desktop launchers created by web browsers and seamlessly matches them to your currently active Linux icon theme.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Key Features](#2-key-features)
3. [Supported GNOME Versions](#3-supported-gnome-versions)
4. [Supported Browser Adapters](#4-supported-browser-adapters)
5. [Installation](#5-installation)
6. [Enabling the Extension](#6-enabling-the-extension)
7. [Preferences Interface](#7-preferences-interface)
8. [Icon Matching Algorithm](#8-icon-matching-algorithm)
9. [Custom Aliases](#9-custom-aliases)
10. [Reversibility and Restoration](#10-reversibility-and-restoration)
11. [Troubleshooting](#11-troubleshooting)
12. [Debug Logging](#12-debug-logging)
13. [Development Setup](#13-development-setup)
14. [Testing Suite](#14-testing-suite)
15. [Contributing](#15-contributing)
16. [Known Limitations](#16-known-limitations)

---

## 1. Project Overview

When a user installs a Progressive Web App (such as Claude, YouTube, Gmail, or Spotify) using Chromium-based browsers, Brave, Edge, or GNOME Web, the browser automatically generates a desktop entry in `~/.local/share/applications/` with a hardcoded absolute path pointing to a low-resolution or browser-cached bitmap icon:

```ini
[Desktop Entry]
Name=Claude
Exec=/usr/bin/brave-browser --profile-directory=Default --app-id=fmpnliohjhemenmnlpbfagaolkdacoja
Icon=/home/user/.local/share/icons/hicolor/256x256/apps/brave-fmpnliohjhemenmnlpbfagaolkdacoja-Default.png
Type=Application
```

This prevents the desktop environment from resolving the application's icon through the user's installed, high-resolution vector icon theme (such as MacTahoe, Papirus, Adwaita, Tela, Numix, or Breeze).

**PWA Icon Matcher** solves this problem automatically and invisibly:
1. It listens for newly created or updated `.desktop` files in `~/.local/share/applications/` via `Gio.FileMonitor`.
2. Positively verifies that the launcher is a browser-installed PWA.
3. Resolves the application name against the active icon theme using GNOME's native icon lookup APIs (`St.IconTheme`).
4. Surgically and atomically patches only the `Icon=` key:

```ini
Icon=claude
```

5. Saves original icon paths to `~/.local/state/pwa-icon-matcher/state.json` for full reversibility.

### Core Philosophy
- **Zero Idle Overhead:** No permanent background daemon, no polling loops, zero recurring timers, and zero CPU usage when idle.
- **Pure Native Stack:** Built using JavaScript ES Modules for GNOME 45+, native GIO asynchronous APIs, GSettings, and Libadwaita. No Python, Node.js, Electron, or external runtimes.
- **Surgical & Safe:** Never rewrites entire desktop files; preserves comments, line endings (`\n` or `\r\n`), field ordering, and extra action groups (`[Desktop Action ...]`).

---

## 2. Key Features

- **Event-Driven Monitoring:** Single `Gio.FileMonitor` on `~/.local/share/applications/` with 400ms per-file debouncing and self-modification suppression.
- **Startup Scan:** Performs a single non-blocking asynchronous pass over existing launchers on startup, so existing PWAs are matched without manual reinstall.
- **Browser-Independent Architecture:** Modular detection adapters for Chromium, Brave, Chrome, Edge, Vivaldi, Opera, GNOME Web (Epiphany), and Firefox PWA tools.
- **Deterministic Name Normalization:** Converts application titles into clean icon candidates while preserving multi-word titles (e.g. "YouTube Music" is not improperly truncated to "youtube").
- **Theme-Switch Friendly:** Desktop files store symbolic/themed icon names (`Icon=claude`) rather than absolute file paths. Switching themes from MacTahoe to Papirus or Adwaita requires zero desktop file rewrites.
- **Full Reversibility:** Original icons are persisted in an atomic state file. Revert any single launcher or all launchers at any time. External user modifications are detected and preserved.
- **Polished Preferences Window:** Modern GTK4 + Libadwaita settings dialog with live icon search/testing tool, custom alias manager, user exclusions, and diagnostic log inspector.

---

## 3. Supported GNOME Versions

| GNOME Shell Version | Compatibility | Architecture |
|---|---|---|
| GNOME Shell 49 | Supported | ES Modules (`import ... from 'resource:///...'`) |
| GNOME Shell 50 | Supported | ES Modules |
| GNOME Shell 51 | Supported & Validated | ES Modules (tested on GNOME 51.1) |

---

## 4. Supported Browser Adapters

PWA Icon Matcher inspects positive PWA signals (such as `--app-id=`, `--app=`, `--app-launch-url=`, `StartupWMClass=crx_...`, `--application-mode`, and `site run`) rather than filename prefixes alone. Standard browser launchers are never misidentified as PWAs.

| Adapter | Target Applications | Positive Detection Signals |
|---|---|---|
| **Brave** | Brave Browser PWAs | Binary `brave`, `brave-*.desktop`, `--app-id=`, `crx_*` |
| **Google Chrome** | Chrome PWAs | Binary `google-chrome`, `chrome-*.desktop`, `--app-id=`, `crx_*` |
| **Chromium** | Chromium & Ungoogled Chromium | Binary `chromium`, `chromium-*.desktop`, `--app-id=`, `crx_*` |
| **Microsoft Edge** | Edge PWAs | Binary `msedge`, `msedge-*.desktop`, `--app-id=`, `crx_*` |
| **Vivaldi** | Vivaldi Web Apps | Binary `vivaldi`, `vivaldi-*.desktop`, `--app-id=`, `crx_*` |
| **Opera** | Opera Web Apps | Binary `opera`, `opera-*.desktop`, `--app-id=`, `crx_*` |
| **Firefox PWA** | PWAsForFirefox (`firefoxpwa`) | Binary `firefoxpwa`, `ffpwa-*.desktop`, `site run` |
| **GNOME Web** | Epiphany Web Apps | Binary `epiphany`, `org.gnome.Epiphany.WebApp-*`, `--application-mode` |
| **Generic** | Other Chromium derivatives | Positive `--app-id=` or `--app=` markers |

Individual adapters can be toggled on or off in the Preferences window.

---

## 5. Installation

### Option A: Install Packaged Extension Bundle (Recommended)

Download `pwa-icon-matcher.shell-extension.zip` and run:

```bash
gnome-extensions install --force pwa-icon-matcher.shell-extension.zip
```

### Option B: Development Installation from Source

Clone this repository into your local GNOME extensions directory:

```bash
git clone https://github.com/shaque/pwa-icon-matcher.git ~/.local/share/gnome-shell/extensions/pwa-icon-matcher@pwa-icon-matcher
cd ~/.local/share/gnome-shell/extensions/pwa-icon-matcher@pwa-icon-matcher
glib-compile-schemas schemas/
```

---

## 6. Enabling the Extension

After installation, enable the extension using the GNOME Extensions CLI:

```bash
gnome-extensions enable pwa-icon-matcher@pwa-icon-matcher
```

Or open the **Extensions** app (`gnome-extensions-app`) and toggle **PWA Icon Matcher** on.

> **Note on Wayland Sessions:** GNOME Shell extensions under Wayland load dynamically. You do **not** need to log out or restart GNOME Shell when enabling or disabling this extension.

---

## 7. Preferences Interface

Access the settings window via:

```bash
gnome-extensions prefs pwa-icon-matcher@pwa-icon-matcher
```

Or click the Settings icon next to the extension in the **Extensions** app.

The settings window is divided into four clean sections:
1. **General & Browsers:** Master enable toggle, auto-matching switch, startup scan toggle, and individual toggles for all browser adapters.
2. **Icon Matching:** Exact matching toggle, live icon resolution tester, custom alias manager (add/edit/delete), and exclusion rules.
3. **Maintenance:** One-click "Scan Existing PWA Launchers Now" button, "Restore All Modified Icons" button with confirmation, matched launcher list, and unmatched PWA list.
4. **Diagnostics:** Debug logging toggle and recent activity journal view.

---

## 8. Icon Matching Algorithm

The resolution engine follows a strict 5-stage priority pipeline to ensure safe, deterministic matching without unsafe fuzzy guesses:

1. **Explicit User-Defined Alias:** Checked first against custom aliases configured in GSettings.
2. **Exact PWA Application Identifier:** Matches if an explicit application ID mapping exists.
3. **Exact Normalized Application Name:** Application title is normalized using Unicode-safe case folding and standard separator replacement (e.g. `WhatsApp Web` -> `whatsapp-web`, `Claude` -> `claude`, `YouTube Music` -> `youtube-music`).
4. **Normalized Variation:** Evaluates hyphen-free forms (`whatsappweb`) against the active icon theme.
5. **Recognized Web Fallback:** For web apps whose titles include a "Web" suffix (e.g. "WhatsApp Web"), falls back to the canonical brand name (`whatsapp`) only if the exact composite name does not exist in the active theme.

### Safety Guarantee
If no candidate icon is found in the user's active theme, the launcher file is left **completely untouched**. The extension will never replace an icon with an arbitrary or ambiguous match.

---

## 9. Custom Aliases

If an application requires a specific icon name not covered by default normalization, you can define a custom alias:

1. Open the Preferences window (`gnome-extensions prefs pwa-icon-matcher@pwa-icon-matcher`).
2. Navigate to the **Icon Matching** tab.
3. Under **Custom Icon Aliases**, click **Add New Alias** (`+`).
4. Enter the application name (e.g., `Claude`) and the target theme icon name (e.g., `claude`).
5. Click **Save**.

Custom aliases immediately override automatic matching.

---

## 10. Reversibility and Restoration

Every modification made by PWA Icon Matcher is logged in:

```text
~/.local/state/pwa-icon-matcher/state.json
```

Example state record:

```json
{
  "version": 1,
  "entries": {
    "brave-fmpnliohjhemenmnlpbfagaolkdacoja-Default.desktop": {
      "desktopFile": "brave-fmpnliohjhemenmnlpbfagaolkdacoja-Default.desktop",
      "originalIcon": "/home/user/.local/share/icons/hicolor/256x256/apps/brave-fmpnliohjhemenmnlpbfagaolkdacoja-Default.png",
      "matchedIcon": "claude",
      "modifiedByExtension": true,
      "appName": "Claude",
      "browser": "Brave",
      "timestamp": 1730000000000
    }
  }
}
```

### Safe Restoration Guarantees
- **Original Path Preserved:** Reprocessing an already patched desktop file preserves the original icon path and never overwrites it with the patched value.
- **User Edits Respected:** If a user manually changes the icon to a custom file or custom name after the extension modified it, restoration detects the discrepancy and leaves the user's modification untouched.
- **Single or Batch Revert:** Restore all launchers with one click in Preferences -> Maintenance -> "Restore All Modified Icons".

---

## 11. Troubleshooting

### Launcher icon didn't update after installing a PWA
1. Verify that the extension is enabled:
   ```bash
   gnome-extensions info pwa-icon-matcher@pwa-icon-matcher
   ```
2. Open Preferences and ensure the adapter for your browser is turned on.
3. Test if your active icon theme has an icon for that application using the **Icon Preview & Testing** tool in Preferences -> Icon Matching.
4. If your theme does not contain an icon with that name, add a custom alias or install an icon theme with wider coverage.

### Desktop file was created outside `~/.local/share/applications/`
PWA Icon Matcher intentionally restricts writes to user-owned `~/.local/share/applications/` for security and performance. It will never modify system files under `/usr/share/applications/`.

---

## 12. Debug Logging

To view live diagnostic logs:
1. Open Preferences -> Diagnostics and enable **Debug Logging**.
2. Or enable via command line:
   ```bash
   gsettings set org.gnome.shell.extensions.pwa-icon-matcher debug-logging true
   ```
3. View real-time journal messages:
   ```bash
   journalctl -f -o cat /usr/bin/gnome-shell | grep "PWA Icon Matcher"
   ```

---

## 13. Development Setup

### Requirements
- Linux with GNOME Shell 49, 50, or 51.
- GJS 1.80+ (`gjs`).
- GLib development utilities (`glib-compile-schemas`).
- `gnome-extensions` CLI tool.

### Building and Compiling Schemas
```bash
# Compile GSettings schema
glib-compile-schemas schemas/

# Build installable extension bundle with the official GNOME utility
gnome-extensions pack --force \
    --extra-source=lib \
    --schema=schemas/org.gnome.shell.extensions.pwa-icon-matcher.gschema.xml \
    .
```

---

## 14. Testing Suite

The repository includes a comprehensive standalone test suite verifying all 12 platform acceptance criteria:

```bash
gjs -m tests/run-tests.js
```

### Test Coverage Summary
- **Desktop Entry Spec:** Tokenization, quoting, escaping, CRLF preservation, and action group preservation.
- **PWA Detection:** Brave, Chrome, Chromium, Edge, Vivaldi, Opera, Epiphany, and Firefox PWA validation.
- **Icon Resolver:** Normalization, multi-word title preservation, candidate prioritization, and theme lookup.
- **Restoration:** State file atomic serialization, idempotent re-runs, and protection against overwriting manual user modifications.
- **Concurrency:** Detection of simultaneous browser file updates to prevent data loss.
- **Lifecycle:** Repeated enable/disable memory leak and timer cleanup verification.
- **Idle Performance:** Zero recurring timers, zero polling, single monitor.

---

## 15. Contributing

Contributions, bug reports, and pull requests are welcome on GitHub!
- Keep diffs focused and minimal.
- Do not introduce external dependencies or non-native runtimes.
- Run `gjs -m tests/run-tests.js` before submitting changes.

---

## 16. Known Limitations

- **Standard Firefox PWAs:** Standard Mozilla Firefox does not provide built-in PWA installation on Linux. Firefox PWAs installed via the PWAsForFirefox (`firefoxpwa`) tool are supported.
- **Non-Standard Application Paths:** Desktop launchers placed directly on the desktop surface (`~/Desktop/`) rather than `~/.local/share/applications/` are not scanned automatically to preserve the 0% idle CPU footprint.
- **System-Wide Desktop Entries:** System directories (`/usr/share/applications/`) are strictly read-only and never modified by this extension.

---

## License

This project is licensed under the terms of the **GNU General Public License v3.0** (GPL-3.0). See [LICENSE](LICENSE) for details.
