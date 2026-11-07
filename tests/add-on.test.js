// Runs without LUNA: `npm test`. Covers the music side; scripts/check-live.mjs covers LUNA.
import { describe, expect, it } from 'vitest';
import { Luna } from '@uaudio/luna-builder-sdk';

globalThis.Luna = Luna;
await import('../tunes.js');
await import('../logic.js');
await import('../formats.js');
const L = globalThis.AddOnLogic;
const Fmt = globalThis.ChartFormats;
const TUNES = globalThis.TUNES;

describe('chords', () => {
  it('reads jazz chord symbols', () => {
    const fam = (n) => L.parseChord(n).family;
    expect(fam('Cmaj7')).toBe('maj7');
    expect(fam('C6')).toBe('maj6');
    expect(fam('Dm7')).toBe('min7');
    expect(fam('Gm6')).toBe('min6');
    expect(fam('G7')).toBe('dom');
    expect(fam('D7#11')).toBe('dom11');
    expect(fam('G7alt')).toBe('alt');
    expect(fam('Am7b5')).toBe('half');
    expect(fam('Bdim7')).toBe('dim');
    expect(fam('C7#5')).toBe('aug7');
    expect(L.parseChord('F#m7b5').root).toBe(6);
    expect(L.parseChord('C/E')).toMatchObject({ root: 0, bass: 4 });
    expect(L.parseChord('H7')).toBeNull();
  });

  it('transposes and spells for the new key', () => {
    const blues = TUNES.find((t) => t.id === 'blues-f');
    const inBb = L.chart(blues, 5);
    expect(inBb.key).toBe('Bb');
    expect(inBb.bars[0].chords[0].name).toBe('Bb7');
    expect(inBb.bars[1].chords[0].name).toBe('Eb7');
    const inE = L.chart(blues, -1);
    expect(inE.key).toBe('E');
    expect(inE.bars[5].chords[0].name).toBe('A#dim7');
  });

  it('resolves % and splits bars evenly', () => {
    const ch = L.chart(TUNES.find((t) => t.id === 'rhythm-changes'));
    expect(ch.bars).toHaveLength(32);
    expect(ch.bars[17].chords[0].name).toBe('D7');           // bridge bar 2 is %
    expect(ch.bars[0].chords.map((c) => [c.beat, c.beats])).toEqual([[0, 2], [2, 2]]);
  });

  it('reads a typed chart', () => {
    const t = L.parseCustom('A: | Dm7 G7 | Cmaj7 | % |\nB: | Fm7 | Bb7 |');
    expect(t.sections.map((s) => s[0])).toEqual(['A', 'B']);
    expect(L.chart(t).bars).toHaveLength(5);
    expect(() => L.parseCustom('| Dm7 | Q7 |')).toThrow('Q7');
  });
});

describe('every built-in tune', () => {
  for (const tune of TUNES) {
    it(`${tune.title} generates in all four styles`, () => {
      for (const style of Object.keys(L.STYLES)) {
        const a = L.arrangement(tune, { style, choruses: 2, seed: 3 });
        expect(a.totalBeats).toBe(a.chart.bars.length * 4 * 2);
        for (const part of ['piano', 'bass', 'drums']) {
          expect(a[part].length).toBeGreaterThan(0);
          for (const n of a[part]) {
            expect(n.at).toBeGreaterThanOrEqual(0);
            expect(n.at).toBeLessThan(a.totalBeats);
            expect(n.dur).toBeGreaterThan(0);
            expect(n.vel).toBeGreaterThanOrEqual(1);
            expect(n.vel).toBeLessThanOrEqual(127);
          }
        }
        for (const n of a.bass) expect(n.pitch).toBeGreaterThanOrEqual(L.BASS_LO - 1), expect(n.pitch).toBeLessThanOrEqual(L.BASS_HI + 1);
      }
    });
  }
});

describe('piano', () => {
  const tune = TUNES.find((t) => t.id === 'minor-cycle-g');

  it('voices every chord with the right notes in a comfortable register', () => {
    const a = L.arrangement(tune, { choruses: 1, seed: 1 });
    const byStart = new Map();
    for (const n of a.piano) byStart.set(n.at, [...(byStart.get(n.at) ?? []), n.pitch]);
    for (const [at, pitches] of byStart) {
      const e = a.events.filter((x) => x.start <= at + 1e-9).pop();
      const want = L.FAMILIES[e.chord.family].rootless.map((i) => (e.chord.root + i) % 12).sort();
      expect(pitches.map((p) => p % 12).sort()).toEqual(want);
      expect(Math.min(...pitches)).toBeGreaterThanOrEqual(50);
      expect(Math.max(...pitches)).toBeLessThanOrEqual(77);
    }
  });

  it('hits every chord at least once', () => {
    const a = L.arrangement(TUNES.find((t) => t.id === 'rhythm-changes'), { choruses: 1, seed: 9 });
    for (const e of a.events) expect(a.piano.some((n) => n.at >= e.start - 1e-9 && n.at < e.start + e.beats - 1e-9)).toBe(true);
  });

  it('moves smoothly from voicing to voicing', () => {
    const a = L.arrangement(tune, { choruses: 1, seed: 2 });
    const chords = [...new Map(a.piano.map((n) => [n.at, []])).keys()].map((at) => a.piano.filter((n) => n.at === at).map((n) => n.pitch).sort((x, y) => x - y));
    for (let i = 1; i < chords.length; i++) {
      const move = chords[i].reduce((s, p, k) => s + Math.abs(p - (chords[i - 1][k] ?? p)), 0);
      expect(move).toBeLessThanOrEqual(20); // four voices, about a third each at most
    }
  });

  it('shell voicings are three notes with the root on the bottom', () => {
    const a = L.arrangement(tune, { choruses: 1, voicing: 'shell', seed: 1 });
    const first = a.piano.filter((n) => n.at === a.piano[0].at).map((n) => n.pitch).sort((x, y) => x - y);
    expect(first).toHaveLength(3);
  });
});

describe('bass and drums', () => {
  it('walks four to the bar and starts each chord on its root', () => {
    const a = L.arrangement(TUNES.find((t) => t.id === 'blues-f'), { style: 'swing', choruses: 1, seed: 4 });
    expect(a.bass).toHaveLength(48);
    for (const e of a.events) {
      const n = a.bass.find((x) => Math.abs(x.at - e.start) < 1e-9);
      expect(n.pitch % 12).toBe(e.chord.bass);
    }
  });

  it('swings the ride and plays drums on whole beats in a ballad', () => {
    const swing = L.drumPart(4, { style: 'swing', seed: 1 }).filter((n) => n.pitch === 51).map((n) => +n.at.toFixed(3));
    expect(swing).toEqual([0, 1, 1.667, 2, 3, 3.667]);
    const ballad = L.drumPart(4, { style: 'ballad', seed: 1 }).filter((n) => n.pitch === 51);
    for (const n of ballad) expect(Number.isInteger(n.at)).toBe(true);
  });

  it('changes with the seed and repeats with the same one', () => {
    const tune = TUNES[0];
    const a = JSON.stringify(L.arrangement(tune, { seed: 1 }).piano);
    expect(JSON.stringify(L.arrangement(tune, { seed: 1 }).piano)).toBe(a);
    expect(JSON.stringify(L.arrangement(tune, { seed: 2 }).piano)).not.toBe(a);
  });
});

describe('form position', () => {
  it('maps the playhead to a bar of the form', () => {
    const bar = 4 * Luna.TICKS_PER_BEAT;
    expect(L.formBar(0, 0, 12, 4)).toBe(0);
    expect(L.formBar(13 * bar + 5, 0, 12, 4)).toBe(1);
    expect(L.formBar(48 * bar, 0, 12, 4)).toBe(-1);
    expect(L.formBar(-1, 0, 12, 4)).toBe(-1);
  });
});

describe('lay out', () => {
  const blues = TUNES.find((t) => t.id === 'blues-f');

  it('drops the band for 4-bar phrases after the first chorus, hats keep time', () => {
    const a = L.arrangement(blues, { choruses: 3, layout: true, seed: 2 });
    expect(a.layout).toHaveLength(8);                                   // 4 bars in each of choruses 2 and 3
    expect(a.layout.every((b) => b >= 12)).toBe(true);                  // never in chorus 1
    for (const k of [0, 4]) expect(a.layout[k] % 4).toBe(0);            // on phrase boundaries
    const laid = new Set(a.layout);
    for (const part of ['piano', 'bass']) for (const n of a[part]) expect(laid.has(Math.floor(n.at / 4))).toBe(false);
    const drumsIn = a.drums.filter((n) => laid.has(Math.floor(n.at / 4)));
    expect(drumsIn.length).toBeGreaterThan(0);
    expect(drumsIn.every((n) => n.pitch === 44 || n.pitch === 42)).toBe(true);
  });

  it('changes nothing when off', () => {
    const on = L.arrangement(blues, { choruses: 2, seed: 2 });
    expect(on.layout).toEqual([]);
    expect(L.arrangement(blues, { choruses: 2, seed: 2, layout: false }).piano).toEqual(on.piano);
  });
});

describe('library', () => {
  it('says why every built-in chart is safe to ship', () => {
    for (const t of TUNES) expect(t.rights, t.title).toMatch(/^(Public domain in the US \(|Traditional|Generic form|Original drill)/);
  });
});

describe('beat grids', () => {
  it('holds chords with . and carries a chord across the bar line', () => {
    const t = { title: 'Grid', key: 'C', sections: [['', ['Dm7 . . G7', '. . Cmaj7 .', 'C / / /']]] };
    const bars = L.chart(t).bars.map((b) => b.chords.map((c) => `${c.name}@${c.beat}x${c.beats}`));
    expect(bars).toEqual([['Dm7@0x3', 'G7@3x1'], ['G7@0x2', 'Cmaj7@2x2'], ['C@0x4']]);
  });

  it('refuses a chart that starts by holding nothing', () => {
    expect(() => L.chart({ title: 'Bad', key: 'C', sections: [['', ['. C']]] })).toThrow('holds the chord before it');
  });
});

describe('text chart files', () => {
  it('reads headers and several charts per file', async () => {
    const text = 'Title: Tune One\nKey: Bb\nTempo: 180\nFeel: Bossa Nova\nA: | Bb6 | G7 | Cm7 . . F7 |\n---\nTitle: Tune Two\nKey: G-\n| Am7b5 | D7alt | Gm6 | % |';
    const { tunes, skipped } = await Fmt.parseChartFile(text, 'my-charts.txt');
    expect(skipped).toEqual([]);
    expect(tunes.map((t) => [t.title, t.key, t.tempo, t.style])).toEqual([['Tune One', 'Bb', 180, 'bossa'], ['Tune Two', 'Gm', 140, 'swing']]);
    expect(L.chart(tunes[0]).bars[2].chords.map((c) => c.beats)).toEqual([3, 1]);
  });

  it('names untitled charts after the file and reports bad ones', async () => {
    const { tunes, skipped } = await Fmt.parseChartFile('| Dm7 | G7 |\n---\n| Dm7 | Zz7 |', 'practice.txt');
    expect(tunes[0].title).toBe('practice 1');
    expect(skipped).toEqual([{ title: 'practice 2', reason: expect.stringContaining('Zz7') }]);
  });

  it('reads the example file that ships with the Add On', async () => {
    const { readFileSync } = await import('node:fs');
    const { tunes, skipped } = await Fmt.parseChartFile(readFileSync(new URL('../example-charts.txt', import.meta.url), 'utf8'), 'example-charts.txt');
    expect(skipped).toEqual([]);
    expect(tunes.length).toBeGreaterThanOrEqual(2);
  });
});

// A small lead sheet the way notation apps write it: chords as <harmony> over rests.
const harmony = (step, kind, { alter, bass, degree, offset } = {}) =>
  `<harmony><root><root-step>${step}</root-step>${alter ? `<root-alter>${alter}</root-alter>` : ''}</root><kind text="x">${kind}</kind>` +
  (bass ? `<bass><bass-step>${bass}</bass-step></bass>` : '') +
  (degree ? `<degree><degree-value>${degree[0]}</degree-value><degree-alter>${degree[1]}</degree-alter><degree-type>alter</degree-type></degree>` : '') +
  (offset ? `<offset>${offset}</offset>` : '') + '</harmony>';
const rest = (beats) => `<note><rest/><duration>${beats * 2}</duration><voice>1</voice></note>`;
const measure = (n, body, { left = '', right = '', implicit = false } = {}) =>
  `<measure number="${n}"${implicit ? ' implicit="yes"' : ''}>${left}${body}${right}</measure>`;
const MUSICXML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-title>Lead &amp; Sheet</work-title></work>
  <identification><creator type="composer">A. Writer</creator></identification>
  <part-list><score-part id="P1"><part-name>Lead</part-name></score-part></part-list>
  <part id="P1">
    ${measure(0, rest(1), { implicit: true })}
    ${measure(1, `<attributes><divisions>2</divisions><key><fifths>-3</fifths><mode>minor</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <direction><direction-type><rehearsal>A</rehearsal></direction-type><sound tempo="96"/></direction>
      ${harmony('C', 'minor-seventh')}${rest(4)}`, { left: '<barline location="left"><repeat direction="forward"/></barline>' })}
    ${measure(2, `${harmony('F', 'dominant')}${rest(3)}${harmony('B', 'dominant', { alter: -1, degree: [9, -1] })}${rest(1)}`)}
    ${measure(3, `${harmony('E', 'major-seventh', { alter: -1 })}${rest(4)}`, { left: '<barline location="left"><ending number="1" type="start"/></barline>', right: '<barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline>' })}
    ${measure(4, `${harmony('D', 'half-diminished')}${rest(2)}${harmony('G', 'dominant', { bass: 'B' })}${rest(2)}`, { left: '<barline location="left"><ending number="2" type="start"/></barline>', right: '<barline location="right"><ending number="2" type="discontinue"/></barline>' })}
    ${measure(5, `<direction><direction-type><rehearsal>B</rehearsal></direction-type></direction>${rest(2)}${harmony('A', 'major-sixth', { alter: -1 })}${rest(2)}`)}
  </part>
</score-partwise>`;

describe('MusicXML', () => {
  it('reads chords with their beats, key, tempo, sections, repeats and endings', async () => {
    const { tunes, skipped } = await Fmt.parseChartFile(MUSICXML, 'lead.musicxml');
    expect(skipped).toEqual([]);
    const t = tunes[0];
    expect([t.title, t.composer, t.key, t.tempo]).toEqual(['Lead & Sheet', 'A. Writer', 'Cm', 96]);
    const bars = L.chart(t).bars;
    expect(bars.map((b) => b.chords.map((c) => c.name).join(' '))).toEqual([
      'Cm7', 'F7 Bb7alt', 'Ebmaj7',      // first time through, first ending
      'Cm7', 'F7 Bb7alt',                // repeat
      'Dm7b5 G7/B',                      // second ending
      'G7/B Ab6',                        // B: the chord before carries until beat 3
    ]);
    expect(bars[1].chords.map((c) => c.beats)).toEqual([3, 1]);
    expect(bars.filter((b) => b.section).map((b) => b.section)).toEqual(['A', 'A', 'B']); // the repeat is A again
  });

  it('opens a compressed .mxl file', async () => {
    const { deflateRawSync } = await import('node:zlib');
    const entries = [
      ['META-INF/container.xml', '<container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>'],
      ['score.musicxml', MUSICXML],
    ];
    const zip = makeZip(entries.map(([n, t]) => [n, deflateRawSync(Buffer.from(t))]));
    const { tunes, skipped } = await Fmt.parseChartFile(zip, 'lead.mxl');
    expect(skipped).toEqual([]);
    expect(tunes[0].title).toBe('Lead & Sheet');
  });

  it('says what is wrong with scores it cannot use', async () => {
    const waltz = MUSICXML.replace('<beats>4</beats>', '<beats>3</beats>');
    expect((await Fmt.parseChartFile(waltz, 'w.musicxml')).skipped[0].reason).toContain('3/4');
    const noChords = MUSICXML.replace(/<harmony>[\s\S]*?<\/harmony>/g, '');
    expect((await Fmt.parseChartFile(noChords, 'n.musicxml')).skipped[0].reason).toContain('no chord symbols');
    expect((await Fmt.parseChartFile('<score-partwise><part', 'x.musicxml')).skipped).toHaveLength(1);
  });
});

describe('ChordPro', () => {
  const CHO = `{title: Grid Tune}
{key: F}
{tempo: 132}
{meta: feel two-feel}
Some lyrics with [F]inline chords are ignored here.
{start_of_grid label="A"}
|: F6 . . . | Gm7 . C7 . | Am7 . D7 . |1 Gm7 . C7 . :|2 Gm7 . C7 . | F6 . . . |
{end_of_grid}
{start_of_grid: B}
B | Bb6 . . . | % | Bbm6 . . . | %% |
{end_of_grid}`;

  it('reads grid sections with repeats, endings and % bars', async () => {
    const { tunes, skipped } = await Fmt.parseChartFile(CHO, 'grid.cho');
    expect(skipped).toEqual([]);
    const t = tunes[0];
    expect([t.title, t.key, t.tempo, t.style]).toEqual(['Grid Tune', 'F', 132, 'two']);
    expect(L.chart(t).bars.map((b) => b.chords.map((c) => c.name).join(' '))).toEqual([
      'F6', 'Gm7 C7', 'Am7 D7', 'Gm7 C7',   // first time, ending 1
      'F6', 'Gm7 C7', 'Am7 D7',             // repeat
      'Gm7 C7', 'F6',                       // ending 2
      'Bb6', 'Bb6', 'Bbm6', 'Bb6', 'Bbm6',  // % and %%
    ]);
    expect(L.chart(t).bars.filter((b) => b.section).map((b) => b.section)).toEqual(['A', 'A', 'B']);
  });

  it('explains a lyrics-only ChordPro file', async () => {
    const { skipped } = await Fmt.parseChartFile('{title: Song}\n[C]Some [G7]words', 'song.cho');
    expect(skipped[0].reason).toContain('start_of_grid');
  });
});

describe('repeats', () => {
  it('plays a plain repeat twice and resets for the next one', () => {
    const bars = [{ n: 1 }, { n: 2, end: true }, { n: 3, start: true }, { n: 4, end: true }].map((b) => ({ endings: null, ...b }));
    expect(Fmt.playRepeats(bars).map((b) => b.n)).toEqual([1, 2, 1, 2, 3, 4, 3, 4]);
  });
});

// A stored-entry-free zip writer for the .mxl test: deflated entries, no CRCs checked by the reader.
function makeZip(entries) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const n = enc.encode(name);
    const local = new Uint8Array(30 + n.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(8, 8, true);
    dv.setUint32(18, data.length, true);
    dv.setUint16(26, n.length, true);
    local.set(n, 30);
    const c = new Uint8Array(46 + n.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(20, data.length, true);
    cv.setUint16(28, n.length, true);
    cv.setUint32(42, offset, true);
    c.set(n, 46);
    parts.push(local, data);
    central.push(c);
    offset += local.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}
