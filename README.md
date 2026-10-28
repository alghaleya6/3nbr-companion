# 3nbr Companion

**3nbr**, a white lovebird, living on your Windows desktop: 13 live poses, and he reacts to your clicks, your cursor and your typing.

## Install (Windows)

1. Download `Companion-win32-x64.zip` from the [latest release](../../releases/latest).
2. Right-click it, choose **Extract All**, then open the new folder and run `Companion.exe`.
   The app isn't code-signed, so Windows may say "Windows protected your PC". Click **More info → Run anyway**.
3. The 3nbr Studio opens. Click through its four steps and press **Add to desktop**.

The paw icon in the system tray opens the Studio, sets 3nbr to start with Windows, and quits.

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
