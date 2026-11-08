# Site Guard: real-world mapping plan

Status: **working in the game.** M0 to M4 are done, and most of M5. See [What is built](#what-is-built) for what is left.

## What is built

The map switcher sits beside the minimap, with a preview of each map. The topographic map and contours are worked out in the browser from the world's own height grid, so they need no download and work offline. The live map has no preview, so nothing is sent to OpenStreetMap until the player chooses it. Location is one reading each time the button is pressed, not continuous tracking.

| Part | State |
|---|---|
| Pack builder, `tools/mapbuild/` | Done, with lidar, satellite, roads and names. Downloads the OS files it needs, and checks their checksums. |
| Loading packs into the rules | Done, with grid bearings and real positions in SAPIENT messages |
| Map on the ground | OS map, satellite, shaded relief and live OpenStreetMap. Roads and names (hybrid), national grid, plan view. |
| Start screen | Generated ground or a real map. The start point can be clicked on a map, typed as a grid reference, or taken from the laptop's location. |
| No map at that spot | The app offers to build one, as a background job with progress |
| In the game | "My location" centres on the laptop and marks it, "The site" returns, and a typed grid reference moves there or places the chosen system |
| Saving | Saved laydowns reload their map pack, or say which is missing |

**Left to do:**

- **Model site:** stamping the power station onto real ground. Real sites only for now, so the world string only accepts `real`.
- **Live OS map and place search:** both need an OS API key and the proxy below, and you have no key set up. OpenStreetMap does the live layer instead.
- **Wales and Scotland lidar:** the England services are used, and elsewhere the ground is Terrain 50.
- **Sharper aerial photos,** once the Environment Agency confirms the licence.
- **A dense city:** not tried, so a building cap may be needed.

**Changes from the design below:**

- The site's position in a pack comes from a pack fit, but a laptop's position has no pack yet, so `sim/bng.js` converts GPS to the grid with the published Helmert shift. Checked against pyproj with OSTN15 at five sites: within about 5 m, which is finer than a laptop's location.
- Packs live in `~/site-guard-maps/packs` (or `SITE_GUARD_MAPS`), and the local server lists them. A pack imported from a file is kept in the browser, so it still works with the server stopped.
- Live OpenStreetMap replaces the earlier decision to reject OSM. Bulk download is still ruled out: tiles are only fetched live, for the area in view, and never put in a pack. Each tile is stretched by its own corners, as OSM's squares sit at an angle to the national grid.

Code is referenced by function and file name, not line number, because the refactor keeps moving lines.

## Goal

Let a player choose between the current procedural world and a real part of Great Britain, with:

- real elevation, trees and buildings that drive line of sight, not just the picture
- British National Grid (BNG) references and a grid overlay
- the protected site and the effectors placed on the real map
- full offline use, with extra options when online
- a choice of base map, including satellite, and a hybrid view with roads and place names over it

## The design

| # | Decision | Why |
|---|---|---|
| 1 | **Three.js stays the only renderer.** Real terrain is the existing mesh with a map as its texture. | Drones, rings, beliefs, labels and placement all work in scene metres and raycast against one mesh. MapLibre or Cesium would mean two renderers, another coordinate frame and rewriting those views. |
| 2 | **The rules read a local grid from an "area pack" file.** Online and offline use the same format. | `sim/` reaches terrain through a small surface: `groundAt`, `los`, `coverAt`, `canopyAt`, `bldgAt`, `slope`, and the `towers`, `lines` and `buildings` lists. A pack can fill that surface, so the rules do not change. |
| 3 | **Being online never changes the rules.** It adds a map layer, place search and pack building. | A run's digest depends on the grids alone, so a laydown gives the same result with or without a connection. |
| 4 | **The scene is aligned to BNG.** `x = E - E0`, `z = -(N - N0)`, `y = height ODN - H0`, with the site at the origin. | OS EPSG:27700 tiles line up with no reprojection. Grid references become arithmetic. `SITE_POS` and all distance rules stay valid. |
| 5 | **Lat/long conversion happens once, in the build tool.** The pack stores a fit. | Full OSTN15 accuracy with no projection library in the browser. Measured below. |
| 6 | **Pictures never touch the rules.** Base maps and overlays are view settings, not logged commands. | They can change at any time, including mid-run, with no effect on a run's digest. A pack with no satellite picture still plays. |

Rejected: **Cesium and MapLibre** (see 1), **proj4js in the browser** (see 5), **pre-downloaded OpenStreetMap tiles** (the [OSMF policy](https://operations.osmfoundation.org/policies/vector/) prohibits bulk download), **OSM masts** (ODbL share-alike questions, and the current picker does the job).

### What "the switch" means

Procedural and real are different worlds, so a laydown cannot carry across them. What the world looks like is a separate choice.

| Control | Choices | Where and when |
|---|---|---|
| **World** | Procedural (seed), or Real (pack and site) | On the start screen, before Deploy. Changing it clears the laydown. |
| **Base map** | Terrain colours, OS map, live OS map, satellite or shaded relief | In the control panel, any time |
| **Overlays** | Grid; roads and names | In the control panel, any time |
| **View** | 3D or plan | In the control panel, any time |

**Hybrid is satellite with "Roads and names" on.** It is not a separate layer, so there is one setting to keep track of, and the toggle's tooltip uses the word hybrid so it can be found.

**The OS map always shows its 1 km lines,** because they are part of OS's picture. On that base map, the Grid overlay adds labels and stronger lines, and turning it off leaves OS's own lines visible. Its tooltip says so.

**An option that cannot be used stays visible but greyed out, and says why:**

| Option | Procedural world | Real world, no internet | Real world, online |
|---|---|---|---|
| Terrain colours | Yes, the only base map | "Procedural worlds only" | "Procedural worlds only" |
| OS map, shaded relief | "Real worlds only" | Yes | Yes |
| Live OS map | "Real worlds only" | "Needs internet" | Yes, from M5 |
| Satellite | "Real worlds only" | Yes, or "Not in this pack" | Yes, or "Not in this pack" |
| Grid, roads and names | "Real worlds only" | Yes | Yes |
| 3D or plan | Yes | Yes | Yes |

The controls are a new `ui/MapControls.jsx`, rendered by `ControlPanel.jsx` beside the existing view toggles. Their state lives in `render/view.js` and changes through `game.setViewOption`, like rings and labels today. Hotkeys are M (next base map), G (grid) and P (plan view), none of which are in use.

## Evidence

Checked on 2026-11-04.

### Measured: coordinates

Compared with pyproj using OSTN15, at six sites around GB (Land's End, Hinkley, Sizewell, London, Peterhead, Wick). The script was a throwaway and is not in the repo.

| Method | Worst error, 14 km world | Worst error, 30 km pack |
|---|---|---|
| Today's flat-earth `location()`, origin moved to the site | **358 m** (Land's End, 7 km out) | not tested |
| Linear fit | 13 m | 61 m |
| **Quadratic fit, chosen** (6 coefficients per axis) | **0.09 m** | **0.25 m** |
| Cubic fit | 0.06 m | 0.17 m |

Also measured: grid convergence up to 2.85 degrees at these sites, and geoid separation of 44.5 to 53.1 m, varying by up to 1.3 m across one world. A single separation value per pack is good enough.

### Measured: the rebuilt code

All throwaway checks, with nothing added to the repo.

| Check | Result |
|---|---|
| A hand-made 701 x 701 world (empty station, heights relative to the site, sea, cliff, ridge, wood, village), set as `terrainState.data`, playing the `MIXED` laydown through 5 waves in Node | Same digest twice (`bab67b35`), about 26,500 messages, no non-finite numbers in the 4,504 messages kept, and the ridge and wood block or thin sight lines as they should |
| `world` strings against the API's `Seed` type | The 58-character string below is accepted. The JSON identity in the earlier draft is **refused**, as it is over the 64-character limit. |
| Against the real Content Security Policy, in a browser | `createImageBitmap(blob)`, `DecompressionStream` and IndexedDB work. **Blob URL images and Web Workers are blocked.** |

This covers the rules only. Pack parsing and drawing are still untested, as they do not exist yet.

### Measured: the lidar services

Read into memory on 2026-11-04, with nothing saved. Both services use `https://environment.data.gov.uk/spatialdata/` and EPSG:27700, with axes `E` and `N`.

| Check | Result |
|---|---|
| DTM (bare earth) | `lidar-composite-digital-terrain-model-dtm-1m/wcs`, coverage `13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m` |
| First Return DSM (tree tops and roofs) | `lidar-composite-digital-surface-model-first-return-dsm-1m/wcs`, coverage `df4e3ec3-315e-48aa-aaaf-b5ae74d7b2bb__Lidar_Composite_Elevation_FZ_DSM_1m` |
| Size and speed | 1 km x 1 km is 4.2 MB of uncompressed Float32 GeoTIFF, in about 1.3 s for each product |
| Woodland, Savernake Forest, 500 m square | Ground 159.4 to 177.6 m. 90th percentile of surface minus ground per 20 m cell: median 20.1 m, maximum 26.4 m |
| Farmland, Salisbury Plain, 500 m square | Ground 88.4 to 102.6 m. Median 0 m, top tenth of cells 16.2 m |
| Town centre, Salisbury, 500 m square | Ground 44.8 to 52.7 m. Median 9.3 m, maximum 24.9 m |
| Open sea, English Channel, 500 m square | 100% missing |
| Traps for the builder | Missing heights are -3.4e38, and the DSM sea response did not declare that value, so anything outside -1000 to 2000 m counts as missing. The metadata labels the band in `W.m-2.Sr-1`, but the values are metres. The files are tiled. |
| 2 m versions | The DTM service answered. The DSM service, listed in the EA's announcement, timed out at 20 s, so it is unconfirmed. |

This answers the plan's biggest open question: lidar has a workable route, and the data looks right. M0 then fetched two full 14 km test areas.

### Measured: M0 test areas

Built by hand on 2026-11-04 with throwaway scripts, kept outside the repo in `C:\AlexDev\sg-mapdata\m0-scripts`. Neither is a critical site. The 14 km area used lidar. The rest of each 30 km pack used Terrain 50, and lidar sizes for 30 km are scaled up from 14 km.

| Measure | Inland (around SU 22 66, Savernake) | Coastal (around TF 67 40, Hunstanton) |
|---|---|---|
| Grids, 30 km, gzipped, Terrain 50 tier | 3.45 MB, measured | 1.17 MB, measured |
| Grids, 30 km, gzipped, lidar tier | 3.7 MB, scaled | 1.7 MB, scaled |
| Buildings, roads and names, 30 km, gzipped | 0.48 MB | 0.23 MB |
| OS map, 30 km, paletted PNG | 10.7 MB | 5.6 MB |
| Satellite, 14 km, PNG or JPEG | 3.1 MB or 0.4 MB | 2.5 MB or 0.2 MB |
| **Whole 30 km lidar pack, by calculation** | **about 29 MB** with PNG satellite, 17 MB with JPEG | **about 19 MB** with PNG satellite, 9 MB with JPEG |
| Buildings in the 14 km area, and in 30 km | 8,510, and 25,647 | 7,179, and 13,456 |
| Terrain 50 ground against lidar, on land | Mean 0.61 m, 95% within 1.73 m, worst 10.1 m | Mean 0.42 m, 95% within 1.17 m, worst 12.2 m |
| Land with cover over 5 m | 28.1% | 14.6% |
| **Of that, outside OS woodland and building outlines** | **30.6%,** typically 11 m tall | **31.2%,** typically 9.5 m tall |
| Full game in Node, `MIXED` laydown, 6 waves | Repeatable digest. **Site lost by wave 6.** | Repeatable digest. Site at 100%. |
| Procedural seed 1, same laydown | Site at 100% | Same |
| Lowest drone height above ground | 15 m | 14 m |

**Sight lines,** using the same rule as `los()` and the sensors, on about 1,400 to 3,000 random lines per case:

| Case | Lidar, trees only in OS woodland | Lidar, any tall cover | Terrain 50 with assumed heights | Lines that differ: any tall cover, Terrain 50 |
|---|---|---|---|---|
| Inland: 15 m mast to a drone at 20 m, 1.5 km | 42.3% clear | 35.3% clear | 52.7% clear | 7.5%, 14.2% |
| Inland: 25 m mast to a drone at 50 m, 2 km | 77.9% | 76.1% | 87.6% | 1.9%, 10.4% |
| Inland: 5 m mast to a drone at 20 m, 800 m | 45.3% | 36.0% | 48.6% | 9.6%, 9.6% |
| Coastal: 15 m mast to a drone at 20 m, 1.5 km | 72.8% | 71.9% | 77.8% | 2.2%, 10.4% |
| Coastal: 25 m mast to a drone at 50 m, 2 km | 96.5% | 96.5% | 98.2% | 0.3%, 1.8% |
| Coastal: 5 m mast to a drone at 20 m, 800 m | 67.7% | 63.8% | 65.4% | 4.6%, 12.8% |

**What this changes:**

- **Lidar is worth having.** Terrain 50's ground is close, but its assumed trees and buildings change about 1 sight line in 10 at low level, and it tends to report clear where lidar is blocked.
- **Trees are any tall cover, not just OS woodland.** Limiting them to OS outlines misses about a third of tall cover, mostly hedgerows and tree belts, and changes up to 9.6% of sight lines.
- **Real ground plays differently,** as the balance risk below expected. A laydown tuned on procedural ground lost the inland site.

**Lidar service behaviour:**

| Check | Result |
|---|---|
| Compression | Adding `geotiff:compression=DEFLATE` cuts a 1 km square from 4.2 MB to 1.24 MB, so a 30 km pack transfers about 2.2 GB rather than 7.6 GB |
| Damaged answers | One response arrived damaged out of about 800, so the builder checks each square and fetches it again |
| Server errors | 5 squares in The Wash return HTTP 500 every time, on both products. All are sea, so they count as missing and fill from Terrain 50. |
| Speed | About 2.5 s per square, fetching both products together |
| 2 m sources | **Not needed.** Taking every other 1 m pixel changes ground by 0.03 m on average and tall cover by 0.36 m, which is close enough. But the 2 m service returned 3.9 MB per square uncompressed, so it saved almost nothing, and its DSM service often timed out. |

**Open sea needs its own rule.** In the coastal pack, three Terrain 50 tiles do not exist because they hold no land (`tf65`, `tf75`, `tf85`), and OS tidal water does not reach them. That is 12.3% of the pack, which would otherwise count as dry land. Terrain 50 also gives sea a height of about -2 m, not 0. Only 0.1% of the 14 km area was affected.

**Pictures, judged by eye in the game's own terrain code** ([throwaway page](#m0-prove-the-data-s)), at the game's starting camera, and at about 1.8 km and 500 m up:

| Check | Result |
|---|---|
| OS map | Exactly 2.5 m per pixel. Sharp at the starting camera and in plan view. The 1 km lines baked into it fall exactly on multiples of 1,000 m, which independently confirms the map's position, and the painted grid sits on them. |
| Satellite | **Better than expected.** No clouds, seams or holes in either area, from 9 and 5 scenes. Fields, woods, towns and sandbanks are clear from the starting camera and from 1.8 km up. It is soft at 500 m, and single buildings barely show, as expected at 10 m. |
| Hybrid | Works, and reads well. Roads and names line up with the satellite picture. Names look large close to the camera, so their size needs tuning in M3. |
| North up | Confirmed: canvas top is north, with the default `flipY`, as the rendering table assumed |
| Brightness | The scene's lights dim a map to about two thirds, turning the OS map's white to lilac. Adding the map back as `emissiveMap` at about 0.45 fixes it, without changing the lights on anything else. |
| Trees and buildings | Real trees sit on real woods. Buildings are drawn without their `angle`, because `buildWorldView` does not support it yet. |

**Speed,** on Intel Iris Xe graphics at 1920 x 1080, with all buildings and trees and no drones or systems:

| Measure | Procedural today | Inland | Coastal |
|---|---|---|---|
| Triangles | 256,000 | 521,000 | 349,000 |
| Time per frame, median | 16.7 ms | 16.7 ms | 9.9 ms |
| Time per frame, 95th percentile, starting camera | 17.5 ms | 18.2 ms | 10.3 ms |

16.7 ms is the 60 Hz display limit, so the real margin below it is unknown. Decoding pictures takes 150 to 380 ms, and building the scene 90 to 530 ms. Changing base map or overlay takes about 250 ms, and 650 ms the first time, so it causes one brief hitch. The simulation does not depend on frame time, so that cannot change a run.

### Measured: satellite access

Searched on 2026-11-04, with no imagery downloaded or looked at yet.

| Check | Result |
|---|---|
| Access | [Earth Search](https://earth-search.aws.element84.com/v1), collection `sentinel-2-l2a`, answered with no account. The files are listed as [open on AWS](https://registry.opendata.aws/sentinel-2-l2a-cogs/), and the collection links to the Sentinel Data Legal Notice. |
| Ready-made picture | Each scene has a `visual` true colour Cloud Optimised GeoTIFF at 10 m per pixel, so the builder can read just the area it needs |
| Enough clear scenes | 9 scenes under 10% cloud for May to September 2025 over a test area on Salisbury Plain |
| Grid | Scenes are in UTM (zone 30U here), so the builder must reproject them to EPSG:27700 |

### Calculated: effects safe to ignore

- **Earth curvature:** the bulge on a 7 km path is about 0.7 m with standard refraction, against 4 m RMSE in Terrain 50.
- **Grid scale factor:** under 0.05% across a world.

### Data sources

| Need | Source | Licence | Facts |
|---|---|---|---|
| Elevation, all GB | [OS Terrain 50](https://docs.os.uk/os-downloads/products/land-and-terrain-portfolio/os-terrain-50/os-terrain-50-overview) ASCII Grid | OGL | 50 m posts, 4 m RMSE, 161.7 MB for GB. Bare earth. |
| Water, woodland, buildings, power lines | [OS OpenMap Local](https://docs.os.uk/os-downloads/products/maps-and-imagery-portfolio/os-openmap-local) | OGL | **Available per 100 km square:** 139.4 MB (SU) and 52.7 MB (TF) as Shapefile. GeoPackage is GB only, 3.5 GB. Confirmed in the real data: `Woodland`, `Building`, `ElectricityTransmissionLine`, `SurfaceWater_Area`, `TidalWater`, `Road` and `NamedPlace`. Buildings are generalised. Updated twice a year. |
| Offline map picture | [OS VectorMap District raster](https://docs.os.uk/os-downloads/products/maps-and-imagery-portfolio/os-vectormap-district/os-vectormap-district-technical-specification/raster-specification) | OGL | **Available per 100 km square:** 253.7 MB (SU) and 139.8 MB (TF), or 5.4 GB for GB. 10 km GeoTIFF tiles, 4000 x 4000 pixels, 256 colours, **2.5 m per pixel, measured.** OpenMap Local also has a GeoTIFF (817.9 MB for SU), not tried, as 2.5 m already looks sharp. |
| Online map picture | [OS Maps API](https://docs.os.uk/os-apis/accessing-os-apis/os-maps-api/layers-and-styles) `Light_27700`, `Outdoor_27700`, `Road_27700` | OGL to zoom 9 | Zoom 8 is 3.5 m per pixel, zoom 9 is 1.75 m. Zoom 10 and up is Premium. `Leisure_27700` is Premium from zoom 6, so it is blocked. |
| Lidar, England | [EA LIDAR Composite DTM](https://environment.data.gov.uk/dataset/13787b9a-26a4-4775-8523-806d13af58fc), [First Return DSM](https://www.data.gov.uk/dataset/92534f24-0b92-4b28-9986-347cf6678b39/lidar-composite-first-return-dsm-2022-1m) | OGL | 1 m, about 99% of England. [WCS 2.0.1 services](https://environment.data.gov.uk/support/announcements/275811447/275811543) are live for both, so the builder asks for exactly the area it needs. Measured above. Esri image services are being removed, so do not use them. |
| Lidar, Wales | [DataMapWales](https://datamap.gov.wales/maps/lidar-viewer/) | OGL | 1 m cloud-optimised GeoTIFFs. Later milestone. |
| Lidar, Scotland | Scottish Remote Sensing Portal | OGL, per community sources only | Partial coverage. Later milestone. |
| Satellite picture | Copernicus Sentinel-2 L2A `visual`, through Earth Search | [Free and open](https://ads.atmosphere.copernicus.eu/licences/ec-sentinel), with credit | 10 m per pixel, measured above. Blurrier than the OS map, at about 2.5 m. See [Imagery options](#imagery-options). |
| Roads and place names | OS OpenMap Local | OGL | `Road` has `DISTNAME`, `ROADNUMBER` and `CLASSIFICA`. `NamedPlace` has `DISTNAME`, `CLASSIFICA`, `FONTHEIGHT` and `ORIENTATIO`. Confirmed in the real data. |
| Choosing an area | OS MiniScale or GB Overview Maps | OGL | One small bundled image. MiniScale downloads as a 362 MB zip, so the image is cut from it once. |

### Imagery options

Checked on 2026-11-04. This is my reading, not legal advice, and the Google and Esri rows rest on partial sources.

| Source | Sharpness | Terms | Decision |
|---|---|---|---|
| **Copernicus Sentinel-2**, composited by the builder | 10 m | Reproduction, distribution and adaptation are free, with the notice "Contains modified Copernicus Sentinel data [Year]" | **Chosen as the satellite layer in packs.** No account or usage limit, and it works offline. |
| [EOxCloudless](https://cloudless.eox.at/documentation/license) | 10 m, already cloud-free | [CC BY-NC-SA for 2018 onwards](https://cloudless.eox.at/pricing), otherwise a [paid licence with no redistribution](https://cloudless.eox.at/license-deed). Offline bulk is by custom order. | Saves building a composite, but only suits non-commercial use, and offline rights are unconfirmed. **Chosen on 2026-11-05 for the start map's online satellite and hybrid styles,** as the project is non-commercial. Not used for packs. CARTO was passed over because its raster tiles have needed a key since 25 September 2026, and Esri because its terms for this use could not be confirmed. |
| [Environment Agency aerial photos](https://ckan.publishing.service.gov.uk/dataset/vertical-aerial-photography) | 10 to 50 cm | **Unclear.** A [data.gov.uk record](https://www.data.gov.uk/api/2/rest/harvestobject/d494faf0-44e6-43a2-8b18-e06ab6727e37/html) says Open Government Licence, but the dataset page says no licence provided, and all rights reserved. | Later, as a sharp patch where it exists (M6), and only once the EA confirms the licence. Coverage is project by project. Its web map service shows only footprints, so the photos come as 5 km ECW downloads. |
| [Aerial Photography GB](https://metadata.naturalresources.wales/geonetwork/srv/api/records/EXT_DS121661) | High | Public sector licence, for internal use | Only if you hold that licence. |
| [Esri World Imagery](https://support.esri.com/de/technical-article/000014855) | High | Export needs an account, with a default limit of 100,000 tiles. Full terms not read. | Possible online layer in M5, if the terms allow it. |
| Google | High | Secondary sources ([summary](https://conductatlas.com/platform/google-maps/google-maps-platform-terms-of-service/prohibition-on-caching-and-storing-maps-content/), [forum](https://community.cesium.com/t/google-map-api-tiles-caching-or-download-not-every-time/26719)) say offline storage is not allowed | Rejected for packs. |

### OS terms that shape the design

From the [OS API Service Terms](https://osdatahub.os.uk/support/legal/api-terms) and [rate limit policy](https://docs.os.uk/os-apis/core-concepts/rate-limiting-policy). This is my reading, not legal advice.

- **Open data via the API** may be used for any purpose under the OGL. So browser caching of tiles up to zoom 9 is fine.
- **Premium data** may only be cached for up to 24 hours, so it is out of scope.
- **The API key is Confidential Information** and must be kept secure, which is why tiles go through a proxy.
- **Rate limits:** 600 transactions a minute for a live project, 50 in development mode. A world needs up to 289 zoom 8 tiles: about 30 seconds on a live project, about 6 minutes in development mode.

### SAPIENT

[Dstl's BSI Flex 335 protos](https://github.com/dstl/SAPIENT-Proto-Files), v1 and v2, define `RANGE_BEARING_DATUM_GRID = 3` ("Grid North"), so real worlds can declare grid bearings honestly with no conversion.

## How it works

### Area pack format

One `.sgmap` file, by default covering 30 x 30 km, so the site can be moved anywhere in the central 16 x 16 km without a rebuild.

```text
"SGMAP" + format version + uint32 header length
JSON header
  bounds (BNG), cell (20 m), N, tier (terrain50 | lidar), built, sources and attribution text
  fit: 6 + 6 quadratic coefficients for E/N to lat/long
  geoidSeparation, gridsSha256
  sections: name, offset, compressed length, raw length
Grids, gzipped, north to south
  ground Float32 (metres ODN, rounded to 0.1), canopy Uint8, bldg Uint8, cover Uint8
Features, gzipped JSON
  buildings [x, z, w, d, h, angle], power lines as sampled pylon positions
  roads [class, points], names [text, kind, x, z]
Pictures, one section for each layer, with an index
  osmap: image tiles at about 2.5 m per pixel
  satellite: image tiles at 10 m per pixel, optional, with its source year
```

Size: 15.8 MB of raw grids (1501 x 1501 cells), gzipped to under 4 MB. **A whole pack is about 10 to 30 MB,** far below the earlier 75 MB estimate, because the OS map compresses much better as a paletted PNG than its GeoTIFF size suggested. See [M0's measurements](#measured-m0-test-areas).

The grids hash leaves out pictures, roads and names, so changing them does not change a world's identity.

### Build pipeline (`tools/mapbuild/`, Python)

A CLI run with `uv`: `mapbuild --centre "SU 12 34" --size 30 --tier lidar --out area.sgmap`. It is its own `uv` project, using the same `exclude-newer` rule as `backend/pyproject.toml`. It uses rasterio, pyogrio and pyproj, which stay out of the FastAPI app's production dependencies.

1. **Ground:** resample Terrain 50 to the 20 m grid. For lidar, use the mean of the 1 m DTM per cell, and fill gaps from Terrain 50.
2. **Cover:** rasterise OpenMap Local to the existing classes: 4 water, 3 power line corridor, 2 built, 1 woodland, 0 open. **A missing Terrain 50 tile is open sea,** so it is class 4, as OS tidal water does not reach it.
3. **Buildings:** the 90th percentile of DSM minus DTM, inside building footprints that cover at least 10% of the cell, clamped to 255 m. The Terrain 50 tier assumes 8 m. Each footprint also becomes a rotated box for drawing.
4. **Canopy:**
   - Lidar tier: the 90th percentile of DSM minus DTM in every cell where it is at least 5 m and there is no building or water. These cells become class 1, so their trees are drawn too.
   - Terrain 50 tier: the existing `TERRAIN.canopyMin` to `canopyMax` inside OS woodland, with no fine detail.
5. **Power lines:** sample `ElectricityTransmissionLine` at `TERRAIN.pylonSpacing`.
6. **OS map picture:** crop and retile the VectorMap District GeoTIFFs.
7. **Satellite picture:** search Earth Search for the clearest summer scenes (up to 5, under 10% cloud), read just the pack's area from each `visual` file, reproject to EPSG:27700 with OSTN15, and take the median of each pixel to remove leftover cloud. If too few scenes are clear, the pack is built without this layer and says so.
8. **Roads and names:** clip OpenMap Local roads and place names to the pack.
9. **Fit:** least squares over a 61 x 61 sample using pyproj with OSTN15. Geoid separation from OSGM15 at the centre. The build fails, before downloading anything, if the fit error exceeds 2 m. It was 0.5 m until a 60 km pack reached 0.93 m at its corners; 30 km packs stay near 0.1 m.
10. **Check and write:** no NaN anywhere, all lengths correct, then hash.

The DSM must be the **First Return** product, because tree tops are the point. The builder fetches lidar one square kilometre at a time, with `geotiff:compression=DEFLATE`, keeps only the 20 m results and throws the raw data away. A full 30 km pack transfers about 2.2 GB in 1,800 requests, which takes about 40 minutes. It fetches at a limited rate and can resume, as the EA's limits are unknown. Each square is checked and fetched again if damaged, and a square that keeps returning HTTP 500 counts as missing.

Only building footprints make a cell solid. Bridges and other tall things outside them count as trees, which limit a sight line rather than block it outright. Pylons rarely reach the 90th percentile of a 20 m cell. Trees use the same rule as today: radar, cameras and lasers see through up to 40 m of them, and RF fades with distance through them.

pyproj does not include the OSTN15 grid by default, so the builder must fetch it, and must refuse to build the fit without it. M0's satellite pictures did not use it, which matters little at 10 m per pixel, and the builder should use it for those too.

### Loading a world

```text
.sgmap file -> Blob in IndexedDB -> api/pack-store.js decodes -> sim.registerPack(parsed)
                                                                 commands.deploy(seed, world)
```

**World identity is one string,** because `deploy`, `setWorld`, `loadLaydown`, `run-record.js`, the `world` column and the API already pass one around:

```text
pack:<first 32 hex of gridsSha256>:<E0, 6 digits>:<N0, 7 digits>:<real|model>     58 characters at most
```

It fits the existing `Seed` limit of 64, so real worlds need **no migration and no API change**. Only an exact match of that pattern is a real world, and anything else stays a procedural seed.

- `sim/world-pack.js`, synchronous and DOM-free, so it passes `boundary.test.js`:
  - `parsePack(header, grids)` validates.
  - `cutWorld(pack, e0, n0, siteMode)` copies a 701 x 701 window, subtracts `H0`, clips features, then calls `makeWorld`.
- `sim.registerPack` keeps packs in a map by hash. It is not a logged command, so the log stays small.
- `setWorld` in `simulation.js` chooses the source: `cutWorld` for a real world, `generateTerrain` otherwise. It still sets `terrainState.data` and emits `terrain`, and `game-view.js` `loadWorld` rebuilds the scene as it does today.
- **A missing pack changes nothing.** `loadLaydown` already returns a reason as a string, so it checks for the pack before `endRun`. `deploy` makes the same check.
- **`deploy` needs reordering.** It calls `net.init()` before `setWorld`, and skips it when the seed is unchanged, so the fusion and perimeter nodes would register with the old world's locations and bearing datum until the first wave's rebuild. Re-seed and call `init` after a world change. Run digests should not move, because `beginRun` rebuilds anyway, and the reference digests guard this.
- `api/pack-store.js` follows `run-saver.js`: created in `createGame`, with its storage passed in, so it can be tested in Node. Packs must work with the backend stopped, so they never depend on it.
- **`sim/` only ever receives the grids and rule features.** `game.js` hands pictures, roads and names to `render/map-texture.js`, so the rules cannot come to depend on them.
- **Decoding works within the Content Security Policy, unchanged.** Grids use `DecompressionStream`, and map tiles use `createImageBitmap` drawn to a canvas. Do not use blob URL images. Decoding runs on the main thread behind a loading message. If M0 finds that too slow, add `worker-src 'self'` and a bundled worker.
- The site snaps to a 20 m post, so the cut needs no resampling and is exactly repeatable.
- `location()` in `sapient.js` uses the fit when a real world is loaded, and keeps today's formula otherwise. Nothing reads these locations back into the rules (re-checked: `authority`, `fusion`, `registration`, `tasking` only send them), so only output changes.
- `z` in a real world becomes `y + H0 + geoidSeparation`, to honestly match `LOCATION_DATUM_WGS84_E`.
- `RB_DATUM` in `core.js` becomes a value read from the world: TRUE in procedural, GRID in real. It is read in `sensors.js`, `registration.js` and `network/index.js`. In `ui/sapient-help.js`, add GRID and correct "true north here". Feature A's radar arcs need nothing extra, as bearings are already measured in scene axes.

Mobile masts are not in OS open data, so real worlds keep the high-ground picker, seeded from the world string, and show those masts as **notional**.

### Rendering

| Item | Approach |
|---|---|
| Map on terrain | In `buildWorldView`, real worlds skip height colouring and use a `CanvasTexture`, built in a new `render/map-texture.js` to keep `terrain-view.js` inside the size limit. Canvas top is north, which matches `PlaneGeometry` UVs with the default `flipY` after `rotateX`. Set the sRGB colour space and maximum anisotropy. Scene lighting adds the relief shading. |
| Texture size | 4096 px over 14 km is about 3.4 m per pixel, capped by `renderer.capabilities.maxTextureSize`. Satellite at 10 m fills about 1400 px of that, so it is smoothed up to fit. Only add a sharper patch around the site if M3 shows it is needed. |
| Base maps | Choosing one repaints the canvas from the pack and re-uploads the texture once, which takes about 250 ms. Only the current picture is kept decoded, as a 4096 px canvas takes about 67 MB. Shaded relief is painted from the grids with `makeHillshade`. Procedural worlds keep today's height colouring. |
| Brightness | Add the map as its own `emissiveMap` at about 0.45, as the scene's lights alone dim it. Procedural worlds are unchanged. |
| Grid overlay | **Painted into the map canvas,** not draped as 3D lines. Lines always follow the ground, cannot z-fight and do not need a 3D label system. Toggling repaints and re-uploads once. |
| Roads and names | Painted into the same canvas, so they work the same way as the grid. Names are drawn with `fillText` at a fixed size, using `FONTHEIGHT` to pick out larger places, so they do not swamp the map. Together with satellite, this is the hybrid view. |
| 2D maps | Set `terrainState.hillshade` to a smaller copy of that canvas. `ui/minimap.js` and `ui/dock/plan-canvas.js` then show the real map and grid with no drawing changes. |
| Plan view | **The same perspective camera, straight down,** with rotation locked. Not an orthographic camera, because `minimap.js` reads `camera.fov`. Placement raycasting carries over. |
| Mesh | `meshStride` 2 in real worlds (40 m, about 245,000 triangles). |
| True scale | `TERRAIN.visualScale` becomes 1 in real worlds, so models fit the map. `STRUCT_SCALE` stays, because it affects muzzle heights in the rules. |
| Buildings | Instanced boxes with an added rotation (`angle`, default 0). About 8,500 drew at full speed on integrated graphics. Add a cap, nearest-first, only if a dense urban pack needs it. The `bldg` grid always holds every building, so a cap affects the picture only. |
| Readout | `SU 12345 67890, 143 m ODN` at the cursor, from `bng.js` and `groundAt`. `placement.js` exposes the cursor position, and a panel shows it at the normal panel rate. Grid references in labels and panels. |
| Showing the world | `Hud.jsx`, `SavedTab.jsx` and `RunsTab.jsx` print the world value as it is. One helper turns a real world into a pack name and grid reference. |
| Attribution | Always on screen, from the pack header, and changing with the layers in use. OS layers credit OS, and satellite shows "Contains modified Copernicus Sentinel data [Year]". |

### Choosing the site and placing effectors

1. **Start screen:** a new `ui/WorldPicker.jsx`, rendered by `StartCard` in `Overlay.jsx`. Select Real, then choose an imported pack. Procedural keeps today's seed box.
2. **Site picker:** a 2D canvas of the whole pack, separate from the 3D scene. Click or type a grid reference. It shows height, data tier, and whether a full world fits.
3. **Site mode:**
   - **Real site (default):** no stamping or levelling, and the real buildings are the site. `data.station` is empty. Hits flash the site ring, since there is no station material. The fusion node keeps its assumed 80 m mast (`FUSION_DEF.mount`), since it is part of the rules.
   - **Model site:** stamps `STATION`, and levels flat to 200 m, blending out by 400 m. Warns when the earthworks exceed 30 m.
4. **Deploy,** then the normal build phase. `placementProblem` carries over as is: the distance limits, buildings, water, slope and spacing rules all read the same grids.
5. **Effectors:** click, or type a grid reference. Labels and the Nodes tab show grid references.

Moving the site means going back to the start screen and clearing the laydown, as distances are all relative to it.

**Saved laydowns and runs:** the `SavedTab` already stores `world` and switches to that ground on load, so real worlds use the same path. Before calling `loadLaydown`, it awaits the pack from the pack store. If the pack is not in this browser, it says which one is needed and changes nothing. Coordinates stay relative to the site, so `WORLD_LIMIT` still holds.

### Online and offline

| | Offline | Online adds |
|---|---|---|
| Terrain and rules | Area pack | Nothing |
| Map picture | Pack: OS map, satellite and shaded relief | Live OS layer, shown once all tiles have loaded. The pack map shows until then, and is the fallback. A sharper satellite layer only if its terms allow it. |
| New area | `mapbuild` from OS files on disk, for the Terrain 50 tier with no satellite | Lidar and satellite fetching, and building from inside the app |
| Find a place | Grid reference | Postcode and name search |
| App | Bundled, served locally, no CDN. No service worker needed. | Nothing |
| Saving | Local FastAPI, no internet needed. If it is stopped, play and packs still work, and only saved laydowns and history wait, as they do today. | Nothing |

**Tile proxy:** `/api/v1/os-tiles/{style}/{z}/{x}/{y}` in FastAPI. The Vite dev server already proxies `/api`, so there is nothing to add for development. It only supplies the map picture, so the backend still takes no part in live play.

- It stays same-origin, which satisfies the Content Security Policy in `security.py` with no change.
- It uses the standard library's `urllib` in a synchronous route, because `httpx` is a dev-only dependency and one upstream call does not justify adding it.
- The key comes from a server-side environment variable.
- It allowlists the three styles, zoom up to 9, and tiles inside GB.
- The client fetches at a limited rate, backs off on 429 and keeps tiles in browser cache.
- Tile grid origin and tile size come from the WMTS GetCapabilities response, not hard-coded values. I could not confirm them from the OS docs.

## Milestones

Sizes are rough estimates: S is up to 2 days, M is up to a week.

### When to start

| Milestone | Earliest start | Reason |
|---|---|---|
| M0, M1 | **Done** | M1 only moved code out of `sim/terrain.js`, so it does not overlap Feature A1 |
| M2, M3 | **Now,** in order | Features A, B and C do not block them. Each later rules change also re-baselines the fixture pack digests, as it does the procedural ones. |
| M4, M5 | In order, after M3 | React and FastAPI are both in place |
| M6 | After M3 | Independent of the UI work |

**Features A, B and C overlap with this plan in a few places,** so whichever lands second rebases: `StartCard` (A5 adds an environment setting), `plan-canvas.js` and `minimap.js` (A4 draws arcs), `placement.js` (C1 clicks on units, and the readout here uses the cursor), `ControlPanel.jsx`, and `commands` in `simulation.js`. Re-check the names used here before each milestone if those have landed.

### M0: Prove the data (S)

- [x] Confirm the DTM and First Return DSM WCS return data, and work out the coverage IDs
- [x] Build one pack's data by hand for an inland English site and a coastal one, with lidar over the central 14 km
- [x] Confirm VectorMap District pixel size from a real GeoTIFF. The OpenMap Local GeoTIFF was not tried, as 2.5 m already looks sharp and it is 817.9 MB per square.
- [x] Measure pack size, and compare 1 m and 2 m sources after aggregating to 20 m
- [x] Measure how much tree cover sits outside OpenMap Local woodland footprints
- [x] Measure sharpness at 4096 px, and frame rate at `meshStride` 2 with `visualScale` 1, in a throwaway page
- [x] Confirm OpenMap Local's road and place name layers from the real data
- [x] Build a satellite composite for both sites, and judge it in the same throwaway page at the game's usual camera heights, beside the OS map

**Done.** Results are in [Measured: M0 test areas](#measured-m0-test-areas). The inputs are kept in `C:\AlexDev\sg-mapdata`: 0.75 GB of OS files, and the two test areas in `work\<site>\world`, for use in M2 and M3. The raw lidar was deleted. Still estimated: a full 30 km lidar pack, as only 14 km was fetched, and a dense urban area, as neither test area is one.

### M1: Separate the world from its source (S)

- [x] Move the queries out of `generateTerrain` into `makeWorld(grids)` in the new `sim/world.js`. `seed` goes with the grids, as the tree scatter reads `data.seed`.
- [x] Lift `rasterBox` and the mast picker (`pickMasts`) out of the closure, keeping the order of random draws unchanged

**Done when:** reference digests are **byte-identical** with no fixture changes, and `GAME_VERSION` is unchanged. **Met,** and `tests/world-source.test.js` now plays a full game on a hand-made world with no station, a cliff and sea. This is the only milestone that may refactor procedural code.

Renaming `state.terrainSeed` moved to M2, as nothing needs it until a real world exists, and it would touch files that Features A and B also change.

### M2: Pack builder and loader, no visuals (M)

- [ ] `tools/mapbuild/`, with pytest, starting from M0's scripts. It covers the Terrain 50 and lidar tiers, the satellite picture, roads and names, so the format is settled once. Lidar moves here from M6, as M0 showed both that it works and that the Terrain 50 tier differs noticeably.
- [ ] `sim/bng.js`: E/N to and from grid references at 6, 8 and 10 figures, with validation
- [ ] `sim/world-pack.js`: `parsePack`, `cutWorld`, both site modes, and the world string's parser
- [ ] Rename `state.terrainSeed` to `state.world`, and the same parameter name through `createSimulation`, `createGame`, `run-record.js`, `main.jsx`, `Overlay.jsx`, `Hud.jsx`, `SavedTab.jsx`, `plan-canvas.js` and the tests. The URL and UI behave as today.
- [ ] `setWorld` choosing the source, the missing pack checks, and `deploy` re-initialising after a world change
- [ ] Give spotters a minimum height above the ground, as they hold one height all the way in
- [ ] A world made from real test area grids in the tests, as well as hand-made ones, if a small enough crop still covers trees, buildings and sea
- [ ] Fit in `location()`, height conversion, and the bearing datum
- [ ] Small hand-made fixture packs in `tests/support/`, inland and coastal, each with its own reference digest
- [ ] Add `*.sgmap` to `.gitignore`, except those fixtures, so a real site's pack cannot be committed by accident
- [ ] A real world string in the shared samples from `write-fixtures.js`, so both test suites cover it. A later change to `cutWorld` raises `GAME_VERSION`, as the pack hash alone does not cover it.

**Done when:** a full game plays in Node on a real pack, repeatably, and procedural digests are unchanged.

### M3: Draw the real world (M)

- [ ] Everything in the Rendering table, including the base maps and hybrid view, starting from M0's throwaway page
- [ ] Rotated buildings in `buildWorldView`, and name sizes that read well close to the camera
- [ ] `MapControls.jsx`, with the greyed-out options and hotkeys, so each layer can be checked by eye
- [ ] A temporary file input behind `import.meta.env.DEV` for loading a pack, removed in M4. Not a pack in `public/`, because Vite copies that folder into the `dist` that FastAPI serves.

**Done when:** verified in the browser on both packs, with screenshots and frame rate compared with procedural.

### M4: Choose the world, place the site and effectors (M)

- [ ] `api/pack-store.js`: pack import, list and delete, in IndexedDB. Request persistent storage. Clear messages on quota errors or a bad file.
- [ ] `WorldPicker.jsx` and site picker, both site modes, grid reference entry
- [ ] Grid reference labels, the world label helper
- [ ] `StartCard` and `SavedTab` stop writing `&terrain=` for a real world, and `main.jsx` ignores a real world string in a URL rather than failing on a pack it does not have
- [ ] `SavedTab` awaits the pack before loading, and reports a missing one
- [ ] Add real-site data to the accepted limits in `SECURITY_NOTES.md`

**Done when:** with no internet, a player imports a pack, places a site and laydown by grid reference, saves it, plays, reloads the page, loads the saved laydown, replays the same inputs and gets the same digest.

### M5: Online extras (M)

- [ ] Tile proxy and live layer, including the rate limit behaviour, added to `MapControls.jsx`
- [ ] A sharper online satellite layer, only if the way the app is used and the provider's terms allow it, through the same proxy and with the same notice
- [ ] Place search through the proxy (OS Names API)
- [ ] "Build this area" through the backend, as a job with progress. Fixed upstream hosts, bounds checked, one job at a time. It runs `mapbuild` as a subprocess with fixed arguments, so GIS packages stay out of the app, and writes to the git-ignored `backend/data/packs/`. The browser fetches the result with a GET, so the 1 MB limit in `RequestGuard` stays as it is.
- [ ] Update `SECURITY_NOTES.md`, which says the app holds no secrets. The API key changes that.
- [ ] A notice when a live layer is first turned on: it reveals the area being studied to its provider

**Done when:** pulling the network mid-run changes nothing except the live layer falling back, with a message, and the digest is unchanged.

### M6: Wider lidar and real features (M)

- [ ] Wales lidar, as the England tier moved to M2
- [ ] Real buildings and power lines drawn from pack features, if not already complete from M3
- [ ] Scotland, if wanted, given partial coverage
- [ ] Sharper close-up map, only if M3 showed the need: Environment Agency aerial photos where they exist, once the EA confirms the licence. Check that the builder can read ECW, which may need a separate driver.

**Done when:** a known real ridge or wood measurably blocks a sensor at a spot checked by hand against the OS map.

## Tests

- **Invariant:** procedural reference digests never change because of this work.
- **`bng.js`:** round trips, published OS examples, and rejection of invalid letters, odd digit counts and out-of-range values.
- **`parsePack`:** rejects bad magic, unknown versions, wrong lengths, oversized `N`, hash mismatches, and **any non-finite height**. A NaN compares false in `los`, which would silently report a clear line of sight.
- **`cutWorld`:** `groundAt(0,0) = 0`, a site too near the edge is refused, and features are clipped.
- **World string:** only an exact match is a real world, near misses stay procedural seeds, and a missing pack leaves the current run untouched.
- **URL:** a real world never appears in the URL after Deploy or after loading a laydown.
- **Coordinates:** fixture fit matches stored pyproj values. Procedural `location()` output is unchanged.
- **Determinism:** fixture digest is repeatable, and does not change when the pictures do, or when the base map, overlays or view change mid-run.
- **Map controls:** each row of the options table shows the right choices and reasons. A pack with no satellite still loads, and says "Not in this pack".
- **Coastal fixture:** sea cells count as water and cannot be built on. Drones spawned over them fly normally.
- **Steep ground:** strike drones following real terrain stay above ground on a cliff fixture. `tests/world-source.test.js` already covers this on a hand-made world. Spotters need the same check against a fixture taller than their 400 to 500 m flying height.
- **Coverage:** 90% or higher on new modules. Existing `boundary.test.js` and file size limits apply.
- **Browser:** the master plan's manual checklist still passes in a procedural world.

## Security and sensitivity

- **Real sites make outputs more sensitive.** A coverage gap map and laydown for a named power station says more than one on invented ground. So: no bundled presets of real critical sites, no sharing feature, and laydowns stay local.
- **The site is never put in the URL.** `seed` stays in the URL as today, but the pack and site do not, as URLs end up in history and logs. `StartCard` and `SavedTab` both write the world into the URL today, so both must change.
- **The site is now stored in the clear.** The world string holds the site's grid reference, in the unencrypted SQLite file and in the browser's kept runs. That suits local use, but `SECURITY_NOTES.md` must say so, and it counts as sensitive if the app is ever hosted.
- **Online use discloses the area of interest** to OS through tile and search requests, and to any online satellite provider. Use offline packs for sensitive sites.
- **Building a pack also discloses an area,** to the EA and AWS, through lidar and satellite requests. The default 30 km pack does not pinpoint the site within it, but the request logs still show the region. OS files are per 100 km square, so they say little.
- **Satellite and aerial pictures of a named site add to its sensitivity,** especially the sharper aerial patch. Packs stay out of git, as M2 sets up.
- **API key:** server side only, never in the bundle, a pack or the repo.
- **Packs are untrusted files.** Validate before allocating, abort decompression beyond the declared raw length, cap `N`, verify the hash, and never treat header text as HTML. Pictures are decoded only with `createImageBitmap`, with their sizes capped. Road and name counts and lengths are capped, and names are only ever drawn with `fillText`.
- **Proxy and builder:** fixed upstream hosts, allowlisted parameters, bounds checks and rate limits. Bound to `127.0.0.1` like the rest of the backend.
- **Attribution:** always on screen. Confirm exact OS, EA and Copernicus wording in M3.

## Risks

| Risk | Response |
|---|---|
| **Balance shifts on real ground.** Tuning assumed a valley with ridges. | Accept. Compare real worlds with each other, not with procedural. Budget and ranges stay tunable. |
| **Terrain 50 reads as more accurate than it is.** Measured: it changes about 1 low-level sight line in 10 against lidar, up to 12.8%, and its assumed heights report clear too often. | Pack records its tier, and the UI shows it. Lidar is the default wherever it exists. |
| **The 20 m cell blurs hedges and small gaps.** Hedges now count as trees, but a thin gap in one does not show. | Documented limit. Cell size comes from the pack (`data.cell` is used in the views), so 10 m can be tried later at four times the memory. `TERRAIN.meshStride` and `treeStep` would need a check. |
| **Fixed `SITE.radius` of 150 m** suits a power station, but not every real site. | Fixed in this plan. Easy follow-up. |
| **Lidar age and gaps,** including a known gap near RAF Fylingdales ([community source](https://wiki.openstreetmap.org/wiki/UK_Environment_Agency_LIDAR)), and squares where the service always fails. | Filled from Terrain 50. Pack records sources and dates. |
| **Upstream services change,** as with the EA image service removal. | Only the builder depends on them. Built packs keep working. |
| **Dense urban areas** could slow drawing. Neither test area was dense, and 100 km square SU averages about 105 buildings per square km, so a city could hold many times M0's 8,500. | Building cap, measured on a city in M3. |
| **Satellite at 10 m is soft close up,** though M0 found it good from the starting camera and from 1.8 km up. Single buildings barely show. | OS map stays the default base map. The sharper options are in [Imagery options](#imagery-options). |
| **Composites can show seams or odd colours,** from cloud, shadow and scenes taken weeks apart. M0 saw none in two areas, but a cloudier part of GB may be harder. | Median of several scenes. A pack can always ship without this layer. |
| **Spotters fly through high ground.** `moveSpotter` holds the height it launched at, 400 to 500 m above that point. Procedural ground never reached it (measured: 12 bearings on each of 8 terrain seeds), but real mountains can. | M2 adds a minimum height. It should not move procedural digests, as it never triggers there, and the reference digests check that. |

## What the rebuild settled

The earlier draft made three small asks of the refactor.

| Ask | Outcome |
|---|---|
| Name the column `world`, not `terrain_seed` | **Done,** in the `laydowns` and `runs` tables. |
| Pass `deploy` one world value | **Done:** `deploy(seed, world)` takes one string. World choice still needs its own component, which M4 adds. |
| Validate coordinates against the world's `R` | **Withdrawn.** The backend holds no packs, so it cannot read `R`. Every world cut from a pack has the same `R`, so the fixed `WORLD_LIMIT` in `schemas.py` is correct. Worlds grew to 14 km `R` and then 27 km `R` on 2026-11-07, and `WORLD_LIMIT` moved with them, to 1,350 units. |

## 54 km worlds

On 2026-11-07 Alex asked to double the map, meaning twice the width, which made a world 28 km across. The same day Alex asked for drones to launch from as far as 26 km out, and chose to grow the world again to fit: a world is now 54 km across (`WORLD.radius` 27,000 m), and the furthest a drone starts is 26 km (`WORLD.spawnDist`), 1 km inside the edge.

| Measure | 14 km world | 28 km world | 54 km world |
|---|---|---|---|
| Height grid | 701 x 701, 3.4 MB | 1401 x 1401, 14 MB | 2701 x 2701, 51 MB |
| Generating ground, in Node | 0.28 s | 1.1 s | 3.9 to 4.6 s, so the last ground made is kept (`generateTerrain`) |
| Coverage map, 250 m cells | 2,916 cells | 12,100 cells, about 150 ms per drone type | 45,796 cells, 130 to 580 ms per drone type |
| Real map mesh | a vertex every 40 m, 245,000 triangles | every 60 m, 435,000 triangles | every 100 m, about 583,000 triangles |
| Map texture, 4096 px | 3.4 m per pixel | 6.8 m per pixel | 13.2 m per pixel |
| Minimap and Plan relief, generated ground | 320 px | 640 px, the same 44 m per pixel | 1,227 px, the same 44 m per pixel |
| Drawn each frame, Narva pack | not measured | 1.19 million triangles in 16 draw calls, 283 MB of script memory | not measured |

The frame rate is not measured yet: both browsers were hidden while this was checked, and a hidden page gets 30 frames a second at most, so the 33 ms frames seen on the Intel Iris Xe say nothing either way. It needs a check with the game on screen. The coverage map is the slowest part to redraw, and is the first thing to speed up if the bigger world feels slow.

**Where drones start.** Each type has a launch band (`WORLD.launchBand`, read by `launchDistance` in `sim/attack-area.js`): a quadcopter starts 12 to 15 km out, the reach of its radio or fibre, and a fixed-wing drone 12 to 26 km. Each of a wave's launch areas rolls its own share of the band, so attacks come from different distances as well as bearings. A drone's `launch` field can name another band: the Lancet-3, with about 40 km of range, flies the long band, and the CH-901, with 10 to 15 km, the short one. The Shahed class (the generic fixed-wing strike drone and its Shahed, Geran, Gerbera, Feilong-300D, Sunflower-200 and ASN-301 variants) has `launch: 'edge'`: it flies hundreds of km, so it comes in from off the map, at the edge less 200 m along its bearing, which at a corner is up to 38 km from the middle. A strike drone now counts as gone only when it leaves the map, or when GNSS jamming has turned it and it is more than 27 km from the area.

**Packs.** The builder's default is now 70 km, so the site can still move 8 km each way, and English lidar covers the whole 54 km world (about 7.1 GB and 2.5 hours). A pack must be at least as wide as a world, and a smaller one is refused with a message to rebuild it: the 30 km packs (Savernake, Hunstanton and Tapa) and any 44 km one need rebuilding. Hereford and Narva are rebuilt at 70 km; Hereford's fit error is 1.6 m. The 30 km pack for the area around SO 50 40 covered the same ground as Hereford, so it was deleted. The position fit allows 5 m of error, as its error grows with the fourth power of the pack's size: about 3 m at 70 km.

**Generated ground** spreads 48 hamlets out to 2 km inside the edge, and its power lines run to the edge. Masts stay 3.5 to 7 km from the middle. Trees are still drawn only within 4.5 km of the middle, as before; beyond that, woods show in the ground's colour. Real maps draw a coarser mesh as they grow, at least every `(N - 1) / 540` posts.

## Grids on the map

Every real map can show its national grid (OS in Great Britain, L-EST97 in Estonia) or MGRS, chosen in the map panel; G steps through them and then off. MGRS is UTM on WGS 84 with letters for each 100 km square (`sim/mgrs.js`), and it covers the world, so a map in any country can carry it. Its projection is the same transverse Mercator series the OS grid uses (`transverseMercator` in `sim/bng.js`), checked against PROJ to under 5 cm. The map draws the UTM zone of its middle across the whole map, through points every 5 km, as its lines sit at an angle to the national grid; no pack yet straddles a zone edge. The cursor's readout follows the grid that is showing. Typing an MGRS reference is not built yet.

## Estonia

Estonia was added as a second grid, starting with Tapa. Alex asked for it after trying the world map.

**The design.** Great Britain's northings stop at 1,300 km and Estonian ones start at 6,365 km, so a position says for itself which grid it is on (`frontend/src/sim/grids.js`). World identities, saved laydowns and pack headers needed no new field, and the rules never see a grid at all, only metres around the site. The grid is L-EST97 (EPSG:3301), checked against pyproj to under 0.05 m.

**The sources**, all from the Land and Spatial Development Board under its [open data licence](https://geoportaal.maaruum.ee/opendata-licence), which allows commercial use and redistribution, and asks for the owner, title and age of the data:

| What | Source | Size | Reveals the area? |
|---|---|---|---|
| Ground heights | `DTM_10m_eesti.tif`, 10 m, from lidar | 2.2 GB | No, whole country |
| Tree and building heights | `ndsm_5m_2020-2023_kogu_Eesti.zip`, 5 m, one file per square km | 3.8 GB | No, whole country |
| Buildings, woods, water, roads, power lines | Five `ETAK_Eesti_SHP_*.zip` themes | 1.3 GB | No, whole country |
| Place names | `asustusyksus_shp.zip`, the settlement units, from the agency's file store at `s3.pilw.io` | 16 MB | No, whole country |
| Map picture | `epk_v` tiles at 3.9 m per pixel, 930 for a 30 km pack | About 16 MB, in about 10 minutes | Yes, to the agency |
| Satellite | Sentinel-2, as in Great Britain | Fetched | Yes, to AWS |
| Heights past the border | Copernicus DEM GLO-30, 30 m, with its water body mask | About 40 MB for Narva's two tiles | Only the 1 degree square, to AWS |
| Place names past the border | GeoNames `RU.zip`, CC BY 4.0 | 15 MB | No, all of Russia |

**Choices worth knowing.** Whole-country files were preferred over per-sheet requests, because getting them says nothing about the site, and later builds need no heights or features from the internet. The agency's terms prefer its tiles to its live map service for base maps, and ask for reasonable load, so the builder fetches one tile at a time with a pause. It got HTTP 429 from the download site during research when asking for many small ranges, so it fetches each file once and waits when refused. Lidar covers the whole pack rather than the middle 14 km, because it is already on the machine by then.

**Measured at Tapa.** The national files take 6.8 GB, and downloaded at 8 to 13 MB/s. The whole first build took 19 minutes, of which about 7 minutes was downloading, and about 10 minutes the map tiles. Heights and features alone rebuild in under a minute. The finished pack is 17.8 MB, with 16,436 buildings, 2,342 woods, 13,636 roads and 19 power lines, heights from 69.5 to 143.3 m, and a position fit good to 0.15 m. Three waves of the mixed laydown played through the real rules, with every drone above the ground, the same result each time, and positions reported to within 3 mm of the grid's own answer.

**Things the data taught.** The lidar zip uses Deflate64, which Python's `zipfile` cannot read, so it is read through GDAL, and only a spread of its sheets can be checked after download. A `where` filter on a shapefile needs its field among the columns read, or it silently matches nothing.

**Past the border.** Estonian data stops at the national border, and the builder used to treat ground with no data as water, as it does for sea. At Narva that was most of the map, so where Estonian heights stop the builder now fills them from [Copernicus DEM GLO-30](https://registry.opendata.aws/copernicus-dem/): 30 m posts from the AWS open data bucket `copernicus-dem-30m`, no account needed. It fetches whole 1 degree tiles, about 14 to 25 MB each, so a download says little about the site, and checks each against the MD5 that S3 gives as its ETag. Each tile's water body mask marks lakes, rivers and sea. The licence allows copying, sharing and changing the data, commercial use included, and asks for a notice and a no-liability sentence, which the pack header carries as `credits.heights` and the game always shows. GLO-30 is a surface model from radar, so woods and buildings are part of its heights: on the Russian side they block sight as ground does rather than thinning it as trees do, and none are drawn. Its heights are on EGM2008, within a few tenths of a metre of Estonia's EH2000. ESA WorldCover could mark trees and built-up land there, but would count trees twice, so it is not used.

**Names and topography past the border.** The basic map is blank, white or black, past the border. The builder samples its pictures at every post, keeps the blank patches that reach ground Copernicus filled, and outlines them (`tools/mapbuild/mapbuild/beyond.py`, leaving out patches under 0.25 km²). The patches matter: Estonia's heights run a few hundred metres past the border, where the map is already blank, so the filled posts alone left a white strip along the Narva. The pack stores the outline as `features.beyond`, rings in metres from the pack's middle. The game shades that ground from its own heights, with contours and their heights (`paintBeyond` in `render/map-texture.js`), on the basic, light and dark maps. Names there come from GeoNames' file for Russia, which holds only places in Russia, so it needs no border of its own: settlements that are not historical, abandoned or part of another place, written in Latin letters (the plain-letter form when GeoNames has only Cyrillic), large for a town of 2,000 people or an administrative centre and medium otherwise. GeoNames asks for a credit, which the pack carries as `credits.names` and the game always shows.

**Known limits.** Place names are not in ETAK, so they come from the settlement units instead: each is named once, at the middle of its area, with its type word ("linn", "küla") left off. Cities and towns are drawn large, and small towns, city districts, boroughs and villages medium, as OS sizes towns and villages. A village's area is its whole parish of farmland, so its name can sit some way from its houses. `EGM2008` stands in for the local height system when reporting altitude, as PROJ has no grid for EH2000.

## Assumptions to confirm

Set as defaults. Each is cheap to change now.

| Assumption | Default | If wrong |
|---|---|---|
| "GRIDS" means a grid overlay and grid references | The national grid's 6, 8 and 10 figure references, and an MGRS or national grid on the map | Typing MGRS needs a parser; the lettering and UTM are in `sim/mgrs.js` |
| Coverage | Great Britain and Estonia | Each new country needs its own open data and grid. See "Estonia" below for what that took |
| "Offline" | A laptop with no internet, using packs built beforehand | A truly air-gapped build needs the national files and builder carried across, and that is already possible |
| Licensing | Open data only | Paid OS products (Terrain 5, Premium zooms) would need their own terms checked, especially on storage |
| How the app is used | Possibly commercial, so only sources with no non-commercial limit | Non-commercial: EOxCloudless could replace building a composite, if its offline rights are confirmed. Public sector: Aerial Photography GB may be open to you. |

## Left out on purpose

Typing MGRS references, maps beyond Great Britain and Estonia, national aerial imagery (it needs a public sector or paid licence), Google imagery, named critical-site presets, full 3D building shapes, weather, Premium OS zooms, worlds spanning several packs, a tile streaming engine, and laydown file export (no such feature exists today, and it would cut against keeping laydowns local).
