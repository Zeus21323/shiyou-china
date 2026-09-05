"""依据公开 DEM 与真实河湖矢量生成青绿地形，不使用虚构山形图片。
Python 用于栅格重采样和地理数据处理；不改变项目的 R 环境。
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from urllib.request import urlopen, Request
import io, json, math, time
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'work/terrain'
OUT = ROOT / 'public/data/terrain'
CACHE.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)

def tile_xy(lon, lat, zoom):
    return ((lon+180)/360*2**zoom, (1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*2**zoom)

def fetch_tile(task):
    z, x, y = task
    dest = CACHE / f'{z}-{x}-{y}.png'
    if not dest.exists():
        for attempt in range(3):
            try:
                req=Request(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',headers={'User-Agent':'ShiyouChinaTerrain/1.0'})
                with urlopen(req,timeout=40) as response: raw=response.read()
                with Image.open(io.BytesIO(raw)) as test:
                    if test.size != (256,256): raise ValueError('高程瓦片尺寸错误')
                dest.write_bytes(raw)
                break
            except Exception:
                if attempt==2: raise RuntimeError(f'公开高程瓦片读取失败：{z}/{x}/{y}') from None
                time.sleep(2+attempt)
    rgb=np.asarray(Image.open(dest).convert('RGB'),dtype=np.float32)
    return x,y,rgb[:,:,0]*256+rgb[:,:,1]+rgb[:,:,2]/256-32768

def read_dem(bounds, zoom, width, height):
    west,south,east,north=bounds
    x0,y0=map(math.floor,tile_xy(west,north,zoom));x1,y1=map(math.floor,tile_xy(east,south,zoom))
    tasks=[(zoom,x,y) for y in range(y0,y1+1) for x in range(x0,x1+1)]
    print(f'读取 {len(tasks)} 个高程瓦片，zoom={zoom}',flush=True)
    mosaic=np.empty(((y1-y0+1)*256,(x1-x0+1)*256),dtype=np.float32)
    with ThreadPoolExecutor(max_workers=4) as pool:
        for i,(x,y,data) in enumerate(pool.map(fetch_tile,tasks)):
            mosaic[(y-y0)*256:(y-y0+1)*256,(x-x0)*256:(x-x0+1)*256]=data
            if i%8==0: print(f'高程已读取 {i+1}/{len(tasks)}',flush=True)
    lon=np.linspace(west,east,width);lat=np.linspace(north,south,height)
    xx=((lon+180)/360*2**zoom-x0)*256-.5
    yy=((1-np.arcsinh(np.tan(np.radians(lat)))/np.pi)/2*2**zoom-y0)*256-.5
    xi=np.clip(np.floor(xx).astype(int),0,mosaic.shape[1]-2);yi=np.clip(np.floor(yy).astype(int),0,mosaic.shape[0]-2)
    fx=xx-xi;fy=yy-yi
    dem=(mosaic[yi[:,None],xi]*(1-fx)+mosaic[yi[:,None],xi+1]*fx)*(1-fy[:,None])+(mosaic[yi[:,None]+1,xi]*(1-fx)+mosaic[yi[:,None]+1,xi+1]*fx)*fy[:,None]
    if not np.isfinite(dem).all(): raise ValueError('高程有缺失值，停止输出')
    return dem

def coords(geom):
    def flatten(v):
        if not v: return
        if isinstance(v[0],(int,float)): yield v
        else:
            for child in v: yield from flatten(child)
    yield from flatten(geom['coordinates'])

def intersects(feature,b):
    pts=list(coords(feature['geometry']));xs=[p[0] for p in pts];ys=[p[1] for p in pts]
    if not pts: return False
    return max(xs)>=b[0] and min(xs)<=b[2] and max(ys)>=b[1] and min(ys)<=b[3]

def build(name,bounds,zoom,width,height):
    dem=read_dem(bounds,zoom,width,height)
    west,south,east,north=bounds
    metres_x=(east-west)/(width-1)*111320*math.cos(math.radians((north+south)/2))
    metres_y=(north-south)/(height-1)*111320
    gy,gx=np.gradient(dem,metres_y,metres_x)
    slope=np.sqrt(gx*gx+gy*gy)
    padded=np.pad(dem,6,mode='edge')
    neighbours=[padded[6+dy:6+dy+height,6+dx:6+dx+width] for dy in (-6,0,6) for dx in (-6,0,6)]
    relief=np.maximum.reduce(neighbours)-np.minimum.reduce(neighbours)
    hills=np.clip((relief-35)/500,0,1)
    # 起伏与坡度控制皴染：平原无山纹，高原平坦面也不会被凭海拔画成山峰。
    strength=np.clip(hills*.7+np.minimum(slope*2,.5),0,1)
    base=np.array([241,237,219]);green=np.array([103,148,133])
    color=base[None,None,:]*(1-strength[:,:,None])+green[None,None,:]*strength[:,:,None]
    shade=np.clip((-gx+gy)*.35,-.2,.18)*hills
    color=color*(1+shade[:,:,None])
    # 地理配准的等高线轻描，仅出现在有实际局部起伏的地方。
    interval=300 if name=='china' else 80
    phase=np.mod(np.maximum(dem,0),interval)/interval
    contour=np.exp(-((phase-.5)/.045)**2)*hills*.08
    color*=1-contour[:,:,None]
    color=np.clip(color,0,255).astype('uint8')
    image=Image.fromarray(color).filter(ImageFilter.GaussianBlur(.45))
    draw=ImageDraw.Draw(image)
    def xy(p): return ((p[0]-west)/(east-west)*(width-1),(north-p[1])/(north-south)*(height-1))
    water=[]
    for kind in ('lakes','rivers'):
        dataset=json.loads((CACHE/f'{kind}.geojson').read_text(encoding='utf-8'))
        for f in dataset['features']:
            if not f.get('geometry') or not intersects(f,bounds): continue
            water.append({'type':'Feature','properties':{'kind':kind,'name':f['properties'].get('name_zh') or f['properties'].get('name'),'source':'Natural Earth 1:10m'},'geometry':f['geometry']})
            g=f['geometry'];typ=g['type'];c=g['coordinates']
            if typ in ('Polygon','MultiPolygon'):
                for poly in ([c] if typ=='Polygon' else c):
                    mask=Image.new('L',image.size,0)
                    mask_draw=ImageDraw.Draw(mask)
                    mask_draw.polygon([xy(p) for p in poly[0]],fill=255)
                    for hole in poly[1:]: mask_draw.polygon([xy(p) for p in hole],fill=0)
                    image.paste((155,194,192),(0,0),mask)
            elif typ in ('LineString','MultiLineString'):
                for line in ([c] if typ=='LineString' else c):
                    draw.line([xy(p) for p in line],fill=(102,159,164),width=2 if name=='china' else 3,joint='curve')
    image.save(OUT/f'{name}-ink.png',optimize=True)
    # 留下可复查数值；单位米，网格北至南、西至东。
    stride=4
    grid={'bounds':bounds,'width':len(dem[0,::stride]),'height':len(dem[::stride,0]),'unit':'metre','rowOrder':'north-to-south','heights':np.rint(dem[::stride,::stride]).astype(int).ravel().tolist()}
    # 网格最后一点对应的实际边界，避免整除截断导致地理配准偏移。
    grid['bounds']=[west,north-(height-1-(height-1)%stride)/(height-1)*(north-south),west+(width-1-(width-1)%stride)/(width-1)*(east-west),north]
    (OUT/f'{name}-elevation.json').write_text(json.dumps(grid,separators=(',',':')),encoding='utf-8')
    (OUT/f'{name}-water.geojson').write_text(json.dumps({'type':'FeatureCollection','features':water},ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print(f'{name}: 高程范围 {dem.min():.0f}–{dem.max():.0f} m，河湖要素 {len(water)}',flush=True)
    return {'bounds':bounds,'width':width,'height':height,'tileZoom':zoom,'approximateSampleMetres':round(max(metres_x,metres_y)),'texture':f'{name}-ink.png','elevation':f'{name}-elevation.json','water':f'{name}-water.geojson'}

if __name__=='__main__':
    result={'china':build('china',[73,18,136,54],5,1537,1025),'zhejiang':build('zhejiang',[117.8,26.8,123.3,31.6],8,1409,1537)}
    result['sources']={'dem':'https://registry.opendata.aws/terrain-tiles/','demAttribution':'Mapzen terrain tiles; global SRTM/GMTED2010 courtesy of USGS; ETOPO1 courtesy of NOAA','water':'https://www.naturalearthdata.com/','waterLicense':'Natural Earth public domain','note':'水系为1:1000万制图概化数据，主要河湖，非完整水网；颜色与等高线是基于实际高程的艺术化表现，非地质岩性图。'}
    (OUT/'manifest.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
