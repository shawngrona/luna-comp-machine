// Comp Machine: reading chart files. Open formats only:
//  - Our text format (CHART-FORMAT.md): bars between |, header lines, several charts per file.
//  - MusicXML (.musicxml, .xml, and compressed .mxl): what MuseScore, Dorico, Sibelius, Finale
//    and most chart apps export. Chord symbols (<harmony>) are read with the beat they fall on.
//  - ChordPro grids ({start_of_grid} ... {end_of_grid}), the bar-by-bar part of ChordPro.
// Only 4/4 (and 2/2, the same bar length) for now. Everything returns plain tunes for
// AddOnLogic.chart(); nothing here touches the DOM, so the tests run it in Node.

const F = (() => {
  const L = globalThis.AddOnLogic;

  // ---- XML: a small reader, enough for MusicXML ----------------------------------------------

  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e] ?? m);

  /** Parse XML into `{ name, attrs, children, text }` nodes. Throws on badly broken input. */
  function parseXml(src) {
    const root = { name: '#root', attrs: {}, children: [], text: '' };
    const stack = [root];
    const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(src))) {
      const top = stack[stack.length - 1];
      if (m[1] !== undefined) top.text += m[1];
      else if (m[2]) {
        if (top.name !== m[2]) throw new Error(`not valid XML (</${m[2]}> closes <${top.name}>)`);
        stack.pop();
      } else if (m[3]) {
        const attrs = {};
        for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3]);
        const node = { name: m[3], attrs, children: [], text: '' };
        top.children.push(node);
        if (!m[5]) stack.push(node);
      } else if (m[6]) top.text += decode(m[6]);
    }
    if (stack.length !== 1) throw new Error(`not valid XML (<${stack[stack.length - 1].name}> is never closed)`);
    return root;
  }
  const kid = (n, name) => n?.children.find((c) => c.name === name);
  const kids = (n, name) => n?.children.filter((c) => c.name === name) ?? [];
  const txt = (n, name) => kid(n, name)?.text.trim();
  const find = (n, name) => {
    if (!n) return undefined;
    for (const c of n.children) {
      if (c.name === name) return c;
      const d = find(c, name);
      if (d) return d;
    }
    return undefined;
  };

  // ---- ZIP: enough to open a compressed MusicXML (.mxl) -----------------------------------

  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
    return new Uint8Array(await out.arrayBuffer());
  }

  /** The files in a zip archive, as `{ name -> () => Promise<Uint8Array> }`. */
  function readZip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a readable .mxl (zip) file');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {};
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('not a readable .mxl (zip) file');
      const method = dv.getUint16(p + 10, true);
      const size = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + size);
      files[name] = () => (method === 0 ? Promise.resolve(data) : method === 8 ? inflateRaw(data) : Promise.reject(new Error('uses a zip compression this cannot open')));
      p += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }

  /** The MusicXML text inside a .mxl file. */
  async function mxlText(bytes) {
    const files = readZip(bytes);
    const dec = new TextDecoder();
    let path;
    if (files['META-INF/container.xml']) {
      const container = parseXml(dec.decode(await files['META-INF/container.xml']()));
      path = find(container, 'rootfile')?.attrs['full-path'];
    }
    path ??= Object.keys(files).find((f) => !f.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(f));
    if (!path || !files[path]) throw new Error('has no MusicXML score inside');
    return dec.decode(await files[path]());
  }

  // ---- repeats, shared by MusicXML and ChordPro ----------------------------------------------

  /**
   * Play repeats out: bars `{ ..., start, end, endings }` where `start`/`end` are repeat signs
   * and `endings` the volta numbers a bar belongs to (null: every time). Returns the bars in
   * playing order.
   */
  function playRepeats(bars) {
    const out = [];
    let from = 0;
    let pass = 1;
    const taken = new Set();
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      if (b.start && i !== from) {
        from = i;
        pass = 1;
      }
      if (b.endings && !b.endings.includes(pass)) continue;
      out.push(b);
      if (b.end && !taken.has(i)) {
        taken.add(i);
        pass++;
        i = from - 1;
      } else if (b.end) pass = 1;
    }
    return out;
  }

  /** Group bars `{ label, cells }` into tune sections; a label starts a new section. */
  function sectionsOf(bars) {
    const sections = [];
    for (const b of bars) {
      if (b.label || !sections.length) sections.push([b.label ?? '', []]);
      sections[sections.length - 1][1].push(b.cells);
    }
    return sections;
  }

  // ---- MusicXML ----------------------------------------------------------------------------

  // <kind> values to our chord spellings.
  const KINDS = {
    major: '', minor: 'm', augmented: 'aug', diminished: 'dim', dominant: '7', 'major-seventh': 'maj7',
    'minor-seventh': 'm7', 'diminished-seventh': 'dim7', 'augmented-seventh': '7#5', 'half-diminished': 'm7b5',
    'major-minor': 'mmaj7', 'major-sixth': '6', 'minor-sixth': 'm6', 'dominant-ninth': '9', 'major-ninth': 'maj9',
    'minor-ninth': 'm9', 'dominant-11th': '11', 'major-11th': 'maj7', 'minor-11th': 'm11', 'dominant-13th': '13',
    'major-13th': 'maj13', 'minor-13th': 'm13', 'suspended-second': 'sus2', 'suspended-fourth': 'sus4',
    power: '', pedal: '', other: '',
  };
  const STEP = (step, alter) => step + (Number(alter) > 0 ? '#' : Number(alter) < 0 ? 'b' : '');

  /** A <harmony> element as a chord name, or null for "no chord". */
  function harmonyName(h) {
    const root = kid(h, 'root');
    if (!root) return null;
    const kind = kid(h, 'kind');
    const kv = kind?.text.trim() ?? 'major';
    if (kv === 'none') return null;
    let q = KINDS[kv] ?? (kind?.attrs.text ?? '');
    for (const d of kids(h, 'degree')) {
      const v = txt(d, 'degree-value');
      const alter = Number(txt(d, 'degree-alter') ?? 0);
      const type = txt(d, 'degree-type');
      if (type === 'subtract' || !v) continue;
      q += (alter > 0 ? '#' : alter < 0 ? 'b' : type === 'add' ? 'add' : '') + v;
    }
    if (/^7/.test(q) && /b9|#9|b13|#5b9/.test(q)) q = '7alt';
    const bass = kid(h, 'bass');
    const slash = bass ? `/${STEP(txt(bass, 'bass-step'), txt(bass, 'bass-alter'))}` : '';
    return STEP(txt(root, 'root-step'), txt(root, 'root-alter')) + q + slash;
  }

  const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

  /** The tunes in a MusicXML score (one per file). */
  function parseMusicXML(xmlText, fileName) {
    const doc = parseXml(xmlText);
    const score = find(doc, 'score-partwise');
    if (!score) {
      if (find(doc, 'score-timewise')) throw new Error('is a timewise MusicXML score; export it as a regular (partwise) score');
      throw new Error('is not a MusicXML score');
    }
    const title = txt(find(score, 'work'), 'work-title') || txt(score, 'movement-title') || fileName.replace(/\.[^.]+$/, '');
    const composer = kids(find(score, 'identification'), 'creator').find((c) => c.attrs.type === 'composer')?.text.trim();
    // The first part that has chord symbols.
    const part = kids(score, 'part').find((p) => find(p, 'harmony'));
    if (!part) throw new Error('has no chord symbols; add them (in MuseScore: Add > Text > Chord Symbol) and export again');

    let divisions = 1;
    let key = null;
    let tempo = null;
    let ending = null;
    let lastName = null;
    const bars = [];
    kids(part, 'measure').forEach((measure, index) => {
      let pos = 0;
      let label = null;
      const hits = [];
      const bar = { start: false, end: false, endings: ending };
      for (const el of measure.children) {
        if (el.name === 'attributes') {
          divisions = Number(txt(el, 'divisions') ?? divisions) || divisions;
          const time = kid(el, 'time');
          if (time) {
            const beats = Number(txt(time, 'beats'));
            const type = Number(txt(time, 'beat-type'));
            if (beats * (4 / type) !== 4) throw new Error(`is in ${beats}/${type} time; only 4/4 is supported so far`);
          }
          const k = kid(el, 'key');
          if (k && key === null) {
            const fifths = Number(txt(k, 'fifths') ?? 0);
            const major = ((fifths * 7) % 12 + 12) % 12;
            key = txt(k, 'mode') === 'minor' ? `${KEY_NAMES[(major + 9) % 12]}m` : KEY_NAMES[major];
          }
        } else if (el.name === 'harmony') {
          const offset = Number(txt(el, 'offset') ?? 0);
          hits.push({ at: pos + offset, name: harmonyName(el) });
        } else if (el.name === 'note') {
          if (!kid(el, 'chord') && !kid(el, 'grace')) pos += Number(txt(el, 'duration') ?? 0);
        } else if (el.name === 'backup') pos -= Number(txt(el, 'duration') ?? 0);
        else if (el.name === 'forward') pos += Number(txt(el, 'duration') ?? 0);
        else if (el.name === 'direction') {
          const r = find(el, 'rehearsal');
          if (r) label = r.text.trim() || label;
          const s = kid(el, 'sound');
          if (s?.attrs.tempo && tempo === null) tempo = Math.round(Number(s.attrs.tempo));
          const pm = find(el, 'per-minute');
          if (pm && tempo === null && find(el, 'beat-unit')?.text.trim() === 'quarter') tempo = Math.round(Number(pm.text));
        } else if (el.name === 'sound' && el.attrs.tempo && tempo === null) tempo = Math.round(Number(el.attrs.tempo));
        else if (el.name === 'barline') {
          const rep = kid(el, 'repeat');
          if (rep?.attrs.direction === 'forward') bar.start = true;
          if (rep?.attrs.direction === 'backward') bar.end = true;
          const e = kid(el, 'ending');
          if (e) {
            const nums = String(e.attrs.number ?? '').split(/[,\s]+/).map(Number).filter(Boolean);
            if (e.attrs.type === 'start') {
              ending = nums;
              bar.endings = nums;
            } else ending = null; // stop or discontinue
          }
        }
      }
      // A pickup bar before the first chord adds nothing to a backing track.
      if (index === 0 && measure.attrs.implicit === 'yes' && !hits.length) return;
      const cells = ['.', '.', '.', '.'];
      for (const h of hits) {
        const beat = Math.min(3, Math.max(0, Math.floor(h.at / divisions + 1e-6)));
        if (h.name) cells[beat] = h.name;
      }
      if (cells[0] === '.' && !lastName) {
        const first = cells.findIndex((c) => c !== '.');
        if (first < 0) return; // no chord yet: skip leading empty bars
        cells[0] = cells[first];
        cells[first] = first ? '.' : cells[first];
      }
      for (const c of cells) if (c !== '.') lastName = c;
      bars.push({ ...bar, label, cells: simplify(cells) });
    });
    if (!bars.length) throw new Error('has no chord symbols');
    return {
      id: '', title, composer, key: key ?? 'C', tempo: tempo && tempo >= 40 && tempo <= 320 ? tempo : 140, style: 'swing',
      sections: sectionsOf(playRepeats(bars)), source: fileName,
    };
  }

  /** `['C', '.', 'G7', '.']` -> `C G7`; keeps the dots only where the split is uneven. */
  function simplify(cells) {
    if (cells.every((c, i) => i === 0 || c === '.')) return cells[0];
    if (cells[1] === '.' && cells[3] === '.') return `${cells[0]} ${cells[2]}`;
    return cells.join(' ');
  }

  // ---- ChordPro ----------------------------------------------------------------------------

  const DIRECTIVE = /^\{\s*([\w-]+)\s*(?:[:\s]\s*(.*?))?\s*\}\s*$/;
  // Bar lines: | || |. |: :| :|: and a volta number on | or :| (|2, :|2 = second ending).
  const BARLINE = /^(\|\||\|\.|\|:|:\|:|:\|[1-9]?|\|[1-9]?)$/;
  const BARLINES = /(\|\||\|\.|\|:|:\|:|:\|[1-9]?|\|[1-9]?)/g;

  /** The tune in a ChordPro file's grid sections. */
  function parseChordPro(text, fileName) {
    const meta = { title: fileName.replace(/\.[^.]+$/, ''), key: 'C', tempo: 140, style: 'swing' };
    const bars = [];
    let inGrid = false;
    let label = null;
    let inline = false;
    let ending = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const d = DIRECTIVE.exec(line);
      if (d) {
        const name = d[1].toLowerCase();
        const value = (d[2] ?? '').trim();
        if (name === 'title' || name === 't') meta.title = value || meta.title;
        else if (name === 'key') meta.key = value.replace(/-$/, 'm') || meta.key;
        else if (name === 'tempo') meta.tempo = Math.max(40, Math.min(320, parseInt(value, 10) || meta.tempo));
        else if (name === 'time' && value && !/^(4\/4|2\/2|c)$/i.test(value)) throw new Error(`is in ${value} time; only 4/4 is supported so far`);
        else if (name === 'start_of_grid' || name === 'sog') {
          inGrid = true;
          label = (/label\s*=\s*"([^"]*)"/.exec(value)?.[1] ?? value.replace(/^[\d+x]+\s*/, '')).trim() || null;
        } else if (name === 'end_of_grid' || name === 'eog') inGrid = false;
        else if (name === 'meta' && /^(feel|style)\s/i.test(value)) meta.style = L.feelOf(value.replace(/^\S+\s+/, ''));
        continue;
      }
      if (!inGrid) {
        if (/\[[A-G][^\]]*\]/.test(line)) inline = true;
        continue;
      }
      if (!line.includes('|')) continue;
      // Margin text before the first and after the last bar line is a label or a comment.
      const first = line.indexOf('|');
      const lastBar = Math.max(line.lastIndexOf('|'), line.lastIndexOf(':|'));
      const lead = line.slice(0, first).replace(/:$/, '').trim();
      const tokens = line.slice(first, lastBar + 1).replace(BARLINES, ' $1 ').split(/\s+/).filter(Boolean);
      let cells = [];
      let startNext = false;
      if (lead) label = lead;
      const close = () => {
        if (!cells.length) return;
        if (cells.length === 1 && (cells[0] === '%' || cells[0] === '%%')) {
          const copy = cells[0] === '%' ? bars.slice(-1) : bars.slice(-2);
          for (const b of copy) bars.push({ ...b, label: null, start: false, end: false, endings: ending });
        } else bars.push({ cells: cells.join(' '), label, start: startNext, end: false, endings: ending });
        label = null;
        startNext = false;
        cells = [];
      };
      for (const tok of tokens) {
        if (BARLINE.test(tok)) {
          close();
          if (tok.startsWith(':|')) {
            if (bars.length) bars[bars.length - 1].end = true;
            ending = null;
          }
          if (tok === '|:' || tok === ':|:') startNext = true;
          const volta = /^:?\|([1-9])$/.exec(tok);
          if (volta) ending = [Number(volta[1])];
          if (tok === '||' || tok === '|.') ending = null;
        } else cells.push(tok);
      }
      close();
    }
    if (!bars.length) {
      throw new Error(inline
        ? 'has chords over lyrics but no {start_of_grid} section, so the bar lengths are unknown'
        : 'has no {start_of_grid} section with bars');
    }
    return { id: '', ...meta, sections: sectionsOf(playRepeats(bars)), source: fileName };
  }

  // ---- any file ------------------------------------------------------------------------------

  const isZip = (b) => b instanceof Uint8Array && b[0] === 0x50 && b[1] === 0x4b;

  /**
   * The charts in an uploaded file (text or bytes): `{ tunes, skipped: [{ title, reason }] }`.
   * Picks the format from the name and the contents.
   */
  async function parseChartFile(input, fileName = 'chart') {
    const name = fileName.toLowerCase();
    const one = (fn) => {
      try {
        const t = fn();
        L.chart(t); // throws on a chord it cannot read
        return { tunes: [t], skipped: [] };
      } catch (e) {
        return { tunes: [], skipped: [{ title: fileName, reason: e.message }] };
      }
    };
    if (name.endsWith('.mxl') || isZip(input)) {
      let xml;
      try {
        xml = await mxlText(input instanceof Uint8Array ? input : new TextEncoder().encode(input));
      } catch (e) {
        return { tunes: [], skipped: [{ title: fileName, reason: e.message }] };
      }
      return one(() => parseMusicXML(xml, fileName));
    }
    const text = typeof input === 'string' ? input : new TextDecoder().decode(input);
    if (/\.(musicxml|xml)$/.test(name) || /<score-(partwise|timewise)[\s>]/.test(text)) return one(() => parseMusicXML(text, fileName));
    if (/\.(cho|chopro|chordpro|crd|pro)$/.test(name) || /^\s*\{\s*(title|t|start_of_grid|sog)\b/m.test(text)) return one(() => parseChordPro(text, fileName));
    // Our text format: several charts per file, separated by a line of ---.
    const tunes = [];
    const skipped = [];
    const blocks = text.split(/^\s*-{3,}\s*$/m).filter((b) => b.trim());
    blocks.forEach((block, n) => {
      const fallback = fileName.replace(/\.[^.]+$/, '') + (blocks.length > 1 ? ` ${n + 1}` : '');
      try {
        tunes.push({ ...L.parseCustom(block, { title: fallback, key: 'C', tempo: 140, style: 'swing' }), id: '', source: fileName });
      } catch (e) {
        skipped.push({ title: fallback, reason: e.message });
      }
    });
    return { tunes, skipped };
  }

  return { parseXml, readZip, mxlText, playRepeats, parseMusicXML, parseChordPro, parseChartFile, harmonyName, simplify };
})();

globalThis.ChartFormats = F;
