"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { MapPin, Route, Loader2, AlertTriangle, Clock, ExternalLink } from "lucide-react";
import "leaflet/dist/leaflet.css";

import { useApp } from "@/lib/AppContext";
import { Reservation } from "@/lib/types";
import { formatDate } from "@/lib/dates";
import { Tooltip } from "@/components/ui/tooltip";
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

type LatLng = { lat: number; lng: number };

type Stop = {
  key: string;
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
};

/** Order reservations the same way the reservations list does. */
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
 * Flatten reservations into map stops.
 *
 * A booking with both endpoints (a flight, train or ferry) yields two stops;
 * everything else yields one. Only bookings whose location actually geocoded
 * are included, so an unresolved place silently drops out rather than
 * producing a pin at 0,0 in the Atlantic.
 */
function buildStops(res: Reservation[], coords: Map<string, LatLng>): Stop[] {
  const stops: Stop[] = [];
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

  for (const r of inItineraryOrder(res)) {
    const from = r.location ? coords.get(norm(r.location)) : undefined;
    const to = r.locationTo ? coords.get(norm(r.locationTo)) : undefined;

    if (from) {
      stops.push({
        key: `${r.id}-from`,
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

export function TripMap({ tripId }: { tripId: string }) {
  const { helpers } = useApp();
  const reservations = helpers.getReservations(tripId);

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
      try {
        const res = await fetch("/api/geo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locations }),
        });
        if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
        const data = (await res.json()) as {
          points: { query: string; lat: number; lng: number }[];
          unresolved: string[];
        };
        if (cancelled) return;
        setCoords(new Map(data.points.map((p) => [p.query, { lat: p.lat, lng: p.lng }])));
        setUnresolved(data.unresolved ?? []);
      } catch {
        if (!cancelled) setError("Could not look up those places. Check your connection.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // locationKey is the stable identity of the location set; depending on the
    // array itself would refetch on every render.
  }, [locationKey]);

  const stops = useMemo(() => buildStops(reservations, coords), [reservations, coords]);

  /* --- Step 2: driving legs between consecutive stops -------------------- */
  const stopsKey = stops.map((s) => `${s.point.lat},${s.point.lng}`).join(";");

  useEffect(() => {
    let cancelled = false;
    if (stops.length < 2) {
      setLegs([]);
      return;
    }

    (async () => {
      try {
        const res = await fetch("/api/route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            waypoints: stops.map((s) => s.point),
          }),
        });
        if (!res.ok) return; // legs are a bonus; the map still works without them
        const data = (await res.json()) as { legs: Leg[] };
        if (!cancelled) setLegs(data.legs ?? []);
      } catch {
        // Ignore: the pins are the essential part, the route line is not.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [stopsKey]);

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

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap contributors",
      }).addTo(map);

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

      // Route lines first, so pins sit on top of them.
      for (const leg of legs) {
        if (leg.geometry?.length > 1) {
          L.polyline(
            leg.geometry.map(([la, ln]) => [la, ln] as [number, number]),
            {
              color: "#10b981",
              weight: 3,
              opacity: 0.75,
              dashArray: "6 6",
            }
          ).addTo(group);
        }
      }

      // Pin markers. A numbered divIcon is used instead of Leaflet's default
      // image marker: the default png paths break under bundlers, and numbers
      // make the itinerary order readable at a glance.
      for (const stop of stops) {
        const icon = L.divIcon({
          className: "",
          html: `<div style="
              display:flex;align-items:center;justify-content:center;
              width:26px;height:26px;border-radius:9999px;
              background:#059669;color:#fff;font:600 12px/1 ui-sans-serif,system-ui;
              border:2px solid #064e3b;box-shadow:0 1px 4px rgba(0,0,0,.5);
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
        if (stops.length === 0) return;
        if (stops.length === 1) {
          map.setView([stops[0].point.lat, stops[0].point.lng], 11);
        } else {
          map.fitBounds(
            L.latLngBounds(stops.map((s) => [s.point.lat, s.point.lng] as [number, number])),
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
  }, [mapReady, stopsKey, legs]);

  const totalDistance = legs.reduce((sum, l) => sum + l.distanceM, 0);
  const totalDuration = legs.reduce((sum, l) => sum + l.durationS, 0);
  const hasStops = stops.length > 0;
  // Legs that have no driving route — flights, ferries, or anywhere OSRM has
  // no coverage. Surfaced in the footer so a missing line reads as "not
  // drivable" rather than as a bug.
  const skippedLegs = Math.max(0, stops.length - 1 - legs.length);

  return (
    <div className="surface-raised rounded-xl border border-white/5 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Route className="h-4 w-4 text-emerald-400" />
          <h2 className="text-sm font-medium text-zinc-200">Route</h2>
          {hasStops && (
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-zinc-400">
              {stops.length} {stops.length === 1 ? "stop" : "stops"}
            </span>
          )}
        </div>

        {totalDistance > 0 && (
          <div className="flex items-center gap-3 text-[11px] text-zinc-400">
            <span className="inline-flex items-center gap-1">
              <Route className="h-3 w-3 text-zinc-500" />
              {fmtDistance(totalDistance)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3 text-zinc-500" />
              {fmtDuration(totalDuration)}
            </span>
          </div>
        )}
      </div>

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

      {/* The map container stays mounted so Leaflet can attach to it; it is
          hidden only when there is nothing to show. */}
      <div
        ref={mapEl}
        className={cn(
          "z-0 w-full overflow-hidden rounded-lg border border-white/5",
          hasStops && !loading ? "h-[280px] sm:h-[380px]" : "h-0 border-0"
        )}
      />

      {!loading && hasStops && (
        <div className="mt-3 space-y-1.5">
          {stops.map((s, i) => {
            const leg = legs[i]; // leg i connects stop i -> i+1
            // A zero-distance leg means two bookings share a location (a
            // flight landing where a car is collected). Showing "0.0 mi drive"
            // is noise, so those are rendered as a plain connection.
            const showLeg = leg && i < stops.length - 1 && leg.distanceM > 10;
            return (
              <div key={s.key}>
                <div className="flex items-center gap-2 text-xs">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-semibold text-white">
                    {s.index}
                  </span>
                  <span className="truncate text-zinc-300">{s.name}</span>
                  {s.date && <span className="shrink-0 text-zinc-500">{formatDate(s.date)}</span>}
                </div>
                {showLeg && (
                  <div className="ml-2.5 border-l border-dashed border-white/10 py-0.5 pl-4 text-[11px] text-zinc-500">
                    {fmtDistance(leg.distanceM)} · {fmtDuration(leg.durationS)} drive
                  </div>
                )}
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
            ? `${skippedLegs} leg${skippedLegs === 1 ? "" : "s"} not drivable (flight, ferry or no road) · `
            : ""}
          Driving distances via OSRM · Maps © OpenStreetMap contributors
        </p>
      )}
    </div>
  );
}
