import type { CampusFeature, CampusFeatureCollection, Position } from './osm';

const CENTER_LAT = 13.0136;
const CENTER_LON = 80.2365;

function rectangle(name: string, dx: number, dz: number, width: number, depth: number, height: number, kind = 'academic'): CampusFeature {
  const latPerMeter = 1 / 110540;
  const lonPerMeter = 1 / (111320 * Math.cos(CENTER_LAT * Math.PI / 180));
  const corners: Position[] = [
    [CENTER_LON + (dx - width / 2) * lonPerMeter, CENTER_LAT + (-dz - depth / 2) * latPerMeter],
    [CENTER_LON + (dx + width / 2) * lonPerMeter, CENTER_LAT + (-dz - depth / 2) * latPerMeter],
    [CENTER_LON + (dx + width / 2) * lonPerMeter, CENTER_LAT + (-dz + depth / 2) * latPerMeter],
    [CENTER_LON + (dx - width / 2) * lonPerMeter, CENTER_LAT + (-dz + depth / 2) * latPerMeter],
    [CENTER_LON + (dx - width / 2) * lonPerMeter, CENTER_LAT + (-dz - depth / 2) * latPerMeter],
  ];
  return {
    type: 'Feature',
    id: `demo-${name}`,
    properties: { name, building: kind, height: String(height), demo: true },
    geometry: { type: 'Polygon', coordinates: [corners] },
  };
}

function line(name: string, points: Array<[number, number]>): CampusFeature {
  const latPerMeter = 1 / 110540;
  const lonPerMeter = 1 / (111320 * Math.cos(CENTER_LAT * Math.PI / 180));
  const coordinates = points.map(([x, z]) => [CENTER_LON + x * lonPerMeter, CENTER_LAT - z * latPerMeter]);
  return { type: 'Feature', id: `demo-path-${name}`, properties: { name, highway: 'footway', demo: true }, geometry: { type: 'LineString', coordinates } };
}

// Only used when Overpass is unavailable. These are illustrative blocks, not surveyed CEG buildings.
export const sampleData: CampusFeatureCollection = {
  type: 'FeatureCollection',
  features: [
    rectangle('Sample Academic Block A', -150, -80, 100, 64, 15),
    rectangle('Sample Academic Block B', 35, -140, 84, 56, 21),
    rectangle('Sample Laboratory', 205, -65, 84, 48, 12),
    rectangle('Sample Library', -15, 125, 104, 68, 18),
    rectangle('Sample Auditorium', 190, 155, 92, 65, 14),
    rectangle('Sample Cafeteria', -230, 85, 58, 44, 7, 'commercial'),
    line('Central pedestrian path', [[-350, 0], [-210, 0], [-80, 0], [70, 0], [230, 0], [350, 65]]),
    line('Library path', [[-80, 0], [-30, 50], [-15, 91], [-15, 125]]),
    line('Auditorium path', [[70, 0], [125, 50], [170, 100], [190, 155]]),
  ],
};
