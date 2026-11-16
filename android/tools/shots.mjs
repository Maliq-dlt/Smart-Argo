// Emulator screenshots for design review: practice mode, light and dark, at 412 and 360 dp and 200 % text.
// Usage: node tools/shots.mjs [out-dir]   (needs one running emulator and the debug APK built)
// Navigation finds elements by their text or description through uiautomator, never by fixed coordinates.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sdk = process.env.ANDROID_SDK_ROOT ?? join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk');
const adbPath = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const out = process.argv[2] ?? join(import.meta.dirname, '..', '.tmp', 'shots');
mkdirSync(out, { recursive: true });
const adb = (...args) => execFileSync(adbPath, args, { encoding: 'latin1', maxBuffer: 64 << 20 });
const sleep = ms => new Promise(done => setTimeout(done, ms));

function nodes() {
  // A dump taken mid-animation can fail ("null root node") and leave the previous file behind; retry until it is fresh.
  for (let i = 0; i < 8 && !adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml').includes('dumped'); i++) execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},400)']);
  const xml = Buffer.from(adb('exec-out', 'cat', '/sdcard/ui.xml'), 'latin1').toString('utf8');
  return [...xml.matchAll(/<node [^>]*>/g)].map(([tag]) => {
    const attr = name => tag.match(new RegExp(` ${name}="([^"]*)"`))?.[1] ?? '';
    const [x1, y1, x2, y2] = attr('bounds').match(/\d+/g).map(Number);
    return { text: attr('text'), desc: attr('content-desc'), x: (x1 + x2) >> 1, y: (y1 + y2) >> 1 };
  });
}
async function tap(label, { scrolls = 6 } = {}) {
  for (let i = 0; i <= scrolls; i++) {
    const hit = nodes().find(n => (n.text === label || n.desc === label || n.text.startsWith(label)) && (n.y < 1900 || ['Akun', 'Coba mode latihan'].includes(label)));
    if (hit) { adb('shell', 'input', 'tap', hit.x, hit.y); await sleep(1200); return; }
    adb('shell', 'input', 'swipe', '540', '1700', '540', '900', '400'); await sleep(700);
  }
  throw new Error(`Tidak ditemukan: ${label}`);
}
async function shot(name) {
  await sleep(900);
  writeFileSync(join(out, `${name}.png`), Buffer.from(adb('exec-out', 'screencap', '-p'), 'latin1'));
  console.log('ok', name);
}
const scroll = async () => { adb('shell', 'input', 'swipe', '540', '1800', '540', '700', '600'); await sleep(900); };

async function tour(tag) {
  adb('shell', 'am', 'force-stop', 'id.smartagro.app');
  adb('shell', 'am', 'start', '-n', 'id.smartagro.app/.MainActivity'); await sleep(3500);
  // A tap during the first frames can be lost, so retry until the plants screen is there.
  for (let attempt = 0; attempt < 4 && !nodes().some(n => n.text === 'Tanaman saya'); attempt++) {
    await tap('Coba mode latihan'); // scrolls the sign-in page when the button is below the fold
    await sleep(2500);
  }
  await shot(`${tag}-01-tanaman`);
  await tap('Cabai', { scrolls: 3 });
  await sleep(800);
  await shot(`${tag}-02-detail`);
  await scroll(); await shot(`${tag}-03-detail-bawah`);
  await scroll(); await shot(`${tag}-04-detail-akhir`);
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await sleep(1200);
  await tap('Akun'); await shot(`${tag}-05-akun`);
}

const theme = mode => adb('shell', 'cmd', 'uimode', 'night', mode);
try {
  for (const [mode, name] of [['no', 'terang'], ['yes', 'gelap']]) { theme(mode); await tour(`412-${name}`); }
  adb('shell', 'wm', 'size', '1080x2400'); adb('shell', 'wm', 'density', '480'); // 360 dp wide
  theme('no'); await tour('360-terang');
  adb('shell', 'settings', 'put', 'system', 'font_scale', '2.0'); await tour('360-teks200');
} finally {
  adb('shell', 'settings', 'put', 'system', 'font_scale', '1.0');
  adb('shell', 'wm', 'size', 'reset'); adb('shell', 'wm', 'density', 'reset'); theme('no');
}
