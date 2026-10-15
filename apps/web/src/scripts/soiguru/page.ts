/**
 * SoiGuru page script (runs on every SoiGuru screen, ~2 KB).
 *
 * Static HTML cannot know the visitor's time or position, so this fills in:
 * - open status sentences from `data-hours` (city time zone from `body[data-tz]`),
 * - today's row in the hours table,
 * - "Updated by the owner 3 days ago" from `data-updated-at`,
 * - distances when location permission is already granted (or after "Near me"),
 * - the "Open now" short list on the city home,
 * - the EN / ไทย language swap of every `[data-th]` text, remembered on the device.
 *
 * Other scripts listen for `sg:refresh` (statuses recomputed) and `sg:location`.
 */

import { localClock, openStatus, parseHours, type Lang } from '../../lib/soiguru/hours';
import { distanceMetres, formatDistance, walkingMinutes, type LatLng } from '../../lib/soiguru/geo';

const LANG_KEY = 'sg-lang';
const STALE_DAYS = 90;
const timeZone = document.body.dataset['tz'] || 'Asia/Bangkok';

/** The visitor's position once known. */
export let visitor: LatLng | null = null;

function readLang(): Lang {
    try {
        return localStorage.getItem(LANG_KEY) === 'th' ? 'th' : 'en';
    } catch {
        return 'en';
    }
}

let lang: Lang = readLang();

/** Swap `[data-th]` texts to the current language. The English text is kept in `data-en`. */
function applyLang(): void {
    document.documentElement.lang = lang;
    document.documentElement.dataset['lang'] = lang;
    for (const el of document.querySelectorAll<HTMLElement>('[data-th]')) {
        if (el.dataset['en'] === undefined) el.dataset['en'] = el.textContent ?? '';
        const text = lang === 'th' ? el.dataset['th'] : el.dataset['en'];
        if (text !== undefined && el.textContent !== text) el.textContent = text;
    }
    for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-lang-set]')) {
        const on = btn.dataset['langSet'] === lang;
        btn.classList.toggle('tkg-on', on);
        btn.setAttribute('aria-pressed', String(on));
    }
}

/** True when an unclaimed listing's hours are older than 90 days (shown as "not confirmed"). */
function isStale(el: HTMLElement, now: number): boolean {
    if (el.dataset['claimed'] === '1') return false;
    const updated = Date.parse(el.dataset['updated'] ?? '');
    return Number.isFinite(updated) && now - updated > STALE_DAYS * 86_400_000;
}

/** Recompute every open status on the page. */
function refreshStatuses(): void {
    const now = new Date();
    const clock = localClock(now, timeZone);
    for (const el of document.querySelectorAll<HTMLElement>('[data-status][data-hours]')) {
        let hours = null;
        try {
            hours = isStale(el, now.getTime()) ? null : parseHours(JSON.parse(el.dataset['hours'] ?? 'null'));
        } catch {
            hours = null;
        }
        const status = openStatus(hours, clock, lang);
        el.textContent = status.text;
        el.className = el.className.replace(/\btkg-status-(open|soon|closed|unknown)\b/g, '').trim();
        el.classList.add(`tkg-status-${status.state}`);
        el.dataset['state'] = status.state;
        // The card (or bar) carrying this status exposes it for filters.
        const card = el.closest<HTMLElement>('[data-listing]');
        if (card) card.dataset['open'] = status.isOpen ? '1' : '0';
    }
    // Today's row in hours tables.
    for (const row of document.querySelectorAll<HTMLTableRowElement>('[data-hours-table] tr[data-days]')) {
        const today = (row.dataset['days'] ?? '').split(' ').includes(clock.day);
        row.classList.toggle('tkg-today', today);
        const label = row.querySelector<HTMLElement>('.sg-today-label');
        if (label) label.hidden = !today;
    }
    // Local time line on the city home.
    for (const el of document.querySelectorAll<HTMLElement>('[data-local-time]')) {
        el.textContent = new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', {
            timeZone,
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23'
        }).format(now);
    }
    refreshUpdated(now);
    refreshOpenNow();
    document.dispatchEvent(new CustomEvent('sg:refresh'));
}

/** "Updated by the owner 3 days ago". */
function refreshUpdated(now: Date): void {
    const rtf = new Intl.RelativeTimeFormat(lang === 'th' ? 'th' : 'en', { numeric: 'auto' });
    for (const el of document.querySelectorAll<HTMLElement>('[data-updated-at]')) {
        const at = Date.parse(el.dataset['updatedAt'] ?? '');
        if (!Number.isFinite(at)) continue;
        const days = Math.round((at - now.getTime()) / 86_400_000);
        const when = Math.abs(days) < 30 ? rtf.format(days, 'day') : rtf.format(Math.round(days / 30), 'month');
        const who =
            el.dataset['updatedBy'] === 'owner'
                ? lang === 'th'
                    ? 'อัปเดตโดยเจ้าของ'
                    : 'Updated by the owner'
                : lang === 'th'
                  ? 'อัปเดต'
                  : 'Updated';
        el.textContent = `${who} ${when}`;
    }
}

/** City home: keep the first N open (or closing soon) cards of the "Open now" list. */
function refreshOpenNow(): void {
    for (const section of document.querySelectorAll<HTMLElement>('[data-open-now]')) {
        const limit = Number(section.dataset['limit'] ?? 3);
        const cards = [...section.querySelectorAll<HTMLElement>('[data-listing]')];
        const open = cards.filter((c) => c.dataset['open'] === '1');
        const shown = new Set(open.slice(0, limit));
        for (const c of cards) c.hidden = !shown.has(c);
        const count = section.querySelector<HTMLElement>('[data-open-count]');
        if (count) count.textContent = String(open.length);
        const empty = section.querySelector<HTMLElement>('[data-open-empty]');
        if (empty) empty.hidden = open.length > 0;
    }
}

/** Fill `[data-distance]` on cards and listing pages once the position is known. */
function refreshDistances(): void {
    if (!visitor) return;
    for (const el of document.querySelectorAll<HTMLElement>('[data-lat][data-lng]')) {
        const point = { lat: Number(el.dataset['lat']), lng: Number(el.dataset['lng']) };
        if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue;
        const metres = distanceMetres(visitor, point);
        el.dataset['metres'] = String(Math.round(metres));
        const boat = el.dataset['boat'] === '1' ? ' · boat' : '';
        const target = el.querySelector<HTMLElement>('[data-distance]') ?? (el.matches('[data-distance]') ? el : null);
        if (!target) continue;
        target.textContent =
            target.dataset['walk'] !== undefined
                ? ` · ${formatDistance(metres)} from you · ${walkingMinutes(metres)} min walk${boat}`
                : `${formatDistance(metres)}${boat}`;
    }
}

/** Ask for the visitor's position (only after a tap, or when already granted). */
export function locate(): Promise<LatLng | null> {
    return new Promise((resolve) => {
        if (!('geolocation' in navigator)) return resolve(null);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                visitor = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                refreshDistances();
                document.dispatchEvent(new CustomEvent('sg:location', { detail: visitor }));
                resolve(visitor);
            },
            () => resolve(null),
            { maximumAge: 300_000, timeout: 10_000 }
        );
    });
}

async function locateIfGranted(): Promise<void> {
    try {
        const status = await navigator.permissions?.query({ name: 'geolocation' });
        if (status?.state === 'granted') await locate();
    } catch {
        // Permissions API not available: wait for a tap on "Near me".
    }
}

document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const langBtn = target?.closest<HTMLElement>('[data-lang-set]');
    if (langBtn) {
        lang = langBtn.dataset['langSet'] === 'th' ? 'th' : 'en';
        try {
            localStorage.setItem(LANG_KEY, lang);
        } catch {
            // Private mode: the choice lasts for this page only.
        }
        applyLang();
        refreshStatuses();
    }
});

/** Current UI language (for other scripts). */
export function currentLang(): Lang {
    return lang;
}

applyLang();
refreshStatuses();
void locateIfGranted();
// Statuses change with the clock; once a minute is plenty.
setInterval(refreshStatuses, 60_000);
