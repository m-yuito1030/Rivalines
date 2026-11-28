# 団地(大きな集合住宅)の絵

`src/client/assets/danchi.png` は、団地の区画に建つ大きな建物(2x2タイル)の絵を1枚にまとめたものです。120種。

- 元の絵: `danchi_20_pack`(団地 20 種)と `residential_100_pack`(`apartment_out` 50 種・`mansion_out` 50 種)の、M サイズ(128x184)。
- 並び順: 団地 1〜20、アパート 1〜50、マンション 1〜50。デザイン番号 i は、右へ 10 枚ずつ、i % 10 列・i / 10 行目。
- 作り直し: 2つのパックを解凍して `python3 build_danchi_atlas.py <団地のフォルダ> <residential のフォルダ> ../../src/client/assets/danchi.png`(Pillow が必要)。
- ゲームでの使われ方: 団地の区画の建物には、建物の絵の番号(variant)に `DANCHI_VARIANT`(31)が付く。描くときに、タイルごとの乱数で 120 種から1つを選ぶ(`src/client/render/buildingSprites.ts` の `danchiDesignOf`)。
- 絵の中心: 芝生のひし形の中心が (64,143)。
