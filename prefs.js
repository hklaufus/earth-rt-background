/* prefs.js – Earth RT Background preferences */

import Adw from "gi://Adw";
import Gio from "gi://Gio";
import Gtk from "gi://Gtk";
import {
  ExtensionPreferences,
  gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

const DISPLAY_MODES = ["rectangular", "globe"];

// Major world cities used as quick-select location presets, sorted alphabetically.
// The first entry is a placeholder; selecting it is a no-op.
const CITIES = [
  { name: "— select city —", lat: null,     lon: null      },
  { name: "Amsterdam",        lat:  52.3676, lon:   4.9041  },
  { name: "Auckland",         lat: -36.8485, lon: 174.7633  },
  { name: "Bangkok",          lat:  13.7563, lon: 100.5018  },
  { name: "Beijing",          lat:  39.9042, lon: 116.4074  },
  { name: "Berlin",           lat:  52.5200, lon:  13.4050  },
  { name: "Brussels",         lat:  50.8503, lon:   4.3517  },
  { name: "Buenos Aires",     lat: -34.6037, lon: -58.3816  },
  { name: "Cairo",            lat:  30.0444, lon:  31.2357  },
  { name: "Chicago",          lat:  41.8781, lon: -87.6298  },
  { name: "Delhi",            lat:  28.7041, lon:  77.1025  },
  { name: "Dubai",            lat:  25.2048, lon:  55.2708  },
  { name: "Jakarta",          lat:  -6.2088, lon: 106.8456  },
  { name: "Johannesburg",     lat: -26.2041, lon:  28.0473  },
  { name: "Kyiv",             lat:  50.4501, lon:  30.5234  },
  { name: "Lagos",            lat:   6.5244, lon:   3.3792  },
  { name: "Lima",             lat: -12.0464, lon: -77.0428  },
  { name: "London",           lat:  51.5074, lon:  -0.1278  },
  { name: "Los Angeles",      lat:  34.0522, lon: -118.2437 },
  { name: "Madrid",           lat:  40.4168, lon:  -3.7038  },
  { name: "Melbourne",        lat: -37.8136, lon: 144.9631  },
  { name: "Mexico City",      lat:  19.4326, lon: -99.1332  },
  { name: "Moscow",           lat:  55.7558, lon:  37.6173  },
  { name: "Mumbai",           lat:  19.0760, lon:  72.8777  },
  { name: "Nairobi",          lat:  -1.2921, lon:  36.8219  },
  { name: "New York",         lat:  40.7128, lon: -74.0060  },
  { name: "Paris",            lat:  48.8566, lon:   2.3522  },
  { name: "Rome",             lat:  41.9028, lon:  12.4964  },
  { name: "São Paulo",        lat: -23.5505, lon: -46.6333  },
  { name: "Seoul",            lat:  37.5665, lon: 126.9780  },
  { name: "Shanghai",         lat:  31.2304, lon: 121.4737  },
  { name: "Singapore",        lat:   1.3521, lon: 103.8198  },
  { name: "Sydney",           lat: -33.8688, lon: 151.2093  },
  { name: "Tokyo",            lat:  35.6762, lon: 139.6503  },
  { name: "Toronto",          lat:  43.6532, lon: -79.3832  },
  { name: "Warsaw",           lat:  52.2297, lon:  21.0122  },
];

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

    // Gtk.DropDown with enable_search gives a native filterable list:
    // clicking the button opens a popup with a search field that narrows
    // the city list as the user types (substring match).
    const cityDropDown = new Gtk.DropDown({
      model: new Gtk.StringList({ strings: CITIES.map((c) => c.name) }),
      expression: Gtk.PropertyExpression.new(Gtk.StringObject, null, "string"),
      enable_search: true,
      search_match_mode: Gtk.StringFilterMatchMode.SUBSTRING,
      selected: 0,
      valign: Gtk.Align.CENTER,
    });

    const cityRow = new Adw.ActionRow({
      title: _("City"),
      subtitle: _("Select a city to fill in latitude and longitude"),
      activatable_widget: cityDropDown,
    });
    cityRow.add_suffix(cityDropDown);
    locationGroup.add(cityRow);

    cityDropDown.connect("notify::selected", () => {
      const city = CITIES[cityDropDown.selected];
      if (city.lat !== null) {
        settings.set_double("latitude", city.lat);
        settings.set_double("longitude", city.lon);
      }
    });

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
