"""Simulasi dukungan keputusan satu pot. Python 3.10+, tanpa paket tambahan.

Jalankan: python simulasi_pot.py
Uji:      python simulasi_pot.py --self-test
Masukan:  python simulasi_pot.py --input kasus.json
Contoh:   python simulasi_pot.py --example
Simpan JSON sebagai UTF-8 untuk mode --input.

Data bawaan sintetis. Bukan firmware DMS atau model pertumbuhan tanaman.
"""
import argparse
from copy import deepcopy
import json
from math import isfinite
from statistics import linear_regression, median
from pathlib import Path


def number(value, name, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high or not isfinite(value):
        raise ValueError(f'{name} harus angka hingga dalam rentang {low}..{high}')
    return value


def evaluate(case):
    p, rows, now = case['profile'], case['samples'], case['now_h']
    number(now, 'now_h', 0, 1e9)
    if not isinstance(case.get('media_changed', False), bool):
        raise ValueError('media_changed harus boolean')
    if not isinstance(rows, list) or not 1 <= len(rows) <= 10000:
        raise ValueError('samples harus daftar berisi 1..10000 rekaman')
    if not isinstance(p['validated'], bool) or not isinstance(p['ph_validated'], bool):
        raise ValueError('status validasi harus boolean')
    for name in ['pot_id', 'crop', 'media', 'phase']:
        if not isinstance(p[name], str) or not p[name].strip() or len(p[name]) > 120:
            raise ValueError(f'{name} harus teks tidak kosong, maksimum 120 karakter')
    for name in ['needs_water', 'drained']:
        if not isinstance(p[name], list) or not 3 <= len(p[name]) <= 100:
            raise ValueError(f'{name} perlu 3..100 observasi acuan')
        for v in p[name]: number(v, name, 0, 100)
    low, drained = median(p['needs_water']), median(p['drained'])
    if drained - low < 10: raise ValueError('Dua kelompok acuan belum terpisah sekurangnya 10 poin')
    number(p['next_visit_h'], 'next_visit_h', .1, 24)
    number(p['hot_c'], 'hot_c', 20, 60)
    if len(p['ph_range']) != 2: raise ValueError('ph_range memerlukan dua batas')
    for v in p['ph_range']: number(v, 'ph_range', 0, 14)
    if p['ph_range'][0] >= p['ph_range'][1]: raise ValueError('Batas pH harus berurutan')
    times = []
    for row in rows:
        number(row['t_h'], 't_h', 0, now)
        number(row['moisture'], 'moisture', 0, 100)
        number(row['temp_c'], 'temp_c', -20, 60)
        if row['ph'] is not None: number(row['ph'], 'ph', 0, 14)
        if not isinstance(row['valid'], bool): raise ValueError('valid harus boolean')
        times.append(row['t_h'])
    if any(a >= b for a, b in zip(times, times[1:])):
        raise ValueError('Waktu sampel harus naik dan tidak duplikat')
    water = case.get('watering')
    if water is not None:
        number(water['t_h'], 'watering.t_h', 0, now)
        number(water['volume_ml'], 'watering.volume_ml', .1, 5000)
    recent = [r for r in rows if now - r['t_h'] <= 6]
    last = rows[-1]
    wet = min(100, drained + 10)
    facts = {'pot_id': p['pot_id'], 'crop': p['crop'], 'low': low, 'wet': wet,
             'moisture': last['moisture'], 'temp_c': last['temp_c'], 'eta_h': None,
             'slope_per_h': None, 'r2': None, 'watering_response': 'Belum dievaluasi',
             'ph_status': 'Belum ada pH tervalidasi yang mutakhir'}

    def result(code, action, reason):
        return {'decision': code, 'action': action, 'reason': reason, 'evidence': facts}

    if not p['validated'] or case.get('media_changed', False):
        return result('KALIBRASI_LOKAL', 'Tetapkan kembali acuan pot', 'Profil belum disahkan atau media berubah; saran penyiraman ditahan.')
    if not last['valid'] or now - last['t_h'] > 5 / 60:
        return result('PULIHKAN_DATA', 'Periksa sensor dan sambungan', 'Data terakhir tidak valid atau lebih tua dari lima menit.')
    if len(rows) > 1 and last['t_h'] - rows[-2]['t_h'] <= 2 / 60 and abs(last['moisture'] - rows[-2]['moisture']) > 20:
        if water is None or not rows[-2]['t_h'] <= water['t_h'] <= last['t_h']:
            return result('PERIKSA_SENSOR', 'Periksa posisi probe dan ulangi pembacaan', 'Lonjakan lebih dari 20 poin dalam dua menit tanpa catatan penyiraman.')

    ph_rows = [r for r in rows if r['valid'] and r['ph'] is not None and now - r['t_h'] <= 24]
    ph_problem = False
    if p['ph_validated'] and ph_rows:
        facts['ph_status'] = f"pH terakhir {ph_rows[-1]['ph']}; umur {round(now-ph_rows[-1]['t_h'], 2)} jam"
        tail = ph_rows[-3:]
        ph_problem = len(tail) == 3 and (all(r['ph'] < p['ph_range'][0] for r in tail) or all(r['ph'] > p['ph_range'][1] for r in tail))
        if ph_problem: facts['ph_status'] += '; tiga pembacaan di sisi luar rentang yang sama; perlu ukur ulang dengan acuan'

    if water:
        before = [r for r in rows if r['valid'] and 0 <= water['t_h'] - r['t_h'] <= 1]
        after = [r for r in rows if r['valid'] and 10 / 60 <= r['t_h'] - water['t_h'] <= .75]
        if before and after:
            delta = median(r['moisture'] for r in after) - before[-1]['moisture']
            facts['watering_response'] = f'Perubahan {delta:+.1f} poin setelah {water["volume_ml"]} mL; hanya lokasi probe'
            if .5 <= now - water['t_h'] <= 1 and delta < 5 and last['moisture'] < low:
                return result('PERIKSA_SIRAMAN', 'Periksa aliran air dan kontak probe sebelum menambah air', 'Respons lokal kurang dari lima poin; air belum tentu mencapai probe atau pembacaannya bermasalah.')

    wet_rows = [r for r in recent if now - r['t_h'] <= 3.01]
    continuous_wet = (len(wet_rows) >= 4 and wet_rows[-1]['t_h']-wet_rows[0]['t_h'] >= 3
                      and all(r['valid'] and r['moisture'] >= wet for r in wet_rows)
                      and all(b['t_h']-a['t_h'] <= 1 for a,b in zip(wet_rows, wet_rows[1:])))
    if continuous_wet:
        return result('PERIKSA_DRAINASE', 'Periksa media, lubang pot dan genangan tatakan', 'Bacaan berada di atas batas basah lokal selama tiga jam; ini petunjuk pemeriksaan, bukan diagnosis akar.')
    tail = recent[-3:]
    if len(tail) == 3 and all(r['valid'] and r['moisture'] < low and now-r['t_h'] <= 1 for r in tail):
        return result('PERIKSA_MEDIA_KERING', 'Konfirmasi media kering, lalu siram bertahap dan catat volume', 'Tiga sampel mutakhir berada di bawah acuan kebutuhan air pot ini.')
    if last['temp_c'] >= p['hot_c']:
        return result('PERIKSA_PANAS', 'Periksa paparan panas dan kondisi tanaman', 'Suhu melewati batas demonstrasi profil; suhu tinggi sendiri bukan perintah menambah air.')
    if ph_problem:
        return result('UKUR_ULANG_PH', 'Ukur ulang pH dengan metode acuan sebelum mengubah media', 'Tiga pembacaan pH di luar rentang profil; sistem tidak menentukan dosis pupuk atau dolomit.')

    # ponytail: ekstrapolasi linear lokal maksimum 12 jam; ganti model setelah ada siklus lapangan berlabel.
    trend = [r for r in recent if water is None or r['t_h'] > water['t_h']]
    if len(trend) >= 6 and trend[-1]['t_h']-trend[0]['t_h'] >= 2.5 and all(r['valid'] for r in trend) and all(b['t_h']-a['t_h'] <= 1 for a,b in zip(trend,trend[1:])):
        x, y = [r['t_h'] for r in trend], [r['moisture'] for r in trend]
        slope, intercept = linear_regression(x,y)
        total = sum((v-sum(y)/len(y))**2 for v in y)
        r2 = 1-sum((v-(slope*t+intercept))**2 for t,v in zip(x,y))/total if total else 0
        facts.update(slope_per_h=round(slope,3), r2=round(r2,3))
        if slope < -1 and r2 >= .8 and last['moisture'] > low:
            eta = (last['moisture']-low)/(-slope)
            if eta <= 12:
                facts['eta_h'] = round(eta,2)
                if eta <= p['next_visit_h']:
                    return result('PERIKSA_SEBELUM_PERGI', 'Jadwalkan pemeriksaan sebelum kunjungan berikutnya', f'Jika laju kering bertahan, acuan terlewati sekitar {eta:.1f} jam; bukan waktu siram pasti.')
    return result('AMATI', 'Lanjutkan pengamatan sesuai jadwal', 'Belum ada kondisi terkonfirmasi yang membutuhkan tindakan; ketiadaan peringatan bukan jaminan tanaman sehat.')


def cases():
    profile = {'pot_id':'P1','crop':'Cabai','media':'Media A','phase':'Vegetatif',
               'validated':True,'ph_validated':True,'needs_water':[38,39,40],
               'drained':[77,78,79],'next_visit_h':6,'hot_c':34,'ph_range':[5.8,6.8]}
    def make(name, values, expected, **extra):
        rows=[{'t_h':i*.5,'moisture':v,'temp_c':27,'ph':6.2,'valid':True} for i,v in enumerate(values)]
        return {'name':name,'profile':deepcopy(profile),'samples':rows,'now_h':rows[-1]['t_h'],'expected':expected,**extra}
    data=[make('Cabai 55 cepat mengering',[85,79,73,67,61,55],'PERIKSA_SEBELUM_PERGI'),
          make('Cabai 55 stabil',[55]*6,'AMATI'),
          make('Basah menetap',[95]*7,'PERIKSA_DRAINASE',watering={'t_h':0,'volume_ml':150}),
          make('Respons siraman kecil',[34,33,32,31,30,31],'PERIKSA_SIRAMAN',watering={'t_h':2,'volume_ml':150}),
          make('Lonjakan tanpa tindakan',[55]*6,'PERIKSA_SENSOR'),
          make('pH rendah berulang',[55]*6,'UKUR_ULANG_PH'),
          make('Data terakhir basi',[55]*6,'PULIHKAN_DATA'),
          make('Bawang 55 profil berbeda',[85,79,73,67,61,55],'AMATI'),
          make('Kering terkonfirmasi',[45,42,38,35,32,30],'PERIKSA_MEDIA_KERING'),
          make('Suhu tinggi media masih lembap',[55]*6,'PERIKSA_PANAS')]
    data[4]['samples'].append({'t_h':2.51,'moisture':9,'temp_c':27,'ph':6.2,'valid':True});data[4]['now_h']=2.51
    for r in data[5]['samples'][-3:]:r['ph']=4.9
    data[6]['now_h']+=.5
    data[7]['profile'].update(pot_id='P1',crop='Bawang merah',media='Media B',phase='Vegetatif',needs_water=[27,28,29],drained=[70,71,72],next_visit_h=1)
    data[9]['samples'][-1]['temp_c']=36
    return data


def self_test():
    demo=cases()
    for case in demo: assert evaluate(case)['decision']==case['expected'],case['name']
    assert evaluate(demo[0])['evidence']['eta_h']==1.33
    assert evaluate(demo[7])['evidence']['eta_h']==2.25
    for key, value, expected in [('validated',False,'KALIBRASI_LOKAL'),('ph_validated',False,'AMATI')]:
        c=deepcopy(demo[5]);c['profile'][key]=value;assert evaluate(c)['decision']==expected
    c=deepcopy(demo[1]);c['media_changed']=True;assert evaluate(c)['decision']=='KALIBRASI_LOKAL'
    c=deepcopy(demo[1]);c['media_changed']='false'
    try:evaluate(c)
    except ValueError:pass
    else:raise AssertionError('media_changed selain boolean diterima')
    c=deepcopy(demo[0]);c['watering']={'t_h':2,'volume_ml':100};assert evaluate(c)['evidence']['eta_h'] is None
    c=deepcopy(demo[1]);c['samples'][-1]['valid']=False;assert evaluate(c)['decision']=='PULIHKAN_DATA'
    c=deepcopy(demo[1]);c['samples'][-1]['t_h']=c['samples'][-2]['t_h'];
    try:evaluate(c)
    except ValueError:pass
    else:raise AssertionError('Waktu duplikat diterima')
    for v in [float('nan'),float('inf'),-1,101,10**1000,True,'55']:
        c=deepcopy(demo[1]);c['samples'][-1]['moisture']=v
        try:evaluate(c)
        except ValueError:pass
        else:raise AssertionError(f'Angka tidak valid diterima: {v}')
    c=deepcopy(demo[1]);c['samples']=c['samples'][-5:];assert evaluate(c)['evidence']['eta_h'] is None
    c=deepcopy(demo[1]);c['profile']['needs_water']=[80]*3
    try:evaluate(c)
    except ValueError:pass
    else:raise AssertionError('Acuan bertumpuk diterima')
    c=deepcopy(demo[1]);c['samples'][-3:]=[dict(r,ph=None) for r in c['samples'][-3:]];c['profile']['ph_validated']=False;assert evaluate(c)['decision']=='AMATI'
    print('PASS: 10 skenario; validasi masukan, profil, data basi, pH dan pembatas prediksi')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    group=parser.add_mutually_exclusive_group();group.add_argument('--self-test',action='store_true');group.add_argument('--input',type=Path);group.add_argument('--example',action='store_true')
    args=parser.parse_args()
    try:
        if args.self_test:self_test()
        elif args.example:print(json.dumps(cases()[0],ensure_ascii=False,indent=2))
        elif args.input:
            if args.input.stat().st_size > 2_000_000:raise ValueError('Masukan maksimum 2 MB')
            print(json.dumps(evaluate(json.loads(args.input.read_text(encoding='utf-8-sig'))),ensure_ascii=False,indent=2,allow_nan=False))
        else:
            print(json.dumps({'type':'simulasi_sintetis','results':[{'name':c['name'],**evaluate(c)} for c in cases()]},ensure_ascii=False,indent=2,allow_nan=False))
    except (OSError,ValueError,KeyError,TypeError,IndexError) as exc:parser.exit(2,f'Masukan gagal: {exc}\n')
