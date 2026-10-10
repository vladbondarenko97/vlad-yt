// Converts Natural Earth land polygons (world-atlas, TopoJSON) to GeoJSON for the mask script.
import { readFileSync, writeFileSync } from 'node:fs';
import { feature } from 'topojson-client';

const topo = JSON.parse(readFileSync(new URL('../node_modules/world-atlas/land-50m.json', import.meta.url)));
const land = feature(topo, topo.objects.land);
writeFileSync(new URL('./land.geojson', import.meta.url), JSON.stringify(land));
console.log('wrote tools/land.geojson');
