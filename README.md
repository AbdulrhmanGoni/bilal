# Bilal

GNOME Shell extension that shows Muslims prayer times, a countdown to the next prayer in the panel, all five prayers in a dropdown, and a notification when each prayer time begins.

## Install

    make sync

Builds into `dist/` and installs to `~/.local/share/gnome-shell/extensions/bilal@king.it/`, enabling it. On Wayland, log out and back in for the extension to load.

## Configure

City, country, and calculation method are hard-coded in `extension.ts` — edit and rebuild:

    const CITY = 'Makkah';
    const COUNTRY = 'SA';
    const CALC_METHOD = 4; // Umm Al-Qura University, Makkah

## Development

- `make sync` — build + install locally
- `make pack` — build + zip for the GNOME extensions site
- `make clean` — clean `dist/`, `node_modules/`, `bilal.zip`

## License

MIT
