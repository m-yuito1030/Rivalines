# 学校・市役所スプライトの生成

`school.py`(20種)と `cityhall.py`(100種)を `python3 school.py` / `python3 cityhall.py` で実行すると、
`*_out/sprites/` に S/M/L の PNG(128x192)を出力します(Pillow が必要)。
ゲームが使うアトラス `src/assets/school.png` / `cityhall.png`(15列×N行。種類 i は 行=⌊i/5⌋、列=(i%5)*3+S/M/L)は、
それらを並べて256色に減色したものです。
