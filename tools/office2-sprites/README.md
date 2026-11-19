# オフィススプライト(追加100種)の生成

`gen2.py`(`base.py` を読み込む)が、オフィス100種 × S/M/L の PNG(128x192)を作ります。Pillow が必要です。

```bash
cd tools/office2-sprites
python3 gen2.py          # sprites/ に300枚、sheets/ にプレビュー、office2_sprites.zip
```

ゲームが使うアトラス `src/assets/offices2.png`(15列×20行。種類 i は 行=⌊i/5⌋、列=(i%5)*3+S/M/L)は、
`sprites/office2_NNN_{S,M,L}.png` を並べて256色に減色して作ります(組み込み時の手順は HANDOVER.md を参照)。
