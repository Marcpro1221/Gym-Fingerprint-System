# Fingerprint Detection Bridge

This module adds a live DigitalPersona 4500 contact-detection alert to the dashboard `scan-shell` section.

## Repo Paths

- `frontend/index.html`
- `frontend/assets/js/app.js`
- `frontend/assets/css/style.css`
- `backend/src/modules/fingerprint-detection/bridge.js`
- `backend/src/modules/fingerprint-detection/digitalpersona-capture.ps1`

## Installed DigitalPersona Paths Used

- `C:\Program Files\DigitalPersona\U.are.U SDK\Windows\Lib\.NET\DPUruNet.dll`
- `C:\Program Files\DigitalPersona\U.are.U SDK\Windows\Lib\x64\dpfpdd.dll`
- `C:\Program Files\DigitalPersona\U.are.U SDK\Windows\Lib\win32\dpfpdd.dll`
- `C:\Program Files\DigitalPersona\Pro Workstation\Bin\dpfpdd5000.dll`

## Run Process

1. Start the fingerprint bridge:

```powershell
npm run fingerprint:bridge
```

2. Start the frontend in another terminal:

```powershell
npm run dev
```

3. Open the app in the browser from the frontend server.

4. In the `scan-shell` section:
- Click `Check Reader`
- Wait for `Reader detected`
- Keep the scanner clear
- Click `Detect Finger Contact`
- Place a finger on the DigitalPersona 4500 reader within 5 seconds

## What The Bridge Does

- `bridge.js` exposes `GET /api/fingerprint/status` and `POST /api/fingerprint/capture`.
- `digitalpersona-capture.ps1` loads `DPUruNet.dll`, opens the first connected reader, checks status, and uses stream mode to detect contact by comparing the live frame against a baseline image.
- The frontend shows the reader status, SDK/driver path, capture mode, and the last contact result as an alert under `scan-shell`.
- The main `scan-shell` label also changes to `Reader ready`, `Detecting finger contact`, `Finger detected`, `Contact timed out`, or `Capture failed`.

## Current Scope

This feature detects reader status and finger contact only. It does not yet match the fingerprint against a member database or enroll new fingerprint templates.
The scanner card now updates the inline member, non-member, and renew result previews after each live capture instead of using a manual demo-cycle button.
