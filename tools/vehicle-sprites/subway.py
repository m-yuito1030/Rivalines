"""Generates the 30 subway train designs (8-direction sprites, same renderer as train.py).
Each design = a body type (a low, tube-like subway body, no pantograph) + a colour scheme (body, two band colours, front colour, band layout).
Usage: python3 subway.py   -> writes subway_out/vehicles/subway_NNN.png (lead car = 2d+1, middle car = 2d+2 for design d = 0..29) and an overview image.
Then build_subway_atlas.py packs them into src/client/assets/subway.png and src/shared/data/subwayDesigns.json.
"""
import math,os
from PIL import Image
import train as tr

def T(name,L,W,H,front,rd,doors,win): return dict(name=name,L=L,W=W,H=H,front=front,rd=rd,doors=doors,win=win,pan=False)
# Body types (indexes 0..5)
BODIES=[T('角型',40,9,11.4,'flat',.1,4,'pair'),T('丸屋根',40,9,11.6,'round',.8,4,'pair'),T('大窓',42,9,11.4,'slope',.2,4,'big'),
        T('流線',42,9,11.2,'bullet',.5,4,'band'),T('小型',34,8.4,10.8,'round',.9,3,'big'),T('帯窓角型',40,9,11.4,'flat',.3,4,'band')]
W_=(244,244,246);K=(28,30,36)
# name, body, band 1, band 2, front colour, band layout (train.py style 0..5), body type
DESIGNS=[
 ('白銀',(196,202,210),(40,96,176),(120,170,230),(196,202,210),0,0),
 ('藍染',(36,56,110),W_,(120,150,210),(36,56,110),0,2),
 ('朝霧',(238,238,232),(150,200,226),(196,222,238),(238,238,232),1,1),
 ('若草',W_,(60,170,90),(150,210,120),W_,4,3),
 ('夕焼け',W_,(232,120,36),(200,40,40),(232,120,36),1,5),
 ('黒曜',(30,32,40),(214,170,50),(150,120,40),(30,32,40),0,0),
 ('桜',W_,(240,160,190),(250,205,222),W_,2,4),
 ('銅',(176,106,66),(80,48,34),(222,176,130),(176,106,66),0,1),
 ('群青',(40,96,200),W_,(20,60,130),(40,96,200),3,2),
 ('月光',(240,226,160),(30,50,110),(110,130,190),(240,226,160),0,3),
 ('翡翠',(40,150,140),W_,(20,100,100),(40,150,140),2,5),
 ('珊瑚',(236,124,110),W_,(190,70,60),(236,124,110),0,0),
 ('夜行',(24,34,70),(250,214,60),(200,160,30),(24,34,70),0,1),
 ('雪華',(248,250,252),(170,200,230),(120,160,210),(248,250,252),5,2),
 ('琥珀',(206,144,50),W_,(130,86,30),(206,144,50),1,3),
 ('紫苑',(186,160,222),(100,60,160),(70,40,120),(186,160,222),0,4),
 ('檸檬',(240,214,50),K,(70,70,76),(240,214,50),0,5),
 ('鉛',(142,148,156),(200,40,40),(90,94,100),(142,148,156),0,0),
 ('波紋',(130,200,232),W_,(40,120,190),(130,200,232),5,1),
 ('菖蒲',W_,(110,80,180),(60,150,100),W_,1,2),
 ('煉瓦',(168,78,58),(236,218,176),(110,50,40),(168,78,58),0,3),
 ('星屑',(26,40,96),(210,222,250),(100,120,190),(26,40,96),5,4),
 ('若竹',(168,214,150),(40,120,70),(90,170,100),(168,214,150),4,5),
 ('陽だまり',(244,232,190),(240,190,40),(232,130,36),(244,232,190),1,0),
 ('灯台',W_,(200,40,40),(24,40,100),W_,2,1),
 ('水晶',(210,236,248),(140,200,230),(90,160,210),(210,236,248),0,2),
 ('錦',(200,40,40),(222,176,50),(50,140,80),(200,40,40),5,3),
 ('墨流し',(236,236,232),(40,42,50),(120,124,132),(236,236,232),5,4),
 ('蛍',(26,70,52),(170,220,60),(110,170,40),(26,70,52),0,5),
 ('虹',W_,(232,70,60),(70,140,220),W_,5,0),
]
assert len(DESIGNS)==30
# j encodes the design to livery(): j = 6*d + band layout, so that train.py's j%6 gives the band layout
def liv(a,j):
    d=j//6;_,body,b1,b2,fc,_s,_t=DESIGNS[d];return body,b1,b2,fc
tr.livery=liv
def jof(d): return 6*d+DESIGNS[d][5]
def model(i,k):
    d,c=divmod(i,2);sp=BODIES[DESIGNS[d][6]]
    return tr.render(tr.car(sp,jof(d),0,c==0),k*math.pi/4,96,76,48,46)
def label(i): d,c=divmod(i,2);return f'{d+1:02d}{"H" if c==0 else "M"} {DESIGNS[d][0]}'
if __name__=='__main__':
    rows=[[d+1,DESIGNS[d][0],BODIES[DESIGNS[d][6]]['name']] for d in range(30)]
    tr.export_veh('subway',60,96,76,model,label,rows,['id','name','body'],__doc__,ov=range(0,60,2),ov_cols=10,rows_per_sheet=30)
    out=os.path.join(os.path.dirname(os.path.abspath(__file__)),'subway_out');cols=3;cw,ch=250,130;sm=Image.new('RGB',(cols*cw,10*ch),(30,34,48))
    for d in range(30):
        sp=BODIES[DESIGNS[d][6]];h=tr.car(sp,jof(d),0,True);m=tr.car(sp,jof(d),0,False);L=sp['L']+.6;tot=4*L;P=[]
        for n in range(4):
            x=tot/2-L/2-n*L
            P+=tr.place(h,x) if n==0 else (tr.place(h,x,True) if n==3 else tr.place(m,x))
        im_=tr.render(P,0,cw,ch,cw//2,74);sm.paste(im_,((d%cols)*cw,(d//cols)*ch),im_)
    sm.save(out+'/subway_formation_samples.png')
