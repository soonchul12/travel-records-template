"""Build site data from content/trips.json; optionally resize exported originals.
Usage: python3 tools/build_content.py [--photos imports]
Coordinates always use [longitude, latitude].
"""
import argparse
import copy
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
KINDS = {'city':'City','nature':'Nature','food':'Food','stay':'Stay','night':'Night','arrival':'Arrival','park':'Park'}

def distance(a, b):
    lon1, lat1, lon2, lat2 = map(math.radians, [*a, *b])
    h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 12742 * math.asin(math.sqrt(min(1, h)))

def coordinate(value):
    if not isinstance(value, list) or len(value) != 2 or not all(isinstance(x, (int, float)) and math.isfinite(x) for x in value):
        raise ValueError('coords must be [longitude, latitude]')
    if not (-180 <= value[0] <= 180 and -90 <= value[1] <= 90):
        raise ValueError('Coordinate outside longitude/latitude range')
    return value

def local_file(folder, name):
    file = (folder / name).resolve()
    if not file.is_relative_to(folder.resolve()) or not file.is_file():
        raise ValueError(f'Photo not found inside import folder: {name}')
    return file

def exif_location(exif):
    try:
        gps = exif.get_ifd(34853)
        def decimal(values):
            return float(values[0]) + float(values[1])/60 + float(values[2])/3600
        lat, lon = decimal(gps[2]), decimal(gps[4])
        if gps.get(1) in ('S', b'S'): lat = -lat
        if gps.get(3) in ('W', b'W'): lon = -lon
        return coordinate([lon, lat])
    except (KeyError, TypeError, ValueError, ZeroDivisionError):
        return None

def photo(spec, slug, stop, index, folder):
    coords = coordinate(spec.get('coords', stop['coords']))
    time = spec.get('time', stop.get('time', '12:00'))
    if 'file' in spec:
        if not folder:
            raise ValueError('Photos with file need --photos <folder>. Export originals from Photos first.')
        from PIL import Image, ImageOps
        from pillow_heif import register_heif_opener
        register_heif_opener()
        file = local_file(folder, spec['file'])
        image = Image.open(file)
        exif = image.getexif()
        if 'coords' not in spec:
            coords = exif_location(exif) or coords
        stamp = exif.get(36867) or exif.get(306)
        if 'time' not in spec and isinstance(stamp, str) and len(stamp) >= 16:
            time = stamp[11:16]
        image = ImageOps.exif_transpose(image).convert('RGB')
        key = hashlib.sha256(file.read_bytes()).hexdigest()[:16]
        out = ROOT/'public/photos'/slug
        out.mkdir(parents=True, exist_ok=True)
        for suffix, edge, quality in [('',2000,82),('-md',900,78)]:
            converted = image.copy()
            converted.thumbnail((edge,edge),Image.Resampling.LANCZOS)
            converted.save(out/f'{key}{suffix}.jpg',quality=quality,optimize=True,progressive=True)
            if not suffix: w,h = converted.size
        src,md = f'/photos/{slug}/{key}.jpg', f'/photos/{slug}/{key}-md.jpg'
    else:
        src,md = spec['src'],spec.get('md',spec['src'])
        for url in (src,md):
            if not url.startswith('/') or url.startswith('//'):
                raise ValueError('Use a local /demo/... or /photos/... image path')
            local_file(ROOT/'public',url[1:])
        w,h = spec['w'],spec['h']
        key = hashlib.sha256(f'{stop["id"]}:{index}:{src}'.encode()).hexdigest()[:16]
    if not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d',time):
        raise ValueError(f'Invalid photo time: {time}')
    return dict(id=f'{stop["id"]}-{index}-{key}',src=src,md=md,w=w,h=h,coords=coords,time=time)

def build(folder):
    inputs = json.loads((ROOT/'content/trips.json').read_text())
    if not inputs: raise ValueError('Add at least one trip')
    trips,seen = [],set()
    for source in inputs:
        tr = copy.deepcopy(source)
        slug = tr['slug']
        if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*',slug) or slug in seen:
            raise ValueError(f'Invalid or duplicate slug: {slug}')
        seen.add(slug)
        start,end = dt.date.fromisoformat(tr['start']),dt.date.fromisoformat(tr['end'])
        if end < start: raise ValueError('end must be after start')
        if not tr['days']: raise ValueError(f'{slug}: at least one day required')
        day_dates=set()
        for d in tr['days']:
            date=dt.date.fromisoformat(d['date'])
            if not start <= date <= end or date in day_dates: raise ValueError('Invalid or duplicate day date')
            day_dates.add(date)
            d['day']=(date-start).days+1
            d['weekday']=['MON','TUE','WED','THU','FRI','SAT','SUN'][date.weekday()]
            d.setdefault('accent','#72b4b0')
            if not re.fullmatch(r'#[0-9a-fA-F]{6}',d['accent']): raise ValueError('accent must be a six-digit hex color')
            if not d['stops']: raise ValueError('Each day needs at least one stop')
            for i,s in enumerate(d['stops']):
                s['coords']=coordinate(s['coords'])
                s['id']=f'{slug}-d{d["day"]}-s{i}'
                s.setdefault('kind','city')
                s['kindEn']=KINDS[s['kind']]
                s.setdefault('en',s['name']);s.setdefault('note','')
                if not s['photos']: raise ValueError('Each stop needs at least one photo')
                s['photos']=[photo(p,slug,s,j,folder) for j,p in enumerate(s['photos'])]
                s['time']=s.get('time',s['photos'][0]['time'])
                if not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d',s['time']): raise ValueError('Stop time must be HH:MM')
                s['hour']=int(s['time'][:2])
                s['camera']=dict(zoom=15,pitch=50,bearing=0)
            pts=[coordinate(p) for p in d.get('route',[s['coords'] for s in d['stops']])]
            if not pts: raise ValueError('Route cannot be empty')
            d['route']=pts if len(pts)>1 else pts*2
            d['km']=round(sum(distance(a,b) for a,b in zip(pts,pts[1:])))
            photos=[p for s in d['stops'] for p in s['photos']]
            d['cover']=photos[d.pop('coverIndex',0)]
            d['mosaic']=photos[:9];d['photoCount']=len(photos)
            if not isinstance(d['journal'],list) or not all(isinstance(p,str) for p in d['journal']): raise ValueError('journal must be a list of paragraphs')
        tr['days'].sort(key=lambda d:d['date'])
        points=[p for d in tr['days'] for p in d['route']] + [s['coords'] for d in tr['days'] for s in d['stops']]
        left,right=min(p[0] for p in points),max(p[0] for p in points)
        bottom,top=min(p[1] for p in points),max(p[1] for p in points)
        tr['bbox']=[[left-.002,bottom-.002],[right+.002,top+.002]]
        tr['center']=[(top+bottom)/2,(left+right)/2]
        tr['cover']=tr['days'][0]['cover']
        tr['stats']=dict(days=(end-start).days+1,km=sum(d['km'] for d in tr['days']),places=sum(len(d['stops']) for d in tr['days']),photos=sum(d['photoCount'] for d in tr['days']))
        kx=math.cos(math.radians(tr['center'][0]));wx=max((right-left)*kx,1e-6);wy=max(top-bottom,1e-6);scale=84/max(wx,wy)
        ox,oy=(100-wx*scale)/2,(100-wy*scale)/2
        tr['glyph']=[dict(color=d['accent'],d='M'+'L'.join(f'{ox+(p[0]-left)*kx*scale:.2f},{oy+(top-p[1])*scale:.2f}' for p in d['route'])) for d in tr['days']]
        trips.append(tr)
    trips.sort(key=lambda t:t['start'],reverse=True)
    (ROOT/'src/data/trips.json').write_text(json.dumps(trips,ensure_ascii=False,indent=2)+'\n')
    print(f'Generated {len(trips)} trips. Photo coordinates and times will be visible on your published site.')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--photos',type=Path,help='Folder containing exported original photos')
    args=parser.parse_args()
    build(args.photos.resolve() if args.photos else None)
