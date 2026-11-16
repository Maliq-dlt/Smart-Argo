const icons = {
  sprout: '<path d="M12 21v-9M12 15C5 15 3 11 3 6c6 0 9 3 9 9Zm0-4c0-6 4-9 9-9 0 6-3 10-9 10"/>',
  leaf: '<path d="M20 3C10 2 3 6 4 13s10 10 14 3c3-5 2-9 2-13Z"/><path d="M3 22 16 9m-7 7v-5m4 1h5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  back: '<path d="m14 6-6 6 6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  drop: '<path d="M12 2c-2 4-8 9-8 13a8 8 0 0 0 16 0c0-4-6-9-8-13Z"/><path d="M8 15a4 4 0 0 0 4 4"/>',
  temperature: '<path d="M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0Z"/><path d="M12 9v8"/>',
  ph: '<path d="M9 2h6m-5 0v7l-6 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-6-9V2M7 15h10"/><path d="M10 17h1m3 1h1"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10Z"/>',
  roots: '<path d="M12 3v6m-5-4 5 4 5-4M12 9v12m0-9-6 4-2 4m8-5 6 3 2 3m-8-3-3 3M6 16l-3-1m15 3 3-3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  sliders: '<path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  touch: '<path d="M9 13V5a2 2 0 0 1 4 0v7-2a2 2 0 0 1 4 0v2a2 2 0 0 1 4 0v4c0 4-3 6-6 6h-2c-2 0-3-1-4-2l-5-5a2 2 0 0 1 3-3l2 1Z"/>',
  signal: '<path d="M3 20v-4m6 4v-8m6 8V8m6 12V3"/>',
  wifi: '<path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0m-11 4a6 6 0 0 1 8 0m-4 4h.01"/>',
  cloud: '<path d="M6 19a5 5 0 1 1 1-10 6 6 0 0 1 12 2 4 4 0 0 1-1 8H6Z"/>',
  garden: '<path d="M3 21h18M5 21v-7h14v7M3 14h18M8 14V7m8 7V7M8 9C3 9 3 4 3 4s5-1 5 5Zm8 0c5 0 5-5 5-5s-5-1-5 5Z"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.leaf}</svg>`;
const $ = selector => document.querySelector(selector);
const root = document.documentElement;
const screen = $('#screen');
const sheet = $('#sheet');
const mediaMotion = matchMedia('(prefers-reduced-motion: reduce)');
const state = { screen: 'dashboard', persona: 'chili', collection: 'pots', aliases: {}, name: 'Pekebun', roots: false, filter: 'all', period: 'day', reduced: mediaMotion.matches, weather: 'sunny', area: 'all' };
const plants = {
  chili: { name: 'Cabai rawit', art: 'chili', product: 'terrace', location: 'Pot teras', day: 32, moisture: 68, temperature: 27.4, ph: 6.2, light: 8200, status: 'Media cukup lembap' },
  onion: { name: 'Bawang merah', art: 'onion', product: 'kitchen', location: 'Sudut dapur', day: 18, moisture: 55, temperature: 28.1, ph: 6.4, light: 6400, status: 'Media mulai kering' },
};
// ponytail: collection scenarios are review controls; ownership and verification await the website contract.
const collections = {
  terrace: { name: 'Pot teras', kind: 'Smart Pot', type: 'pot' },
  kitchen: { name: 'Pot dapur', kind: 'Smart Pot', type: 'pot' },
  garden: { name: 'Kebun rumah', kind: 'Smart Agro', type: 'garden' },
};
plants.gardenChili = { ...plants.chili, product: 'garden', location: 'Teras kebun' };
plants.gardenOnion = { ...plants.onion, product: 'garden', location: 'Sudut kebun' };
Object.keys(plants).forEach((id,index)=>plants[id].code=['T-8B21C0','T-52A7D4','T-91D306','T-6FC820'][index]);
const plantName=id=>state.aliases[id]||plants[id].name;
function plantSearch() { return '<label class="plant-search">'+icon('grid')+'<input type="search" aria-label="Cari tanaman" placeholder="Cari nama, kode, atau produk" autocomplete="off"></label><p class="search-empty" hidden>Tidak ada tanaman yang cocok.</p>'; }
function filterPlants(input) {
  const container=input.closest('#sheet-content,#screen'), query=input.value.trim().toLocaleLowerCase('id');
  let count=0;
  container.querySelectorAll('[data-search-row]').forEach(row=>{const show=row.textContent.toLocaleLowerCase('id').includes(query);row.hidden=!show;row.inert=!show;if(show)count++;});
  container.querySelectorAll('.collection-group').forEach(group=>group.hidden=![...group.querySelectorAll('[data-search-row]')].some(row=>!row.hidden));
  container.querySelector('.search-empty').hidden=count>0;
}
const collectionModes = [['pots','Pot saja'],['garden','Kebun saja'],['both','Pot dan kebun']];
function ownedProducts() {
  return Object.entries(collections).filter(([,product])=>state.collection==='both'||product.type===(state.collection==='pots'?'pot':'garden'));
}
function productPersonas(product) {
  return Object.entries(plants).filter(([,plant])=>plant.product===product);
}
function setCollection(mode) {
  if (!collectionModes.some(([id])=>id===mode)) return;
  state.collection=mode;
  const owned=ownedProducts();
  if (!owned.some(([id])=>id===plants[state.persona].product)) state.persona=productPersonas(owned[0][0])[0][0];
  $('#collection-select').value=mode;
  scrollPositions.dashboard=0; scrollPositions.garden=0; state.area='all';
  render(state.screen==='garden'&&mode==='pots'?'products':state.screen,true);
}
const metrics = {
  moisture: { name: 'Kelembapan', icon: 'drop', unit: 'poin', range: '60–80 poin', description: 'Indeks kelembapan media pada contoh ini. Nilai dalam poin, bukan persentase kadar air terkalibrasi. Ekspresi maskot mengikuti rentang contoh 60–80 poin; bukan diagnosis kesehatan tanaman.', values: [62, 60, 59, 64, 76, 73, 71, 70, 69, 67, 69, 68] },
  temperature: { name: 'Suhu media', icon: 'temperature', unit: '°C', range: '24–30 °C', description: 'Suhu di zona akar. Data contoh menunjukkan perubahan sepanjang hari, bukan pembacaan sensor langsung.', values: [25.1, 24.8, 24.6, 25.3, 26.2, 27.8, 28.1, 29, 28.6, 28, 27.7, 27.4] },
  ph: { name: 'pH media', icon: 'ph', unit: 'pH', range: '5,8–6,8 pH', description: 'Derajat keasaman media. Angka dan rentang ini dipakai untuk meninjau tampilan; bukan rekomendasi agronomi.', values: [6.3, 6.3, 6.2, 6.1, 6.2, 6.2, 6.3, 6.2, 6.2, 6.1, 6.2, 6.2] },
  light: { name: 'Cahaya', icon: 'sun', unit: 'lux', range: 'Contoh siang hari', description: 'Intensitas cahaya di sekitar pot. Data dibuat untuk preview, bukan pengukuran di kebun Anda.', values: [200, 700, 1600, 4000, 6500, 7800, 9100, 10400, 9600, 9200, 8700, 8200] },
};
const format = value => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(value);
// ponytail: preview uses in-memory sample data; connect the existing native repository after design review.
function plantArt(id = 'chili', roots = false) {
  const dry = plants[id]?.moisture < 60;
  id = plants[id]?.art || id;
  const crown = id === 'chili' ? `<path d="M225 311Q217 220 226 100" fill="none" stroke="#52714b" stroke-width="5" stroke-linecap="round"/>
    ${[0, 1, 2, 3].map((tier) => [-1, 1].map(side => {
      const y = 277 - tier * 43, x = 225 + side * (58 - tier * 7), tip = y - 33;
      return `<g class="plant-leaf" data-leaf-index="${tier*2+(side===1?1:0)}" style="transform-origin:225px ${y+8}px;--leaf-rest:${dry?side*6:0}deg"><path d="M225 ${y + 8}Q${225 + side * 20} ${y + 3} ${x} ${tip}" fill="none" stroke="#52714b" stroke-width="2"/><path d="M${225 + side * 12} ${y}Q${225 + side * 18} ${y - 46} ${x + side * 18} ${tip - 8}Q${x + side * 14} ${y + 21} ${225 + side * 12} ${y}Z" fill="${tier % 2 ? '#789367' : '#52714b'}" stroke="#456340" stroke-width=".7"/><path d="M${225 + side * 12} ${y}L${x + side * 14} ${tip - 6}" stroke="#9aad84" stroke-width=".8"/></g>`;
    }).join('')).join('')}<path d="M226 106q-16-24-7-32q15 14 7 32" fill="#789367"/><g transform="translate(184 161)"><path d="M0 0v13" stroke="#52714b"/><g fill="#f3eed5"><ellipse rx="4" ry="8"/><ellipse rx="8" ry="4"/></g><circle r="3" fill="#c9b25f"/></g>` : `<g stroke="#52714b" fill="none" stroke-linecap="round">${Array.from({ length: 9 }, (_, i) => `<path class="plant-leaf" data-leaf-index="${i}" style="transform-origin:225px 312px;--leaf-rest:${dry?(i<4?-4:4):0}deg" d="M${215 + i % 3 * 9} 312Q${180 + i * 11} 180 ${149 + i * 20} ${103 + Math.abs(4 - i) * 22}" stroke-width="${4 + i % 3}"/>`).join('')}</g><g fill="#cfa6a4" stroke="#9b7877">${[0, 1, 2].map(i => `<ellipse cx="${207 + i * 18}" cy="309" rx="13" ry="18"/>`).join('')}</g>`;
  return `<svg class="plant-art${roots ? ' roots-visible' : ''}" viewBox="40 40 370 430" role="img" aria-label="Ilustrasi ${id === 'chili' ? 'cabai rawit' : 'bawang merah'}${roots ? ', akar terlihat' : ''}"><ellipse cx="225" cy="451" rx="107" ry="10" fill="var(--shadow)"/><path d="M108 311H344L318 432Q227 457 136 432Z" fill="#806249"/><path d="M116 336Q224 328 337 336M125 381Q224 390 328 381" fill="none" stroke="#a38564" stroke-width="1"/>
    <g class="root-art" stroke="#dbc49d" fill="none" stroke-linecap="round"><path d="M225 310q6 33-10 55t8 67m3-105q30 24 29 57l19 29m-52-79q-35 17-38 47l-15 33m49-48-15 65" stroke-width="2"/><path d="m218 350-23 8-19-1m37 21 17 11 6 21m-36-60-22 11-14 17m86-26 22 8 13 25m-30-9-9 20 4 17m-45-1-19 10-10 14m29-1 9 9m-46-22-17 3m59 10 8 9m-23-2-10 8m66-28 12 5" stroke-width="1"/></g>
    <path class="pot-shell" d="M108 311H344L318 432Q227 457 136 432Z" fill="#b99b87"/><path class="pot-shell" d="M139 325l20 103q17 7 31 8l-7-114Z" fill="#ceb29c" opacity=".6"/><path d="M111 311Q225 296 341 311" fill="#66503e" stroke="#9b7d6a" stroke-width="5"/>
    <g class="plant-crown">${crown}</g><path d="M105 309Q225 297 345 309L344 321Q224 308 107 321Z" fill="#ceb29c"/><path d="M109 322Q227 310 341 322" fill="none" stroke="#9b7d6a"/><path d="M126 438Q225 459 328 438L333 446Q225 470 122 446Z" fill="#9b7d6a"/></svg>`;
}
function mascot(mood = 'comfortable', companion = false) {
  return `<svg class="mascot" viewBox="18 16 124 140" aria-hidden="true"><ellipse cx="80" cy="150" rx="38" ry="4.5" fill="var(--shadow)"/><g class="mascot-sprout"><path d="M80 72C80 60 79 52 80 43" stroke="#52714b" stroke-width="3" fill="none"/><path d="M79.5 56C66 58 56 50 57 37C70 35 79.5 43 79.5 56Z" fill="#789367"/><path d="M80.5 48C81.5 34 92 26 106 28C106 42 96 50 80.5 48Z" fill="#52714b"/><path d="M78 54 63 41m19 5 17-13" stroke="#a4b78c" fill="none"/></g><path d="M41 80H119L112.5 133Q110.5 146 97 146H63Q49.5 146 47.5 133Z" fill="#b99b87"/><path d="m51 89 3.5 39" stroke="#ceb29c" stroke-width="4" stroke-linecap="round"/><rect x="34" y="70" width="92" height="18" rx="9" fill="#ceb29c"/><g fill="#c17d6c" opacity=".4"><ellipse cx="56" cy="116" rx="6.5" ry="4"/><ellipse cx="104" cy="116" rx="6.5" ry="4"/></g><g class="mascot-eyes">${[66,94].map(cx => `<ellipse cx="${cx}" cy="104" rx="6.4" ry="${mood==='dry'?4.5:7.4}" fill="#27372b"/><circle cx="${cx-2.1}" cy="101.3" r="2.3" fill="#fbfcf9"/>`).join('')}</g><path class="mascot-mouth" d="M74 119Q80 125 86 119" fill="none" stroke="#27372b" stroke-width="2.5" stroke-linecap="round"/><g class="mascot-hands" fill="#52714b"><path d="${companion?'M48 111c-8-13-20-12-25-4c8 12 17 14 25 4M112 111c8-13 20-12 25-4c-8 12-17 14-25 4':'M48 111q9-27 27-17q-5 19-27 17M112 111q-9-27-27-17q5 19 27 17'}"/></g></svg>`;
}
function header() {
  return `<header class="app-header"><span class="app-brand">${icon('sprout')}smart agro</span><span class="preview-label">Data contoh</span><button class="avatar" data-screen="account" aria-label="Buka akun">${escapeHTML(state.name.slice(0, 2).toUpperCase())}</button></header>`;
}
function escapeHTML(value) {
  return value.replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
}
function chartValues(metric, period) {
  const offset = plants[state.persona][metric] - metrics[metric].values.at(-1);
  const values = metrics[metric].values.map(value => metric==='light'?Math.max(0,value+offset):value+offset);
  return period === 'week' ? [values[2], values[0], values[4], values[7], values[5], values[8], values[11]] : values;
}
function sampleTime(index, period, length) {
  if (period==='week') return ['Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Minggu'][index];
  const minutes=Math.round(-360+index*1440/(length-1)), clock=(minutes+1440)%1440;
  return `${minutes<0?'Kemarin':'Hari ini'} ${String(Math.floor(clock/60)).padStart(2,'0')}.${String(clock%60).padStart(2,'0')}`;
}
function chart(metric = 'moisture', period = 'day') {
  const values = chartValues(metric, period);
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const points = Array.from({length:25},(_,i)=>{
    const index=i/24*(values.length-1), left=Math.floor(index), right=Math.min(left+1,values.length-1);
    const value=values[left]+(values[right]-values[left])*(index-left);
    return `${10+i/24*280},${97-(value-min)/span*70}`;
  }).join(' ');
  return `<div class="chart-card" data-chart="${metric}" data-period="${period}"><div class="chart-caption"><span data-chart-time>${period === 'day' ? 'Sekarang · 18.00' : 'Minggu · contoh'}</span><span><strong data-chart-value>${format(values.at(-1))}</strong> ${metrics[metric].unit}</span></div><div class="chart-wrap"><svg class="chart" viewBox="0 0 300 120" aria-hidden="true"><path class="chart-grid" d="M10 25H290M10 65H290M10 105H290"/><polygon class="chart-area" points="10,110 ${points} 290,110"/><polyline class="chart-line" points="${points}"/><line class="chart-cursor" x1="290" x2="290" y1="15" y2="110"/><circle class="chart-marker" cx="290" cy="${97-(values.at(-1)-min)/span*70}" r="5"/></svg></div><input class="chart-input" type="range" min="0" max="${values.length - 1}" value="${values.length - 1}" step="1" aria-label="Telusuri grafik ${metrics[metric].name.toLowerCase()}" aria-valuetext="${format(values.at(-1))} ${metrics[metric].unit}"><div class="chart-times"><span>${period === 'day' ? 'Kemarin 18.00' : 'Senin'}</span><span>${period === 'day' ? '06.00' : 'Kamis'}</span><span>${period === 'day' ? 'Hari ini 18.00' : 'Minggu'}</span></div></div>`;
}
const weatherProfiles = {
  sunny: { label: 'Cerah', temperature: 28, icon: 'sun', detail: 'Cahaya hangat di sekitar tanaman.' },
  cloudy: { label: 'Berawan', temperature: 26, icon: 'cloud', detail: 'Awan melintas, cahaya lebih teduh.' },
  rain: { label: 'Hujan ringan', temperature: 24, icon: 'drop', detail: 'Periksa kondisi media sebelum menyiram.' },
};
function weatherScene() {
  return `<svg class="weather-scene" viewBox="0 0 360 250" aria-hidden="true"><g class="weather-sun"><circle cx="285" cy="45" r="21"/><path d="M285 12v-8m0 74v-8m-33-25h-8m74 0h8m-65-24-6-6m54 54 6 6m-54-6-6 6m54-54 6-6"/></g><g class="weather-cloud"><path d="M27 68c-18 0-18-25 0-25 2-23 37-25 42-3 22-7 30 28 6 28Z"/><path d="M255 91c-19 0-19-26 0-26 3-24 37-24 42-3 25-6 31 29 7 29Z"/></g><g class="weather-rain">${[42,71,103,240,271,305].map((x,i)=>`<path d="m${x} ${105+i%3*20}-8 30"/>`).join('')}</g></svg>`;
}
function weatherCard() {
  const weather = weatherProfiles[state.weather];
  return `<button class="weather-card" data-action="weather" aria-label="Lihat cuaca"><span class="weather-symbol">${icon(weather.icon)}</span><span><b data-weather-label>${weather.label}</b><small>Cuaca contoh · lokasi tanaman</small></span><span class="weather-temperature">${weather.temperature}°</span>${icon('chevron')}</button>`;
}
function openWeather() {
  openSheet('Cuaca di lokasi tanaman', `<p class="sheet-copy">Pilih cuaca contoh untuk melihat suasana tanaman. Tidak memakai lokasi atau prakiraan cuaca langsung.</p><div class="weather-choices" role="group" aria-label="Cuaca contoh">${Object.entries(weatherProfiles).map(([id,weather])=>`<button data-weather="${id}" aria-pressed="${state.weather===id}">${icon(weather.icon)}<span>${weather.label}</span><small>${weather.temperature}°</small></button>`).join('')}</div><p class="sheet-copy" id="weather-description">${weatherProfiles[state.weather].detail}</p><button class="care-button" data-action="close-sheet">Lihat suasana tanaman</button>`);
}
function setWeather(id) {
  state.weather = id;
  screen.dataset.weather = id;
  screen.querySelectorAll('.weather-card').forEach(card=>{
    card.querySelector('.weather-symbol').innerHTML=icon(weatherProfiles[id].icon);
    card.querySelector('[data-weather-label]').textContent=weatherProfiles[id].label;
    card.querySelector('.weather-temperature').textContent=`${weatherProfiles[id].temperature}°`;
  });
  sheet.querySelectorAll('[data-weather]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.weather===id));
  const description = $('#weather-description');
  if (description) description.textContent = weatherProfiles[id].detail;
}
function garden() {
  return `${header()}<div class="title-row"><h1 class="page-title">Kebun rumah</h1><button class="product-picker" data-action="products-sheet" aria-label="Pilih produk dan tanaman">Ganti ${icon('down')}</button></div><p class="page-subtitle">Dua persona dalam satu produk contoh.</p>${weatherCard()}<div class="garden-scene">${weatherScene()}<span class="garden-window" aria-hidden="true"></span><span class="garden-shelf" aria-hidden="true"></span><button class="garden-plant garden-chili" data-persona="gardenChili" aria-label="Buka cabai rawit dari kebun">${plantArt('chili')}<span>Cabai rawit</span></button><button class="garden-plant garden-onion" data-persona="gardenOnion" aria-label="Buka bawang merah dari kebun">${plantArt('onion')}<span>Bawang merah</span></button></div><div class="garden-summary"><p><strong>2</strong> tanaman dirawat</p><p><strong>1</strong> perlu dicek</p></div><div class="section-heading"><h2>Area kebun</h2><span class="condition">Data contoh</span></div><div class="segments garden-tabs" role="group" aria-label="Area kebun" style="--segment-index:${['all','terrace','kitchen'].indexOf(state.area)}">${[['all','Semua'],['terrace','Teras'],['kitchen','Sudut']].map(([value,label])=>`<button data-area="${value}" aria-pressed="${state.area===value}">${label}</button>`).join('')}</div><div class="garden-areas">${productPersonas('garden').map(([id,plant])=>`<div class="collapsible-entry${state.area!=='all'&&state.area!==(plant.art==='chili'?'terrace':'kitchen')?' is-filtered':''}" data-garden-area="${plant.art==='chili'?'terrace':'kitchen'}"><div class="collapsible-clip"><button class="garden-area" data-persona="${id}" aria-label="Lihat ${plant.location}"><span class="area-art">${plantArt(id)}</span><span><b>${plant.location}</b><small>${plant.name} · ${plant.moisture} poin</small><span class="condition">${plant.status}</span></span>${icon('chevron')}</button></div></div>`).join('')}</div><p class="demo-footnote">Tata kebun dan cuaca merupakan contoh untuk review. Ketuk tanaman untuk membuka dasbornya.</p>`;
}
function moistureCompanion() {
  const plant=plants[state.persona];
  const mood=plant.moisture<60?'dry':plant.moisture>80?'wet':'comfortable';
  const label=mood==='dry'?'Media mulai kering':mood==='wet'?'Media lebih basah':'Media cukup lembap';
  return `<div class="moisture-companion" data-mood="${mood}"><button class="mascot-greeting" data-action="greet" aria-label="Sapa maskot kelembapan">${mascot(mood,true)}</button><button class="companion-details" data-sensor="moisture" aria-label="Lihat kelembapan bersama maskot"><span><b>${label}</b><small>${plant.moisture} poin · Indeks contoh</small></span>${icon('chevron')}</button></div>`;
}
function dashboard() {
  const plant = plants[state.persona];
  return `${header()}<div class="title-row"><div><button class="product-picker" data-action="products-sheet" aria-label="Pilih produk dan tanaman">${collections[plant.product].name} ${icon('down')}</button><h1 class="page-title">${escapeHTML(plantName(state.persona))}</h1></div></div><p class="page-subtitle">${plant.location} · ${plant.code} · Hari ke-${plant.day}</p><button class="text-button rename-trigger" data-action="rename">Ubah nama tanaman</button>
    <div class="persona-shortcuts" role="group" aria-label="Ganti tanaman">${ownedProducts().flatMap(([productId])=>productPersonas(productId)).map(([id,plant])=>`<button data-persona="${id}" aria-pressed="${state.persona===id}" aria-label="Pilih ${escapeHTML(plantName(id))} ${plant.code}">${escapeHTML(plantName(id))}<small>${plant.code}</small></button>`).join('')}</div>
    <div class="plant-stage">${weatherScene()}${plantArt(state.persona, state.roots)}<button class="plant-tap" data-action="touch-plant" aria-label="Sentuh tanaman"></button><span class="stage-caption"><b>${plants[state.persona].art === 'chili' ? 'Vegetatif' : 'Pertumbuhan'}</b>Fase tumbuh</span><span class="stage-caption right"><b>Zona akar</b>${state.roots ? 'Terlihat dari dalam' : 'Ada cerita di dalam'}</span><div class="stage-controls"><button class="root-toggle" data-action="roots" aria-pressed="${state.roots}">${icon('roots')} ${state.roots ? 'Tutup pot' : 'Lihat akar'}</button></div></div>
    ${moistureCompanion()}<div class="sensors">${Object.entries(metrics).map(([key, metric]) => `<button class="sensor${key === 'moisture' ? ' water' : ''}" data-sensor="${key}" aria-label="Lihat detail ${metric.name.toLowerCase()}"><span class="sensor-top">${metric.name}${icon(metric.icon)}</span><span class="sensor-number">${key === 'light' ? format(plant.light / 1000) + 'k' : format(plant[key])}<small>${metric.unit}</small></span><span class="sensor-status${plants[state.persona].art === 'onion' && key === 'moisture' ? ' warning' : ''}">${plants[state.persona].art === 'onion' && key === 'moisture' ? 'Periksa media' : key === 'light' ? 'Cukup terang' : 'Dalam rentang'}</span></button>`).join('')}</div>
    ${weatherCard()}<div class="section-heading"><h2>Ritme hari ini</h2><button class="text-button" data-sensor="moisture">Lihat detail</button></div>${chart()}<p class="chart-help">Geser penanda untuk melihat perubahan kelembapan.</p>${moistureActivity()}<p class="demo-footnote">Semua angka adalah data contoh untuk review tampilan.</p>`;
}
function products() {
  return `${header()}<h1 class="page-title">Tanaman saya</h1><p class="page-subtitle">Cari dan pilih persona dalam satu akun.</p>${plantSearch()}<div class="plant-directory">${ownedProducts().map(([productId,product])=>`<section class="collection-group"><div class="collection-heading"><h2>${product.name}</h2><small>${product.kind}</small></div><div class="product-list">${productPersonas(productId).map(([id,plant])=>`<button class="product-card compact-plant" data-search-row data-persona="${id}" aria-label="Buka ${escapeHTML(plantName(id))} di ${plant.location}">${plantArt(id)}<span><h2>${escapeHTML(plantName(id))}</h2><small>${plant.name} · ${plant.code}</small><span class="condition">${plant.status}</span></span>${icon('chevron')}</button>`).join('')}</div>${product.type==='garden'?'<button class="secondary-button" data-screen="garden">Lihat kebun</button>':''}</section>`).join('')}</div><p class="demo-footnote">Produk, nama, dan kode contoh untuk review. Kepemilikan belum terhubung.</p>`;
}
function login() {
  return `<div class="login"><span class="app-brand">${icon('sprout')}smart agro</span><div class="login-art">${mascot()}</div><h1>Halo, teman<br>bertumbuh.</h1><p>Tanaman Anda, selalu dekat.<br>Mari lihat kabarnya hari ini.</p><form id="demo-login"><label class="field-label" for="nickname">Panggilan Anda</label><input class="text-input" id="nickname" name="nickname" maxlength="32" autocomplete="off" placeholder="Misalnya, Ari" aria-describedby="login-note"><button class="care-button" type="submit">Masuk ke demo ${icon('chevron')}</button></form><p class="demo-footnote" id="login-note">Alur contoh, tanpa akun dan kata sandi.<br>Tidak terhubung ke layanan login.</p><span class="preview-label">Preview aplikasi</span></div>`;
}
// ponytail: 5-point rises group a continuous upswing in sample history; calibrate on real sensor cadence before integration.
function detectMoistureRises(values) {
  const events=[];
  let start=0;
  for (let end=1;end<=values.length;end++) {
    if (end<values.length && Number.isFinite(values[end-1]) && Number.isFinite(values[end]) && values[end]>values[end-1]) continue;
    if (end-start>1 && values[end-1]-values[start]>=5) events.push({start,end:end-1,from:values[start],to:values[end-1]});
    start=end;
  }
  return events;
}
function sensorEvents(persona) {
  const offset=plants[persona].moisture-metrics.moisture.values.at(-1);
  const values=metrics.moisture.values.map(value=>value+offset);
  return detectMoistureRises(values).map(event=>({...event,persona}));
}
function moistureActivity() {
  const event=sensorEvents(state.persona).at(-1);
  return `<button class="insight sensor-event" data-screen="activity">${icon('drop')}<span><b>${event?'Kelembapan meningkat':'Belum ada kenaikan berarti'}</b><small>${event?`${format(event.from)} → ${format(event.to)} poin · Terdeteksi otomatis`:'Riwayat sensor contoh'}</small></span>${icon('chevron')}</button>`;
}
function activities() {
  const detected=ownedProducts().flatMap(([product])=>productPersonas(product).flatMap(([persona,plant])=>sensorEvents(persona).map(event=>({kind:'care',icon:'drop',title:'Kelembapan meningkat',text:`${plant.name} · ${plant.location} · ${format(event.from)} → ${format(event.to)} poin · Otomatis`,time:sampleTime(event.end,'day',metrics.moisture.values.length),index:event.end,persona}))));
  const plant=plants[state.persona];
  const rows=detected.concat([
    { kind:'sensor',icon:'check',title:'Kelembapan terbaca',text:`${plant.name} · ${plant.location} · ${plant.moisture} poin`,time:'Hari ini 18.00',index:11,persona:state.persona },
    { kind:'sensor',icon:'sun',title:'Cahaya terbaca',text:`${plant.name} · ${plant.location} · ${format(plant.light)} lux`,time:'Hari ini 18.00',index:11,persona:state.persona },
  ]).sort((a,b)=>b.index-a.index);
  return `${header()}<h1 class="page-title">Jejak tumbuh</h1><p class="page-subtitle">Perubahan dari sensor, tercatat otomatis.</p><div class="segments activity-tabs" style="--segment-index:${['all','care','sensor'].indexOf(state.filter)}" role="group" aria-label="Filter aktivitas">${[['all','Semua'],['care','Perawatan'],['sensor','Sensor']].map(([value,label])=>`<button data-filter="${value}" aria-pressed="${state.filter===value}">${label}</button>`).join('')}</div><p class="day-label">Riwayat sensor contoh</p><div class="activity-list">${rows.map(row=>`<div class="collapsible-entry${state.filter!=='all'&&row.kind!==state.filter?' is-filtered':''}" data-kind="${row.kind}" data-event-persona="${row.persona}"><div class="collapsible-clip"><article class="activity-item"><span class="insight-icon ${row.icon==='drop'?'water':''}">${icon(row.icon)}</span><div><h2>${row.title}</h2><p>${row.text}</p></div><time>${row.time}</time></article></div></div>`).join('')}</div><p class="demo-footnote">Kenaikan kelembapan dapat mengikuti penyiraman atau hujan. Sensor tidak memastikan sumber air. Semua riwayat di sini adalah contoh.</p>`;
}
function account() {
  return `${header()}<div class="account"><div class="account-profile"><div class="avatar large">${escapeHTML(state.name.slice(0,2).toUpperCase())}</div><h1 class="page-title">${escapeHTML(state.name)}</h1><p class="page-subtitle">Ruang kecil untuk bertumbuh.</p><span class="account-tag">Akun demo · ${ownedProducts().length} produk contoh</span></div><section class="reward-card"><span>Contoh saldo reward</span><strong>240 <small>poin tersedia</small></strong><p>300 terkonfirmasi · 60 direservasi</p><a href="https://smart-agro-demo.pages.dev/#profil" target="_blank" rel="noreferrer">Reward dan bukti blockchain ${icon('chevron')}</a><small>Angka contoh untuk review, bukan saldo akun.</small></section><h2 style="font-size:13px;color:var(--muted)">Profil & keamanan</h2><div class="settings-group">${['Nama tampilan & profil','Keamanan akun & autentikator','Produk, aktivasi & kepemilikan','Pemulihan & transfer produk'].map(label=>`<a class="setting-row" href="https://smart-agro-demo.pages.dev/#profil" target="_blank" rel="noreferrer"><span>${label}</span>${icon('chevron')}</a>`).join('')}</div><h2 style="font-size:13px;color:var(--muted)">Buat terasa milik Anda</h2><div class="settings-group"><button class="setting-row" data-action="theme">${icon(root.dataset.theme === 'dark' ? 'moon' : 'sun')}<span>Tampilan</span><small>${root.dataset.theme === 'dark' ? 'Gelap' : 'Terang'}</small>${icon('chevron')}</button><label class="setting-row switch-row" for="account-motion">${icon('activity')}<span>Kurangi animasi</span><input type="checkbox" id="account-motion" ${state.reduced ? 'checked' : ''}></label></div><div class="settings-group"><button class="setting-row" data-action="about">${icon('info')}<span>Tentang preview</span>${icon('chevron')}</button><button class="setting-row" data-screen="products">${icon('grid')}<span>Produk saya</span><small>${ownedProducts().length} produk</small>${icon('chevron')}</button></div><button class="secondary-button" data-screen="login">Kembali ke halaman masuk</button><p class="demo-footnote">Smart Agro · Studi aplikasi 01<br>Data lokal untuk meninjau desain dan interaksi.</p></div>`;
}
const scrollPositions = {};
function render(target = state.screen, focus = false) {
  if (target==='garden'&&!ownedProducts().some(([id])=>id==='garden')) target='products';
  const previous = state.screen;
  scrollPositions[previous] = $('#app-content').scrollTop;
  cancelAnimationFrame(chartFrame);
  state.screen = target;
  $('#toast').classList.remove('visible');
  screen.getAnimations().forEach(animation => animation.cancel());
  screen.innerHTML = ({ dashboard, garden, products, login, activity: activities, account })[target]();
  screen.dataset.weather = state.weather;
  $('#screen-select').value = target;
  const nav = $('#bottom-nav');
  nav.hidden = target === 'login';
  nav.style.display = target === 'login' ? 'none' : '';
  const tabs = [['products','grid','Tanaman'],['activity','activity','Aktivitas'],['account','user','Akun']];
  const activeTab=['dashboard','garden'].includes(target)?'products':target;
  nav.style.setProperty('--nav-index',Math.max(0,tabs.findIndex(([id])=>id===activeTab)));
  if (!nav.children.length) nav.innerHTML = tabs.map(([id,symbol,label])=>`<button data-screen="${id}">${icon(symbol)}${label}</button>`).join('');
  nav.querySelectorAll('button').forEach(button=>{
    if (button.dataset.screen===activeTab) button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  });
  screen.querySelectorAll('.garden-areas .is-filtered').forEach(row=>{row.inert=true;row.setAttribute('aria-hidden','true');});
  const list = $('.activity-list');
  if (list) {
    list.style.minHeight = `${[...list.querySelectorAll('.activity-item')].reduce((height,row)=>height+row.getBoundingClientRect().height,0)}px`;
    filterActivities(state.filter);
  }
  $('#app-content').scrollTop=scrollPositions[target] || 0;
  $('#phone').classList.toggle('is-scrolled',$('#app-content').scrollTop>24);
  // Keep the screen opaque: an opacity entrance on every click caused the flash.
  if (previous !== target && !state.reduced && !mediaMotion.matches) screen.animate([{transform:'translateY(8px)'},{transform:'translateY(0)'}],{duration:300,easing:'cubic-bezier(.2,.8,.2,1)'});
  if (focus) screen.focus({ preventScroll: true });
}
function filterActivities(filter) {
  state.filter = filter;
  const tabs = $('.activity-tabs');
  tabs.style.setProperty('--segment-index',['all','care','sensor'].indexOf(filter));
  tabs.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',button.dataset.filter===filter));
  screen.querySelectorAll('[data-kind]').forEach(row=>{
    const excluded = filter!=='all' && row.dataset.kind!==filter;
    row.classList.toggle('is-filtered',excluded);
    row.inert = excluded;
    row.setAttribute('aria-hidden',excluded);
  });
}
function selectPersona(id) {
  if (!plants[id]||!ownedProducts().some(([productId])=>productId===plants[id].product)) return;
  if (state.screen !== 'dashboard') { state.persona=id; scrollPositions.dashboard=0; render('dashboard',true); return; }
  if (state.persona === id) return;
  const art = $('.plant-stage .plant-art');
  art.querySelectorAll('.plant-outgoing').forEach(crown=>{crown.getAnimations().forEach(animation=>animation.cancel());crown.remove();});
  const outgoing = art.querySelector('.plant-crown');
  outgoing.getAnimations().forEach(animation=>animation.cancel());
  state.persona=id;
  const template=document.createElement('template');
  template.innerHTML=dashboard();
  const incoming = template.content.querySelector('.plant-crown');
  outgoing.classList.add('plant-outgoing');
  art.insertBefore(incoming,outgoing.nextSibling);
  art.setAttribute('aria-label',`Ilustrasi ${plants[id].name.toLowerCase()}${state.roots?', akar terlihat':''}`);
  // The pot, header, sensor controls and scroll stay mounted while crowns change.
  for (const selector of ['.page-title','.page-subtitle','.product-picker','.stage-caption:not(.right)','.insight']) {
    $(selector).innerHTML=template.content.querySelector(selector).innerHTML;
  }
  const companion=$('.moisture-companion'), nextCompanion=template.content.querySelector('.moisture-companion');
  companion.dataset.mood=nextCompanion.dataset.mood;
  companion.querySelector('.companion-details span').innerHTML=nextCompanion.querySelector('.companion-details span').innerHTML;
  screen.querySelectorAll('.persona-shortcuts [data-persona]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.persona===id));
  for (const button of screen.querySelectorAll('.sensor')) {
    const updated=template.content.querySelector(`.sensor[data-sensor="${button.dataset.sensor}"]`);
    button.querySelector('.sensor-number').innerHTML=updated.querySelector('.sensor-number').innerHTML;
    button.querySelector('.sensor-status').replaceWith(updated.querySelector('.sensor-status'));
  }
  screen.querySelector('.chart-card').replaceWith(template.content.querySelector('.chart-card'));
  if (state.reduced || mediaMotion.matches) outgoing.remove();
  else {
    const options={duration:480,easing:'cubic-bezier(.2,.7,.2,1)'};
    const leave=outgoing.animate([{opacity:1,transform:'translateX(0)'},{opacity:0,transform:'translateX(-6px)'}],{...options,fill:'forwards'});
    incoming.animate([{opacity:0,transform:'translateX(6px)'},{opacity:1,transform:'translateX(0)'}],options);
    leave.finished.then(()=>outgoing.remove()).catch(()=>outgoing.remove());
  }
}
function respondPlant() {
  if (state.reduced || mediaMotion.matches) return;
  screen.querySelectorAll('.plant-stage .plant-crown:not(.plant-outgoing) .plant-leaf').forEach(leaf=>{
    const start=getComputedStyle(leaf).transform;
    leaf.getAnimations().forEach(animation=>animation.cancel());
    const index=Number(leaf.dataset.leafIndex), rest=parseFloat(leaf.style.getPropertyValue('--leaf-rest'))||0;
    leaf.animate([{transform:start},{transform:`rotate(${rest+2.5}deg)`,offset:.27},{transform:`rotate(${rest}deg)`}],
      {duration:850,delay:index*20,fill:'backwards',easing:'cubic-bezier(.2,.65,.25,1)'});
  });
}
function greetMascot(button) {
  if (state.reduced || mediaMotion.matches) return;
  for (const selector of ['.mascot-sprout','.mascot-hands']) {
    const part=button.querySelector(selector), start=getComputedStyle(part).transform;
    part.getAnimations().forEach(animation=>animation.cancel());
    part.animate([{transform:start},{transform:`rotate(${selector==='.mascot-sprout'?3:-8}deg)`,offset:.28},{transform:'rotate(0deg)'}],
      {duration:820,easing:'cubic-bezier(.2,.65,.25,1)'});
  }
}
document.addEventListener('pointermove',event=>{
  const button=event.target.closest('.mascot-greeting');
  if (!button || state.reduced || mediaMotion.matches) return;
  const rect=button.getBoundingClientRect();
  button.style.setProperty('--gaze-x',`${Math.max(-4,Math.min(4,(event.clientX-rect.left)/rect.width*8-4))}px`);
  button.style.setProperty('--gaze-y',`${Math.max(-2,Math.min(2,(event.clientY-rect.top)/rect.height*4-2))}px`);
});
document.addEventListener('pointerout',event=>{
  const button=event.target.closest('.mascot-greeting');
  if(button&&!button.contains(event.relatedTarget)) {button.style.removeProperty('--gaze-x');button.style.removeProperty('--gaze-y');}
});
function setTheme(theme) {
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#161d19' : '#ecefe7';
  document.querySelectorAll('[data-theme-set]').forEach(button => button.setAttribute('aria-pressed', button.dataset.themeSet === theme));
  const row=screen.querySelector('[data-action=theme]');
  if(row) {row.querySelector('small').textContent=theme==='dark'?'Gelap':'Terang';row.querySelector('.icon').outerHTML=icon(theme==='dark'?'moon':'sun');}
}
function setMotion(reduced) {
  state.reduced = reduced;
  root.dataset.reducedMotion = reduced;
  $('#reduce-motion').checked = reduced;
  const accountMotion = $('#account-motion');
  if (accountMotion) accountMotion.checked = reduced;
  if (reduced) document.getAnimations().forEach(animation => { if (Number.isFinite(animation.effect.getComputedTiming().endTime)) animation.finish(); else animation.cancel(); });
}
function positionSheet() {
  const rect=$('#phone').getBoundingClientRect(), status=$('.statusbar').getBoundingClientRect();
  Object.assign(sheet.style,{position:'fixed',inset:`${status.bottom}px auto auto ${rect.left}px`,width:`${rect.width}px`,height:`${rect.bottom-status.bottom}px`,borderRadius:`0 0 ${getComputedStyle($('#phone')).borderBottomLeftRadius} ${getComputedStyle($('#phone')).borderBottomRightRadius}`,zIndex:'2'});
}
let closeTimer;
let sheetOpener;
function openSheet(title, content) {
  clearTimeout(closeTimer);
  sheet.classList.remove('closing');
  $('#sheet-title').textContent = title;
  $('#sheet-content').innerHTML = content;
  positionSheet();
  if (!sheet.open) {sheetOpener=document.activeElement;$('.sheet-panel').scrollTop=0;sheet.show();$('#app-content').inert=true;sheet.querySelector('.close-sheet').focus({preventScroll:true});}
}
function closeSheet(after) {
  if (!sheet.open || sheet.classList.contains('closing')) return;
  const finish = () => {
    sheet.close(); sheet.classList.remove('closing');$('#app-content').inert=false;
    $('.sheet-panel').style.transform = ''; $('.sheet-dimmer').style.opacity = '';
    if (sheetOpener?.isConnected && !sheetOpener.closest('[inert]')) sheetOpener.focus({preventScroll:true});
    if (after) after();
  };
  if (state.reduced || mediaMotion.matches) finish();
  else { sheet.classList.add('closing'); closeTimer = setTimeout(finish, 220); }
}
function openProducts() {
  openSheet('Pilih tanaman', `${plantSearch()}<div class="sheet-products">${ownedProducts().map(([productId,product])=>`<section class="collection-group"><div class="collection-heading"><h3>${product.name}</h3><small>${product.kind}</small></div>${productPersonas(productId).map(([id,plant])=>`<button class="sheet-product" data-search-row data-persona="${id}" aria-pressed="${state.persona===id}">${plantArt(id)}<div><h3>${escapeHTML(plantName(id))}</h3><p>${plant.location} · ${plant.code} · Hari ke-${plant.day}</p></div>${icon(state.persona===id?'check':'chevron')}</button>`).join('')}${product.type==='garden'?'<button class="secondary-button" data-screen="garden">Lihat kebun</button>':''}</section>`).join('')}</div><p class="demo-footnote">Memilih tanaman tidak mengganti akun.</p>`);
}
function openRename() {
  openSheet('Nama tanaman',`<form id="rename-plant"><label class="field-label" for="plant-name">Nama panggilan tanaman</label><input class="text-input" id="plant-name" maxlength="120" required value="${escapeHTML(plantName(state.persona))}"><p class="sheet-copy">${plants[state.persona].name} · ${plants[state.persona].code}<br>Kode tetap sama saat nama diganti.</p><button class="care-button" type="submit">Simpan nama</button><p class="demo-footnote">Nama contoh tersimpan selama preview terbuka.</p></form>`);
}
let activeSensor = 'moisture';
let chartFrame=0;
function changePeriod(period) {
  if (state.period===period) return;
  cancelAnimationFrame(chartFrame);
  state.period=period;
  const tabs=$('.detail-periods');
  tabs.style.setProperty('--segment-index',period==='day'?0:1);
  tabs.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',button.dataset.period===period));
  const card=sheet.querySelector('.chart-card'), template=document.createElement('template');
  template.innerHTML=chart(activeSensor,period);
  const updated=template.content.querySelector('.chart-card');
  card.dataset.period=period;
  for(const selector of ['[data-chart-time]','[data-chart-value]','.chart-times']) card.querySelector(selector).innerHTML=updated.querySelector(selector).innerHTML;
  const input=card.querySelector('.chart-input'), nextInput=updated.querySelector('.chart-input');
  input.max=nextInput.max; input.value=nextInput.value; input.setAttribute('aria-valuetext',nextInput.getAttribute('aria-valuetext'));
  const values=chartValues(activeSensor,period);
  const facts=[Math.min(...values),values.reduce((sum,value)=>sum+value,0)/values.length,Math.max(...values)];
  sheet.querySelectorAll('.detail-facts strong').forEach((el,i)=>el.textContent=format(facts[i]));
  const line=card.querySelector('.chart-line'), area=card.querySelector('.chart-area'), marker=card.querySelector('.chart-marker');
  const from=line.getAttribute('points').split(/[ ,]+/).map(Number), to=updated.querySelector('.chart-line').getAttribute('points').split(/[ ,]+/).map(Number);
  const markerFrom=[Number(marker.getAttribute('cx')),Number(marker.getAttribute('cy'))];
  const markerTo=[290,Number(updated.querySelector('.chart-marker').getAttribute('cy'))];
  const cursor=card.querySelector('.chart-cursor');cursor.setAttribute('x1',290);cursor.setAttribute('x2',290);
  const started=performance.now();
  const draw=now=>{
    const progress=state.reduced||mediaMotion.matches?1:Math.min(1,(now-started)/360), eased=1-(1-progress)**3;
    const points=to.map((value,i)=>from[i]+(value-from[i])*eased);
    const pairs=Array.from({length:points.length/2},(_,i)=>`${points[i*2]},${points[i*2+1]}`).join(' ');
    line.setAttribute('points',pairs);area.setAttribute('points',`10,110 ${pairs} 290,110`);
    marker.setAttribute('cx',markerFrom[0]+(markerTo[0]-markerFrom[0])*eased);marker.setAttribute('cy',markerFrom[1]+(markerTo[1]-markerFrom[1])*eased);
    if(progress<1 && card.isConnected) chartFrame=requestAnimationFrame(draw);
    else card.dataset.animating='false';
  };
  card.dataset.animating='true';
  draw(started);
}

function openSensor(key) {
  activeSensor = key;
  const metric = metrics[key], values = chartValues(key, state.period);
  const average = values.reduce((sum, v)=>sum+v,0)/values.length;
  openSheet(metric.name, `<div class="sensor-detail-value">${format(plants[state.persona][key])}<small>${metric.unit}</small></div><span class="detail-status">${icon('info')}Data contoh · ${plants[state.persona].location}</span><div class="segments detail-periods" style="--segment-index:${state.period==='day'?0:1}" role="group" aria-label="Periode grafik"><button data-period="day" aria-pressed="${state.period === 'day'}">24 jam</button><button data-period="week" aria-pressed="${state.period === 'week'}">7 hari</button></div>${chart(key, state.period)}<div class="detail-facts">${[['Terendah',Math.min(...values)],['Rata-rata',average],['Tertinggi',Math.max(...values)]].map(([label,value])=>`<p>${label}<strong>${format(value)}</strong></p>`).join('')}</div><p class="sheet-copy">${metric.description}</p><small>Rentang contoh: ${metric.range}</small>`);
}
function about() {
  openSheet('Dibuat untuk bertumbuh.', `<div class="about-mascot">${mascot()}</div><p class="sheet-copy">Ini preview desain Smart Agro. Warna sage, font General Sans dan Fraunces, pot, serta maskot mengikuti identitas website.</p><p class="sheet-copy">Alur akun, sensor, dan perawatan menggunakan data contoh lokal. Tidak ada koneksi backend pada preview ini.</p><div class="about-links"><a href="https://www.apple.com/home-app/" target="_blank" rel="noreferrer">Referensi hierarki · Apple Home ↗</a><a href="https://developer.apple.com/design/human-interface-guidelines/motion" target="_blank" rel="noreferrer">Referensi gerak · Apple HIG ↗</a></div><button class="secondary-button" data-action="close-sheet">Kembali</button>`);
}
function previewSettings() {
  openSheet('Pengaturan preview', `<p class="sheet-copy">HTML interaktif dengan data contoh. Pilih layar untuk meninjau alurnya.</p><div class="segments" role="group" aria-label="Tema preview"><button data-theme-set="light" aria-pressed="${root.dataset.theme === 'light'}">Terang</button><button data-theme-set="dark" aria-pressed="${root.dataset.theme === 'dark'}">Gelap</button></div><label class="field-label" for="sheet-collection">Koleksi contoh</label><select class="text-input" id="sheet-collection">${collectionModes.map(([id,label])=>`<option value="${id}" ${state.collection===id?'selected':''}>${label}</option>`).join('')}</select><div class="settings-group">${[['login','Masuk'],['products','Tanaman saya'],['dashboard','Dasbor tanaman'],['activity','Aktivitas'],['account','Akun']].map(([id,label])=>`<button class="setting-row" data-screen="${id}"><span>${label}</span>${icon('chevron')}</button>`).join('')}<button class="setting-row" data-action="launch"><span>Lihat loading screen</span>${icon('chevron')}</button></div><label class="switch-row" for="sheet-motion"><span>Kurangi animasi</span><input id="sheet-motion" type="checkbox" ${state.reduced ? 'checked' : ''}></label>`);
}
document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.themeSet) { setTheme(button.dataset.themeSet); return; }
  if (button.dataset.screen) {
    const target = button.dataset.screen;
    if(target===state.screen && !sheet.open) return;
    if (sheet.open) closeSheet(()=>render(target,true)); else render(target,true);
    return;
  }
  if (button.dataset.persona) {
    const id=button.dataset.persona;
    if (sheet.open) closeSheet(()=>selectPersona(id)); else selectPersona(id);
    return;
  }
  if (button.dataset.sensor) { state.period = 'day'; openSensor(button.dataset.sensor); return; }
  if (button.dataset.period) {
    changePeriod(button.dataset.period);
    return;
  }
  if (button.dataset.filter) { filterActivities(button.dataset.filter); return; }
  if (button.dataset.weather) {setWeather(button.dataset.weather); return;}
  if (button.dataset.area) {
    state.area=button.dataset.area;
    $('.garden-tabs').style.setProperty('--segment-index',['all','terrace','kitchen'].indexOf(state.area));
    screen.querySelectorAll('[data-area]').forEach(el=>el.setAttribute('aria-pressed',el===button));
    screen.querySelectorAll('[data-garden-area]').forEach(el=>{ const excluded=state.area!=='all'&&state.area!==el.dataset.gardenArea;el.classList.toggle('is-filtered',excluded);el.inert=excluded;el.setAttribute('aria-hidden',excluded); });
    return;
  }
  switch (button.dataset.action) {
    case 'weather': openWeather(); break;
    case 'launch': if(sheet.open) closeSheet(()=>playLoading(true)); else playLoading(true); break;
    case 'products-sheet': openProducts(); break;
    case 'rename': openRename(); break;
    case 'close-sheet': closeSheet(); break;
    case 'roots': {
      state.roots = !state.roots;
      const art = $('.plant-stage .plant-art');
      art.classList.toggle('roots-visible',state.roots);
      art.setAttribute('aria-label',`${plants[state.persona].name}${state.roots ? ', akar terlihat' : ''}`);
      button.setAttribute('aria-pressed',state.roots);
      button.innerHTML = `${icon('roots')} ${state.roots ? 'Tutup pot' : 'Lihat akar'}`;
      $('.stage-caption.right').innerHTML = `<b>Zona akar</b>${state.roots ? 'Terlihat dari dalam' : 'Ada cerita di dalam'}`;
      break;
    }
    case 'touch-plant': respondPlant(); break;
    case 'greet': greetMascot(button); break;
    case 'theme': setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'); break;
    case 'about': about(); break;
    case 'preview-settings': previewSettings(); break;
  }
});
document.addEventListener('submit', event => {
  if(event.target.id==='rename-plant') {
    event.preventDefault();const name=$('#plant-name').value.trim();if(!name||name.length>120||[...name].some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127))return;
    state.aliases[state.persona]=name;closeSheet(()=>{
      if(state.screen==='dashboard') {
        $('.page-title').textContent=name;
        const shortcut=screen.querySelector(`.persona-shortcuts [data-persona="${state.persona}"]`);
        shortcut.firstChild.textContent=name;
        shortcut.setAttribute('aria-label',`Pilih ${name} ${plants[state.persona].code}`);
      } else render();
    });return;
  }
  if (event.target.id !== 'demo-login') return;
  event.preventDefault();
  state.name = $('#nickname').value.trim().slice(0,32) || 'Pekebun';
  render('products',true);
});
document.addEventListener('input', event => {
  if(event.target.matches('.plant-search input')) {filterPlants(event.target);return;}
  if (event.target.matches('.chart-input')) {
    cancelAnimationFrame(chartFrame);
    const moving=sheet.querySelector('[data-animating=true]');
    if(moving) {
      const template=document.createElement('template');template.innerHTML=chart(activeSensor,state.period);
      for(const selector of ['.chart-line','.chart-area']) moving.querySelector(selector).setAttribute('points',template.content.querySelector(selector).getAttribute('points'));
      moving.dataset.animating='false';
    }
    const card = event.target.closest('[data-chart]');
    const metric = card.dataset.chart, period = card.dataset.period;
    const values = chartValues(metric,period), i = Number(event.target.value), value = values[i];
    const x = 10 + i / (values.length-1)*280;
    const y = 97 - (value-Math.min(...values))/(Math.max(...values)-Math.min(...values)||1)*70;
    card.querySelector('[data-chart-value]').textContent = format(value);
    const time=sampleTime(i,period,values.length);
    card.querySelector('[data-chart-time]').textContent = `${time} · contoh`;
    event.target.setAttribute('aria-valuetext',`${time}, ${format(value)} ${metrics[metric].unit}`);
    const marker = card.querySelector('.chart-marker');
    marker.setAttribute('cx',x); marker.setAttribute('cy',y);
    const cursor = card.querySelector('.chart-cursor'); cursor.setAttribute('x1',x); cursor.setAttribute('x2',x);
  }
});
let chartDrag;
function scrubChart(event,card) {
  const rect=card.querySelector('.chart').getBoundingClientRect(), input=card.querySelector('.chart-input');
  const fraction=Math.min(1,Math.max(0,((event.clientX-rect.left)/rect.width*300-10)/280));
  input.value=Math.round(fraction*Number(input.max));
  input.dispatchEvent(new Event('input',{bubbles:true}));
}
document.addEventListener('pointerdown',event=>{
  const plot=event.target.closest('.chart-wrap');
  if(!plot || !event.isPrimary || event.button!==0) return;
  chartDrag={plot,card:plot.closest('.chart-card'),x:event.clientX,y:event.clientY};
  plot.setPointerCapture(event.pointerId);
  scrubChart(event,chartDrag.card);
});
document.addEventListener('pointermove',event=>{
  if(chartDrag && Math.abs(event.clientX-chartDrag.x)>Math.abs(event.clientY-chartDrag.y)) scrubChart(event,chartDrag.card);
});
for(const name of ['pointerup','pointercancel','lostpointercapture']) document.addEventListener(name,()=>{chartDrag=undefined;});

document.addEventListener('change', event => {
  if (['reduce-motion','account-motion','sheet-motion'].includes(event.target.id)) setMotion(event.target.checked);
});
$('#screen-select').addEventListener('change', event => render(event.target.value,true));
$('#viewport-size').addEventListener('change', event => {
  const width = Number(event.target.value), height = ({320:740,390:844,430:900})[width];
  $('#device').style.setProperty('--device-width',`${width}px`);
  $('#device').style.setProperty('--device-height',`${height}px`);
  $('#size-caption').textContent = `${width} × ${height}`;
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&sheet.open){event.preventDefault();closeSheet();}});
sheet.addEventListener('cancel', event => { event.preventDefault(); closeSheet(); });
sheet.addEventListener('click', event => { if (event.target === sheet || event.target.classList.contains('sheet-dimmer')) closeSheet(); });
window.addEventListener('resize', () => { if(sheet.open) positionSheet(); });
window.addEventListener('scroll', () => { if(sheet.open) positionSheet(); }, { passive:true });
mediaMotion.addEventListener('change',event=>setMotion(event.matches));
let launchRun=0;
async function playLoading(replay=false) {
  const run=++launchRun, loader=$('#launch-screen');
  loader.getAnimations({subtree:true}).forEach(animation=>animation.cancel());
  loader.hidden=false;
  $('#app-content').inert=true; $('#bottom-nav').inert=true;
  const progress=$('.launch-progress span');
  try {
    if(replay) {
      if(state.reduced || mediaMotion.matches) await new Promise(resolve=>setTimeout(resolve,1000));
      else await progress.animate([{transform:'scaleX(.08)'},{transform:'scaleX(1)'}],{duration:1200,easing:'cubic-bezier(.2,.7,.2,1)',fill:'forwards'}).finished;
    } else await document.fonts.ready;
    if(run!==launchRun) return;
    if(!state.reduced && !mediaMotion.matches) await loader.animate([{opacity:1},{opacity:0}],{duration:420,easing:'ease-out',fill:'forwards'}).finished;
  } catch { /* An interrupted replay is replaced by the next request. */ }
  finally {
    if(run===launchRun) {loader.hidden=true;$('#app-content').inert=false;$('#bottom-nav').inert=false;}
  }
}
$('#collection-select').addEventListener('change',event=>setCollection(event.target.value));
document.addEventListener('change',event=>{if(event.target.id==='sheet-collection') {setCollection(event.target.value);closeSheet();}});
$('#replay-launch').addEventListener('click',()=>playLoading(true));
$('#app-content').addEventListener('scroll',()=>$('#phone').classList.toggle('is-scrolled',$('#app-content').scrollTop>24),{passive:true});
setMotion(state.reduced);
render();
playLoading();
