# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Earth RT Background** is a GNOME Shell extension (`uuid: earth-rt-background@hans.klaufus`) that renders a live Earth-from-space desktop wallpaper with real-time day/night shading, configured via a Top Bar indicator and preferences dialogue.

Target: GNOME Shell 49 and 50.

## Development Commands

```bash
# Install (copy) the extension into GNOME Shell's extension directory
cp -r . ~/.local/share/gnome-shell/extensions/earth-rt-background@hans.klaufus/

# Compile GSettings schema (required after editing the .gschema.xml file)
glib-compile-schemas schemas/

# Run a nested GNOME Shell session for testing (Wayland)
dbus-run-session gnome-shell --devkit --wayland

# Enable/disable the extension
gnome-extensions enable earth-rt-background@hans.klaufus
gnome-extensions disable earth-rt-background@hans.klaufus

# Reload the extension after changes (without restarting the shell)
gnome-extensions disable earth-rt-background@hans.klaufus && gnome-extensions enable earth-rt-background@hans.klaufus

# Open preferences
gnome-extensions prefs earth-rt-background@hans.klaufus

# View live logs from the extension
journalctl -f -o cat /usr/bin/gnome-shell
```

## Architecture

The extension follows the standard GNOME Shell extension layout for Shell version 45+, using ES module syntax (`import`/`export default class`).

### Key files

| File | Purpose |
|------|---------|
| `extension.js` | Main extension logic — panel indicator, popup dialog, day/night rendering |
| `prefs.js` | Preferences window (Adw-based) — city, altitude, refresh interval |
| `metadata.json` | Extension metadata and supported shell versions |
| `schemas/org.gnome.shell.extensions.earth-rt-background.gschema.xml` | GSettings schema |
| `stylesheet.css` | Extension CSS |
| `icons/earth.svg` | Top Bar indicator icon — Earth's planetary symbol ⊕ (circle with crosshair), white stroke on transparent background; not `-symbolic` so GNOME does not recolour it |

### GSettings keys

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `city-name` | string | `'Brussels'` | Centre point city for the Earth view |
| `altitude-km` | int | `500` | Observer altitude in km |
| `refresh-interval` | int | `15` | Wallpaper refresh interval in minutes |
| `show-indicator` | bool | `true` | Whether to show the Top Bar indicator |

### Rendering approach (current prototype)

1. **Day texture** — fetched from NASA SVS (`svs.gsfc.nasa.gov/vis/…/bluemarble-2048.png`, 2048×1024 PNG) and cached locally in `~/.cache/earth-rt-background/day.png`.
2. **Night texture** — VIIRS Black Marble tile from NASA GIBS WMTS.
3. **Sub-solar point** — computed with a compact NOAA-based approximation in `getSubSolarPoint()`.
4. **Day/night mask** — a CSS `radial-gradient` centred on the anti-solar point, applied as `mask-image` on a `St.Bin` container.

The wallpaper update cycle is driven by `GLib.timeout_add_seconds` using the `refresh-interval` setting.

### Planned / incomplete features (visible in commented-out code)

- `GSettings` bindings in `prefs.js` — city and altitude rows exist in the UI but are not yet bound to settings.
- `_scheduleRefresh()` is implemented but not called from `enable()`.
- The actual desktop background setting (via `Gio.Settings` `org.gnome.desktop.background`) is not yet implemented — the current popup is a `ModalDialog`, not a true wallpaper.
- The `cityToLatLon()` table is a stub; a proper geocoder is needed.

## GNOME Shell Extension Conventions

- Use `GLib.source_remove(id)` for all timeouts; store IDs and clean up in `disable()`.
- Disconnect all `GSettings` signal connections in `disable()` (store IDs in `_settingsChangedIds`).
- `destroy()` all actors created in `enable()` during `disable()`.
- The extension class must extend `Extension` (from `resource:///org/gnome/shell/extensions/extension.js`).
- Preferences class must extend `ExtensionPreferences` and implement `fillPreferencesWindow(window)`.
- The schema file must be recompiled (`glib-compile-schemas schemas/`) whenever it is changed.
