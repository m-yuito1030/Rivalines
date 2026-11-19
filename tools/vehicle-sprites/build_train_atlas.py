"""鉄道スプライトのアトラス作成。
train.py が出した train_out/vehicles/train_NNN.png(900本: デザイン d の先頭車=2d+1番、中間車=2d+2番。各8方向・96x76px)から、
ゲームの鉄道車種(190種)に割り当てる190デザインだけを取り出し、余白を切り詰めて1枚のアトラスに詰め、
フレーム情報(JSON)を書き出す。使い方: python3 build_train_atlas.py <train_out の親ディレクトリ> <出力先 src/assets と src/data>
"""
import json,math,os,sys
from PIL import Image
CW,CH,OX,OY=96,76,48,46
# train.py の型の順(0..29)。デザイン番号 = 型*15 + 色違い(0..14)
# 車種の種別ごとの台数と、使う型の候補(src/data/models.ts の KINDS と同じ順・同じ台数)
KINDS=[('単行',20,[24,23,13,25,26]),('路面電車',15,[13,25,29,14]),('ローカル',25,[23,5,4,28,26]),('通勤',34,[0,1,20,2,5]),
       ('近郊',29,[2,3,27,28]),('快速',20,[3,19,27,21,2]),('特急',19,[6,7,22,19,16]),('高速',10,[8,9,10,17,18]),('地下鉄',10,[11,12]),('観光',8,[15,16,7])]
TYPE_LEN=[44,44,46,46,42,42,50,50,56,48,54,40,40,28,40,38,48,50,60,46,44,48,46,34,36,26,30,44,44,42]
def design_lists():
    """種別ごとに、型の候補を順に使い、同じ型が続くときは色違いを進める。使い切った型は飛ばし、全体で重複しないようにする"""
    used=set();out={}
    for ki,(kind,n,pool) in enumerate(KINDS):
        lst=[]
        for j in range(n):
            want=None
            base_v=(j//len(pool)+ki*4)%15
            for off in range(len(pool)):                      # 候補の型を j から順に
                t=pool[(j+off)%len(pool)]
                for dv in range(15):
                    d=t*15+(base_v+dv)%15
                    if d not in used: want=d;break
                if want is not None: break
            if want is None:                                    # 候補の型が全部埋まっていたら、未使用の任意のデザイン
                want=next(d for d in range(450) if d not in used)
            used.add(want);lst.append(want)
        out[kind]=lst
    return out
def main(src,out_png,out_json):
    lists=design_lists();ids=sorted({d for l in lists.values() for d in l})
    frames=[]  # (design, role, dir, image, bbox)
    for d in ids:
        for role,idx in (('h',2*d+1),('m',2*d+2)):
            strip=Image.open(os.path.join(src,'train_out','vehicles',f'train_{idx:03d}.png')).convert('RGBA')
            for k in range(8):
                cell=strip.crop((k*CW,0,(k+1)*CW,CH));bb=cell.getbbox()
                frames.append((d,role,k,cell.crop(bb),bb))
    # 棚詰め(高さの大きい順)
    order=sorted(range(len(frames)),key=lambda i:(-frames[i][3].height,-frames[i][3].width))
    W=2048;x=y=rowh=0;pos={}
    for i in order:
        w,h=frames[i][3].size
        if x+w+1>W: x=0;y+=rowh+1;rowh=0
        pos[i]=(x,y);x+=w+1;rowh=max(rowh,h)
    H=y+rowh+1;atlas=Image.new('RGBA',(W,H),(0,0,0,0))
    meta={}
    for i,(d,role,k,im,bb) in enumerate(frames):
        px,py=pos[i];atlas.paste(im,(px,py))
        e=meta.setdefault(str(d),{'sc':round(min(0.42,20.0/(TYPE_LEN[d//15]+0.6)),3),'h':[None]*8,'m':[None]*8})
        e[role][k]=[px,py,im.width,im.height,OX-bb[0],OY-bb[1]]
    q=atlas.quantize(colors=255,method=Image.FASTOCTREE,dither=Image.NONE);tr=q.getpixel((0,0))
    q.save(out_png,transparency=tr,optimize=True)
    json.dump({'kinds':lists,'designs':meta},open(out_json,'w'),separators=(',',':'))
    print('designs',len(ids),'frames',len(frames),'atlas',(W,H),os.path.getsize(out_png),'json',os.path.getsize(out_json))
if __name__=='__main__': main(sys.argv[1],sys.argv[2],sys.argv[3])
