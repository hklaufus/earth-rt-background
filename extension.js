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
const RECT_IMAGE_PATH = GLib.build_filenamev([CACHE_DIR, "rect.png"]);

// ---------- Extension ----------

export default class EarthRtBackground extends Extension {
  enable() {
    this._settings = this.getSettings();
    this._timeoutId = null;
    this._httpSession = null;
    this._renderSubprocess = null;

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
      this._settings.connect("changed::altitude-km", () =>
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

    if (this._renderSubprocess) {
      this._renderSubprocess.force_exit();
      this._renderSubprocess = null;
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
    if (mode === "globe") {
      this._ensureDayImage(() => this._renderGlobe());
    } else {
      this._ensureDayImage(() => this._renderRect());
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

  // ---------- Rendering ----------

  _renderGlobe() {
    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor) return;

    const centerLat = this._settings.get_double("latitude");
    const centerLon = this._settings.get_double("longitude");
    const altitudeKm = this._settings.get_int("altitude-km");

    this._spawnRenderer(
      [
        DAY_IMAGE_PATH, GLOBE_IMAGE_PATH,
        String(centerLat), String(centerLon),
        String(monitor.width), String(monitor.height),
        String(altitudeKm), "globe",
      ],
      () => this._setRenderedWallpaper(GLOBE_IMAGE_PATH),
    );
  }

  _renderRect() {
    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor) return;

    this._spawnRenderer(
      [
        DAY_IMAGE_PATH, RECT_IMAGE_PATH,
        "0", "0",
        String(monitor.width), String(monitor.height),
        "0", "rect",
      ],
      () => this._setRenderedWallpaper(RECT_IMAGE_PATH),
    );
  }

  _spawnRenderer(args, onSuccess) {
    // Cancel any in-flight render before starting a new one
    if (this._renderSubprocess) {
      this._renderSubprocess.force_exit();
      this._renderSubprocess = null;
    }

    const scriptPath = GLib.build_filenamev([this.path, "render-globe.py"]);

    try {
      this._renderSubprocess = Gio.Subprocess.new(
        ["python3", scriptPath, ...args],
        Gio.SubprocessFlags.NONE,
      );
    } catch (e) {
      console.error(`${this.metadata.name}: failed to spawn renderer: ${e}`);
      return;
    }

    this._renderSubprocess.wait_async(null, (_proc, result) => {
      try {
        _proc.wait_finish(result);
      } catch (e) {
        console.error(`${this.metadata.name}: renderer wait failed: ${e}`);
        return;
      }

      this._renderSubprocess = null;

      if (_proc.get_successful()) {
        onSuccess();
      } else {
        console.error(
          `${this.metadata.name}: render-globe.py exited with an error – ` +
            `is python3-cartopy installed?`,
        );
      }
    });
  }

  _setRenderedWallpaper(imagePath) {
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
