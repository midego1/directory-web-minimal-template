/**
 * schema.org structured data for SoiGuru pages: `LocalBusiness` (with
 * `openingHoursSpecification`) for listings, `BreadcrumbList` and `WebSite`.
 */

import { DAY_KEYS, DAY_SCHEMA, formatMinutes, type DayKey } from './hours';
import { priceRange } from './format';
import type { Listing } from './data';

/** The most specific `LocalBusiness` subtype per category id. Unknown ids use `LocalBusiness`. */
const SCHEMA_TYPE: Record<string, string> = {
    restaurants: 'Restaurant',
    cafes: 'CafeOrCoffeeShop',
    massage: 'DaySpa',
    tours: 'TravelAgency',
    'scooter-rental': 'AutoRental',
    'nail-salons': 'NailSalon',
    'dive-shops': 'SportsActivityLocation',
    hotels: 'Hotel'
};

/** `openingHoursSpecification` entries, one per distinct range, days grouped. */
function openingHours(listing: Listing): Record<string, unknown>[] {
    if (!listing.hours) return [];
    const groups = new Map<string, { days: DayKey[]; opens: string; closes: string }>();
    for (const day of DAY_KEYS) {
        for (const r of listing.hours[day]) {
            const opens = formatMinutes(r.open);
            // schema.org writes "open all day" as 00:00–23:59.
            const closes = r.close === 1440 ? '23:59' : formatMinutes(r.close);
            const key = `${opens}-${closes}`;
            const group = groups.get(key) ?? { days: [], opens, closes };
            group.days.push(day);
            groups.set(key, group);
        }
    }
    return [...groups.values()].map((g) => ({
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: g.days.map((d) => `https://schema.org/${DAY_SCHEMA[d]}`),
        opens: g.opens,
        closes: g.closes
    }));
}

/**
 * `LocalBusiness` JSON-LD for a listing page.
 *
 * @param listing - The listing
 * @param siteUrl - Absolute site origin, no trailing slash
 */
export function localBusinessJsonLd(listing: Listing, siteUrl: string): Record<string, unknown> {
    const url = `${siteUrl}${listing.url}`;
    const ld: Record<string, unknown> = {
        '@context': 'https://schema.org',
        '@type': SCHEMA_TYPE[listing.category?.id ?? ''] ?? 'LocalBusiness',
        '@id': `${url}#business`,
        name: listing.name,
        url,
        description: listing.description,
        address: {
            '@type': 'PostalAddress',
            ...(listing.address ? { streetAddress: listing.address } : {}),
            ...(listing.area ? { addressLocality: listing.area.name } : {}),
            addressRegion: listing.city.province ?? listing.city.name,
            addressCountry: 'TH'
        }
    };
    if (listing.name_th) ld['alternateName'] = listing.name_th;
    if (listing.geo) ld['geo'] = { '@type': 'GeoCoordinates', latitude: listing.geo.lat, longitude: listing.geo.lng };
    if (listing.phone) ld['telephone'] = listing.phone;
    if (listing.images.length > 0) ld['image'] = listing.images;
    const price = priceRange(listing.price_band);
    if (price) ld['priceRange'] = price;
    const hours = openingHours(listing);
    if (hours.length > 0) ld['openingHoursSpecification'] = hours;
    if (listing.rating !== undefined && listing.rating_count) {
        ld['aggregateRating'] = {
            '@type': 'AggregateRating',
            ratingValue: listing.rating,
            reviewCount: listing.rating_count,
            bestRating: 5
        };
    }
    if (listing.amenities.length > 0) {
        ld['amenityFeature'] = listing.amenities.map((a) => ({
            '@type': 'LocationFeatureSpecification',
            name: a.name,
            value: a.available
        }));
    }
    return ld;
}

/** `BreadcrumbList` JSON-LD from `[name, path]` pairs. */
export function breadcrumbJsonLd(siteUrl: string, trail: [string, string][]): Record<string, unknown> {
    return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: trail.map(([name, path], i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name,
            item: `${siteUrl}${path}`
        }))
    };
}
