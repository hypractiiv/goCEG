export type Position = [number, number]; // [longitude, latitude]

export type CampusFeature = {
  type: 'Feature';
  id?: string | number;
  properties: Record<string, unknown>;
  geometry: {
    type: string;
    coordinates: any;
  };
};

export type CampusFeatureCollection = {
  type: 'FeatureCollection';
  features: CampusFeature[];
};

type OsmElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
};

type OsmResponse = { elements?: OsmElement[]; remark?: string };

// OSM way 24831558 is the mapped College of Engineering, Guindy campus outline.
// Use map_to_area instead of hard-coded synthetic area IDs; modern Overpass versions no longer support the old way-area ID convention.
const CAMPUS_WAY_ID = 24_831_558;
const BBOX = '13.004,80.226,13.023,80.247'; // south,west,north,east; fallback only
const PATH_TAGS = 'footway|path|pedestrian|cycleway|service|residential|tertiary|unclassified|living_street|track|steps';
const CACHE_KEY = 'goceg:osm:v1';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

const areaQuery = `
[out:json][timeout:35];
way(${CAMPUS_WAY_ID})->.ceg_outline;
.ceg_outline map_to_area -> .campus;
(
  .ceg_outline;
  way(area.campus)["building"];
  way(area.campus)["highway"~"${PATH_TAGS}"];
  way(area.campus)["leisure"];
  way(area.campus)["landuse"];
  way(area.campus)["amenity"~"parking|college|university|school|library|cafe|canteen|restaurant|bicycle_parking|bus_station"];
  node(area.campus)["amenity"];
  node(area.campus)["shop"];
  node(area.campus)["tourism"];
  node(area.campus)["leisure"];
  node(area.campus)["office"];
  node(area.campus)["public_transport"];
);
out geom;
`;

const bboxQuery = `
[out:json][timeout:35];
(
  way(${CAMPUS_WAY_ID});
  way["building"](${BBOX});
  way["highway"~"${PATH_TAGS}"](${BBOX});
  node["amenity"](${BBOX});
  node["shop"](${BBOX});
  node["tourism"](${BBOX});
  node["public_transport"](${BBOX});
);
out geom;
`;

let inFlightLoad: Promise<{ data: CampusFeatureCollection; source: string }> | null = null;

async function askOverpass(query: string, endpoint: string): Promise<OsmResponse> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 42_000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({ data: query }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Overpass returned HTTP ${response.status}`);
    const data = (await response.json()) as OsmResponse;
    if (data.remark) throw new Error(data.remark);
    return data;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('The map query timed out. Retry in a moment or import a GeoJSON export.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function osmToFeatureCollection(data: OsmResponse): CampusFeatureCollection {
  const features: CampusFeature[] = [];
  for (const element of data.elements ?? []) {
    const tags = element.tags ?? {};
    const properties: Record<string, unknown> = {
      ...tags,
      osm_type: element.type,
      osm_id: element.id,
    };

    if (element.type === 'node' && element.lat != null && element.lon != null) {
      features.push({
        type: 'Feature',
        id: `node/${element.id}`,
        properties,
        geometry: { type: 'Point', coordinates: [element.lon, element.lat] },
      });
      continue;
    }

    // This first version deliberately converts ways only; multipolygon relations
    // need their outer/inner member rings assembled before they can be extruded.
    if (element.type !== 'way' || !element.geometry || element.geometry.length < 2) continue;
    const coordinates: Position[] = element.geometry.map((point) => [point.lon, point.lat]);
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    const closed = coordinates.length >= 4 && first[0] === last[0] && first[1] === last[1];

    if (tags.building && closed) {
      features.push({
        type: 'Feature',
        id: `way/${element.id}`,
        properties,
        geometry: { type: 'Polygon', coordinates: [coordinates] },
      });
    } else if (element.id === CAMPUS_WAY_ID && closed) {
      features.push({
        type: 'Feature',
        id: `way/${element.id}`,
        properties: { ...properties, campus_boundary: true },
        geometry: { type: 'LineString', coordinates },
      });
    } else if (tags.highway && coordinates.length >= 2) {
      features.push({
        type: 'Feature',
        id: `way/${element.id}`,
        properties,
        geometry: { type: 'LineString', coordinates },
      });
    } else if (closed && (tags.leisure || tags.landuse || tags.amenity)) {
      features.push({
        type: 'Feature',
        id: `way/${element.id}`,
        properties,
        geometry: { type: 'Polygon', coordinates: [coordinates] },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

function readCache(): { data: CampusFeatureCollection; source: string } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { savedAt: number; data: CampusFeatureCollection; source: string };
    if (!cached.savedAt || Date.now() - cached.savedAt > CACHE_TTL_MS || !Array.isArray(cached.data?.features)) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return { data: cached.data, source: `${cached.source} · cached` };
  } catch {
    return null;
  }
}

function writeCache(result: { data: CampusFeatureCollection; source: string }): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...result, savedAt: Date.now() }));
  } catch {
    // Private browsing or full storage must not prevent the map from loading.
  }
}

async function doLoadCegOsm(): Promise<{ data: CampusFeatureCollection; source: string }> {
  const cached = readCache();
  if (cached) return cached;

  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];
  const errors: string[] = [];

  // Try the campus area first, then fall back to a local bbox if the generated
  // area is missing on an Overpass replica or the query is temporarily unavailable.
  for (const endpoint of endpoints) {
    try {
      const result = osmToFeatureCollection(await askOverpass(areaQuery, endpoint));
      const buildingCount = result.features.filter((feature) => Boolean(feature.properties.building)).length;
      if (buildingCount >= 3) {
        const loaded = { data: result, source: 'OpenStreetMap · CEG campus area' };
        writeCache(loaded);
        return loaded;
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  for (const endpoint of endpoints) {
    try {
      const result = osmToFeatureCollection(await askOverpass(bboxQuery, endpoint));
      const buildingCount = result.features.filter((feature) => Boolean(feature.properties.building)).length;
      if (buildingCount > 0) {
        const loaded = { data: result, source: 'OpenStreetMap · CEG vicinity (bounding box)' };
        writeCache(loaded);
        return loaded;
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(`Could not load OpenStreetMap data. Retry or import GeoJSON. ${errors.slice(-2).join(' · ')}`);
}

export function loadCegOsm(): Promise<{ data: CampusFeatureCollection; source: string }> {
  if (!inFlightLoad) {
    inFlightLoad = doLoadCegOsm().finally(() => { inFlightLoad = null; });
  }
  return inFlightLoad;
}

export function parseGeoJson(text: string): CampusFeatureCollection {
  const parsed = JSON.parse(text) as CampusFeatureCollection | CampusFeature;
  const collection = parsed.type === 'FeatureCollection'
    ? parsed
    : parsed.type === 'Feature'
      ? { type: 'FeatureCollection' as const, features: [parsed] }
      : null;
  if (!collection || !Array.isArray(collection.features)) {
    throw new Error('The file must be a GeoJSON FeatureCollection or Feature.');
  }
  return collection as CampusFeatureCollection;
}
