// Regenerates PhosphorPaths.kt from the web app's @phosphor-icons/react (MIT). Run from the repo root:
//   node android/tools/phosphor-paths.mjs > android/app/src/main/java/id/smartagro/app/PhosphorPaths.kt
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as P from '@phosphor-icons/react/dist/ssr'
const want = ['Plant','Plant:fill','Notebook','Notebook:fill','UserCircle','UserCircle:fill','Drop','Drop:fill','Thermometer','Flask','CaretRight:bold','CaretLeft:bold',
 'Plus:bold','DotsThree:bold','CloudRain','Cloud','CloudSun','Sun','Moon','QrCode','ShieldCheck','Key','ClockCounterClockwise','Medal','Lightning','LinkSimple','SignOut',
 'Check:bold','CheckCircle:fill','Warning:fill','Info','PencilSimple','ArrowsClockwise','UsersThree','DownloadSimple','ChartLine','X:bold','Sparkle','Package','MapPin',
 'Wind','GoogleLogo','EnvelopeSimple','LockSimple','Eye','EyeSlash','SquaresFour','Swatches','MagnifyingGlass','CloudLightning','ArrowUpRight','Leaf',
 'Camera','Image','Copy','Archive','ArrowCounterClockwise','ArrowsLeftRight','ShareNetwork','Trash','SlidersHorizontal','Keyhole','ShieldWarning']
let kt = 'package id.smartagro.app\n\n// Generated from Phosphor Icons 2.1 (MIT, phosphoricons.com) path data; 256-unit viewport. Do not edit by hand.\ninternal object PhosphorPaths {\n'
const odd = []
for (const spec of want) {
  const [name, weight = 'regular'] = spec.split(':')
  const svg = renderToStaticMarkup(createElement(P[name], { weight }))
  const body = svg.match(/<svg[^>]*>(.*)<\/svg>/)[1]
  const tags = [...body.matchAll(/<(\w+)/g)].map(m => m[1]).filter(t => t !== 'path')
  if (tags.length) odd.push(spec + ':' + tags.join(','))
  const d = [...body.matchAll(/ d="([^"]+)"/g)].map(m => m[1]).join(' ')
  kt += `    const val ${name}${weight === 'regular' ? '' : weight[0].toUpperCase() + weight.slice(1)} = "${d}"\n`
}
kt += '}\n'
process.stdout.write(kt)
if (odd.length) console.error('NON-PATH', odd)
