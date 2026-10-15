/**
 * Display formatting for listings: phone numbers, price bands, contact deep links, dates.
 */

/**
 * E.164 Thai number to the local display form: `+66812345678` → `081-234-5678`,
 * `+6675123456` → `075-123-456`. Anything else is returned unchanged.
 */
export function formatThaiPhone(e164: string): string {
    const digits = e164.replace(/[^\d]/g, '');
    if (!digits.startsWith('66')) return e164;
    const national = `0${digits.slice(2)}`;
    if (national.length === 10) return `${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`;
    if (national.length === 9) return `${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`;
    return national;
}

/** `tel:` link keeping the international form, so a foreign SIM can dial it. */
export function telUrl(e164: string): string {
    return `tel:${e164.replace(/[^\d+]/g, '')}`;
}

/** WhatsApp chat link (`https://wa.me/668…`). */
export function whatsappUrl(e164: string): string {
    return `https://wa.me/${e164.replace(/[^\d]/g, '')}`;
}

/**
 * LINE add-friend link. Official accounts (`@id`) use `/R/ti/p/@id`; personal ids use `~id`.
 */
export function lineUrl(lineId: string): string {
    const id = lineId.trim();
    return id.startsWith('@')
        ? `https://line.me/R/ti/p/${encodeURIComponent(id)}`
        : `https://line.me/R/ti/p/~${encodeURIComponent(id)}`;
}

/** `2` → `฿฿`. Out-of-range values give an empty string. */
export function priceBand(band: unknown): string {
    return typeof band === 'number' && band >= 1 && band <= 4 ? '฿'.repeat(Math.round(band)) : '';
}

/** schema.org `priceRange` uses the same ฿ symbols. */
export const priceRange = priceBand;

/**
 * Parse the Ever Works `updated_at` format (`"YYYY-MM-DD HH:mm"`, Bangkok time) to ISO 8601.
 * Returns undefined when the value does not match.
 */
export function updatedAtIso(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(value.trim());
    if (!m) return undefined;
    return `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:00+07:00`;
}

/** "12 Oct 2026" from an ISO date, in Bangkok time. */
export function formatDate(iso: string, lang: 'en' | 'th' = 'en'): string {
    return new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Bangkok'
    }).format(new Date(iso));
}

/** Escape a JSON-LD payload for a `<script>` element (no `</script` break-out). */
export function jsonForScript(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c');
}
