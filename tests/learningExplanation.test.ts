import assert from 'node:assert/strict'
import test from 'node:test'
import { LEARNING_PROMPT_VERSION, ORIGIN_LABEL, checkLearningText, explainLearning, learningEvidence, learningPrompt, learningTemplate, rejectLearningText, type LearningEvidence } from '../src/lib/learningExplanation.ts'
import { THRESHOLDS } from '../src/lib/observation.ts'

// The evidence below is SYNTHETIC, made for these tests.
const level1: LearningEvidence = { speciesName: 'Anggrek bulan', level: 1, days: 9, readings: 430, waterings: 3, inspections: 4, healthy: [52, 66], dryingPerHour: 1.5, waterRise: 18.5, missing: { days: 0, inspections: 0, waterings: 0 } }
const level0: LearningEvidence = { speciesName: 'Anggrek bulan', level: 0, days: 2, readings: 90, waterings: 0, inspections: 1, healthy: null, dryingPerHour: null, waterRise: null, missing: { days: 5, inspections: 2, waterings: 2 } }
const good = JSON.stringify({ explanation: 'Berdasarkan pola pot Anda, media ini mengering sekitar 1,5 poin per jam pada siang hari dan satu siraman menaikkannya sekitar 18,5 poin.' })
const never = (async () => { throw new Error('the model must not be asked') }) as (prompt: string) => Promise<string>

test('at level 0 no model is ever asked, even when one is offered', async () => {
  let asked = 0
  const result = await explainLearning(level0, async () => { asked++; return good })
  assert.equal(asked, 0)
  assert.equal(result.source, 'rules')
  assert.equal(result.label, ORIGIN_LABEL)
  assert.match(result.text, /belum punya acuan untuk Anggrek bulan/)
  assert.match(result.text, /5 hari lagi, 2 pengecekan lagi, 2 siraman terukur lagi/)
  assert.deepEqual(await explainLearning(level0), result)
  await assert.doesNotReject(explainLearning(level0, never))
})

test('at level 1 a text that keeps to the evidence is shown as the model\'s, labelled with where the facts come from', async () => {
  const result = await explainLearning(level1, async () => good)
  assert.equal(result.source, 'ai')
  assert.equal(result.label, 'Berdasarkan pola pot Anda, bukan standar tanaman.')
  assert.match(result.text, /1,5 poin per jam/)
  assert.equal((await explainLearning(level1, async () => '```json\n' + good + '\n```')).source, 'ai', 'a fenced answer is read')
})

test('a text with a dose, a number that is not in the evidence, a claim about the species, no origin, a link or markup is not shown', async () => {
  const say = (explanation: string) => JSON.stringify({ explanation })
  const bad: [string, string][] = [
    [say('Berdasarkan pola pot Anda, siram 200 ml air setiap pagi agar media tetap lembap dan akar tidak kering.'), 'dose'],
    [say('Berdasarkan pola pot Anda, satu siraman sebaiknya sekitar 2 liter untuk media sebesar ini supaya cukup.'), 'dose'],
    [say('Berdasarkan pola pot Anda, takaran siram yang pas adalah secukupnya setiap kali media terasa kering.'), 'dose'],
    [say('Berdasarkan pola pot Anda, media ini mengering sekitar 3,7 poin per jam pada siang hari, cukup cepat.'), 'number'],
    [say('Berdasarkan pola pot Anda, media ini mengikuti standar tanaman anggrek bulan pada umumnya dan cukup stabil.'), 'claim'],
    [say('Berdasarkan pola pot Anda, kelembapan 30 sampai 80 adalah rentang yang paling cocok untuk tanaman ini.'), 'number'],
    [say('Berdasarkan pola pot Anda, kelembapan 52 sampai 66 optimal untuk anggrek bulan dan sebaiknya dijaga.'), 'claim'],
    [say('Berdasarkan pola pot Anda, anggrek bulan membutuhkan media yang lembap di kisaran 52 sampai 66 saja.'), 'claim'],
    [say('Media ini mengering sekitar 1,5 poin per jam pada siang hari dan satu siraman menaikkannya cukup banyak.'), 'label'],
    [say('Berdasarkan pola pot Anda, lihat https://contoh.id untuk penjelasan lengkap tentang pola media ini.'), 'link'],
    [say('Berdasarkan pola pot Anda, media ini **mengering** sekitar 1,5 poin per jam pada siang hari yang cerah.'), 'markup'],
    [say('Pola pot Anda.'), 'length'],
    [say('Berdasarkan pola pot Anda, ' + 'media mengering pelan. '.repeat(40)), 'length'],
    ['bukan json', 'invalid_json'],
    [JSON.stringify({ penjelasan: 'x' }), 'invalid_json'],
    [JSON.stringify({ explanation: 5 }), 'invalid_json'],
  ]
  for (const [raw, why] of bad) {
    assert.equal(checkLearningText(raw, level1), why, raw.slice(0, 70))
    const shown = await explainLearning(level1, async () => raw)
    assert.equal(shown.source, 'rules', `falls back to the template for: ${why}`)
    assert.equal(shown.text, learningTemplate(level1).text)
  }
  assert.equal((await explainLearning(level1, async () => { throw new Error('offline') })).source, 'rules', 'a failed call falls back too')
})

test('the template itself never gives a dose, claims what is best for the species, or quotes a number that is not in the evidence', () => {
  for (const e of [level0, level1, { ...level1, healthy: null }, { ...level1, dryingPerHour: null, waterRise: null }, { ...level1, healthy: null, dryingPerHour: null, waterRise: null }]) {
    const { text } = learningTemplate(e)
    const why = rejectLearningText(text, e)
    assert.ok(why === null || (e.level === 0 && why === 'label'), `${why}: ${text}`)
    assert.ok(text.length > 40)
  }
  assert.match(learningTemplate(level1).text, /52 sampai 66/)
  assert.match(learningTemplate({ ...level1, healthy: null, dryingPerHour: null, waterRise: null }).text, /Belum ada pola yang cukup jelas/)
})

test('the prompt carries the version, the rules and the evidence, and nothing about the owner', () => {
  const prompt = learningPrompt(level1)
  assert.match(prompt, new RegExp(LEARNING_PROMPT_VERSION.replaceAll('.', '\\.')))
  assert.equal(LEARNING_PROMPT_VERSION, 'smart-agro.explain.v2')
  assert.match(prompt, /jangan menyebut dosis/)
  assert.match(prompt, /bukan standar tanaman/)
  assert.ok(prompt.includes(JSON.stringify(level1)))
  assert.doesNotMatch(prompt, /@|email|akun|nama pengguna/i)
  assert.equal(prompt.match(/<evidence>/g)?.length, 1)
})

test('the evidence says how much is still missing, never below zero', () => {
  const e = learningEvidence('Peoni', 0, { days: 2, readings: 90, waterings: 0, inspections: 5 }, { healthy: null, dryingPerHour: null, waterRise: null }, THRESHOLDS)
  assert.deepEqual(e.missing, { days: 5, inspections: 0, waterings: 2 })
  assert.equal(e.speciesName, 'Peoni')
  assert.equal(e.level, 0)
})
