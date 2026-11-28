"""Packs the housing-complex designs into one atlas for the game (src/client/assets/danchi.png).
Input: the two packs (unzipped): danchi_20_pack (sprites/danchi_NN_M.png) and residential_100_pack (apartment_out/sprites/apartment_NN_M.png, mansion_out/sprites/mansion_NN_M.png).
Only the M size is used: 128 x 184 px, the footprint of a 2x2-tile block (the lawn diamond is 128 px wide; its centre is at (64,143)).
Order of the 120 designs: danchi 1-20, apartment 1-50, mansion 1-50. Design number i sits at column i % COLS, row i // COLS.
Usage: python3 build_danchi_atlas.py <danchi pack dir> <residential pack dir> <output png>
"""
import os,sys
from PIL import Image
CW,CH,COLS=128,184,10
def main(danchi,resi,out):
    files=[os.path.join(danchi,'sprites',f'danchi_{i:02d}_M.png') for i in range(1,21)]
    files+=[os.path.join(resi,'apartment_out','sprites',f'apartment_{i:02d}_M.png') for i in range(1,51)]
    files+=[os.path.join(resi,'mansion_out','sprites',f'mansion_{i:02d}_M.png') for i in range(1,51)]
    rows=(len(files)+COLS-1)//COLS
    atlas=Image.new('RGBA',(COLS*CW,rows*CH),(0,0,0,0))
    for i,f in enumerate(files):
        im=Image.open(f).convert('RGBA')
        assert im.size==(CW,CH),(f,im.size)
        atlas.paste(im,((i%COLS)*CW,(i//COLS)*CH))
    # Only about 2,400 distinct colours: keep full colour (no palette reduction), so the designs look exactly as drawn
    atlas.save(out,optimize=True)
    print('designs',len(files),'atlas',atlas.size,os.path.getsize(out),'bytes')
if __name__=='__main__': main(*sys.argv[1:4])
