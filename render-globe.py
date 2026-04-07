#!/usr/bin/env python3
"""
render-globe.py  –  Orthographic Earth globe using cartopy.

Usage:
    python3 render-globe.py SRC DST CENTER_LAT CENTER_LON WIDTH HEIGHT

Arguments:
    SRC         Path to the equirectangular day-texture PNG (the cached Blue Marble).
    DST         Output PNG path (will be created / overwritten).
    CENTER_LAT  Latitude of the centre of the view (degrees, −90 to 90).
    CENTER_LON  Longitude of the centre of the view (degrees, −180 to 180).
    WIDTH       Output image width in pixels.
    HEIGHT      Output image height in pixels.

The day/night terminator is computed from the current UTC time via
cartopy.feature.nightshade.Nightshade – no solar coordinates need to be
passed explicitly.

Dependencies (Fedora):
    sudo dnf install python3-cartopy python3-matplotlib
"""

import sys
import datetime

import matplotlib
matplotlib.use('Agg')  # non-interactive backend – must be set before pyplot import
import matplotlib.pyplot as plt
import cartopy.crs as ccrs
from cartopy.feature.nightshade import Nightshade
from matplotlib.image import imread


def render(src_path, dst_path, center_lat, center_lon, out_w, out_h):
    dpi = 100
    fig = plt.figure(
        figsize=(out_w / dpi, out_h / dpi),
        dpi=dpi,
        facecolor='black',
    )

    ax = fig.add_axes(
        [0, 0, 1, 1],
        projection=ccrs.Orthographic(
            central_longitude=center_lon,
            central_latitude=center_lat,
        ),
        facecolor='black',
    )
    ax.set_global()  # show the full visible hemisphere

    # Blue Marble day texture
    img = imread(src_path)
    ax.imshow(
        img,
        origin='upper',
        extent=[-180, 180, -90, 90],
        transform=ccrs.PlateCarree(),
        aspect='auto',
    )

    # Day/night terminator computed from current UTC time (timezone-aware)
    ax.add_feature(Nightshade(datetime.datetime.now(datetime.UTC), alpha=0.6))

    fig.savefig(
        dst_path,
        dpi=dpi,
        bbox_inches=None,
        pad_inches=0,
        facecolor='black',
    )
    plt.close(fig)


def main():
    if len(sys.argv) != 7:
        sys.exit(
            f'Usage: {sys.argv[0]} SRC DST CENTER_LAT CENTER_LON WIDTH HEIGHT'
        )
    try:
        render(
            sys.argv[1],
            sys.argv[2],
            float(sys.argv[3]),
            float(sys.argv[4]),
            int(sys.argv[5]),
            int(sys.argv[6]),
        )
    except Exception as exc:
        sys.exit(f'render-globe error: {exc}')


if __name__ == '__main__':
    main()
