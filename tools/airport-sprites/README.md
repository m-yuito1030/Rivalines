# Airport sprites

`airportkit.py` draws the airport pieces (runway, taxiway, apron, stand, terminal, control tower, hangar, fence, jet bridge) as pixel art with Pillow
and packs them into one atlas (64 x 96 per cell) and a JSON list of the cell names.

```
python3 airportkit.py ../../src/client/assets/airport.png ../../src/shared/data/airportKit.json [preview.png]
```

The game picks the piece for each tile from its four neighbours (`src/client/render/airportSprites.ts`). If the atlas fails to load, the older drawing in `drawTile.ts` is used.
