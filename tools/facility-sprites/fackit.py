import os,sys,math,csv,zipfile
from PIL import Image,ImageDraw
W,H=128,192
im=d=px=None
def new(w=128,h=192):
    global im,d,px,W,H
    W,H=w,h;im=Image.new('RGBA',(W,H),(0,0,0,0));d=ImageDraw.Draw(im);px=im.load()
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
            if abs(u)+abs(v)<=1: put(W//2+dx,cc+dy,fn((u+v)/2,(v-u)/2,dx,dy))
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
def _crown0(kind,ctr,Lt):
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
    elif kind=='helipad':
        d.ellipse([x-9,y-4,x+9,y+4],outline=(235,235,235,255));line((x-3,y-2),(x-3,y+2),(235,235,235));line((x+3,y-2),(x+3,y+2),(235,235,235));line((x-3,y),(x+3,y),(235,235,235))
def B(L,h,R=None,**o): return dict(t='b',L=L,R=R or L,h=h,**o)
def C(r,h,**o): return dict(t='c',r=r,h=h,**o)
def LIFT(h): return dict(t='lift',h=h)
def S(parts,off=(0,0),z=None,crown=True,tile=None): return dict(parts=parts,off=off,z=z,crown=crown,tile=tile)
def SB(L,R,h,col,**o): return dict(t='sb',L=L,R=R,h=h,col=col,**o)
KW={'glass':((5,5),(4,4)),'stripe':((8,5),(8,4)),'concrete':((8,6),(7,5)),'lattice':((4,4),(4,4)),'brick':((8,10),(7,9)),'plaster':((8,10),(7,9)),'columns':((8,10),(7,9))}
def mkst(pal,kind,big):
    ww,wh=KW[kind][0 if big else 1];glass=kind in('glass','lattice','stripe')
    return {'kind':kind,'top':mul(pal,1.1) if glass else pal,'bot':mul(pal,.6) if glass else mul(pal,.94),'win':(120,172,206) if not glass else mul(pal,.8),'ww':ww,'wh':wh}

def _n(x,y,sd): return hsh(x,y,sd)/1000.
def blob(cx,cy,rx,ry,col,sd,rough=.55,hl=True):
    cols=[mul(col,.55),mul(col,.75),col,lerp(col,(210,230,120),.28)]
    for py in range(int(cy-ry-2),int(cy+ry+3)):
        for px_ in range(int(cx-rx-2),int(cx+rx+3)):
            e=((px_-cx)/rx)**2+((py-cy)/ry)**2
            if e>1+(_n(px_,py,sd)-.5)*rough: continue
            v=(-(px_-cx)/rx*.6-(py-cy)/ry*.8)+(_n(px_,py,sd+3)-.5)*.9
            k=3 if v>.55 else 2 if v>.0 else 1 if v>-.55 else 0
            if abs(v-.0)<.12 and (px_+py)%2: k=min(3,k+1)
            if not hl and k==3: k=2
            put(px_,py,cols[k])
def tree(kind,x,y,sc):
    x=int(x);y=int(y);r=max(3,int(5.4*sc));sd=hsh(x,y,7)%97
    for k in range(-r,r+2):
        if (k+r)%3!=2: put(x+k+2,y+1,(38,58,34))
    if kind in('round','sakura','maple','willow'):
        col={'round':(52,100,46),'sakura':(214,150,170),'maple':(176,92,44),'willow':(88,128,62)}[kind]
        for t in range(3): put(x,y-t,(88,60,38))
        blob(x,y-r-1,r,r*.92,col,sd)
        if kind=='willow':
            for k in(-r+1,0,r-1):
                for t in range(r): put(x+k,y-r+t,mul(col,.8) if t%2 else col)
    elif kind=='bush':
        blob(x,y-r//2-1,r*.9,r*.6,(60,112,50),sd,.5)
    elif kind=='tall':
        for t in range(3): put(x,y-t,(88,60,38))
        blob(x,y-r*1.6-1,r*.62,r*1.5,(44,92,46),sd,.45)
    elif kind=='conifer':
        hh=int(r*3.4)
        for t in range(2): put(x,y-t,(80,56,36))
        for j in range(hh):
            f=j/hh;w=int(.6+f*r*.95+(1.4 if j%4==0 and f>.15 else 0));yy=y-2-hh+j+1
            for px_ in range(x-w,x+w+1):
                m=(px_-x)/max(1,w);k=3 if m<-.55 else 2 if m<-.05 else 1 if m<.5 else 0
                if j%4==0 and k>0: k-=1
                put(px_,yy,[ (22,52,36),(30,72,44),(40,90,50),(62,118,64)][k])
    elif kind=='palm':
        for k in range(r*2+3): put(x+(k//4),y-k,(130,96,58) if k%2 else (112,80,48))
        tx=x+(r*2+3)//4;ty=y-r*2-3
        for a in range(0,360,45):
            ex=tx+math.cos(math.radians(a))*r*1.5;ey=ty+math.sin(math.radians(a))*r*.8+(abs(math.cos(math.radians(a)))*2)
            line((tx,ty),(ex,ey),(58,112,52) if a%90 else (74,130,62))
def scatter(tagfn,n,seed,minsep,kinds):
    pts=[];tries=0
    while len(pts)<n and tries<n*60+20:
        tries+=1;s_=(hsh(tries,seed,1)/1000-.5)*.9;t_=(hsh(tries,seed,2)/1000-.5)*.9
        if tagfn(s_,t_)!='grass' or any((s_-a)**2+(t_-b)**2<minsep**2 for a,b,_ in pts): continue
        pts.append((s_,t_,kinds[hsh(tries,seed,3)%len(kinds)]))
    return pts
PATHC=(196,182,150);PATHE=(150,136,108)
def _pc(dist,w,dx,dy): return PATHE if dist>w-.018 else (PATHC if (dx+dy)%2 else mul(PATHC,.96))
def Lcross(w): return lambda s,t,dx,dy:((_pc(min(abs(s),abs(t)),w,dx,dy),'path') if min(abs(s),abs(t))<w else None)
def Ldiag(w): return lambda s,t,dx,dy:((_pc(min(abs(s-t),abs(s+t))/1.41,w,dx,dy),'path') if min(abs(s-t),abs(s+t))/1.41<w else None)
def Lring(r,w): return lambda s,t,dx,dy:((_pc(abs(math.hypot(s,t)-r),w,dx,dy),'path') if abs(math.hypot(s,t)-r)<w else None)
def Lcurve(w): return lambda s,t,dx,dy:((_pc(abs(t-.22*math.sin(s*8)),w,dx,dy),'path') if abs(t-.22*math.sin(s*8))<w else None)
def Lplaza(r): return lambda s,t,dx,dy:(((170,168,160) if (dx//3+dy//3)%2 else (158,156,148),'paved') if max(abs(s),abs(t))<r else None)
def Lpond(cx,cy,rx,ry):
    def f(s,t,dx,dy):
        e=((s-cx)/rx)**2+((t-cy)/ry)**2
        if e<1: return ((70,150,204) if (dx+dy)%3 else (104,178,226),'water')
        if e<1.28: return ((214,200,150),'sand')
    return f
def Lrect(s0,s1,t0,t1,col,tag='paved',dith=0): return lambda s,t,dx,dy:((mul(col,1.06) if (dith and (dx+dy)%2) else col,tag) if s0<s<s1 and t0<t<t1 else None)
def Lfield():
    def f(s,t,dx,dy):
        if abs(s)<.4 and abs(t)<.3:
            c=(96,160,64) if int((s+.5)*12)%2 else (88,150,58)
            if abs(abs(s)-.4)<.014 and abs(t)<.3 or abs(abs(t)-.3)<.014 and abs(s)<.4 or abs(s)<.012 or abs(math.hypot(s,t)-.1)<.012: c=(240,240,236)
            return c,'field'
    return f
def Ldiamond():
    def f(s,t,dx,dy):
        if abs(s)+abs(t)<.3: return ((176,132,88) if (dx+dy)%3 else (166,122,80),'field')
        if abs(abs(s)+abs(t)-.3)<.012: return (240,240,236),'field'
    return f
def Lbeds(cells):
    def f(s,t,dx,dy):
        for s0,s1,t0,t1,c1,c2 in cells:
            if s0<s<s1 and t0<t<t1: return (c1 if (dx+dy)%2 else c2),'bed'
    return f
def Lsteps(cx,cy,r0,r1):
    def f(s,t,dx,dy):
        r=math.hypot(s-cx,t-cy)
        if r0<r<r1 and (s-cx)-(t-cy)<.08: return ((176,174,168) if int((r-r0)/.045)%2 else (146,144,138)),'paved'
    return f
def Lzen(cx,cy,r):
    def f(s,t,dx,dy):
        e=math.hypot(s-cx,t-cy)
        if e<r: return ((226,222,210) if int(e*46)%2 else (206,202,190),'gravel')
    return f
def Lmaze():
    def f(s,t,dx,dy):
        m=max(abs(s),abs(t))
        if .14<m<.44 and int((m-.14)/.06)%2==0 and not(abs(s)<.04 and int((m-.14)/.06)%4==0) and not(abs(t)<.04 and int((m-.14)/.06)%4==2): return (44,96,44),'hedge'
    return f
def Lcloth(lst): return lambda s,t,dx,dy:next((((c),'cloth') for a,b,c in lst if abs(s-a)<.05 and abs(t-b)<.05),None)
def Lfence(): return lambda s,t,dx,dy:(((150,110,70),'fence') if .42<max(abs(s),abs(t))<.45 else None)
def _mkground0(layers,base=0):
    def f(s,t,dx,dy):
        n=hsh(dx,dy)
        c=((78,124,58) if n>120 else (70,114,52)) if base==0 else ((190,172,128) if n>140 else (180,162,118)) if base==1 else ((112,140,84) if n>120 else (104,132,78))
        if n>970: c=lerp(c,(255,255,255),.15)
        tag='grass'
        if max(abs(s),abs(t))>.47: c=mul(c,.78)
        for L in layers:
            r=L(s,t,dx,dy)
            if r: c,tag=r
        return c,tag
    return f
def draw_stack(sk,pal,kind,geo,cr,seed,si,cc):
    fs,hs=geo['fs'],geo['hs'];hw=geo['hw'];big=geo['big']
    if sk.get('tile'): s0,t0=sk['tile'];ox,oy=(s0-t0)*hw,(s0+t0)*hw/2
    else: ox,oy=sk['off'][0]*fs,sk['off'][1]*fs
    ctr=(W//2+ox,cc+oy);lastL=20
    for n,p in enumerate(sk['parts']):
        ctr=(ctr[0]+p.get('dx',0)*fs,ctr[1]+p.get('dy',0)*fs)
        if p['t']=='lift': ctr=(ctr[0],ctr[1]-p['h']*hs);continue
        pl=p.get('pal',pal);st=mkst(pl,p.get('kind',kind),big)
        if p['t']=='b':
            L=max(4,p['L']*fs);R=max(4,p['R']*fs);h=max(3,p['h']*hs);cx=ctr[0]-(R-L)/2;cy=ctr[1]+(L+R)/4;dr=None
            if p.get('door'): dr=(int(R/2-3),int(R/2+3),9 if big else 6)
            ho=p.get('hole');ho=(int(R*ho[0]),int(R*ho[1]),int(h*ho[2]),int(h*ho[3])) if ho else None
            bd=p.get('band');bd=(int(h*bd[0]),int(h*bd[1])) if bd else None
            rf=p.get('roof');rc=p.get('rc',(120,120,126))
            c2=box(cx,cy,L,R,h,st,seed+n+si*3,roof=rc,top=not rf,door=dr,hole=ho,gr=p.get('gr',False),band=bd)
            if rf: pitched(round(cx),round(cy),round(L),round(R),round(h),rf[2]*hs if rf[2]>3 else rf[2],rf[1],rf[0],st['top'])
            if p.get('clock'): clockface(round(cx),round(cy),round(L),round(R),round(h))
            ctr=c2;lastL=max(L,R)
        elif p['t']=='sb':
            L=max(2,p['L']*fs);R=max(2,p['R']*fs);h=max(2,p['h']*hs);cx=ctr[0]-(R-L)/2;cy=ctr[1]+(L+R)/4
            sbox(cx,cy,L,R,h,p['col']);ctr=(cx+(R-L)/2,cy-h-(L+R)/4);lastL=max(L,R)
        elif p['t'] in EXTRA_PARTS:
            ctr=EXTRA_PARTS[p['t']](p,ctr,fs,hs,st,seed+n);lastL=p.get('r',p.get('L',20))*fs*2
        else:
            ctr=cyl(ctr,p['r']*fs,max(2,p['h']*hs),st,seed+n,p.get('taper',1.0),p.get('rc',(120,120,126)));lastL=p['r']*fs*2
    if sk['crown'] and cr!='none': crown(cr,ctr,lastL)
def render3(stacks,trees,gfn,pal,kind,geo,cr,seed):
    new(geo['w'],geo['h']);hw=geo['hw'];cc=geo['h']-hw//2-geo.get('pad',6);ground(cc,hw,gfn);items=[]
    for si,sk in enumerate(stacks):
        key=(sum(sk['tile']) if sk.get('tile') else sk['off'][1]*geo['fs']/(hw/2));items.append((key,1,si,sk))
    for tr in trees: items.append((tr[0]+tr[1],0,0,tr))
    items.sort(key=lambda a:(a[0],a[1]))
    for key,typ,si,o in items:
        if typ==0: tree(o[2],W//2+(o[0]-o[1])*hw,cc+(o[0]+o[1])*hw/2,geo['tsc'])
        else: draw_stack(o,pal,kind,geo,cr,seed,si,cc)
    return im.copy()
def grade(img,sat=.58,dark=.86,warm=(1.04,1.0,.9)):
    px_=img.load();w_,h_=img.size
    for y in range(h_):
        for x in range(w_):
            r,g_,b,a_=px_[x,y]
            if a_==0: continue
            l=.3*r+.59*g_+.11*b;r=l+(r-l)*sat;g_=l+(g_-l)*sat;b=l+(b-l)*sat
            lv=l/255.;k=dark*(.9+.2*lv*lv)
            r=min(255,r*k*warm[0]);g_=min(255,g_*k*warm[1]);b=min(255,b*k*warm[2])
            px_[x,y]=(int(r),int(g_),int(b),255)
    return img
def export3(name,n,geos,sprite_fn,label_fn,rows,header,cols=5):
    out=os.path.join(os.path.dirname(os.path.abspath(__file__)),name+'_out');os.makedirs(out+'/sprites',exist_ok=True);os.makedirs(out+'/sheets',exist_ok=True)
    nr=(n+cols-1)//cols;sz='SML';mw=max(cols*geos[s]['w'] for s in sz);th=sum(nr*geos[s]['h'] for s in sz);mega=Image.new('RGBA',(mw,th),(0,0,0,0));y0={};y=0
    for s in sz:
        y0[s]=y;g=geos[s]
        for k in range(n): mega.paste(sprite_fn(k,s),((k%cols)*g['w'],y+(k//cols)*g['h']))
        y+=nr*g['h']
    mega=grade(mega)
    q=mega.quantize(colors=48,method=Image.FASTOCTREE,dither=Image.NONE);tr=q.getpixel((0,0));zf=zipfile.ZipFile(out+f'/{name}_sprites.zip','w')
    for s in sz:
        g=geos[s];cw,ch=g['w'],g['h'];sh=q.crop((0,y0[s],cols*cw,y0[s]+nr*ch));sh.save(out+f'/sheets/{name}_sheet_{s}_8bit.png',transparency=tr)
        rg=sh.convert('RGBA');bg=Image.new('RGB',rg.size,(30,34,48));bg.paste(rg,(0,0),rg);pd=ImageDraw.Draw(bg)
        for k in range(n):
            x=(k%cols)*cw;yy=(k//cols)*ch;pd.rectangle([x,yy,x+cw-1,yy+ch-1],outline=(60,66,86));pd.text((x+3,yy+2),label_fn(k),fill=(200,205,220))
        bg.save(out+f'/sheets/{name}_preview_{s}.png')
        for k in range(n):
            p=out+f'/sprites/{name}_{k+1:02d}_{s}.png';q.crop(((k%cols)*cw,y0[s]+(k//cols)*ch,(k%cols)*cw+cw,y0[s]+(k//cols)*ch+ch)).save(p,transparency=tr);zf.write(p,f'{name}_{k+1:02d}_{s}.png')
    zf.close();csv.writer(open(out+f'/{name}_list.csv','w',newline='',encoding='utf-8-sig')).writerows([header]+rows);print('出力先:',out)
GEO={'S':dict(w=64,h=116,hw=32,fs=.5,hs=.6,tsc=.75,big=False,pad=6),'M':dict(w=128,h=184,hw=64,fs=1,hs=1,tsc=1,big=True,pad=8),'L':dict(w=192,h=260,hw=96,fs=1.5,hs=1.4,tsc=1.1,big=True,pad=10)}
HPAL=[(236,232,220),(214,196,160),(190,98,70),(176,176,182),(150,190,220),(130,190,170),(232,220,190),(120,170,150),(200,170,110),(150,160,176)]


# ===== 新しい施設向けの拡張(屋根の飾り・地面) =====
def crown(kind,ctr,Lt):
    x,y=ctr
    if kind=='marquee':
        sbox(x,y+3,16,3,10,(24,24,34));
        for i in range(7): put(x-14+i*2,y-4-i,(255,226,120));put(x-14+i*2,y-1-i,(255,226,120))
        line((x-12,y-6),(x-2,y-11),(240,70,70))
    elif kind=='redcross':
        sbox(x,y+3,12,12,10,(244,244,240));d.rectangle([x-2,y-8,x+1,y-1],fill=(214,40,40,255));d.rectangle([x-5,y-6,x+4,y-3],fill=(214,40,40,255))
    elif kind=='searchlight':
        for a in(-.7,0,.7): line((x+a*4,y),(x+a*18,y-34),(255,255,214))
        d.ellipse([x-4,y-2,x+4,y+2],fill=(220,220,228,255))
    elif kind=='umbrella':
        for ox,oy,c in((-9,2,(220,60,60)),(6,4,(250,200,60)),(0,-3,(70,150,220))):
            line((x+ox,y+oy),(x+ox,y+oy-12),(90,70,50));poly([(x+ox-7,y+oy-10),(x+ox+7,y+oy-10),(x+ox,y+oy-17)],c)
    elif kind=='whale':
        d.ellipse([x-12,y-9,x+12,y+2],fill=(70,130,200,255),outline=(30,70,120,255));poly([(x+10,y-5),(x+18,y-12),(x+16,y-3)],(70,130,200),(30,70,120));put(x-8,y-6,(255,255,255))
    elif kind=='lift':
        line((x,y),(x,y-26),(90,90,96));line((x-12,y-24),(x+12,y-30),(60,60,66))
        for ox in(-10,10): d.rectangle([x+ox-2,y-24+(0 if ox<0 else -6),x+ox+2,y-20+(0 if ox<0 else -6)],fill=(220,70,60,255))
    elif kind=='pennants':
        line((x,y),(x,y-20),(70,70,76))
        for i,c in enumerate(((220,60,60),(250,200,60),(70,150,220),(80,180,100))): poly([(x,y-20+i*4),(x+9,y-18+i*4),(x,y-16+i*4)],c)
    elif kind=='clocktop':
        sbox(x,y+2,8,8,10,(236,232,220));clockface(round(x),round(y+2),8,8,10);pitched(round(x),round(y+2),8,8,10,9,(70,100,110),'hip',(236,232,220))
    elif kind=='neon':
        sbox(x,y+3,14,2,10,(40,40,56))
        for i in range(6): put(x-12+i*2,y-3-i,(255,70,170));put(x-12+i*2,y-1-i,(80,220,255))
    elif kind=='train':
        sbox(x,y+3,16,3,8,(220,224,230));line((x-14,y-4),(x-2,y-9),(60,120,200));d.rectangle([x-12,y-9,x-9,y-6],fill=(255,226,120,255))
    else: _crown0(kind,ctr,Lt)
BASES=[((78,124,58),(70,114,52)),((190,172,128),(180,162,118)),((112,140,84),(104,132,78)),((238,242,248),(226,232,242)),((236,214,160),(226,204,150)),((92,146,70),(84,136,62)),((86,86,92),(78,78,84)),((228,226,220),(214,212,206))]
def mkground(layers,base=0):
    def f(s,t,dx,dy):
        n=hsh(dx,dy);a,b=BASES[base];c=a if n>120 else b
        if n>970: c=lerp(c,(255,255,255),.15)
        tag='grass'
        if max(abs(s),abs(t))>.47: c=mul(c,.78)
        for Ly in layers:
            r=Ly(s,t,dx,dy)
            if r: c,tag=r
        return c,tag
    return f
SEA=((60,140,200),(96,172,222))
def Lsea(t0):
    """t>t0 が海(砂浜の縁つき)"""
    def f(s,t,dx,dy):
        if t>t0+.05: return ((SEA[0] if (dx+dy)%3 else SEA[1]),'water')
        if t>t0: return ((250,246,230),'sand')
    return f
def Lwave(t0):
    return lambda s,t,dx,dy:(((250,252,255),'water') if t0+.05<t and (int(s*40)+dx)%9==0 and (dy%4==0) else None)
def Lpiste(w,off=0.0,col=(250,252,255)):
    """斜めのゲレンデ(雪面。両脇に目印の旗)"""
    def f(s,t,dx,dy):
        d_=abs((s+t)-off)
        if d_<w: return ((col if int((s-t)*30)%2 else (204,226,246)),'snow')
        if d_<w+.02 and (dx+dy)%6<2: return ((200,70,60),'pole')
    return f
def Lgreen(cx,cy,r):
    def f(s,t,dx,dy):
        e=math.hypot(s-cx,t-cy)
        if e<r: return ((120,190,90) if (dx+dy)%2 else (112,182,84),'green')
        if abs(e-r)<.012: return (214,230,200),'green'
    return f
def Lbunker(cx,cy,rx,ry):
    def f(s,t,dx,dy):
        if ((s-cx)/rx)**2+((t-cy)/ry)**2<1: return (236,220,170),'sand'
    return f
def Lfairway(w,ang=0.0):
    def f(s,t,dx,dy):
        d_=abs(t-s*ang)
        if d_<w: return (((104,170,70) if int((s+.5)*14)%2 else (98,162,64)),'fairway')
    return f
def Lasphalt(s0,s1,t0,t1):
    def f(s,t,dx,dy):
        if s0<s<s1 and t0<t<t1:
            if abs(((t-t0)*18)%2-1)<.12 and (s-s0)>.04: return (214,214,208),'asphalt'
            return ((84,84,90) if (dx+dy)%2 else (78,78,84)),'asphalt'
    return f
def Lrails(t0,t1,n=3):
    def f(s,t,dx,dy):
        if t0<t<t1:
            for k in range(n):
                tk=t0+(k+.5)*(t1-t0)/n
                if abs(abs(t-tk)-.03)<.014: return (200,200,208),'rail'
                if abs(t-tk)<.03 and int((s+.5)*24)%2==0: return (96,72,52),'rail'
    return f
def Ltrack(r0,r1):
    def f(s,t,dx,dy):
        m=max(abs(s)*1.0,abs(t)*1.3)
        if r0<m<r1: return ((196,98,70) if (dx+dy)%2 else (186,90,64)),'track'
    return f
def Ltank(s0,s1,t0,t1):
    """水槽(青い水面。縁は白)"""
    def f(s,t,dx,dy):
        if s0-.02<s<s1+.02 and t0-.02<t<t1+.02 and not(s0<s<s1 and t0<t<t1): return (236,236,230),'paved'
        if s0<s<s1 and t0<t<t1: return ((66,150,208) if (dx+dy)%3 else (110,184,228)),'water'
    return f
def Lcourt(s0,s1,t0,t1,col=(70,140,200)):
    def f(s,t,dx,dy):
        if s0<s<s1 and t0<t<t1:
            c=col if (dx+dy)%2 else mul(col,.96)
            if abs(s-(s0+s1)/2)<.012 or abs(t-(t0+t1)/2)<.012: c=(240,240,236)
            return c,'court'
    return f


# ===== 遊園地・スタジアム向けの部品 =====
def W(r,**o): return dict(t='wheel',r=r,**o)            # 観覧車
def TENT(r,h,**o): return dict(t='tent',r=r,h=h,**o)    # サーカステント
def CAR(r,**o): return dict(t='carousel',r=r,**o)       # メリーゴーランド
def COAST(L,h,**o): return dict(t='coaster',L=L,h=h,**o)  # ジェットコースター
def SLIDE(L,h,**o): return dict(t='slide',L=L,h=h,**o)  # ウォータースライダー
def BOWL(r,h,**o): return dict(t='bowl',r=r,h=h,**o)    # 円形のスタンド(競技場)
def PBOX(L,R,h,**o): return dict(t='pbox',L=L,R=R,h=h,**o)  # 長方形のスタンド(中央がフィールド)
def _ellipse(cx,cy,rx,ry,fill,outline=None):
    d.ellipse([cx-rx,cy-ry,cx+rx,cy+ry],fill=(*fill,255),outline=(*(outline or mul(fill,.55)),255))
def _pitch(cx,cy,rx,ry,kind):
    """フィールドの描画(楕円の中)。kind: soccer / diamond / track / court / plain"""
    if kind=='track':
        _ellipse(cx,cy,rx,ry,(188,92,66));_ellipse(cx,cy,rx*.74,ry*.74,(236,232,222));_ellipse(cx,cy,rx*.68,ry*.68,(104,170,76))
        line((cx-rx*.3,cy),(cx+rx*.3,cy),(240,240,236))
    elif kind=='diamond':
        _ellipse(cx,cy,rx,ry,(100,164,72));poly([(cx,cy-ry*.6),(cx+rx*.5,cy),(cx,cy+ry*.55),(cx-rx*.5,cy)],(176,132,88),(240,240,236))
    elif kind=='court':
        _ellipse(cx,cy,rx,ry,(70,140,200));line((cx-rx*.6,cy),(cx+rx*.6,cy),(240,240,236));d.ellipse([cx-rx*.18,cy-ry*.18,cx+rx*.18,cy+ry*.18],outline=(240,240,236,255))
    elif kind=='plain':
        _ellipse(cx,cy,rx,ry,(104,170,76))
    else:
        _ellipse(cx,cy,rx,ry,(96,164,70));line((cx,cy-ry),(cx,cy+ry),(240,240,236));d.ellipse([cx-rx*.22,cy-ry*.22,cx+rx*.22,cy+ry*.22],outline=(240,240,236,255))
def part_wheel(p,ctr,fs,hs,st,seed):
    x,y=round(ctr[0]),round(ctr[1]);r=p['r']*fs;hub=(x,y-r*1.18-3*fs)
    for sx in(-1,1): line((x+sx*r*.7,y+r*.18),hub,(120,120,130));line((x+sx*r*.7+sx,y+r*.18),(hub[0]+sx,hub[1]),(86,86,96))
    d.ellipse([hub[0]-r*.84,hub[1]-r,hub[0]+r*.84,hub[1]+r],outline=(*p.get('col',(226,226,232)),255),width=max(1,int(fs)))
    d.ellipse([hub[0]-r*.5,hub[1]-r*.6,hub[0]+r*.5,hub[1]+r*.6],outline=(*mul(p.get('col',(226,226,232)),.8),255))
    n=12
    for k in range(n):
        a=k*2*math.pi/n;ex=hub[0]+math.cos(a)*r*.84;ey=hub[1]+math.sin(a)*r
        line(hub,(ex,ey),(176,176,186))
        gc=[(220,60,60),(250,200,60),(70,150,220),(80,190,110),(220,120,200),(250,140,60)][k%6]
        d.rectangle([ex-1.5*fs/1.5,ey-1,ex+1.5*fs/1.5,ey+2*fs/1.5],fill=(*gc,255))
    d.ellipse([hub[0]-2,hub[1]-2,hub[0]+2,hub[1]+2],fill=(120,120,130,255))
    return (x,hub[1]-r)
def part_tent(p,ctr,fs,hs,st,seed):
    x,y=round(ctr[0]),round(ctr[1]);r=p['r']*fs;h=p['h']*hs;c1,c2=p.get('cols',((210,56,52),(244,240,230)))
    _ellipse(x,y,r,r/2,mul(c2,.8))
    n=14
    for k in range(n):
        a0=math.pi*k/n;a1=math.pi*(k+1)/n
        pts=[(x,y-h),(x+math.cos(a0)*r,y+math.sin(a0)*r/2),(x+math.cos(a1)*r,y+math.sin(a1)*r/2)]
        poly(pts,c1 if k%2 else c2,mul(c1 if k%2 else c2,.7))
    line((x,y-h),(x,y-h-8*fs),(70,70,76));poly([(x,y-h-8*fs),(x+8,y-h-6*fs),(x,y-h-4*fs)],(250,210,60),(120,90,20))
    return (x,y-h)
def part_carousel(p,ctr,fs,hs,st,seed):
    x,y=round(ctr[0]),round(ctr[1]);r=p['r']*fs
    _ellipse(x,y,r,r/2,(214,196,160));_ellipse(x,y-3*hs,r*.9,r*.45,(236,226,196))
    for k in range(8):
        a=k*2*math.pi/8;px_=x+math.cos(a)*r*.8;py_=y-3*hs+math.sin(a)*r*.4
        line((px_,py_),(px_,py_-14*hs),(244,214,120))
    top=y-3*hs-14*hs
    for k in range(12):
        a0=2*math.pi*k/12;a1=2*math.pi*(k+1)/12
        if math.sin((a0+a1)/2)<-.05: continue
        poly([(x,top-8*hs),(x+math.cos(a0)*r,top+math.sin(a0)*r/2),(x+math.cos(a1)*r,top+math.sin(a1)*r/2)],(220,70,90) if k%2 else (250,230,200),(120,40,50))
    line((x,top-8*hs),(x,top-14*hs),(200,170,60))
    return (x,top-8*hs)
def part_coaster(p,ctr,fs,hs,st,seed):
    x,y=round(ctr[0]),round(ctr[1]);L=p['L']*fs;H=p['h']*hs;N=40;pts=[]
    for i in range(N+1):
        t=i/N;gx=x-L+2*L*t;gy=y-L/2+L*t/1.0*.5*2*.5
        hh=H*(.18+.82*abs(math.sin(math.pi*(p.get('humps',2))*t+.4)))*(1-.3*abs(2*t-1))
        pts.append((gx,gy-hh,gy))
    for i in range(0,N+1,3):
        gx,ty,gy=pts[i];line((gx,ty),(gx,gy),(120,120,130))
    for i in range(N):
        a,b=pts[i],pts[i+1];col=p.get('col',(214,56,52))
        line((a[0],a[1]),(b[0],b[1]),col);line((a[0],a[1]+1),(b[0],b[1]+1),mul(col,.7))
    return (x,y-H)
def part_slide(p,ctr,fs,hs,st,seed):
    x,y=round(ctr[0]),round(ctr[1]);L=p['L']*fs;H=p['h']*hs
    d.rectangle([x-3*fs,y-H,x+3*fs,y],fill=(*p.get('pal',(230,230,236)),255),outline=(110,110,120,255))
    sx,sy=x,y-H
    pts=[]
    for i in range(30):
        t=i/29;pts.append((sx+L*t*1.1+6*fs*math.sin(t*9),sy+(y+L*.25-sy)*t**1.4))
    for i in range(29):
        for w in(0,1,2): line((pts[i][0],pts[i][1]+w),(pts[i+1][0],pts[i+1][1]+w),(90,190,230) if w!=2 else (50,130,180))
    return (x,y-H)
def part_bowl(p,ctr,fs,hs,st,seed):
    cx,c0y=round(ctr[0]),round(ctr[1]);r=p['r']*fs;h=p['h']*hs
    top=cyl((cx,c0y),p['r']*fs,h,st,seed,1.0,p.get('rc',(150,150,156)))
    _ellipse(cx,c0y-h,r*.97,r*.485,(70,76,96))
    for k,f in enumerate((.9,.8,.7)):
        d.ellipse([cx-r*f,c0y-h-r*f*.5,cx+r*f,c0y-h+r*f*.5],outline=(*lerp((70,76,96),(120,130,160),k/3),255))
    _pitch(cx,c0y-h,r*.6,r*.3,p.get('pitch','soccer'))
    return (cx,c0y-h-2)
def part_pbox(p,ctr,fs,hs,st,seed):
    L=max(4,p['L']*fs);R=max(4,p['R']*fs);h=max(3,p['h']*hs);cx=round(ctr[0]-(R-L)/2);cy=round(ctr[1]+(L+R)/4)
    c2=box(cx,cy,L,R,h,st,seed,roof=(120,120,126),top=False)
    A=(cx,cy-h);B=(cx-L,cy-L/2-h);C=(cx-L+R,cy-L/2-R/2-h);D=(cx+R,cy-R/2-h);ctr2=((A[0]+C[0])/2,(A[1]+C[1])/2)
    ring=lambda k:[(ctr2[0]+(q[0]-ctr2[0])*k,ctr2[1]+(q[1]-ctr2[1])*k) for q in (A,B,C,D)]
    poly(ring(1.0),(150,152,160),(80,80,88));poly(ring(.86),(70,76,96),(50,54,70));poly(ring(.74),(94,102,128),(60,66,86))
    pq=ring(.62);poly(pq,(100,166,72) if p.get('pitch','soccer')!='court' else (70,140,200),(236,236,230))
    k=p.get('pitch','soccer')
    if k=='diamond':
        qq=ring(.34);poly([qq[0],qq[1],qq[2],qq[3]],(176,132,88),(240,240,236))
    elif k=='track':
        poly(ring(.5),(236,232,222),(188,92,66));poly(ring(.42),(104,170,76),(240,240,236))
    elif k in('soccer','court'):
        m1=((pq[0][0]+pq[1][0])/2,(pq[0][1]+pq[1][1])/2);m2=((pq[2][0]+pq[3][0])/2,(pq[2][1]+pq[3][1])/2);line(m1,m2,(240,240,236))
    return ctr2
EXTRA_PARTS={'wheel':part_wheel,'tent':part_tent,'carousel':part_carousel,'coaster':part_coaster,'slide':part_slide,'bowl':part_bowl,'pbox':part_pbox}
_crown1=crown
def crown(kind,ctr,Lt):
    x,y=ctr
    if kind=='floodlights':
        for ox,oy in((-Lt*.5,Lt*.18),(Lt*.5,Lt*.18),(-Lt*.5,-Lt*.18),(Lt*.5,-Lt*.18)):
            line((x+ox,y+oy),(x+ox,y+oy-22),(120,120,128));d.rectangle([x+ox-4,y+oy-27,x+ox+4,y+oy-21],fill=(246,244,200,255),outline=(120,120,128,255))
    elif kind=='bannerflags':
        for i,c in enumerate(((220,60,60),(250,200,60),(70,150,220))):
            line((x-14+i*14,y),(x-14+i*14,y-24),(90,90,96));poly([(x-14+i*14,y-24),(x-5+i*14,y-21),(x-14+i*14,y-18)],c)
    elif kind=='ferrisflag':
        line((x,y),(x,y-14),(90,90,96));poly([(x,y-14),(x+9,y-11),(x,y-8)],(240,60,100))
    else: _crown1(kind,ctr,Lt)
