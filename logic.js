// Comp Machine: logic that does not touch the DOM, so tests can exercise it without LUNA.
//
// Two halves:
//  - Music: parse a chart, transpose it, and generate piano, bass and drum notes as plain data
//    (times in beats). Deterministic for a given seed, so "New variation" is just a new seed.
//  - LUNA: make the Comp tracks (Apple's DLSMusicDevice, a General MIDI set), write each part
//    into one MIDI clip, put the chords on the Chord ruler, set the tempo and loop the form.

// ---- chords ------------------------------------------------------------------------------

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// Keys spelled with sharps (major, and the relative of minor keys).
const SHARP_KEYS = new Set([7, 2, 9, 4, 11, 6]); // G D A E B F#

/**
 * The chord families the voicer knows, each as intervals above the root:
 *  - `rootless`: a four-note left-hand voicing without the root (Bill Evans "A" form).
 *  - `shell`: root, 3rd and 7th, sparse, for staying out of a guitarist's way.
 *  - `tones`: chord tones the walking bass may use.
 */
const FAMILIES = {
  maj7: { rootless: [4, 7, 11, 14], shell: [0, 4, 11], tones: [0, 4, 7, 11] },
  maj6: { rootless: [4, 7, 9, 14], shell: [0, 4, 9], tones: [0, 4, 7, 9] },
  min7: { rootless: [3, 7, 10, 14], shell: [0, 3, 10], tones: [0, 3, 7, 10] },
  min6: { rootless: [3, 7, 9, 14], shell: [0, 3, 9], tones: [0, 3, 7, 9] },
  minmaj7: { rootless: [3, 7, 11, 14], shell: [0, 3, 11], tones: [0, 3, 7, 11] },
  dom: { rootless: [4, 9, 10, 14], shell: [0, 4, 10], tones: [0, 4, 7, 10] },
  dom11: { rootless: [4, 6, 10, 14], shell: [0, 4, 10], tones: [0, 4, 7, 10] },
  alt: { rootless: [4, 10, 13, 20], shell: [0, 4, 10], tones: [0, 4, 8, 10] },
  aug7: { rootless: [4, 8, 10, 14], shell: [0, 4, 10], tones: [0, 4, 8, 10] },
  sus: { rootless: [5, 7, 10, 14], shell: [0, 5, 10], tones: [0, 5, 7, 10] },
  half: { rootless: [3, 6, 10, 17], shell: [0, 3, 10], tones: [0, 3, 6, 10] },
  dim: { rootless: [0, 3, 6, 9], shell: [0, 3, 9], tones: [0, 3, 6, 9] },
};

/** Map a chord quality (the text after the root) to a family. */
function familyOf(q) {
  const s = q.replace(/[()]/g, '');
  if (/^(maj|ma|M|Δ)/.test(s)) return 'maj7';       // before the minor checks: "maj7" starts with "m"
  if (/^(m|min|-)(maj|ma|M|Δ)7?/.test(s)) return 'minmaj7';
  if (/^(m7b5|ø|-7b5|min7b5)/.test(s)) return 'half';
  if (/^(dim|o)/.test(s)) return 'dim';
  if (/^(m|min|-)6/.test(s)) return 'min6';
  if (/^(m|min|-)/.test(s)) return 'min7';
  if (/^6/.test(s) || s === '' || s === '69') return 'maj6';
  if (/^(aug|\+)/.test(s)) return 'aug7';
  if (/sus/.test(s)) return 'sus';
  if (/alt|b9|#9|b13/.test(s)) return 'alt';
  if (/#5|\+5/.test(s)) return 'aug7';
  if (/#11/.test(s)) return 'dom11';
  if (/^(7|9|11|13)/.test(s)) return 'dom';
  return 'maj6';
}

/** Parse `Dm7b5`, `Bb7alt`, `C/E` into `{ root, quality, family, bass }` (pitch classes). */
function parseChord(name) {
  const m = /^([A-G])([#b]?)(.*?)(?:\/([A-G][#b]?))?$/.exec(String(name).trim());
  if (!m) return null;
  const root = (PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  const bass = m[4] ? (PC[m[4][0]] + (m[4][1] === '#' ? 1 : m[4][1] === 'b' ? -1 : 0) + 12) % 12 : root;
  return { root, quality: m[3], family: familyOf(m[3]), bass };
}

/** Spell a chord in a key: same quality, root named with sharps or flats as the key prefers. */
function spell(chord, keyPc) {
  const names = SHARP_KEYS.has(keyPc) ? SHARP_NAMES : FLAT_NAMES;
  const slash = chord.bass !== chord.root ? `/${names[chord.bass]}` : '';
  return `${names[chord.root]}${chord.quality}${slash}`;
}

/** Key name (`Bb`, `Gm`) to `{ pc, minor }`. */
function parseKey(key) {
  const c = parseChord(key);
  return { pc: c.root, minor: /^m/.test(c.quality) };
}

function keyName(pc, minor) {
  // Minor keys spell like their relative major.
  const names = SHARP_KEYS.has(minor ? (pc + 3) % 12 : pc) ? SHARP_NAMES : FLAT_NAMES;
  return names[pc] + (minor ? 'm' : '');
}

// ---- charts ------------------------------------------------------------------------------

/**
 * A tune's chart, flattened and transposed: `{ bars: [{ section, chords: [{ name, chord,
 * beat, beats }] }], key }`, 4/4, with `%` resolved.
 */
function chart(tune, semitones = 0) {
  const key = parseKey(tune.key);
  const toKey = (key.pc + semitones + 120) % 12;
  const keyPc = key.minor ? (toKey + 3) % 12 : toKey; // spell minor keys like their relative major
  const bars = [];
  let prev = null;     // the previous bar's segments, for %
  let last = null;     // the chord sounding at the end of the previous bar, for a leading .
  for (const [section, list] of tune.sections) {
    list.forEach((text, i) => {
      const segs = barSegments(text, prev, last, tune.title);
      prev = segs;
      last = segs[segs.length - 1].n;
      let beat = 0;
      const chords = segs.map(({ n, beats }) => {
        const c = parseChord(n);
        if (!c) throw new Error(`Can't read the chord "${n}" in ${tune.title}`);
        const t = { ...c, root: (c.root + semitones + 120) % 12, bass: (c.bass + semitones + 120) % 12 };
        const out = { name: spell(t, keyPc), chord: t, beat, beats };
        beat += beats;
        return out;
      });
      bars.push({ section: i === 0 ? section : null, chords });
    });
  }
  return { bars, key: keyName(toKey, key.minor) };
}

/**
 * One bar's chords as `[{ n, beats }]`. The tokens share the bar's four beats evenly; `.` or
 * `/` holds the chord before it for its share (`Dm7 . . G7` is three beats and one); a bar
 * that starts with `.` carries the previous bar's last chord; `%` repeats the previous bar.
 */
function barSegments(text, prev, last, title) {
  const t = String(text).trim();
  if (t === '%') {
    if (!prev) throw new Error(`${title} starts with %, which repeats the bar before`);
    return prev;
  }
  const tokens = t.split(/\s+/).filter(Boolean);
  if (!tokens.length) throw new Error(`${title} has an empty bar`);
  const per = 4 / tokens.length;
  const segs = [];
  for (const tok of tokens) {
    if (tok === '.' || tok === '/') {
      if (segs.length) segs[segs.length - 1].beats += per;
      else if (last) segs.push({ n: last, beats: per });
      else throw new Error(`${title} starts with ${tok}, which holds the chord before it`);
    } else segs.push({ n: tok, beats: per });
  }
  return segs;
}

const HEADERS = /^(title|key|tempo|bpm|feel|style|composer)\s*:\s*(.*)$/i;
const FEELS = { swing: 'swing', medium: 'swing', 'medium swing': 'swing', up: 'swing', two: 'two', 'two-feel': 'two', ballad: 'ballad', bossa: 'bossa', 'bossa nova': 'bossa', latin: 'bossa' };

/** A feel name from a chart (`Bossa Nova`, `Medium Swing`) to one of STYLES. */
function feelOf(text, fallback = 'swing') {
  const t = String(text ?? '').trim().toLowerCase();
  if (FEELS[t]) return FEELS[t];
  if (/bossa|latin|samba|even 8/.test(t)) return 'bossa';
  if (/ballad/.test(t)) return 'ballad';
  if (/two/.test(t)) return 'two';
  return fallback;
}

/**
 * Parse a typed chart: bars separated by `|`, chords by spaces, `%` repeats; a line starting
 * with a short label and a colon (`A:`) names a section. Optional header lines (`Title:`,
 * `Key:`, `Tempo:`, `Feel:`) set the rest. Returns a tune.
 */
function parseCustom(text, { title = 'My chart', key = 'C', tempo = 140, style = 'swing' } = {}) {
  const sections = [];
  const meta = { title, key, tempo, style };
  let current = null;
  for (const raw of text.split('\n')) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const header = !line.includes('|') && HEADERS.exec(line);
    if (header) {
      const [, k, v] = header;
      const name = k.toLowerCase();
      if (name === 'title') meta.title = v.trim() || meta.title;
      else if (name === 'key') {
        if (!parseChord(v.trim().replace(/-$/, 'm'))) throw new Error(`Can't read the key "${v.trim()}"`);
        meta.key = v.trim().replace(/-$/, 'm');
      } else if (name === 'tempo' || name === 'bpm') meta.tempo = Math.max(40, Math.min(320, parseInt(v, 10) || meta.tempo));
      else if (name === 'feel' || name === 'style') meta.style = feelOf(v, meta.style);
      continue;
    }
    const label = /^([A-Za-z0-9 ]{1,12}):/.exec(line);
    if (label) {
      current = [label[1].trim(), []];
      sections.push(current);
      line = line.slice(label[0].length);
    }
    const bars = line.split('|').map((b) => b.trim()).filter(Boolean);
    if (!bars.length) continue;
    if (!current) {
      current = ['', []];
      sections.push(current);
    }
    current[1].push(...bars);
  }
  if (!sections.length) throw new Error('Type some bars, e.g. | Dm7 G7 | Cmaj7 |');
  const tune = { id: 'custom', ...meta, sections };
  chart(tune); // throws on a chord it cannot read
  return tune;
}

// ---- generation --------------------------------------------------------------------------

/** Small seeded random (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STYLES = {
  swing: { label: 'Medium swing', piano: 'swing', bass: 'walk', drums: 'swing', swing: true },
  two: { label: 'Two-feel', piano: 'sparse', bass: 'two', drums: 'two', swing: true },
  ballad: { label: 'Ballad', piano: 'ballad', bass: 'two', drums: 'ballad', swing: true },
  bossa: { label: 'Bossa nova', piano: 'bossa', bass: 'bossa', drums: 'bossa', swing: false },
};

/** Every chord in the form as `{ chord, name, start, beats, bar }` (start in beats from the top). */
function timeline(ch, choruses = 1) {
  const out = [];
  const formBeats = ch.bars.length * 4;
  for (let c = 0; c < choruses; c++) {
    ch.bars.forEach((bar, b) => {
      for (const x of bar.chords) out.push({ ...x, start: c * formBeats + b * 4 + x.beat, bar: c * ch.bars.length + b });
    });
  }
  return out;
}

/** The chord sounding at `beat`. */
function chordAt(events, beat) {
  let found = events[0];
  for (const e of events) if (e.start <= beat + 1e-9) found = e;
  return found;
}

// Swung 8th: the "and" lands at 2/3 of the beat when swinging.
const offbeat = (swing) => (swing ? 2 / 3 : 0.5);

/** Piano rhythm for one bar: hits as `{ at, dur }` in beats from the bar start. */
function pianoBar(kind, rand, swing) {
  const and = offbeat(swing);
  if (kind === 'ballad') return [{ at: 0, dur: 3.9 }];
  if (kind === 'sparse') return rand() < 0.5 ? [{ at: 0, dur: 1.8 }] : [{ at: 1 + and, dur: 1.2 }];
  if (kind === 'bossa') {
    return rand() < 0.5
      ? [{ at: 0, dur: 1.2 }, { at: 1.5, dur: 0.4 }, { at: 3, dur: 0.4 }]
      : [{ at: 0.5, dur: 0.4 }, { at: 2, dur: 1.2 }, { at: 3.5, dur: 0.4 }];
  }
  // Medium swing: mix Charleston, reverse Charleston, a push and lay-back figures.
  const figures = [
    [{ at: 0, dur: 1.2 }, { at: 1 + and, dur: 0.3 }],           // Charleston
    [{ at: and, dur: 0.3 }, { at: 2, dur: 1.2 }],                 // reverse Charleston
    [{ at: 1, dur: 0.3 }, { at: 3, dur: 0.3 }],                   // 2 and 4
    [{ at: 0, dur: 0.3 }, { at: 2 + and, dur: 0.3 }],             // 1, and of 3
    [{ at: 1 + and, dur: 1.5 }],                                  // lay back
    [{ at: 0, dur: 2.5 }],                                        // hold
  ];
  return figures[Math.floor(rand() * figures.length)];
}

/** All the voicings of `intervals` over `root`, as close inversions with the bottom note in range. */
function candidates(root, intervals, lo = 50, hi = 62) {
  const out = [];
  for (let inv = 0; inv < intervals.length; inv++) {
    const order = [...intervals.slice(inv), ...intervals.slice(0, inv)];
    const pcs = order.map((i) => (root + i) % 12);
    for (let bottom = lo; bottom <= hi; bottom++) {
      if (bottom % 12 !== pcs[0]) continue;
      const v = [bottom];
      for (const pc of pcs.slice(1)) {
        let n = v[v.length - 1] + 1;
        while (n % 12 !== pc) n++;
        v.push(n);
      }
      if (v[v.length - 1] <= 77) out.push(v);
    }
  }
  return out;
}

/** The candidate nearest the previous voicing (smooth voice-leading), or nearest middle C. */
function voiceLead(cands, prev) {
  const cost = (v) => (prev ? v.reduce((s, n, i) => s + Math.abs(n - (prev[i] ?? prev[prev.length - 1])), 0) : Math.abs(v[0] + v[v.length - 1] - 120));
  return cands.reduce((best, v) => (cost(v) < cost(best) ? v : best));
}

/** Piano notes: `{ pitch, at, dur, vel }`, times in beats from the top. */
function pianoPart(events, totalBeats, { style, voicing = 'rootless', seed = 1 }) {
  const st = STYLES[style];
  const rand = rng(seed * 7 + 1);
  const notes = [];
  let prev = null;
  const bars = totalBeats / 4;
  const hitsFor = (start) => pianoBar(st.piano, rand, st.swing).map((h) => ({ ...h, at: start + h.at }));
  for (let b = 0; b < bars; b++) {
    const barStart = b * 4;
    let hits = hitsFor(barStart);
    // Every chord gets at least one hit: a chord change mid-bar with no hit in it gets one on its downbeat.
    for (const e of events.filter((x) => x.start >= barStart && x.start < barStart + 4)) {
      if (!hits.some((h) => h.at >= e.start - 1e-9 && h.at < e.start + e.beats - 1e-9)) {
        hits = hits.filter((h) => h.at < e.start);
        hits.push({ at: e.start, dur: Math.min(e.beats, 1.5) * 0.9 });
      }
    }
    for (const h of hits) {
      const e = chordAt(events, h.at);
      const fam = FAMILIES[e.chord.family];
      const v = voiceLead(candidates(e.chord.root, voicing === 'shell' ? fam.shell : fam.rootless, voicing === 'shell' ? 43 : 50, voicing === 'shell' ? 55 : 62), prev);
      prev = v;
      // Never ring past the next chord change.
      const next = events.find((x) => x.start > e.start + 1e-9);
      const end = Math.min(h.at + h.dur, next ? next.start : totalBeats, totalBeats);
      const vel = Math.round((st.piano === 'ballad' ? 52 : 64) + rand() * 14);
      for (const pitch of v) notes.push({ pitch, at: h.at, dur: Math.max(0.1, end - h.at - 0.02), vel });
    }
  }
  return notes;
}

const BASS_LO = 28; // E1
const BASS_HI = 52; // E3
/** `pc` placed nearest `near`, within the bass range. */
function place(pc, near) {
  let best = null;
  for (let n = BASS_LO; n <= BASS_HI; n++) if (n % 12 === pc && (best === null || Math.abs(n - near) < Math.abs(best - near))) best = n;
  return best;
}

/** Bass notes: walking (4 to the bar), two-feel or bossa. */
function bassPart(events, totalBeats, { style, seed = 1 }) {
  const st = STYLES[style];
  const rand = rng(seed * 13 + 5);
  const notes = [];
  let last = 36;
  // Split chords that last longer than a bar into bar-long pieces, so a long chord still walks.
  const pieces = [];
  for (const e of events) {
    for (let s = e.start; s < e.start + e.beats - 1e-9; s += 4) pieces.push({ ...e, start: s, beats: Math.min(4, e.start + e.beats - s), first: s === e.start });
  }
  pieces.forEach((e, i) => {
    const nextE = pieces[i + 1] ?? pieces[0];
    const tones = FAMILIES[e.chord.family].tones;
    const root = place(e.first ? e.chord.bass : (e.chord.root + (rand() < 0.5 ? 7 : 0)) % 12, last);
    const target = place(nextE.first ? nextE.chord.bass : nextE.chord.root, root + (rand() < 0.5 ? 5 : -5));
    const vel = () => Math.round(84 + rand() * 16);
    if (st.bass === 'bossa') {
      const fifth = place((e.chord.root + 7) % 12, root + 4);
      const pat = e.beats >= 4
        ? [[0, 1.4, root], [1.5, 0.4, fifth], [2, 1.4, fifth], [3.5, 0.4, root]]
        : [[0, 1.4, root], [1.5, 0.4, fifth]];
      for (const [at, dur, pitch] of pat) if (at < e.beats) notes.push({ pitch, at: e.start + at, dur, vel: vel() });
      last = root;
      return;
    }
    if (st.bass === 'two') {
      const second = e.beats >= 4 ? (rand() < 0.5 ? place((e.chord.root + 7) % 12, root) : target + (target > root ? -1 : 1)) : null;
      notes.push({ pitch: root, at: e.start, dur: Math.min(e.beats, 2) - 0.05, vel: vel() });
      if (second !== null) notes.push({ pitch: second, at: e.start + 2, dur: 1.95, vel: vel() });
      last = second ?? root;
      return;
    }
    // Walking: root, chord or scale tones heading for the next root, then an approach note.
    const line = [root];
    const approach = () => {
      const fromAbove = rand() < 0.5;
      const n = target + (fromAbove ? 1 : -1);
      return n < BASS_LO ? n + 2 : n > BASS_HI ? n - 2 : n;
    };
    if (e.beats >= 2) {
      const between = Math.round(e.beats) - 2; // notes between root and approach
      const options = [];
      for (let n = BASS_LO; n <= BASS_HI; n++) if (tones.includes(((n - e.chord.root) % 12 + 12) % 12) || rand() < 0.05) options.push(n);
      let cur = root;
      for (let k = 1; k <= between; k++) {
        const aim = root + ((target - root) * k) / (between + 1) + (target === root ? (k === 1 ? 4 : 7) : 0);
        const pick = options.filter((n) => n !== cur).reduce((a, b) => (Math.abs(b - aim) < Math.abs(a - aim) ? b : a));
        line.push(pick);
        cur = pick;
      }
      line.push(approach());
    }
    line.forEach((pitch, k) => notes.push({ pitch, at: e.start + k, dur: 0.92, vel: vel() + (k === 0 ? 6 : 0) }));
    last = line[line.length - 1];
  });
  return notes;
}

const RIDE = 51;
const PEDAL_HAT = 44;
const CLOSED_HAT = 42;
const KICK = 36;
const STICK = 37;

/** Drum notes (General MIDI, channel 10). */
function drumPart(totalBeats, { style, seed = 1 }) {
  const st = STYLES[style];
  const rand = rng(seed * 17 + 3);
  const and = offbeat(st.swing);
  const notes = [];
  const hit = (pitch, at, vel, dur = 0.2) => at < totalBeats && notes.push({ pitch, at, dur, vel: Math.max(1, Math.min(127, Math.round(vel + (rand() - 0.5) * 10))) });
  for (let b = 0; b < totalBeats / 4; b++) {
    const t = b * 4;
    if (st.drums === 'bossa') {
      for (let k = 0; k < 8; k++) hit(CLOSED_HAT, t + k * 0.5, k % 2 ? 42 : 55);
      for (const at of b % 2 ? [1, 2.5] : [0, 1.5, 3]) hit(STICK, t + at, 70);
      for (const at of [0, 1.5, 2, 3.5]) hit(KICK, t + at, at % 2 === 0 ? 62 : 48);
      continue;
    }
    const soft = st.drums === 'ballad' ? 0.6 : 1;
    // Ride: ding, ding-a, ding, ding-a.
    for (const at of [0, 1, 1 + and, 2, 3, 3 + and]) if (st.drums !== 'ballad' || Number.isInteger(at)) hit(RIDE, t + at, (Number.isInteger(at) ? (at % 2 ? 88 : 74) : 58) * soft);
    hit(PEDAL_HAT, t + 1, 72 * soft);
    hit(PEDAL_HAT, t + 3, 72 * soft);
    // Feathered kick: quarters in swing, 1 and 3 in two.
    for (const at of st.drums === 'two' || st.drums === 'ballad' ? [0, 2] : [0, 1, 2, 3]) hit(KICK, t + at, 30 * soft);
    // A light snare comment now and then, on the swung "and" of 4 heading into the next bar.
    if (st.drums === 'swing' && rand() < 0.18) hit(38, t + 3 + and, 50);
  }
  return notes;
}

/**
 * Lay-out bars: after the first chorus the band drops out for a 4-bar phrase (one per 16 bars
 * of form), at a different place each chorus. Global bar indexes, sorted.
 */
function layoutBars(barsInForm, choruses, seed) {
  const out = [];
  const phrases = Math.max(1, Math.floor(barsInForm / 4));
  const perChorus = Math.max(1, Math.floor(barsInForm / 16));
  for (let c = 1; c < choruses; c++) {
    const rand = rng(seed * 31 + c);
    const picked = new Set();
    while (picked.size < Math.min(perChorus, phrases)) picked.add(Math.floor(rand() * phrases));
    for (const p of picked) for (let k = 0; k < 4 && p * 4 + k < barsInForm; k++) out.push(c * barsInForm + p * 4 + k);
  }
  return out.sort((a, b) => a - b);
}

const HATS = new Set([42, 44]);
/** Drop a part's notes in lay-out bars; ones ringing into a lay-out bar stop at its downbeat. Hats keep time. */
function layOut(notes, laid, { keepHats = false } = {}) {
  if (!laid.size) return notes;
  const out = [];
  for (const n of notes) {
    if (laid.has(Math.floor(n.at / 4))) {
      if (keepHats && HATS.has(n.pitch)) out.push({ ...n, vel: Math.max(1, Math.round(n.vel * 0.7)) });
      continue;
    }
    const nextBar = (Math.floor(n.at / 4) + 1) * 4;
    out.push(laid.has(nextBar / 4) && n.at + n.dur > nextBar ? { ...n, dur: nextBar - n.at - 0.02 } : n);
  }
  return out;
}

/** Everything the page needs to write one arrangement. */
function arrangement(tune, { semitones = 0, choruses = 4, style, voicing = 'rootless', seed = 1, layout = false, parts = { piano: true, bass: true, drums: true } } = {}) {
  const ch = chart(tune, semitones);
  const s = style ?? tune.style ?? 'swing';
  const events = timeline(ch, choruses);
  const totalBeats = ch.bars.length * 4 * choruses;
  const laidOut = layout ? layoutBars(ch.bars.length, choruses, seed) : [];
  const laid = new Set(laidOut);
  return {
    chart: ch,
    style: s,
    totalBeats,
    events,
    layout: laidOut,
    piano: parts.piano ? layOut(pianoPart(events, totalBeats, { style: s, voicing, seed }), laid) : [],
    bass: parts.bass ? layOut(bassPart(events, totalBeats, { style: s, seed }), laid) : [],
    drums: parts.drums ? layOut(drumPart(totalBeats, { style: s, seed }), laid, { keepHats: true }) : [],
  };
}

// ---- LUNA --------------------------------------------------------------------------------

const PARTS = [
  { id: 'piano', track: 'Comp Piano', program: 0, channel: 0 },   // Acoustic Grand Piano
  { id: 'bass', track: 'Comp Bass', program: 32, channel: 0 },    // Acoustic Bass
  { id: 'drums', track: 'Comp Drums', program: null, channel: 9 }, // GM drums live on channel 10
];
const DLS_NAME = 'DLSMusicDevice';

/** The installed General MIDI instrument's plugin id, or null. */
async function gmInstrument(luna, session) {
  const rows = await luna.plugins.query({ insertType: 'instrument', sessionUid: session.uid, search: DLS_NAME });
  return rows.find((r) => r.name === DLS_NAME)?.pluginId ?? null;
}

/** The Comp tracks that exist, by part id. */
function findParts(session) {
  const out = {};
  for (const p of PARTS) out[p.id] = session.visibleTracks.find((t) => t.name.value === p.track && t.trackType.value === 'instrument') ?? null;
  return out;
}

/** Make whichever Comp tracks are missing, each with the General MIDI instrument. */
async function ensureParts(luna, session, wanted) {
  const have = findParts(session);
  const missing = PARTS.filter((p) => wanted[p.id] && !have[p.id]);
  if (missing.length) {
    const pluginId = await gmInstrument(luna, session);
    if (!pluginId) throw new Error(`${DLS_NAME} (Apple's General MIDI synth) is not available`);
    for (const p of missing) {
      const [track] = await session.newTrack({ name: p.track, trackType: 'instrument', stemFormat: 'stereo' });
      await track.insert(pluginId, 'instrument');
      have[p.id] = track;
    }
  }
  return have;
}

/** Remove every clip on a track's active lane, as one undo step. */
async function clearTrack(session, track) {
  const lane = session.playlistFor(track);
  if (!lane) return;
  await lane.clips.load();
  const clips = [...lane.clips.items];
  if (!clips.length) return;
  await session.transaction(`Clear ${track.name.value}`, async () => {
    for (const c of clips) await c.delete();
  });
}

/** Beats to ticks from `start`. */
const ticks = (start, beats) => start + Math.round(beats * Luna.TICKS_PER_BEAT);

/**
 * Write one part as a single MIDI clip from `startTick` spanning `totalBeats`. LUNA makes a
 * MIDI clip only around notes it writes (fact 111), on channel 0, so one placeholder note
 * spanning the form makes the clip, is removed, and the real notes go in with their channel.
 */
async function writePart(session, track, part, notes, startTick, totalBeats) {
  const lane = session.playlistFor(track);
  const endTick = ticks(startTick, totalBeats);
  const { clip } = await lane.createNotes([{ pitch: 0, startTick, stopTick: endTick, velocity: 1 }]);
  await clip.midi.ready();
  await clip.midi.deleteNotes([...clip.midi.notes.items]);
  const offset = startTick - clip.start.value; // clip-relative ticks (0 when the form starts on a bar line)
  if (part.program !== null) await clip.addMidi([{ tick: offset, status: 0xc0 | part.channel, data1: part.program }]);
  if (notes.length) {
    await clip.addNotes(notes.map((n) => ({
      pitch: n.pitch,
      tick: offset + Math.round(n.at * Luna.TICKS_PER_BEAT),
      lengthTicks: Math.max(1, Math.round(n.dur * Luna.TICKS_PER_BEAT)),
      velocity: n.vel,
      channel: part.channel,
    })));
  }
  return clip;
}

/**
 * Load an arrangement into the session: Comp tracks, one clip per part from bar 1, chords on
 * the ruler, tempo, and the loop round the whole thing. Returns `{ startTick, endTick, tracks }`.
 */
async function load(luna, session, arr, { tempo, onStep = () => {} } = {}) {
  const wanted = { piano: arr.piano.length > 0, bass: arr.bass.length > 0, drums: arr.drums.length > 0 };
  onStep('Setting up tracks');
  const tracks = await ensureParts(luna, session, wanted);
  const timeline = session.musical.timeline;
  const startTick = timeline.tickAt({ bar: 1 });
  if (tempo) {
    onStep('Setting the tempo');
    await session.musical.setTempoInEffectAt(tempo, startTick);
  }
  const endTick = ticks(startTick, arr.totalBeats);
  const sendMidi = new Luna.SendMidi(luna);
  for (const part of PARTS) {
    const track = tracks[part.id];
    if (!track) continue;
    onStep(`Writing ${part.id}`);
    await clearTrack(session, track);
    if (!wanted[part.id]) continue;
    await writePart(session, track, part, arr[part.id], startTick, arr.totalBeats);
    // The program change is in the clip; send it now too so it sounds right before the first pass.
    if (part.program !== null) await sendMidi.sendProgramChange(session.uid, track.id, part.program);
  }
  onStep('Writing chords');
  await session.musical.setChords(
    arr.events.map((e) => ({ tick: ticks(startTick, e.start), name: e.name })),
    { replaceRange: [startTick, endTick], undoName: 'Comp Machine chords' },
  );
  onStep('Setting the loop');
  await session.transport.seek(startTick);
  await session.transport.setLoop(startTick, endTick);
  if (session.transport.looping.value !== true) await session.transport.looping.set(true);
  return { startTick, endTick, tracks };
}

/** Which bar of the form (0-based) a session tick is in, or -1 outside it. */
function formBar(tick, startTick, barsInForm, choruses) {
  if (tick === undefined || tick < startTick) return -1;
  const bar = Math.floor((tick - startTick) / (4 * Luna.TICKS_PER_BEAT));
  if (bar >= barsInForm * choruses) return -1;
  return bar % barsInForm;
}

/** Bar of the whole arrangement (0-based, counting every chorus) a tick is in, or -1. */
function arrangementBar(tick, startTick, totalBars) {
  if (tick === undefined || tick < startTick) return -1;
  const bar = Math.floor((tick - startTick) / (4 * Luna.TICKS_PER_BEAT));
  return bar < totalBars ? bar : -1;
}

const AddOnLogic = {
  FAMILIES, STYLES, PARTS, FLAT_NAMES,
  parseChord, familyOf, parseKey, keyName, chart, barSegments, parseCustom, feelOf, timeline, rng,
  layoutBars, layOut, arrangementBar,
  candidates, voiceLead, pianoPart, bassPart, drumPart, arrangement,
  gmInstrument, findParts, ensureParts, clearTrack, writePart, load, formBar,
  BASS_LO, BASS_HI,
};

globalThis.AddOnLogic = AddOnLogic;
