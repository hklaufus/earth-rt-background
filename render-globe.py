#!/usr/bin/env python3
"""
render-globe.py  –  Earth wallpaper renderer using cartopy.

Usage:
    python3 render-globe.py SRC DST CENTER_LAT CENTER_LON WIDTH HEIGHT [ALTITUDE_KM [MODE]]

Arguments:
    SRC          Path to the equirectangular day-texture PNG (the cached Blue Marble).
    DST          Output PNG path (will be created / overwritten).
    CENTER_LAT   Latitude of the centre of the view (degrees, −90 to 90).
    CENTER_LON   Longitude of the centre of the view (degrees, −180 to 180).
    WIDTH        Output image width in pixels.
    HEIGHT       Output image height in pixels.
    ALTITUDE_KM  Observer altitude in km (globe mode only, default: 35786).
    MODE         'globe' (default) or 'rect'.

The day/night terminator is computed from the current UTC time via
cartopy.feature.nightshade.Nightshade – no solar coordinates need to be
passed explicitly.

Dependencies (Fedora):
    sudo dnf install python3-cartopy python3-matplotlib
"""

import sys
import math
import datetime

import matplotlib
matplotlib.use('Agg')  # non-interactive backend – must be set before pyplot import
import matplotlib.pyplot as plt
import cartopy.crs as ccrs
from cartopy.feature.nightshade import Nightshade
from matplotlib.image import imread

R_EARTH_KM = 6371.0

# Altitude above which the entire Earth disc fits within the field of view.
# Source: https://starlust.org/how-far-away-in-space-must-an-astronaut-be-to-view-earth-in-its-entirety/
# 22 000 miles ≈ 35 405 km (close to geostationary orbit).
H_FULL_VIEW_KM = 22_000 * 1.60934

# Angular half-radius of Earth as seen from H_FULL_VIEW_KM — used as the FOV reference.
_HALF_FOV_REF = math.asin(R_EARTH_KM / (R_EARTH_KM + H_FULL_VIEW_KM))


def _globe_fill_fraction(altitude_km):
    """
    Return the fraction of the shorter screen dimension the globe disc should occupy.

    fill = 1.0 at H_FULL_VIEW_KM (22 000 miles / ~35 405 km): the globe just fills
    the screen. Above that altitude fill < 1 (complete globe with black surround).
    Below that fill > 1 (axes extend beyond the figure, showing a horizon/flat-earth
    view — the disc is too large to be seen in its entirety).
    """

    # Field of view is 90° total (45° half-angle).
    # fill = 1.0 at h ≈ 2638 km, where Earth's angular half-radius = 45° exactly
    # return math.asin(R_EARTH_KM / (R_EARTH_KM + altitude_km)) / (math.pi / 4)

    return math.asin(R_EARTH_KM / (R_EARTH_KM + altitude_km)) / _HALF_FOV_REF


MAX_RENDER_SCALE = 4.0   # cap internal oversizing to keep memory/time reasonable


def render(src_path, dst_path, center_lat, center_lon, out_w, out_h, altitude_km=35786):
    dpi = 100
    fill = _globe_fill_fraction(altitude_km)

    if fill > 1.0:
        # At low altitude the globe disc is larger than the screen.
        # Render on a larger canvas so the visible central portion gets full
        # pixel resolution, then crop to the target size.
        # The canvas is capped at MAX_RENDER_SCALE × target to limit memory use.
        scale    = min(fill, MAX_RENDER_SCALE)
        render_w = round(scale * out_w)
        render_h = round(scale * out_h)
        axes_rect = [0.0, 0.0, 1.0, 1.0]
    else:
        # Globe fits entirely on screen; centre it with black surround.
        render_w  = out_w
        render_h  = out_h
        w_frac    = fill * min(out_w, out_h) / out_w
        h_frac    = fill * min(out_w, out_h) / out_h
        axes_rect = [(1.0 - w_frac) / 2.0, (1.0 - h_frac) / 2.0, w_frac, h_frac]

    fig = plt.figure(
        figsize=(render_w / dpi, render_h / dpi),
        dpi=dpi,
        facecolor='black',
    )
    ax = fig.add_axes(
        axes_rect,
        projection=ccrs.NearsidePerspective(
            central_longitude=center_lon,
            central_latitude=center_lat,
            satellite_height=altitude_km * 1000,
        ),
        facecolor='black',
    )
    ax.set_global()

    img = imread(src_path)
    ax.imshow(
        img,
        origin='upper',
        extent=[-180, 180, -90, 90],
        transform=ccrs.PlateCarree(),
    )

    ax.add_feature(Nightshade(datetime.datetime.now(datetime.UTC), alpha=0.6))

    if fill > 1.0:
        # Crop the centre out_w × out_h from the larger render canvas.
        from matplotlib.transforms import Bbox
        x0 = (render_w - out_w) / (2 * dpi)
        y0 = (render_h - out_h) / (2 * dpi)
        bbox = Bbox([[x0, y0], [x0 + out_w / dpi, y0 + out_h / dpi]])
        fig.savefig(dst_path, dpi=dpi, bbox_inches=bbox, pad_inches=0, facecolor='black')
    else:
        fig.savefig(dst_path, dpi=dpi, bbox_inches=None, pad_inches=0, facecolor='black')

    plt.close(fig)


def render_rect(src_path, dst_path, out_w, out_h):
    """Render an equirectangular (PlateCarree) world map with the day/night terminator."""
    dpi = 100
    fig = plt.figure(figsize=(out_w / dpi, out_h / dpi), dpi=dpi, facecolor='black')
    ax = fig.add_axes([0, 0, 1, 1], projection=ccrs.PlateCarree(), facecolor='black')
    ax.set_global()

    img = imread(src_path)
    ax.imshow(img, origin='upper', extent=[-180, 180, -90, 90], transform=ccrs.PlateCarree())
    ax.add_feature(Nightshade(datetime.datetime.now(datetime.UTC), alpha=0.6))

    fig.savefig(dst_path, dpi=dpi, bbox_inches=None, pad_inches=0, facecolor='black')
    plt.close(fig)


def main():
    if len(sys.argv) not in (7, 8, 9):
        sys.exit(
            f'Usage: {sys.argv[0]} SRC DST CENTER_LAT CENTER_LON WIDTH HEIGHT [ALTITUDE_KM [MODE]]'
        )

    src, dst = sys.argv[1], sys.argv[2]
    out_w, out_h = int(sys.argv[5]), int(sys.argv[6])

    # argv[7] is altitude (int) and/or argv[8] is mode string
    altitude_km = 35786
    mode = 'globe'
    if len(sys.argv) >= 8:
        try:
            altitude_km = int(sys.argv[7])
        except ValueError:
            mode = sys.argv[7]
    if len(sys.argv) == 9:
        mode = sys.argv[8]

    try:
        if mode == 'rect':
            render_rect(src, dst, out_w, out_h)
        else:
            render(src, dst, float(sys.argv[3]), float(sys.argv[4]), out_w, out_h, altitude_km)
    except Exception as exc:
        sys.exit(f'render-globe error: {exc}')


if __name__ == '__main__':
    main()
