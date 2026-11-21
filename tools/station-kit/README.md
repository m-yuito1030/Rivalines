# 駅キット(station-kit)

`stationkit.py` は駅のタイル素材(64x64)を作る生成スクリプト(80様式 = 基本20 × 変種4)。
`build_station_atlas.py` が、ゲーム用のアトラスと寸法の JSON を作る。

```
python3 build_station_atlas.py ../../src/client/assets ../../src/shared/data/stationKit.json
```

- `station0.png`〜`station3.png`: 変種(標準・別色・ダーク・雪景色)ごと。列 = ピース*2+層(0=地面 1=屋根・駅舎・跨線橋)、行 = 様式*2+軸。
- 地面と上の物を別の層にしてあるのは、列車を「地面の上・屋根の下」に描くため(`src/client/render/stationSprites.ts`)。
- ゲーム内のデザイン番号は 100〜179(0〜99 は従来の手続き描画で、セーブ済みの駅用)。
