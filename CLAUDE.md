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
| `extension.js` | Main extension logic — panel indicator, wallpaper update loop, download, subprocess dispatch |
| `render-globe.py` | Python renderer — cartopy globe or rectangular projection with Nightshade terminator |
| `prefs.js` | Preferences window (Adw-based) — display mode, city preset, lat/lon, altitude, refresh interval |
| `metadata.json` | Extension metadata and supported shell versions |
| `schemas/org.gnome.shell.extensions.earth-rt-background.gschema.xml` | GSettings schema |
| `stylesheet.css` | Extension CSS |
| `icons/earth.svg` | Top Bar indicator icon — Earth's planetary symbol ⊕ (circle with crosshair), white stroke on transparent background; not `-symbolic` so GNOME does not recolour it |

### GSettings keys

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `display-mode` | string | `'rectangular'` | `'rectangular'` or `'globe'` |
| `latitude` | double | `50.8503` | Observer latitude in degrees |
| `longitude` | double | `4.3517` | Observer longitude in degrees |
| `altitude-km` | int | `500` | Observer altitude in km (globe mode) |
| `refresh-interval` | int | `15` | Wallpaper refresh interval in minutes |
| `show-indicator` | bool | `true` | Whether to show the Top Bar indicator |

### Rendering approach

1. **Day texture** — fetched from NASA NEO Blue Marble Next Generation (5400×2700 PNG, monthly), keyed by month and cached in `~/.cache/earth-rt-background/day_MM.png`. Downloads use a temp-file/rename pattern so a failed or partial download never corrupts the cache.
2. **Renderer** — `render-globe.py` is spawned as a subprocess via `Gio.Subprocess`. It uses `cartopy` and `matplotlib` (Agg backend) to render the Blue Marble texture through either `NearsidePerspective` (globe mode) or `PlateCarree` (rectangular mode).
3. **Day/night terminator** — drawn by `cartopy.feature.nightshade.Nightshade` using the current UTC time; no explicit solar-coordinate computation is needed.
4. **Globe mode extras** — a randomised starfield is drawn behind the globe disc; at low altitudes the renderer tiles a larger canvas and crops to the screen size.
5. **Wallpaper application** — the output PNG is applied via `Gio.Settings` (`org.gnome.desktop.background`) `picture-uri` / `picture-uri-dark`; the previous wallpaper is saved in `enable()` and restored in `disable()`.

The update cycle is driven by `GLib.timeout_add_seconds` (`_armTimer`) using the `refresh-interval` setting. `_scheduleRefresh()` triggers an immediate render on `enable()` and then arms the repeating timer.

### Runtime dependencies

- `python3-cartopy` — cartopy projections and Nightshade (Fedora: `sudo dnf install python3-cartopy`)
- `python3-matplotlib` — rendering backend

## GNOME Shell Extension Conventions

- Use `GLib.source_remove(id)` for all timeouts; store IDs and clean up in `disable()`.
- Disconnect all `GSettings` signal connections in `disable()` (store IDs in `_settingsChangedIds`).
- `destroy()` all actors created in `enable()` during `disable()`.
- The extension class must extend `Extension` (from `resource:///org/gnome/shell/extensions/extension.js`).
- Preferences class must extend `ExtensionPreferences` and implement `fillPreferencesWindow(window)`.
- The schema file must be recompiled (`glib-compile-schemas schemas/`) whenever it is changed.
