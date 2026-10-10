// The ten stops of the journey, in scroll order. Each one matches a <section data-stop="…">
// in index.html. Distances, depths and temperatures are real, rounded figures.
//
// space: million km from the Sun.   depth: km below Earth's surface.   temp: degrees C.
export const STOPS = [
  { id: 'sun',          name: 'Sun',          space: 0,     temp: 5500, accent: '#ffb94a', scrim: 0.55 },
  { id: 'mercury',      name: 'Mercury',      space: 57.9,  temp: 430,  accent: '#d8c3ae', scrim: 0.55 },
  { id: 'venus',        name: 'Venus',        space: 108.2, temp: 465,  accent: '#f3cd8c', scrim: 0.6 },
  { id: 'earth',        name: 'Earth',        space: 149.6, temp: 15,   accent: '#86c8ff', scrim: 0.6 },
  { id: 'crust',        name: 'Crust',        depth: 35,    temp: 400,  accent: '#e0b98c', scrim: 0.68 },
  { id: 'upper-mantle', name: 'Upper mantle', depth: 660,   temp: 1600, accent: '#ff9a6b', scrim: 0.74 },
  { id: 'lower-mantle', name: 'Lower mantle', depth: 2890,  temp: 3700, accent: '#ff8a4a', scrim: 0.76 },
  { id: 'outer-core',   name: 'Outer core',   depth: 5150,  temp: 5000, accent: '#ffc15a', scrim: 0.8 },
  { id: 'inner-core',   name: 'Inner core',   depth: 6000,  temp: 5200, accent: '#ffe6ad', scrim: 0.82 },
  { id: 'contact',      name: 'Center',       depth: 6371,  temp: 5200, accent: '#fff1d0', scrim: 0.84 },
];

export const EARTH_STOP = STOPS.findIndex((s) => s.id === 'earth');
