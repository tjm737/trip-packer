"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { MapPin, Route, Loader2, AlertTriangle, Clock, ExternalLink, Plane, GripVertical, ChevronUp, ChevronDown, Pencil, BedDouble, Car, TrainFront, Ship, Ticket, CalendarDays, RotateCcw } from "lucide-react";
import "leaflet/dist/leaflet.css";

import { useApp } from "@/lib/AppContext";
import { Reservation, ReservationType } from "@/lib/types";
import { formatDate } from "@/lib/dates";
import { readCachedCoords, writeCachedCoords } from "@/lib/geoCache";
import { Tooltip } from "@/components/ui/tooltip";
import { StopEditor } from "@/components/StopEditor";
import { cn } from "cn";

/*
 * Itinerary map.
 *
 * Turns the trip's bookings into a route: every reservation that names a place
 * becomes a stop, ordered chronologically, and consecutive stops are joined by
 * a driving leg measured with OSRM.
 *
 * Three things drive the structure:
 *
 *   1. Leaflet is browser-only. It is imported dynamically inside an effect so
 *      the server never tries to touch `window`, and the map is created once
 *      against a ref rather than through a React wrapper. This keeps the
 *      dependency surface small and avoids version coupling with React 19.
 *
 *   2. Geocoding and routing happen server-side, proxied through our own API
 *      routes. The browser never calls Nominatim or OSRM directly — that would
 *      leak the user's IP and bypass the SQLite coordinate cache.
 *
 *   3. A flight contributes two stops (departure and arrival) while a hotel
 *      contributes one. The stop list is built from the reservation list, so
 *      it stays correct as bookings are added or edited.
 */

/*
 * Categories offered by the map filter, in the order they are shown.
 *
 * Deliberately ordered by how much a category forms the trip's skeleton —
 * flights first, then where you sleep and drive, then the places you go. A user
 * uncluttering the map is usually peeling off the tail of this list, so the
 * spine stays at the front where the eye lands.
 */
const FILTERABLE_TYPES: ReservationType[] = [
  "flight",
  "lodging",
  "car",
  "train",
  "ferry",
  "activity",
  "other",
];

/*
 * Icon and plural label per category.
 *
 * The icons match those used for the same types elsewhere in the app so a
 * "Stay" chip and a "Stay" row mean the same thing at a glance. Labels are
 * plural here because a chip is a tally of several bookings, unlike the
 * singular labels on an individual reservation.
 */
const TYPE_FILTER_META: Record<ReservationType, { icon: typeof Plane; plural: string }> = {
  flight: { icon: Plane, plural: "Flights" },
  lodging: { icon: BedDouble, plural: "Stays" },
  car: { icon: Car, plural: "Cars" },
  train: { icon: TrainFront, plural: "Trains" },
  ferry: { icon: Ship, plural: "Ferries" },
  activity: { icon: Ticket, plural: "Activities" },
  other: { icon: CalendarDays, plural: "Other" },
};

type LatLng = { lat: number; lng: number };

type Stop = {
  key: string;
  /** Reservation this stop came from; used to group a booking's endpoints. */
  reservationId: string;
  /**
   * Reservation kind, so flights can be drawn as air hops.
   *
   * Typed as the union rather than `string` so the type filter cannot drift
   * from the reservation model — a new booking type becomes a compile error
   * here until it is given an icon and a chip.
   */
  type: ReservationType;
  name: string;
  detail: string;
  point: LatLng;
  /** Index into the ordered itinerary, 1-based, for the pin label. */
  index: number;
  date: string;
};

type Leg = {
  fromIndex: number;
  toIndex: number;
  distanceM: number;
  durationS: number;
  geometry: [number, number][]; // [lat, lng]
  /** True for an air hop drawn as a great-circle arc rather than a road. */
  isAir?: boolean;
};

/**
 * Order reservations the same way the reservations list does: by date, with
 * `order` as the tiebreaker.
 *
 * Note that a manual reorder (see `manualOrder`) deliberately takes precedence
 * over this — a drag would otherwise appear to do nothing on any trip whose
 * bookings all fall on different dates, which is every real trip.
 */
function inItineraryOrder(res: Reservation[]): Reservation[] {
  return [...res]
    .filter((r) => r.startDate || r.location)
    .sort((a, b) => {
      const aD = a.startDate || "";
      const bD = b.startDate || "";
      if (aD && bD && aD !== bD) return aD.localeCompare(bD);
      if (aD && !bD) return -1;
      if (!aD && bD) return 1;
      if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
      return a.order - b.order;
    });
}

/**
 * Blend a user's manual order with the natural date order.
 *
 * A reservation is "manually placed" when its stored `order` differs from its
 * chronological rank — that is the signature of a drag that has been saved.
 * Those keep their stored position; everything else keeps its date rank, so a
 * newly added booking still lands in a sensible spot rather than at the end.
 *
 * Reading the persisted column (rather than only the in-memory drag state) is
 * what makes a reorder visible after the write completes and after a reload.
 */
function orderReservations(res: Reservation[]): Reservation[] {
  const chronological = inItineraryOrder(res);
  const manual = chronological.some(
    (r, i) => Number.isFinite(r.order) && r.order !== i
  );
  if (!manual) return chronological;
  return chronological
    .map((r, i) => ({ r, rank: Number.isFinite(r.order) ? r.order : i }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ r }) => r);
}

/**
 * Flatten reservations into map stops.
 *
 * A booking with both endpoints (a flight, train or ferry) yields two stops;
 * everything else yields one. Only bookings whose location actually geocoded
 * are included, so an unresolved place silently drops out rather than
 * producing a pin at 0,0 in the Atlantic.
 *
 * `orderById` carries a user's manual drag order. When a reservation has an
 * entry there it is placed by that value and dated sorting is skipped for it —
 * otherwise a drag would visibly do nothing on any trip whose bookings fall on
 * different dates.
 */
function buildStops(res: Reservation[], coords: Map<string, LatLng>): Stop[] {
  const stops: Stop[] = [];
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

  for (const r of orderReservations(res)) {
    const from = r.location ? coords.get(norm(r.location)) : undefined;
    const to = r.locationTo ? coords.get(norm(r.locationTo)) : undefined;

    if (from) {
      stops.push({
        key: `${r.id}-from`,
        reservationId: r.id,
        type: r.type,
        name: r.location,
        detail: r.title,
        point: from,
        index: stops.length + 1,
        date: r.startDate,
      });
    }
    if (to) {
      stops.push({
        key: `${r.id}-to`,
        reservationId: r.id,
        type: r.type,
        name: r.locationTo,
        detail: r.title,
        point: to,
        index: stops.length + 1,
        date: r.endDate || r.startDate,
      });
    }
  }

  return stops;
}

const fmtDistance = (m: number) =>
  m < 1000 ? `${Math.round(m)} m` : `${(m / 1609.344).toFixed(1)} mi`;

const fmtDuration = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in metres between two points. */
function haversineM(a: LatLng, b: LatLng): number {
  const R = 6371008.8; // mean Earth radius
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Beyond this, a hop is not a drive and must never be sent to the router.
 *
 * OSRM's public demo server carries only European road data, and it does NOT
 * fail on a point it cannot represent — it silently snaps that endpoint to the
 * nearest place in its dataset and returns a valid 200. Asking it for
 * Philadelphia -> London returns a 1,331 mi "drive" starting in Lisbon, which
 * paints a stray route line whose endpoint has no marker on it.
 *
 * Measured: PHL->LHR came back with origin [38.7807,-9.4977] vs the requested
 * [39.8729,-75.2411]. The mirror hop LHR->PHL was worse in a quieter way — it
 * kept its origin and routed 1,330 mi overland across Europe and Asia. A
 * distance guard rejects both; checking only the returned origin catches one.
 */
const MAX_DRIVABLE_M = 2_400_000; // ~1,500 mi

/**
 * Interpolate a great-circle path between two points.
 *
 * A straight line drawn in screen space is wrong for long hops: on a Mercator
 * projection a Seattle-to-Keflavik line bows toward the equator and appears to
 * pass nowhere near the real route. Slerp follows the actual shortest path
 * over the globe, so a flight to Iceland correctly arcs north.
 */
function greatCircle(a: LatLng, b: LatLng, segments = 64): [number, number][] {
  const lat1 = toRad(a.lat);
  const lng1 = toRad(a.lng);
  const lat2 = toRad(b.lat);
  const lng2 = toRad(b.lng);

  const d =
    2 *
    Math.asin(
      Math.min(
        1,
        Math.sqrt(
          Math.sin((lat2 - lat1) / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin((lng2 - lng1) / 2) ** 2
        )
      )
    );

  // Coincident points: nothing to interpolate.
  if (d === 0) return [[a.lat, a.lng], [b.lat, b.lng]];

  const out: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lng1) + B * Math.cos(lat2) * Math.cos(lng2);
    const y = A * Math.cos(lat1) * Math.sin(lng1) + B * Math.cos(lat2) * Math.sin(lng2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    out.push([toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), toDeg(Math.atan2(y, x))]);
  }
  return out;
}

export function TripMap({ tripId }: { tripId: string }) {
  const { helpers, reservation } = useApp();
  const reservations = helpers.getReservations(tripId);

  /*
   * In-flight drag preview: a copy of the reservations with `order` rewritten
   * to the prospective positions. Null when no drag is active, in which case
   * the list renders straight from the persisted values.
   */
  const [previewOrder, setPreviewOrder] = useState<Map<string, number> | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const mapEl = useRef<HTMLDivElement | null>(null);
  /* Leaflet instances live in refs, not state: they are mutable third-party
     objects and re-rendering them through React would fight the library. */
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerRef = useRef<import("leaflet").LayerGroup | null>(null);
  /* Re-measures the map when the container gains real dimensions. */
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  /* Reframes the view; re-invoked after a resize so bounds stay correct. */
  const frameRef = useRef<(() => void) | null>(null);

  const [coords, setCoords] = useState<Map<string, LatLng>>(new Map());
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [legs, setLegs] = useState<Leg[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Which booking's inline editor is open in the stop list, if any. Keyed by
   * reservation (not stop) because a flight's two pins are one record — editing
   * either endpoint edits the same booking.
   */
  const [editingStopId, setEditingStopId] = useState<string | null>(null);

  /* Collect every distinct location named by a booking. */
  const locations = useMemo(() => {
    const set = new Set<string>();
    for (const r of reservations) {
      if (r.location) set.add(r.location);
      if (r.locationTo) set.add(r.locationTo);
    }
    return Array.from(set);
  }, [reservations]);

  const locationKey = locations.join("|");

  /*
   * Location strings are often fragments that only mean something alongside
   * their booking's title: a hotel whose location is just "Terminal 5" is a
   * nightclub in Manhattan to a geocoder, but Heathrow's terminal once the
   * title "Sofitel London Heathrow" is taken into account.
   *
   * A location may appear in more than one booking; the first title that owns
   * it wins, and only locations that have a title are given context.
   */
  const contexts = useMemo(() => {
    const map: Record<string, string> = {};
    for (const r of reservations) {
      const title = r.title?.trim();
      if (!title) continue;
      if (r.location && !map[r.location]) map[r.location] = title;
      if (r.locationTo && !map[r.locationTo]) map[r.locationTo] = title;
    }
    return map;
  }, [reservations]);

  const contextKey = JSON.stringify(contexts);

  /* --- Step 1: geocode the locations ------------------------------------ */
  useEffect(() => {
    let cancelled = false;
    if (locations.length === 0) {
      setLoading(false);
      setCoords(new Map());
      setUnresolved([]);
      return;
    }

    (async () => {
      setLoading(true);
      setError(null);

      /*
       * Seed from previously resolved coordinates first, so a cached map
       * appears immediately offline instead of after a failed request.
       */
      const cached = readCachedCoords(locations);
      if (cached.size > 0 && !cancelled) setCoords(cached);

      try {
        const res = await fetch("/api/geo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locations, contexts }),
        });
        if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
        const data = (await res.json()) as {
          points: { query: string; lat: number; lng: number }[];
          unresolved: string[];
        };
        if (cancelled) return;
        setCoords(new Map(data.points.map((p) => [p.query, { lat: p.lat, lng: p.lng }])));
        setUnresolved(data.unresolved ?? []);
        // Persist so the next offline visit can draw the map.
        writeCachedCoords(data.points);
      } catch {
        if (cancelled) return;
        /*
         * Offline (or the lookup failed). Fall back to whatever we had cached.
         * Only report an error if that leaves us with nothing to draw —
         * otherwise this is the offline case working as intended, not a
         * failure worth showing the user.
         */
        const fallback = readCachedCoords(locations);
        if (fallback.size > 0) {
          setCoords(fallback);
          setUnresolved([]);
        } else {
          setError("Could not look up those places. Check your connection.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // locationKey is the stable identity of the location set; depending on the
    // array itself would refetch on every render. contextKey changes only when
    // a disambiguating title changes, which can also change the answer.
  }, [locationKey, contextKey]);

  /*
   * The list renders from `reservations`, with any active drag preview applied
   * on top. Persisted order comes along in each reservation's `order` field, so
   * there is nothing else to keep in sync.
   */
  const orderedReservations = useMemo(() => {
    if (!previewOrder) return reservations;
    return reservations.map((r) =>
      previewOrder.has(r.id) ? { ...r, order: previewOrder.get(r.id) as number } : r
    );
  }, [reservations, previewOrder]);

  const stops = useMemo(
    () => buildStops(orderedReservations, coords),
    [orderedReservations, coords]
  );

  /*
   * Which booking types are currently drawn.
   *
   * The route is the spine of a trip — where you fly, sleep and drive — while
   * activities and meals are places you go *from* that spine. On a trip with a
   * dozen restaurants the pins crowd out the shape of the journey, so the
   * filter starts with every type on and lets the user peel categories away.
   *
   * `null` means "everything", which is deliberately distinct from "an empty
   * set": with `null` the count badge and pin numbering describe the whole
   * trip, and no filtering work happens at all on the common path.
   */
  const [hiddenTypes, setHiddenTypes] = useState<Set<ReservationType>>(() => new Set());

  const toggleType = (t: ReservationType) => {
    setHiddenTypes((cur) => {
      const next = new Set(cur);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  /*
   * The stops actually drawn, after the type filter.
   *
   * Applied here rather than at each render site so that everything derived
   * from a stop list — driving legs, air arcs, pin numbers, the itinerary rows
   * — agrees on what is on screen. Filtering later would leave a route line
   * jumping straight from a Philadelphia flight to a Merano restaurant, since
   * the legs are built from consecutive entries in this array.
   *
   * Numbers are reassigned from the filtered sequence: the pin labelled 3 is
   * the third stop visible, never "the third stop of the full trip", which
   * would show gaps the moment a category was hidden.
   */
  const visibleStops = useMemo(() => {
    if (hiddenTypes.size === 0) return stops;
    return stops
      .filter((s) => !hiddenTypes.has(s.type))
      .map((s, i) => ({ ...s, index: i + 1 }));
  }, [stops, hiddenTypes]);

  /*
   * Type tallies for the filter chips, counted over the *whole* trip so a chip
   * never changes its own number as other categories are switched off — only
   * its on/off state moves.
   */
  const typeCounts = useMemo(() => {
    const counts = new Map<ReservationType, number>();
    for (const s of stops) counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
    return counts;
  }, [stops]);

  /*
   * Air legs are derived locally — no network call — because they do not need
   * a router: a flight is a great-circle arc between its two endpoints.
   *
   * A leg counts as air when both of its stops belong to the same booking and
   * that booking is a flight. Grouping by reservation (rather than trusting
   * adjacency alone) means a flight's departure and arrival stop are joined
   * even after the stops are reordered, while a hotel sitting between two
   * unrelated stops never becomes an arc.
   */
  const airLegs = useMemo<Leg[]>(() => {
    const out: Leg[] = [];
    for (let i = 0; i < visibleStops.length - 1; i++) {
      const a = visibleStops[i];
      const b = visibleStops[i + 1];
      if (a.reservationId !== b.reservationId) continue;
      if (a.type !== "flight") continue;
      // A single-endpoint flight produces one stop, so there is nothing to join.
      if (a.key === b.key) continue;
      out.push({
        fromIndex: i,
        toIndex: i + 1,
        distanceM: haversineM(a.point, b.point),
        durationS: 0, // a flight's duration is not a driving duration
        geometry: greatCircle(a.point, b.point, 64),
        isAir: true,
      });
    }
    return out;
  }, [visibleStops]);

  const airKey = airLegs.map((l) => `${l.fromIndex}-${l.toIndex}`).join(",");

  /* Road and air legs merged into one list, ordered along the itinerary.
     Declared before the drawing effect because both the map layers and the
     itinerary rows read from it. */
  const allLegs = useMemo(
    () => [...legs, ...airLegs].sort((a, b) => a.fromIndex - b.fromIndex),
    [legs, airLegs]
  );

  /* --- Step 2: driving legs between consecutive stops -------------------- */
  const stopsKey = visibleStops.map((s) => `${s.point.lat},${s.point.lng}`).join(";");

  useEffect(() => {
    let cancelled = false;
    // Road routing only makes sense for hops that are not flights, and only
    // for hops near enough to plausibly be a drive. A transcontinental hop is
    // never drivable — and OSRM does not reject one, it relocates the endpoint
    // and returns a confident wrong route (see MAX_DRIVABLE_M). Never send it.
    const roadHops: { a: number; b: number }[] = [];
    for (let i = 0; i < visibleStops.length - 1; i++) {
      const isAir =
        visibleStops[i].reservationId === visibleStops[i + 1].reservationId &&
        visibleStops[i].type === "flight";
      if (isAir) continue;
      if (haversineM(visibleStops[i].point, visibleStops[i + 1].point) > MAX_DRIVABLE_M) continue;
      roadHops.push({ a: i, b: i + 1 });
    }

    if (roadHops.length === 0) {
      setLegs([]);
      return;
    }

    (async () => {
      try {
        const res = await fetch("/api/route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            hops: roadHops.map((h) => ({ from: visibleStops[h.a].point, to: visibleStops[h.b].point })),
          }),
        });
        if (!res.ok) return; // legs are a bonus; the map still works without them
        const data = (await res.json()) as {
          legs: { distanceM: number; durationS: number; geometry: [number, number][] }[];
        };
        if (cancelled) return;
        // The API answers in request order, so zip the results back onto the
        // hop indices to preserve which stops each leg connects.
        const mapped: Leg[] = (data.legs ?? []).map((l, i) => ({
          ...l,
          fromIndex: roadHops[i].a,
          toIndex: roadHops[i].b,
        }));
        setLegs(mapped);
      } catch {
        // Ignore: the pins are the essential part, the route line is not.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [stopsKey, airKey]);

  /* --- Step 3: create the Leaflet map once ------------------------------- */
  useEffect(() => {
    let disposed = false;

    (async () => {
      const L = await import("leaflet");
      if (disposed || !mapEl.current || mapRef.current) return;

      const map = L.map(mapEl.current, {
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: false, // avoids hijacking page scroll on mobile
      });
      mapRef.current = map;

      /*
       * Dark basemap: Esri "World Dark Gray Canvas", which is two layers.
       *
       * The base layer carries land, water and terrain shaded for a dark UI;
       * the reference layer is a 99% transparent overlay holding only labels
       * and road lines. Leaflet draws them stacked, so the pair behaves as one
       * labelled dark basemap.
       *
       * Why not CARTO's dark_all: it serves tiles without a key, but the
       * keyless tiles are a low-detail fallback (measured 15-17 distinct grey
       * levels per tile against 175 here, i.e. flat washes with no roads or
       * labels) and they carry a provider watermark. Its authenticated
       * endpoint is a separate host that does not resolve on this network.
       * Esri's canvas tiles need no key and are genuinely detailed.
       *
       * A CSS `invert()` over standard OSM tiles was also rejected: it inverts
       * labels along with the land, leaving place names muddy and low-contrast
       * against the app's zinc palette.
       *
       * Esri's REST tile path is /{z}/{y}/{x} -- row before column, the
       * reverse of the usual slippy-map convention. Leaflet's {y}/{x} tokens
       * are ordered to match; swapping them silently serves valid PNGs of the
       * wrong places rather than erroring, so do not "tidy" this URL.
       */
      L.tileLayer(
        "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 16, // Esri canvas coverage ends here
          attribution:
            "Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, &copy; OpenStreetMap contributors",
        }
      ).addTo(map);

      // Labels/roads overlay. Drawn above the base but below the route layers
      // added later, so pins and legs are never occluded by place names.
      L.tileLayer(
        "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 16,
          attribution:
            "Labels &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, &copy; OpenStreetMap contributors",
        }
      ).addTo(map);

      /*
       * Leaflet measures its container when the map is created. This component
       * starts with the map container collapsed (height 0) until geocoding
       * resolves, and a map created against a zero-sized element caches that
       * as its viewport — after which fitBounds projects markers millions of
       * pixels off-screen and the user sees an empty map.
       *
       * ResizeObserver fires with the real size as soon as the container is
       * expanded, and invalidateSize() re-measures so framing happens against
       * correct dimensions.
       */
      const el = mapEl.current;
      const ro = new ResizeObserver(() => {
        if (disposed) return;
        map.invalidateSize();
        // Reframe now that the viewport is trustworthy.
        if (frameRef.current) frameRef.current();
      });
      ro.observe(el);
      resizeObserverRef.current = ro;

      setMapReady(true);
    })();

    return () => {
      disposed = true;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      const m = mapRef.current;
      if (m) m.remove();
      mapRef.current = null;
      layerRef.current = null;
      frameRef.current = null;
    };
  }, []);

  /* --- Step 4: draw pins and legs whenever the data changes -------------- */
  useEffect(() => {
    if (!mapReady) return;

    (async () => {
      const L = await import("leaflet");
      const map = mapRef.current;
      if (!map) return;

      if (layerRef.current) map.removeLayer(layerRef.current);

      const group = L.layerGroup();

      // Route lines first, so pins sit on top of them. Both kinds are drawn
      // from the merged list — drawing only the road legs would silently drop
      // every flight arc.
      for (const leg of allLegs) {
        if (leg.geometry?.length > 1) {
          L.polyline(
            leg.geometry.map(([la, ln]) => [la, ln] as [number, number]),
            {
              // Flights are a distinct visual language: solid sage rather than
              // the dashed road style, so an air hop never reads as a drivable
              // leg. These are the sage ramp's 400/500 (see globals.css); Leaflet
              // needs literal colours, so they are duplicated here rather than
              // read from CSS custom properties.
              color: leg.isAir ? "#82ab99" : "#739e8b",
              weight: leg.isAir ? 2 : 3,
              opacity: leg.isAir ? 0.9 : 0.75,
              dashArray: leg.isAir ? undefined : "6 6",
            }
          ).addTo(group);
        }
      }

      // Pin markers. A numbered divIcon is used instead of Leaflet's default
      // image marker: the default png paths break under bundlers, and numbers
      // make the itinerary order readable at a glance.
      //
      // The border is near-black and the halo is a translucent white ring. On
      // the dark basemap a transparent gap alone would let dark land show
      // through and swallow the pin's edge, so the ring separates the emerald
      // disc from whatever is behind it.
      for (const stop of visibleStops) {
        const icon = L.divIcon({
          className: "",
          html: `<div style="
              display:flex;align-items:center;justify-content:center;
              width:26px;height:26px;border-radius:9999px;
              background:#739e8b;color:#0b1f18;font:700 12px/1 ui-sans-serif,system-ui;
              border:2px solid #09090b;
              box-shadow:0 0 0 2px rgba(255,255,255,.28), 0 2px 6px rgba(0,0,0,.6);
            ">${stop.index}</div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });

        const when = stop.date ? formatDate(stop.date) : "";
        L.marker([stop.point.lat, stop.point.lng], { icon })
          .bindPopup(
            `<div style="font:13px/1.45 ui-sans-serif,system-ui;color:#e4e4e7;min-width:150px">
               <div style="font-weight:600;margin-bottom:2px">${stop.index}. ${stop.name}</div>
               <div style="color:#a1a1aa;font-size:12px">${stop.detail}</div>
               ${when ? `<div style="color:#a1a1aa;font-size:12px;margin-top:2px">${when}</div>` : ""}
             </div>`
          )
          .addTo(group);
      }

      group.addTo(map);
      layerRef.current = group;

      /*
       * Framing is stored as a callback rather than run inline so the resize
       * observer can repeat it. Measuring before the container has real
       * dimensions gives a meaningless projection, so the view is (re)set
       * whenever the size changes.
       */
      const frame = () => {
        if (visibleStops.length === 0) return;
        if (visibleStops.length === 1) {
          map.setView([visibleStops[0].point.lat, visibleStops[0].point.lng], 11);
        } else {
          map.fitBounds(
            L.latLngBounds(
              visibleStops.map((s) => [s.point.lat, s.point.lng] as [number, number])
            ),
            { padding: [40, 40], maxZoom: 12 }
          );
        }
      };
      frameRef.current = frame;

      // Only frame immediately if the container is actually measurable;
      // otherwise the ResizeObserver will do it once it has a size.
      const rect = mapEl.current?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) {
        map.invalidateSize();
        frame();
      }
    })();
  }, [mapReady, stopsKey, legs, airKey]);

  // Totals cover driving only: mixing a 3,600-mile flight into a "miles
  // driven" figure would make the driving total meaningless.
  const driven = allLegs.filter((l) => !l.isAir);
  const totalDistance = driven.reduce((sum, l) => sum + l.distanceM, 0);
  const totalDuration = driven.reduce((sum, l) => sum + l.durationS, 0);
  const flownDistance = airLegs.reduce((sum, l) => sum + l.distanceM, 0);
  const hasStops = visibleStops.length > 0;
  // Hops with no driving route and no flight either — ferries, or anywhere
  // OSRM has no coverage. Surfaced so a missing line reads as "not drivable"
  // rather than as a bug.
  const skippedLegs = Math.max(0, visibleStops.length - 1 - allLegs.length);

  /*
   * --- Reordering ---------------------------------------------------------
   *
   * Ordering operates on reservations, not on map stops. A flight contributes
   * two stops, so dragging one of its pins cannot meaningfully move it on its
   * own — the booking would have to leave half of itself behind. Grouping at
   * the reservation level keeps a flight's endpoints together.
   *
   * `stop.reservationId` is translated to a position in the current stop list,
   * so a drag expressed in stop indices maps onto the reservation it belongs to.
   */
  /*
   * Reservations that actually appear on the map, in itinerary order. These are
   * the ones with a draggable row.
   */
  const reservationIds = useMemo(
    () => Array.from(new Set(stops.map((s) => s.reservationId))),
    [stops]
  );

  /*
   * Every reservation on the trip, in itinerary order — including the ones with
   * no coordinates that therefore have no map stop.
   *
   * Reordering has to renumber this full list, not just the mapped subset. The
   * `order` column is one sequence per trip, so rewriting only the mapped ids
   * leaves the unmapped ones holding their old values: positions collide and
   * whichever value the moved ids vacated simply disappears. That showed up as
   * two bookings sharing order 5 and order 10 going missing.
   *
   * The unmapped bookings are carried through in their existing positions, so a
   * drag never disturbs an order the user set for something off-map.
   */
  const allReservationIds = useMemo(() => {
    const sorted = [...reservations].sort((a, b) => {
      const ao = Number.isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER;
      const bo = Number.isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return String(a.id).localeCompare(String(b.id));
    });
    return sorted.map((r) => r.id);
  }, [reservations]);

  /**
   * Move the reservation at `from` so it sits at `to`, returning the full id
   * order for the trip.
   *
   * `from`/`to` are positions in the mapped subset (the draggable rows), so they
   * are translated into the full list before splicing — otherwise the splice
   * would move the wrong booking whenever an unmapped one is interleaved.
   */
  const moveReservation = (from: number, to: number): string[] => {
    const next = [...allReservationIds];
    const movedId = reservationIds[from];
    const targetId = reservationIds[to];
    if (!movedId || !targetId) return next;
    const fromFull = next.indexOf(movedId);
    const toFull = next.indexOf(targetId);
    if (fromFull < 0 || toFull < 0) return next;
    const [moved] = next.splice(fromFull, 1);
    next.splice(toFull, 0, moved);
    return next;
  };

  /**
   * Commit an order: paint it immediately so the drag feels instant, then
   * persist. The preview is dropped once the server echoes the new order back,
   * so the rendered list falls through to the stored `order` column.
   */
  const commitOrder = async (ids: string[]) => {
    setPreviewOrder(new Map(ids.map((id, i) => [id, i])));
    try {
      await reservation.reorder(tripId, ids);
    } finally {
      // Clear either way: on success the persisted order is now correct, and
      // on failure dropping the preview reveals the true stored order rather
      // than leaving an optimistic one on screen.
      setPreviewOrder(null);
    }
  };

  const nudge = (resId: string, delta: number) => {
    const from = reservationIds.indexOf(resId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= reservationIds.length) return;
    void commitOrder(moveReservation(from, to));
  };

  /* Reservation position for the stop at index `i` — used by the drag rows. */
  const resPosOfStop = (i: number) => reservationIds.indexOf(stops[i].reservationId);

  const onDragStart = (i: number) => {
    setDragIndex(resPosOfStop(i));
    setOverIndex(resPosOfStop(i));
  };

  /*
   * Recompute the previewed order as the pointer crosses each row, so the list
   * shows where the booking will land rather than only highlighting a target.
   */
  const onDragOverRow = (i: number) => {
    if (dragIndex === null) return;
    const target = resPosOfStop(i);
    if (target === overIndex) return;
    setOverIndex(target);
    const ids = moveReservation(dragIndex, target);
    setPreviewOrder(new Map(ids.map((id, idx) => [id, idx])));
  };

  const onDrop = () => {
    if (dragIndex !== null && overIndex !== null && dragIndex !== overIndex) {
      const ids = moveReservation(dragIndex, overIndex);
      setDragIndex(null);
      setOverIndex(null);
      void commitOrder(ids);
      return;
    }
    setDragIndex(null);
    setOverIndex(null);
    setPreviewOrder(null);
  };

  return (
    <div className="surface-raised rounded-xl border border-white/8 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Route className="h-4 w-4 text-emerald-400" />
          <h2 className="text-sm font-medium text-zinc-200">Route</h2>
          {hasStops && (
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-zinc-400">
              {hiddenTypes.size === 0
                ? `${visibleStops.length} ${visibleStops.length === 1 ? "stop" : "stops"}`
                : `${visibleStops.length} of ${stops.length} stops`}
            </span>
          )}
        </div>

        {(totalDistance > 0 || flownDistance > 0) && (
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-400">
            {totalDistance > 0 && (
              <>
                <span className="inline-flex items-center gap-1" title="Total distance driven">
                  <Route className="h-3 w-3 text-zinc-500" />
                  {fmtDistance(totalDistance)} drive
                </span>
                <span className="inline-flex items-center gap-1" title="Total time driving">
                  <Clock className="h-3 w-3 text-zinc-500" />
                  {fmtDuration(totalDuration)}
                </span>
              </>
            )}
            {flownDistance > 0 && (
              <span className="inline-flex items-center gap-1 text-emerald-300/80" title="Total distance flown">
                <Plane className="h-3 w-3" />
                {fmtDistance(flownDistance)} flight
              </span>
            )}
          </div>
        )}
      </div>

      {/*
        * Type filter.
        *
        * Shown only once there is something to filter, so a trip with three
        * flights does not carry a row of chips that can never do anything.
        *
        * Chips are plain buttons rather than a select because the point is to
        * see the shape of the trip at a glance: which categories exist, and how
        * many places each holds. Counts come from the whole trip, so a chip's
        * number never shifts as its neighbours are toggled.
        */}
      {!loading && hasStops && typeCounts.size > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {FILTERABLE_TYPES.filter((t) => typeCounts.has(t)).map((t) => {
            const Meta = TYPE_FILTER_META[t];
            const off = hiddenTypes.has(t);
            const count = typeCounts.get(t) ?? 0;
            return (
              <Tooltip
                key={t}
                label={off ? `Show ${Meta.plural}` : `Hide ${Meta.plural}`}
              >
                <button
                  type="button"
                  onClick={() => toggleType(t)}
                  aria-pressed={!off}
                  title={off ? `Show ${Meta.plural}` : `Hide ${Meta.plural}`}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] transition-colors",
                    off
                      ? "border-white/8 bg-transparent text-zinc-500 hover:text-zinc-300"
                      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:border-emerald-500/50"
                  )}
                >
                  <Meta.icon className="h-3 w-3" />
                  <span>{Meta.plural}</span>
                  <span className={cn("tabular-nums", off ? "text-zinc-500" : "text-emerald-400/70")}>
                    {count}
                  </span>
                </button>
              </Tooltip>
            );
          })}
          {hiddenTypes.size > 0 && (
            <button
              type="button"
              onClick={() => setHiddenTypes(new Set())}
              title="Show every category again"
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-zinc-500 transition-colors hover:text-emerald-400"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          )}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 py-8 text-sm text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
          Locating your bookings…
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center gap-2 py-6 text-sm text-amber-400">
          <AlertTriangle className="h-4 w-4" />
          {error}
        </div>
      )}

      {!loading && !error && !hasStops && (
        <p className="py-2 text-sm text-zinc-500">
          No located bookings yet. Add a reservation with a city or address and it
          will appear here as a stop.
        </p>
      )}

      {/*
       * Two nested nodes on purpose.
       *
       * The outer node is React's: it owns the sizing classes. The inner node is
       * Leaflet's, and React never sets a className on it — Leaflet adds
       * `leaflet-container` there itself.
       *
       * They must be separate. Leaflet scopes its layout CSS to
       * `.leaflet-container`, and React rewrites an element's class attribute
       * whenever a computed className changes. When both lived on one node,
       * re-renders stripped `leaflet-container`, every pane collapsed to zero
       * width, and Tailwind's `img { max-width: 100% }` preflight then clamped
       * the 256px tiles to 0 — leaving pins visible against a blank map.
       */}
      <div
        className={cn(
          "z-0 w-full overflow-hidden rounded-lg border border-white/8",
          hasStops && !loading ? "h-[280px] sm:h-[380px]" : "h-0 border-0"
        )}
      >
        <div ref={mapEl} className="h-full w-full" />
      </div>

      {!loading && hasStops && (
        <div className="mt-3 space-y-1.5">
          {visibleStops.map((s, i) => {
            // The leg leaving this stop, of whichever kind.
            const leg = allLegs.find((l) => l.fromIndex === i);
            // A zero-distance road leg means two bookings share a location (a
            // flight landing where a car is collected). Showing "0.0 mi drive"
            // is noise, so those are rendered as a plain connection.
            const showLeg = leg && i < visibleStops.length - 1 && (leg.isAir || leg.distanceM > 10);
            /*
             * A row is draggable only when its stop is the first one belonging
             * to its booking. For a flight that means the departure pin carries
             * the handle and the arrival pin does not, so a two-stop booking
             * presents one drag target instead of two that fight each other.
             */
            const resPos = resPosOfStop(i);
            const isGroupStart =
              visibleStops.findIndex((x) => x.reservationId === s.reservationId) === i;
            const isDragging = dragIndex !== null && dragIndex === resPos && isGroupStart;
            return (
              <div
                key={s.key}
                onDragOver={(e) => {
                  if (dragIndex === null) return;
                  // Required for onDrop to fire at all.
                  e.preventDefault();
                  onDragOverRow(i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  onDrop();
                }}
                className={cn(
                  "rounded-md transition-colors",
                  isDragging && "opacity-40",
                  isGroupStart && dragIndex !== null && "bg-white/[0.03]"
                )}
              >
                <div className="flex items-center gap-2 text-xs">
                  {isGroupStart ? (
                    <div
                      draggable
                      onDragStart={() => onDragStart(i)}
                      onDragEnd={onDrop}
                      title="Drag to reorder"
                      className="group flex cursor-grab items-center gap-1 active:cursor-grabbing"
                    >
                      <GripVertical className="h-3.5 w-3.5 shrink-0 text-zinc-600 group-hover:text-emerald-400" />
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-semibold text-white">
                        {s.index}
                      </span>
                    </div>
                  ) : (
                    /* Indent under the handle so a flight's arrival pin reads as
                       a continuation of the booking above it. */
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-900/60 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-500/20 ml-[18px]">
                      {s.index}
                    </span>
                  )}
                  <span className="truncate text-zinc-300">{s.name}</span>
                  {s.date && <span className="shrink-0 text-zinc-500">{formatDate(s.date)}</span>}

                  {isGroupStart && (
                    /* Edit and reorder. HTML5 drag is unavailable to keyboard
                       and touch users, so both operations are also exposed as
                       buttons sized to the 24px minimum touch target. */
                    <span className="ml-auto flex shrink-0 items-center gap-0.5">
                      <Tooltip label="Edit this stop">
                        <button
                          type="button"
                          onClick={() =>
                            setEditingStopId((cur) => (cur === s.reservationId ? null : s.reservationId))
                          }
                          title="Edit this stop"
                          aria-label={`Edit ${s.name}`}
                          aria-expanded={editingStopId === s.reservationId}
                          className={cn(
                            "grid h-6 w-6 place-items-center rounded transition-colors",
                            editingStopId === s.reservationId
                              ? "text-emerald-400"
                              : "text-zinc-600 hover:text-emerald-400"
                          )}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </Tooltip>
                      <button
                        type="button"
                        onClick={() => nudge(s.reservationId, -1)}
                        disabled={resPos === 0}
                        title="Move earlier"
                        aria-label="Move earlier"
                        className="grid h-6 w-6 place-items-center rounded text-zinc-600 transition-colors hover:text-emerald-400 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-zinc-600"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => nudge(s.reservationId, 1)}
                        disabled={resPos === reservationIds.length - 1}
                        title="Move later"
                        aria-label="Move later"
                        className="grid h-6 w-6 place-items-center rounded text-zinc-600 transition-colors hover:text-emerald-400 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:text-zinc-600"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  )}
                </div>
                {showLeg && (
                  <div
                    className={cn(
                      "ml-2.5 py-0.5 pl-4 text-[11px]",
                      leg.isAir
                        ? "border-l border-emerald-400/30 text-emerald-300/80"
                        : "border-l border-dashed border-white/10 text-zinc-500"
                    )}
                  >
                    {leg.isAir ? (
                      <>
                        {fmtDistance(leg.distanceM)} · flight
                      </>
                    ) : (
                      <>
                        {fmtDistance(leg.distanceM)} · {fmtDuration(leg.durationS)} drive
                      </>
                    )}
                  </div>
                )}
                {/*
                  Inline editor. Rendered only on the group's first stop so a
                  flight's two pins do not each offer their own copy of the same
                  booking's form.
                */}
                {isGroupStart && editingStopId === s.reservationId && (() => {
                  const res = reservations.find((x) => x.id === s.reservationId);
                  return res ? (
                    <StopEditor reservation={res} onClose={() => setEditingStopId(null)} />
                  ) : null;
                })()}
              </div>
            );
          })}
        </div>
      )}

      {unresolved.length > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 text-[11px] text-amber-300/90">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            Couldn’t place {unresolved.length === 1 ? "this location" : "these locations"}:{" "}
            <span className="text-amber-200">{unresolved.join(", ")}</span>. Try adding a
            country or full address.
          </div>
        </div>
      )}

      {!loading && hasStops && (
        <p className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] text-zinc-600">
          <ExternalLink className="h-3 w-3" />
          {skippedLegs > 0
            ? `${skippedLegs} leg${skippedLegs === 1 ? "" : "s"} not drivable (ferry or no road) · `
            : ""}
          Drag <GripVertical className="inline h-3 w-3" /> to reorder stops · Driving
          distances via OSRM · Maps © Esri, © OpenStreetMap contributors
        </p>
      )}
    </div>
  );
}
