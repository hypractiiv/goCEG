import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { CampusFeature, CampusFeatureCollection } from '../lib/osm';

const CENTER_LAT = 13.0136;
const CENTER_LON = 80.2365;
const METERS_PER_LAT = 110540;
const METERS_PER_LON = 111320 * Math.cos(CENTER_LAT * Math.PI / 180);

type Point3 = [number, number, number];
type LonLat = [number, number];
type Building = { key: string; name: string; feature: CampusFeature; ring: LonLat[]; height: number };
type ControlsHandle = { target: THREE.Vector3; update: () => void };

function project(position: LonLat): [number, number] {
  const [lon, lat] = position;
  return [(lon - CENTER_LON) * METERS_PER_LON, -(lat - CENTER_LAT) * METERS_PER_LAT];
}

function heightOf(feature: CampusFeature): number {
  const props = feature.properties;
  const explicit = Number.parseFloat(String(props.height ?? '').replace(/m$/i, ''));
  if (Number.isFinite(explicit) && explicit > 0 && explicit < 250) return explicit;
  const levels = Number.parseFloat(String(props['building:levels'] ?? props.levels ?? ''));
  if (Number.isFinite(levels) && levels > 0 && levels < 80) return levels * 3.2;
  const kind = String(props.building ?? '');
  if (kind === 'industrial' || kind === 'university' || kind === 'school') return 12;
  return 7;
}

function isCampusOutline(feature: CampusFeature): boolean {
  return feature.properties.campus_boundary === true || Number(feature.properties.osm_id) === 24831558;
}

function isBuilding(feature: CampusFeature): boolean {
  return Boolean(feature.properties.building) && feature.geometry.type === 'Polygon';
}

function polygonOuterRing(feature: CampusFeature): LonLat[] {
  if (feature.geometry.type !== 'Polygon' || !Array.isArray(feature.geometry.coordinates)) return [];
  const outerRing = feature.geometry.coordinates[0];
  if (!Array.isArray(outerRing)) return [];
  return outerRing.filter((point: unknown) => Array.isArray(point) && point.length >= 2).map((point: number[]) => [Number(point[0]), Number(point[1])] as LonLat);
}

function featureCenter(feature: CampusFeature): [number, number] {
  const geometry = feature.geometry;
  let points: LonLat[] = [];
  if (geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
    points = [[Number(geometry.coordinates[0]), Number(geometry.coordinates[1])]];
  } else if (geometry.type === 'Polygon') {
    points = polygonOuterRing(feature);
  } else if (geometry.type === 'LineString') {
    points = (geometry.coordinates as number[][]).map((position) => [Number(position[0]), Number(position[1])] as LonLat);
  }
  if (!points.length) return [0, 0];
  const [x, z] = points.reduce(([sumX, sumZ], point) => {
    const projected = project(point);
    return [sumX + projected[0], sumZ + projected[1]];
  }, [0, 0]);
  return [x / points.length, z / points.length];
}

function lineStrings(feature: CampusFeature): LonLat[][] {
  if (feature.geometry.type === 'LineString') {
    return [(feature.geometry.coordinates as number[][]).map((point) => [Number(point[0]), Number(point[1])] as LonLat)];
  }
  if (feature.geometry.type === 'MultiLineString') {
    return (feature.geometry.coordinates as number[][][]).map((line) => line.map((point) => [Number(point[0]), Number(point[1])] as LonLat));
  }
  return [];
}

function toLinePoints(coordinates: LonLat[], y = 0.8): Point3[] {
  return coordinates.map((position) => {
    const [x, z] = project(position);
    return [x, y, z];
  });
}

function buildShape(ring: LonLat[]): THREE.Shape | null {
  if (ring.length < 4) return null;
  const shape = new THREE.Shape();
  ring.forEach((position, index) => {
    const [x, z] = project(position);
    if (index === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  });
  shape.closePath();
  return shape;
}

function BuildingMesh({ building, selected, onSelect }: {
  building: Building;
  selected: boolean;
  onSelect: (feature: CampusFeature) => void;
}) {
  const geometry = useMemo(() => {
    const shape = buildShape(building.ring);
    if (!shape) return null;
    return new THREE.ExtrudeGeometry(shape, { depth: building.height, bevelEnabled: false, steps: 1, curveSegments: 1 });
  }, [building]);
  const labelPosition = useMemo(() => {
    const [x, z] = featureCenter(building.feature);
    return [x, building.height + 5, z] as Point3;
  }, [building]);
  if (!geometry) return null;
  const buildingType = String(building.feature.properties.building ?? '');
  const color = selected ? '#e7c36d' : buildingType === 'commercial' ? '#8d7660' : '#718997';
  return <group>
    <mesh
      geometry={geometry}
      rotation={[-Math.PI / 2, 0, 0]}
      onClick={(event) => { event.stopPropagation(); onSelect(building.feature); }}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial color={color} roughness={0.82} metalness={0.04} />
    </mesh>
    {selected && <Html position={labelPosition} center distanceFactor={180} style={{ pointerEvents: 'none' }}>
      <div className="map-label">{building.name}</div>
    </Html>}
  </group>;
}

function BuildingSet({ features, selectedId, onSelect }: {
  features: CampusFeature[];
  selectedId: string | number | undefined;
  onSelect: (feature: CampusFeature) => void;
}) {
  const buildings: Building[] = useMemo(() => features.filter(isBuilding).map((feature, index) => ({
    key: String(feature.id ?? feature.properties.osm_id ?? index),
    name: String(feature.properties.name ?? feature.properties['name:en'] ?? `Building ${index + 1}`),
    feature,
    ring: polygonOuterRing(feature),
    height: heightOf(feature),
  })).filter((item) => item.ring.length >= 4), [features]);

  return <>{buildings.map((building) => <BuildingMesh
    key={building.key}
    building={building}
    selected={building.key === String(selectedId ?? '')}
    onSelect={onSelect}
  />)}</>;
}

function GroundPatch({ feature, ring }: { feature: CampusFeature; ring: LonLat[] }) {
  const geometry = useMemo(() => {
    const shape = buildShape(ring);
    return shape ? new THREE.ExtrudeGeometry(shape, { depth: 0.25, bevelEnabled: false, steps: 1 }) : null;
  }, [ring]);
  const landuse = String(feature.properties.landuse ?? '');
  const leisure = String(feature.properties.leisure ?? '');
  const amenity = String(feature.properties.amenity ?? '');
  const color = amenity === 'parking' ? '#444f50' : leisure.includes('pitch') ? '#526f51' : landuse === 'grass' || leisure === 'park' ? '#314e3d' : '#36483c';
  if (!geometry) return null;
  return <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
    <meshStandardMaterial color={color} roughness={1} side={THREE.DoubleSide} />
  </mesh>;
}

function GroundFeatures({ features }: { features: CampusFeature[] }) {
  const grounds = useMemo(() => features.filter((feature) => {
    if (feature.geometry.type !== 'Polygon' || isBuilding(feature) || isCampusOutline(feature)) return false;
    return Boolean(feature.properties.leisure || feature.properties.landuse || feature.properties.amenity);
  }).map((feature, index) => ({
    key: String(feature.id ?? index),
    feature,
    ring: polygonOuterRing(feature),
  })).filter((item) => item.ring.length >= 4).slice(0, 100), [features]);
  return <>{grounds.map(({ key, feature, ring }) => <GroundPatch key={key} feature={feature} ring={ring} />)}</>;
}

function Paths({ features }: { features: CampusFeature[] }) {
  const lines = useMemo(() => features.filter((feature) => Boolean(feature.properties.highway))
    .flatMap((feature, index) => lineStrings(feature).map((line, lineIndex) => ({
      key: `${String(feature.id ?? index)}-${lineIndex}`,
      points: toLinePoints(line),
      highway: String(feature.properties.highway ?? ''),
    })))
    .filter((feature) => feature.points.length > 1).slice(0, 1800), [features]);
  return <>{lines.map((line) => {
    const isFootpath = ['footway', 'path', 'pedestrian', 'steps'].includes(line.highway);
    const isMinorRoad = ['service', 'residential', 'living_street', 'unclassified'].includes(line.highway);
    return <Line key={line.key} points={line.points} color={isFootpath ? '#7a9992' : isMinorRoad ? '#3c5155' : '#57676b'} lineWidth={isFootpath ? 1.7 : 2.5} />;
  })}</>;
}

function CampusOutline({ features }: { features: CampusFeature[] }) {
  const points = useMemo(() => {
    const outline = features.find(isCampusOutline);
    if (!outline) return [];
    return lineStrings(outline).flatMap((line) => toLinePoints(line, 1.4));
  }, [features]);
  if (points.length < 2) return null;
  return <Line points={points} color="#c1cf9c" lineWidth={2.5} dashed dashScale={2} dashSize={4} gapSize={2} />;
}

function chooseVehicleRoute(features: CampusFeature[]): LonLat[] {
  const candidates = features.filter((feature) => Boolean(feature.properties.highway) && !isCampusOutline(feature))
    .flatMap((feature) => lineStrings(feature))
    .filter((line) => line.length >= 4 && line.length <= 500)
    .map((line) => ({ line, length: line.slice(1).reduce((sum, point, index) => {
      const a = project(line[index]);
      const b = project(point);
      return sum + Math.hypot(b[0] - a[0], b[1] - a[1]);
    }, 0) }))
    .filter((candidate) => candidate.length >= 90 && candidate.length <= 1600)
    .sort((a, b) => b.length - a.length);
  if (candidates.length) return candidates[0].line;

  // Illustrative fallback route used only when the selected OSM data has no usable path.
  const metersToLon = (meters: number) => CENTER_LON + meters / METERS_PER_LON;
  const metersToLat = (meters: number) => CENTER_LAT - meters / METERS_PER_LAT;
  return [[-310, -145], [-175, -205], [20, -150], [210, -15], [155, 145], [-70, 195], [-260, 65]].map(([x, z]) => [metersToLon(x), metersToLat(z)] as LonLat);
}

function SimulatedVehicle({ name, phase, color, curve }: { name: string; phase: number; color: string; curve: THREE.CatmullRomCurve3 }) {
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!group.current) return;
    const cycle = ((clock.elapsedTime * 0.035) + phase) % 2;
    const t = cycle <= 1 ? cycle : 2 - cycle;
    const position = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    group.current.position.set(position.x, 5, position.z);
    group.current.rotation.y = Math.atan2(tangent.x, tangent.z);
  });
  return <group ref={group}>
    <mesh castShadow>
      <boxGeometry args={[8, 4, 15]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.15} roughness={0.4} />
    </mesh>
    <mesh position={[0, 2.5, -0.5]}>
      <boxGeometry args={[6.6, 1.3, 7]} />
      <meshStandardMaterial color="#18313a" roughness={0.3} metalness={0.1} />
    </mesh>
    <mesh position={[0, 2.8, 7.1]}>
      <boxGeometry args={[5.5, 1.4, 0.5]} />
      <meshStandardMaterial color="#d8eef2" emissive="#d8eef2" emissiveIntensity={0.35} />
    </mesh>
    <Html position={[0, 9, 0]} center distanceFactor={130} style={{ pointerEvents: 'none' }}>
      <div className="vehicle-label"><span className="live-dot" />{name}<small>SIMULATED</small></div>
    </Html>
  </group>;
}

function VehicleRoute({ curve }: { curve: THREE.CatmullRomCurve3 }) {
  const points = useMemo(() => curve.getPoints(100).map((point) => [point.x, 1.2, point.z] as Point3), [curve]);
  return <Line points={points} color="#d2b36b" lineWidth={2} transparent opacity={0.75} dashed dashScale={2} dashSize={5} gapSize={4} />;
}

function POIs({ features, onSelect }: { features: CampusFeature[]; onSelect: (feature: CampusFeature) => void }) {
  const pois = features.filter((feature) => feature.geometry.type === 'Point' && (
    feature.properties.amenity || feature.properties.shop || feature.properties.tourism || feature.properties.public_transport || feature.properties.leisure || feature.properties.office
  ));
  return <>{pois.slice(0, 150).map((feature, index) => {
    const coordinates = feature.geometry.coordinates as number[];
    const [x, z] = project([coordinates[0], coordinates[1]]);
    const label = String(feature.properties.name ?? feature.properties.amenity ?? feature.properties.shop ?? feature.properties.public_transport ?? feature.properties.tourism ?? 'Campus place').replaceAll('_', ' ');
    return <group key={String(feature.id ?? index)} position={[x, 3, z]}>
      <mesh onClick={(event) => { event.stopPropagation(); onSelect(feature); }}>
        <sphereGeometry args={[2.5, 10, 10]} />
        <meshStandardMaterial color="#d4b16b" emissive="#9a7132" emissiveIntensity={0.2} />
      </mesh>
      <Html position={[0, 5, 0]} center distanceFactor={240} style={{ pointerEvents: 'none' }}>
        <div className="poi-label">{label}</div>
      </Html>
    </group>;
  })}</>;
}

function FocusSelection({ feature, controlsRef }: { feature: CampusFeature | null; controlsRef: RefObject<ControlsHandle | null> }) {
  const { camera } = useThree();
  useEffect(() => {
    if (!feature) return;
    const [x, z] = featureCenter(feature);
    const target = new THREE.Vector3(x, 0, z);
    camera.position.set(x + 260, 360, z + 360);
    camera.lookAt(target);
    if (controlsRef.current) {
      controlsRef.current.target.copy(target);
      controlsRef.current.update();
    }
  }, [feature, camera, controlsRef]);
  return null;
}

function SceneContents({ data, selectedFeature, onSelect, showVehicles, showBuildings, showPaths, showPlaces }: {
  data: CampusFeatureCollection;
  selectedFeature: CampusFeature | null;
  onSelect: (feature: CampusFeature) => void;
  showVehicles: boolean;
  showBuildings: boolean;
  showPaths: boolean;
  showPlaces: boolean;
}) {
  const controlsRef = useRef<ControlsHandle | null>(null);
  const vehicleCurve = useMemo(() => {
    const route = chooseVehicleRoute(data.features);
    const points = route.map((point) => {
      const [x, z] = project(point);
      return new THREE.Vector3(x, 0, z);
    });
    return new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.18);
  }, [data]);

  const selectedId = selectedFeature?.id ?? (
    typeof selectedFeature?.properties.osm_id === 'string' || typeof selectedFeature?.properties.osm_id === 'number'
      ? selectedFeature.properties.osm_id
      : undefined
  );

  return <>
    <color attach="background" args={['#09141c']} />
    <fog attach="fog" args={['#09141c', 1300, 3200]} />
    <ambientLight intensity={1.15} />
    <directionalLight position={[250, 650, 150]} intensity={2.0} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
    <hemisphereLight args={['#d5e7ec', '#22372f', 0.6]} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.5, 0]} receiveShadow>
      <planeGeometry args={[3600, 3400]} />
      <meshStandardMaterial color="#15251f" roughness={1} />
    </mesh>
    <gridHelper args={[3000, 70, '#31443e', '#21342f']} position={[0, -0.9, 0]} />
    <GroundFeatures features={data.features} />
    {showPaths && <Paths features={data.features} />}
    <CampusOutline features={data.features} />
    {showBuildings && <BuildingSet features={data.features} selectedId={selectedId} onSelect={onSelect} />}
    {showPlaces && <POIs features={data.features} onSelect={onSelect} />}
    {showVehicles && <><VehicleRoute curve={vehicleCurve} /><SimulatedVehicle name="CEG EV-01" phase={0.06} color="#65d6bd" curve={vehicleCurve} /><SimulatedVehicle name="CEG EV-02" phase={0.52} color="#78aaf8" curve={vehicleCurve} /></>}
    <FocusSelection feature={selectedFeature} controlsRef={controlsRef} />
    <OrbitControls
      ref={(instance) => { controlsRef.current = instance; }}
      makeDefault
      target={[0, 0, 0]}
      minDistance={70}
      maxDistance={2600}
      maxPolarAngle={Math.PI / 2.03}
      minPolarAngle={0.15}
      enableDamping
      dampingFactor={0.08}
    />
  </>;
}

export default function CampusScene(props: {
  data: CampusFeatureCollection;
  selectedFeature: CampusFeature | null;
  onSelect: (feature: CampusFeature) => void;
  showVehicles: boolean;
  showBuildings: boolean;
  showPaths: boolean;
  showPlaces: boolean;
}) {
  return <Canvas shadows camera={{ position: [0, 750, 950], fov: 43, near: 0.1, far: 12000 }} dpr={[1, 1.5]}>
    <SceneContents {...props} />
  </Canvas>;
}
