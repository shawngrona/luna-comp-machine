// Comp Machine: DOM wiring. Pick a tune, set key, tempo and feel, and Load writes the
// band into the focused session (see logic.js). The chart follows LUNA's playhead.

const $ = (id) => document.getElementById(id);
const L = AddOnLogic;
const STORE = 'io.github.shawngrona.comp_machine.settings';
let luna;
let session;
const sessionBindings = new Luna.Bindings();

// What the controls say, and what is in LUNA right now.
const state = {
  tuneId: TUNES[0].id,
  keyPc: null,        // null: the tune's own key
  tempo: null,        // null: the tune's own tempo
  style: null,        // null: the tune's own feel
  voicing: 'rootless',
  choruses: 4,
  parts: { piano: true, bass: true, drums: true },
  seed: 1,
  custom: '| Dm7 G7 | Cmaj7 | % |\n| Em7b5 | A7alt | Dm7 | G7 |',
  customKey: 'C',
  layout: false,
};
// Charts the user uploaded, kept in this browser view's storage (per computer, not per session).
const UPLOADS = 'io.github.shawngrona.comp_machine.uploads';
let uploaded = [];
try {
  uploaded = JSON.parse(localStorage.getItem(UPLOADS) ?? '[]');
} catch {}
const saveUploads = () => {
  try {
    localStorage.setItem(UPLOADS, JSON.stringify(uploaded));
    return true;
  } catch {
    return false;
  }
};
const allTunes = () => [...TUNES, ...uploaded];
let loaded = null;    // { signature, startTick, bars, choruses }
let busy = false;

try {
  Object.assign(state, JSON.parse(localStorage.getItem(STORE) ?? '{}'));
} catch {}
const save = () => {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch {}
};
const status = (text, warn = false) => {
  $('status').textContent = text;
  $('status').classList.toggle('warn', warn);
};

// ---- the current tune and arrangement -------------------------------------------------------

function currentTune() {
  if (state.tuneId === 'custom') {
    try {
      return L.parseCustom(state.custom, { title: 'My chart', key: state.customKey, tempo: 140, style: 'swing' });
    } catch (e) {
      return { error: e.message };
    }
  }
  return allTunes().find((t) => t.id === state.tuneId) ?? TUNES[0];
}

function semitones(tune) {
  if (state.keyPc === null) return 0;
  const d = ((state.keyPc - L.parseKey(tune.key).pc) % 12 + 12) % 12;
  return d > 6 ? d - 12 : d; // the nearer way, so the band stays in its register
}

const settings = (tune) => ({
  semitones: semitones(tune),
  choruses: state.choruses,
  style: state.style ?? tune.style,
  voicing: state.voicing,
  seed: state.seed,
  parts: state.parts,
  layout: state.layout,
  tempo: state.tempo ?? tune.tempo,
});
const signature = (tune) => JSON.stringify({ t: tune.id === 'custom' ? state.custom + state.customKey : tune.id, ...settings(tune) });

// ---- rendering ---------------------------------------------------------------------------

function tuneButton(t, removable) {
  const b = document.createElement('button');
  b.className = 'tune' + (t.id === state.tuneId ? ' on' : '');
  b.innerHTML = '<span class="t"></span><span class="k"></span>';
  b.querySelector('.t').textContent = t.title;
  b.querySelector('.k').textContent = t.key;
  b.onclick = () => {
    state.tuneId = t.id;
    state.keyPc = null;
    state.tempo = null;
    state.style = null;
    save();
    render();
  };
  if (removable) {
    const x = document.createElement('span');
    x.className = 'rm';
    x.title = 'Remove this chart';
    x.textContent = '×';
    x.onclick = (e) => {
      e.stopPropagation();
      uploaded = uploaded.filter((u) => u.id !== t.id);
      saveUploads();
      if (state.tuneId === t.id) state.tuneId = TUNES[0].id;
      save();
      render();
    };
    b.appendChild(x);
  }
  return b;
}

function renderList() {
  const q = $('search').value.trim().toLowerCase();
  const root = $('tunes');
  root.innerHTML = '';
  const match = (t) => !q || t.title.toLowerCase().includes(q);
  const heading = (text) => root.appendChild(Object.assign(document.createElement('div'), { className: 'group', textContent: text }));
  const built = TUNES.filter(match);
  if (built.length) heading('Standards');
  for (const t of built) root.appendChild(tuneButton(t, false));
  const ups = uploaded.filter(match);
  if (ups.length) heading(`Uploaded (${uploaded.length})`);
  for (const t of ups) root.appendChild(tuneButton(t, true));
  heading('Write');
  root.appendChild(tuneButton({ id: 'custom', title: 'Your own chart...', key: '' }, false));
}

function renderControls(tune) {
  const s = settings(tune);
  const own = L.parseKey(tune.key);
  const sel = $('key');
  sel.innerHTML = '';
  for (let pc = 0; pc < 12; pc++) {
    const o = document.createElement('option');
    o.value = pc;
    o.textContent = L.keyName(pc, own.minor) + (pc === own.pc ? ' (original)' : '');
    sel.appendChild(o);
  }
  sel.value = state.keyPc ?? own.pc;
  $('tempo').value = s.tempo;
  $('tempo-range').value = s.tempo;
  $('style').value = s.style;
  $('voicing').value = state.voicing;
  $('choruses').value = state.choruses;
  for (const p of ['piano', 'bass', 'drums']) $(`part-${p}`).checked = state.parts[p];
  $('layout').checked = state.layout;
  $('custom-box').hidden = state.tuneId !== 'custom';
  $('custom').value = state.custom;
  $('custom-key').value = state.customKey;
}

function renderChart(tune) {
  const root = $('chart');
  root.innerHTML = '';
  if (tune.error) {
    root.innerHTML = '<div class="err"></div>';
    root.firstChild.textContent = tune.error;
    $('title').textContent = 'Your own chart';
    return;
  }
  const ch = L.chart(tune, semitones(tune));
  $('title').textContent = tune.title;
  const credit = [tune.composer, tune.rights ?? (tune.source ? `from ${tune.source}` : null)].filter(Boolean).join(' · ');
  $('subtitle').textContent = `${ch.key} · ${ch.bars.length} bars · ${L.STYLES[settings(tune).style].label}${credit ? ` · ${credit}` : ''}`;
  ch.bars.forEach((bar, i) => {
    if (bar.section !== null && bar.section !== '') {
      const label = document.createElement('div');
      label.className = 'sec';
      label.textContent = bar.section;
      root.appendChild(label);
      // Start each section on a new row of four.
      const pad = (4 - (root.querySelectorAll('.bar').length % 4)) % 4;
      for (let k = 0; k < pad; k++) root.insertBefore(Object.assign(document.createElement('div'), { className: 'bar ghost' }), label);
    }
    const el = document.createElement('div');
    el.className = 'bar';
    el.dataset.i = i;
    for (const c of bar.chords) {
      const span = document.createElement('span');
      span.textContent = c.name;
      el.appendChild(span);
    }
    root.appendChild(el);
  });
}

function renderLoadState(tune) {
  const fresh = loaded && !tune.error && loaded.signature === signature(tune);
  $('load').textContent = fresh ? 'Reload into LUNA' : 'Load into LUNA';
  $('load').classList.toggle('primary', !fresh);
  $('dirty').hidden = !loaded || fresh;
}

function render() {
  const tune = currentTune();
  renderList();
  if (!tune.error) renderControls(tune);
  else $('custom-box').hidden = false;
  renderChart(tune);
  renderLoadState(tune);
  paintPlayhead();
}

function paintPlayhead() {
  const t = session?.transport;
  const playing = t?.playing.value === true;
  $('play').textContent = playing ? 'Stop' : 'Play';
  $('play').classList.toggle('on', playing);
  document.querySelectorAll('.bar.now').forEach((b) => b.classList.remove('now'));
  if (!loaded || !t || loaded.signature !== signature(currentTune())) return;
  const bar = L.formBar(t.location.value?.tick, loaded.startTick, loaded.bars, loaded.choruses);
  const global = L.arrangementBar(t.location.value?.tick, loaded.startTick, loaded.bars * loaded.choruses);
  const laying = global >= 0 && loaded.layout.has(global);
  // Laying out: no highlight, so the chart cannot keep the form for you.
  if (bar >= 0 && !laying) document.querySelector(`.bar[data-i="${bar}"]`)?.classList.add('now');
  document.body.classList.toggle('laying-out', laying);
  const chorus = Math.floor(global / loaded.bars) + 1;
  $('chorus').textContent = global < 0 ? '' : laying ? `Chorus ${chorus}: band's out, keep the form!` : `Chorus ${chorus} of ${loaded.choruses}`;
}

// ---- actions -----------------------------------------------------------------------------

async function loadIntoLuna() {
  const tune = currentTune();
  if (tune.error || busy || !session) return false;
  busy = true;
  document.body.classList.add('busy');
  try {
    const s = settings(tune);
    const arr = L.arrangement(tune, s);
    if (session.transport.playing.value) await session.transport.stop();
    const res = await L.load(luna, session, arr, { tempo: s.tempo, onStep: (m) => status(`${m}...`) });
    loaded = { signature: signature(tune), startTick: res.startTick, bars: arr.chart.bars.length, choruses: s.choruses, layout: new Set(arr.layout) };
    status(`Loaded ${tune.title} in ${arr.chart.key}, ${s.tempo} BPM, ${s.choruses} choruses, looping. Press Play or Space.`);
    return true;
  } catch (e) {
    status(`Could not load: ${e.message}`, true);
    return false;
  } finally {
    busy = false;
    document.body.classList.remove('busy');
    render();
  }
}

async function togglePlay() {
  if (!session || busy) return;
  const t = session.transport;
  if (t.playing.value) return t.stop();
  const tune = currentTune();
  if (!loaded || loaded.signature !== signature(tune)) {
    if (!(await loadIntoLuna())) return;
  }
  await t.play();
}

function wire() {
  $('search').oninput = renderList;
  $('key').onchange = () => {
    state.keyPc = Number($('key').value);
    save();
    render();
  };
  const setTempo = (v) => {
    const n = Math.max(40, Math.min(320, Math.round(Number(v) || 120)));
    state.tempo = n;
    save();
    render();
  };
  $('tempo').onchange = () => setTempo($('tempo').value);
  $('tempo-range').oninput = () => ($('tempo').value = $('tempo-range').value);
  $('tempo-range').onchange = () => setTempo($('tempo-range').value);
  $('tempo-down').onclick = () => setTempo((state.tempo ?? currentTune().tempo) - 5);
  $('tempo-up').onclick = () => setTempo((state.tempo ?? currentTune().tempo) + 5);
  $('style').onchange = () => {
    state.style = $('style').value;
    save();
    render();
  };
  $('voicing').onchange = () => {
    state.voicing = $('voicing').value;
    save();
    render();
  };
  $('choruses').onchange = () => {
    state.choruses = Math.max(1, Math.min(12, Number($('choruses').value) || 4));
    save();
    render();
  };
  for (const p of ['piano', 'bass', 'drums']) {
    $(`part-${p}`).onchange = () => {
      state.parts[p] = $(`part-${p}`).checked;
      save();
      render();
    };
  }
  $('custom').oninput = () => {
    state.custom = $('custom').value;
    save();
    const tune = currentTune();
    renderChart(tune);
    renderLoadState(tune);
  };
  $('custom-key').onchange = () => {
    state.customKey = $('custom-key').value;
    state.keyPc = null;
    save();
    render();
  };
  $('layout').onchange = () => {
    state.layout = $('layout').checked;
    save();
    render();
  };
  $('upload').onclick = () => $('file').click();
  $('file').onchange = async () => {
    for (const f of $('file').files) await addChartFile(f);
    $('file').value = '';
  };
  // Drop a chart file anywhere on the window. Inside LUNA this is the dependable route: in some
  // LUNA builds a file picker opens nothing (docs/FILES.md).
  let depth = 0;
  document.addEventListener('dragenter', (e) => {
    if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
    e.preventDefault();
    depth++;
    document.body.classList.add('dropping');
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('dragleave', () => {
    if (--depth <= 0) {
      depth = 0;
      document.body.classList.remove('dropping');
    }
  });
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('dropping');
    for (const f of e.dataTransfer?.files ?? []) await addChartFile(f);
  });
  $('load').onclick = loadIntoLuna;
  $('play').onclick = togglePlay;
  $('variation').onclick = async () => {
    state.seed = (state.seed % 9999) + 1;
    save();
    render();
    await loadIntoLuna();
  };
}

/** Read an uploaded file's charts into the Uploaded list, replacing ones with the same title. */
async function addChartFile(file) {
  if (file.size > 5_000_000) return status(`${file.name} is too big for a chart file.`, true);
  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer()); // bytes: a .mxl file is a zip
  } catch (e) {
    return status(`Could not read ${file.name}: ${e.message}`, true);
  }
  const { tunes, skipped } = await ChartFormats.parseChartFile(bytes, file.name);
  if (!tunes.length) {
    const why = skipped.length ? skipped.slice(0, 3).map((x) => `${x.title}: ${x.reason}`).join('; ') : 'no charts found. Use a text chart (| Dm7 G7 | Cmaj7 |), MusicXML or a ChordPro grid.';
    return status(`Nothing added from ${file.name}: ${why}`, true);
  }
  const stamp = Date.now().toString(36);
  const fresh = tunes.map((t, i) => ({ ...t, id: `up-${stamp}-${i}` }));
  const titles = new Set(fresh.map((t) => t.title));
  uploaded = [...uploaded.filter((u) => !titles.has(u.title)), ...fresh].sort((a, b) => a.title.localeCompare(b.title));
  const kept = saveUploads();
  state.tuneId = fresh[0].id;
  state.keyPc = null;
  state.tempo = null;
  state.style = null;
  save();
  render();
  const skippedText = skipped.length ? ` Skipped ${skipped.length}: ${[...new Set(skipped.map((x) => x.reason))].slice(0, 2).join('; ')}.` : '';
  status(`Added ${fresh.length} chart${fresh.length > 1 ? 's' : ''} from ${file.name}.${skippedText}${kept ? '' : ' (Too many to remember after closing; they last until then.)'}`, !!skipped.length);
}

// ---- LUNA --------------------------------------------------------------------------------

async function bindSession() {
  sessionBindings.clear();
  session = luna.sessions.current();
  loaded = null;
  if (!session) {
    status('Open or create a session in LUNA to start.', true);
    render();
    return;
  }
  await session.ready();
  const t = session.transport;
  sessionBindings.on(t.location, paintPlayhead);
  sessionBindings.on(t.playing, paintPlayhead);
  // A session already loaded by this page (Comp tracks present) still follows the playhead
  // once the user reloads; until then say what Load will do.
  const others = session.visibleTracks.filter((tr) => !L.PARTS.some((p) => p.track === tr.name.value));
  status(others.length
    ? `Session "${session.name.value ?? ''}": Load adds Comp Piano, Bass and Drums tracks and sets the tempo. Mute the other ${others.length} track(s) if they get in the way.`
    : `Session "${session.name.value ?? ''}": pick a tune and press Load.`);
  render();
}

async function connect() {
  for (;;) {
    try {
      luna = await Luna.connect();
      break;
    } catch (e) {
      status(e instanceof Luna.NotRunning ? 'Waiting for LUNA...' : e.message, true);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  Luna.bindShortcuts(luna);
  await luna.sessions.ready();
  luna.sessions.focused.onChange(bindSession);
  luna.sessions.items.onChange(bindSession);
  luna.status.onChange(() => {
    if (luna.status.value === 'disconnected') status('Reconnecting...', true);
  });
  await bindSession();
}

wire();
render();
connect();
