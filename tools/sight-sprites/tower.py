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
def g_rail(s,t,dx,dy):
    n=hsh(dx,dy);c=(122,114,102) if n>200 else (110,102,92)
    if max(abs(s),abs(t))>.47: c=(80,72,64)
    for tk in(-.3,0,.3):
        if abs(abs(t-tk)-.035)<.02: c=(200,200,208)
        elif abs(t-tk)<.035 and int((s+.5)*22)%2==0: c=(84,64,48)
    return c
def g_gravel(s,t,dx,dy):
    n=hsh(dx,dy);c=(136,130,120) if n>180 else (124,118,108)
    if max(abs(s),abs(t))>.47: c=(86,80,72)
    return c
CARC=[(200,50,44),(60,110,190),(230,230,230),(40,40,46),(220,200,60),(90,150,90)]
def g_park(s,t,dx,dy):
    n=hsh(dx,dy);c=(66,68,74) if n>200 else (60,62,68)
    if max(abs(s),abs(t))>.47: return (120,118,112)
    if max(abs(s),abs(t))>.30:
        if (int((s+.5)*100)%8)<1 and abs(t)>.3: c=(210,210,200)
        if (int((t+.5)*100)%8)<1 and abs(s)>.3: c=(210,210,200)
        cs,ct=math.floor(s*12),math.floor(t*12)
        if hsh(cs,ct,7)<240 and .25<(s*12-cs)<.75 and .25<(t*12-ct)<.75: c=CARC[hsh(cs,ct,3)%6]
    return c
GROUNDS={'lawn':g_lawn,'plaza':g_plaza,'yard':g_yard,'court':g_court,'pool':g_pool,'rail':g_rail,'gravel':g_gravel,'park':g_park}
G={'v':0,'w':(96,190,200),'p':None}
def g_onsen(s,t,dx,dy):
    n=hsh(dx,dy);c=(136,130,122) if n>200 else (126,120,112)
    if (dx+dy)%9==0 and n>400: c=mul(c,.92)
    if max(abs(s),abs(t))>.47: return (84,78,72)
    pl=G.get('p')
    if pl:
        s0,s1,t0,t1=pl;m=.035
        if s0<s<s1 and t0<t<t1:
            w=G['w'];return lerp(w,(255,255,255),.3) if (dx+2*dy)%5==0 else (w if (dx+dy)%3 else mul(w,.92))
        if s0-m<s<s1+m and t0-m<t<t1+m: return (214,210,200)
    return c
def g_sand(s,t,dx,dy):
    n=hsh(dx,dy);gv=G['v']
    if gv==1: c=(112,148,92) if n>140 else (102,138,84)
    else: c=(214,208,194) if n>150 else (204,198,184)
    if gv==2 and ((dx+dy*2)//3)%4==0: c=mul(c,.93)
    if max(abs(s),abs(t))>.47: c=(92,86,78) if gv!=1 else (62,98,52)
    if abs(t)<.07 and s>-.2: c=(152,148,142) if int((s+.5)*16)%2 else (142,138,132)
    return c
def g_marble(s,t,dx,dy):
    gv=G['v'];cs=int((s+1)*10)+int((t+1)*10)
    c=(232,228,216) if cs%2==0 else (222,218,206)
    if gv==1: c=(206,190,150) if cs%2==0 else (196,180,140)
    if gv==2: c=(176,196,212) if cs%2==0 else (166,186,204)
    m=max(abs(s),abs(t))
    if m>.47: c=(120,116,108)
    elif m>.42: c=mul(c,.82)
    if abs(t)<.05 and s>-.2 and m<=.42: c=mul(c,.9)
    return c
def g_desert(s,t,dx,dy):
    n=hsh(dx,dy);c=(222,192,132) if n>160 else (212,182,124)
    if int((s*7+t*3)*3)%5==0: c=mul(c,.94)
    if max(abs(s),abs(t))>.47: c=(176,146,92)
    return c
def g_neon(s,t,dx,dy):
    gv=G['v'];cs=int((s+1)*8)+int((t+1)*8)
    c=(58,30,66) if cs%2==0 else (48,24,56)
    if gv==1: c=(26,36,78) if cs%2==0 else (20,28,66)
    m=max(abs(s),abs(t))
    if m>.47: c=(18,14,24)
    elif m>.43: c=(214,170,64)
    if abs(t)<.08 and s>-.1:
        c=(180,34,56) if gv==0 else (50,90,190)
        if abs(abs(t)-.07)<.015: c=(226,186,70)
    return c
def g_cobble(s,t,dx,dy):
    r=dy//2;off=(r%2)*3;n=hsh((dx+off)//6,r);gv=G['v']
    if gv==1: c=(150,150,152) if n>500 else (140,140,142)
    else: c=(176,150,124) if n>500 else (164,138,112)
    if n>900: c=lerp(c,(255,255,255),.1)
    if (dx+off)%6==0 or dy%2==0: c=mul(c,.88)
    if max(abs(s),abs(t))>.47: c=(98,92,86)
    return c
def g_meadow(s,t,dx,dy):
    n=hsh(dx,dy);c=(78,124,58) if n>120 else (70,114,52)
    if n>960: c=(100,146,72)
    if max(abs(s),abs(t))>.47: c=(58,98,44)
    return c
def g_garden(s,t,dx,dy):
    c=g_meadow(s,t,dx,dy);n=hsh(dx,dy,5)
    if n<40 and max(abs(s),abs(t))<.45: c=[(230,90,120),(250,210,60),(255,255,255),(170,110,230)][n%4]
    return c
def g_sea(s,t,dx,dy):
    c=(44,112,172) if (dx+dy*2)%11 else (80,150,206)
    if (dx*3+dy)%17==0: c=(120,180,226)
    if max(abs(s),abs(t))>.47: c=(30,84,140)
    return c
def g_deck(s,t,dx,dy):
    b=int((t+.5)*16);c=(176,134,92) if b%2 else (164,124,84)
    if hsh(int((s+.5)*9),b)<80: c=mul(c,.9)
    if int((t+.5)*16*2)%2==0 and ((t+.5)*32)%1<.3: c=mul(c,.82)
    if max(abs(s),abs(t))>.47: c=(110,80,54)
    return c
GROUNDS.update({'onsen':g_onsen,'sand':g_sand,'marble':g_marble,'desert':g_desert,'neon':g_neon,'cobble':g_cobble,'garden':g_garden,'meadow':g_meadow,'sea':g_sea,'deck':g_deck})
def face(cx,cy,n,h,side,st,seed,door=None,hole=None,gr=False,band=None):
    n=int(round(n));h=int(round(h));k=st['kind'];ww=st['ww'];wh=st['wh']
    for i in range(n):
        x=cx-1-i if side=='l' else cx+i
        yb=cy-(i+1)//2;gx=i%ww
        for v in range(h):
            y=yb-v;base=lerp(st['bot'],st['top'],v/max(1,h-1));gy=v%wh;c=base
            if gr and v<5: c=(255,196,100) if (hsh(i//4,0,seed)<550 and i%4<3 and 0<v<4) else (44,38,40)
            elif k=='glass':
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
            elif k=='stone':
                if v%wh==0: c=mul(base,.8)
                elif (i+(v//wh)*(ww//2+1))%ww==0: c=mul(base,.88)
                elif hsh(i//ww,v//wh,seed)<80: c=mul(base,1.08)
            elif k=='wood':
                if gx==0: c=mul(base,.72)
                elif gy==0: c=mul(base,.82)
                elif 2<=gx<=ww-2 and 2<=gy<=wh-2 and v>=1:
                    c=(255,214,128) if hsh(i//ww,v//wh,seed)<45 else (236,228,204)
                    if gx==(ww+1)//2 or gy==(wh+1)//2: c=mul(c,.78)
                elif i%2==0: c=mul(base,.94)
            elif k=='neon':
                if gy==wh-1: c=NEON[hsh(i//ww,v//wh,seed)%5] if hsh(i,v//wh,seed+3)<700 else mul(base,.6)
                elif gx==ww-1: c=mul(base,.55)
                else:
                    h2=hsh(i//ww,v//wh,seed)
                    c=(255,214,120) if h2<330 else (mul(base,.8) if h2<700 else lerp(base,NEON[h2%5],.28))
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
            if band and band[0]<=v<band[1]: c=lerp(c,(255,236,170),.6) if i%4<3 else mul(c,.6)
            if door and side=='r' and door[0]<=i<door[1] and v<door[2]: c=(84,52,34) if v<door[2]-1 else mul(base,.7)
            if hole and hole[0]<=i<hole[1] and hole[2]<=v<hole[3]: c=(90,100,122) if (i==hole[0] or v==hole[2]) else (16,20,30)
            if side=='r': c=mul(c,.62)
            if i==0: c=lerp(c,(255,255,255),.3) if side=='l' else mul(c,.6)
            if i==n-1: c=mul(c,.55)
            if v==0: c=mul(c,.6)
            if v==h-1: c=lerp(c,(255,255,255),.25)
            put(x,y,c)
def box(cx,cy,L,R,h,st,seed=0,roof=(120,120,126),top=True,door=None,hole=None,gr=False,band=None):
    L=int(round(L));R=int(round(R));h=int(round(h));cx=round(cx);cy=round(cy)
    face(cx,cy,L,h,'l',st,seed,None,None,gr,band);face(cx,cy,R,h,'r',st,seed+1,door,hole,gr,band)
    A=(cx,cy-h);B=(cx-L,cy-L/2-h);C=(cx-L+R,cy-L/2-R/2-h);D=(cx+R,cy-R/2-h);ctr=((A[0]+C[0])/2,(A[1]+C[1])/2)
    if top:
        poly([A,B,C,D],roof,mul(roof,.55));poly([(ctr[0]+(p[0]-ctr[0])*.72,ctr[1]+(p[1]-ctr[1])*.72) for p in (A,B,C,D)],mul(roof,.8),mul(roof,.62));clutter(ctr,L,R,seed,roof)
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
    elif typ=='hipR': hipR(cx,cy,L,R,h,r,col)
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
    elif kind=='sign':
        sbox(x,y+3,12,2,9,(210,50,44));line((x-9,y-1),(x-1,y-5),(255,255,255));line((x-9,y-3),(x-1,y-7),(255,230,160))
    elif kind=='sign2':
        sbox(x,y+3,2,12,9,(40,100,190));line((x+1,y-2),(x+9,y-6),(255,255,255))
    elif kind=='radial':
        r=Lt*.5
        for ang in range(0,360,30): line((x,y),(x+r*math.cos(math.radians(ang)),y+r*math.sin(math.radians(ang))/2),(60,60,66))
        d.ellipse([x-3,y-2,x+3,y+2],fill=(200,200,208,255))
    elif kind=='crane':
        line((x-10,y),(x-10,y-26),(220,170,40));line((x+12,y),(x+12,y-26),(220,170,40));line((x-12,y-26),(x+14,y-26),(220,170,40));line((x+2,y-26),(x+2,y-12),(60,60,66))
    elif kind=='green':
        for ox,oy in((-8,0),(6,2),(-1,-4)): d.ellipse([x+ox-4,y+oy-6,x+ox+4,y+oy+1],fill=(60,130,60,255),outline=(30,80,30,255))
    elif kind in CROWN2: CROWN2[kind](x,y,Lt)
    elif kind=='helipad':
        d.ellipse([x-9,y-4,x+9,y+4],outline=(235,235,235,255));line((x-3,y-2),(x-3,y+2),(235,235,235));line((x+3,y-2),(x+3,y+2),(235,235,235));line((x-3,y),(x+3,y),(235,235,235))
NEON=[(255,60,140),(60,220,255),(255,220,60),(170,90,255),(80,255,160)]
def ell(x,y,rx,ry,f,o=None):
    o=o or mul(f,.5);d.ellipse([x-rx,y-ry,x+rx,y+ry],fill=(*f,255),outline=(*o,255))
def rect(x0,y0,x1,y1,f,o=None):
    o=o or mul(f,.55);d.rectangle([round(x0),round(y0),round(x1),round(y1)],fill=(*f,255),outline=(*o,255))
def lw(a,b,c,w=2): d.line([(round(a[0]),round(a[1])),(round(b[0]),round(b[1]))],fill=(*c,255),width=max(1,int(w)))
def ball(x,y,r,c):
    r=max(1.5,r);ell(x,y,r,r*.92,mul(c,.7),mul(c,.5))
    for i in range(int(r*r*.9)+3):
        ang=(hsh(i,int(r*7),int(x))%628)/100;rr=((hsh(i,3,int(y))%100)/100)**.6*r*.85
        k=.85+(hsh(i,9,int(x+y))%35)/100-(.12 if math.sin(ang)>0 else 0)+(.1 if math.cos(ang)<0 else -.05)
        put(x+rr*math.cos(ang),y+rr*math.sin(ang)*.9,mul(c,k))
def pillar(x,y,r,h,c,top=None):
    r=max(1,r);h=max(1,h)
    ell(x,y,r,r/2,mul(c,.6))
    d.rectangle([round(x-r),round(y-h),round(x+r),round(y)],fill=(*mul(c,.88),255))
    d.rectangle([round(x),round(y-h),round(x+r),round(y)],fill=(*mul(c,.64),255))
    ell(x,y-h,r,r/2,top or lerp(c,(255,255,255),.2))
def cbox(x,y,L,R,h,col):
    L=max(2,L);R=max(2,R);h=max(1,h);sbox(x-(R-L)/2,y+(L+R)/4,L,R,h,col);return (x,y-h)
def tprism(x,y,a,b,H,c):
    f=lambda r,yy:((x,yy+r/2),(x-r,yy),(x,yy-r/2),(x+r,yy))
    n0,l0,b0,r0=f(a,y);n1,l1,b1,r1=f(b,y-H)
    poly([n0,l0,l1,n1],c);poly([n0,r0,r1,n1],mul(c,.64));poly([n1,l1,b1,r1],mul(c,1.15))
def hipR(cx,cy,L,R,h,r,col):
    P=lambda u,w,z=0:(cx-u+w,cy-h-(u+w)/2-z)
    m=min(L,R)/2;wide=L>=R
    r1=P(m,m,r);r2=P(L-m,m,r) if wide else P(m,R-m,r)
    p00,pL0,p0R,pLR=P(0,0),P(L,0),P(0,R),P(L,R)
    dk=mul(col,.8);rc=mul(col,.68)
    if wide: poly([pL0,pLR,r2],dk);poly([p0R,pLR,r2,r1],dk);poly([p00,pL0,r2,r1],col);poly([p00,p0R,r1],rc)
    else: poly([pL0,pLR,r2,r1],dk);poly([p0R,pLR,r2],dk);poly([p00,pL0,r1],col);poly([p00,p0R,r2,r1],rc)
    for t in(.34,.67):
        if wide: line(L2(p00,r1,t),L2(pL0,r2,t),mul(col,.82));line(L2(p00,r1,t),L2(p0R,r1,t),mul(rc,.82))
        else: line(L2(p00,r1,t),L2(pL0,r1,t),mul(col,.82));line(L2(p00,r1,t),L2(p0R,r2,t),mul(rc,.82))
    if wide: line(r1,r2,mul(col,1.25))
def croof(x,y,L,R,r,col,h=0):
    hipR(round(x-(R-L)/2),round(y+(L+R)/4),round(L),round(R),h,r,col)
def puff(x,y,r): ell(x,y,r*.8,r*.6,(206,208,210),(170,172,176))
def _puffs(x,y,n=4,s=1.0):
    for i in range(n): puff(x+((-1)**i)*(1+i*.8)*s,y-i*6*s-3,(3.6+i*.7)*s)
DECO={}
def deco(f): DECO[f.__name__[2:]]=f;return f
@deco
def d_tree(x,y,u,v,p):
    c=p.get('col',(70,138,60));hh=p.get('h',1.0);w=p.get('w',1.0)
    th=12*v*hh;rect(x-1.2*u,y-th,x+1.2*u,y,(86,62,40))
    cy=y-th-4*v*hh
    for i,(ox,oy,r) in enumerate(((0,-9,6),(-7,0,6),(7,-1,6),(0,2,7),(-3,-5,6),(4,-6,5),(-8,6,5),(8,5,5))): ball(x+ox*u*w,cy+oy*v*hh,r*u*(.9+.1*w),mul(c,.92+(i%3)*.07))
@deco
def d_pine(x,y,u,v,p):
    c=p.get('col',(46,112,72));n=p.get('n',4)
    rect(x-1.5*u,y-8*v,x+1.5*u,y,(96,66,42))
    for i in range(n):
        y0=y-(5+i*9)*v;r=(16-i*(11/n))*u;h=14*v
        poly([(x-r,y0),(x,y0),(x,y0-h)],mul(c,1.05));poly([(x,y0),(x+r,y0),(x,y0-h)],mul(c,.72))
        if p.get('snow'): poly([(x-r*.38,y0-h*.62),(x+r*.38,y0-h*.62),(x,y0-h)],(242,246,252),(190,200,214))
@deco
def d_sakura(x,y,u,v,p):
    c=p.get('col',(246,176,200));d_tree(x,y,u,v,dict(p,col=c))
    for i in range(14): put(x+(hsh(i,1)%34-17)*u,y+(hsh(i,2)%10-1)*u*.5,lerp(c,(255,255,255),.4))
@deco
def d_palm(x,y,u,v,p):
    H=44*v;pts=[(x,y),(x+3*u,y-H*.5),(x+2*u,y-H)]
    lw(pts[0],pts[1],(150,110,70),2*u);lw(pts[1],pts[2],(150,110,70),2*u)
    tx,ty=pts[-1];c=p.get('col',(60,140,70))
    for dx,dy in((-15,6),(-12,-4),(-5,-9),(5,-9),(12,-4),(15,6)):
        m=(tx+dx*.6*u,ty+(dy-4)*v);e=(tx+dx*u,ty+(dy+6)*v);lw((tx,ty),m,c,2);lw(m,e,mul(c,.8),2)
    ball(tx-1*u,ty+2*v,1.6*u,(120,80,46));ball(tx+2*u,ty+2*v,1.6*u,(120,80,46))
@deco
def d_bush(x,y,u,v,p):
    c=p.get('col',(64,132,60))
    for ox,r in((-5,5),(5,5),(0,6)): ball(x+ox*u,y-4*v,r*u,mul(c,1.0+(.1 if ox==0 else 0)))
@deco
def d_lantern(x,y,u,v,p):
    c=p.get('col',(172,172,168));lc=p.get('lc',(255,208,120))
    t=cbox(x,y,8*u,8*u,3*v,mul(c,.9));pillar(t[0],t[1],2.2*u,10*v,c);t=(t[0],t[1]-10*v)
    t=cbox(t[0],t[1],7*u,7*u,2*v,c);t=cbox(t[0],t[1],5*u,5*u,6*v,lc)
    croof(t[0],t[1],10*u,10*u,6*v,mul(c,.95));ball(t[0],t[1]-7*v,2*u,c)
@deco
def d_lamp(x,y,u,v,p):
    c=p.get('col',(60,64,72));H=p.get('H',40)*v;pillar(x,y,2*u,3*v,c);rect(x-.9*u,y-H,x+.9*u,y-3*v,c)
    for dx in((-7,7) if p.get('two') else (0,)):
        if dx: lw((x,y-H+2*v),(x+dx*u,y-H-1*v),c,1)
        ball(x+dx*u,y-H-3*v,3*u,(255,238,160))
@deco
def d_chochin(x,y,u,v,p):
    rect(x-.8*u,y-26*v,x+.8*u,y,(96,72,50));lw((x,y-26*v),(x+7*u,y-26*v),(96,72,50),1)
    ell(x+7*u,y-20*v,3.8*u,5.2*v,(214,56,44));lw((x+3.5*u,y-20*v),(x+10.5*u,y-20*v),(255,214,150),1)
    rect(x+5*u,y-26*v,x+9*u,y-25*v,(40,36,38))
@deco
def d_torii(x,y,u,v,p):
    c=p.get('col',(206,58,42));sp=p.get('sp',24);hh=p.get('H',36)*v;rot=p.get('rot',0);dx=-1 if rot else 1
    pos=lambda t:(x+dx*t*u,y-t*u/2)
    def pl(t):
        a,b=pos(t);cbox(a,b+1,3.4*u,3.4*u,hh,c);cbox(a,b+1,4.2*u,4.2*u,2.5*v,(38,34,36))
    pl(sp/2)
    bw=lambda wd,h_,col,yy,th:cbox(x,yy,th*u if not rot else wd*u,wd*u if not rot else th*u,h_,col)
    bw(sp,2.4*v,c,y-.7*hh,2.4)
    bw(sp+7,2.6*v,c,y-hh,2.8)
    bw(sp+12,2.6*v,(48,42,44),y-hh-2.4*v,3.6)
    pl(-sp/2)
@deco
def d_komainu(x,y,u,v,p):
    c=p.get('col',(176,176,170));t=cbox(x,y,7*u,7*u,4*v,mul(c,.85))
    ell(t[0],t[1]-5*v,3.4*u,5.5*v,c);ball(t[0]+.6*u,t[1]-12*v,2.7*u,c);poly([(t[0]-1*u,t[1]-14*v),(t[0],t[1]-17*v),(t[0]+1.5*u,t[1]-14*v)],c)
@deco
def d_rock(x,y,u,v,p):
    c=p.get('col',(138,136,132))
    for ox,oy,r in((-6,1,6),(5,2,5),(0,-3,7)): ball(x+ox*u,y+oy*v-r*.5*v,r*u,c)
@deco
def d_steam(x,y,u,v,p):
    for i in range(p.get('n',4)):
        r=(4+i*.8)*u;puff(x+((-1)**i)*(2+i)*u*.6,y-(i*7+2)*v,r)
@deco
def d_pond(x,y,u,v,p):
    w=p.get('w',(86,160,206));rx=p.get('rx',26)*u
    ell(x,y,rx+2.5*u,(rx+2.5*u)/2,(176,172,160),(110,106,98));ell(x,y,rx,rx/2,w,mul(w,.7))
    hl=lerp(w,(255,255,255),.35);ell(x-rx*.25,y-rx*.1,rx*.45,rx*.16,hl,hl)
    if p.get('koi'):
        ell(x+rx*.3,y+rx*.1,2.6*u,1.2*u,(240,120,60));ell(x-rx*.1,y+rx*.18,2.4*u,1.1*u,(250,250,244),(200,200,190))
    if p.get('lily'):
        for ox,oy in((-.4,.05),(.15,-.12),(.35,.18)): ell(x+rx*ox,y+rx*oy,2.4*u,1.2*u,(70,150,80));put(x+rx*ox,y+rx*oy,(250,170,190))
@deco
def d_fountain(x,y,u,v,p):
    s=p.get('c',(204,200,190));w=p.get('w',(110,180,226));n=p.get('n',2);r=p.get('r',16);h0=6*v
    if p.get('sq'):
        S_=r*1.5*u;cbox(x,y,S_,S_,h0,s);a=S_-2.4*u;yy=y-h0
        poly([(x,yy+a/2),(x-a,yy),(x,yy-a/2),(x+a,yy)],w,mul(w,.7))
    else:
        pillar(x,y,r*u,h0,s);ell(x,y-h0,(r-2.5)*u,(r-2.5)*u/2,w,mul(w,.8))
    yy=y-h0;rr=r
    for i in range(1,n+1):
        pillar(x,yy,2.2*u,10*v,s);yy-=10*v;rr=r*(.62**i);b=max(3,rr)*u
        pillar(x,yy,b,3.5*v,s);ell(x,yy-3.5*v,b-1.6*u,(b-1.6*u)/2,w,mul(w,.8));yy-=3.5*v
    for dx in(-5,-2.5,0,2.5,5):
        lw((x,yy),(x+dx*u,yy-(7-abs(dx)*.5)*v),lerp(w,(255,255,255),.6),1);lw((x+dx*u,yy-(7-abs(dx)*.5)*v),(x+dx*1.9*u,yy+1*v),lerp(w,(255,255,255),.4),1)
@deco
def d_statue(x,y,u,v,p):
    c=p.get('col',(190,150,80));pc=p.get('pc',(176,172,164));ph=p.get('ph',14);pose=p.get('pose',0)
    t=cbox(x,y,12*u,12*u,3*v,mul(pc,.9));t=cbox(t[0],t[1],9*u,9*u,ph*v,pc)
    pillar(t[0],t[1],3.2*u,13*v,c);ball(t[0],t[1]-17*v,3*u,c)
    if pose==0: lw((t[0]+3*u,t[1]-12*v),(t[0]+7*u,t[1]-23*v),c,2)
    elif pose==1: lw((t[0]+3*u,t[1]-8*v),(t[0]+9*u,t[1]-26*v),(220,224,230),2);lw((t[0]+3*u,t[1]-9*v),(t[0]+7*u,t[1]-8*v),c,2)
    else: ball(t[0],t[1]-24*v,3.6*u,mul(c,1.1))
@deco
def d_monument(x,y,u,v,p):
    c=p.get('col',(190,188,182));m=p.get('m',0);t=cbox(x,y,14*u,14*u,4*v,mul(c,.88))
    if m==0: tprism(t[0],t[1],5*u,2.6*u,44*v,c);poly([(t[0],t[1]-44*v-9*v),(t[0]-2.6*u,t[1]-44*v-1.3*u),(t[0],t[1]-44*v+1.3*u)],mul(c,1.1));poly([(t[0],t[1]-44*v-9*v),(t[0]+2.6*u,t[1]-44*v-1.3*u),(t[0],t[1]-44*v+1.3*u)],mul(c,.7))
    elif m==1:
        t2=cbox(t[0],t[1],10*u,4*u,26*v,c)
        for i in range(4): lw((t2[0]-4*u,t2[1]+(5+i*4)*v),(t2[0]+2*u,t2[1]+(2+i*4)*v),mul(c,.55),1)
    elif m==2:
        pillar(t[0],t[1],4*u,34*v,c);ell(t[0]+1*u,t[1]-26*v,3.6*u,3.6*u,(244,244,236),(60,50,40));lw((t[0]+1*u,t[1]-26*v),(t[0]+1*u,t[1]-29*v),(40,30,30),1);lw((t[0]+1*u,t[1]-26*v),(t[0]+3*u,t[1]-26*v),(40,30,30),1);ball(t[0],t[1]-37*v,3*u,(214,176,80))
    elif m==3: pillar(t[0],t[1],3*u,10*v,c);ball(t[0],t[1]-22*v,10*u,p.get('bc',(90,150,210)))
    else:
        for ox,hh in((-6,20),(0,32),(6,24)): cbox(t[0]+ox*u,t[1]+abs(ox)*.2*u,4*u,4*u,hh*v,mul(c,1.0-.08*abs(ox)))
@deco
def d_gazebo(x,y,u,v,p):
    rc=p.get('rc',(150,76,56));wc=p.get('wc',(226,214,190));S_=p.get('a',22)*u
    cbox(x,y,S_,S_,3*v,(170,166,158));q=S_*.8;yb=y-3*v;H=20*v
    for ox,oy in((0,-q/2),(-q,0),(q,0),(0,q/2)): rect(x+ox-1*u,yb+oy-H,x+ox+1*u,yb+oy,wc)
    croof(x,yb-H,S_*1.2,S_*1.2,12*v,rc)
@deco
def d_bed(x,y,u,v,p):
    cols=p.get('cols',[(230,80,120),(250,210,60),(255,255,255)]);S_=p.get('S',16)*u
    t=cbox(x,y,S_,S_,3*v,(168,120,88));a=S_*.86
    poly([(t[0],t[1]+a/2),(t[0]-a,t[1]),(t[0],t[1]-a/2),(t[0]+a,t[1])],(84,150,70),(60,110,52))
    for i in range(30):
        f=(hsh(i,3)%100)/100*1.8-.9;g=(hsh(i,5)%100)/100*1.8-.9
        if abs(f)+abs(g)<=.82:
            cc=cols[hsh(i,7)%len(cols)];qx=t[0]+f*a;qy=t[1]+g*a/2;d.rectangle([round(qx),round(qy)-1,round(qx)+1,round(qy)],fill=(*cc,255))
@deco
def d_stairs(x,y,u,v,p):
    n=p.get('n',4);sh=p.get('sh',3)*v;dd=p.get('d',4)*u;w=p.get('w',14)*u;c=p.get('col',(172,170,164))
    for j in range(n):
        ln=(j+1)*dd;cbox(x+ln/2,y+ln/4,ln,w,(n-j)*sh,mul(c,1.0+.04*j))
@deco
def d_cave(x,y,u,v,p):
    c=p.get('col',(120,118,114))
    for ox,oy,r in((-12,2,12),(11,3,11),(0,-8,17)): ball(x+ox*u,y+oy*v-r*.4*v,r*u,mul(c,1.0+oy*.01))
    ell(x+5*u,y-5*v,6*u,8*v,(20,18,24),(60,56,60))
@deco
def d_dice(x,y,u,v,p):
    S_=p.get('S',24)*u;h=p.get('H',26)*v;c=p.get('col',(244,242,236));pc=p.get('pc',(200,30,44))
    cbox(x,y,S_,S_,h,c);N=(x,y+S_/2);N1=(x,y-h+S_/2)
    for f,g in((.25,.25),(.5,.5),(.75,.75)): ell(N[0]-f*S_,N[1]-f*S_/2-g*h,1.5*u,2.0*v,pc,mul(pc,.6))
    for f,g in((.3,.7),(.7,.3)): ell(N[0]+f*S_,N[1]-f*S_/2-g*h,1.5*u,2.0*v,mul(pc,.7),mul(pc,.4))
    for f,g in((.22,.22),(.78,.22),(.22,.78),(.78,.78),(.5,.5)): ell(N1[0]-f*S_+g*S_,N1[1]-f*S_/2-g*S_/2,1.8*u,.9*u,pc,mul(pc,.6))
@deco
def d_lever(x,y,u,v,p):
    lw((x,y),(x+2*u,y-22*v),(150,150,158),2);ball(x+2*u,y-25*v,3.4*u,(214,40,50));cbox(x,y+1,5*u,5*u,3*v,(90,90,98))
@deco
def d_bench(x,y,u,v,p):
    c=p.get('col',(150,104,68))
    for t_ in(-5,5): cbox(x+t_*u,y-t_*u/2,2*u,2*u,4*v,mul(c,.7))
    t=cbox(x,y-4*v,12*u,5*u,2*v,c);cbox(t[0]-1*u,t[1]-1*v,12*u,1.5*u,5*v,mul(c,.9))
@deco
def d_ema(x,y,u,v,p):
    rect(x-6*u,y-18*v,x-4.5*u,y,(110,80,56));rect(x+4.5*u,y-18*v,x+6*u,y,(110,80,56));rect(x-7*u,y-19*v,x+7*u,y-17*v,(96,66,46))
    for i in range(5):
        px0=x-5*u+i*2.3*u;rect(px0,y-16*v,px0+1.8*u,y-11*v,(226,196,140))
def c_chimney(x,y,Lt): cbox(x,y,4,4,16,(150,102,84));_puffs(x,y-18)
def c_steam(x,y,Lt): _puffs(x,y-2)
def c_chigi(x,y,Lt): lw((x-6,y),(x+3,y-13),(236,226,200),2);lw((x+6,y),(x-3,y-13),(236,226,200),2)
def c_finial(x,y,Lt): lw((x,y-4),(x,y-12),(226,184,70),1);ball(x,y-4,3,(226,184,70))
def c_sorin(x,y,Lt):
    lw((x,y),(x,y-30),(190,150,60),1)
    for i in range(5): ell(x,y-6-i*4,3.4-i*.45,1.4,(226,184,70))
    ball(x,y-31,2.4,(240,200,80))
def c_beacon(x,y,Lt): lw((x,y),(x,y-18),(80,80,86),1);ball(x,y-20,2.4,(255,60,50))
def c_neon_star(x,y,Lt):
    lw((x,y),(x,y-8),(120,120,130),1);cx0,cy0=x,y-16;pts=[]
    for i in range(10):
        a=-math.pi/2+i*math.pi/5;r=9 if i%2==0 else 4;pts.append((cx0+r*math.cos(a),cy0+r*math.sin(a)))
    poly(pts,(255,226,70),(255,70,150))
def c_beam(x,y,Lt):
    for yy in range(0,60):
        hw=2.5+yy*.12
        for xx in range(int(-hw),int(hw)+1):
            if abs(xx)>=int(hw) or (xx+yy)%2==0: put(x+xx,y-yy,(255,246,176) if abs(xx)>=int(hw) else (255,252,222))
def c_cone(x,y,Lt,col=(176,48,56)):
    r=max(5,Lt*.55);poly([(x-r,y),(x+r,y),(x,y-r*1.7)],col);poly([(x,y),(x+r,y),(x,y-r*1.7)],mul(col,.7));lw((x,y-r*1.7),(x,y-r*1.7-6),(70,70,76),1)
def c_cone2(x,y,Lt): c_cone(x,y,Lt,(46,100,170))
def c_sun(x,y,Lt):
    cx0,cy0=x,y-14
    for ang in range(0,360,30): a=math.radians(ang);lw((cx0+8*math.cos(a),cy0+8*math.sin(a)),(cx0+14*math.cos(a),cy0+14*math.sin(a)),(240,196,60),1)
    ball(cx0,cy0,6,(250,206,70))
def c_trident(x,y,Lt):
    c=(226,190,80);lw((x,y),(x,y-22),c,2);lw((x-6,y-22),(x+6,y-22),c,1);lw((x-6,y-22),(x-6,y-28),c,1);lw((x+6,y-22),(x+6,y-28),c,1);lw((x,y-22),(x,y-30),c,1)
def c_roulette(x,y,Lt):
    R=max(8,Lt*.46);y0=y-2;ell(x,y0,R,R/2,(214,170,64))
    for i in range(12):
        a1=2*math.pi*i/12;a2=2*math.pi*(i+1)/12;col=(190,30,40) if i%2==0 else (26,26,32)
        poly([(x,y0),(x+R*.85*math.cos(a1),y0+R*.425*math.sin(a1)),(x+R*.85*math.cos(a2),y0+R*.425*math.sin(a2))],col,col)
    ell(x,y0,R*.28,R*.14,(226,190,80));ball(x+R*.5,y0+1,1.4,(250,250,250))
def c_stupa(x,y,Lt):
    r=max(8,Lt*.5);d.ellipse([x-r,y-r,x+r,y+r*.4],fill=(240,238,228,255),outline=(120,116,108,255));d.ellipse([x-r*.6,y-r*.9,x-r*.1,y-r*.5],fill=(252,250,244,255))
    cbox(x,y-r*.9,5,5,4,(226,184,70));c_sorin(x,y-r*.9-4,Lt)
CROWN2={k[2:]:f for k,f in list(globals().items()) if k.startswith('c_') and callable(f)}
def JB(L,h,R=None,rc=(70,76,86),rise=12,e=4,typ='hipR',**o): return B(L,h,R=R,kind=o.pop('kind','wood'),roof=(typ,rc,rise),eave=e,**o)
def D(k,off=(0,0),z=None,**o): return S([dict(t='d',k=k,**o)],off=off,z=z,crown=False)

def clutter(ctr,L,R,seed,roof):
    if L*R<500: return
    for i in range(1+L*R//900):
        f=(hsh(i,L,seed)%100)/100-.5;g=(hsh(i,R,seed+1)%100)/100-.5
        px_=ctr[0]+(f-g)*min(L,R)*.35;py_=ctr[1]+(f+g)*min(L,R)*.18
        sbox(px_,py_+2,3,3,2,lerp(roof,(150,152,150),.6))
def grade():
    for yy in range(H):
        for xx in range(W):
            r_,g_,b_,a_=px[xx,yy]
            if a_==0: continue
            l=.3*r_+.59*g_+.11*b_;k=.62;n=hsh(xx,yy,5)%9-4
            px[xx,yy]=tuple(max(0,min(255,int((l+(c_-l)*k)*.93+n))) for c_ in (r_,g_,b_))+(255,)
def B(L,h,R=None,**o): return dict(t='b',L=L,R=R or L,h=h,**o)
def C(r,h,**o): return dict(t='c',r=r,h=h,**o)
def LIFT(h): return dict(t='lift',h=h)
def S(parts,off=(0,0),z=None,crown=True,tile=None,cr=None): return dict(parts=parts,off=off,z=z,crown=crown,tile=tile,cr=cr)
def SB(L,R,h,col,**o): return dict(t='sb',L=L,R=R,h=h,col=col,**o)
KW={'glass':((5,5),(4,4)),'stripe':((8,5),(8,4)),'concrete':((8,6),(7,5)),'lattice':((4,4),(4,4)),'brick':((8,10),(7,9)),'plaster':((8,10),(7,9)),'columns':((8,10),(7,9)),'stone':((8,6),(7,5)),'wood':((8,10),(7,9)),'neon':((5,5),(4,4))}
def mkst(pal,kind,big):
    ww,wh=KW[kind][0 if big else 1];glass=kind in('glass','lattice','stripe','neon')
    return {'kind':kind,'top':mul(pal,1.1) if glass else pal,'bot':mul(pal,.6) if glass else mul(pal,.94),'win':(120,172,206) if not glass else mul(pal,.8),'ww':ww,'wh':wh}
SC={'S':(.46,.5),'M':(.6,.72),'L':(1,1)}
def render(stacks,pal,kind,size,gk,cr,ex,seed):
    new();G['v']=ex.get('gv',0);G['w']=ex.get('water',(96,190,200));G['p']=ex.get('pool');fs,hs=SC[size];big=size=='L';hw=64 if big else 32;ground(150,hw,GROUNDS[gk]);st0=mkst(pal,kind,big)
    for sk in stacks:
        if sk.get('tile'): s0,t0=sk['tile'];sk['off']=(((s0-t0)*hw)/fs,((s0+t0)*hw/2)/fs)
    stacks=sorted(stacks,key=lambda s:(s['z'] if s['z'] is not None else s['off'][1],s['off'][0]))
    if ex.get('tree'):
        for tx,ty in((64-hw+13,153),(64+hw-13,153)) if not big else((12,150),(116,150),(40,178),(88,178)):
            d.rectangle([tx-1,ty,tx,ty+5],fill=(96,60,36,255));d.ellipse([tx-5,ty-9,tx+5,ty+3],fill=(56,120,48,255),outline=(30,70,30,255))
    for si,sk in enumerate(stacks):
        ctr=(64+sk['off'][0]*fs,150+sk['off'][1]*fs);lastL=20
        for n,p in enumerate(sk['parts']):
            ctr=(ctr[0]+p.get('dx',0)*fs,ctr[1]+p.get('dy',0)*fs)
            if p['t']=='lift': ctr=(ctr[0],ctr[1]-p['h']*hs);continue
            if p['t']=='d':
                sc_=p.get('sc',1);DECO[p['k']](ctr[0],ctr[1],fs*sc_,hs*sc_,p);continue
            st=dict(st0)
            if p.get('kind') or p.get('pal'): st=mkst(p.get('pal',pal),p.get('kind',kind),big)
            if p['t']=='b':
                L=max(5,p['L']*fs);R=max(5,p['R']*fs);h=max(3,p['h']*hs);cx=ctr[0]-(R-L)/2;cy=ctr[1]+(L+R)/4
                dr=None
                if p.get('door'): dr=(int(R/2-3),int(R/2+3),9 if big else 6)
                ho=p.get('hole');ho=(int(R*ho[0]),int(R*ho[1]),int(h*ho[2]),int(h*ho[3])) if ho else None
                bd=p.get('band');bd=(int(h*bd[0]),int(h*bd[1])) if bd else None
                rf=p.get('roof');rc=p.get('rc',(120,120,126))
                c2=box(cx,cy,L,R,h,st,seed+n+si*3,roof=rc,top=not rf,door=dr,hole=ho,gr=p.get('gr',False),band=bd)
                if rf: eo=round(p.get('eave',0)*fs);pitched(round(cx),round(cy)+eo,round(L)+2*eo,round(R)+2*eo,round(h),rf[2]*hs if rf[2]>3 else rf[2],rf[1],rf[0],st['top'])
                if p.get('clock'): clockface(round(cx),round(cy),round(L),round(R),round(h))
                ctr=c2;lastL=max(L,R)
            elif p['t']=='sb':
                L=max(3,p['L']*fs);R=max(2,p['R']*fs);h=max(2,p['h']*hs);cx=ctr[0]-(R-L)/2;cy=ctr[1]+(L+R)/4
                sbox(cx,cy,L,R,h,p['col'])
                if p.get('stripe'): line((cx,cy-h*.5),(cx-L,cy-L/2-h*.5),p['stripe']);line((cx,cy-h*.5),(cx+R,cy-R/2-h*.5),mul(p['stripe'],.64))
                ctr=(cx+(R-L)/2,cy-h-(L+R)/4);lastL=max(L,R)
            else:
                ctr=cyl(ctr,p['r']*fs,max(4,p['h']*hs),st,seed+n,p.get('taper',1.0),p.get('rc',(120,120,126)));lastL=p['r']*fs*2
        cc=sk.get('cr') or cr
        if sk['crown'] and cc!='none': crown(cc,ctr,lastL)
    if ex.get('flag'):
        fx=64+hw-18 if big else 64+hw-9;fy=150+(6 if not big else 14);line((fx,fy),(fx,fy-26),(80,80,86));poly([(fx,fy-26),(fx+9,fy-23),(fx,fy-19)],(210,56,48),(110,20,20))
    grade();return im.copy()
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
RED=(214,64,48);WHT=(238,238,242)
NAMES=['電波塔(格子鉄塔)','スカイツリー風','スペースニードル風','灯台','時計塔','五重塔','エッフェル塔風','給水塔','ガラス超高層','レーダー通信塔']
def layout(a,v):
    A,Bc=[(RED,WHT),((70,120,196),(214,224,236))][v]
    if a==0:
        return [S([B([30,24,19,14,10,7,4][i],[22,22,22,22,22,22,14][i],R=[30,24,19,14,10,7,4][i],kind='lattice',pal=(A,Bc)[i%2]) for i in range(7)],cr='beacon')],'beacon',[]
    if a==1:
        s=[C(13,8,kind='plaster',pal=Bc),C(10,70,taper=.5,kind='stripe',pal=Bc),C(17,7,kind='glass',pal=(120,170,210),rc=Bc),C(7,16,taper=.8,kind='stripe',pal=Bc),C(12,6,kind='glass',pal=(120,170,210),rc=Bc),C(4,34,taper=.45,kind='stripe',pal=A)]
        return [S(s)],'beacon',[]
    if a==2:
        s=[C(6,58,taper=.9,kind='plaster',pal=Bc),C(24,5,kind='glass',pal=(200,214,226),rc=Bc),C(17,8,kind='glass',pal=(110,170,214),rc=(236,236,240)),C(6,12,taper=.5,kind='plaster',pal=Bc)]
        return [S(s)],'spire',[D('bush',off=(-40,10)),D('bush',off=(40,8))]
    if a==3:
        s=[C(16,18,taper=.88,kind='plaster',pal=Bc),C(14,16,taper=.9,kind='plaster',pal=A),C(12,16,taper=.9,kind='plaster',pal=Bc),C(10,14,taper=.9,kind='plaster',pal=A),C(9,3,kind='plaster',pal=(70,70,76)),C(6,10,kind='glass',pal=(255,226,130),rc=(70,70,76))]
        return [S(s,cr='cone')],'cone',[D('rock',off=(-34,10)),D('rock',off=(34,10)),D('rock',off=(30,-8))]
    if a==4:
        return [S([B(30,6,R=30,kind='stone',pal=(150,140,128)),B(22,70,R=22,kind='brick',pal=A if v==0 else (200,170,120),clock=True),B(26,6,R=26,kind='stone',pal=(150,140,128)),B(22,4,R=22,kind='plaster',pal=Bc,roof=('hip',(70,110,120) if v==0 else (150,70,56),22)),LIFT(22)],cr='flag')],'flag',[D('lamp',off=(-40,12),two=1),D('tree',off=(40,10))]
    if a==5:
        w=(196,66,48) if v==0 else (236,232,220);rc=(70,76,84) if v==0 else (90,110,96)
        s=[B(40,4,R=40,kind='stone',pal=(160,156,150))]
        for i in range(5): s+=[JB(28-i*4,12,28-i*4,rc=rc,rise=5,e=5,pal=w),LIFT(3)]
        return [S(s,cr='sorin')],'sorin',[D('pine',off=(-46,8)),D('pine',off=(46,-6),n=3),D('lantern',off=(30,22))]
    if a==6:
        h=[(.28,.72,.04,.66),(.3,.7,.04,.7),(.32,.68,.04,.7)]
        s=[B(44,26,R=44,kind='lattice',pal=A,hole=h[0]),B(30,26,R=30,kind='lattice',pal=Bc,hole=h[1]),B(22,6,R=22,kind='plaster',pal=A),B(14,26,R=14,kind='lattice',pal=A),B(8,26,R=8,kind='lattice',pal=Bc),B(4,24,R=4,kind='lattice',pal=A)]
        return [S(s,cr='flag')],'flag',[D('bush',off=(-44,10)),D('bush',off=(44,6))]
    if a==7:
        st=[]
        for i,(ox,oy) in enumerate(((0,-12),(-24,0),(24,0),(0,12))): st.append(S([B(3,34,R=3,kind='stone',pal=(120,110,100))],off=(ox,oy),z=-5+i,crown=False))
        st.append(S([LIFT(34),C(16,26,kind='stripe',pal=(150,170,196) if v==0 else (176,120,90),rc=(90,100,116))],z=30,cr='cone'))
        st.append(S([B(30,3,R=30,kind='stone',pal=(110,100,92))],z=-30,crown=False))
        return st,'cone',[]
    if a==8:
        s=[B(40,16,R=40,kind='glass',pal=A if v else (110,150,190),gr=True),B(32,50,R=32,kind='glass',pal=A if v else (110,150,190)),B(24,36,R=24,kind='glass',pal=Bc if v else (130,170,206)),B(16,26,R=16,kind='glass',pal=A if v else (110,150,190))]
        return [S(s,cr='spire')],'spire',[D('tree',off=(-44,10)),D('tree',off=(44,10)),D('lamp',off=(0,30))]
    return [S([B(26,6,R=26,kind='stone',pal=(150,150,156)),B(18,58,R=18,kind='concrete',pal=(200,200,206)),B(26,8,R=26,kind='plaster',pal=A)],cr='radial')],'radial',[D('bush',off=(-40,12)),D('bush',off=(42,6))]
def design(k):
    a,v=divmod(k,2);st,cr,dec=layout(a,v)
    gk={3:'sea',4:'plaza',5:'sand',8:'plaza',2:'lawn',1:'plaza'}.get(a,'gravel')
    ex={'gv':(0 if a==5 else v)}
    return a,v,RED,'lattice',gk,cr,st+dec,ex
def sprite(k,s):
    a,v,pal,kind,gk,cr,st,ex=design(k);return render(st,pal,kind,s,gk,cr,ex,k*7)
def label(k): a,v=divmod(k,2);return f'{k+1:02d}  type{a+1}-{v+1}'
if __name__=='__main__':
    rows=[]
    for k in range(20):
        a,v,pal,kind,gk,cr,st,ex=design(k);rows.append([k+1,NAMES[a],v+1,kind,gk,cr])
    export('tower',20,sprite,label,rows,['id','type','variant','facade','ground','crown'])
