# FTO Notebook

Shift notes and evaluation drafts for Field Training Officers.

- Type quick notes after each call and select the guide objectives they show.
- Scores are worked out from the objectives using fixed rules: per call, start at 4; each different below-standard objective takes off 1, and on that call nothing can go above 4; otherwise each different exceeds-standard objective adds 1; the day's score is the lowest call.
- Narratives are drafted from fixed, proofread sentence frames, the guide's own wording, and your notes, with spelling cleanup, shorthand spelled out, and a check for subjective wording.
- Copy each narrative into your evaluation form yourself. This app never connects to any other system.

## Privacy

- **Notes never leave the device.** They are stored in this browser only. There are no accounts and no servers.
- **Notes are deleted** when you tap *End shift*, or automatically 24 hours after the shift started.
- **The evaluation guide is not part of this app.** You load your own guide file once on each device, and it stays in that browser.
- No names: the app refers only to "Orientee" and "FTO."
- Moving a shift from phone to laptop uses QR codes read by the laptop's webcam. Nothing is sent over the internet, and the phone deletes its copy after.

## Put it online with GitHub Pages (free, about 10 minutes)

1. Sign in at github.com (or create a free account).
2. Click **+** (top right) → **New repository**. Name it `fto-notebook`, choose **Public**, and click **Create repository**.
3. On the new repository page, click **uploading an existing file**.
4. Drag in **everything inside this folder** (`index.html`, `app.css`, `manifest.webmanifest`, `sw.js`, `README.md`, and the `js`, `lib` and `icons` folders). **Never upload your guide file.**
5. Click **Commit changes**.
6. Go to **Settings** → **Pages**. Under *Branch*, choose **main** and **/(root)**, then **Save**.
7. After a minute or two, the page shows your address: `https://YOUR-USERNAME.github.io/fto-notebook/`

The app's code is public, but it contains no guide content and no notes, so there's nothing sensitive in it. Anyone who opens the link without your guide file just sees a screen asking for one.

## Install on your devices

Open your address, then:

- **iPhone:** in Safari, tap **Share** → **Add to Home Screen**. Use it from the home screen icon; that also stops iOS from clearing its data.
- **Android:** in Chrome, tap **⋮** → **Install app** (or **Add to Home screen**).
- **Laptop (Chrome or Edge):** click the install icon at the right end of the address bar, or just bookmark it.

The first time on each device, tap **Load guide file** and choose your guide file. Get the file onto the phone however you normally move a file privately (AirDrop, USB, or a cable).

After the first visit, the app also works with no signal.

## A shift, start to finish

1. **Start shift.**
2. Notes not tied to a call (arrival, uniform, truck check, station, debrief) go under **General**. Tap **+ New call** at the start of each call.
3. **Note + Objectives:** type what you saw, then select the objectives it shows. **Objectives:** select objectives with no note. **Something I taught:** goes into Training Provided.
4. **Review:** scores, which call set each one, and drafted narratives. Edit anything, change any score, then **Copy** into your form.
5. To finish on the laptop: on the laptop tap **Receive shift from phone**, and on the phone go to **Shift → Send to laptop**. When both show the same check code, clear the phone.
6. **End shift & delete notes** once your form is complete.

## Updating

Upload changed files to the same repository (they replace the old ones). Devices pick up the new version the next time they open the app online.

## Credits

QR codes: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) by Kazuhiko Arase (MIT license). QR reading: [jsQR](https://github.com/cozmo/jsQR) (Apache License 2.0, see `lib/jsQR.LICENSE`).
