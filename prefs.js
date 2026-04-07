/* prefs.js – Earth RT Background preferences */

import Adw from "gi://Adw";
import Gio from "gi://Gio";
import Gtk from "gi://Gtk";
import {
  ExtensionPreferences,
  gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

const DISPLAY_MODES = ["rectangular", "globe"];

export default class EarthRtBackgroundPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();

    const page = new Adw.PreferencesPage({
      title: _("General"),
      icon_name: "dialog-information-symbolic",
    });
    window.add(page);

    // ── Display mode ───────────────────────────────────────────────────────

    const displayGroup = new Adw.PreferencesGroup({
      title: _("Display Mode"),
    });
    page.add(displayGroup);

    const modeRow = new Adw.ComboRow({
      title: _("Wallpaper style"),
      subtitle: _("Globe requires python3-cartopy (sudo dnf install python3-cartopy)"),
      model: new Gtk.StringList({
        strings: [_("Rectangular map"), _("Globe")],
      }),
    });
    displayGroup.add(modeRow);

    // ComboRow.selected is a uint index; map to/from the GSettings string
    modeRow.selected = Math.max(
      0,
      DISPLAY_MODES.indexOf(settings.get_string("display-mode")),
    );
    modeRow.connect("notify::selected", () =>
      settings.set_string("display-mode", DISPLAY_MODES[modeRow.selected]),
    );
    settings.connect("changed::display-mode", () => {
      modeRow.selected = Math.max(
        0,
        DISPLAY_MODES.indexOf(settings.get_string("display-mode")),
      );
    });

    // ── Observer location ──────────────────────────────────────────────────

    const locationGroup = new Adw.PreferencesGroup({
      title: _("Observer Location"),
      description: _("Position on Earth at the centre of the view"),
    });
    page.add(locationGroup);

    const latRow = new Adw.SpinRow({
      title: _("Latitude"),
      subtitle: _("−90 (South Pole) to 90 (North Pole)"),
      adjustment: new Gtk.Adjustment({
        lower: -90,
        upper: 90,
        step_increment: 0.1,
        page_increment: 1,
      }),
      digits: 4,
    });
    locationGroup.add(latRow);
    settings.bind("latitude", latRow, "value", Gio.SettingsBindFlags.DEFAULT);

    const lonRow = new Adw.SpinRow({
      title: _("Longitude"),
      subtitle: _("−180 (West) to 180 (East)"),
      adjustment: new Gtk.Adjustment({
        lower: -180,
        upper: 180,
        step_increment: 0.1,
        page_increment: 1,
      }),
      digits: 4,
    });
    locationGroup.add(lonRow);
    settings.bind("longitude", lonRow, "value", Gio.SettingsBindFlags.DEFAULT);

    // ── View settings ──────────────────────────────────────────────────────

    const viewGroup = new Adw.PreferencesGroup({
      title: _("View"),
      description: _("Camera altitude and update frequency"),
    });
    page.add(viewGroup);

    const altRow = new Adw.SpinRow({
      title: _("Altitude (km)"),
      subtitle: _("Height of the virtual observer above the surface"),
      adjustment: new Gtk.Adjustment({
        lower: 100,
        upper: 50000,
        step_increment: 100,
        page_increment: 1000,
      }),
    });
    viewGroup.add(altRow);
    settings.bind(
      "altitude-km",
      altRow,
      "value",
      Gio.SettingsBindFlags.DEFAULT,
    );

    const refreshRow = new Adw.SpinRow({
      title: _("Refresh interval (minutes)"),
      subtitle: _("How often to recompute the day/night terminator"),
      adjustment: new Gtk.Adjustment({
        lower: 1,
        upper: 60,
        step_increment: 1,
        page_increment: 5,
      }),
    });
    viewGroup.add(refreshRow);
    settings.bind(
      "refresh-interval",
      refreshRow,
      "value",
      Gio.SettingsBindFlags.DEFAULT,
    );
  }
}
