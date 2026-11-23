import { useEffect, useRef, useState } from 'react'
import { LngLatBounds, Map as MapLibreMap, Marker, setWorkerUrl, type GeoJSONSource, type LngLatLike } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Minus, Plus } from 'lucide-react'
import type { LatLon } from '../../lib/geo'

// Vite pre-bundles maplibre-gl, which breaks its own relative worker URL.
setWorkerUrl(workerUrl)

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
const ROUTE_SOURCE = 'trip-route'

export interface MapPoint extends LatLon {
  id: string
  label: string
  title: string
}

export interface MapPadding {
  top: number
  right: number
  bottom: number
  left: number
}

interface Props {
  center: LatLon | null
  points: MapPoint[]
  padding: MapPadding
  /** Where the zoom buttons and credit sit, measured from the right and bottom edges. */
  chrome: { right: number; bottom: number }
  selectedId: string | null
  onSelect: (id: string) => void
}

type RouteData = Parameters<GeoJSONSource['setData']>[0]

function routeData(points: MapPoint[]): RouteData {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: points.map((p) => [p.lon, p.lat]) },
  } as RouteData
}

function markerElement(point: MapPoint, onSelect: (id: string) => void): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'trip-marker'
  el.textContent = point.label
  el.setAttribute('aria-label', `Stop ${point.label}: ${point.title}`)
  el.title = point.title
  el.addEventListener('click', (event) => {
    event.stopPropagation()
    onSelect(point.id)
  })
  return el
}

export default function TripMap({ center, points, padding, chrome, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef<Map<string, Marker>>(new Map())
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const [failed, setFailed] = useState(false)
  const [styleReady, setStyleReady] = useState(false)

  const initialCenter = useRef(center)
  useEffect(() => {
    if (!containerRef.current) return
    let map: MapLibreMap
    try {
      const start = initialCenter.current
      map = new MapLibreMap({
        container: containerRef.current,
        style: STYLE_URL,
        center: start ? [start.lon, start.lat] : [10, 30],
        zoom: start ? 12 : 1.4,
        attributionControl: false,
        cooperativeGestures: false,
      })
    } catch {
      setFailed(true)
      return
    }
    map.on('error', () => {})
    map.on('load', () => {
      map.addSource(ROUTE_SOURCE, { type: 'geojson', data: routeData([]) })
      map.addLayer({
        id: ROUTE_SOURCE,
        type: 'line',
        source: ROUTE_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#0f4c3a', 'line-width': 2.5, 'line-opacity': 0.75, 'line-dasharray': [1.5, 1.5] },
      })
      setStyleReady(true)
    })
    mapRef.current = map
    const markers = markersRef.current
    return () => {
      markers.forEach((m) => m.remove())
      markers.clear()
      map.remove()
      mapRef.current = null
    }
  }, [])

  const pointKey = points.map((p) => `${p.id}:${p.lat},${p.lon},${p.label}`).join('|')
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const markers = markersRef.current
    const keep = new Set(points.map((p) => p.id))
    for (const [id, marker] of markers) {
      if (!keep.has(id)) {
        marker.remove()
        markers.delete(id)
      }
    }
    for (const point of points) {
      const existing = markers.get(point.id)
      if (existing) {
        existing.setLngLat([point.lon, point.lat])
        const el = existing.getElement()
        el.textContent = point.label
        el.title = point.title
        el.setAttribute('aria-label', `Stop ${point.label}: ${point.title}`)
      } else {
        const marker = new Marker({ element: markerElement(point, (id) => onSelectRef.current(id)) })
          .setLngLat([point.lon, point.lat])
          .addTo(map)
        markers.set(point.id, marker)
      }
    }
    if (styleReady) (map.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined)?.setData(routeData(points))
  }, [pointKey, styleReady])

  const frameKey = `${pointKey}#${center?.lat},${center?.lon}`
  const paddingRef = useRef(padding)
  paddingRef.current = padding
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const pad = paddingRef.current
    if (points.length > 1) {
      const bounds = new LngLatBounds()
      for (const p of points) bounds.extend([p.lon, p.lat])
      map.fitBounds(bounds, { padding: pad, maxZoom: 14, duration: 600 })
    } else if (points.length === 1) {
      map.easeTo({ center: [points[0].lon, points[0].lat], zoom: 14, padding: pad, duration: 600 })
    } else if (center) {
      map.easeTo({ center: [center.lon, center.lat] as LngLatLike, zoom: 12, padding: pad, duration: 600 })
    }
  }, [frameKey])

  useEffect(() => {
    for (const [id, marker] of markersRef.current) {
      marker.getElement().classList.toggle('is-selected', id === selectedId)
    }
    const point = points.find((p) => p.id === selectedId)
    if (point && mapRef.current) {
      mapRef.current.easeTo({ center: [point.lon, point.lat], padding: paddingRef.current, duration: 500 })
    }
  }, [selectedId])

  if (failed) {
    return (
      <div className="map-fallback absolute inset-0 flex items-center justify-center" data-testid="trip-map">
        <p className="rounded-full bg-card/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
          The map needs WebGL, which this browser has turned off.
        </p>
      </div>
    )
  }

  return (
    <div className="absolute inset-0" data-testid="trip-map">
      <div ref={containerRef} className="map-fallback h-full w-full" />
      <div
        className="absolute flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm"
        style={{ right: chrome.right, bottom: chrome.bottom + 24 }}
      >
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => mapRef.current?.zoomIn()}
          className="flex size-9 items-center justify-center text-foreground hover:bg-secondary"
        >
          <Plus aria-hidden className="size-4" />
        </button>
        <span className="h-px bg-border" />
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => mapRef.current?.zoomOut()}
          className="flex size-9 items-center justify-center text-foreground hover:bg-secondary"
        >
          <Minus aria-hidden className="size-4" />
        </button>
      </div>
      <p
        className="pointer-events-auto absolute truncate text-right text-[10px] text-muted-foreground"
        style={{ right: chrome.right, bottom: chrome.bottom }}
      >
        <span className="whitespace-nowrap rounded bg-card/85 px-1.5 py-0.5">
          <a href="https://openfreemap.org" target="_blank" rel="noreferrer" className="hover:text-foreground">OpenFreeMap</a>
          {' © '}
          <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer" className="hover:text-foreground">OpenMapTiles</a>
          {' Data from '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="hover:text-foreground">
            OpenStreetMap
          </a>
        </span>
      </p>
    </div>
  )
}
