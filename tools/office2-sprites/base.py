import os,zipfile
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
    o=o or mul(f,.55)
    d.polygon([(round(x),round(y)) for x,y in p],fill=(*f,255),outline=(*o,255))
def line(a,b,c): d.line([(round(a[0]),round(a[1])),(round(b[0]),round(b[1]))],fill=(*c,255))
def L2(a,b,t): return (a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t)
def ground(cc,hw,fn):
    hh=hw//2
    for dy in range(-hh,hh):
        for dx in range(-hw,hw):
            u=(dx+.5)/hw;v=(dy+.5)/hh
            if abs(u)+abs(v)<=1: put(64+dx,cc+dy,fn((u+v)/2,(v-u)/2,dx,dy))
def lawn(s,t,dx,dy):
    n=hsh(dx,dy);c=(78,124,58) if n>120 else (70,114,52)
    if n>960: c=(100,146,72)
    if max(abs(s),abs(t))>.47: c=(58,98,44)
    if abs(s-t)<.05 and s+t>.1: c=(176,164,140)
    return c
def plaza(s,t,dx,dy):
    n=5 if (dx+dy)%2==0 else 0
    if max(abs(s),abs(t))>.46: return (112,110,108)
    return mul((86,92,86),1+n/120)
def sbox(cx,cy,L,R,h,col):
    poly([(cx,cy),(cx-L,cy-L/2),(cx-L,cy-L/2-h),(cx,cy-h)],col)
    poly([(cx,cy),(cx+R,cy-R/2),(cx+R,cy-R/2-h),(cx,cy-h)],mul(col,.64))
    poly([(cx,cy-h),(cx-L,cy-L/2-h),(cx-L+R,cy-L/2-R/2-h),(cx+R,cy-R/2-h)],mul(col,1.15))
