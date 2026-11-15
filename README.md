# Bilal

GNOME Shell extension that shows Muslims prayer times, a countdown to the next prayer in the panel, all five prayers in a dropdown, and a notification when each prayer time begins.

When a prayer's Adhan time arrives, the panel countdown switches to the Iqamah (congregation) time of that prayer — 25 min for Fajr and 20 min for Dhuhr, Asr and Isha, 10 min for Maghrib. A second notification is sent when the Iqamah time arrives, then the countdown resumes for the next prayer. The dropdown shows the Iqamah time next to each prayer's Adhan time.

## Install

    make sync

Builds into `dist/` and installs to `~/.local/share/gnome-shell/extensions/bilal@king.it/`, enabling it. On Wayland, log out and back in for the extension to load.

## Configure

City, country, and calculation method are hard-coded in `extension.ts` — edit and rebuild:

    const CITY = 'Makkah';
    const COUNTRY = 'SA';
    const CALC_METHOD = 4; // Umm Al-Qura University, Makkah

The Iqamah waiting periods (minutes after the Adhan) are hard-coded too:

    const IQAMAH_MINUTES = { Fajr: 25, Dhuhr: 20, Asr: 20, Maghrib: 10, Isha: 20 };

## Development

- `make sync` — build + install locally
- `make pack` — build + zip for the GNOME extensions site
- `make clean` — clean `dist/`, `node_modules/`, `bilal.zip`

## License

MIT
