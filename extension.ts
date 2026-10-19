/**
 * Bilal — GNOME Shell extension.
 *
 * Keeps a live countdown in the top bar showing the remaining time until the
 * next of the five daily prayers in Makkah, Saudi Arabia, and lists all prayer
 * times in the dropdown. A desktop notification is raised when a prayer time
 * starts.
 *
 * Prayer times come from aladhan.com (Umm Al-Qura calculation method), which
 * reports them in Asia/Riyadh local time.
 */

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';
import St from 'gi://St';

// Make libsoup3 async calls awaitable with Promises (standard GJS pattern).
Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');

const PRAYERS = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'] as const;
type PrayerName = typeof PRAYERS[number];

const CITY = 'Makkah';
const COUNTRY = 'SA';
const CALC_METHOD = 4; // 4 = Umm Al-Qura University, Makkah
const TICK_SECONDS = 1;
const RETRY_SECONDS = 30;

/** Minutes since midnight for each of the five prayers. */
type ClockMinutes = Record<PrayerName, number>;

/** NOTE: the date segment is required — /v1/timingsByCity without it replies with an HTTP redirect. */
function timingsUrl(dateStr: string): string {
    return `https://api.aladhan.com/v1/timingsByCity/${dateStr}?city=${CITY}&country=${COUNTRY}&method=${CALC_METHOD}`;
}

function clockToMinutes(hhmm: string): number {
    const [h = '', m = ''] = hhmm.split(':');
    const hour = parseInt(h, 10);
    const minute = parseInt(m, 10);
    if (Number.isNaN(hour) || Number.isNaN(minute)) {
        throw new Error(`malformed time: "${hhmm}"`);
    }
    return hour * 60 + minute;
}

function extractTimings(payload: any): ClockMinutes {
    const src: any = payload?.data?.timings;
    if (!src) {
        throw new Error('unexpected aladhan payload');
    }
    const timings = {} as ClockMinutes;
    for (const name of PRAYERS) {
        timings[name] = clockToMinutes(src[name] ?? '');
    }
    return timings;
}

/** e.g. 353 -> "5:53 AM" */
function format12h(totalMinutes: number): string {
    const hh24 = Math.floor(totalMinutes / 60) % 24;
    const mm = totalMinutes % 60;
    let hh12 = hh24 % 12;
    if (hh12 === 0) {
        hh12 = 12;
    }
    return `${hh12}:${String(mm).padStart(2, '0')} ${hh24 < 12 ? 'AM' : 'PM'}`;
}

/** e.g. 134 -> "2h 14m" */
function formatCountdown(totalMinutes: number): string {
    if (totalMinutes < 1) {
        return '<1m';
    }
    const hh = Math.floor(totalMinutes / 60);
    const mm = totalMinutes % 60;
    return hh > 0 ? `${hh}h ${String(mm).padStart(2, '0')}m` : `${mm}m`;
}

interface NextPrayer {
    name: PrayerName;
    remainingMinutes: number;
}

/** First of the five prayers whose time is still ahead of nowMinutes. */
function nextPrayerOf(timings: ClockMinutes, nowMinutes: number): NextPrayer | null {
    for (const name of PRAYERS) {
        if (timings[name] > nowMinutes) {
            return { name, remainingMinutes: timings[name] - nowMinutes };
        }
    }
    return null;
}

export default class BilalExtension extends Extension {
    private readonly _session = new Soup.Session();

    private _indicator: PanelMenu.Button | null = null;
    private _label: St.Label | null = null;
    private _tickSource = 0;

    // Bumped on disable()/refresh so results of stale requests get discarded.
    private _fetchEpoch = 0;
    // While offline, requests are retried at most once per RETRY_SECONDS.
    private _retryNotBefore = 0;

    private _today: { dateStr: string, timings: ClockMinutes } | null = null;
    private _tomorrow: { dateStr: string, timings: ClockMinutes } | null = null;

    private _nextName: PrayerName | null = null;
    // The dropdown is rebuilt whenever this key changes (date or next prayer).
    private _menuKey = '';
    private _lastLabel = '';

    enable() {
        this._indicator = new PanelMenu.Button(0.0, 'Bilal', false);

        // NOTE: PanelMenu.Button only allocates its first child (see
        // ButtonBox.vfunc_allocate in gnome-shell), so everything shown here
        // must live inside this single box.
        const panelBox = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label = new St.Label({
            text: '…',
            y_align: Clutter.ActorAlign.CENTER,
        });
        panelBox.add_child(this._label);
        this._indicator.add_child(panelBox);
        Main.panel.addToStatusArea('bilal', this._indicator);

        this._tick();
        this._tickSource = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, TICK_SECONDS, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    disable() {
        if (this._tickSource !== 0) {
            GLib.source_remove(this._tickSource);
            this._tickSource = 0;
        }
        this._fetchEpoch++; // discard any in-flight request

        this._indicator?.destroy();
        this._indicator = null;
        this._label = null;
        this._today = null;
        this._tomorrow = null;
        this._nextName = null;
        this._menuKey = '';
        this._lastLabel = '';
    }

    private _tick() {
        const now = GLib.DateTime.new_now_local();
        const dateStr = now.format('%d-%m-%Y') ?? '';
        const nowMinutes = now.get_hour() * 60 + now.get_minute();

        // Refresh today's times on first run and on date rollover.
        if (!this._today || this._today.dateStr !== dateStr) {
            this._fetch(dateStr, false);
        }

        const next = this._nextPrayer(now, dateStr, nowMinutes);

        // Top bar label — only rewritten when the text actually changes.
        let text: string;
        if (next) {
            text = `${next.name} in ${formatCountdown(next.remainingMinutes)}`;
        } else {
            text = Date.now() < this._retryNotBefore ? 'no network' : '…';
        }
        if (text !== this._lastLabel) {
            this._label?.set_text(text);
            this._lastLabel = text;
        }

        // Dropdown — rebuilt when the date or the highlighted prayer changes.
        const menuKey = `${dateStr}|${next?.name ?? ''}`;
        if (this._today && menuKey !== this._menuKey) {
            this._menuKey = menuKey;
            this._rebuildMenu(next?.name ?? null);
        }

        // When the countdown moves past a prayer, announce that prayer started.
        if (next && next.name !== this._nextName) {
            const starting: PrayerName | null = this._nextName;
            this._nextName = next.name;
            if (starting !== null) {
                Main.notify(
                    `🕌 Time for ${starting}`,
                    `The ${starting} prayer has begun in ${CITY}.`,
                );
            }
        }
    }

    private _nextPrayer(now: GLib.DateTime, dateStr: string, nowMinutes: number): NextPrayer | null {
        if (this._today && this._today.dateStr === dateStr) {
            const next = nextPrayerOf(this._today.timings, nowMinutes);
            if (next) {
                return next;
            }
        }

        // All of today's five prayers have passed — the next one is tomorrow's Fajr.
        const tomorrowStr = now.add_days(1)?.format('%d-%m-%Y') ?? '';
        if (!this._tomorrow || this._tomorrow.dateStr !== tomorrowStr) {
            this._fetch(tomorrowStr, true);
        }
        // Until tomorrow's data arrives, approximate with today's Fajr time
        // (drifts by roughly one minute per day).
        const fajrSrc = this._tomorrow?.dateStr === tomorrowStr ? this._tomorrow.timings : this._today?.timings;
        if (fajrSrc) {
            return { name: 'Fajr', remainingMinutes: (24 * 60 - nowMinutes) + fajrSrc.Fajr };
        }
        return null;
    }

    private async _fetch(dateStr: string, isTomorrow: boolean) {
        if (Date.now() < this._retryNotBefore) {
            return;
        }
        this._retryNotBefore = Date.now() + RETRY_SECONDS * 1000;
        const epoch = ++this._fetchEpoch;

        try {
            const message = Soup.Message.new('GET', timingsUrl(dateStr));
            if (!message) {
                throw new Error('could not create request');
            }
            const bytes = await this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
            if (epoch !== this._fetchEpoch) {
                return; // request superseded or extension disabled meanwhile
            }
            const status = message.get_status();
            if (bytes == null || status !== Soup.Status.OK) {
                throw new Error(`HTTP ${status}`);
            }
            const jsonText = new TextDecoder().decode(bytes.get_data() ?? new Uint8Array());
            const timings = extractTimings(JSON.parse(jsonText));

            if (isTomorrow) {
                this._tomorrow = { dateStr, timings };
            } else {
                this._today = { dateStr, timings };
            }
            this._retryNotBefore = 0;
            this._lastLabel = ''; // force label refresh on next tick
            this._menuKey = '';   // force menu rebuild on next tick
        } catch (err) {
            if (epoch !== this._fetchEpoch) {
                return;
            }
            console.warn(`bilal: fetch failed: ${String(err)}`);
        }
    }

    private _rebuildMenu(nextName: PrayerName | null) {
        if (!this._indicator || !this._today) {
            return;
        }
        const menu = this._indicator.menu as PopupMenu.PopupMenu;
        menu.removeAll();

        const header = new PopupMenu.PopupMenuItem(`${CITY}, ${COUNTRY} — ${this._today.dateStr}`, {
            reactive: false,
        });
        header.label.add_style_class_name('prayer-header');
        menu.addMenuItem(header);

        for (const name of PRAYERS) {
            const item = new PopupMenu.PopupMenuItem(name, { reactive: false });

            const timeLabel = new St.Label({
                text: format12h(this._today.timings[name]),
                x_expand: true,
                x_align: Clutter.ActorAlign.END,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'prayer-time',
            });
            item.add_child(timeLabel);

            if (name === nextName) {
                item.setOrnament(PopupMenu.Ornament.DOT);
                item.label.add_style_class_name('prayer-next-name');
            }
            menu.addMenuItem(item);
        }

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const refresh = new PopupMenu.PopupMenuItem('Refresh prayer times');
        refresh.connect('activate', () => {
            this._fetchEpoch++;       // drop in-flight requests
            this._retryNotBefore = 0; // retry right away
            this._today = null;
            this._tomorrow = null;
            this._tick();
        });
        menu.addMenuItem(refresh);
    }
}
