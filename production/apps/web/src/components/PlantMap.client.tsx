'use client';

/**
 * Leaflet + OpenStreetMap map for a plant's location in the garden.
 * Tile source: openstreetmap.org (free, no key). Center: Oulu Botanical
 * Garden (65.0617° N, 25.4661° E). Pin uses a custom HTML divIcon styled
 * to the BloomOulu palette + the red-list color so the marker visually
 * carries conservation status.
 *
 * Imports are static (Next.js client-only). Leaflet's CSS is imported as
 * a side-effect; bundler will inline it into the page chunk.
 */

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const GARDEN_CENTER: [number, number] = [65.0617, 25.4661];

const RED_LIST_COLOR: Record<string, string> = {
  CR: '#B8513A',
  EN: '#C77E45',
  VU: '#C19A3D',
  NT: '#88A050',
  LC: '#5FB0A0',
  DD: '#9DA8B4',
  EX: '#7A5C4A',
  NA: '#5FB0A0',
};

export function PlantMap({
  lat,
  lng,
  redListStatus,
  zone,
  label,
  height = 360,
}: {
  lat: number | null | undefined;
  lng: number | null | undefined;
  redListStatus: string;
  zone?: string | null;
  label: string;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const center: [number, number] = lat != null && lng != null ? [Number(lat), Number(lng)] : GARDEN_CENTER;
    if (mapRef.current) {
      mapRef.current.setView(center, 18);
      return;
    }
    const map = L.map(ref.current, {
      center,
      zoom: 18,
      scrollWheelZoom: true,
      attributionControl: true,
    });
    mapRef.current = map;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    const color = RED_LIST_COLOR[redListStatus] ?? '#5FB0A0';
    const icon = L.divIcon({
      className: '',
      html: `
        <div style="
          width: 28px; height: 28px; border-radius: 50%;
          background: ${color}; border: 3px solid #FAF7EE;
          box-shadow: 0 4px 14px rgba(31,58,44,0.35);
          display: flex; align-items: center; justify-content: center;
          font-family: ui-monospace, monospace; font-size: 10px;
          font-weight: 700; color: #FAF7EE;
        ">${redListStatus}</div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
    const marker = L.marker(center, { icon, alt: label }).addTo(map);
    const popupHtml = `<strong>${label}</strong>${zone ? `<br/><span style="font-size:12px;color:#6B7560;">${zone}</span>` : ''}`;
    marker.bindPopup(popupHtml).openPopup();

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng, redListStatus, zone, label]);

  return (
    <div
      ref={ref}
      role="img"
      aria-label={`Map of ${label}${zone ? ` · ${zone}` : ''}`}
      style={{
        width: '100%',
        height,
        borderRadius: 14,
        overflow: 'hidden',
        border: '1px solid var(--line)',
      }}
    />
  );
}
