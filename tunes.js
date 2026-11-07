// Comp Machine: the built-in charts. Chord changes only, no melodies or lyrics.
//
// What is in here, and why it is safe to ship:
//  - Songs in the US public domain (published 1930 or earlier), named and credited.
//  - Traditional tunes with no author.
//  - Generic forms (blues, modal and ii-V forms): common progressions named for what they
//    are, not after any copyrighted song.
//  - Drills written for this Add On.
// `rights` says which, and the page shows it. Check the dates again before adding a song:
// US public domain moves forward each 1 January, and other countries have different rules.
//
// Each tune is sections of bars in the chart format (see CHART-FORMAT.md): chords in a bar
// split it evenly (`Dm7 G7`), `.` holds a chord for a beat (`Dm7 . . G7`), `%` repeats the bar.
// `key` is the key the changes are written in, so the page can transpose to any other.

const TUNES = [
  // ---- public domain (US) ---------------------------------------------------------------
  {
    id: 'honeysuckle-rose', title: 'Honeysuckle Rose', composer: 'Fats Waller, Andy Razaf', key: 'F', tempo: 150, style: 'swing',
    rights: 'Public domain in the US (published 1929)',
    sections: [
      ['A', ['Gm7 C7', 'Gm7 C7', 'Gm7 C7', 'Gm7 C7', 'F6', 'F6', 'F6', 'Gm7 C7']],
      ['A', ['Gm7 C7', 'Gm7 C7', 'Gm7 C7', 'Gm7 C7', 'F6', 'F6', 'F6', 'F6']],
      ['B', ['F7', '%', 'Bb6', '%', 'G7', '%', 'Gm7', 'C7']],
      ['A', ['Gm7 C7', 'Gm7 C7', 'Gm7 C7', 'Gm7 C7', 'F6', 'F6', 'F6', 'F6']],
    ],
  },
  {
    id: 'rhythm-changes', title: 'Rhythm Changes in Bb (I Got Rhythm)', composer: 'George Gershwin', key: 'Bb', tempo: 180, style: 'swing',
    rights: 'Public domain in the US (I Got Rhythm, published 1930); the jazz "rhythm changes" form',
    sections: [
      ['A', ['Bb6 G7', 'Cm7 F7', 'Bb6 G7', 'Cm7 F7', 'Fm7 Bb7', 'Ebmaj7 Ab7', 'Dm7 G7', 'Cm7 F7']],
      ['A', ['Bb6 G7', 'Cm7 F7', 'Bb6 G7', 'Cm7 F7', 'Fm7 Bb7', 'Ebmaj7 Ab7', 'Cm7 F7', 'Bb6']],
      ['B', ['D7', '%', 'G7', '%', 'C7', '%', 'F7', '%']],
      ['A', ['Bb6 G7', 'Cm7 F7', 'Bb6 G7', 'Cm7 F7', 'Fm7 Bb7', 'Ebmaj7 Ab7', 'Cm7 F7', 'Bb6']],
    ],
  },
  {
    id: 'saints', title: 'When the Saints Go Marching In', composer: 'Traditional', key: 'F', tempo: 170, style: 'two',
    rights: 'Traditional',
    sections: [
      ['A', ['F6', '%', '%', '%', 'F6', '%', 'C7', '%', 'F6', 'F7', 'Bb6', 'Bbm6', 'F6', 'C7', 'F6', '%']],
    ],
  },

  // ---- generic forms -----------------------------------------------------------------------
  {
    id: 'blues-f', title: 'Jazz Blues in F', key: 'F', tempo: 140, style: 'swing',
    rights: 'Generic form',
    sections: [
      ['12-bar', ['F7', 'Bb7', 'F7', 'Cm7 F7', 'Bb7', 'Bdim7', 'F7', 'Am7 D7', 'Gm7', 'C7', 'F7 D7', 'Gm7 C7']],
    ],
  },
  {
    id: 'minor-blues-c', title: 'Minor Blues in C', key: 'Cm', tempo: 150, style: 'swing',
    rights: 'Generic form',
    sections: [
      ['12-bar', ['Cm7', 'Fm7', 'Cm7', 'Cm7', 'Fm7', 'Fm7', 'Cm7', 'Cm7', 'Ab7', 'G7alt', 'Cm7', 'Dm7b5 G7alt']],
    ],
  },
  {
    id: 'bird-blues-f', title: 'Bird Blues in F (descending ii-Vs)', key: 'F', tempo: 160, style: 'swing',
    rights: 'Generic form',
    sections: [
      ['12-bar', ['Fmaj7', 'Em7b5 A7alt', 'Dm7 G7', 'Cm7 F7', 'Bb7', 'Bbm7 Eb7', 'Am7 D7', 'Abm7 Db7', 'Gm7', 'C7', 'F6 D7alt', 'Gm7 C7']],
    ],
  },
  {
    id: 'minor-cycle-g', title: 'Minor Cycle in G (ii-V-i form)', key: 'Gm', tempo: 132, style: 'swing',
    rights: 'Generic form',
    sections: [
      ['A', ['Cm7', 'F7', 'Bbmaj7', 'Ebmaj7', 'Am7b5', 'D7alt', 'Gm6', 'Gm6']],
      ['B', ['Am7b5', 'D7alt', 'Gm6', 'Gm6', 'Cm7 F7', 'Bbmaj7 Ebmaj7', 'Am7b5 D7alt', 'Gm6']],
    ],
  },
  {
    id: 'minor-bossa-c', title: 'Minor Bossa in C', key: 'Cm', tempo: 150, style: 'bossa',
    rights: 'Generic form',
    sections: [
      ['A', ['Cm7', '%', 'Fm7', '%', 'Dm7b5', 'G7alt', 'Cm7', '%']],
      ['B', ['Abmaj7', 'Db7#11', 'Cm7', '%', 'Dm7b5', 'G7alt', 'Cm7', 'Dm7b5 G7alt']],
    ],
  },
  {
    id: 'modal-aaba', title: 'Modal AABA: D Dorian / Eb Dorian', key: 'Dm', tempo: 136, style: 'swing',
    rights: 'Generic form',
    sections: [
      ['A', ['Dm7', '%', '%', '%', '%', '%', '%', '%']],
      ['A', ['Dm7', '%', '%', '%', '%', '%', '%', '%']],
      ['B', ['Ebm7', '%', '%', '%', '%', '%', '%', '%']],
      ['A', ['Dm7', '%', '%', '%', '%', '%', '%', '%']],
    ],
  },

  // ---- drills --------------------------------------------------------------------------------
  {
    id: 'ii-v-i-major', title: 'Drill: Major ii-V-I Down in Whole Steps', key: 'C', tempo: 120, style: 'swing',
    rights: 'Original drill',
    sections: [
      ['C / Bb / Ab', ['Dm7', 'G7', 'Cmaj7', '%', 'Cm7', 'F7', 'Bbmaj7', '%', 'Bbm7', 'Eb7', 'Abmaj7', '%']],
      ['Gb / E / D', ['Abm7', 'Db7', 'Gbmaj7', '%', 'F#m7', 'B7', 'Emaj7', '%', 'Em7', 'A7', 'Dmaj7', '%']],
    ],
  },
  {
    id: 'ii-v-i-minor', title: 'Drill: Minor ii-V-i Around the Cycle', key: 'Cm', tempo: 120, style: 'swing',
    rights: 'Original drill',
    sections: [
      ['Cm / Fm / Bbm', ['Dm7b5', 'G7alt', 'Cm6', '%', 'Gm7b5', 'C7alt', 'Fm6', '%', 'Cm7b5', 'F7alt', 'Bbm6', '%']],
      ['Ebm / Abm / Dbm', ['Fm7b5', 'Bb7alt', 'Ebm6', '%', 'Bbm7b5', 'Eb7alt', 'Abm6', '%', 'Ebm7b5', 'Ab7alt', 'Dbm6', '%']],
    ],
  },
  {
    id: 'turnarounds', title: 'Drill: I-VI-ii-V Turnarounds in All 12 Keys', key: 'C', tempo: 130, style: 'swing',
    rights: 'Original drill',
    sections: [
      ['C to Eb', ['Cmaj7 A7', 'Dm7 G7', 'Fmaj7 D7', 'Gm7 C7', 'Bbmaj7 G7', 'Cm7 F7', 'Ebmaj7 C7', 'Fm7 Bb7']],
      ['Ab to B', ['Abmaj7 F7', 'Bbm7 Eb7', 'Dbmaj7 Bb7', 'Ebm7 Ab7', 'Gbmaj7 Eb7', 'Abm7 Db7', 'Bmaj7 Ab7', 'C#m7 F#7']],
      ['E to G', ['Emaj7 C#7', 'F#m7 B7', 'Amaj7 F#7', 'Bm7 E7', 'Dmaj7 B7', 'Em7 A7', 'Gmaj7 E7', 'Am7 D7']],
    ],
  },
  {
    id: 'thirds-cycle', title: 'Drill: ii-V-I in Major Thirds (C, E, Ab)', key: 'C', tempo: 140, style: 'swing',
    rights: 'Original drill',
    sections: [
      ['A', ['Dm7 G7', 'Cmaj7', 'F#m7 B7', 'Emaj7', 'Bbm7 Eb7', 'Abmaj7', 'Dm7 G7', 'Cmaj7']],
      ['B', ['Cmaj7 Eb7', 'Abmaj7 B7', 'Emaj7 G7', 'Cmaj7', 'Dm7 . . G7', 'Cmaj7 . Ebmaj7 .', 'Abmaj7 . Emaj7 .', 'Cmaj7']],
    ],
  },
];

globalThis.TUNES = TUNES;
