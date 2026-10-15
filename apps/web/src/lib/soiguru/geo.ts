/**
 * Geography helpers: distance, walking time and OpenStreetMap tile maths.
 * Pure functions, safe on the server and in the browser.
 */

/** WGS84 point in decimal degrees. */
export interface LatLng {
    lat: number;
    lng: number;
}

/** Type guard for a `{ lat, lng }` value read from YAML. */
export function isLatLng(value: unknown): value is LatLng {
    if (!value || typeof value !== 'object') return false;
    const v = value as Record<string, unknown>;
    return (
        typeof v['lat'] === 'number' &&
        typeof v['lng'] === 'number' &&
        Number.isFinite(v['lat']) &&
        Number.isFinite(v['lng'])
    );
}

/** Great-circle distance in metres (haversine). */
export function distanceMetres(a: LatLng, b: LatLng): number {
    const R = 6371008.8;
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad;
    const dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "450 m" under 1 km (rounded to 10 m), "2.3 km" above (design README: Content). */
export function formatDistance(metres: number): string {
    if (metres < 1000) return `${Math.max(10, Math.round(metres / 10) * 10)} m`;
    return `${(metres / 1000).toFixed(1)} km`;
}

/** Walking minutes at 80 m/min, never under 1. */
export function walkingMinutes(metres: number): number {
    return Math.max(1, Math.round(metres / 80));
}

/** OpenStreetMap tile size in pixels. */
export const TILE_SIZE = 256;

/** World pixel position of a point at a zoom level (Web Mercator). */
export function worldPixel(point: LatLng, zoom: number): { x: number; y: number } {
    const scale = TILE_SIZE * 2 ** zoom;
    const sin = Math.sin((point.lat * Math.PI) / 180);
    return {
        x: ((point.lng + 180) / 360) * scale,
        y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale
    };
}

/** Directions deep link. Google Maps' URL opens the native app on Android and iOS. */
export function directionsUrl(point: LatLng): string {
    return `https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lng}`;
}
