[out:json][timeout:60];
way(24831558)->.ceg_outline;
.ceg_outline map_to_area -> .campus;
(
  .ceg_outline;
  way(area.campus)["building"];
  way(area.campus)["highway"~"footway|path|pedestrian|cycleway|service|residential|tertiary|unclassified|living_street|track|steps"];
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
