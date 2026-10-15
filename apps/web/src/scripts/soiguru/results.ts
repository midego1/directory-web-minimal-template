/**
 * CategoryResults behaviour: filters (open now, area, sort, search text), List/Map mode,
 * "Show N closed now", "Show more" at 20, and the OpenStreetMap map (Leaflet, imported
 * on demand so the list paints first). State lives in the URL query.
 */

import { locate, visitor } from './page';
import { localClock } from '../../lib/soiguru/hours';
import type * as Leaflet from 'leaflet';

const PAGE_SIZE = 20;

interface Pin {
    slug: string;
    name: string;
    lat: number;
    lng: number;
    url: string;
    directions: string;
}

const root = document.querySelector<HTMLElement>('[data-results-root]');

if (root) {
    const list = root.querySelector<HTMLElement>('[data-results]')!;
    const cards = [...list.querySelectorAll<HTMLElement>('[data-listing]')];
    const openBtn = root.querySelector<HTMLButtonElement>('[data-filter-open]')!;
    const areaSelect = root.querySelector<HTMLSelectElement>('[data-filter-area]');
    const areaLabel = root.querySelector<HTMLElement>('[data-area-label]');
    const sortSelect = root.querySelector<HTMLSelectElement>('[data-filter-sort]')!;
    const sortLabel = root.querySelector<HTMLElement>('[data-sort-label]')!;
    const countOpen = root.querySelector<HTMLElement>('[data-count-open]')!;
    const countTotal = root.querySelector<HTMLElement>('[data-count-total]')!;
    const countShort = root.querySelector<HTMLElement>('[data-count-short]')!;
    const showMore = root.querySelector<HTMLButtonElement>('[data-show-more]')!;
    const showClosed = root.querySelector<HTMLButtonElement>('[data-show-closed]')!;
    const empty = root.querySelector<HTMLElement>('[data-results-empty]')!;
    const noun = root.dataset['noun'] ?? 'places';
    const searchMode = root.dataset['search'] === '1';
    const pins: Pin[] = JSON.parse(document.querySelector('[data-pins]')?.textContent ?? '[]');

    const params = new URLSearchParams(location.search);
    const state = {
        // "Open now" is on by default between 09:00 and 23:00 local time, off at night
        // (so the list is not empty at 02:00). An explicit `?open=` wins.
        open: params.has('open') ? params.get('open') === '1' : isDaytime(),
        area: params.get('area') ?? root.dataset['defaultArea'] ?? '',
        sort: params.get('sort') ?? 'rating',
        view: params.get('view') === 'map' ? 'map' : 'list',
        q: (params.get('q') ?? '').trim().toLowerCase(),
        closedShown: false,
        limit: PAGE_SIZE,
        selected: ''
    };

    function isDaytime(): boolean {
        const { minutes } = localClock(new Date(), document.body.dataset['tz'] || 'Asia/Bangkok');
        return minutes >= 9 * 60 && minutes < 23 * 60;
    }

    const writeUrl = () => {
        const p = new URLSearchParams();
        if (state.q) p.set('q', state.q);
        if (state.area && state.area !== (root.dataset['defaultArea'] ?? '')) p.set('area', state.area);
        if (state.open !== isDaytime()) p.set('open', state.open ? '1' : '0');
        if (state.sort !== 'rating') p.set('sort', state.sort);
        if (state.view === 'map') p.set('view', 'map');
        const qs = p.toString();
        history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}`);
    };

    const isOpen = (c: HTMLElement) => c.dataset['open'] === '1';
    const matches = (c: HTMLElement) =>
        (!state.area || c.dataset['area'] === state.area) &&
        (!state.q || state.q.split(/\s+/).every((word) => (c.dataset['search'] ?? '').includes(word)));

    const sorted = (items: HTMLElement[]) => {
        const by = state.sort;
        return [...items].sort((a, b) => {
            if (by === 'nearest' && visitor)
                return Number(a.dataset['metres'] ?? 9e9) - Number(b.dataset['metres'] ?? 9e9);
            if (by === 'updated')
                return Date.parse(b.dataset['updated'] ?? '') - Date.parse(a.dataset['updated'] ?? '') || 0;
            return Number(b.dataset['rating'] ?? 0) - Number(a.dataset['rating'] ?? 0);
        });
    };

    /** Apply filters, sort and paging to the rendered cards. */
    const render = () => {
        const pool = sorted(cards.filter(matches));
        const open = pool.filter(isOpen);
        const closed = pool.filter((c) => !isOpen(c));
        const visible = state.open && !state.closedShown ? open : pool;
        // Re-order in the DOM: open first, then the rest (when shown).
        const ordered = state.open ? [...open, ...closed] : pool;
        for (const c of ordered) list.append(c);
        for (const c of cards) c.hidden = true;
        visible.slice(0, state.limit).forEach((c) => (c.hidden = false));

        const areaName = areaSelect?.selectedOptions[0]?.textContent ?? '';
        const where = state.area && areaName ? areaName : (root.dataset['where'] ?? '');
        countOpen.textContent = `${open.length} open now`;
        countTotal.textContent = `of ${pool.length} ${noun} in ${where}`;
        countShort.textContent = `${open.length} open now`;
        empty.hidden = pool.length > 0 && visible.length > 0;
        showMore.hidden = visible.length <= state.limit;
        showMore.textContent = `Show more (${visible.length - state.limit})`;
        showClosed.hidden = !state.open || state.closedShown || closed.length === 0;
        showClosed.textContent = `Show ${closed.length} closed now`;

        openBtn.setAttribute('aria-pressed', String(state.open));
        if (areaLabel) areaLabel.textContent = state.area && areaName ? areaName : 'All areas';
        sortLabel.textContent = sortSelect.selectedOptions[0]?.textContent ?? 'Top rated';
        root.dataset['view'] = state.view;
        for (const b of root.querySelectorAll<HTMLButtonElement>('.sg-view-seg [data-view-set]')) {
            const on = b.dataset['viewSet'] === state.view;
            b.classList.toggle('tkg-on', on);
            b.setAttribute('aria-pressed', String(on));
        }
        updatePins(new Set(pool.filter((c) => !state.open || isOpen(c)).map((c) => c.dataset['listing'] ?? '')));
    };

    // --- map --------------------------------------------------------------------
    const mapEl = root.querySelector<HTMLElement>('[data-map]')!;
    let L: typeof Leaflet | null = null;
    let map: Leaflet.Map | null = null;
    const markers = new Map<string, Leaflet.Marker>();
    let youMarker: Leaflet.Marker | null = null;

    const pinIcon = (selected: boolean) =>
        L!.divIcon({
            className: 'sg-pin',
            iconSize: selected ? [30, 40] : [24, 32],
            iconAnchor: selected ? [15, 38] : [12, 30],
            html: `<svg viewBox="-12 -24 24 32" aria-hidden="true"><path class="${selected ? 'tkg-m-pin-on' : 'tkg-m-pin'}" d="M0-18a9 9 0 0 1 9 9c0 6-9 15-9 15S-9-3-9-9a9 9 0 0 1 9-9Z"/><circle class="tkg-m-pin-dot" cx="0" cy="-9" r="3"/></svg>`
        });

    const interactive = () => state.view === 'map' || window.matchMedia('(min-width: 960px)').matches;

    const setInteractive = () => {
        if (!map) return;
        const on = interactive();
        for (const handler of [
            map.dragging,
            map.touchZoom,
            map.scrollWheelZoom,
            map.doubleClickZoom,
            map.boxZoom,
            map.keyboard
        ]) {
            if (on) handler.enable();
            else handler.disable();
        }
        map.invalidateSize();
    };

    function updatePins(visible: Set<string>): void {
        if (!map || !L) return;
        const shown: Leaflet.LatLng[] = [];
        for (const pin of pins) {
            const marker = markers.get(pin.slug);
            if (!marker) continue;
            if (visible.has(pin.slug)) {
                if (!map.hasLayer(marker)) marker.addTo(map);
                shown.push(marker.getLatLng());
            } else marker.remove();
        }
        if (shown.length > 0) map.fitBounds(L.latLngBounds(shown), { padding: [32, 32], maxZoom: 16 });
    }

    const select = (slug: string) => {
        state.selected = slug;
        for (const [s, m] of markers) m.setIcon(pinIcon(s === slug));
        const pin = pins.find((p) => p.slug === slug);
        const card = cards.find((c) => c.dataset['listing'] === slug);
        const sheet = root.querySelector<HTMLElement>('[data-sheet]')!;
        if (!pin || !card) {
            sheet.hidden = true;
            return;
        }
        const compact = card.cloneNode(true) as HTMLElement;
        compact.hidden = false;
        compact.classList.add('tkg-card-compact');
        compact.querySelector('.tkg-card-sub')?.remove();
        root.querySelector('[data-sheet-card]')!.replaceChildren(compact);
        root.querySelector<HTMLAnchorElement>('[data-sheet-directions]')!.href = pin.directions;
        root.querySelector<HTMLAnchorElement>('[data-sheet-view]')!.href = pin.url;
        sheet.hidden = false;
        for (const c of cards) c.classList.toggle('tkg-card-selected', c === card);
    };

    const loadMap = async () => {
        if (map) return;
        const [leaflet] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
        L = (leaflet as unknown as { default?: typeof Leaflet }).default ?? leaflet;
        const [lat, lng] = (mapEl.dataset['center'] ?? '13.75,100.5').split(',').map(Number);
        const holder = document.createElement('div');
        holder.style.cssText = 'position:absolute;inset:0';
        mapEl.prepend(holder);
        map = L.map(holder, { zoomControl: false, attributionControl: false }).setView([lat!, lng!], 14);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
        for (const pin of pins) {
            const marker = L.marker([pin.lat, pin.lng], { icon: pinIcon(false), title: pin.name, keyboard: true });
            marker.on('click', () => {
                if (state.view !== 'map' && !window.matchMedia('(min-width: 960px)').matches) {
                    state.view = 'map';
                    writeUrl();
                    render();
                    setInteractive();
                }
                select(pin.slug);
            });
            markers.set(pin.slug, marker);
        }
        if (visitor) showYou();
        setInteractive();
        render();
    };

    const showYou = () => {
        if (!map || !L || !visitor) return;
        youMarker ??= L.marker([visitor.lat, visitor.lng], {
            icon: L.divIcon({ className: 'sg-you', iconSize: [14, 14] }),
            interactive: false
        }).addTo(map);
        youMarker.setLatLng([visitor.lat, visitor.lng]);
    };

    // --- events -------------------------------------------------------------------
    openBtn.addEventListener('click', () => {
        state.open = !state.open;
        state.closedShown = false;
        writeUrl();
        render();
    });
    areaSelect?.addEventListener('change', () => {
        state.area = areaSelect.value;
        state.limit = PAGE_SIZE;
        writeUrl();
        render();
    });
    sortSelect.addEventListener('change', async () => {
        state.sort = sortSelect.value;
        writeUrl();
        if (state.sort === 'nearest' && !visitor) await locate();
        render();
    });
    root.addEventListener('click', (event) => {
        const btn = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-view-set]') : null;
        if (!btn) return;
        state.view = btn.dataset['viewSet'] === 'map' ? 'map' : 'list';
        writeUrl();
        render();
        void loadMap().then(setInteractive);
    });
    showMore.addEventListener('click', () => {
        state.limit += PAGE_SIZE;
        render();
    });
    showClosed.addEventListener('click', () => {
        state.closedShown = true;
        render();
    });
    document.addEventListener('sg:refresh', render);
    document.addEventListener('sg:location', () => {
        showYou();
        render();
    });
    window.matchMedia('(min-width: 960px)').addEventListener('change', setInteractive);

    // --- init ---------------------------------------------------------------------
    if (areaSelect) areaSelect.value = state.area;
    if ([...sortSelect.options].some((o) => o.value === state.sort)) sortSelect.value = state.sort;
    if (searchMode) {
        const input = document.querySelector<HTMLInputElement>('input[name="q"]');
        if (input && !input.value) input.value = params.get('q') ?? '';
    }
    render();
    if (state.sort === 'nearest' && !visitor) void locate().then(render);
    // The map is below the top bar on every viewport: load it once the list has painted.
    const idle = (cb: () => void) =>
        'requestIdleCallback' in window ? requestIdleCallback(cb, { timeout: 1500 }) : setTimeout(cb, 200);
    idle(() => void loadMap());
}
