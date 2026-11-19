import math,csv,zipfile,os
exec(open('base.py').read())
OP2=[((96,176,166),(18,64,76)),((136,126,196),(34,30,78)),((176,116,82),(62,36,32)),((206,214,228),(86,96,128)),((104,140,200),(26,44,96)),((158,160,168),(58,60,72)),((176,126,160),(64,36,70)),((124,170,128),(30,66,52)),((190,176,150),(110,98,84)),((100,110,130),(20,24,34)),((120,200,220),(24,84,110)),((210,170,100),(92,64,34)),
((220,224,232),(120,128,146)),((120,126,140),(30,32,42)),((186,100,78),(100,50,40)),((150,200,235),(56,100,160)),((150,160,110),(60,68,40)),((232,230,222),(150,148,140)),((120,180,160),(50,90,80)),((196,150,96),(84,54,30))]
KIND2=['glass','stripe','concrete','fins','diagrid','mirror','lattice']
def face(cx,cy,n,h,side,st,seed,gr=False,pleat=0,lean=0.0,band=None,hole=None):
    n=int(round(n));h=int(round(h));k=st['kind'];ww=st['ww'];wh=st['wh']
    for i in range(n):
        yb=cy-(i+1)//2;gx=i%ww
        for v in range(h):
            x=(cx-1-i if side=='l' else cx+i)+round(v*lean)
            y=yb-v;base=lerp(st['bot'],st['top'],v/max(1,h-1));gy=v%wh;c=base
            if gr and v<5: c=(255,196,100) if (hsh(i//4,0,seed)<550 and i%4<3 and 0<v<4) else (44,38,40)
            elif k=='glass':
                if gx==ww-1 or gy==wh-1: c=mul(base,.5)
                else:
                    h2=hsh(i//ww,v//wh,seed)
                    if h2<45: c=(255,206,110)
                    elif (i//ww+v//wh+seed)%9==0 and (i+v)%3==0: c=lerp(base,(255,255,255),.35)
                    else: c=mul(base,.82)
                    if (i+v)%2==0 and h2>=45: c=mul(c,1.06)
            elif k=='stripe':
                if gy>=wh-2: c=mul(base,.58)
                elif gx==ww-1: c=mul(base,.7)
                else: c=(255,206,110) if hsh(i//ww,v//wh,seed)<40 else mul(base,.8)
            elif k=='concrete':
                if 1<=gx<=ww-3 and 1<=gy<=wh-3: c=(255,206,110) if hsh(i//ww,v//wh,seed)<60 else mul(st['win'],.8)
                else: c=mul(base,.92) if gy==0 else base
            elif k=='fins':
                if i%3==0: c=mul(base,.45)
                elif gy==wh-1: c=mul(base,.6)
                else: c=(255,206,110) if hsh(i//3,v//wh,seed)<35 else mul(base,.85)
            elif k=='diagrid':
                if (i+v)%12<2 or (i-v)%12<2: c=lerp(base,(235,235,240),.28)
                else: c=(255,206,110) if hsh(i//3,v//3,seed)<30 else mul(base,.78)
            elif k=='mirror':
                c=mul(base,.92)
                if (i*2+v)%27<3: c=lerp(c,(255,255,255),.35)
                if i%14==13 or v%10==9: c=mul(c,.65)
                if hsh(i//14,v//10,seed)<40: c=(255,206,110)
            else:
                if gx==ww-1 or gy==wh-1: c=lerp(base,(240,236,220),.3)
                else: c=(255,206,110) if hsh(i//ww,v//wh,seed)<60 else mul(st['win'],.95)
            if pleat: c=mul(c,1.14) if (i//pleat)%2==0 else mul(c,.84)
            if band and band[0]<=v<band[1]: c=lerp(c,(255,236,170),.6) if i%4<3 else mul(c,.6)
            if hole and hole[0]<=i<hole[1] and hole[2]<=v<hole[3]:
                c=(90,100,122) if (i==hole[0] or v==hole[2]) else (16,20,30)
            if side=='r': c=mul(c,.62)
            if i==0: c=lerp(c,(255,255,255),.3) if side=='l' else mul(c,.6)
            if i==n-1: c=mul(c,.55)
            if v==0: c=mul(c,.6)
            if v==h-1: c=lerp(c,(255,255,255),.25)
            put(x,y,c)
def box(cx,cy,L,R,h,st,seed=0,roof=(104,106,114),gr=False,slant=0,wedge=False,pleat=0,lean=0.0,band=None,hole=None):
    L=int(round(L));R=int(round(R));h=int(round(h));cx=round(cx);cy=round(cy)
    face(cx,cy,L,h,'l',st,seed,gr,pleat,lean,band);face(cx,cy,R,h,'r',st,seed+1,gr,pleat,lean,band,hole)
    sh=round(h*lean)
    A=(cx+sh,cy-h);B=(cx-L+sh,cy-L/2-h);C=(cx-L+R+sh,cy-L/2-R/2-h);D=(cx+R+sh,cy-R/2-h)
    ctr=((A[0]+C[0])/2,(A[1]+C[1])/2)
    if slant:
        s=slant;B2=(B[0],B[1]-s);D2=(D[0],D[1]-s);C2=(C[0],C[1]-2*s)
        poly([A,B,B2],st['top']);poly([A,D,D2],mul(st['top'],.62));poly([A,B2,C2,D2],lerp(roof,(255,255,255),.2));return (ctr[0],ctr[1]-s)
    pts=[A,B,D] if wedge else [A,B,C,D]
    poly(pts,roof,mul(roof,.55));m=(sum(p[0] for p in pts)/len(pts),sum(p[1] for p in pts)/len(pts))
    poly([(m[0]+(p[0]-m[0])*.72,m[1]+(p[1]-m[1])*.72) for p in pts],mul(roof,.78),mul(roof,.62))
    return ctr
def cyl(ctr,r,h,st,seed,taper=1.0,bulge=0.0,gr=False,roof=(104,106,114)):
    cx,c0y=round(ctr[0]),round(ctr[1]);r=max(5,int(round(r)));h=int(round(h));wh=st['wh'];bays=max(7,int(r*1.1))
    for v in range(h):
        f=v/max(1,h-1);rv=r*(1-(1-taper)*f)+bulge*r*math.sin(math.pi*f);base=lerp(st['bot'],st['top'],f)
        for dx in range(-int(rv),int(rv)+1):
            q=dx/rv
            if abs(q)>1: continue
            y=int(c0y-v+(rv/2)*math.sqrt(1-q*q));ang=math.asin(q);bf=(ang/math.pi+.5)*bays;bay=int(bf);fr=bf-bay
            if gr and v<5: c=(255,196,100) if (hsh(bay,0,seed)<550 and fr>.2) else (44,38,40)
            elif fr<.2 or v%wh==wh-1: c=mul(base,.55)
            else: c=(255,206,110) if hsh(bay,v//wh,seed)<40 else mul(base,.85)
            c=mul(c,1.12-.62*((dx+rv)/(2*rv)))
            if abs(dx)>=int(rv): c=mul(c,.6)
            put(cx+dx,y,c);put(cx+dx,y-1,c)
    rt=max(3,r*taper+bulge*0)
    d.ellipse([cx-rt,c0y-h-rt/2,cx+rt,c0y-h+rt/2],fill=(*roof,255),outline=(*mul(roof,.55),255))
    d.ellipse([cx-rt*.6,c0y-h-rt*.3,cx+rt*.6,c0y-h+rt*.3],fill=(*mul(roof,.78),255))
    return (cx,c0y-h)
def crown(kind,ctr,Lt):
    x,y=ctr
    if kind=='spire': poly([(x-2,y),(x+2,y),(x,y-30)],(150,150,158),(60,60,68));line((x,y-30),(x,y-42),(70,70,76))
    elif kind=='antenna': line((x,y),(x,y-24),(70,70,76));d.rectangle([x-3,y-5,x+2,y-2],fill=(120,120,124,255))
    elif kind=='prongs':
        poly([(x-Lt*.6,y-6),(x-Lt*.45,y+3),(x-Lt*.15,y-10)],(176,66,52));poly([(x+Lt*.6,y-6),(x+Lt*.45,y+3),(x+Lt*.15,y-10)],(150,56,44))
    elif kind=='helipad':
        d.ellipse([x-9,y-4,x+9,y+4],outline=(235,235,235,255));line((x-3,y-2),(x-3,y+2),(235,235,235));line((x+3,y-2),(x+3,y+2),(235,235,235));line((x-3,y),(x+3,y),(235,235,235))
    elif kind=='dome':
        d.ellipse([x-12,y-15,x+12,y+4],fill=(150,172,196,255),outline=(60,70,90,255));d.ellipse([x-8,y-12,x-2,y-7],fill=(214,230,244,255))
    elif kind=='green':
        for ox,oy in((-8,0),(6,2),(-1,-4)): d.ellipse([x+ox-4,y+oy-6,x+ox+4,y+oy+1],fill=(60,130,60,255),outline=(30,80,30,255))
    elif kind=='deco':
        sbox(x,y+6,12,12,10,(205,210,222));sbox(x,y-6,8,8,9,(222,226,236));poly([(x-2,y-22),(x+2,y-22),(x,y-46)],(220,224,234),(90,94,110))
    elif kind=='mast':
        for q in range(0,40,6): line((x-5+q*.12,y-q),(x+5-q*.12,y-q-6),(90,90,98));line((x+5-q*.12,y-q),(x-5+q*.12,y-q-6),(90,90,98))
        line((x-5,y),(x,y-42),(70,70,76));line((x+5,y),(x,y-42),(70,70,76));d.ellipse([x-6,y-28,x+6,y-24],fill=(180,60,50,255),outline=(70,24,20,255))
    elif kind=='ring':
        d.ellipse([x-Lt*.55,y-Lt*.3,x+Lt*.55,y+Lt*.3],outline=(235,235,240,255),width=2)
    elif kind=='cap':
        sbox(x,y+5,Lt*.5,Lt*.5,7,(190,70,60))
def B(L,h,**o): return dict(t='b',L=L,h=h,**o)
def C(r,h,**o): return dict(t='c',r=r,h=h,**o)
def LIFT(h): return dict(t='lift',h=h)
def S(parts,off=(0,0),gr=True,z=None,crown=True): return dict(parts=parts,off=off,gr=gr,z=z,crown=crown)
FF=[.9,1,1.1,.95,1.05]
def A0(j):
    f=FF[j];w=[46,50,44,48,52][j];p=[B(58,16)] if j%2==0 else []
    return [S(p+[B(w,100*f,pleat=[6,5,8,6,4][j])])]
def A1(j):
    f=FF[j];w=[34,30,38,32,36][j];return [S([B(w,64*f),B(w-6,28*f),B(w-14,16),B(w-22,12)])]
def A2(j):
    f=FF[j];sc=[1,.92,1.04,.96,1][j];t=[B(56*sc,34*f),B(46*sc,24*f),B(36*sc,20*f),B(26*sc,16*f),B(18*sc,10*f)]
    return [S(t if j%2==0 else t[:4])]
def A3(j): return [S([C([24,22,26,20,25][j],96*FF[j],taper=[.3,.5,.2,.7,.4][j],bulge=[.35,.25,.45,.2,.3][j])])]
def A4(j):
    f=FF[j];hh=[(90,76),(84,84),(96,70),(78,78),(100,86)][j]
    return [S([B(58,12)],z=-99,crown=False),S([LIFT(12),B(20,hh[0]*f)],off=(-20,-10),gr=False),S([LIFT(12),B(20,hh[1]*f)],off=(20,10),gr=False),S([LIFT(12+hh[1]*f*.55),B(14,6)],gr=False,crown=False)]
def A5(j):
    n=[6,5,7,6,5][j];p=[]
    for k in range(n): s=1-k*.07;p+=[B(28*s,10*FF[j]),B(36*s,6)]
    p.append(B(10,12));return [S(p)]
def A6(j):
    p=[B(56,10)] if j%2 else [];return [S(p+[B(48,100*FF[j],lean=[.12,-.12,.2,-.2,.08][j])])]
def A7(j):
    p=[B(60,10)] if j%2 else [];return [S(p+[B(56,90*FF[j],R=[56,44,60,48,52][j],wedge=True)])]
def A8(j):
    f=FF[j];return [S([B(50,56*f),B(42,34*f),B(32,22*f),B(22,14*f)])]
def A9(j):
    n=9;p=[];px_=0;py_=0
    for k in range(n):
        tx=4*math.sin(k*.9+j);ty=2.5*math.cos(k*.9+j)
        p.append(B(40-k*1.6,11*FF[j],dx=tx-px_,dy=ty-py_));px_,py_=tx,ty
    return [S(p)]
def A10(j):
    n=[6,5,7,6,5][j];return [S([B(58-k*(40/(n-1)),100*FF[j]/n) for k in range(n)])]
def A11(j):
    return [S([B(58,18),B([32,28,34,30,36][j],96*FF[j],dx=[10,-10,14,-14,0][j],dy=[-5,5,-7,7,0][j])])]
def A12(j):
    r=[26,22,28,24,20][j];return [S([C(r,96*FF[j],taper=[1,.8,.9,1,.7][j]),C(r*.6,14)])]
def A13(j):
    return [S([B(54,92*FF[j],hole=[(.28,.72,.36,.72),(.2,.8,.5,.8),(.3,.7,.25,.65),(.25,.75,.4,.9),(.35,.65,.3,.7)][j])])]
def A14(j):
    f=FF[j];hs=[(100,80,66),(66,100,80),(80,66,100),(92,92,60),(70,100,100)][j]
    return [S([B(22,hs[0]*f)],off=(0,-12)),S([B(22,hs[1]*f)],off=(-18,0),crown=False),S([B(22,hs[2]*f)],off=(18,2),crown=False)]
def A15(j):
    f=FF[j];a=[(36,36),(36,26),(26,36),(32,40),(40,32)][j]
    return [S([B(a[0],100*f,R=a[1])],off=(-12,-6)),S([B(36,44*f,R=26)],off=(14,8),crown=False)]
def A16(j):
    p=[B(58,10)] if j%2 else [];return [S(p+[B(50,90*FF[j],R=[50,44,56,48,52][j],slant=[14,18,10,16,12][j])])]
def A17(j):
    f=FF[j];w=[0,2,-2,4,-4][j];return [S([B(24+w,46*f),B(34+w,26*f),B(44+w,22*f),B(54,12)])]
def A18(j):
    f=FF[j];w=[50,44,54,48,52][j];return [S([B(w,64*f,band=(.8,.9)) if j%2==0 else B(w,64*f),B(w-14,14)])]
def A19(j):
    hs=[100,76,64,88];hs=hs[j%4:]+hs[:j%4];offs=[(0,-16),(-32,0),(32,0),(0,16)]
    return [S([B(26,hs[n]*FF[j])],off=offs[n],crown=(n==0)) for n in range(4)]
ARCH=[A0,A1,A2,A3,A4,A5,A6,A7,A8,A9,A10,A11,A12,A13,A14,A15,A16,A17,A18,A19]
NAMES=['プリーツ壁超高層','針状スパイア塔','アールデコ段付き','バルブ型(丸み)','ツイン+連絡橋','パゴダ段塔','傾斜タワー','ウェッジ(三角平面)','ダイアグリッド','ツイスト','ジグラート','ポディウム+偏心塔','円筒タワー','ポータル(門型)','三連クラスター','L字ブロック','斜め屋根','逆ピラミッド','マスト付き','4連束ね柱']
DEFC={1:'spire',2:'deco',3:'dome',16:'antenna',18:'mast',12:'ring'}
CRL=['none','antenna','helipad','green','ring','cap','spire','prongs']
def design(idx):
    a,j=divmod(idx,5);pal=OP2[(a*7+j*3+j*j)%20]
    kind='diagrid' if a==8 and j!=3 else 'mirror' if a==8 else KIND2[(a+j*2)%7]
    cr=DEFC.get(a) if j in(0,2,4) and a in DEFC else ('none' if a==16 else CRL[(a+j*3)%8])
    if a in DEFC and j in(1,3): cr=CRL[(a+j*3)%8]
    return a,j,pal,kind,cr
SC={'S':(.46,.38),'M':(.58,.64),'L':(1,1)}
def office2(idx,size):
    new();a,j,pal,kind,cr=design(idx);fs,hs=SC[size];big=size=='L';hw=64 if big else 32;ground(150,hw,plaza)
    ww,wh={'glass':(5,5),'stripe':(8,5),'concrete':(8,6)}.get(kind,(5,5)) if big else {'glass':(4,4),'stripe':(8,4),'concrete':(7,5)}.get(kind,(4,4))
    st={'kind':kind,'top':mul(pal[0],1.1),'bot':pal[1],'win':mul(pal[1],1.4),'ww':ww,'wh':wh}
    stacks=sorted(ARCH[a](j),key=lambda s:(s['z'] if s['z'] is not None else s['off'][1],s['off'][0]))
    for si,sk in enumerate(stacks):
        ctr=(64+sk['off'][0]*fs,150+sk['off'][1]*fs);top=None;lastL=20;n0=True
        for n,p in enumerate(sk['parts']):
            ctr=(ctr[0]+p.get('dx',0)*fs,ctr[1]+p.get('dy',0)*fs)
            if p['t']=='lift': ctr=(ctr[0],ctr[1]-p['h']*hs);continue
            gr=sk['gr'] and n0;n0=False
            if p['t']=='b':
                L=max(7,p['L']*fs);R=max(7,p.get('R',p['L'])*fs);h=max(4,p['h']*hs)
                cx=ctr[0]-(R-L)/2;cy=ctr[1]+(L+R)/4;ho=p.get('hole');ho=(int(R*ho[0]),int(R*ho[1]),int(h*ho[2]),int(h*ho[3])) if ho else None
                bd=p.get('band');bd=(int(h*bd[0]),int(h*bd[1])) if bd else None
                ctr=box(cx,cy,L,R,h,st,j*13+a*7+n+si*3,gr=gr,slant=p.get('slant',0)*hs,wedge=p.get('wedge',False),pleat=p.get('pleat',0),lean=p.get('lean',0.0),band=bd,hole=ho);lastL=L
            else:
                ctr=cyl(ctr,p['r']*fs,max(4,p['h']*hs),st,a*5+j+n,p.get('taper',1.0),p.get('bulge',0.0),gr=gr);lastL=p['r']*fs*2
        if sk['crown'] and cr!='none' and not (a==16): crown(cr,ctr,lastL)
    return im.copy()
os.chdir('.')
full=Image.new('RGBA',(W*15,H*20),(0,0,0,0))
for idx in range(100):
    for si,s in enumerate('SML'): full.paste(office2(idx,s),((idx%5*3+si)*W,(idx//5)*H))
q=full.quantize(colors=255,method=Image.FASTOCTREE,dither=Image.NONE);tr=q.getpixel((0,0))
os.makedirs('sheets',exist_ok=True);os.makedirs('sprites',exist_ok=True)
zf=zipfile.ZipFile('office2_sprites.zip','w');rows=[]
for idx in range(100):
    a,j,pal,kind,cr=design(idx)
    for si,s in enumerate('SML'):
        x=(idx%5*3+si)*W;y=(idx//5)*H;p=f'sprites/office2_{idx+1:03d}_{s}.png'
        q.crop((x,y,x+W,y+H)).save(p,transparency=tr);zf.write(p)
    rows.append([idx+1,NAMES[a],j+1,kind,cr,f'sheet{idx//25+1}'])
zf.close()
csv.writer(open('office2_list.csv','w',newline='',encoding='utf-8-sig')).writerows([['id','archetype','variant','facade','crown','sheet']]+rows)
bgc=(30,34,48)
for sh in range(4):
    cr_=q.crop((0,sh*25//5*H,W*15,(sh*25//5+5)*H));cr_.save(f'sheets/office2_sheet{sh+1}_8bit.png',transparency=tr)
    rgba=cr_.convert('RGBA');bg=Image.new('RGB',rgba.size,bgc);bg.paste(rgba,(0,0),rgba);pd=ImageDraw.Draw(bg)
    for k in range(25):
        idx=sh*25+k;x=k%5*3*W;y=k//5*H;pd.rectangle([x,y,x+3*W-1,y+H-1],outline=(70,76,96));pd.text((x+4,y+3),f'{idx+1:03d} type{design(idx)[0]+1}-{design(idx)[1]+1}',fill=(200,205,220))
    bg.save(f'sheets/office2_preview{sh+1}.png')
ov=Image.new('RGB',(10*77,10*115),bgc)
rg=q.convert('RGBA')
for idx in range(100):
    x=(idx%5*3+2)*W;y=(idx//5)*H;c=rg.crop((x,y,x+W,y+H));c=c.resize((77,115),Image.NEAREST);ov.paste(c,((idx%10)*77,(idx//10)*115),c)
ov.save('office2_overview_L.png')
print('done')
