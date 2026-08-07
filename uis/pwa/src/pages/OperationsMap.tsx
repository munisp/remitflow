import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import { trpcClient } from "../services/trpc";

interface MapLocation {
  id: number;
  location_type: string;
  external_ref: string;
  display_label: string;
  country_code: string;
  latitude: number;
  longitude: number;
  operational_status: string;
  metadata: Record<string, unknown>;
  observed_at: string | Date;
}

interface MapCorridor {
  id: number;
  corridor_code: string;
  operational_status: string;
  p95_completion_seconds: number | null;
  failure_rate_bps: number | null;
  observed_at: string | Date;
  origin: { latitude: number; longitude: number; label: string };
  destination: { latitude: number; longitude: number; label: string };
}

interface OperationsMapData {
  generatedAt: string;
  locations: MapLocation[];
  corridors: MapCorridor[];
}

const mapStyleUrl = import.meta.env.VITE_MAP_STYLE_URL as string | undefined;

function toPointFeature(location: MapLocation): Feature<Point> {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [location.longitude, location.latitude] },
    properties: {
      id: location.id,
      label: location.display_label,
      type: location.location_type,
      status: location.operational_status,
      country: location.country_code,
    },
  };
}

function toLineFeature(corridor: MapCorridor): Feature<LineString> {
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [corridor.origin.longitude, corridor.origin.latitude],
        [corridor.destination.longitude, corridor.destination.latitude],
      ],
    },
    properties: {
      code: corridor.corridor_code,
      status: corridor.operational_status,
      p95CompletionSeconds: corridor.p95_completion_seconds,
      failureRateBps: corridor.failure_rate_bps,
    },
  };
}

function colorForStatus(status: string): string {
  if (status === "active") return "#16a34a";
  if (status === "degraded") return "#d97706";
  if (status === "investigating") return "#dc2626";
  return "#64748b";
}

export default function OperationsMap() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [data, setData] = useState<OperationsMapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await trpcClient.operationsMap.overview.query({ includeIncidents: false });
        if (!cancelled) {
          setData(result as OperationsMapData);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Operational map data is unavailable.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!data || !mapStyleUrl || !containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyleUrl,
      center: [20, 5],
      zoom: 2,
      attributionControl: {},
    });
    mapRef.current = map;

    map.on("load", () => {
      const points: FeatureCollection<Point> = {
        type: "FeatureCollection",
        features: data.locations.map(toPointFeature),
      };
      const lines: FeatureCollection<LineString> = {
        type: "FeatureCollection",
        features: data.corridors.map(toLineFeature),
      };
      map.addSource("remitflow-operational-points", { type: "geojson", data: points });
      map.addSource("remitflow-operational-corridors", { type: "geojson", data: lines });
      map.addLayer({
        id: "remitflow-operational-corridors",
        type: "line",
        source: "remitflow-operational-corridors",
        paint: {
          "line-color": ["match", ["get", "status"], "active", "#16a34a", "degraded", "#d97706", "investigating", "#dc2626", "#64748b"],
          "line-width": 3,
          "line-opacity": 0.85,
        },
      });
      map.addLayer({
        id: "remitflow-operational-points",
        type: "circle",
        source: "remitflow-operational-points",
        paint: {
          "circle-radius": 7,
          "circle-color": ["match", ["get", "status"], "active", "#16a34a", "degraded", "#d97706", "investigating", "#dc2626", "#64748b"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
      map.on("click", "remitflow-operational-points", (event) => {
        const feature = event.features?.[0];
        if (!feature) return;
        new maplibregl.Popup()
          .setLngLat((feature.geometry as Point).coordinates as [number, number])
          .setHTML(`<strong>${String(feature.properties?.label ?? "Operational location")}</strong><br/>${String(feature.properties?.type ?? "")}: ${String(feature.properties?.status ?? "")}`)
          .addTo(map);
      });
      map.on("mouseenter", "remitflow-operational-points", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "remitflow-operational-points", () => { map.getCanvas().style.cursor = ""; });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [data]);

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Operational Map</h1>
        <p className="mt-1 text-sm text-slate-600">Tenant-scoped agent and corridor health. Customer locations are never shown.</p>
      </header>

      {loading && <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">Loading authorised operational data…</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {!loading && !error && !data && <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">No operational data is available for the active tenant.</div>}

      {data && (
        <>
          {mapStyleUrl ? (
            <div ref={containerRef} className="h-[520px] overflow-hidden rounded-xl border border-slate-200 bg-slate-100 shadow-sm" aria-label="Operational corridor map" />
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Map tiles are not configured. Set <code>VITE_MAP_STYLE_URL</code> to an approved, privacy-reviewed style endpoint; operational data remains available in the table below.
            </div>
          )}

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-4 py-3">
              <h2 className="font-medium text-slate-900">Corridor health</h2>
              <p className="text-xs text-slate-500">Data timestamp: {new Date(data.generatedAt).toLocaleString()}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Corridor</th><th className="px-4 py-3">Route</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">P95 completion</th><th className="px-4 py-3">Failure rate</th></tr></thead>
                <tbody>
                  {data.corridors.map((corridor) => <tr key={corridor.id} className="border-t border-slate-100"><td className="px-4 py-3 font-medium text-slate-900">{corridor.corridor_code}</td><td className="px-4 py-3 text-slate-600">{corridor.origin.label} → {corridor.destination.label}</td><td className="px-4 py-3"><span className="rounded-full px-2 py-1 text-xs font-medium text-white" style={{ backgroundColor: colorForStatus(corridor.operational_status) }}>{corridor.operational_status}</span></td><td className="px-4 py-3 text-slate-600">{corridor.p95_completion_seconds == null ? "Not reported" : `${corridor.p95_completion_seconds}s`}</td><td className="px-4 py-3 text-slate-600">{corridor.failure_rate_bps == null ? "Not reported" : `${(corridor.failure_rate_bps / 100).toFixed(2)}%`}</td></tr>)}
                  {data.corridors.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No approved corridor telemetry is available for this tenant.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
