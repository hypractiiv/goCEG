import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownLeft, Building2, CarFront, ChevronRight, Compass, Database, ExternalLink, FileUp, LocateFixed, MapPin, RotateCcw, Search, ShieldCheck, X, Trees, Route } from 'lucide-react';
import CampusScene from './components/CampusScene';
import { loadCegOsm, parseGeoJson, type CampusFeature, type CampusFeatureCollection } from './lib/osm';
import { sampleData } from './lib/sampleData';

function featureName(feature: CampusFeature, index: number): string {
  return String(feature.properties.name ?? feature.properties['name:en'] ?? feature.properties.amenity ?? feature.properties.shop ?? `Building ${index + 1}`);
}

function isMapObject(feature: CampusFeature): boolean {
  return Boolean(feature.properties.building) || Boolean(feature.properties.amenity) || Boolean(feature.properties.shop) || Boolean(feature.properties.tourism) || Boolean(feature.properties.leisure) || Boolean(feature.properties.office) || Boolean(feature.properties.public_transport);
}

export default function App() {
  const [data, setData] = useState<CampusFeatureCollection>(sampleData);
  const [source, setSource] = useState('Illustrative demo · not surveyed campus geometry');
  const [loading, setLoading] = useState(false);
  const [loadMessage, setLoadMessage] = useState('');
  const [selectedFeature, setSelectedFeature] = useState<CampusFeature | null>(null);
  const [search, setSearch] = useState('');
  const [showVehicles, setShowVehicles] = useState(true);
  const [showBuildings, setShowBuildings] = useState(true);
  const [showPaths, setShowPaths] = useState(true);
  const [showPlaces, setShowPlaces] = useState(true);
  const [osmLoaded, setOsmLoaded] = useState(false);
  const [mapStyle, setMapStyle] = useState<'map' | 'clean'>('map');
  const fileInput = useRef<HTMLInputElement>(null);

  const buildingFeatures = useMemo(() => data.features.filter((feature) => Boolean(feature.properties.building)), [data]);
  const namedFeatures = useMemo(() => data.features.filter(isMapObject).map((feature, index) => ({ feature, name: featureName(feature, index) })), [data]);
  const filteredPlaces = useMemo(() => namedFeatures.filter(({ name }) => name.toLowerCase().includes(search.toLowerCase())).slice(0, 8), [namedFeatures, search]);

  const loadOsm = useCallback(async () => {
    setLoading(true);
    setLoadMessage('Connecting to OpenStreetMap data…');
    try {
      const result = await loadCegOsm();
      setData(result.data);
      setSource(result.source);
      setOsmLoaded(true);
      setSelectedFeature(null);
      setLoadMessage(`Loaded ${result.data.features.length} mapped features.`);
    } catch (error) {
      setLoadMessage(error instanceof Error ? error.message : 'Could not load OSM data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadOsm(); }, [loadOsm]);

  const importGeoJson = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = parseGeoJson(await file.text());
      setData(parsed);
      setSource(`Imported file · ${file.name}`);
      setOsmLoaded(true);
      setSelectedFeature(null);
      setLoadMessage(`Imported ${parsed.features.length} features from GeoJSON.`);
    } catch (error) {
      setLoadMessage(error instanceof Error ? error.message : 'Could not read this GeoJSON file.');
    }
  };

  const selectFeature = (feature: CampusFeature) => {
    setSelectedFeature(feature);
    if (!feature.properties.name) {
      setLoadMessage('This mapped feature has no name tag yet. You can add a verified name later.');
    }
  };

  const resetDemo = () => {
    setData(sampleData);
    setSource('Illustrative demo · not surveyed campus geometry');
    setOsmLoaded(false);
    setSelectedFeature(null);
    setShowBuildings(true);
    setShowPaths(true);
    setShowPlaces(true);
    setShowVehicles(true);
    setLoadMessage('Showing illustrative sample buildings. Load OSM to use mapped campus geometry.');
  };

  const selectedName = selectedFeature ? featureName(selectedFeature, 0) : null;
  const selectedTags = selectedFeature?.properties ?? {};

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-lockup">
        <div className="brand-mark"><Compass size={21} strokeWidth={1.8} /></div>
        <div><div className="brand-title">go<span>CEG</span></div><div className="brand-subtitle">YOUR CAMPUS, CONNECTED</div></div>
      </div>
      <div className="topbar-center"><span className="status-dot" /> INTERACTIVE CAMPUS MODEL <span className="topbar-separator">/</span> CHENNAI, INDIA</div>
      <div className="topbar-actions">
        <button className="icon-button" title="Reload OpenStreetMap data" onClick={() => void loadOsm()} disabled={loading}><RotateCcw size={16} /></button>
        <button className="top-action" onClick={resetDemo}><Database size={14} /> Sample scene</button>
        <button className="top-action" onClick={() => fileInput.current?.click()}><FileUp size={15} /> Import GeoJSON</button>
        <input ref={fileInput} type="file" accept=".json,.geojson,application/geo+json,application/json" hidden onChange={(event) => void importGeoJson(event.target.files?.[0])} />
      </div>
    </header>

    <div className="workspace">
      <aside className="sidebar">
        <div className="sidebar-heading"><div><div className="eyebrow">EXPLORE THE GROUNDS</div><h1>Find your<br /><span>way around.</span></h1></div><div className="round-icon"><MapPin size={18} /></div></div>
        <label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search buildings, facilities…" /><span className="search-shortcut">/</span></label>
        {search && <div className="search-results">
          {filteredPlaces.length ? filteredPlaces.map(({ feature, name }, index) => <button key={String(feature.id ?? index)} className="search-result" onClick={() => selectFeature(feature)}><span className="result-icon"><Building2 size={14} /></span><span>{name}<small>{String(feature.properties.amenity ?? feature.properties.building ?? feature.properties.shop ?? 'Campus place')}</small></span><ChevronRight size={14} /></button>) : <div className="empty-results">No matching mapped names. Try another term.</div>}
        </div>}

        <div className="section-heading"><span>MAP LAYERS</span><span className="section-line" /></div>
        <button className={`layer-card layer-toggle ${showBuildings ? 'is-on' : ''}`} onClick={() => setShowBuildings(!showBuildings)}>
          <div className="layer-symbol buildings-symbol"><Building2 size={17} /></div><div className="layer-copy"><strong>3D buildings</strong><small>{buildingFeatures.length} footprints loaded</small></div><span className={`toggle ${showBuildings ? 'on' : ''}`}><span /></span>
        </button>
        <button className={`layer-card layer-toggle ${showPaths ? 'is-on' : ''}`} onClick={() => setShowPaths(!showPaths)}>
          <div className="layer-symbol paths-symbol"><Route size={17} /></div><div className="layer-copy"><strong>Paths & access roads</strong><small>OpenStreetMap line features</small></div><span className={`toggle ${showPaths ? 'on' : ''}`}><span /></span>
        </button>
        <button className={`layer-card layer-toggle ${showPlaces ? 'is-on' : ''}`} onClick={() => setShowPlaces(!showPlaces)}>
          <div className="layer-symbol paths-symbol"><Trees size={17} /></div><div className="layer-copy"><strong>Places & facilities</strong><small>Mapped campus amenities</small></div><span className={`toggle ${showPlaces ? 'on' : ''}`}><span /></span>
        </button>
        <button className={`layer-card layer-toggle ${showVehicles ? 'is-on' : ''}`} onClick={() => setShowVehicles(!showVehicles)}>
          <div className="layer-symbol vehicles-symbol"><CarFront size={17} /></div><div className="layer-copy"><strong>Campus e-vehicles</strong><small>Simulated movement · demo only</small></div><span className={`toggle ${showVehicles ? 'on' : ''}`}><span /></span>
        </button>

        <div className="section-heading"><span>SELECTED PLACE</span><span className="section-line" /></div>
        {selectedFeature ? <div className="selected-card">
          <div className="selected-card-top"><span className="place-badge"><Building2 size={14} /></span><button className="close-selection" onClick={() => setSelectedFeature(null)} aria-label="Clear selection"><X size={14} /></button></div>
          <h3>{selectedName}</h3>
          <p>{String(selectedTags.amenity ?? selectedTags.building ?? selectedTags.shop ?? 'Mapped campus feature')}</p>
          <div className="tag-list">{selectedTags['building:levels'] && <span>{String(selectedTags['building:levels'])} floors tagged</span>}{selectedTags.height && <span>{String(selectedTags.height)} height tagged</span>}<span>OSM {String(selectedTags.osm_type ?? 'feature')}{selectedTags.osm_id ? ` #${selectedTags.osm_id}` : ''}</span></div>
        </div> : <div className="selection-empty"><div className="empty-target"><LocateFixed size={18} /></div><div><strong>No place selected</strong><p>Click a building in the 3D scene or search for a mapped place.</p></div></div>}

        <div className="sidebar-bottom">
          <div className="data-status"><div className="data-status-icon"><Database size={15} /></div><div className="data-status-copy"><strong>{osmLoaded ? 'OpenStreetMap data' : 'Prototype mode'}</strong><small>{source}</small></div><span className={`data-pill ${osmLoaded ? 'connected' : ''}`}>{osmLoaded ? 'LOADED' : 'DEMO'}</span></div>
          {loadMessage && <div className="load-message">{loading && <span className="tiny-spinner" />}{loadMessage}</div>}
          <div className="attribution">© OpenStreetMap contributors · Data may be incomplete</div>
        </div>
      </aside>

      <section className="map-section">
        <div className="map-topline"><div className="map-breadcrumb">goCEG <ChevronRight size={12} /> <span>OVERVIEW</span></div><div className="map-topline-right"><span className="coordinate-chip">13.0136° N <i>·</i> 80.2365° E</span><button className="view-mode-button" onClick={() => setMapStyle(mapStyle === 'map' ? 'clean' : 'map')}><ArrowDownLeft size={14} /> {mapStyle === 'map' ? 'ISOMETRIC VIEW' : 'CLEAN VIEW'}</button></div></div>
        <div className={`canvas-wrap ${mapStyle === 'clean' ? 'clean-view' : ''}`}>
          <CampusScene data={data} selectedFeature={selectedFeature} onSelect={selectFeature} showVehicles={showVehicles} showBuildings={showBuildings} showPaths={showPaths} showPlaces={showPlaces} />
          <div className="map-overlay-caption"><span className="overlay-mark">g</span><div><strong>COLLEGE OF ENGINEERING, GUINDY</strong><small>{osmLoaded ? 'OPENSTREETMAP GEOMETRY · SELECT A BUILDING OR PLACE' : 'ILLUSTRATIVE FALLBACK GEOMETRY · AWAITING MAP DATA'}</small></div></div>
          <div className="map-legend"><div><span className="legend-swatch building-swatch" /> Building footprint</div><div><span className="legend-swatch path-swatch" /> Mapped path</div>{showVehicles && <div><span className="legend-swatch vehicle-swatch" /> Simulated EV</div>}</div>
          {!showVehicles && <div className="vehicle-hidden-hint">E-vehicle layer is hidden</div>}
          <div className="map-controls"><div className="north-indicator"><span>N</span><div /></div><div className="orbit-hint">DRAG TO ORBIT <span>·</span> SCROLL TO ZOOM</div></div>
        </div>
        <footer className="map-footer"><div className="footer-left"><span className="footer-live-dot" /><span>{loading ? 'FETCHING MAP FEATURES' : osmLoaded ? 'MAP DATA READY' : 'RUNNING SAMPLE SCENE'}</span><span className="footer-sep">/</span><span>{data.features.length} FEATURES</span></div><div className="footer-right"><ShieldCheck size={13} /> GPS IS SIMULATED IN THIS PROTOTYPE <span className="footer-sep">/</span> <a href="https://www.openstreetmap.org/way/24831558" target="_blank" rel="noreferrer">VIEW CEG ON OSM <ExternalLink size={11} /></a></div></footer>
      </section>
    </div>
  </main>;
}
