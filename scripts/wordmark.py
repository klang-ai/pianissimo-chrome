"""Export a portable outlined lockup using the bundled Geist font."""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
import xml.etree.ElementTree as ET
font = instantiateVariableFont(TTFont('public/fonts/Geist.ttf'), {'wght': 300}, inplace=False)
glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
units = font['head'].unitsPerEm
size = 72
scale = size / units
x = 110
paths = []
for character in 'Pianissimo.':
    name = cmap[ord(character)]
    pen = SVGPathPen(glyphs)
    glyphs[name].draw(pen)
    color = '#212bfa' if character == '.' else '#1c1c1a'
    paths.append(f'<path fill="{color}" transform="translate({x:.3f} 88) scale({scale:.6f} {-scale:.6f})" d="{pen.getCommands()}"/>')
    x += glyphs[name].width * scale - size * .085
mark = ET.fromstring(Path('public/brand/mark.svg').read_text())
content = ''.join(ET.tostring(child, encoding='unicode') for child in mark)
svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {x+18:.1f} 128" role="img" aria-label="Pianissimo"><g fill="none" transform="translate(0 18) scale(.75)">{content}</g>{"".join(paths)}</svg>'
Path('public/brand/pianissimo.svg').write_text(svg)
