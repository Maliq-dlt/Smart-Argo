"""Check package consistency; does not test unimplemented product features."""
from pathlib import Path
import hashlib
import json
import re
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parent
ns = {'s': 'http://www.w3.org/2000/svg'}
manifest = json.loads((root / 'render-manifest.json').read_text(encoding='utf-8'))
expected_ids = {f'{prefix}-{i:02}' for prefix, count in [('APP', 6), ('ID', 5), ('RW', 5), ('KB', 4)] for i in range(1, count + 1)}
ids = set()
assert len(manifest) == 16
assert len(list(root.glob('*.mmd'))) == 12
assert len(list(root.glob('*.puml'))) == 4
for item in manifest:
    source = root / item['file']
    assert source.parent == root and source.is_file()
    files = [(source, 'source_sha256'), (root / 'svg' / (source.stem + '.svg'), 'svg_sha256'), (root / 'png' / (source.stem + '.png'), 'png_sha256')]
    for path, key in files:
        assert hashlib.sha256(path.read_bytes()).hexdigest() == item[key], f'Regenerate render/manifest: {path.name}'
    assert item['width'] > 0 and item['height'] > 0
    svg = ET.fromstring(files[1][0].read_bytes())
    assert not svg.findall('.//s:script', ns)
    assert not svg.findall('.//s:foreignObject', ns), source.name
    if source.suffix == '.puml':
        code = source.read_text(encoding='utf-8')
        usecases = set(re.findall(r'^\s*usecase .* as (\w+)$', code, re.M))
        actors = set(re.findall(r'^actor .* as (\w+)$', code, re.M))
        ids.update(re.findall(r'usecase "((?:APP|ID|RW|KB)-\d{2})', code))
        edges = set(re.findall(r'^(\w+) -- (\w+)$', code, re.M))
        rendered_edges = {(g.attrib['data-entity-1'], g.attrib['data-entity-2']) for g in svg.findall('.//s:g', ns) if g.attrib.get('class') == 'link'}
        assert edges == rendered_edges, source.name
        entities = {g.attrib['data-entity']: g for g in svg.findall('.//s:g', ns) if g.attrib.get('class') == 'entity'}
        assert set(entities) == actors | usecases
        for actor in actors:
            assert entities[actor].find('s:path', ns) is not None, f'Actor is not a stickman: {actor}'
        boxes = []
        for usecase in usecases:
            ellipse = entities[usecase].find('s:ellipse', ns)
            x, y, rx, ry = (float(ellipse.attrib[k]) for k in ('cx', 'cy', 'rx', 'ry'))
            box = (x-rx, y-ry, x+rx, y+ry)
            assert all(box[2] <= b[0] or b[2] <= box[0] or box[3] <= b[1] or b[3] <= box[1] for b in boxes), source.name
            boxes.append(box)
        assert item['width'] < 1000 and item['height'] < 1000, source.name
assert ids == expected_ids
spec = (root / 'SPESIFIKASI.md').read_text(encoding='utf-8')
assert set(re.findall(r'^\| ((?:APP|ID|RW|KB)-\d{2}) \|', spec, re.M)) == ids
for path in root.glob('*.md'):
    text = path.read_text(encoding='utf-8')
    for target in re.findall(r'\]\(([^)]+)\)', text):
        if not target.startswith(('https://', 'http://', '#')):
            assert (path.parent / target.split('#')[0]).is_file(), (path.name, target)
for path in [*root.glob('*.md'), *root.glob('*.mmd'), *root.glob('*.puml'), root / 'check_diagrams.py']:
    text = path.read_text(encoding='utf-8')
    assert '\ufeff' not in text and all(line == line.rstrip() for line in text.splitlines()), path.name
print('PASS: 16 rendered diagrams, 20 use cases, actor links, stickmen, non-overlapping use cases, hashes and document links.')
