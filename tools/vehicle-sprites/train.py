"""Generates 8-direction vehicle sprites (renders a small 3D model rotated, in 2:1 isometric with a pixel-art look)
Directions: from 0 = facing lower right on screen (+X), counterclockwise in 45-degree steps: 0 lower right, 1 down, 2 lower left, 3 left, 4 upper left, 5 up, 6 upper right, 7 right
"""
import os,sys,math,csv,zipfile
from PIL import Image,ImageDraw
def mul(c,k): return tuple(max(0,min(255,int(v*k))) for v in c)
def lerp(a,b,t): return tuple(int(a[n]+(b[n]-a[n])*t) for n in range(3))
def vnorm(v):
    m=math.sqrt(sum(a*a for a in v)) or 1;return tuple(a/m for a in v)
def dot(a,b): return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]
def sub(a,b): return (a[0]-b[0],a[1]-b[1],a[2]-b[2])
def cross(a,b): return (a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
VIEW=(1,1,1.2);LGT=vnorm((0.25,0.65,0.72))
def Mp(axis,u,v,w): return (u,v,w) if axis=='z' else ((u,w,v) if axis=='y' else (w,u,v))
def _cen(pts): return tuple(sum(p[i] for p in pts)/len(pts) for i in range(3))
def extrude(poly,axis,a0,a1,col):
    n=len(poly);P=lambda p,w:Mp(axis,p[0],p[1],w)
    faces=[[P(p,a0) for p in poly],[P(p,a1) for p in poly]]
    for i in range(n):
        p,q=poly[i],poly[(i+1)%n];faces.append([P(p,a0),P(q,a0),P(q,a1),P(p,a1)])
    return dict(faces=faces,col=col,cen=_cen([pt for f in faces[:2] for pt in f]))
def box(cx,cy,cz,lx,ly,lz,col):
    return extrude([(cx-lx/2,cy-ly/2),(cx+lx/2,cy-ly/2),(cx+lx/2,cy+ly/2),(cx-lx/2,cy+ly/2)],'z',cz-lz/2,cz+lz/2,col)
def tube(secs,col,sides=8):
    rings=[[(x,yc+ry*math.cos(2*math.pi*k/sides+math.pi/8),zc+rz*math.sin(2*math.pi*k/sides+math.pi/8)) for k in range(sides)] for (x,ry,rz,yc,zc) in secs]
    faces=[]
    for a,b in zip(rings,rings[1:]):
        for k in range(sides): k2=(k+1)%sides;faces.append([a[k],a[k2],b[k2],b[k]])
    faces.append(rings[0][::-1]);faces.append(rings[-1])
    return dict(faces=faces,col=col,cen=_cen([p for r in rings for p in r]))
def wheel(cx,cy,cz,r,w,col=(26,26,30),sides=8):
    rings=[[(cx+r*math.cos(2*math.pi*k/sides),y,cz+r*math.sin(2*math.pi*k/sides)) for k in range(sides)] for y in(cy-w/2,cy+w/2)]
    faces=[[rings[0][k],rings[0][(k+1)%sides],rings[1][(k+1)%sides],rings[1][k]] for k in range(sides)]+[rings[0][::-1],rings[1]]
    return dict(faces=faces,col=col,cen=(cx,cy,cz))
def loft(secs,col):
    n=len(secs[0][1]);faces=[]
    for (xa,pa),(xb,pb) in zip(secs,secs[1:]):
        for k in range(n):
            k2=(k+1)%n;faces.append([(xa,)+tuple(pa[k]),(xa,)+tuple(pa[k2]),(xb,)+tuple(pb[k2]),(xb,)+tuple(pb[k])])
    x0,p0=secs[0];x1,p1=secs[-1];faces.append([(x0,)+tuple(q) for q in p0][::-1]);faces.append([(x1,)+tuple(q) for q in p1])
    return dict(faces=faces,col=col,cen=_cen([f for fc in faces[-2:] for f in fc]))
def place(prims,dx=0,flip=False):
    out=[]
    for p in prims:
        def T(q):
            x,y,z=q
            if flip: x,y=-x,-y
            return (x+dx,y,z)
        d2=dict(p);d2['faces']=[[T(q) for q in f] for f in p['faces']];d2['cen']=T(p['cen'])
        if p.get('decal'):
            n=p['n'];d2['n']=(-n[0],-n[1],n[2]) if flip else n
        out.append(d2)
    return out
def decal(pts,n,col,cen,layer=0): return dict(faces=[pts],col=col,cen=cen,decal=True,n=n,layer=layer)
def rrect(cx,cy,ln,wd,ang):
    c,s=math.cos(math.radians(ang)),math.sin(math.radians(ang));r=[]
    for a,b in((ln/2,wd/2),(ln/2,-wd/2),(-ln/2,-wd/2),(-ln/2,wd/2)): r.append((cx+a*c-b*s,cy+a*s+b*c))
    return r
def rotz(p,c,s): return (p[0]*c-p[1]*s,p[0]*s+p[1]*c,p[2])
def render(prims,th,cw,ch,ox,oy):
    c,s=math.cos(th),math.sin(th);items=[]
    for i,p in enumerate(prims): items.append((dot(rotz(p['cen'],c,s),VIEW)+p.get('layer',0)*1e-3,i,p))
    items.sort(key=lambda t:(t[0],t[1]))
    img=Image.new('RGBA',(cw,ch),(0,0,0,0));dr=ImageDraw.Draw(img)
    for key,i,p in items:
        cen=rotz(p['cen'],c,s)
        for f in p['faces']:
            pts=[rotz(q,c,s) for q in f]
            if p.get('decal'): n=rotz(p['n'],c,s)
            else:
                n=vnorm(cross(sub(pts[1],pts[0]),sub(pts[2],pts[0])))
                if dot(n,sub(_cen(pts),cen))<0: n=(-n[0],-n[1],-n[2])
            if dot(n,VIEW)<=0.02: continue
            col=mul(p['col'],0.5+0.62*max(0,dot(n,LGT)))
            oc=col if p.get('decal') else mul(col,.5)
            dr.polygon([(round(ox+(q[0]-q[1])),round(oy+(q[0]+q[1])*.5-q[2]*.95)) for q in pts],fill=(*col,255),outline=(*oc,255))
    return img
def export_veh(name,n,cw,ch,model_fn,label_fn,rows,header,readme,ov=None,ov_cols=10,rows_per_sheet=25):
    out=os.path.join(os.path.dirname(os.path.abspath(__file__)),name+'_out');os.makedirs(out+'/vehicles',exist_ok=True);os.makedirs(out+'/sheets',exist_ok=True)
    full=Image.new('RGBA',(cw*8,ch*n),(0,0,0,0))
    for i in range(n):
        for k in range(8): full.paste(model_fn(i,k),(k*cw,i*ch))
    q=full.quantize(colors=255,method=Image.FASTOCTREE,dither=Image.NONE);tr=q.getpixel((0,0))
    zf=zipfile.ZipFile(out+f'/{name}_strips.zip','w')
    for i in range(n):
        p=out+f'/vehicles/{name}_{i+1:03d}.png';q.crop((0,i*ch,cw*8,(i+1)*ch)).save(p,transparency=tr);zf.write(p,f'{name}_{i+1:03d}.png')
    zf.close()
    csv.writer(open(out+f'/{name}_list.csv','w',newline='',encoding='utf-8-sig')).writerows([header]+rows)
    open(out+'/README.txt','w',encoding='utf-8').write(readme)
    per=rows_per_sheet
    for sh in range((n+per-1)//per):
        r0=sh*per;r1=min(n,r0+per);cr_=q.crop((0,r0*ch,cw*8,r1*ch));cr_.save(out+f'/sheets/{name}_sheet{sh+1}_8bit.png',transparency=tr)
        rg=cr_.convert('RGBA');bg=Image.new('RGB',rg.size,(30,34,48));bg.paste(rg,(0,0),rg);pd=ImageDraw.Draw(bg)
        for i in range(r1-r0):
            pd.line([(0,i*ch),(cw*8,i*ch)],fill=(56,62,80));pd.text((3,i*ch+2),label_fn(r0+i),fill=(200,205,220))
        bg=bg.resize((bg.width*2,bg.height*2),Image.NEAREST);bg.save(out+f'/sheets/{name}_preview{sh+1}.png')
    rg=q.convert('RGBA');cols=ov_cols;idxs=list(ov) if ov else list(range(n));rows_=(len(idxs)+cols-1)//cols;oi=Image.new('RGB',(cols*cw,rows_*ch),(30,34,48))
    for t,i in enumerate(idxs):
        c=rg.crop((0,i*ch,cw,(i+1)*ch));oi.paste(c,((t%cols)*cw,(t//cols)*ch),c)
    oi.save(out+f'/{name}_overview.png');print('出力先:',out)
BODY=[(236,236,240),(188,194,202),(232,224,196),(232,120,36),(52,120,70),(40,96,176),(200,40,40),(240,200,40),(130,190,230),(110,70,50),(36,40,46),(30,150,150),(232,140,170),(120,70,170)]
BAND=[(40,96,176),(200,40,40),(52,150,80),(240,200,40),(232,120,36),(240,240,244),(36,40,46),(130,190,230),(30,150,150),(232,140,170),(120,70,170),(110,70,50),(188,194,202),(20,60,130)]
def T(name,L,W,H,front,rd,doors,win): return dict(name=name,L=L,W=W,H=H,front=front,rd=rd,doors=doors,win=win)
TR=[T('通勤4扉ステンレス',44,9.6,12.2,'flat',.25,4,'pair'),T('通勤4扉塗装',44,9.6,12.2,'flat',.35,4,'band'),T('近郊3扉',46,9.6,12.4,'slope',.3,3,'pair'),T('近郊2扉セミクロス',46,9.4,12.4,'slope',.3,2,'big'),
T('旧型湘南顔',42,9.2,12.6,'round',.7,2,'pane'),T('旧型通勤形',42,9.4,12.2,'flat',.5,3,'pane'),T('特急傾斜顔',50,9.4,12.6,'slope',.4,2,'big'),T('特急パノラマ',50,9.4,13.4,'round',.35,2,'big'),
T('高速鉄道風',56,10,12.6,'bullet',.55,2,'band'),T('ミニ高速鉄道風',48,8.6,11.8,'bullet',.5,2,'band'),T('2階建て高速鉄道風',54,10,15.6,'bullet',.5,2,'dd'),T('地下鉄角型',40,9,11.4,'flat',.1,4,'pair'),
T('地下鉄丸屋根',40,9,11.6,'round',.8,4,'pair'),T('路面電車単車',28,7.8,10.6,'flat',.3,2,'big'),T('路面電車連接低床',40,8.2,10,'round',.5,3,'big'),T('レトロ観光',38,8.8,12.2,'round',.8,2,'pane'),
T('展望観光',48,9.6,13.4,'bullet',.45,2,'big'),T('次世代曲面',50,9.6,12.8,'bullet',.6,3,'band'),T('リニア風',60,9.2,11.8,'bullet',.6,2,'band'),T('私鉄急行流線',46,9.6,12.6,'round',.45,3,'pair'),
T('私鉄通勤貫通',44,9.6,12.4,'flat',.3,4,'pair'),T('空港連絡',48,9.6,12.8,'bullet',.5,2,'big'),T('2階建て特急',46,9.8,15.4,'slope',.35,2,'dd'),T('ローカル小型2扉',34,8.6,11.6,'flat',.4,2,'pair'),
T('ワンマン1両',36,8.8,11.8,'slope',.4,2,'big'),T('都電風',26,7.4,10.4,'round',.6,2,'pane'),T('登山電車風',30,8.8,11.2,'slope',.3,2,'pane'),T('郊外大窓',44,9.6,12.8,'slope',.25,3,'big'),
T('旧型急行',44,9.2,12.6,'round',.6,2,'pane'),T('ライトレール風',42,8.4,10.2,'bullet',.35,3,'big')]
NAMES=[t['name'] for t in TR]
def livery(a,j):
    body=BODY[(a*5+j*3)%14];b1=BAND[(a*3+j*7+1)%14];b2=BAND[(a*7+j*2+5)%14]
    if a in(0,11,20) and j%2==0: body=BODY[1]
    if b1==body: b1=BAND[(a*3+j*7+2)%14]
    if b2==b1: b2=BAND[(a*7+j*2+6)%14]
    fc=b1 if j%4==0 else (BODY[10] if j%7==3 else body)
    return body,b1,b2,fc
def xsec(W,z0,H,rd,sc=1.0,top=None,lift=0):
    z1=z0+H if top is None else top;zb=z0+lift;hw=W/2*sc;zs=zb+(z1-zb)*.7;pw=hw*(.58-.42*rd)
    return [(-hw,zb),(hw,zb),(hw,zs),(hw*(.93-.1*rd),zs+(z1-zs)*.7),(pw,z1),(-pw,z1),(-hw*(.93-.1*rd),zs+(z1-zs)*.7),(-hw,zs)]
GL=(34,52,84)
def cut(a,b,gaps):
    r=[(a,b)]
    for g0,g1 in gaps:
        n=[]
        for x0,x1 in r:
            if g1<=x0 or g0>=x1: n.append((x0,x1))
            else:
                if g0>x0: n.append((x0,g0))
                if g1<x1: n.append((g1,x1))
        r=n
    return r
def car(sp,j,a,head):
    body,b1,b2,fc=livery(a,j);L=sp['L']*(1+.02*((j%5)-2));W=sp['W'];H=sp['H'];z0=3.2;rd=sp['rd'];fr=sp['front'];z1=z0+H;P=[]
    Ln={'flat':1.2,'slope':.12*L,'bullet':.3*L,'round':.15*L}[fr] if head else 0
    xn=L/2-Ln;base=xsec(W,z0,H,rd)
    P.append(loft([(-L/2,base),(xn if head else L/2,base)],body));cen=P[0]['cen'];nose=None
    if head:
        ws,pw_,drop,pd,lift={'flat':(.05,1,.02,1,0),'slope':(.12,1,.2,1,0),'bullet':(.6,1.5,.5,1.3,.12),'round':(.32,1.8,.2,1.6,.05)}[fr];secs=[(xn,base)];sc_=[]
        for i in range(1,6):
            t=i/5;sw=1-ws*t**pw_;tp=z1-drop*H*t**pd;secs.append((xn+Ln*t,xsec(W,z0,H,rd,sw,tp,lift*H*t**1.2)))
        nose=loft(secs,fc);P.append(nose);ncen=nose['cen']
    a0=-L/2+1.6;b0=(xn-.6) if head else L/2-1.6;b0=b0 if (head and fr!='flat') else (L/2-3 if head else L/2-1.6)
    nd=sp['doors'];dr=[]
    for i in range(nd): xc=a0+(b0-a0)*(i+.5)/nd;dr.append((xc-1.7,xc+1.7))
    rows=[(z0+.40*H,z0+.68*H)] if sp['win']!='dd' else [(z0+.16*H,z0+.38*H),(z0+.5*H,z0+.7*H)];st=sp['win'];sty=j%6
    for sg in(1,-1):
        y=sg*(W/2+.07);n=(0,sg,0);xa,xb=-L/2,(xn if head and fr!='flat' else L/2)
        def band(za,zb,col,lay): P.append(decal([(xa,y,za),(xb,y,za),(xb,y,zb),(xa,y,zb)],n,col,cen,lay))
        if sty==0: band(z0+.33*H,z0+.4*H,b1,1)
        elif sty==1: band(z0+.3*H,z0+.38*H,b1,1);band(z0+.2*H,z0+.26*H,b2,1)
        elif sty==2: band(z0,z0+.26*H,b2,1);band(z0+.26*H,z0+.32*H,b1,1)
        elif sty==3: band(z0+.66*H,z0+.72*H,b1,1);band(z0,z0+.1*H,b2,1)
        elif sty==4: band(z0,z0+.34*H,b1,1)
        else: band(z0+.3*H,z0+.36*H,b1,1);band(z0+.22*H,z0+.27*H,b2,1);band(z0+.14*H,z0+.19*H,b1,1)
        for zlo,zhi in rows:
            for x0,x1 in cut(a0,b0,dr):
                if x1-x0<1.2: continue
                if st in('band','dd') and x1-x0<9: seg=[(x0+.3,x1-.3)]
                elif st=='band': seg=[(x0+.3,x1-.3)]
                elif st=='big': seg=[(x0+.5,x1-.5)]
                elif st in('pair','dd'):
                    w=x1-x0
                    seg=[(x0+.4,x0+w/2-.3),(x0+w/2+.3,x1-.4)] if w>7 else [(x0+.4,x1-.4)]
                else:
                    pw,gp=2.2,.8;seg=[];x=x0+.3
                    while x+pw<=x1:seg.append((x,x+pw));x+=pw+gp
                for p0,p1 in seg: P.append(decal([(p0,y,zlo),(p1,y,zlo),(p1,y,zhi),(p0,y,zhi)],n,GL if j%2 else (52,76,112),cen,3))
        for d0,d1 in dr: P.append(decal([(d0,y,z0+.04*H),(d1,y,z0+.04*H),(d1,y,z0+.7*H),(d0,y,z0+.7*H)],n,mul(b2,.85) if j%3 else (170,176,184),cen,4))
    for x in(-L*.3,L*.3): P.append(box(x,0,1.7,5.5,W*.82,2.6,(40,42,48)))
    P.append(box(0,0,z0-.7,L*.35,W*.72,1.4,(84,86,94)))
    if not head or True:
        xe=-L/2-.07
        P.append(decal([(xe,-W*.28,z0+.12*H),(xe,W*.28,z0+.12*H),(xe,W*.28,z0+.7*H),(xe,-W*.28,z0+.7*H)],(-1,0,0),(60,60,66),cen,3))
        if not head:
            xe=L/2+.07;P.append(decal([(xe,-W*.28,z0+.12*H),(xe,W*.28,z0+.12*H),(xe,W*.28,z0+.7*H),(xe,-W*.28,z0+.7*H)],(1,0,0),(60,60,66),cen,3))
    pw=W*(.58-.42*rd)/2
    nac=2 if L>40 else 1
    for k in range(nac): P.append(box(-L*.25+k*L*.3,0,z1+.5,3.6,max(2.4,pw*1.4),1.1,(200,204,208)))
    if sp.get('pan',True) and (j%3==0 or sp['name'] in('路面電車単車','路面電車連接低床','都電風','ライトレール風')) and (not head or j%2==0):
        px=L*.28 if not head else -L*.1
        P.append(box(px,0,z1+.5,2.2,2.4,1,(50,50,56)));P.append(extrude([(px-1,z1+.9),(px-.4,z1+.9),(px+2.2,z1+4.4),(px+1.6,z1+4.4)],'y',-.25,.25,(50,50,56)));P.append(box(px+1.9,0,z1+4.6,1.2,W*.55,.5,(50,50,56)))
    if head:
        xf=L/2+.07;fy=W/2
        if fr=='flat':
            P.append(decal([(xf,-W*.42,z0+.44*H),(xf,-W*.06,z0+.44*H),(xf,-W*.06,z0+.76*H),(xf,-W*.42,z0+.76*H)],(1,0,0),GL,ncen,3))
            P.append(decal([(xf,W*.06,z0+.44*H),(xf,W*.42,z0+.44*H),(xf,W*.42,z0+.76*H),(xf,W*.06,z0+.76*H)],(1,0,0),GL,ncen,3))
            P.append(decal([(xf,-W*.05,z0+.1*H),(xf,W*.05,z0+.1*H),(xf,W*.05,z0+.76*H),(xf,-W*.05,z0+.76*H)],(1,0,0),b1,ncen,3))
            for yy in(-W*.38,W*.3): P.append(decal([(xf,yy,z0+.14*H),(xf,yy+W*.08,z0+.14*H),(xf,yy+W*.08,z0+.27*H),(xf,yy,z0+.27*H)],(1,0,0),(255,246,200),ncen,3))
        else:
            for i in range(2,5):
                t0=i/5;t1=(i+1)/5;s0=secs[i];s1=secs[i+1]
                pts=[(s0[0],s0[1][k][0],s0[1][k][1]+.12) for k in(3,4,5,6)]+[(s1[0],s1[1][k][0],s1[1][k][1]+.12) for k in(6,5,4,3)]
                P.append(decal(pts,(.6,0,1),GL,ncen,3))
            e=secs[-1][1]
            for k in(0,1):
                yy=(-1,1)[k]*(W*.2);P.append(decal([(xf,yy-.6,e[0][1]+1.4),(xf,yy+.6,e[0][1]+1.4),(xf,yy+.6,e[0][1]+2.6),(xf,yy-.6,e[0][1]+2.6)],(1,0,0),(255,246,200),ncen,3))
    return P
def formation(a,j,n=4):
    sp=TR[a];h=car(sp,j,a,True);m=car(sp,j,a,False);L=sp['L']*(1+.02*((j%5)-2))+.6;tot=n*L;P=[]
    for i in range(n):
        x=tot/2-L/2-i*L
        if i==0: P+=place(h,x)
        elif i==n-1: P+=place(h,x,True)
        else: P+=place(m,x)
    return P
def model(i,k):
    d,c=divmod(i,2);a,j=divmod(d,15);return render(car(TR[a],j,a,c==0),k*math.pi/4,96,76,48,46)
def label(i): d,c=divmod(i,2);return f'{d+1:03d}{"H" if c==0 else "M"} t{d//15+1}-{d%15+1}'
if __name__=='__main__':
    rows=[[d+1,NAMES[d//15],d%15+1,f'train_{2*d+1:03d}.png',f'train_{2*d+2:03d}.png'] for d in range(450)]
    export_veh('train',900,96,76,model,label,rows,['id','type','variant','先頭車ファイル','中間車ファイル'],__doc__+'\n各デザインにつき 先頭車(H)=奇数番号ファイル, 中間車(M)=偶数番号ファイル。\n編成の最後尾は先頭車を方向+4で使えば反転できます。\n1枚のPNG=8方向(各セル96x76px)\n',ov=range(0,900,2),ov_cols=15,rows_per_sheet=30)
    out=os.path.join(os.path.dirname(os.path.abspath(__file__)),'train_out');cols=3;cw,ch=250,130;sm=Image.new('RGB',(cols*cw,10*ch),(30,34,48))
    for a in range(30):
        im_=render(formation(a,a%15),0,cw,ch,cw//2,74);sm.paste(im_,((a%cols)*cw,(a//cols)*ch),im_)
    sm.save(out+'/train_formation_samples.png')
