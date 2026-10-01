# Realms Ascendant trailer

Final deliverable: `output/trailer/realms-ascendant-trailer.mp4`.

46 seconds, 1920 × 1080, 30 fps, H.264 / AAC stereo. The MP4 uses a fast-start header for browser playback. `output/trailer/realms-ascendant-poster.jpg` is the matching poster.

The story follows the divergence in `src/data/civs.ts`: Hannibal marches on Rome in 216 BC; Rome burns; twelve centuries later eight successor realms compete. The opening and closing illustration is concept art. The intervening shots use the real game renderer, animated models, combat, construction and movement simulation. Armies and settlements are staged for the camera; the capture changes only its temporary in-memory matches. HUD overlays are hidden during filming. This is a cinematic montage, not footage of an unedited match.

## Rebuild

Requires the repository's npm dependencies, Chrome, FFmpeg on PATH, and Python with NumPy and SciPy.

```sh
node tools/trailer/capture.mjs --preview
node tools/trailer/capture.mjs
python tools/trailer/score.py
node tools/trailer/assemble.mjs
```

Use `--scene fleet` (or `intro`, `latins`, `gauls`, `han`, `town`, `siege`, `battle`, `end`) to render one shot. Working clips, previews and the WAV master stay in `output/trailer/work/`. The final MP4 and working media are ignored by Git; the reproducible source and opening illustration are retained here.

## Edit

| Time | Beat |
| --- | --- |
| 0–10 s | Hannibal marches; Rome burns; twelve centuries pass |
| 10–14 s | Carthaginian fleet |
| 14–18 s | Latin legions and the Alpine Republic |
| 18–22 s | Unconquered Gaul |
| 22–26 s | Han fire-lances |
| 26–30 s | Economy and construction |
| 30–34 s | Elephants and siege engines |
| 34–40 s | Massed battle |
| 40–46 s | Title, eight realm emblems, browser play link |

## Audio and artwork

`score.py` composes and synthesizes an original instrumental score: strings, horns, drums, impacts, risers and environmental sound design. It uses no downloaded music or sampled recordings. There is no voice-over; all story text is on screen. The assembly masters the stereo score to a -15 LUFS target with a -1.2 dBTP ceiling.

The opening asset, `assets/rome-burns.png`, was generated with the **built-in image_gen tool** through the imagegen skill. Its exact prompt was:

> Use case: historical-scene. Asset type: cinematic opening illustration for an alternate-history strategy game trailer, Realms Ascendant: The Punic Centuries. Create a spectacular widescreen 16:9 matte painting, 2560x1440 or larger. In the game's fictional divergence, Hannibal captures and burns republican Rome in 216 BC. View from a dark hillside behind Carthaginian soldiers and a single war elephant, watching the Republican city and the Capitoline temple burn across a river valley. Small silhouetted soldiers at lower right, layered hills and ancient terracotta rooftops, fire-orange light glowing through monumental rolling charcoal smoke. Restrained and magnificent, fine painterly historical detail, tactile oil-paint concept art with cinematic lighting, blackened umber, antique gold, deep midnight teal, strong fiery highlights. City and burning temple occupy the center and right; upper left has dark smoke and readable negative space for title typography that will be added later. Pre-imperial Roman architecture only: no Colosseum, no imperial monuments, no medieval castles. No gore, no lettering, no text, no logo, no watermark. This is historical fiction, not a photograph or gameplay screenshot.

Game assets and fonts retain the repository's existing provenance; see `public/textures/CREDITS.md` for terrain and material textures.
