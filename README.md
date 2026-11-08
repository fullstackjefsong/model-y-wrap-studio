# Original Model Y Wrap Studio

A local browser editor for the **original, pre-refresh Tesla Model Y**. Create repeatable wrap designs, save editable projects, and export Tesla-compatible PNGs to your phone. Premium Connectivity and Tesla credentials are not needed.

## Run on Windows

Requires Node.js 20 or later.

```powershell
git clone https://github.com/fullstackjefsong/model-y-wrap-studio.git
Set-Location .\model-y-wrap-studio
npm install
npm start
```

Open http://localhost:4173 on the computer. Keep the server running while transferring to your phone. Stop it with Ctrl+C. If the port is occupied, set `$env:PORT = '4174'` before `npm start`.

## Repeatable workflow

1. Choose a name, colors, and pattern.
2. Add PNG/JPEG/WebP artwork or text. Select a layer, drag it on the preview, and adjust size, rotation, and opacity. Duplicate layers for matching panels. Undo/redo remembers the last 20 edits.
3. **Save project** stores the editable design, including artwork, under `data\projects`. Open it from the saved-project list next time. Saving an opened project updates that project. To make a separate copy, use **Backup JSON**, then **Import JSON**, rename, and save.
4. **Backup JSON** downloads a portable, editable copy. PNGs are flattened exports, not editable project backups.
5. **Export & send to phone** validates the PNG dimensions, filename, and 1 MB maximum. If a detailed design exceeds that limit, choose 512 pixels or simplify it; the app reports the error instead of exporting an invalid file.
6. Scan the QR code from a phone on the **same trusted Wi-Fi**. If multiple adapter addresses are offered, select the computer's Wi-Fi address. Tap **Download PNG**; Android saves to Downloads, while iPhone can use Files or save the displayed image to Photos.
7. Open **Tesla app > Creations > Wrap > Upload** and select the PNG. Apply it in the vehicle under **Toybox > Paint Shop > Wraps**.

### Android and iPhone

Both platforms use the same QR link and PNG download; no special phone app is required for the transfer.

- **Android:** scan with the camera or Google Lens and open the link in Chrome. Download the PNG, then select it from **Downloads** in Tesla's Upload picker. If the picker only shows photos, use its Browse or Files option if available, or save/copy the PNG to Pictures using your Files app so the photo picker can see it. Picker options vary by phone and Tesla app version.
- **iPhone:** download to Files, or press and hold the displayed wrap image and save to Photos. Select the saved PNG in Tesla Upload.
- Direct file sharing is optional. The download flow works even when the browser disables the share sheet on local HTTP.

### Email option

**Email / share PNG** uses the operating system's file-share sheet where supported, allowing selection of a mail app. Otherwise it downloads the PNG and opens an email draft: **attach the downloaded PNG manually before sending**. Browsers cannot add attachments through `mailto:`, and the app does not claim to send email.

The phone page also offers file sharing or download-and-attach instructions. Many phone browsers disable Web Share on plain local HTTP, so the download fallback is intentional. A local QR link is not an email attachment and will not work off your home network.

### Network and privacy

- Allow Node.js through Windows Firewall on **private networks only**, if prompted. Do not expose the port to the internet or use public Wi-Fi.
- Editing and saved-project APIs are restricted to loopback; LAN clients can only access an exported wrap with its unguessable link.
- Export links expire after one hour, can be revoked in the editor, and stop working when the server restarts. Expired files are cleaned on the next transfer request; old files are also cleaned at startup.
- Designs stay on your computer unless you explicitly download, share, or email them. No cloud services or Tesla login are used.
- Guest Wi-Fi isolation, VPNs, or a firewall may prevent QR transfer. Emailing the actual PNG attachment is an alternative.
- Changes are not autosaved. Save or back up before closing the tab.

### Public repository privacy

The repository contains source code, tests, dependency manifests, the public Tesla template, and SONG Labs branding. Saved projects and temporary exports under `data` are excluded from Git, as are dependencies, environment files, and logs. Do not add personal project backups, exported wraps, phone screenshots, or credentials to the repository.

LAN addresses and transfer tokens are generated at runtime, not embedded in the source. Publishing the repository does not publish the running local server or your saved designs. GitHub account ownership and commit attribution are public; use a GitHub noreply email for commits if you do not want a personal email published.

The displayed SONG Labs logo is a resized, metadata-free copy of the supplied branding image; the original image is not modified. The branding is not part of exported wrap artwork.

## Preview and template

The preview is the **unfolded 2D panel layout**, not a simulated 3D car. Artwork is clipped to the white regions of Tesla's template. Preview guide shading and selection markers are excluded from exported PNGs. Test placement in the vehicle: the UV layout can rotate or mirror artwork on different panels.

The included `public\template.png` comes from [Tesla's official original Model Y template](https://github.com/teslamotors/custom-wraps/blob/master/modely/template.png). Export requirements follow [Tesla's custom-wrap documentation](https://github.com/teslamotors/custom-wraps): square PNG, 512-1024 pixels, no larger than 1 MB, simple filenames. This tool uses a conservative 26-character base name so the full filename stays within 30 characters.

This project does not replace system assets, install vehicle apps, or change physical paint. It is independent of Tesla. Other Model Y body styles need their own templates and are not supported here.

## Validate

```powershell
npm test
```
