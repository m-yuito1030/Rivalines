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
LIVB=[((200,50,44),(120,28,28),(240,240,240)),((60,140,80),(30,80,46),(240,230,190)),((60,100,190),(28,44,110),(240,240,240)),((236,200,50),(50,50,56),(40,40,46)),((240,240,240),(50,90,180),(210,50,44)),((240,240,240),(50,150,80),(150,220,60)),((230,130,50),(110,60,34),(240,240,240)),((236,226,196),(120,30,40),(210,170,60)),((196,200,208),(60,64,72),(110,190,230)),((140,70,170),(70,34,96),(240,140,190))]
YEL=[(240,190,30),(244,196,40),(236,182,24),(246,200,50),(240,188,36),(232,178,30),(248,204,60),(238,192,44),(242,186,28),(244,198,36)]
def D(name,L,W,H,front='flat',segs=1,roofs=('none',),win=('panes',),doors=2,decks=1,ax=(.2,.78),skh=.28,open_=False,wr=2.2): return dict(name=name,L=L,W=W,H=H,front=front,segs=segs,roofs=roofs,win=win,doors=doors,decks=decks,ax=ax,skh=skh,open=open_,wr=wr)
BUSES=[D('市バス12m',34,9,11,roofs=('ac','none','sign'),win=('panes','strip','big')),D('ミディバス',26,8.4,10,'slant',roofs=('none','sign','ac'),win=('panes','big')),
D('連節バス',44,9,11,segs=2,roofs=('ac','none'),win=('panes','strip'),doors=3),D('BRT三連節',62,9,11,'slant',3,('pack','none'),('big','strip'),4),
D('二階建て',34,9,17,'round',roofs=('none','sign'),doors=1,decks=2),D('オープントップ二階建て',34,9,17,'round',doors=1,decks=2,open_=True),
D('高速バス',40,9,13,'slant',roofs=('ac','none','sign'),win=('tinted','big'),doors=1,ax=(.14,.3,.82),skh=.42),D('大型ハイデッカー',44,9,14,'slant',roofs=('ac','rack'),win=('tinted','strip'),doors=1,ax=(.14,.3,.82),skh=.45),
D('マイクロバス',22,7.6,9,'slant',roofs=('none','sign'),win=('panes','big'),doors=1),D('スクールバス',32,9,11,'hood',roofs=('none','sign'),doors=1),
D('トロリーバス',34,9,11,roofs=('poles',),win=('panes','strip')),D('電気バス',34,9,11,'slant',roofs=('pack',),win=('big','strip')),
D('空港シャトル',30,10,10,'round',roofs=('ac','none'),win=('big',),doors=3),D('観光バス大窓',38,9,13,'slant',roofs=('ac',),win=('big','tinted'),doors=1),
D('クラシック丸型',30,8.6,11,'round',doors=1),D('ボンネット型',30,8.4,10,'hood',roofs=('none','rack'),doors=1),
D('ノンステップ低床',34,9,10,'slant',roofs=('ac','none'),win=('big','strip'),doors=3),D('ワンボックス',18,7,8.4,'slant',win=('big',),doors=1),
D('ハイブリッド中型',30,8.6,10.4,'round',roofs=('pack','ac'),win=('panes','strip')),D('夜行コーチ',42,9,14.4,'slant',roofs=('ac','rack'),win=('tinted',),doors=1,ax=(.14,.3,.82),skh=.4),
D('路面電車風',46,9,10,'round',2,('pack',),('big','strip'),3),D('行先表示大型',34,9,11,roofs=('sign',),win=('panes','strip')),
D('荷台ラック付き',30,8.6,11,roofs=('rack',),doors=1),D('ダブルデッカー中型',28,8.6,15.4,'slant',doors=1,decks=2),D('キャンピング型',30,9,12,'slant',roofs=('rack','ac'),win=('big',),doors=1)]
NAMES=[b['name'] for b in BUSES]
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
def bus(sp,liv,j,ai):
    body,skirt,acc=liv
    if ai==9: body=YEL[j];skirt=(30,30,34);acc=(30,30,34)
    L=sp['L']*(1+.03*((j*3)%5-2));W=sp['W'];H=sp['H'];segs=sp['segs'];gap=2.0 if segs>1 else 0;sl=(L-gap*(segs-1))/segs
    z0=2.4;opn=sp['open'];Hb=H*(.5 if opn else 1);z1=z0+Hb;P=[];glass=(36,60,96) if j%2 else (56,84,120);tint=(26,34,52)
    style=sp['win'][j%len(sp['win'])];roof=sp['roofs'][j%len(sp['roofs'])];fr=sp['front'];hood=6 if fr=='hood' else 0
    for s in range(segs):
        xs0=-L/2+s*(sl+gap);xs1=xs0+sl;last=(s==segs-1);first=(s==0);xe=xs1-hood if last else xs1
        cen=((xs0+xs1)/2,0,(z0+z1)/2)
        if last and fr=='slant': slf=min(5,.14*L);pr=[(xs0,z0),(xs1,z0),(xs1,z0+.5*Hb),(xs1-slf,z1),(xs0,z1)]
        elif last and fr=='round': pr=[(xs0,z0),(xs1,z0),(xs1,z0+.55*Hb),(xs1-.8,z0+.82*Hb),(xs1-2.6,z1),(xs0,z1)]
        else: pr=[(xs0,z0),(xe,z0),(xe,z1),(xs0,z1)]
        P.append(extrude(pr,'y',-W/2,W/2,body))
        cen=P[-1]['cen']
        if last and hood:
            P.append(box((xe+xs1)/2,0,z0+.29*H,hood,W*.78,.58*H,body))
            P.append(decal([(xs1+.06,-W*.3,z0+.1*H),(xs1+.06,W*.3,z0+.1*H),(xs1+.06,W*.3,z0+.4*H),(xs1+.06,-W*.3,z0+.4*H)],(1,0,0),(60,60,66),cen,3))
        a=xs0+1.4;b=(xe-1.4) if last else xs1-1.2
        dr=[]
        nd=sp['doors'];fr_=[.9,.45,.12,.7][:nd] if segs==1 else ([.9,.4] if last else [.7,.3] if first else [.5])
        for f in fr_: xc=a+(b-a)*f;dr.append((xc-1.7,xc+1.7))
        rows=[(z0+.4*H,z1-.1*H)] if sp['decks']==1 else [(z0+.2*H,z0+.45*H),(z0+.6*H,z1-.08*H)]
        if sp['skh']>.3: rows=[(z0+sp['skh']*H+.4,z1-.1*H)]
        if opn: rows=[(z0+.35*Hb,z1-.1*Hb)]
        for sg in(1,-1):
            y=sg*(W/2+.07);n=(0,sg,0)
            P.append(decal([(xs0,y,z0),(xs1,y,z0),(xs1,y,z0+sp['skh']*Hb),(xs0,y,z0+sp['skh']*Hb)],n,skirt,cen,1))
            P.append(decal([(xs0,y,z0+sp['skh']*Hb),(xs1,y,z0+sp['skh']*Hb),(xs1,y,z0+sp['skh']*Hb+.07*Hb+.5),(xs0,y,z0+sp['skh']*Hb+.07*Hb+.5)],n,acc,cen,2))
            for zlo,zhi in rows:
                for x0,x1 in cut(a,b,dr):
                    if style in('strip','tinted'): segs_=[(x0,x1)]
                    else:
                        pw,gp=(2.4,.8) if style=='panes' else (4.2,.9);segs_=[];x=x0
                        while x+pw<=x1+.01: segs_.append((x,x+pw));x+=pw+gp
                        if not segs_: segs_=[(x0,x1)]
                    for p0,p1 in segs_: P.append(decal([(p0,y,zlo),(p1,y,zlo),(p1,y,zhi),(p0,y,zhi)],n,tint if style=='tinted' else glass,cen,3))
            for d0,d1 in dr: P.append(decal([(d0,y,z0+.06*Hb),(d1,y,z0+.06*Hb),(d1,y,z1-.1*Hb),(d0,y,z1-.1*Hb)],n,mul(acc,.75) if j%3 else (150,170,190),cen,4))
        for xw in sp['ax'] if segs==1 else ((.22,.8) if first else (.5,) if (not last or segs==2 and False) else (.55,)):
            for sg in(1,-1): P.append(wheel(xs0+sl*xw,sg*(W/2-.9),sp['wr'],sp['wr'],1.8))
        if segs>1 and not last: P.append(box(xs1+gap/2,0,z0+Hb*.45,gap+.4,W*.7,Hb*.75,(40,40,46)))
        if first: P.append(decal([(xs0-.07,-W/2+.9,z0+.4*Hb),(xs0-.07,W/2-.9,z0+.4*Hb),(xs0-.07,W/2-.9,z1-.15*Hb),(xs0-.07,-W/2+.9,z1-.15*Hb)],(-1,0,0),glass,cen,3));P.append(decal([(xs0-.07,-W/2+1,z0+.08*Hb),(xs0-.07,-W/2+2.4,z0+.08*Hb),(xs0-.07,-W/2+2.4,z0+.22*Hb),(xs0-.07,-W/2+1,z0+.22*Hb)],(-1,0,0),(220,50,40),cen,3));P.append(decal([(xs0-.07,W/2-2.4,z0+.08*Hb),(xs0-.07,W/2-1,z0+.08*Hb),(xs0-.07,W/2-1,z0+.22*Hb),(xs0-.07,W/2-2.4,z0+.22*Hb)],(-1,0,0),(220,50,40),cen,3))
        if last:
            if fr=='slant' or fr=='round':
                if fr=='slant': t0=(xs1,z0+.5*Hb);t1=(xs1-slf,z1);nn=vnorm((.5*Hb,0,slf))
                else: t0=(xs1,z0+.55*Hb);t1=(xs1-2.6,z1);nn=vnorm((.45*Hb,0,2.6))
                def pt(t,yy): return (t0[0]+(t1[0]-t0[0])*t+nn[0]*.07,yy,t0[1]+(t1[1]-t0[1])*t+nn[2]*.07)
                P.append(decal([pt(.06,-W/2+.9),pt(.06,W/2-.9),pt(.94,W/2-.9),pt(.94,-W/2+.9)],nn,glass,cen,3))
                P.append(decal([(xs1+.07,-W/2+1,z0+.1*Hb),(xs1+.07,-W/2+2.4,z0+.1*Hb),(xs1+.07,-W/2+2.4,z0+.28*Hb),(xs1+.07,-W/2+1,z0+.28*Hb)],(1,0,0),(255,240,170),cen,3))
                P.append(decal([(xs1+.07,W/2-2.4,z0+.1*Hb),(xs1+.07,W/2-1,z0+.1*Hb),(xs1+.07,W/2-1,z0+.28*Hb),(xs1+.07,W/2-2.4,z0+.28*Hb)],(1,0,0),(255,240,170),cen,3))
            elif not hood:
                xf=xs1+.07;P.append(decal([(xf,-W/2+.9,z0+.42*Hb),(xf,W/2-.9,z0+.42*Hb),(xf,W/2-.9,z1-.18*Hb),(xf,-W/2+.9,z1-.18*Hb)],(1,0,0),glass,cen,3))
                P.append(decal([(xf,-W/2+1,z0+.1*Hb),(xf,-W/2+2.4,z0+.1*Hb),(xf,-W/2+2.4,z0+.28*Hb),(xf,-W/2+1,z0+.28*Hb)],(1,0,0),(255,240,170),cen,3));P.append(decal([(xf,W/2-2.4,z0+.1*Hb),(xf,W/2-1,z0+.1*Hb),(xf,W/2-1,z0+.28*Hb),(xf,W/2-2.4,z0+.28*Hb)],(1,0,0),(255,240,170),cen,3))
                P.append(decal([(xf,-W/2+1.5,z1-.13*Hb),(xf,W/2-1.5,z1-.13*Hb),(xf,W/2-1.5,z1-.04*Hb),(xf,-W/2+1.5,z1-.04*Hb)],(1,0,0),(255,180,60),cen,4))
            else:
                xf=xe+.06;P.append(decal([(xf,-W/2+1,z0+.45*H),(xf,W/2-1,z0+.45*H),(xf,W/2-1,z1-.1*H),(xf,-W/2+1,z1-.1*H)],(1,0,0),glass,cen,3))
    if opn:
        P.append(box(0,0,z1+.3,L-2,W-.4,.6,body))
        for sg in(1,-1): P.append(box(0,sg*(W/2-.5),z1+1.8,L-2,.5,2.4,body))
        P.append(box(L/2-1.2,0,z1+1.8,.5,W-.6,2.4,body))
        for k in range(int((L-8)/3)): P.append(box(-L/2+5+k*3,0,z1+1.5,1.4,W*.7,1.4,acc))
    sx=L/2
    if roof=='ac': P.append(box(-L*.2,0,z1+.9,6,W*.55,1.6,(210,210,214)))
    elif roof=='pack': P.append(box(0,0,z1+.9,L*.45,W*.6,1.8,(70,160,100) if j%2 else (200,200,206)))
    elif roof=='sign': P.append(box(sx-3,0,z1+.8,2.4,W*.5,1.4,(255,190,60)))
    elif roof=='poles':
        for yy in(-1.8,1.8): P.append(extrude([(-L*.1,z1),(-L*.1-.9,z1),(-L*.1-12,z1+9),(-L*.1-13,z1+9)],'y',yy-.3,yy+.3,(40,40,46)))
    elif roof=='rack':
        P.append(box(0,0,z1+.5,L*.55,W*.8,.5,(90,90,96)))
        for k in range(3): P.append(box(-L*.16+k*L*.16,0,z1+1.5,3.4,W*.6,1.6,[(150,100,60),(80,90,120),(140,60,60)][(k+j)%3]))
    return P
def model(i,k):
    a,j=divmod(i,10);return render(bus(BUSES[a],LIVB[(j+a*2)%10],j,a),k*math.pi/4,72,64,36,38)
def label(i): return f'{i+1:03d} type{i//10+1}-{i%10+1}'
if __name__=='__main__':
    rows=[[i+1,NAMES[i//10],i%10+1,f'bus_{i+1:03d}.png'] for i in range(250)]
    export_veh('bus',250,72,64,model,label,rows,['id','type','variant','file'],__doc__+'\n1枚のPNG=8方向を横に並べた帯(各セル72x64px)\n')
