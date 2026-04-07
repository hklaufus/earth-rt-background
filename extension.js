/* extension.js – Earth RT Background */
"use strict";

import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Soup from "gi://Soup";
import St from "gi://St";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";

import {
  Extension,
  gettext as _,
} from "resource:///org/gnome/shell/extensions/extension.js";

// NASA Scientific Visualization Studio – Blue Marble 2048 × 1024 PNG
const DAY_IMAGE_URL =
  "https://svs.gsfc.nasa.gov/vis/a000000/a002900/a002915/bluemarble-2048.png";

const CACHE_DIR = GLib.build_filenamev([
  GLib.get_user_cache_dir(),
  "earth-rt-background",
]);
const DAY_IMAGE_PATH = GLib.build_filenamev([CACHE_DIR, "day.png"]);
const GLOBE_IMAGE_PATH = GLib.build_filenamev([CACHE_DIR, "globe.png"]);

// Pixel dimensions of the equirectangular source image
const IMAGE_W = 2048;
const IMAGE_H = 1024;

// ---------- Solar geometry (rectangular mode only) ----------

/**
 * Return the sub-solar point (lat/lon where the Sun is overhead).
 * Used to position the CSS night overlay in rectangular mode.
 * Compact NOAA Solar Calculator approximation.
 */
function getSubSolarPoint(date = new Date()) {
  const jd = date / 86_400_000 + 2_440_587.5;
  const n = jd - 2_451_545.0;
  const L = (280.46 + 0.985_647_4 * n) % 360;
  const g = (357.528 + 0.985_600_3 * n) % 360;
  const lambda =
    L +
    1.915 * Math.sin((g * Math.PI) / 180) +
    0.02 * Math.sin((2 * g * Math.PI) / 180);
  const eps = 23.439 - 0.000_000_4 * n;
  const decl =
    (Math.asin(
      Math.sin((eps * Math.PI) / 180) * Math.sin((lambda * Math.PI) / 180),
    ) *
      180) /
    Math.PI;
  const ra =
    (Math.atan2(
      Math.cos((eps * Math.PI) / 180) * Math.sin((lambda * Math.PI) / 180),
      Math.cos((lambda * Math.PI) / 180),
    ) *
      180) /
    Math.PI;
  const gmst = (18.697_374_558 + 24.065_709_824_419_08 * n) % 24;
  const hourAngle = gmst * 15 - ra;
  return {
    lat: decl,
    lon: ((-hourAngle + 540) % 360) - 180,
  };
}

// ---------- Night overlay CSS (rectangular mode only) ----------

/**
 * Build the inline CSS for the night-side overlay widget.
 * Maps the anti-solar point from equirectangular image space to screen space,
 * compensating for GNOME's "zoom" (cover) wallpaper scaling.
 */
function buildNightOverlayCss(subSolar, monitor) {
  const night = {
    lat: -subSolar.lat,
    lon: ((subSolar.lon + 180) % 360) - 180,
  };

  const nx = (night.lon + 180) / 360;
  const ny = (90 - night.lat) / 180;

  const scale = Math.max(monitor.width / IMAGE_W, monitor.height / IMAGE_H);
  const scaledW = IMAGE_W * scale;
  const scaledH = IMAGE_H * scale;
  const cropX = (scaledW - monitor.width) / 2;
  const cropY = (scaledH - monitor.height) / 2;

  const sx = Math.round(nx * scaledW - cropX);
  const sy = Math.round(ny * scaledH - cropY);
  const r = Math.round((IMAGE_W / 2) * scale);

  return (
    `background-image: radial-gradient(` +
    `circle ${r}px at ${sx}px ${sy}px, ` +
    `rgba(0,0,0,0.88) 0%, ` +
    `rgba(0,0,0,0.75) 30%, ` +
    `rgba(0,0,0,0) 60%);`
  );
}

// ---------- Extension ----------

export default class EarthRtBackground extends Extension {
  enable() {
    this._settings = this.getSettings();
    this._timeoutId = null;
    this._nightOverlay = null;
    this._httpSession = null;
    this._globeSubprocess = null;
    this._currentMode = null;   // tracks the active mode to detect transitions
    this._rectWallpaperSet = false;

    // Save the current wallpaper so disable() can restore it
    const bgSettings = new Gio.Settings({
      schema: "org.gnome.desktop.background",
    });
    this._prevUri = bgSettings.get_string("picture-uri");
    this._prevUriDark = bgSettings.get_string("picture-uri-dark");
    this._prevOptions = bgSettings.get_string("picture-options");
    this._prevPrimaryColor = bgSettings.get_string("primary-color");

    // Panel indicator
    this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);
    this._indicator.add_child(
      new St.Icon({
        icon_name: "weather-clear-symbolic",
        style_class: "system-status-icon",
      }),
    );
    this._indicator.menu.addAction(_("Preferences"), () =>
      this.openPreferences(),
    );
    this._indicator.menu.addAction(_("Update now"), () =>
      this._updateWallpaper(),
    );
    Main.panel.addToStatusArea(this.uuid, this._indicator);

    // Settings signal connections (stored as an array for clean bulk-disconnect)
    this._settingsSignals = [
      this._settings.connect("changed::refresh-interval", () =>
        this._rescheduleRefresh(),
      ),
      this._settings.connect("changed::display-mode", () =>
        this._updateWallpaper(),
      ),
      this._settings.connect("changed::latitude", () =>
        this._updateWallpaper(),
      ),
      this._settings.connect("changed::longitude", () =>
        this._updateWallpaper(),
      ),
    ];

    GLib.mkdir_with_parents(CACHE_DIR, 0o755);

    this._scheduleRefresh();
  }

  disable() {
    this._settingsSignals.forEach((id) => this._settings.disconnect(id));
    this._settingsSignals = [];

    if (this._timeoutId) {
      GLib.source_remove(this._timeoutId);
      this._timeoutId = null;
    }

    if (this._globeSubprocess) {
      this._globeSubprocess.force_exit();
      this._globeSubprocess = null;
    }

    if (this._nightOverlay) {
      this._nightOverlay.destroy();
      this._nightOverlay = null;
    }

    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
    }

    // Restore the wallpaper that was active before the extension ran
    const bgSettings = new Gio.Settings({
      schema: "org.gnome.desktop.background",
    });
    bgSettings.set_string("picture-uri", this._prevUri);
    bgSettings.set_string("picture-uri-dark", this._prevUriDark);
    bgSettings.set_string("picture-options", this._prevOptions);
    bgSettings.set_string("primary-color", this._prevPrimaryColor);

    this._httpSession = null;
    this._settings = null;
  }

  // ---------- Night overlay (rectangular mode) ----------

  _createNightOverlay() {
    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor) return;

    this._nightOverlay = new St.Widget({
      reactive: false,
      can_focus: false,
      track_hover: false,
    });
    this._nightOverlay.set_position(monitor.x, monitor.y);
    this._nightOverlay.set_size(monitor.width, monitor.height);

    Main.layoutManager._backgroundGroup.add_child(this._nightOverlay);
    this._updateNightOverlay();
  }

  _updateNightOverlay() {
    if (!this._nightOverlay) return;
    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor) return;

    this._nightOverlay.set_style(
      buildNightOverlayCss(getSubSolarPoint(new Date()), monitor),
    );
  }

  // ---------- Scheduling ----------

  _scheduleRefresh() {
    this._updateWallpaper();
    this._armTimer();
  }

  _rescheduleRefresh() {
    if (this._timeoutId) {
      GLib.source_remove(this._timeoutId);
      this._timeoutId = null;
    }
    this._armTimer();
  }

  _armTimer() {
    const intervalSec = this._settings.get_int("refresh-interval") * 60;
    this._timeoutId = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      intervalSec,
      () => {
        this._updateWallpaper();
        return GLib.SOURCE_CONTINUE;
      },
    );
  }

  // ---------- Wallpaper update ----------

  _updateWallpaper() {
    const mode = this._settings.get_string("display-mode");

    // Handle mode transitions
    if (mode !== this._currentMode) {
      this._currentMode = mode;
      this._rectWallpaperSet = false;

      if (mode === "rectangular") {
        if (!this._nightOverlay) this._createNightOverlay();
      } else {
        if (this._nightOverlay) {
          this._nightOverlay.destroy();
          this._nightOverlay = null;
        }
      }
    }

    if (mode === "globe") {
      // Globe: re-render on every tick (sub-solar point moves over time)
      this._ensureDayImage(() => this._renderGlobe());
    } else {
      // Rectangular: update CSS overlay every tick; set wallpaper image once
      this._updateNightOverlay();
      if (!this._rectWallpaperSet) {
        this._ensureDayImage(() => {
          this._setWallpaper(DAY_IMAGE_PATH);
          this._rectWallpaperSet = true;
        });
      }
    }
  }

  // ---------- Day image (shared by both modes) ----------

  _ensureDayImage(onReady) {
    if (Gio.File.new_for_path(DAY_IMAGE_PATH).query_exists(null)) {
      onReady();
    } else {
      this._downloadDayImage(onReady);
    }
  }

  _downloadDayImage(onComplete) {
    if (!this._httpSession) this._httpSession = new Soup.Session();

    const message = Soup.Message.new("GET", DAY_IMAGE_URL);
    this._httpSession.send_async(
      message,
      GLib.PRIORITY_DEFAULT,
      null,
      (session, result) => {
        let inputStream;
        try {
          inputStream = session.send_finish(result);
        } catch (e) {
          console.error(`${this.metadata.name}: download failed: ${e}`);
          return;
        }

        const outFile = Gio.File.new_for_path(DAY_IMAGE_PATH);
        let outputStream;
        try {
          outputStream = outFile.replace(
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            null,
          );
        } catch (e) {
          console.error(`${this.metadata.name}: cannot open cache file: ${e}`);
          return;
        }

        outputStream.splice_async(
          inputStream,
          Gio.OutputStreamSpliceFlags.CLOSE_SOURCE |
            Gio.OutputStreamSpliceFlags.CLOSE_TARGET,
          GLib.PRIORITY_DEFAULT,
          null,
          (_stream, spliceResult) => {
            try {
              _stream.splice_finish(spliceResult);
              onComplete();
            } catch (e) {
              console.error(
                `${this.metadata.name}: failed to write image: ${e}`,
              );
            }
          },
        );
      },
    );
  }

  // ---------- Rectangular wallpaper ----------

  _setWallpaper(imagePath) {
    const uri = Gio.File.new_for_path(imagePath).get_uri();
    const bgSettings = new Gio.Settings({
      schema: "org.gnome.desktop.background",
    });
    bgSettings.set_string("picture-uri", uri);
    bgSettings.set_string("picture-uri-dark", uri);
    bgSettings.set_string("picture-options", "zoom");
  }

  // ---------- Globe rendering ----------

  _renderGlobe() {
    // Cancel any in-flight render before starting a new one
    if (this._globeSubprocess) {
      this._globeSubprocess.force_exit();
      this._globeSubprocess = null;
    }

    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor) return;

    const centerLat = this._settings.get_double("latitude");
    const centerLon = this._settings.get_double("longitude");
    const scriptPath = GLib.build_filenamev([this.path, "render-globe.py"]);

    try {
      this._globeSubprocess = Gio.Subprocess.new(
        [
          "python3",
          scriptPath,
          DAY_IMAGE_PATH,
          GLOBE_IMAGE_PATH,
          String(centerLat),
          String(centerLon),
          String(monitor.width),
          String(monitor.height),
        ],
        Gio.SubprocessFlags.NONE,
      );
    } catch (e) {
      console.error(`${this.metadata.name}: failed to spawn renderer: ${e}`);
      return;
    }

    this._globeSubprocess.wait_async(null, (_proc, result) => {
      try {
        _proc.wait_finish(result);
      } catch (e) {
        console.error(`${this.metadata.name}: renderer wait failed: ${e}`);
        return;
      }

      this._globeSubprocess = null;

      if (_proc.get_successful()) {
        this._setGlobeWallpaper(GLOBE_IMAGE_PATH);
      } else {
        console.error(
          `${this.metadata.name}: render-globe.py exited with an error – ` +
            `is python3-cartopy installed?`,
        );
      }
    });
  }

  _setGlobeWallpaper(imagePath) {
    const uri = Gio.File.new_for_path(imagePath).get_uri();
    const bgSettings = new Gio.Settings({
      schema: "org.gnome.desktop.background",
    });
    bgSettings.set_string("picture-uri", uri);
    bgSettings.set_string("picture-uri-dark", uri);
    bgSettings.set_string("picture-options", "centered");
    bgSettings.set_string("primary-color", "#000000");
  }
}
