import os,sys,math,csv,zipfile
from PIL import Image,ImageDraw
W,H=128,192
im=d=px=None
def new():
    global im,d,px
    im=Image.new('RGBA',(W,H),(0,0,0,0));d=ImageDraw.Draw(im);px=im.load()
def mul(c,k): return tuple(max(0,min(255,int(v*k))) for v in c)
def lerp(a,b,t): return tuple(int(a[n]+(b[n]-a[n])*t) for n in range(3))
def hsh(a,b,c=0): return ((a*73856093)^(b*19349663)^(c*83492791))%1000
def put(x,y,c):
    x=int(x);y=int(y)
    if 0<=x<W and 0<=y<H: px[x,y]=(c[0],c[1],c[2],255)
def poly(p,f,o=None):
    o=o or mul(f,.55);d.polygon([(round(x),round(y)) for x,y in p],fill=(*f,255),outline=(*o,255))
def line(a,b,c): d.line([(round(a[0]),round(a[1])),(round(b[0]),round(b[1]))],fill=(*c,255))
def L2(a,b,t): return (a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t)
def ground(cc,hw,fn):
    hh=hw//2
    for dy in range(-hh,hh):
        for dx in range(-hw,hw):
            u=(dx+.5)/hw;v=(dy+.5)/hh
            if abs(u)+abs(v)<=1: put(64+dx,cc+dy,fn((u+v)/2,(v-u)/2,dx,dy))
def g_lawn(s,t,dx,dy):
    n=hsh(dx,dy);c=(78,124,58) if n>120 else (70,114,52)
    if n>960: c=(100,146,72)
    if max(abs(s),abs(t))>.47: c=(58,98,44)
    if abs(s-t)<.05 and s+t>.1: c=(176,164,140)
    return c
def g_plaza(s,t,dx,dy):
    n=5 if (dx+dy)%2==0 else 0
    if max(abs(s),abs(t))>.46: return (112,110,108)
    return mul((126,124,116),1+n/120)
def g_yard(s,t,dx,dy):
    n=hsh(dx,dy);c=(196,170,124) if n>140 else (186,160,116)
    if max(abs(s),abs(t))>.47: c=(120,104,78)
    r=math.hypot(s,t)
    if abs(r-.34)<.025: c=(240,236,226)
    return c
def g_court(s,t,dx,dy):
    n=5 if (dx+dy)%2==0 else 0
    if max(abs(s),abs(t))>.47: return (70,110,56)
    if max(abs(s),abs(t))>.40: return (84,128,66)
    return mul((178,174,162),1+n/120)
def g_pool(s,t,dx,dy):
    c=g_lawn(s,t,dx,dy)
    if -.42<s<-.06 and .02<t<.4: c=(70,150,204) if (dx+dy)%3 else (110,180,226)
    if (-.45<s<-.03 and .0<t<.43) and not(-.42<s<-.06 and .02<t<.4): c=(232,232,226)
    return c
GROUNDS={'lawn':g_lawn,'plaza':g_plaza,'yard':g_yard,'court':g_court,'pool':g_pool}
def face(cx,cy,n,h,side,st,seed,door=None,hole=None):
    n=int(round(n));h=int(round(h));k=st['kind'];ww=st['ww'];wh=st['wh']
    for i in range(n):
        x=cx-1-i if side=='l' else cx+i
        yb=cy-(i+1)//2;gx=i%ww
        for v in range(h):
            y=yb-v;base=lerp(st['bot'],st['top'],v/max(1,h-1));gy=v%wh;c=base
            if k=='glass':
                if gx==ww-1 or gy==wh-1: c=mul(base,.5)
                else:
                    h2=hsh(i//ww,v//wh,seed)
                    if h2<45: c=(255,206,110)
                    elif (i//ww+v//wh+seed)%9==0 and (i+v)%3==0: c=lerp(base,(255,255,255),.35)
                    else: c=mul(base,.82)
            elif k=='stripe':
                if gy>=wh-2: c=lerp(base,(255,255,255),.15)
                elif gx==ww-1: c=mul(base,.7)
                else: c=(255,206,110) if hsh(i//ww,v//wh,seed)<40 else mul(st['win'],.9)
            elif k=='concrete':
                if 1<=gx<=ww-3 and 1<=gy<=wh-3: c=(255,206,110) if hsh(i//ww,v//wh,seed)<50 else st['win']
                else: c=mul(base,.92) if gy==0 else base
            elif k=='lattice':
                if gx==ww-1 or gy==wh-1: c=lerp(base,(240,236,220),.3)
                else: c=(255,206,110) if hsh(i//ww,v//wh,seed)<60 else st['win']
            elif k=='columns':
                if v<3: c=lerp(base,(255,255,255),.25)
                elif v>=h-4: c=lerp(base,(255,255,255),.22) if v<h-1 else mul(base,.8)
                elif gx<2: c=lerp(base,(255,255,255),.35)
                else: c=(255,206,110) if (gx in(3,4) and 2<=gy<=wh-3 and hsh(i//ww,v//wh,seed)<70) else mul(base,.5)
            else:
                if k=='brick' and (v%3==2 or (i+(v//3)*2)%5==0): c=mul(base,.8 if v%3==2 else .9)
                if 2<=gx<=ww-3 and 2<=gy<=wh-3 and v>=1:
                    if gx in(2,ww-3) or gy in(2,wh-3): c=(240,236,220)
                    else: c=(255,206,110) if hsh(i//ww,v//wh,seed)<50 else st['win']
                elif gy==0 and k=='plaster': c=mul(base,.92)
            if door and side=='r' and door[0]<=i<door[1] and v<door[2]: c=(84,52,34) if v<door[2]-1 else mul(base,.7)
            if hole and hole[0]<=i<hole[1] and hole[2]<=v<hole[3]: c=(90,100,122) if (i==hole[0] or v==hole[2]) else (16,20,30)
            if side=='r': c=mul(c,.62)
            if i==0: c=lerp(c,(255,255,255),.3) if side=='l' else mul(c,.6)
            if i==n-1: c=mul(c,.55)
            if v==0: c=mul(c,.6)
            if v==h-1: c=lerp(c,(255,255,255),.25)
            put(x,y,c)
def box(cx,cy,L,R,h,st,seed=0,roof=(120,120,126),top=True,door=None,hole=None):
    L=int(round(L));R=int(round(R));h=int(round(h));cx=round(cx);cy=round(cy)
    face(cx,cy,L,h,'l',st,seed);face(cx,cy,R,h,'r',st,seed+1,door,hole)
    A=(cx,cy-h);B=(cx-L,cy-L/2-h);C=(cx-L+R,cy-L/2-R/2-h);D=(cx+R,cy-R/2-h);ctr=((A[0]+C[0])/2,(A[1]+C[1])/2)
    if top:
        poly([A,B,C,D],roof,mul(roof,.55));poly([(ctr[0]+(p[0]-ctr[0])*.72,ctr[1]+(p[1]-ctr[1])*.72) for p in (A,B,C,D)],mul(roof,.8),mul(roof,.62))
    return ctr
def sbox(cx,cy,L,R,h,col):
    poly([(cx,cy),(cx-L,cy-L/2),(cx-L,cy-L/2-h),(cx,cy-h)],col)
    poly([(cx,cy),(cx+R,cy-R/2),(cx+R,cy-R/2-h),(cx,cy-h)],mul(col,.64))
    poly([(cx,cy-h),(cx-L,cy-L/2-h),(cx-L+R,cy-L/2-R/2-h),(cx+R,cy-R/2-h)],mul(col,1.15))
def cyl(ctr,r,h,st,seed,taper=1.0,roof=(120,120,126)):
    cx,c0y=round(ctr[0]),round(ctr[1]);r=max(5,int(round(r)));h=int(round(h));wh=st['wh'];bays=max(7,int(r*1.1))
    for v in range(h):
        f=v/max(1,h-1);rv=r*(1-(1-taper)*f);base=lerp(st['bot'],st['top'],f)
        for dx in range(-int(rv),int(rv)+1):
            q=dx/rv
            if abs(q)>1: continue
            y=int(c0y-v+(rv/2)*math.sqrt(1-q*q));bf=(math.asin(q)/math.pi+.5)*bays;bay=int(bf);fr=bf-bay
            if fr<.2 or v%wh==wh-1: c=mul(base,.7)
            else: c=(255,206,110) if hsh(bay,v//wh,seed)<40 else mul(st['win'],.95)
            c=mul(c,1.12-.62*((dx+rv)/(2*rv)))
            if abs(dx)>=int(rv): c=mul(c,.6)
            put(cx+dx,y,c);put(cx+dx,y-1,c)
    rt=max(3,r*taper)
    d.ellipse([cx-rt,c0y-h-rt/2,cx+rt,c0y-h+rt/2],fill=(*roof,255),outline=(*mul(roof,.55),255))
    return (cx,c0y-h)
def pitched(cx,cy,L,R,h,r,col,typ,wallc):
    A=(cx,cy-h);B=(cx-L,cy-L/2-h);C=(cx-L+R,cy-L/2-R/2-h);D=(cx+R,cy-R/2-h)
    lc=col;rc=mul(col,.68);up=lambda p:(p[0],p[1]-r)
    if typ=='hip':
        ap=((A[0]+C[0])/2,(A[1]+C[1])/2-r);poly([A,B,ap],lc);poly([A,D,ap],rc)
        for t in(.25,.5,.75): line(L2(A,ap,t),L2(B,ap,t),mul(lc,.8));line(L2(A,ap,t),L2(D,ap,t),mul(rc,.8))
    elif typ=='gA':
        a=up(L2(A,B,.5));b=up(L2(D,C,.5));poly([A,B,a],wallc);poly([A,D,b,a],rc)
        for t in(.25,.5,.75): line(L2(A,a,t),L2(D,b,t),mul(rc,.8))
    else:
        a=up(L2(A,D,.5));b=up(L2(B,C,.5));poly([A,D,a],mul(wallc,.62));poly([A,B,b,a],lc)
        for t in(.25,.5,.75): line(L2(A,a,t),L2(B,b,t),mul(lc,.8))
def clockface(cx,cy,L,R,h):
    for (x,y) in((cx+R*.5,cy-R*.25-(h-9)),):
        d.ellipse([x-3,y-3,x+3,y+3],fill=(244,244,236,255),outline=(60,50,40,255));line((x,y),(x,y-2),(40,30,30));line((x,y),(x+2,y),(40,30,30))
def crown(kind,ctr,Lt):
    x,y=ctr
    if kind=='spire': poly([(x-2,y),(x+2,y),(x,y-30)],(150,150,158),(60,60,68));line((x,y-30),(x,y-40),(70,70,76))
    elif kind=='antenna': line((x,y),(x,y-24),(70,70,76));d.rectangle([x-3,y-5,x+2,y-2],fill=(120,120,124,255))
    elif kind=='dome' or kind=='gdome':
        r=max(8,int(Lt*.45));col=(150,172,196) if kind=='dome' else (214,176,80)
        d.ellipse([x-r,y-r*1.1,x+r,y+r*.35],fill=(*col,255),outline=(*mul(col,.5),255));d.ellipse([x-r*.6,y-r*.95,x-r*.1,y-r*.5],fill=(*lerp(col,(255,255,255),.5),255))
        line((x,y-r*1.1),(x,y-r*1.1-8),mul(col,.6))
    elif kind=='cupola':
        sbox(x,y+4,6,6,8,(236,232,220));pitched(x,y+4,6,6,8,7,(90,110,100),'hip',(236,232,220))
    elif kind=='flag':
        line((x,y),(x,y-22),(70,70,76));poly([(x,y-22),(x+10,y-19),(x,y-15)],(200,50,44),(110,20,20))
    elif kind=='green':
        for ox,oy in((-8,0),(6,2),(-1,-4)): d.ellipse([x+ox-4,y+oy-6,x+ox+4,y+oy+1],fill=(60,130,60,255),outline=(30,80,30,255))
    elif kind=='helipad':
        d.ellipse([x-9,y-4,x+9,y+4],outline=(235,235,235,255));line((x-3,y-2),(x-3,y+2),(235,235,235));line((x+3,y-2),(x+3,y+2),(235,235,235));line((x-3,y),(x+3,y),(235,235,235))
def B(L,h,R=None,**o): return dict(t='b',L=L,R=R or L,h=h,**o)
def C(r,h,**o): return dict(t='c',r=r,h=h,**o)
def LIFT(h): return dict(t='lift',h=h)
def S(parts,off=(0,0),z=None,crown=True): return dict(parts=parts,off=off,z=z,crown=crown)
KW={'glass':((5,5),(4,4)),'stripe':((8,5),(8,4)),'concrete':((8,6),(7,5)),'lattice':((4,4),(4,4)),'brick':((8,10),(7,9)),'plaster':((8,10),(7,9)),'columns':((8,10),(7,9))}
def mkst(pal,kind,big):
    ww,wh=KW[kind][0 if big else 1];glass=kind in('glass','lattice','stripe')
    return {'kind':kind,'top':mul(pal,1.1) if glass else pal,'bot':mul(pal,.6) if glass else mul(pal,.94),'win':(120,172,206) if not glass else mul(pal,.8),'ww':ww,'wh':wh}
SC={'S':(.46,.5),'M':(.6,.72),'L':(1,1)}
def render(stacks,pal,kind,size,gk,cr,ex,seed):
    new();fs,hs=SC[size];big=size=='L';hw=64 if big else 32;ground(150,hw,GROUNDS[gk]);st0=mkst(pal,kind,big)
    stacks=sorted(stacks,key=lambda s:(s['z'] if s['z'] is not None else s['off'][1],s['off'][0]))
    if ex.get('tree'):
        for tx,ty in((64-hw+13,153),(64+hw-13,153)) if not big else((12,150),(116,150),(40,178),(88,178)):
            d.rectangle([tx-1,ty,tx,ty+5],fill=(96,60,36,255));d.ellipse([tx-5,ty-9,tx+5,ty+3],fill=(56,120,48,255),outline=(30,70,30,255))
    for si,sk in enumerate(stacks):
        ctr=(64+sk['off'][0]*fs,150+sk['off'][1]*fs);lastL=20
        for n,p in enumerate(sk['parts']):
            ctr=(ctr[0]+p.get('dx',0)*fs,ctr[1]+p.get('dy',0)*fs)
            if p['t']=='lift': ctr=(ctr[0],ctr[1]-p['h']*hs);continue
            st=dict(st0)
            if p.get('kind'):
                st=mkst(pal,p['kind'],big)
            if p['t']=='b':
                L=max(5,p['L']*fs);R=max(5,p['R']*fs);h=max(3,p['h']*hs);cx=ctr[0]-(R-L)/2;cy=ctr[1]+(L+R)/4
                dr=None
                if p.get('door'): dr=(int(R/2-3),int(R/2+3),9 if big else 6)
                ho=p.get('hole');ho=(int(R*ho[0]),int(R*ho[1]),int(h*ho[2]),int(h*ho[3])) if ho else None
                rf=p.get('roof');rc=p.get('rc',(120,120,126))
                c2=box(cx,cy,L,R,h,st,seed+n+si*3,roof=rc,top=not rf,door=dr,hole=ho)
                if rf: pitched(round(cx),round(cy),round(L),round(R),round(h),rf[2]*hs if rf[2]>3 else rf[2],rf[1],rf[0],st['top'])
                if p.get('clock'): clockface(round(cx),round(cy),round(L),round(R),round(h))
                ctr=c2;lastL=max(L,R)
            else:
                ctr=cyl(ctr,p['r']*fs,max(4,p['h']*hs),st,seed+n,p.get('taper',1.0),p.get('rc',(120,120,126)));lastL=p['r']*fs*2
        if sk['crown'] and cr!='none': crown(cr,ctr,lastL)
    if ex.get('flag'):
        fx=64+hw-18 if big else 64+hw-9;fy=150+(6 if not big else 14);line((fx,fy),(fx,fy-26),(80,80,86));poly([(fx,fy-26),(fx+9,fy-23),(fx,fy-19)],(210,56,48),(110,20,20))
    return im.copy()
def export(name,n,sprite_fn,label_fn,csv_rows,header):
    out=os.path.join(os.path.dirname(os.path.abspath(__file__)),name+'_out');os.makedirs(out+'/sprites',exist_ok=True);os.makedirs(out+'/sheets',exist_ok=True)
    rows=(n+4)//5;full=Image.new('RGBA',(W*15,H*rows),(0,0,0,0))
    for k in range(n):
        for si,s in enumerate('SML'): full.paste(sprite_fn(k,s),((k%5*3+si)*W,(k//5)*H))
    q=full.quantize(colors=255,method=Image.FASTOCTREE,dither=Image.NONE);tr=q.getpixel((0,0))
    zf=zipfile.ZipFile(out+f'/{name}_sprites.zip','w')
    for k in range(n):
        for si,s in enumerate('SML'):
            x=(k%5*3+si)*W;y=(k//5)*H;p=out+f'/sprites/{name}_{k+1:03d}_{s}.png';q.crop((x,y,x+W,y+H)).save(p,transparency=tr);zf.write(p,f'{name}_{k+1:03d}_{s}.png')
    zf.close()
    csv.writer(open(out+f'/{name}_list.csv','w',newline='',encoding='utf-8-sig')).writerows([header]+csv_rows)
    per=25
    for sh in range((n+per-1)//per):
        r0=sh*per//5;r1=min(rows,r0+5);cr_=q.crop((0,r0*H,W*15,r1*H));cr_.save(out+f'/sheets/{name}_sheet{sh+1}_8bit.png',transparency=tr)
        rg=cr_.convert('RGBA');bg=Image.new('RGB',rg.size,(30,34,48));bg.paste(rg,(0,0),rg);pd=ImageDraw.Draw(bg)
        for k in range(per):
            idx=sh*per+k
            if idx>=n: break
            x=k%5*3*W;y=k//5*H;pd.rectangle([x,y,x+3*W-1,y+H-1],outline=(70,76,96));pd.text((x+4,y+3),label_fn(idx),fill=(200,205,220))
        bg.save(out+f'/sheets/{name}_preview{sh+1}.png')
    cols=10;ov=Image.new('RGB',(cols*77,((n+cols-1)//cols)*115),(30,34,48));rg=q.convert('RGBA')
    for k in range(n):
        x=(k%5*3+2)*W;y=(k//5)*H;c=rg.crop((x,y,x+W,y+H)).resize((77,115),Image.NEAREST);ov.paste(c,((k%cols)*77,(k//cols)*115),c)
    ov.save(out+f'/{name}_overview_L.png');print('出力先:',out)
HPAL=[(236,232,220),(214,196,160),(190,98,70),(176,176,182),(150,190,220),(130,190,170),(232,220,190),(120,170,150),(200,170,110),(150,160,176)]
HR=[(196,98,52),(84,90,104),(96,66,52),(70,120,80),(70,100,150),(170,50,44),(130,130,134)]
NAMES=['古典主義+ドーム','時計塔の町役場','モダンスラブ','ピロティ庁舎','ブルータリズム段','円形ロトンダ','左右対称ウイング','コの字中庭','ゴシック尖塔','アールデコ庁舎','コロニアル煉瓦','ガラスキューブ','ポディウム+高層塔','ジグラート庁舎','アーチ門型ホール','階段状ゲーブル','曲面ウイング','城郭風','エコ庁舎(緑化)','複合キャンパス']
FF=[.9,1,1.1,.95,1.05]
CLASSIC=(0,1,5,6,7,8,10,15,17)
def layout(a,j,rc):
    f=FF[j];r2=HR[(a*3+j*2+2)%7]
    if a==0: return [S([B(54,26,R=34,kind='columns'),B(28,14*f,R=28,kind='plaster')])]
    if a==1: return [S([B(50,28,R=28,roof=('hip',rc,10)),B(16,34*f,R=16,roof=('hip',r2,13),clock=True)])]
    if a==2: return [S([B(56,38*f,R=26)],off=(-8,-6)),S([B(28,12,R=28,kind='concrete',door=True)],off=(18,10),crown=False)]
    if a==3:
        p=[S([B(3,14,kind='concrete')],off=o,z=-50,crown=False) for o in((-24,-4),(24,-4),(0,-14))]
        p+=[S([B(3,14,kind='concrete')],off=o,z=50,crown=False) for o in((-24,6),(24,6),(0,14))]
        return p+[S([B(16,60*f,R=16,kind='lattice')],off=(0,-14),z=-60,crown=True),S([LIFT(14),B(44,22,R=44,kind='lattice')],crown=False)]
    if a==4: return [S([B(56,20,R=36),B(44,16*f,R=28),B(32,14,R=20)])]
    if a==5: return [S([C([30,26,32,28,24][j],8),C([24,20,26,22,18][j],30*f,taper=[.9,1,.8,.95,1][j])])]
    if a==6: return [S([B(28,40*f,R=28,roof=('hip',rc,12),clock=(j%2==0))],off=(0,-6)),S([B(26,24,R=18)],off=(-24,6),crown=False),S([B(18,24,R=26)],off=(24,6),crown=False)]
    if a==7: return [S([B(14,26,R=36)],off=(-24,-2),crown=False),S([B(36,26,R=14)],off=(24,-2),crown=False),S([B(30,30*f,R=30,kind='columns',clock=(j%2==0))],off=(0,-20))]
    if a==8: return [S([B(22,60*f,R=22),B(16,26,R=16)],off=(8,-6)),S([B(40,22,R=24)],off=(-14,8),crown=False)]
    if a==9: return [S([B(54,30*f),B(40,22,R=40),B(28,16,R=28),B(18,10,R=18)])]
    if a==10: return [S([B(50,26,R=28,roof=('hip',rc,10),door=True)]),S([B(18,14,R=10,kind='columns')],off=(14,10),crown=False)]
    if a==11: return [S([B(40,46*f,R=40)]),S([B(18,14,R=18,kind='concrete')],off=(18,12),crown=False)]
    if a==12: return [S([B(58,16,R=50,kind='concrete'),B(26,70*f,R=26,kind='glass')])]
    if a==13: return [S([B(58-k*12,12*f,R=58-k*12) for k in range(4)])]
    if a==14: return [S([B(54,34*f,R=30,hole=[(.28,.72,.1,.6),(.2,.8,.2,.7),(.3,.7,.1,.8),(.25,.75,.3,.75),(.35,.65,.15,.65)][j])])]
    if a==15: return [S([B(48,24*f,R=26),B(34,10,R=18),B(22,8,R=12)])]
    if a==16: return [S([B(26,36*f,R=26)],off=(0,-8)),S([C(18,30)],off=(-24,4),crown=False),S([C(18,30)],off=(24,4),crown=False)]
    if a==17:
        t=[S([LIFT(16),C(8,34)],off=o,crown=False) for o in((-28,0),(28,0),(0,-14),(0,14))]
        return [S([B(56,16,R=56,kind='brick')],z=-99,crown=False)]+t+[S([LIFT(16),B(24,40*f,R=24,roof=('hip',rc,12))],z=1)]
    if a==18: return [S([B(54,24*f,R=30)],off=(-6,-6)),S([B(40,12,R=24,kind='concrete')],off=(14,10))]
    return [S([B(26,50*f,R=26)],off=(0,-16)),S([B(26,34,R=26)],off=(-32,0),crown=False),S([B(26,40,R=26)],off=(32,0),crown=False),S([B(30,22,R=30)],off=(0,16),crown=False)]
CLS=['plaster','brick','columns','brick','plaster'];MOD=['glass','stripe','concrete','lattice','glass']
CRL=['flag','dome','gdome','cupola','spire','antenna','none','helipad','green']
DEFC={0:['dome','gdome','dome','cupola','gdome'],5:['dome','gdome','dome','gdome','cupola'],8:['spire']*5,9:['spire','flag','spire','antenna','spire'],16:['dome','gdome','flag','dome','none'],17:['flag']*5,18:['green','green','helipad','green','green'],13:['flag','none','flag','antenna','flag']}
def design(k):
    a,j=divmod(k,5);pal=HPAL[(a*7+j*3+j*j)%10];rc=HR[(a*3+j*2)%7]
    kind=(CLS if a in CLASSIC else MOD)[(a+j*2)%5]
    cr=DEFC[a][j] if a in DEFC else (['flag','cupola','dome','gdome','none'] if a in CLASSIC else ['flag','antenna','helipad','green','none'])[(a+j*3)%5]
    if a in(1,6,10): cr=['flag','cupola','flag','none','cupola'][j]
    gk='court' if a in CLASSIC or a in(4,13) else 'plaza'
    return a,j,pal,kind,gk,cr,layout(a,j,rc)
def sprite(k,s):
    a,j,pal,kind,gk,cr,st=design(k);return render(st,pal,kind,s,gk,cr,{'tree':(a+j)%3!=0,'flag':j%2==0 and a not in(17,)},k*7)
def label(k): a,j=divmod(k,5);return f'{k+1:03d}  type{a+1}-{j+1}'
if __name__=='__main__':
    rows=[]
    for k in range(100):
        a,j,pal,kind,gk,cr,st=design(k);rows.append([k+1,NAMES[a],j+1,kind,gk,cr,f'sheet{k//25+1}'])
    export('cityhall',100,sprite,label,rows,['id','type','variant','facade','ground','crown','sheet'])
