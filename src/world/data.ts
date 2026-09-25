/** Authored geographic source of truth. Horizontal coordinates and elevations are metres. */
export type Point = Readonly<{ x: number; z: number }>;
export type RoadClass = 'highway' | 'arterial' | 'secondary' | 'local' | 'rural';
export type DistrictKind = 'urban' | 'landscape' | 'infrastructure';
export type District = Readonly<{
  id: string;
  name: string;
  subtitle: string;
  kind: DistrictKind;
  color: string;
  polygon: readonly Point[];
  focus: Point;
  access: string;
}>;
export type Road = Readonly<{
  id: string;
  from: string;
  to: string;
  type: RoadClass;
  name: string;
  via?: readonly Point[];
  bridge?: 'river' | 'sound';
}>;

export const WORLD = {
  name: 'Morrow Reach',
  city: 'Lowmere',
  minX: -9000,
  maxX: 9000,
  minZ: -7000,
  maxZ: 7000,
  sectorSize: 1000,
  seaLevel: 0,
} as const;

const p = (x: number, z: number): Point => ({ x, z });

// The headland, sheltered southern bay and tidal eastern shore form one main island.
// The narrow sound separates its southeastern satellite island, not a copied city map.
export const MAIN_LAND: readonly Point[] = [
  p(-7660, -6410), p(-6930, -6790), p(-5760, -6880), p(-4330, -6680),
  p(-3100, -6760), p(-1530, -6650), p(-100, -6750), p(1590, -6820),
  p(3120, -6600), p(4540, -6190), p(6140, -5440), p(7370, -4660),
  p(8200, -3440), p(8290, -2220), p(7970, -1030), p(7430, -160),
  p(6900, 800), p(6380, 1370), p(5930, 1970), p(5520, 2370),
  p(4990, 2680), p(4560, 3150), p(4280, 3900), p(3870, 4470),
  p(3130, 4880), p(2190, 5020), p(1420, 4800), p(780, 4850),
  p(-60, 4630), p(-1120, 4360), p(-1900, 4390), p(-2740, 4690),
  p(-3540, 5010), p(-4470, 5340), p(-5530, 5510), p(-6380, 5230),
  p(-7060, 4720), p(-7660, 3820), p(-8170, 2620), p(-8520, 1250),
  p(-8450, -230), p(-8170, -1640), p(-8410, -2910), p(-8180, -4410),
];

export const SOUND_ISLAND: readonly Point[] = [
  p(5000, 3970), p(5260, 3600), p(5740, 3440), p(6210, 3510),
  p(6660, 3290), p(7140, 3440), p(7590, 3720), p(7930, 4260),
  p(8190, 4850), p(7920, 5320), p(7420, 5690), p(6720, 5790),
  p(6080, 5480), p(5570, 5060), p(5180, 4550),
];

// A descending river, rather than an arbitrary blue line laid over the terrain.
export const RIVER: readonly Point[] = [
  p(1500, -6520), p(1780, -5780), p(1810, -5150), p(2220, -4500),
  p(2750, -3920), p(3070, -3350), p(2780, -2800), p(3090, -2290),
  p(3500, -1720), p(3790, -1080), p(4080, -420), p(4230, 300),
  p(4630, 950), p(5220, 1550), p(5890, 2090),
];

export const LAKE = { center: p(-5610, -3170), radiusX: 840, radiusZ: 570, level: 25 } as const;

// Footprints are reservations, not constructed districts. Their polygons also become
// future asset/streaming boundaries. Focus points are on dry, reachable terrain.
export const DISTRICTS: readonly District[] = [
  {
    id: 'downtown', name: 'Downtown', subtitle: 'Central lowlands', kind: 'urban', color: '#f5b972',
    polygon: [p(-1350,-100),p(550,-140),p(1630,550),p(1490,2000),p(500,2370),p(-1360,1790)],
    focus: p(160,920), access: 'Sound Parkway · Inner Belt',
  },
  {
    id: 'industrial', name: 'Industrial', subtitle: 'Riverward flats', kind: 'urban', color: '#d3a889',
    polygon: [p(2050,-500),p(3890,-520),p(4290,150),p(4230,1780),p(2850,1970),p(2100,1100)],
    focus: p(3070,760), access: 'Inner Belt · Port Connector',
  },
  {
    id: 'wealthy', name: 'Hillside', subtitle: 'Sheltered bluff', kind: 'urban', color: '#b9c79b',
    polygon: [p(-4710,1180),p(-3020,800),p(-1680,1180),p(-1860,3070),p(-3580,3520),p(-4790,2660)],
    focus: p(-3250,2020), access: 'Bluff Road · Coastway',
  },
  {
    id: 'residential', name: 'Residential', subtitle: 'Broad central valley', kind: 'urban', color: '#c4cda5',
    polygon: [p(-2600,-2660),p(-280,-2880),p(850,-2000),p(750,-450),p(-1300,-350),p(-2650,-1220)],
    focus: p(-1110,-1470), access: 'Northspan · Valley Road',
  },
  {
    id: 'suburban', name: 'Suburbs', subtitle: 'Western foothills', kind: 'urban', color: '#c5d5a9',
    polygon: [p(-6350,-1740),p(-4500,-2050),p(-2950,-1380),p(-3000,450),p(-4690,910),p(-6500,-20)],
    focus: p(-4760,-790), access: 'Northspan · West Loop',
  },
  {
    id: 'entertainment', name: 'Entertainment', subtitle: 'South bay terrace', kind: 'urban', color: '#e7bb93',
    polygon: [p(360,2490),p(2190,2210),p(2620,3430),p(1880,4380),p(300,3960),p(-280,3160)],
    focus: p(1230,3150), access: 'Sound Parkway · Bayfront Road',
  },
  {
    id: 'port', name: 'Port', subtitle: 'Protected deepwater', kind: 'infrastructure', color: '#b4bdad',
    polygon: [p(2950,2290),p(4090,2110),p(4620,2630),p(4420,3630),p(3990,4260),p(3200,4240),p(2720,3330)],
    focus: p(3630,3220), access: 'Port Connector · West Sound Bridge',
  },
  {
    id: 'airport', name: 'Airport', subtitle: 'Level eastern plateau', kind: 'infrastructure', color: '#c8c8ad',
    polygon: [p(5240,-3900),p(7460,-4050),p(7820,-3100),p(7710,-1750),p(5330,-1710)],
    focus: p(6510,-2870), access: 'Northspan · Eastern Ring',
  },
  {
    id: 'rural', name: 'Rural', subtitle: 'Western lake country', kind: 'landscape', color: '#a4bd87',
    polygon: [p(-7450,-5250),p(-6220,-5700),p(-4750,-5400),p(-4350,-4400),p(-4750,-3150),p(-6500,-2450),p(-7700,-3360)],
    focus: p(-6250,-3980), access: 'Upland Parkway · Lake Loop',
  },
  {
    id: 'mountain', name: 'Mountains', subtitle: 'Northern broken ridge', kind: 'landscape', color: '#a9afa0',
    polygon: [p(-3950,-6120),p(-2360,-6460),p(-540,-6060),p(650,-5080),p(240,-3840),p(-1190,-3550),p(-3400,-3890),p(-4200,-4610)],
    focus: p(-2120,-5060), access: 'Upland Parkway · Ridge Track',
  },
  {
    id: 'beach', name: 'Coastal', subtitle: 'Open western beaches', kind: 'landscape', color: '#edcf9e',
    polygon: [p(-6170,3450),p(-4940,3230),p(-3610,3620),p(-2840,4400),p(-3840,5070),p(-5380,5260),p(-6630,4690)],
    focus: p(-4780,4200), access: 'Coastway · Bluff Road',
  },
  {
    id: 'marsh', name: 'Marshland', subtitle: 'Tidal river delta', kind: 'landscape', color: '#a5b998',
    polygon: [p(4840,-290),p(6800,-290),p(7000,480),p(6440,1270),p(5900,1540),p(5210,1240),p(4840,600)],
    focus: p(6000,520), access: 'Eastern Ring · Tidal Bridge',
  },
];

/**
 * Districts that are actually modelled and streamed, as opposed to reserved footprints.
 * Adding a district here is the one place the UI learns a reservation has been built.
 */
export const BUILT_DISTRICT_IDS: readonly string[] = ['downtown', 'industrial', 'wealthy'];

export const isBuiltDistrictId = (id: string): boolean => BUILT_DISTRICT_IDS.includes(id);

export const NODES: Readonly<Record<string, Point>> = {
  ruralNorth:p(-6700,-4700), lakesideNW:p(-6810,-3320), westGate:p(-7320,-1050),
  westCoast:p(-7040,1660), beachWest:p(-4880,3370), beachEast:p(-3400,3710),
  hillWest:p(-3630,1700), suburbWest:p(-5220,-1200), suburbEast:p(-3460,-1050),
  residential:p(-1740,-1480), innerBelt:p(-590,-1260), forestSouth:p(920,-2460),
  forestNorth:p(850,-3210), mountainWest:p(-3000,-3310), mountainSpur:p(-4320,-3980),
  scenicEast:p(-1050,-4010), lakeSouth:p(-5540,-2120), downtownWest:p(-1130,630),
  downtownCore:p(180,890), downtownEast:p(1520,680), promenadeWest:p(-1110,2610),
  entertainment:p(1090,3160), industrial:p(2940,750), industrialNorth:p(2180,-740),
  portNorth:p(3420,2080), portSouth:p(3580,3550), soundWest:p(4310,3700),
  coastalBridgeW:p(4530,1290), coastalBridgeE:p(5510,1290),
  marshJunction:p(6150,310), marshSouth:p(5830,1590),
  northBridgeW:p(2300,-3500), northBridgeE:p(3350,-3500),
  midBridgeW:p(3000,-1900), midBridgeE:p(3800,-1900),
  eastTown:p(4870,-4650), airportNorth:p(6470,-4100), airportWest:p(5550,-2450),
  airportSouth:p(6680,-1310), airportEast:p(7480,-2720),
  islandWest:p(5500,3980), islandNorth:p(6290,3650),
  islandEast:p(7430,4310), islandSouth:p(6610,4910),
};

// Each segment has shared endpoint IDs; rendering curves cannot silently break the
// navigable graph. Bridges are explicitly declared, never inferred from a visual overlap.
export const ROADS: readonly Road[] = [
  // Regional highways: two inland cross-island routes, connected by an eastern ring.
  {id:'h01',from:'westGate',to:'suburbWest',type:'highway',name:'Northspan Freeway',via:[p(-6360,-910)]},
  {id:'h02',from:'suburbWest',to:'suburbEast',type:'highway',name:'Northspan Freeway',via:[p(-4340,-1330)]},
  {id:'h03',from:'suburbEast',to:'residential',type:'highway',name:'Northspan Freeway',via:[p(-2570,-1300)]},
  {id:'h04',from:'residential',to:'innerBelt',type:'highway',name:'Northspan Freeway'},
  {id:'h05',from:'innerBelt',to:'forestSouth',type:'highway',name:'Northspan Freeway',via:[p(90,-1830)]},
  {id:'h06',from:'forestSouth',to:'midBridgeW',type:'highway',name:'Northspan Freeway',via:[p(1840,-2200)]},
  {id:'h07',from:'midBridgeW',to:'midBridgeE',type:'highway',name:'Northspan Freeway',bridge:'river'},
  {id:'h08',from:'midBridgeE',to:'airportWest',type:'highway',name:'Northspan Freeway',via:[p(4650,-2070)]},
  {id:'h09',from:'airportWest',to:'airportSouth',type:'highway',name:'Northspan Freeway',via:[p(6160,-1800)]},
  {id:'h10',from:'ruralNorth',to:'mountainWest',type:'highway',name:'Upland Parkway',via:[p(-5810,-4100),p(-4690,-3670)]},
  {id:'h11',from:'mountainWest',to:'forestNorth',type:'highway',name:'Upland Parkway',via:[p(-1520,-3260),p(-180,-3110)]},
  {id:'h12',from:'forestNorth',to:'northBridgeW',type:'highway',name:'Upland Parkway',via:[p(1590,-2900),p(2130,-3030)]},
  {id:'h13',from:'northBridgeW',to:'northBridgeE',type:'highway',name:'Upland Parkway',bridge:'river'},
  {id:'h14',from:'northBridgeE',to:'eastTown',type:'highway',name:'Upland Parkway',via:[p(4100,-3930)]},
  {id:'h15',from:'eastTown',to:'airportNorth',type:'highway',name:'Eastern Ring',via:[p(5710,-4440)]},
  {id:'h16',from:'airportNorth',to:'airportWest',type:'highway',name:'Eastern Ring',via:[p(5930,-3470)]},
  {id:'h17',from:'airportSouth',to:'airportEast',type:'highway',name:'Eastern Ring'},
  {id:'h18',from:'airportEast',to:'airportNorth',type:'highway',name:'Eastern Ring'},
  // The bay route links the shoreline, city floor, port, tidal plain and airport.
  {id:'a01',from:'westCoast',to:'beachWest',type:'arterial',name:'Coastway',via:[p(-6200,2350),p(-5630,2830)]},
  {id:'a02',from:'beachWest',to:'beachEast',type:'arterial',name:'Coastway',via:[p(-4230,3530)]},
  {id:'a03',from:'beachEast',to:'promenadeWest',type:'arterial',name:'Coastway',via:[p(-2450,3190)]},
  {id:'a35',from:'beachWest',to:'beachEast',type:'secondary',name:'Dune Road',via:[p(-4740,4050),p(-3900,4160)]},
  {id:'a04',from:'promenadeWest',to:'downtownWest',type:'arterial',name:'Sound Parkway'},
  {id:'a05',from:'downtownWest',to:'downtownCore',type:'arterial',name:'Sound Parkway'},
  {id:'a06',from:'downtownCore',to:'downtownEast',type:'arterial',name:'Sound Parkway'},
  {id:'a07',from:'downtownEast',to:'industrial',type:'arterial',name:'Sound Parkway',via:[p(2150,970)]},
  {id:'a08',from:'industrial',to:'portNorth',type:'arterial',name:'Port Connector'},
  {id:'a09',from:'portNorth',to:'coastalBridgeW',type:'arterial',name:'Tidal Road',via:[p(4160,1700)]},
  {id:'a10',from:'coastalBridgeW',to:'coastalBridgeE',type:'arterial',name:'Tidal Bridge',bridge:'river'},
  {id:'a11',from:'coastalBridgeE',to:'marshJunction',type:'arterial',name:'Tidal Road',via:[p(5890,910)]},
  {id:'a12',from:'marshJunction',to:'airportSouth',type:'arterial',name:'Eastern Ring',via:[p(6440,-540)]},
  // Distributors create alternatives around, not through, the reserved neighborhoods.
  {id:'a13',from:'westGate',to:'westCoast',type:'arterial',name:'West Loop',via:[p(-7780,120)]},
  {id:'a14',from:'suburbWest',to:'hillWest',type:'arterial',name:'Bluff Road',via:[p(-4230,80)]},
  {id:'a15',from:'hillWest',to:'beachEast',type:'secondary',name:'Bluff Road',via:[p(-3610,2800)]},
  {id:'a16',from:'hillWest',to:'downtownWest',type:'arterial',name:'Valley Road',via:[p(-2500,1030)]},
  {id:'a17',from:'suburbEast',to:'hillWest',type:'secondary',name:'Foothill Road',via:[p(-3350,280)]},
  {id:'a18',from:'residential',to:'downtownWest',type:'arterial',name:'Valley Road',via:[p(-1550,-350)]},
  {id:'a19',from:'innerBelt',to:'downtownCore',type:'arterial',name:'Inner Belt',via:[p(-140,-290)]},
  {id:'a20',from:'forestSouth',to:'industrialNorth',type:'arterial',name:'Inner Belt',via:[p(1710,-1570)]},
  {id:'a21',from:'industrialNorth',to:'industrial',type:'arterial',name:'Inner Belt'},
  {id:'a22',from:'industrialNorth',to:'midBridgeW',type:'secondary',name:'River Road',via:[p(2570,-1350)]},
  {id:'a23',from:'industrial',to:'portSouth',type:'secondary',name:'Dock Road',via:[p(3120,1910)]},
  {id:'a24',from:'portNorth',to:'portSouth',type:'arterial',name:'Port Connector'},
  {id:'a25',from:'entertainment',to:'portSouth',type:'arterial',name:'Bayfront Road',via:[p(2180,3510)]},
  {id:'a26',from:'downtownEast',to:'entertainment',type:'arterial',name:'Bayfront Road',via:[p(1500,1710)]},
  {id:'a27',from:'promenadeWest',to:'entertainment',type:'secondary',name:'Bayfront Road',via:[p(-90,2910)]},
  {id:'a28',from:'downtownCore',to:'entertainment',type:'secondary',name:'Market Road',via:[p(440,1910)]},
  {id:'a29',from:'downtownEast',to:'industrialNorth',type:'arterial',name:'Inner Belt',via:[p(1870,-100)]},
  {id:'a30',from:'forestNorth',to:'forestSouth',type:'secondary',name:'Pine Cut'},
  {id:'a31',from:'northBridgeE',to:'airportWest',type:'secondary',name:'Eastbank Road',via:[p(4400,-3300)]},
  {id:'a32',from:'coastalBridgeE',to:'marshSouth',type:'secondary',name:'Marsh Road'},
  {id:'a33',from:'marshSouth',to:'marshJunction',type:'secondary',name:'Marsh Road'},
  {id:'a34',from:'airportWest',to:'airportSouth',type:'secondary',name:'Airfield Perimeter',via:[p(5540,-1600)]},
  // A lake circuit, hillside cross-connection, and two independent island crossings.
  {id:'r01',from:'ruralNorth',to:'lakesideNW',type:'rural',name:'Lake Loop',via:[p(-6880,-4170)]},
  {id:'r02',from:'lakesideNW',to:'lakeSouth',type:'rural',name:'Lake Loop',via:[p(-6680,-2330),p(-6040,-2050)]},
  {id:'r03',from:'lakeSouth',to:'suburbWest',type:'secondary',name:'Lake Road',via:[p(-5310,-1750)]},
  {id:'r04',from:'westGate',to:'lakesideNW',type:'rural',name:'Western Track',via:[p(-7260,-2220)]},
  {id:'r05',from:'mountainWest',to:'lakeSouth',type:'rural',name:'Old Pass Road',via:[p(-4150,-3420),p(-4810,-2760)]},
  {id:'r06',from:'ruralNorth',to:'mountainSpur',type:'rural',name:'Ridge Track',via:[p(-5800,-4140),p(-5160,-3910)]},
  {id:'r07',from:'mountainSpur',to:'scenicEast',type:'rural',name:'Ridge Track',via:[p(-3180,-4120),p(-2240,-4020)]},
  {id:'r08',from:'scenicEast',to:'forestNorth',type:'rural',name:'Ridge Track',via:[p(-100,-3790)]},
  {id:'r09',from:'mountainWest',to:'scenicEast',type:'rural',name:'Saddle Road',via:[p(-2100,-3660)]},
  {id:'r10',from:'westCoast',to:'hillWest',type:'secondary',name:'Coastal Rise',via:[p(-5650,1190)]},
  {id:'i01',from:'portSouth',to:'soundWest',type:'secondary',name:'West Sound Road'},
  {id:'i02',from:'soundWest',to:'islandWest',type:'arterial',name:'West Sound Bridge',bridge:'sound'},
  {id:'i03',from:'islandWest',to:'islandNorth',type:'secondary',name:'Island Loop',via:[p(5790,3670)]},
  {id:'i04',from:'islandNorth',to:'islandEast',type:'secondary',name:'Island Loop',via:[p(7050,3700)]},
  {id:'i05',from:'islandEast',to:'islandSouth',type:'rural',name:'Island Loop',via:[p(7170,4890)]},
  {id:'i06',from:'islandSouth',to:'islandWest',type:'rural',name:'Island Loop',via:[p(6040,4750)]},
  {id:'i07',from:'marshSouth',to:'islandNorth',type:'secondary',name:'East Sound Causeway',bridge:'sound'},
  // A handful of local connecting streets; the future district grids are intentionally absent.
  {id:'l01',from:'downtownWest',to:'promenadeWest',type:'local',name:'Quay Street',via:[p(-620,1770)]},
  {id:'l02',from:'residential',to:'suburbEast',type:'local',name:'Willow Lane',via:[p(-2580,-2090)]},
  {id:'l03',from:'portSouth',to:'portNorth',type:'local',name:'Harbor Street',via:[p(4030,2850)]},
];

export const ROAD_WIDTH: Readonly<Record<RoadClass, number>> = {
  highway: 35, arterial: 22, secondary: 14, local: 9, rural: 8,
};
