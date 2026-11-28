"""Packs the 30 subway designs (made by subway.py) into one atlas, like build_train_atlas.py does for the other trains.
Usage: python3 build_subway_atlas.py <output png> <output json>
Design numbers in the JSON are 1000 + d (d = 0..29), so they never collide with the other rail designs (0..449).
"""
import json,os,sys
from PIL import Image
import subway
CW,CH,OX,OY=96,76,48,46
SRC=os.path.join(os.path.dirname(os.path.abspath(__file__)),'subway_out','vehicles')
def main(out_png,out_json):
    frames=[]
    for d in range(30):
        for role,idx in (('h',2*d+1),('m',2*d+2)):
            strip=Image.open(os.path.join(SRC,f'subway_{idx:03d}.png')).convert('RGBA')
            for k in range(8):
                cell=strip.crop((k*CW,0,(k+1)*CW,CH));bb=cell.getbbox();frames.append((d,role,k,cell.crop(bb),bb))
    order=sorted(range(len(frames)),key=lambda i:(-frames[i][3].height,-frames[i][3].width))
    W=1024;x=y=rowh=0;pos={}
    for i in order:
        w,h=frames[i][3].size
        if x+w+1>W: x=0;y+=rowh+1;rowh=0
        pos[i]=(x,y);x+=w+1;rowh=max(rowh,h)
    H=y+rowh+1;atlas=Image.new('RGBA',(W,H),(0,0,0,0));meta={}
    for i,(d,role,k,im,bb) in enumerate(frames):
        px,py=pos[i];atlas.paste(im,(px,py))
        L=subway.BODIES[subway.DESIGNS[d][6]]['L']
        e=meta.setdefault(str(1000+d),{'sc':round(min(0.42,20.0/(L+0.6)),3),'h':[None]*8,'m':[None]*8})
        e[role][k]=[px,py,im.width,im.height,OX-bb[0],OY-bb[1]]
    q=atlas.quantize(colors=255,method=Image.FASTOCTREE,dither=Image.NONE);tr=q.getpixel((0,0))
    q.save(out_png,transparency=tr,optimize=True)
    json.dump({'names':[d[0] for d in subway.DESIGNS],'designs':meta},open(out_json,'w'),separators=(',',':'),ensure_ascii=False)
    print('frames',len(frames),'atlas',(W,H),os.path.getsize(out_png),'json',os.path.getsize(out_json))
if __name__=='__main__': main(sys.argv[1],sys.argv[2])
