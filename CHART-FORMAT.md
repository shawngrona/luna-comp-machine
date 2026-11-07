# Comp Machine chart files

The Comp Machine reads three open formats. Upload a file with **Upload...** or drop it on
the window. All three are 4/4 only for now (2/2 also works, since its bars are the same length).

## 1. Text charts (`.txt`)

Plain text, one or more charts per file. This format is free to use and copy.

```
Title: Bossa ii-V Workout
Key: C
Tempo: 140
Feel: bossa
A: | Dm7 | G7 | Cmaj7 | % | Cm7 | F7 | Bbmaj7 | % |
B: | Bbm7 | Eb7 | Abmaj7 | % | Abm7 Db7 | Gbmaj7 | Em7b5 . . A7alt | Dm7 G7 |
---
Title: Next chart
| F6 | % | ...
```

- **Bars** go between `|`. A line can hold as many bars as you like.
- **Chords in a bar** share its four beats evenly: `| Dm7 G7 |` is two beats each, and
  `| C A7 Dm7 G7 |` one beat each.
- **`.` (or `/`) holds** the chord before it for its share: `| Dm7 . . G7 |` is three beats of
  Dm7, then G7. A bar that *starts* with `.` keeps the previous bar's last chord going:
  `| . . Cmaj7 . |`.
- **`%`** repeats the whole previous bar.
- **Sections:** start a line with a short label and a colon (`A:`, `Bridge:`, `Intro:`). The
  label shows on the chart.
- **Headers** (all optional) go on their own lines before the bars:
  - `Title:`. Without one the chart is named after the file.
  - `Key:` is the key the chart is written in, e.g. `Bb`, `Gm` (or `G-`). The page can then
    transpose to any key.
  - `Tempo:` is in BPM, from 40 to 320.
  - `Feel:` is `swing`, `two` (two-feel), `ballad` or `bossa`.
- **Several charts** in one file: put a line of `---` between them.
- Lines starting with `#` are comments.

### Chord symbols

Root `A`–`G`, then an optional `#` or `b`, then the quality, then an optional `/bass`:

| Write | Means |
|---|---|
| `C` `C6` `C69` | major (voiced as a 6th chord) |
| `Cmaj7` `CM7` `CΔ` `Cmaj9` | major 7th |
| `Cm` `Cm7` `Cm9` `Cm11` `C-7` | minor 7th |
| `Cm6` | minor 6th |
| `CmMaj7` `Cm(maj7)` | minor-major 7th |
| `C7` `C9` `C13` | dominant |
| `C7#11` | dominant with a raised 11th |
| `C7alt` `C7b9` `C7#9` `C7b13` | altered dominant |
| `C7#5` `C+7` `Caug` | augmented dominant |
| `C7sus` `Csus` `Csus4` | suspended |
| `Cm7b5` `Cø` | half-diminished |
| `Cdim` `Cdim7` `Co7` | diminished |
| `C7/E` | any chord over a bass note |

## 2. MusicXML (`.musicxml`, `.xml`, `.mxl`)

The open standard for sheet music. MuseScore (free), Dorico, Sibelius, Finale and many chart
apps export it; the compressed `.mxl` that MuseScore saves by default works too.

What is read:

- **Chord symbols** (`<harmony>`), on the beat they fall on. In MuseScore, add them with
  *Add > Text > Chord Symbol* (Ctrl/Cmd+K). The score needs no melody: chord symbols over rests
  are enough.
- **Title and composer**, the **key signature** (major or minor), and the **tempo** marking.
- **Rehearsal marks** (A, B, ...) as section labels.
- **Repeats** and **first and second endings**, played out in order.
- A pickup bar before the first chord is skipped. A bar with no chord symbol keeps the last chord.

What is not read: D.C., D.S. and coda jumps (the score plays once, as written), time
signatures other than 4/4, and more than one chord per beat (the last one on a beat wins).

## 3. ChordPro grids (`.cho`, `.chopro`, `.chordpro`)

[ChordPro](https://www.chordpro.org) is an open format for songbooks. The Comp Machine
reads its **grid** sections, which lay chords out bar by bar:

```
{title: Grid Tune}
{key: F}
{tempo: 132}
{meta: feel two-feel}
{start_of_grid label="A"}
|: F6 . . . | Gm7 . C7 . | Am7 . D7 . |1 Gm7 . C7 . :|2 Gm7 . C7 . | F6 . . . |
{end_of_grid}
{start_of_grid label="B"}
| Bb6 . . . | % | Bbm6 . . . | %% |
{end_of_grid}
```

- Each cell is a beat: a chord, or `.` to hold the one before.
- Bar lines `|`, `||`, `|.`; repeats `|:` and `:|`; endings `|1`, `|2` (or `:|2`).
- `%` repeats one bar and `%%` repeats two.
- `{title}`, `{key}`, `{tempo}` and `{time}` set the details, and `{meta: feel ...}` sets the feel.
- Text before the first bar line becomes the section label.

Ordinary ChordPro songs (chords written over lyrics, `[C]like [G7]this`) have no bar lines, so
the length of each chord is unknown. Add a grid section to use them.
