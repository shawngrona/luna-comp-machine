// Live check against a running LUNA: `node tests/live/check-live.mjs [tune-id] [style]`.
// Loads a tune as the page does, then checks from a second connection that every part's clip
// holds the notes generated, the bass carries its program change, the chords are on the ruler,
// and the tempo and loop are set. Run it in a session you do not mind changing.
import { Luna } from '@uaudio/luna-builder-sdk';
globalThis.Luna = Luna;
await import('../../tunes.js');
await import('../../logic.js');
const L = globalThis.AddOnLogic;
const tune = globalThis.TUNES.find((t) => t.id === (process.argv[2] ?? 'blues-f'));
const style = process.argv[3] ?? tune.style;

const a = await Luna.connect();
const b = await Luna.connect();
const sa = await a.session(); await sa.ready();
const sb = await b.session(); await sb.ready();
console.log(`session "${sa.name.value}": loading ${tune.title} (${style})`);

const arr = L.arrangement(tune, { choruses: 2, style, seed: 5 });
const t0 = Date.now();
const res = await L.load(a, sa, arr, { tempo: tune.tempo, onStep: (m) => console.log('  ', m) });
console.log(`ok  loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const wait = (pred, what) => Luna.settle(pred, what, { timeoutMs: 8000 });
const parts = L.findParts(sb);
for (const p of L.PARTS) {
  const track = parts[p.id];
  if (!track) throw new Error(`client B has no ${p.track} track`);
  const lane = sb.playlistFor(track);
  await lane.clips.load();
  await wait(() => lane.clips.items.length === 1, `${p.track} holds one clip`);
  const clip = lane.clips.items[0];
  await clip.midi.ready();
  await wait(() => clip.midi.notes.items.length === arr[p.id].length, `${p.track}: ${arr[p.id].length} notes`);
  const notes = clip.midi.notes.items;
  const channels = [...new Set(notes.map((n) => n.channel))];
  const pcs = clip.midi.events.items.filter((e) => (e.status & 0xf0) === 0xc0).map((e) => e.data1);
  console.log(`ok  ${p.track}: ${notes.length} notes, channel ${channels.join('/')}${pcs.length ? `, program ${pcs.join('/')}` : ''}, clip ${clip.start.value === res.startTick ? 'starts on bar 1' : 'OFFSET ' + clip.start.value}`);
  if (channels.length !== 1 || channels[0] !== p.channel) throw new Error(`${p.track} notes on channel ${channels} not ${p.channel}`);
  if (p.program !== null && !pcs.includes(p.program)) throw new Error(`${p.track} has no program change ${p.program}`);
  const ins = track.effects.items.find((e) => e.id === 'instrument') ?? (await track.effects.load(), track.effects.items.find((e) => e.id === 'instrument'));
  if (!ins?.pluginId.value?.includes('dls')) throw new Error(`${p.track} instrument is ${ins?.pluginId.value}`);
}

const chords = sb.musical.chords;
await chords.load?.();
await wait(() => chords.items.filter((c) => c.location.value >= res.startTick && c.location.value < res.endTick).length === arr.events.length, `${arr.events.length} chords on the ruler`);
console.log(`ok  ${arr.events.length} chords on the ruler, first ${arr.events.slice(0, 4).map((e) => e.name).join(' ')}`);

const tempo = sb.musical.tempoAt(res.startTick);
console.log(`ok  tempo ${tempo} BPM; loop ${sb.transport.looping.value ? 'on' : 'OFF'}`);
if (Math.round(tempo) !== tune.tempo) throw new Error(`tempo ${tempo}, wanted ${tune.tempo}`);
process.exit(0);
