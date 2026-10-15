/**
 * Opening hours: parsing, the weekly table, and the live "open now" status.
 *
 * Shared by the server (table rows, JSON-LD) and the browser (status, which depends on
 * the visitor's current time and so can never be baked into static HTML).
 *
 * Data contract (`soiguru-data` README): `hours` maps `mon`…`sun` to a list of
 * `"HH:MM-HH:MM"` ranges on a 24-hour clock. `[]` means closed that day, two ranges is a
 * split day, `00:00-24:00` is open around the clock, and a close time before the open
 * time runs past midnight. A single string or `"closed"` is accepted as well.
 */

/** Weekday keys in display order (Monday first, Thailand's convention). */
export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** One weekday key. */
export type DayKey = (typeof DAY_KEYS)[number];

/** An opening range in minutes from midnight. `close` may exceed 1440 when it runs past midnight. */
export interface TimeRange {
    open: number;
    close: number;
}

/** Ranges per weekday. An empty list means closed that day. */
export type WeeklyHours = Record<DayKey, TimeRange[]>;

/** UI language for status sentences. */
export type Lang = 'en' | 'th';

/** Short day names per language. */
const DAY_SHORT: Record<Lang, Record<DayKey, string>> = {
    en: { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' },
    th: { mon: 'จ.', tue: 'อ.', wed: 'พ.', thu: 'พฤ.', fri: 'ศ.', sat: 'ส.', sun: 'อา.' }
};

/** Full English day names, as schema.org `dayOfWeek` expects. */
export const DAY_SCHEMA: Record<DayKey, string> = {
    mon: 'Monday',
    tue: 'Tuesday',
    wed: 'Wednesday',
    thu: 'Thursday',
    fri: 'Friday',
    sat: 'Saturday',
    sun: 'Sunday'
};

const RANGE_RE = /^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/;

/** Parse `"10:00-21:00"` into minutes. Returns null for anything else. */
function parseRange(raw: unknown): TimeRange | null {
    if (typeof raw !== 'string') return null;
    const m = RANGE_RE.exec(raw.trim());
    if (!m) return null;
    const open = Number(m[1]) * 60 + Number(m[2]);
    let close = Number(m[3]) * 60 + Number(m[4]);
    if (open > 1440 || close > 1440) return null;
    if (close <= open) close += 1440;
    return { open, close };
}

/**
 * Parse the `hours` value of a listing.
 *
 * @param raw - The YAML value (`unknown`, straight from the item)
 * @returns Ranges per day, or null when the listing has no usable hours at all
 */
export function parseHours(raw: unknown): WeeklyHours | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const data = raw as Record<string, unknown>;
    const result = {} as WeeklyHours;
    let seen = false;
    for (const day of DAY_KEYS) {
        const value = data[day];
        if (value === undefined) {
            result[day] = [];
            continue;
        }
        seen = true;
        const list = Array.isArray(value) ? value : [value];
        result[day] = list.map(parseRange).filter((r): r is TimeRange => r !== null);
    }
    return seen ? result : null;
}

/** `630` → `"10:30"`. Minutes past 1440 wrap to the next day. `1440` stays `"24:00"` only when asked. */
export function formatMinutes(minutes: number, keep24 = false): string {
    const total = keep24 && minutes === 1440 ? 1440 : minutes % 1440;
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** True when a day's only range is 00:00–24:00. */
function isAllDay(ranges: TimeRange[]): boolean {
    return ranges.length === 1 && ranges[0]!.open === 0 && ranges[0]!.close === 1440;
}

/** One row of the hours table: consecutive days with identical hours merged ("Mon–Wed"). */
export interface HoursRow {
    /** Day keys covered by the row, so the browser can mark today's row. */
    days: DayKey[];
    /** "Mon–Wed", "Fri" */
    label: string;
    /** Thai label for the same days. */
    labelTh: string;
    /** "10:00–21:00" per range; empty when closed. */
    times: string[];
    closed: boolean;
    allDay: boolean;
}

/**
 * Weekly table rows, Monday first, with consecutive identical days merged.
 *
 * Today-first ordering is left to the browser (today is not known at build time);
 * it marks the row whose `days` contain today.
 */
export function hoursRows(hours: WeeklyHours): HoursRow[] {
    const rows: HoursRow[] = [];
    const key = (r: TimeRange[]) => r.map((x) => `${x.open}-${x.close}`).join(',');
    for (const day of DAY_KEYS) {
        const ranges = hours[day];
        const last = rows[rows.length - 1];
        const lastDay = last?.days[last.days.length - 1];
        if (last && lastDay && key(hours[lastDay]) === key(ranges)) {
            last.days.push(day);
            continue;
        }
        rows.push({
            days: [day],
            label: '',
            labelTh: '',
            times: isAllDay(ranges)
                ? []
                : ranges.map((r) => `${formatMinutes(r.open)}–${formatMinutes(r.close, true)}`),
            closed: ranges.length === 0,
            allDay: isAllDay(ranges)
        });
    }
    for (const row of rows) {
        const first = row.days[0]!;
        const end = row.days[row.days.length - 1]!;
        row.label = first === end ? DAY_SHORT.en[first] : `${DAY_SHORT.en[first]}–${DAY_SHORT.en[end]}`;
        row.labelTh = first === end ? DAY_SHORT.th[first] : `${DAY_SHORT.th[first]}–${DAY_SHORT.th[end]}`;
    }
    return rows;
}

/** Wall-clock day and minute in a time zone. */
export interface LocalClock {
    day: DayKey;
    minutes: number;
}

const WEEKDAY_TO_KEY: Record<string, DayKey> = {
    Mon: 'mon',
    Tue: 'tue',
    Wed: 'wed',
    Thu: 'thu',
    Fri: 'fri',
    Sat: 'sat',
    Sun: 'sun'
};

/**
 * The local weekday and minute of `now` in `timeZone` (default Asia/Bangkok).
 * Uses `Intl`, so it is right for a visitor whose phone is still on another time zone.
 */
export function localClock(now: Date, timeZone = 'Asia/Bangkok'): LocalClock {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return {
        day: WEEKDAY_TO_KEY[get('weekday')] ?? 'mon',
        minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute'))
    };
}

/** The four visible states plus "no hours". */
export type OpenState = 'open' | 'soon' | 'closed' | 'unknown';

/** Computed status: the state (for the colour) and its sentence (for the word). */
export interface OpenStatus {
    state: OpenState;
    text: string;
    /** True when the visitor can walk in now ("Open now" or "Closes soon"), false for "Opens at". */
    isOpen: boolean;
}

const MINUTES_PER_WEEK = 7 * 1440;

/**
 * Whether a listing is open at `clock`, and the sentence to show.
 *
 * | state | text |
 * | --- | --- |
 * | open, more than 60 min left | Open now · closes 21:00 |
 * | open, under 60 min left | Closes soon · 18:30 |
 * | closed, opens within 12 h | Opens at 10:00 |
 * | closed for longer | Closed · opens Fri 10:00 |
 * | no hours | Hours not confirmed |
 */
export function openStatus(hours: WeeklyHours | null, clock: LocalClock, lang: Lang = 'en'): OpenStatus {
    const t = STATUS_TEXT[lang];
    if (!hours || DAY_KEYS.every((d) => hours[d].length === 0))
        return { state: 'unknown', text: t.unknown, isOpen: false };

    const nowWeek = DAY_KEYS.indexOf(clock.day) * 1440 + clock.minutes;
    // Every range as absolute week minutes, plus a copy one week earlier so a Sunday-night
    // range that runs into Monday is seen from Monday morning.
    const spans: { start: number; end: number; day: DayKey }[] = [];
    DAY_KEYS.forEach((day, i) => {
        for (const r of hours[day]) {
            const start = i * 1440 + r.open;
            const end = i * 1440 + r.close;
            spans.push({ start, end, day }, { start: start - MINUTES_PER_WEEK, end: end - MINUTES_PER_WEEK, day });
        }
    });

    const current = spans.find((s) => s.start <= nowWeek && nowWeek < s.end);
    if (current) {
        // Open around the clock when the range touches the next day's 00:00 range.
        const continues = spans.some((s) => s.start === current.end || s.start + MINUTES_PER_WEEK === current.end);
        if (continues && current.end - current.start >= 1440) return { state: 'open', text: t.allDay, isOpen: true };
        const left = current.end - nowWeek;
        const at = current.end % 1440 === 0 ? '24:00' : formatMinutes(current.end);
        return left <= 60
            ? { state: 'soon', text: t.closesSoon(at), isOpen: true }
            : { state: 'open', text: t.open(at), isOpen: true };
    }

    const next = spans
        .flatMap((s) => [s, { ...s, start: s.start + MINUTES_PER_WEEK }])
        .filter((s) => s.start > nowWeek)
        .sort((a, b) => a.start - b.start)[0];
    if (!next) return { state: 'closed', text: t.closed, isOpen: false };
    const at = formatMinutes(next.start);
    if (next.start - nowWeek <= 12 * 60) return { state: 'soon', text: t.opensAt(at), isOpen: false };
    return { state: 'closed', text: t.closedOpens(DAY_SHORT[lang][next.day], at), isOpen: false };
}

/** Status sentences per language (design README: "always the word plus the time"). */
const STATUS_TEXT: Record<
    Lang,
    {
        open: (at: string) => string;
        closesSoon: (at: string) => string;
        opensAt: (at: string) => string;
        closedOpens: (day: string, at: string) => string;
        closed: string;
        allDay: string;
        unknown: string;
    }
> = {
    en: {
        open: (at) => `Open now · closes ${at}`,
        closesSoon: (at) => `Closes soon · ${at}`,
        opensAt: (at) => `Opens at ${at}`,
        closedOpens: (day, at) => `Closed · opens ${day} ${at}`,
        closed: 'Closed',
        allDay: 'Open 24 hours',
        unknown: 'Hours not confirmed'
    },
    th: {
        open: (at) => `เปิดอยู่ตอนนี้ · ปิดเวลา ${at}`,
        closesSoon: (at) => `ใกล้ปิด · ${at}`,
        opensAt: (at) => `เปิดเวลา ${at}`,
        closedOpens: (day, at) => `ปิดอยู่ · เปิด ${day} ${at}`,
        closed: 'ปิด',
        allDay: 'เปิด 24 ชั่วโมง',
        unknown: 'ยังไม่ยืนยันเวลาเปิด'
    }
};
