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

0. Configure PostgreSQL if you want the member directory and registration routes:

```powershell
$env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/gymflow"
```

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

- `bridge.js` exposes:
  - `GET /api/fingerprint/status`
  - `POST /api/fingerprint/capture`
  - `GET /api/fingerprint/health`
  - `GET /api/health`
  - `GET /api/members`
  - `POST /api/members/register-from-scan`
- `digitalpersona-capture.ps1` loads `DPUruNet.dll`, opens the first connected reader, checks status, and uses stream mode to detect contact by comparing the live frame against a baseline image.
- The capture payload now also returns a base64 fingerprint artifact from the raw image frame so the backend can persist an enrollment record.
- The frontend shows the reader status, SDK/driver path, capture mode, and the last contact result as an alert under `scan-shell`.
- The main `scan-shell` label also changes to `Reader ready`, `Detecting finger contact`, `Finger detected`, `Contact timed out`, or `Capture failed`.
- When a scan ends in `no match`, the frontend can submit full name, mobile number, plan, and the captured fingerprint payload to PostgreSQL through `POST /api/members/register-from-scan`.

## Current Scope

- Reader status and fingerprint capture are live.
- PostgreSQL-backed member registration and member-directory reads are now wired in.
- The scanner card updates the inline member, non-member, and renew result previews after each live capture.
- Fingerprint matching is still demo-only. The current implementation stores the captured raw fingerprint artifact and capture payload, not a true DigitalPersona matcher template.
