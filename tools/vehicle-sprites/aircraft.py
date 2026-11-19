"""8方向の乗り物スプライト生成(小さな3Dモデルを回して2:1アイソメ+ドット絵風に描画)
方向: 0=画面右下向き(+X) から反時計回りに45度ずつ: 0右下,1下,2左下,3左,4左上,5上,6右上,7右
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
def export_veh(name,n,cw,ch,model_fn,label_fn,rows,header,readme):
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
    per=25
    for sh in range((n+per-1)//per):
        r0=sh*per;r1=min(n,r0+per);cr_=q.crop((0,r0*ch,cw*8,r1*ch));cr_.save(out+f'/sheets/{name}_sheet{sh+1}_8bit.png',transparency=tr)
        rg=cr_.convert('RGBA');bg=Image.new('RGB',rg.size,(30,34,48));bg.paste(rg,(0,0),rg);pd=ImageDraw.Draw(bg)
        for i in range(r1-r0):
            pd.line([(0,i*ch),(cw*8,i*ch)],fill=(56,62,80));pd.text((3,i*ch+2),label_fn(r0+i),fill=(200,205,220))
        bg=bg.resize((bg.width*2,bg.height*2),Image.NEAREST);bg.save(out+f'/sheets/{name}_preview{sh+1}.png')
    rg=q.convert('RGBA');cols=10;rows_=(n+cols-1)//cols;ov=Image.new('RGB',(cols*cw,rows_*ch),(30,34,48))
    for i in range(n):
        c=rg.crop((0,i*ch,cw,(i+1)*ch));ov.paste(c,((i%cols)*cw,(i//cols)*ch),c)
    ov.save(out+f'/{name}_overview.png');print('出力先:',out)
LIVA=[((236,236,240),(200,50,44),(60,110,190)),((236,236,240),(40,90,190),(240,200,60)),((232,236,232),(50,150,80),(200,200,60)),((196,200,208),(230,120,40),(60,60,70)),((240,240,236),(240,200,50),(40,40,50)),((190,196,206),(40,40,48),(200,50,44)),((238,228,206),(150,40,44),(200,160,60)),((236,236,242),(130,70,170),(240,130,180)),((190,214,236),(30,50,110),(230,230,240)),((240,240,240),(30,160,160),(240,120,50))]
NAMES=['軽飛行機(単発プロペラ)','双発プロペラ機','ターボプロップ旅客機','狭胴ジェット旅客機','広胴ジェット旅客機','四発ジャンボ機','三発ジェット機','ビジネスジェット','貨物専用機','ヘリコプター']
DARK=(40,44,52);GLS=(40,60,90)
def fuselage(L,rw,rh,zc,col,prof=None):
    pr=prof or [(0,.16,.38),(.10,.5,.22),(.26,.92,.04),(.72,1,0),(.9,.78,-.08),(1,.3,-.14)]
    return tube([(-L/2+f*L,rw*sc,rh*sc,0,zc+rh*zs) for f,sc,zs in pr],col)
def wins(P,L,rw,zc,x0,x1,step,zlo,zhi,col=GLS):
    cen=P[0]['cen'];x=x0
    while x<x1:
        for sg in(1,-1):
            y=sg*rw*.94;P.append(decal([(x,y,zlo),(x+1.2,y,zlo),(x+1.2,y,zhi),(x,y,zhi)],(0,sg,0),col,cen,2))
        x+=step
def stripe(P,L,rw,zc,rh,acc,x0,x1):
    cen=P[0]['cen']
    for sg in(1,-1):
        y=sg*rw*.935;P.append(decal([(x0,y,zc-rh*.28),(x1,y,zc-rh*.28),(x1,y,zc-rh*.12),(x0,y,zc-rh*.12)],(0,sg,0),acc,cen,1))
def prop(P,x,y,z,r=5.5):
    P.append(box(x,y,z,.7,1.2,r*2,DARK));P.append(box(x,y,z,.7,r*2,1.2,DARK))
def propplane(liv,j,L,rw,span,high,nac,tee,chord,fh,tspan):
    body,tail,acc=liv;L*=1+.03*(j%5-2);zc=rw+4.6;P=[fuselage(L,rw,rw*1.05,zc,body)]
    wz=zc+rw*.95 if high else zc-rw*.6
    for sg in(1,-1):
        P.append(extrude([(chord/2+1,sg*rw*.7),(-chord/2+1,sg*rw*.7),(-chord/2+1,sg*span),(chord/2+1,sg*span)],'z',wz,wz+1.1,acc if j%3==0 else body))
        P.append(extrude([(-L/2+4,sg*1),(-L/2+.5,sg*1),(-L/2+.5,sg*tspan),(-L/2+3.5,sg*tspan)],'z',(zc+fh) if tee else zc+.3,(zc+fh+.9) if tee else zc+1.1,body))
    for y in nac:
        for sg in(1,-1):
            P.append(tube([(chord/2-1.5,1.5,1.5,sg*y,wz+.3),(chord/2+5,1.7,1.7,sg*y,wz+.3)],(150,150,158)));prop(P,chord/2+5.6,sg*y,wz+.3,5)
            P.append(wheel(chord/2+1,sg*y,2.2,1.8,1.4))
    if not nac: prop(P,L/2+.6,0,zc,5.8)
    P.append(extrude([(-L/2+5,zc+rw*.6),(-L/2,zc+rw*.6),(-L/2-.6,zc+fh+.5),(-L/2+3,zc+fh+.5)],'y',-.55,.55,liv[1]))
    if not nac: P+= [wheel(3,-3.6,2.2,2,1.4),wheel(3,3.6,2.2,2,1.4),wheel(-L/2+3,0,1.4,1.2,1)]
    else: P.append(wheel(L/2-6,0,2,1.6,1.2))
    stripe(P,L,rw,zc,rw*1.05,acc,-L*.3,L*.38);wins(P,L,rw,zc,-L*.18,L*.3,2.6,zc+rw*.1,zc+rw*.4)
    return P
def jet(liv,j,L,rw,span,root,tipc,sweep,eng,er,tee=False,hump=False,rear=False,tri=False,cargo=False):
    body,tail,acc=liv;L*=1+.025*(j%5-2);zc=rw+4.4;prof=[(0,.16,.4),(.10,.55,.25),(.26,.97,.04),(.72,1,0),(.9,.95,-.02),(1,.55,-.02)] if cargo else None
    P=[fuselage(L,rw,rw,zc,body,prof)];wx=L*.04;wz=zc-rw*.62;ecol=(150,152,160) if j%3 else mul(acc,.9)
    if hump: P.append(tube([(L*.1,rw*.45,rw*.5,0,zc+rw*.85),(L*.22,rw*.82,rw*.7,0,zc+rw*.62),(L*.38,rw*.5,rw*.5,0,zc+rw*.7)],body))
    for sg in(1,-1):
        y0=sg*rw*.55;y1=sg*span
        P.append(extrude([(wx+root/2,y0),(wx+root/2-sweep,y1),(wx+root/2-sweep-tipc,y1),(wx-root/2,y0)],'z',wz,wz+1.5,body if j%2 else mul(body,.96)))
        ts=span*.34;tx=-L/2+9
        P.append(extrude([(tx,sg*1.2),(tx-sweep*.35,sg*ts),(tx-sweep*.35-3,sg*ts),(tx-6,sg*1.2)],'z',(zc+rw*.4+(L*.26 if tee else 0)),(zc+rw*.4+(L*.26 if tee else 0))+1,body))
        for ey in eng:
            fx=wx+root/2-sweep*(ey/span)-1.5;P.append(tube([(fx-3.8*er/2,er,er,sg*ey,wz-er-.7),(fx+er*1.4,er*.95,er*.95,sg*ey,wz-er-.7)],ecol));P.append(wheel(wx-3,sg*rw*.7,2.2,1.8,1.4)) if ey==eng[0] else None
        if rear: P.append(tube([(-L/2+7,er,er,sg*(rw+er+.5),zc+rw*.4),(-L/2+14,er*.95,er*.95,sg*(rw+er+.5),zc+rw*.4)],ecol))
    fh=L*.27 if not tee else L*.3
    P.append(extrude([(-L/2+11,zc+rw*.7),(-L/2+1,zc+rw*.7),(-L/2-1,zc+fh),(-L/2+6,zc+fh)],'y',-.9,.9,tail))
    if tri: P.append(tube([(-L/2+2,er,er,0,zc+rw+er*.4),(-L/2+10,er*.95,er*.95,0,zc+rw+er*.4)],ecol))
    P.append(wheel(L*.33,0,1.8,1.5,1.2));P.append(wheel(wx-3,-rw*.7,2.2,1.8,1.4))
    stripe(P,L,rw,zc,rw,acc,-L*.3,L*.4)
    if not cargo: wins(P,L,rw,zc,-L*.3,L*.34,2.6,zc+rw*.05,zc+rw*.38)
    wins(P,L,rw,zc,L*.4,L*.41,1,zc+rw*.2,zc+rw*.42,(30,40,60))
    return P
def heli(liv,j):
    body,tail,acc=liv;zc=7;P=[tube([(-8,1.8,2,0,zc),(-4,3.5,3.6,0,zc),(3,3.8,3.8,0,zc),(8.5,2,2.3,0,zc-.4)],body)]
    P.append(tube([(-8,1.6,1.6,0,zc+.6),(-26,.6,.6,0,zc+1.4)],body))
    P.append(extrude([(-21,zc+1),(-27,zc+1),(-27,zc+7.5),(-24,zc+7.5)],'y',-.5,.5,tail));P.append(box(-26.8,1,zc+4,.4,.4,6,DARK))
    P.append(box(0,0,zc+4.6,1.6,1.6,2.4,DARK))
    for ang in(15+j*4,105+j*4): P.append(extrude(rrect(0,0,36,1.3,ang),'z',zc+5.7,zc+6.2,(46,46,54)))
    for sg in(1,-1):
        P.append(box(1,sg*3.6,.8,16,.6,.6,(54,54,60)));P.append(box(-2,sg*3.2,3,.6,.6,5.2,(54,54,60)));P.append(box(4.5,sg*3.2,3,.6,.6,5.2,(54,54,60)))
    stripe(P,16,3.8,zc,3.8,acc,-6,6);wins(P,16,3.8,zc,-1,6,2.8,zc,zc+2.8,(60,90,130))
    return P
SPEC=[('p',dict(L=26,rw=2.4,span=18,high=True,nac=[],tee=False,chord=7,fh=11,tspan=8)),
('p',dict(L=32,rw=2.8,span=21,high=False,nac=[8],tee=False,chord=8,fh=12,tspan=9)),
('p',dict(L=42,rw=3.6,span=26,high=True,nac=[9],tee=True,chord=9,fh=14,tspan=8)),
('j',dict(L=58,rw=4.4,span=27,root=12,tipc=5,sweep=10,eng=[11],er=2.2)),
('j',dict(L=74,rw=6,span=34,root=16,tipc=6,sweep=14,eng=[13],er=3.2)),
('j',dict(L=82,rw=6.2,span=38,root=17,tipc=6,sweep=15,eng=[12,22],er=2.8,hump=True)),
('j',dict(L=60,rw=4.6,span=26,root=12,tipc=5,sweep=9,eng=[],er=2.2,rear=True,tri=True,tee=True)),
('j',dict(L=38,rw=3.2,span=19,root=9,tipc=4,sweep=6,eng=[],er=1.8,rear=True,tee=True)),
('j',dict(L=70,rw=6.6,span=34,root=16,tipc=6,sweep=12,eng=[12],er=3,cargo=True)),('h',{})]
def model(i,k):
    a,j=divmod(i,10);liv=LIVA[(j+a*3)%10];t,sp=SPEC[a]
    P=propplane(liv,j,**sp) if t=='p' else jet(liv,j,**sp) if t=='j' else heli(liv,j)
    return render(P,k*math.pi/4,112,104,56,66)
def label(i): return f'{i+1:03d} type{i//10+1}-{i%10+1}'
if __name__=='__main__':
    rows=[[i+1,NAMES[i//10],i%10+1,f'aircraft_{i+1:03d}.png'] for i in range(100)]
    export_veh('aircraft',100,112,104,model,label,rows,['id','type','variant','file'],__doc__+'\n1枚のPNG=8方向を横に並べた帯(各セル112x104px)\n')
