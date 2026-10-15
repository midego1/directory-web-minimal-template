# Feature: SoiGuru design port (CityHome, CategoryResults, ListingPage, landing)

**Status**: first pass implemented (branch `design/soiguru`)
**App**: `apps/web` (`@ever-works/web-minimal`), static build (`ENABLE_ISR=false`), deployed to Cloudflare Pages project `soiguru-minimal`
**Design source**: Claude Design System artifact "TheKrabiGuide" (renamed SoiGuru): `README.md`, `tokens.json`, `components/bundle.css`, `components/bundle.js`, per-component READMEs and previews
**Data**: `midego1/soiguru-data` (Ever Works format plus SoiGuru fields; schema in that repo's `README.md`)

## Goal

SoiGuru is a multi-city local business directory for Thailand (Krabi, Chiang Mai, Lam Plai Mat). This template is built in parallel with the Next.js app (`midego1/SoiGuru.com`) for an A/B comparison, so the markup keeps the design's `tkg-` classes 1:1 and the same URLs.

## Routes

| URL                     | Screen                                               | File                                   |
| ----------------------- | ---------------------------------------------------- | -------------------------------------- |
| `/`                     | Landing: the cities                                  | `src/pages/index.astro`                |
| `/<city>`               | CityHome                                             | `src/pages/[city]/index.astro`         |
| `/<city>/<category>`    | CategoryResults for a category                       | `src/pages/[city]/[segment].astro`     |
| `/<city>/<area>`        | CategoryResults for an area (all categories)         | `src/pages/[city]/[segment].astro`     |
| `/<city>/search?q=`     | CategoryResults for a search (noindex)               | `src/pages/[city]/search.astro`        |
| `/<city>/<area>/<slug>` | ListingPage with `LocalBusiness` JSON-LD             | `src/pages/[city]/[area]/[slug].astro` |
| `/directory`            | The template's generic item listing (moved from `/`) | `src/pages/directory.astro`            |

Category and area ids share the second URL segment; `soiguru-data` keeps them distinct (an area id equal to a category id is skipped).

## Data contract

- `cities.yml` (cities with `areas`, `timezone`, `default_area`, `geo`) and `amenities.yml` (id → EN/TH label) are SoiGuru extensions read through `readContentYaml()` in `src/lib/content.ts`.
- Items keep every extra YAML key (core item loader spreads the raw YAML). `src/lib/soiguru/data.ts` narrows them into a typed `Listing`: `city`, `area`, `name_th`, `description_th`, `address`, `geo`, `phone`, `line_id`, `whatsapp`, `hours`, `hours_note`, `booking_note`, `price_band`, `rating`, `rating_count`, `claimed`, `amenities`, `updated_by`, `updated_at`, `sample`.
- Categories: the core category loader now passes extra keys through (`name_th`, `short_name`, `icon`), re-validating its known keys. Higher `priority` sorts first (as in `soiguru-data` and the Next.js template).
- `works.yml`: optional `claim_url` (Claim buttons and the Owner tab; hidden without it) and `contact_email` ("Report wrong info"; hidden without it).

## Behaviour

- **Open status** is computed in the browser from `hours` and the city time zone (`Intl`, Asia/Bangkok), because static HTML cannot know the visitor's time. States and sentences follow the OpenStatus README, in EN and TH. "Open now" lists count only places a visitor can walk into now (not "Opens at").
- Unclaimed listings with hours older than 90 days show "Hours not confirmed".
- **Hours table**: Monday first with identical consecutive days merged; the browser marks today's row.
- **Distances** appear when location permission is already granted, or after "Near me" / sort "Nearest".
- **Results filters** (open now, area, sort, search text, List/Map) run in the browser over the rendered cards and are kept in the URL. "Open now" is on by default 09:00–23:00 local time. Closed places sit behind "Show N closed now"; "Show more" at 20.
- **Map**: Leaflet with OpenStreetMap tiles, imported on demand on results pages only. The listing page uses static OSM tile images (no library).
- **Language**: EN / ไทย toggle remembered on the device; swaps every `[data-th]` text and the status sentences.
- **Structured data**: `LocalBusiness` subtype per category with `openingHoursSpecification`, `geo`, `address`, `priceRange`, `aggregateRating`, `amenityFeature`; `BreadcrumbList` on city, results and listing pages.

## Not in this pass

ClaimFlow and OwnerDashboard (need accounts; Next.js only), the Filters sheet (price, rating, has LINE…), "Search this area", the photo gallery, Saved, Thai URL prefix (`/th/…`), official LINE/WhatsApp marks, a self-hosted map style. See `docs/questions.md` Q30.
