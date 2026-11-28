# Airports and air traffic

Four sizes (small / medium / large / hub), each bigger than the old 3x3 airport, with taxiing on the ground, one-at-a-time runways and holding patterns.

## Layout (`src/shared/world/airportLayout.ts`)
An airport is a rectangle in the air layer (`map.air`). The value of each tile says what it is:
`1` apron, `2` runway, `3` terminal (the **stop**: the one tile that routes and passengers refer to), `4` taxiway, `5` stand, `6` hangar (the **depot** tile), `7` terminal building.

Rows (top to bottom, runway east-west; north-south is the same layout transposed):
runway, taxiway, stand rows, **terminal row** (hangar, terminal building, hangar), stand rows, and for large airports a second taxiway and runway.
The first and last columns are a taxiway that goes around, so every stand can be reached.

Each size has **10 designs** (`SPECS[size].designs`, one row string per design: runway `R`, taxiway `T`, apron `A`, stand row `S<n>`, hangar row `H<n>`, terminal row `M<pos><width><hangars>`; the token grammar is above `SPECS`). Design 0 is the layout described above. The width is fixed per size; the number of rows, the terminal position, the hangars and the stand rows vary. The size of a placed airport is worked out from its number of stands (`sizeByStands`), so every design of a size must stay inside that range; `airportLayout.test.ts` checks this, that everything is reachable on the ground, and that no design repeats. The `place` command takes `air.design` (0-9). Notes: a runway row must be next to a taxiway row, and a taxiway row between two runway rows would be cut off from the ring (do not add one).

| Size (design 0) | Tiles | Runways | Stands | Aircraft | Price |
|---|---|---|---|---|---|
| S | 10x4 | 1 | 2 | small | 6M |
| M | 16x5 | 1 | 8 | small, medium | 20M |
| L | 24x9 | 2 | 24 | all | 70M |
| H (hub) | 40x11 | 2 | 60 | all | 250M |

`airportAt(map, idx)` (`src/shared/world/airports.ts`) works out what an airport is from its tiles (runways, stands, hangars, size), so **nothing about an airport is saved except the tiles** and old saves keep working.
It is cached per `map.airVer`, which goes up whenever airport tiles change (placing, removing, or the screen receiving tiles).
An airport with no stands is `legacy` (the old 3x3 one): its aircraft fly straight terminal to terminal as before.

## Aircraft movement (`src/shared/sim/network/airTraffic.ts`, `flightPath.ts`)
An aircraft's `flight` is a **polyline** `(x, y, z)` in tile coordinates (z = altitude, 0 on the ground) with a speed multiplier per segment.
Taxiing, the takeoff roll, the climb, the cruise, circling and the landing are parts of one polyline. The server moves `done` along it.
The screen receives the polyline once (when `flight.id` changes) and afterwards only `done` (`FlightMsg`), and works out the position itself (`planePos`).

- **Departure:** taxi from the stand (or hangar) to the end of a runway, line up, roll about 3/4 of the runway, lift off, climb, cruise to the **arrival fix** (18 tiles before the destination, on the line from the origin).
- **Runway windows:** each runway keeps reserved time windows (`busy`). A takeoff reserves its window when it sets off; if none is free it waits at its stand (`blocked`, retried). Windows never overlap, so a runway never has two aircraft.
- **Arrival:** at the fix the aircraft asks for a landing: a runway end whose window is free **and** a free stand. If it gets both, it flies the approach, lands, rolls out and taxis to the stand (one polyline). If not, it flies one lap of a circle (`HOLD_RADIUS` 3) and asks again.
- **Stands:** one aircraft each (`standOwner`). A stand is claimed when landing is cleared and released when the aircraft departs.
- The state (`stage`, the fix) and the reservations are **not saved**: after loading a save, aircraft in flight are put down at their destination and parked ones take their stand (`afterRestore`).
- Tuning constants are at the top of `airTraffic.ts`.

## Rules
- A small airport takes small aircraft only, a medium one up to medium, large and hub take all (`airportTakes`). Checked when buying an aircraft and when adding an airport to a route that has aircraft. Old 3x3 airports take everything.
- A depot goes on a hangar (or the old terminal) tile.
- Tests: `src/shared/sim/network/airTraffic.test.ts` (layouts, one aircraft per runway, stand limits, circling, reservations never overlap, small vs large throughput, class rules).

## Look
The tiles are drawn with sprites (`src/client/assets/airport.png`, made by `tools/airport-sprites/airportkit.py`; the piece for each tile is chosen from its four neighbours in `src/client/render/airportSprites.ts`). If the atlas does not load, the older drawing in `drawTile.ts` is used.
