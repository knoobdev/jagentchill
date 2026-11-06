# audio-editing — normative catalogue of the bundled sound pack

This file is normative. It is cited by `audio-editing.Bundled sound pack`,
`audio-editing.Bundled pack as the built-in music and sound-effect source` and `audio-editing.Sounds library panel`.

- **Production status: not produced.** No audio file of this pack exists when this catalogue is written. Each row is a
  commissioning brief: the title, mood or category, tempo, key and duration the delivered file must have. The pack
  ships only when every row has a file that passes the per-item acceptance and the release gate of
  `audio-editing.Bundled sound pack`; a build with a missing file fails.
- **Source.** Each item is `origin: "authored"` (made for JAgentChill by a contributor who signs a CC0-1.0 dedication;
  `sourceUrl` = `assets/jagentchill-sounds/src/<id>/`, the item's session or stem files) or `origin: "third-party"`
  (a work already published under CC0-1.0; `sourceUrl` = the URL of the original publication). `licence` is `CC0-1.0`
  for every row (normalised `cc0`). The `origin`, `author` and `sourceUrl` of each row are recorded in
  `assets/jagentchill-sounds/manifest.json` and `docs/product/ASSET-PROVENANCE.md` when the file is delivered; they
  are not listed here because they do not exist yet.
- **Format.** AAC-LC in MP4 (`.m4a`), 48 000 Hz. Music: stereo, 128 kbit/s, integrated loudness −16 ± 1 LUFS, true peak
  ≤ −1 dBTP. Effects: mono unless the title says otherwise, 96 kbit/s, sample peak −3 ± 1 dBFS.
- **Columns.** Duration is the target; the file is within ±1 s (music) or ±0.05 s (effects). BPM is verified by the
  product's own beat detection within 1 BPM (or its double or half). Key is the tonal centre the listening review
  confirms; it is shown in the UI and used by search, and no other feature depends on it.
- **Tags.** The "Tags" column is the item's `tags` (space-separated words), used by the keyword search of
  `audio-editing.Bundled pack as the built-in music and sound-effect source`, by `jc_stock_search`, and as the text
  appended to `q` when the category chip is active with an online source (`audio-editing.Sound search proxy`). The
  category or mood name and the words of the title are searchable in addition.
- **Size.** Music: 4 964 s in total, at most 82 MB at 128 kbit/s. Effects: 213 s in total, at most 4 MB. Mobile bundle:
  the 120 effects and the eight tracks `mus-<mood>-01` (1 010 s), at most 24 MB.

## Music — 8 moods × 5 tracks = 40

| Id | Title | Mood (category) | BPM | Key | Duration | Tags |
|---|---|---|---|---|---|---|
| `mus-upbeat-01` | Morning Sprint | Upbeat | 124 | A minor | 96 s | upbeat energetic |
| `mus-upbeat-02` | Bright Steps | Upbeat | 128 | G major | 84 s | upbeat energetic |
| `mus-upbeat-03` | Go Time | Upbeat | 132 | E minor | 72 s | upbeat energetic |
| `mus-upbeat-04` | Sunny Side Run | Upbeat | 120 | D major | 110 s | upbeat energetic |
| `mus-upbeat-05` | Jump Start | Upbeat | 136 | B minor | 64 s | upbeat energetic |
| `mus-chill-01` | Slow Tide | Chill | 84 | D major | 120 s | chill relaxed |
| `mus-chill-02` | Paper Lanterns | Chill | 78 | B minor | 138 s | chill relaxed |
| `mus-chill-03` | Window Seat | Chill | 90 | F major | 104 s | chill relaxed |
| `mus-chill-04` | Soft Focus | Chill | 72 | D minor | 150 s | chill relaxed |
| `mus-chill-05` | Late Bus Home | Chill | 86 | C major | 126 s | chill relaxed |
| `mus-cinematic-01` | First Light | Cinematic | 70 | D minor | 150 s | cinematic orchestral |
| `mus-cinematic-02` | Open Horizon | Cinematic | 64 | C major | 168 s | cinematic orchestral |
| `mus-cinematic-03` | Quiet Giants | Cinematic | 60 | A minor | 180 s | cinematic orchestral |
| `mus-cinematic-04` | The Long Road | Cinematic | 76 | G major | 142 s | cinematic orchestral |
| `mus-cinematic-05` | Rising Shore | Cinematic | 68 | E minor | 156 s | cinematic orchestral |
| `mus-corporate-01` | Clear Plan | Corporate | 108 | G major | 120 s | corporate background |
| `mus-corporate-02` | Steady Growth | Corporate | 112 | E minor | 110 s | corporate background |
| `mus-corporate-03` | New Quarter | Corporate | 104 | D major | 128 s | corporate background |
| `mus-corporate-04` | On Schedule | Corporate | 116 | B minor | 98 s | corporate background |
| `mus-corporate-05` | Open Office | Corporate | 100 | F major | 134 s | corporate background |
| `mus-happy-01` | Pocket Sunshine | Happy | 118 | B minor | 88 s | happy playful |
| `mus-happy-02` | Picnic Day | Happy | 112 | F major | 96 s | happy playful |
| `mus-happy-03` | Little Wins | Happy | 126 | D minor | 74 s | happy playful |
| `mus-happy-04` | Paper Planes | Happy | 122 | C major | 82 s | happy playful |
| `mus-happy-05` | Jelly Shoes | Happy | 130 | A minor | 66 s | happy playful |
| `mus-dramatic-01` | Cold Front | Dramatic | 92 | C major | 124 s | dramatic tension |
| `mus-dramatic-02` | Last Signal | Dramatic | 88 | A minor | 140 s | dramatic tension |
| `mus-dramatic-03` | Under Pressure Point | Dramatic | 100 | G major | 108 s | dramatic tension |
| `mus-dramatic-04` | Black Tide | Dramatic | 80 | E minor | 152 s | dramatic tension |
| `mus-dramatic-05` | Countdown Room | Dramatic | 140 | D major | 60 s | dramatic tension |
| `mus-lofi-01` | Rainy Desk | Lo-fi | 74 | E minor | 132 s | lofi beat |
| `mus-lofi-02` | Tape Loop Cafe | Lo-fi | 80 | D major | 118 s | lofi beat |
| `mus-lofi-03` | Night Notes | Lo-fi | 70 | B minor | 146 s | lofi beat |
| `mus-lofi-04` | Dusty Keys | Lo-fi | 76 | F major | 128 s | lofi beat |
| `mus-lofi-05` | Sleepy Train | Lo-fi | 68 | D minor | 160 s | lofi beat |
| `mus-ambient-01` | Still Water | Ambient | 60 | F major | 180 s | ambient atmosphere |
| `mus-ambient-02` | Cloud Field | Ambient | 60 | D minor | 170 s | ambient atmosphere |
| `mus-ambient-03` | Glass Morning | Ambient | 66 | C major | 150 s | ambient atmosphere |
| `mus-ambient-04` | Far Lights | Ambient | 62 | A minor | 164 s | ambient atmosphere |
| `mus-ambient-05` | Slow Orbit | Ambient | 60 | G major | 176 s | ambient atmosphere |

## Sound effects — 12 categories × 10 effects = 120

| Id | Title | Category | Duration | Tags |
|---|---|---|---|---|
| `sfx-whoosh-01` | Quick Whoosh | Whoosh | 0.4 s | whoosh swoosh |
| `sfx-whoosh-02` | Soft Whoosh | Whoosh | 0.7 s | whoosh swoosh |
| `sfx-whoosh-03` | Heavy Whoosh | Whoosh | 1 s | whoosh swoosh |
| `sfx-whoosh-04` | Whoosh Up | Whoosh | 0.6 s | whoosh swoosh |
| `sfx-whoosh-05` | Whoosh Down | Whoosh | 0.6 s | whoosh swoosh |
| `sfx-whoosh-06` | Double Whoosh | Whoosh | 0.9 s | whoosh swoosh |
| `sfx-whoosh-07` | Air Swipe | Whoosh | 0.3 s | whoosh swoosh |
| `sfx-whoosh-08` | Long Sweep | Whoosh | 1.6 s | whoosh swoosh |
| `sfx-whoosh-09` | Fast Pass By | Whoosh | 0.5 s | whoosh swoosh |
| `sfx-whoosh-10` | Wind Cut | Whoosh | 0.8 s | whoosh swoosh |
| `sfx-impact-01` | Deep Boom | Impact | 2 s | impact hit |
| `sfx-impact-02` | Short Thud | Impact | 0.4 s | impact hit |
| `sfx-impact-03` | Metal Hit | Impact | 0.9 s | impact hit |
| `sfx-impact-04` | Sub Drop | Impact | 2.4 s | impact hit |
| `sfx-impact-05` | Punchy Hit | Impact | 0.5 s | impact hit |
| `sfx-impact-06` | Cinematic Slam | Impact | 3 s | impact hit |
| `sfx-impact-07` | Soft Bump | Impact | 0.3 s | impact hit |
| `sfx-impact-08` | Wood Knock | Impact | 0.3 s | impact hit |
| `sfx-impact-09` | Glass Ping Hit | Impact | 0.8 s | impact hit |
| `sfx-impact-10` | Low Rumble Hit | Impact | 2.8 s | impact hit |
| `sfx-ui-01` | Soft Click | UI | 0.1 s | click button interface |
| `sfx-ui-02` | Hard Click | UI | 0.1 s | click button interface |
| `sfx-ui-03` | Toggle On | UI | 0.2 s | click button interface |
| `sfx-ui-04` | Toggle Off | UI | 0.2 s | click button interface |
| `sfx-ui-05` | Pop Tap | UI | 0.15 s | click button interface |
| `sfx-ui-06` | Bubble Tap | UI | 0.2 s | click button interface |
| `sfx-ui-07` | Key Press | UI | 0.1 s | click button interface |
| `sfx-ui-08` | Select Tick | UI | 0.1 s | click button interface |
| `sfx-ui-09` | Swipe Tick | UI | 0.25 s | click button interface |
| `sfx-ui-10` | Error Buzz | UI | 0.4 s | click button interface |
| `sfx-notification-01` | Bright Ding | Notification | 0.8 s | notification alert chime |
| `sfx-notification-02` | Two-Note Chime | Notification | 1 s | notification alert chime |
| `sfx-notification-03` | Soft Bell | Notification | 1.4 s | notification alert chime |
| `sfx-notification-04` | Message Pop | Notification | 0.3 s | notification alert chime |
| `sfx-notification-05` | Success Chime | Notification | 1.2 s | notification alert chime |
| `sfx-notification-06` | Warning Tone | Notification | 0.7 s | notification alert chime |
| `sfx-notification-07` | Gentle Ping | Notification | 0.6 s | notification alert chime |
| `sfx-notification-08` | Triple Beep | Notification | 0.9 s | notification alert chime |
| `sfx-notification-09` | Marimba Note | Notification | 0.8 s | notification alert chime |
| `sfx-notification-10` | Glass Chime | Notification | 1.5 s | notification alert chime |
| `sfx-transition-01` | Tape Stop | Transition | 1 s | transition sweep |
| `sfx-transition-02` | Tape Start | Transition | 1 s | transition sweep |
| `sfx-transition-03` | Reverse Swell | Transition | 1.5 s | transition sweep |
| `sfx-transition-04` | Flash Pop | Transition | 0.4 s | transition sweep |
| `sfx-transition-05` | Page Flip Sweep | Transition | 0.5 s | transition sweep |
| `sfx-transition-06` | Camera Shutter Sweep | Transition | 0.3 s | transition sweep |
| `sfx-transition-07` | Slide In Tone | Transition | 0.6 s | transition sweep |
| `sfx-transition-08` | Slide Out Tone | Transition | 0.6 s | transition sweep |
| `sfx-transition-09` | Zoom Sweep | Transition | 0.8 s | transition sweep |
| `sfx-transition-10` | Spin Sweep | Transition | 1.2 s | transition sweep |
| `sfx-riser-01` | Short Riser | Riser | 2 s | riser build up |
| `sfx-riser-02` | Long Riser | Riser | 6 s | riser build up |
| `sfx-riser-03` | Noise Riser | Riser | 4 s | riser build up |
| `sfx-riser-04` | Tonal Riser | Riser | 4 s | riser build up |
| `sfx-riser-05` | Reverse Cymbal Riser | Riser | 3 s | riser build up |
| `sfx-riser-06` | Sub Riser | Riser | 5 s | riser build up |
| `sfx-riser-07` | Tension Riser | Riser | 8 s | riser build up |
| `sfx-riser-08` | Pitch Riser | Riser | 3 s | riser build up |
| `sfx-riser-09` | Downer | Riser | 3 s | riser build up |
| `sfx-riser-10` | Riser And Hit | Riser | 5 s | riser build up |
| `sfx-glitch-01` | Data Burst | Glitch | 0.4 s | glitch digital |
| `sfx-glitch-02` | Bit Crunch | Glitch | 0.5 s | glitch digital |
| `sfx-glitch-03` | Static Zap | Glitch | 0.3 s | glitch digital |
| `sfx-glitch-04` | Stutter | Glitch | 0.6 s | glitch digital |
| `sfx-glitch-05` | Signal Drop | Glitch | 0.8 s | glitch digital |
| `sfx-glitch-06` | Modem Chirp | Glitch | 0.9 s | glitch digital |
| `sfx-glitch-07` | Short Circuit | Glitch | 0.5 s | glitch digital |
| `sfx-glitch-08` | Buffer Skip | Glitch | 0.4 s | glitch digital |
| `sfx-glitch-09` | Digital Tear | Glitch | 0.7 s | glitch digital |
| `sfx-glitch-10` | Power Down Glitch | Glitch | 1.2 s | glitch digital |
| `sfx-tone-01` | Censor Beep | Tone & Beep | 1 s | beep tone |
| `sfx-tone-02` | Countdown Beep | Tone & Beep | 0.3 s | beep tone |
| `sfx-tone-03` | Countdown Final Beep | Tone & Beep | 1 s | beep tone |
| `sfx-tone-04` | High Blip | Tone & Beep | 0.1 s | beep tone |
| `sfx-tone-05` | Low Blip | Tone & Beep | 0.1 s | beep tone |
| `sfx-tone-06` | Scanner Beep | Tone & Beep | 0.2 s | beep tone |
| `sfx-tone-07` | Radio Tone | Tone & Beep | 0.5 s | beep tone |
| `sfx-tone-08` | Sonar Ping | Tone & Beep | 2 s | beep tone |
| `sfx-tone-09` | Timer Tick | Tone & Beep | 0.1 s | beep tone |
| `sfx-tone-10` | Flatline Tone | Tone & Beep | 3 s | beep tone |
| `sfx-cartoon-01` | Boing | Cartoon | 0.6 s | cartoon funny |
| `sfx-cartoon-02` | Pop | Cartoon | 0.2 s | cartoon funny |
| `sfx-cartoon-03` | Slide Whistle Up | Cartoon | 0.8 s | cartoon funny |
| `sfx-cartoon-04` | Slide Whistle Down | Cartoon | 0.8 s | cartoon funny |
| `sfx-cartoon-05` | Bonk | Cartoon | 0.3 s | cartoon funny |
| `sfx-cartoon-06` | Squeak | Cartoon | 0.3 s | cartoon funny |
| `sfx-cartoon-07` | Spring Wobble | Cartoon | 1 s | cartoon funny |
| `sfx-cartoon-08` | Zip | Cartoon | 0.3 s | cartoon funny |
| `sfx-cartoon-09` | Plop | Cartoon | 0.3 s | cartoon funny |
| `sfx-cartoon-10` | Twinkle | Cartoon | 1.2 s | cartoon funny |
| `sfx-game-01` | Coin | Game | 0.4 s | game arcade |
| `sfx-game-02` | Power Up | Game | 0.9 s | game arcade |
| `sfx-game-03` | Power Down | Game | 0.9 s | game arcade |
| `sfx-game-04` | Level Up | Game | 1.4 s | game arcade |
| `sfx-game-05` | Jump | Game | 0.3 s | game arcade |
| `sfx-game-06` | Laser Shot | Game | 0.4 s | game arcade |
| `sfx-game-07` | Hit Marker | Game | 0.2 s | game arcade |
| `sfx-game-08` | Game Over | Game | 2 s | game arcade |
| `sfx-game-09` | Bonus Sparkle | Game | 1 s | game arcade |
| `sfx-game-10` | Menu Move | Game | 0.1 s | game arcade |
| `sfx-ambience-01` | Light Wind | Ambience | 10 s | ambience background |
| `sfx-ambience-02` | Strong Wind | Ambience | 10 s | ambience background |
| `sfx-ambience-03` | Steady Rain | Ambience | 10 s | ambience background |
| `sfx-ambience-04` | Ocean Wash | Ambience | 10 s | ambience background |
| `sfx-ambience-05` | Room Tone | Ambience | 10 s | ambience background |
| `sfx-ambience-06` | Low Hum | Ambience | 10 s | ambience background |
| `sfx-ambience-07` | Night Air | Ambience | 10 s | ambience background |
| `sfx-ambience-08` | White Noise Bed | Ambience | 10 s | ambience background |
| `sfx-ambience-09` | Pink Noise Bed | Ambience | 10 s | ambience background |
| `sfx-ambience-10` | Distant Thunder Roll | Ambience | 8 s | ambience background |
| `sfx-percussion-01` | Kick | Percussion | 0.4 s | drum percussion hit |
| `sfx-percussion-02` | Snare | Percussion | 0.3 s | drum percussion hit |
| `sfx-percussion-03` | Clap | Percussion | 0.3 s | drum percussion hit |
| `sfx-percussion-04` | Closed Hat | Percussion | 0.1 s | drum percussion hit |
| `sfx-percussion-05` | Open Hat | Percussion | 0.5 s | drum percussion hit |
| `sfx-percussion-06` | Rim Click | Percussion | 0.1 s | drum percussion hit |
| `sfx-percussion-07` | Tom Low | Percussion | 0.5 s | drum percussion hit |
| `sfx-percussion-08` | Tom High | Percussion | 0.4 s | drum percussion hit |
| `sfx-percussion-09` | Shaker | Percussion | 0.3 s | drum percussion hit |
| `sfx-percussion-10` | Drum Fill | Percussion | 1.6 s | drum percussion hit |

## Category order in the UI

- Music chips, in order: Upbeat, Chill, Cinematic, Corporate, Happy, Dramatic, Lo-fi, Ambient.
- Sound-effect chips, in order: Whoosh, Impact, UI, Notification, Transition, Riser, Glitch, Tone & Beep, Cartoon, Game,
  Ambience, Percussion.
