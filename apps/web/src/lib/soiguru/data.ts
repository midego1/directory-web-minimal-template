/**
 * SoiGuru data model: cities, areas, categories, amenities and listings, read from the
 * `soiguru-data` content repository and normalized into typed view models.
 *
 * The Ever Works item loader keeps every extra YAML key on the item (typed `unknown`);
 * this module is the one place that narrows them. Schema: `soiguru-data/README.md`.
 *
 * URLs: `/<city>`, `/<city>/<category>`, `/<city>/<area>`, `/<city>/<area>/<slug>`.
 */

import type { ItemData, SiteConfig } from '@ever-works/core';
import { getContent, readContentYaml } from '../content';
import { isIconName, type IconName } from './icons';
import { parseHours, type WeeklyHours } from './hours';
import { isLatLng, type LatLng } from './geo';
import { updatedAtIso } from './format';

/** An area of a city, as people name it at street level. */
export interface Area {
    id: string;
    name: string;
    name_th?: string;
    geo?: LatLng;
    /** Reachable by boat only (Railay): distances get "· boat". */
    boat_only: boolean;
}

/** One city. The city is a parameter of every screen, never hard-coded. */
export interface City {
    id: string;
    name: string;
    name_th?: string;
    province?: string;
    geo?: LatLng;
    timezone: string;
    default_area?: string;
    areas: Area[];
}

/** A category shared by every city. */
export interface Category {
    id: string;
    name: string;
    /** Short label for the 4-up home grid ("Nails"). */
    short_name: string;
    name_th?: string;
    icon: IconName;
    priority: number;
}

/** An amenity on a listing, with its label resolved from `amenities.yml`. */
export interface Amenity {
    id: string;
    name: string;
    name_th?: string;
    /** false = notably missing ("No parking"), shown with a cross. */
    available: boolean;
}

/** A listing, normalized for the screens. */
export interface Listing {
    slug: string;
    name: string;
    name_th?: string;
    description: string;
    description_th?: string;
    category?: Category;
    city: City;
    area?: Area;
    address?: string;
    geo?: LatLng;
    phone?: string;
    line_id?: string;
    whatsapp?: string;
    hours: WeeklyHours | null;
    /** Raw `hours`, serialized for the browser's status script. */
    hoursJson: string;
    hours_note?: string;
    booking_note?: string;
    price_band?: number;
    rating?: number;
    rating_count?: number;
    claimed: boolean;
    amenities: Amenity[];
    updated_by?: 'owner' | 'import' | 'editor';
    /** ISO 8601, Bangkok time. */
    updated_at?: string;
    images: string[];
    sample: boolean;
    featured: boolean;
    /** Text the search box matches, lower-cased, both scripts. */
    searchText: string;
    /** Canonical path `/<city>/<area>/<slug>`. */
    url: string;
}

/** Everything the SoiGuru screens read. */
export interface SoiGuruData {
    config: SiteConfig;
    cities: City[];
    categories: Category[];
    listings: Listing[];
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const records = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : [];

function toArea(raw: Record<string, unknown>): Area | null {
    const id = str(raw['id']);
    const name = str(raw['name']);
    if (!id || !name) return null;
    return {
        id,
        name,
        name_th: str(raw['name_th']),
        geo: isLatLng(raw['geo']) ? raw['geo'] : undefined,
        boat_only: raw['boat_only'] === true
    };
}

function toCity(raw: Record<string, unknown>): City | null {
    const id = str(raw['id']);
    const name = str(raw['name']);
    if (!id || !name) return null;
    return {
        id,
        name,
        name_th: str(raw['name_th']),
        province: str(raw['province']),
        geo: isLatLng(raw['geo']) ? raw['geo'] : undefined,
        timezone: str(raw['timezone']) ?? 'Asia/Bangkok',
        default_area: str(raw['default_area']),
        areas: records(raw['areas'])
            .map(toArea)
            .filter((a): a is Area => a !== null)
    };
}

/** Humanize an id that has no label: `gel-acrylic` → `Gel acrylic`. */
function humanize(id: string): string {
    const text = id.replace(/[-_]+/g, ' ').trim();
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function toAmenities(raw: unknown, labels: Map<string, { name: string; name_th?: string }>): Amenity[] {
    const entries: [string, boolean][] = [];
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [id, value] of Object.entries(raw)) entries.push([id, value !== false]);
    } else if (Array.isArray(raw)) {
        for (const v of raw) if (typeof v === 'string') entries.push([v, true]);
    }
    return entries.map(([id, available]) => ({
        id,
        name: labels.get(id)?.name ?? humanize(id),
        name_th: labels.get(id)?.name_th,
        available
    }));
}

function toListing(
    item: ItemData,
    cities: Map<string, City>,
    categories: Map<string, Category>,
    amenityLabels: Map<string, { name: string; name_th?: string }>
): Listing | null {
    const city = cities.get(str(item['city']) ?? '');
    if (!city) return null;
    const area = city.areas.find((a) => a.id === str(item['area']));
    const categoryId = Array.isArray(item.category) ? item.category[0] : item.category;
    const category = categoryId ? categories.get(categoryId) : undefined;
    const updatedBy = str(item['updated_by']);
    const images = Array.isArray(item.images) ? item.images.filter((i): i is string => typeof i === 'string') : [];
    const name_th = str(item['name_th']);
    const listing: Listing = {
        slug: item.slug,
        name: item.name,
        name_th,
        description: item.description,
        description_th: str(item['description_th']),
        category,
        city,
        area,
        address: str(item['address']),
        geo: isLatLng(item['geo']) ? item['geo'] : undefined,
        phone: str(item['phone']),
        line_id: str(item['line_id']),
        whatsapp: str(item['whatsapp']),
        hours: parseHours(item['hours']),
        hoursJson: JSON.stringify(item['hours'] ?? null),
        hours_note: str(item['hours_note']),
        booking_note: str(item['booking_note']),
        price_band: num(item['price_band']),
        rating: num(item['rating']),
        rating_count: num(item['rating_count']),
        claimed: item['claimed'] === true,
        amenities: toAmenities(item['amenities'], amenityLabels),
        updated_by: updatedBy === 'owner' || updatedBy === 'import' || updatedBy === 'editor' ? updatedBy : undefined,
        updated_at: updatedAtIso(item.updated_at),
        images,
        sample: item['sample'] === true,
        featured: item.featured === true,
        searchText: [
            item.name,
            name_th,
            category?.name,
            category?.short_name,
            category?.name_th,
            area?.name,
            area?.name_th,
            str(item['address']),
            ...item.tags
        ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase(),
        url: area ? `/${city.id}/${area.id}/${item.slug}` : `/${city.id}/${item.slug}`
    };
    return listing;
}

let cached: Promise<SoiGuruData> | null = null;

/**
 * Load and normalize all SoiGuru data. Memoized for the build.
 *
 * Listings without a known `city` are left out (they belong to no SoiGuru screen);
 * listings without a known `area` are kept but get no listing page (their URL needs one).
 */
export function getSoiGuru(): Promise<SoiGuruData> {
    cached ??= (async () => {
        const [content, citiesRaw, amenitiesRaw] = await Promise.all([
            getContent(),
            readContentYaml('cities.yml'),
            readContentYaml('amenities.yml')
        ]);
        const cities = records(citiesRaw)
            .map(toCity)
            .filter((c): c is City => c !== null);
        const categories: Category[] = content.categories
            .map((c) => {
                // Extra category keys survive the core loader but are not on CategoryData.
                const extra = c as unknown as Record<string, unknown>;
                return {
                    id: c.id,
                    name: c.name,
                    short_name: str(extra['short_name']) ?? c.name,
                    name_th: str(extra['name_th']),
                    icon: isIconName(extra['icon']) ? extra['icon'] : ('info' as IconName),
                    priority: typeof c.priority === 'number' ? c.priority : 0
                };
            })
            // soiguru-data and the Next.js template rank higher priority first.
            .sort((a, b) => b.priority - a.priority);
        const amenityLabels = new Map(
            records(amenitiesRaw)
                .filter((a) => str(a['id']) && str(a['name']))
                .map((a) => [a['id'] as string, { name: a['name'] as string, name_th: str(a['name_th']) }])
        );
        const cityMap = new Map(cities.map((c) => [c.id, c]));
        const categoryMap = new Map(categories.map((c) => [c.id, c]));
        const listings = content.items
            .map((item) => toListing(item, cityMap, categoryMap, amenityLabels))
            .filter((l): l is Listing => l !== null)
            .sort((a, b) => Number(b.featured) - Number(a.featured) || (b.rating ?? 0) - (a.rating ?? 0));
        return { config: content.config, cities, categories, listings };
    })();
    return cached;
}

/** Listings of one city. */
export function cityListings(data: SoiGuruData, city: City): Listing[] {
    return data.listings.filter((l) => l.city.id === city.id);
}

/** The city's default area (for "Open now in Ao Nang"), or its first. */
export function defaultArea(city: City): Area | undefined {
    return city.areas.find((a) => a.id === city.default_area) ?? city.areas[0];
}

/** Where the "Claim this listing" button goes (`claim_url` in works.yml), with the listing preselected. */
export function claimUrl(config: SiteConfig, listing?: Listing): string | undefined {
    const base = str(config['claim_url']);
    if (!base) return undefined;
    if (!listing) return base;
    return `${base}${base.includes('?') ? '&' : '?'}listing=${encodeURIComponent(listing.slug)}`;
}

/** Where "Report wrong info" goes: a prefilled e-mail to `contact_email` in works.yml. */
export function reportUrl(config: SiteConfig, listing: Listing): string | undefined {
    const email = str(config['contact_email']);
    if (!email) return undefined;
    const subject = `Wrong info: ${listing.name} (${listing.slug})`;
    return `mailto:${email}?subject=${encodeURIComponent(subject)}`;
}
