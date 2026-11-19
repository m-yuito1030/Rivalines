# バス・航空機スプライトの生成

`bus.py`(250種)と `aircraft.py`(100種)を `python3 bus.py` / `python3 aircraft.py` で実行すると、`*_out/vehicles/` に8方向を横に並べた帯
(バス 72x64px x8、航空機 112x104px x8)を出力します(Pillow が必要)。方向 k は 0=+u(画面右下) から45度ずつ(ゲームの dirIndex と同じ)。
ゲームが使うアトラス `src/assets/bus.png`(1行に5種)/`aircraft.png`(1行に3種)は、帯を並べて256色に減色したものです。
原点(車両の地面位置)はバス (36,38)、航空機 (56,66)。
