# Shima demo role-play audio — fictional, mic-less (ロールプレイ（架空・マイクなし）)

Prerecorded fictional Japanese role-play audio for the ~60-second synthetic demo
(SHIMA-PILOT-CONTRACT.md, work order item 1). The demo video itself is recorded by
the parent after the UI is verified; these are only the prerecorded speech assets
plus their script. No application wiring was changed for this.

- **Everything is fictional.** Synthetic voices only; no real person recorded or
  impersonated; no real interview data, real hotel, real names or contacts.
  The hotel and both speakers are invented for the demo.
- **Local engine only.** VOICEVOX Nemo Engine 0.26.0 (CPU, `model/n0.vvm`,
  9 bundled Nemo voices), run from the ignored scratch dir — no system install,
  no provider, no keys, no mic.

## Files (repo-relative, exact)

| File | Role | Voice (Nemo style) | Duration | Format |
| --- | --- | --- | --- | --- |
| `public/demo/shima/shima-demo-intro-owner.wav` | Fictional owner introduces the room-change work | 男声1 (style id 10001) | 8.074667 s | PCM 16-bit / 24000 Hz / mono |
| `public/demo/shima/shima-demo-question-shima.wav` | Shima's prerecorded fictional question | 女声1 (style id 10005) | 8.650667 s | PCM 16-bit / 24000 Hz / mono |
| `public/demo/shima/shima-demo-answer-owner.wav` | Fictional owner's scripted answer | 男声1 (style id 10001) | 5.472000 s | PCM 16-bit / 24000 Hz / mono |

Total spoken length ≈ 22.2 s. Same fictional owner voice (男声1) in intro and
answer on purpose. `public/demo/shima/CREDITS.md` carries the required credit.

## Script and Japanese captions (exact spoken text)

1. **Intro — fictional owner (男声1)**
   Caption: こんにちは。架空の宿でフロントを担当しています。清掃予定を渡した後に部屋が変わると、電話で連絡して、予定表を書き直しています。
2. **Question — Shima (女声1)**
   Caption: 清掃予定を渡した後の部屋変更は、繁忙期に週何回くらいあり、電話と表の書き直しに1回何分くらいかかりますか？
3. **Answer — fictional owner (男声1)**
   Caption: 繁忙期は週に約10回。電話と予定表の修正に、合わせて1回約15分かかります。

## Match to the demo UI (byte-verified)

- Clip 2 text equals `shimaDemoQuestion` (`q_hotel_01`) in
  `app/composables/useShimaDemo.ts` byte-for-byte, so the audio and the
  `data-testid="shima-demo-question"` text display agree.
- Clip 3 text equals the 台本の回答 line shown in
  `app/components/shima/ShimaDemoIntake.vue` byte-for-byte
  (≈10/week × ≈15 min → ~2.5 h/week high-season, `step_hotel_08` / `opp_hotel_02`
  follow in the UI after the answer; those are not spoken).
- Clip 1 paraphrases the intake panel's intro sentence
  （架空の宿では、清掃予定を渡した後に部屋が変わると、電話で伝えて予定表を書き直します。）without adding facts.

## Verification record (2026-11-24)

- Engine: `GET /version` → `0.26.0`; `GET /speakers` → 9 Nemo voices
  (女声1–6, 男声1–3), one ノーマル style each; `n0.vvm` (71.7 MB) loaded by
  `run.exe --host 127.0.0.1 --port 50121`.
- Synthesis: `POST /audio_query?text=…&speaker=…` → `POST /synthesis`
  (defaults: speedScale 1.0, pitchScale 0.0, outputSamplingRate 24000, mono;
  per-clip parameters in `.data/shima-roleplay-capture/out/*.meta.json`).
- ffprobe: all three `pcm_s16le`, 24000 Hz, 1 channel, 16-bit; durations above.
- Audibility (ffmpeg volumedetect): intro mean −22.7 dB / max −6.4 dB;
  question mean −23.2 dB / max −7.5 dB; answer mean −22.8 dB / max −5.6 dB.
- Waveforms (ffmpeg showwavespic, reviewed): distinct phrase bursts with clean
  sentence-boundary silences and natural envelopes — speech, not silence/noise/tone.
- Rights: bundled `resources/engine_manifest_assets/terms_of_service.md`
  (engine: commercial/non-commercial OK, credit required) and each character's
  `policy.md` (audio usable with 「VOICEVOX Nemo」 credit, terms at
  https://voicevox.hiroshiba.jp/nemo/term/ — checked live 2026-11-24: credit
  required for commercial/non-commercial use; machine-learning use prohibited;
  this is a rendered demo asset, not training data). Usage here: fictional
  self-demo with visible credit → permitted.

## Sources

```json
{"version":1,"sources":[
 {"id":1,"url":"https://voicevox.hiroshiba.jp/nemo/term","title":"VOICEVOX Nemo terms","accessed":"2026-11-24"},
 {"id":2,"url":"https://github.com/VOICEVOX/voicevox_vvm","title":"Official VOICEVOX model terms","accessed":"2026-11-24"},
 {"id":3,"url":"https://github.com/VOICEVOX/voicevox_nemo_engine/releases/tag/0.26.0","title":"VOICEVOX Nemo Engine 0.26.0","accessed":"2026-11-24"}]}
```

## Reproduction (scratch only, ignored by git)

Engine and capture live in the ignored dir `.data/shima-roleplay-capture/`
(engine extracted from the already-downloaded `nemo.vvpp` 0.26.0 package;
nothing outside it is modified). Regenerate with:

```bash
cd .data/shima-roleplay-capture/engine
PYTHONIOENCODING=utf-8 ./run.exe --host 127.0.0.1 --port 50121 --disable_mutable_api
# then per clip: POST /audio_query?text=<caption>&speaker=<style id>,
# POST /synthesis?speaker=<style id> with that query body → WAV
```

The engine binary and scratch stay out of the repo; only the three WAVs above,
`public/demo/shima/CREDITS.md` and this file are new tracked-candidate files.
