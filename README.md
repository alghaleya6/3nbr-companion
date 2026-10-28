# Companion

An animated pet that lives on your Windows desktop. It ships with **3nbr**, a white lovebird with 13 live poses, and can also turn one photo of any pet into a companion.

## Install (Windows)

1. Download `Companion-win32-x64.zip` and `3nbr.companion` from the [Releases](../../releases) page.
2. Unzip the folder anywhere and run `Companion.exe`.
   The app isn't code-signed, so Windows may say "Windows protected your PC". Click **More info → Run anyway**.
3. Add 3nbr to the desktop, either way:
   - in the Studio, click **Import package…** and pick `3nbr.companion`, or
   - click through the Studio's four steps with **Lovebird poses** selected and press **Import to desktop**.

The paw icon in the system tray opens the Studio, imports packages, sets Companion to start with Windows, and quits.

## 3nbr on the desktop

| Do this | He does |
| --- | --- |
| Click | Little Kiss |
| Double-click | Disco Bird |
| Move the cursor back and forth over him | Head Pats |
| Hover just in front of his beak | Feisty Pecks |
| Type anywhere | Keyboard Buddy |
| Drag | Picks him up; he flutters down when you let go |
| Right-click | Size, follow my cursor, tricks |

On his own he looks around, patrols the taskbar, has snacks, naps in his bed, stretches, preens, tucks in for a nap and scrolls on his phone.

The typing reaction uses a global keyboard listener that only notices *that* a key was pressed, never which key. Nothing is sent anywhere.

## Making a companion from a photo

Pick **Any pet, from one photo** in the Studio:

1. **Upload one clear photo.** Well-lit, full or half body, plain background. Name your companion, choose a personality and its actions.
2. **Review the look.** The Studio cuts your pet out and marks the face, ears and tail. Drag a marker if it's off, or use Erase / Restore on the cutout.
3. **Review movement poses.** Every selected action plays live. Switch off any you don't like, then render.
4. **Bring it to the desktop.** **Import to desktop**, or **Save .companion file…** to keep or share it.

The first photo downloads the background-removal model (about 100 MB) from IMG.LY's CDN and caches it in `%APPDATA%\Companion\model-cache`. Photos are processed on your PC and never uploaded.

## Running from source

```bash
npm install
npm start
```

- `npm run selftest` clicks through the Studio, imports 3nbr and saves screenshots to `.selftest/`.
- `npm run package` builds `release/Companion-win32-x64/`.

## How 3nbr's poses are made

- **Pictures:** one AI-generated picture per pose (`assets/poses/ai/src`), made from a description of 3nbr.
- **Cut-outs:** `src/dev/aicut.js` cuts each picture out with `@imgly/background-removal`, keeping props (branch, keyboard, bed, pillow) and fading hands that run off the edge. Results go to `assets/poses/ai/cut`.
- **Rig and motion:** `src/studio/aipack.js` marks the head, body and feet of each cut-out (`AI_RIGS`) and animates them on a WebGL mesh (`src/shared/rig.js`): head turns, breathing, foot taps on the keys, lunges and leans.
- **Package:** a `.companion` file is a zip with `manifest.json` and one WebP sprite sheet per pose at 20 fps.
- **Desktop client** (`src/overlay/overlay.js`): a transparent, always-on-top, click-through window over the work area that plays the sheets and reacts to the mouse and keyboard.

## Licence

AGPL-3.0, because the app includes `@imgly/background-removal` (AGPL-3.0). Other libraries: Electron, fflate, ONNX Runtime Web, uiohook-napi.
