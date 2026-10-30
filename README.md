# FOURFALL — Two-player online Connect Four

**Fourfall** is a fully playable multiplayer browser game built with Node.js and browser JavaScript. It has **zero external npm dependencies**. You can play with someone on a different device through one public URL and a six-character room code.

## Assignment requirements

| Requirement | Where implemented |
|---|---|
| Two people can join from different devices | `/api/create`, `/api/join`, public host, and shareable `/?room=ABC234` invite |
| Recognizable rules | Clear on-screen instructions, 7 columns × 6 rows, gravity, alternating turns, 4-in-a-row wins, draw detection |
| Public URL | Deploy the Node.js web service on Render as described below |

Other features: two-minute reconnect grace period, scoreboard, rematches that require *both* players' consent, mobile-responsive UI, keyboard keys 1–7, and server-side move validation.

## 1. Requirements on Windows

- Windows 10/11, PowerShell 7 and a modern browser.
- Node.js 22 or newer, preferably the current LTS release.
- For publishing: free GitHub and Render accounts and optionally Git and GitHub CLI.

Install software (PowerShell; commands only need to run if the software is missing):

```powershell
winget install --id Microsoft.PowerShell -e
winget install --id OpenJS.NodeJS.LTS -e
# For publishing to GitHub:
winget install --id Git.Git -e
winget install --id GitHub.cli -e
```

Close and reopen the terminal after installation so the new commands are available. Check:

```powershell
pwsh --version
node --version
git --version
gh --version
```

## 2. Unzip and run

Download `Fourfall_Multiplayer_Game.zip` from ChatGPT. Use the actual downloaded ZIP filename/path in the first command below.

```powershell
$GamePath = Join-Path $HOME 'MultiplayerGame'
New-Item -ItemType Directory -Path $GamePath -Force | Out-Null
Expand-Archive -LiteralPath (Join-Path $HOME 'Downloads\Fourfall_Multiplayer_Game.zip') -DestinationPath $GamePath -Force
Set-Location $GamePath
pwsh -NoProfile -ExecutionPolicy Bypass -File .\TEST_GAME.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File .\RUN_GAME.ps1
```

Leave the server terminal open. Open `http://localhost:3000` in a browser. **Do not use localhost as your public assignment URL**: people outside your computer cannot access it.

Test a second browser on the same computer: create a room in your first browser window, then open its copied invite link in an **Incognito/Private** window (or use another device). Two different identities are required.

Test from another device on the same Wi-Fi: find your computer's IPv4 address:

```powershell
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.AddressState -eq 'Preferred' -and $_.IPAddress -notmatch '^(127\.|169\.254\.)' } |
  Select-Object IPAddress, InterfaceAlias
```

Open `http://YOUR_COMPUTER_IP:3000` on the other device. If Windows Firewall blocks this, allow `node.exe` on **Private** networks when Windows asks. An administrator can optionally add a private-network-only rule:

```powershell
New-NetFirewallRule -DisplayName 'Fourfall Local 3000' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000 -Profile Private
```

Only use that firewall rule for a trusted private LAN. This is optional and unnecessary after online deployment. Do **not** open router port forwarding to your computer for this assignment.

## 3. Upload the game to GitHub

1. Create a GitHub account at https://github.com/ (if needed).
2. Install `Git.Git` and `GitHub.cli` using `winget` above.
3. Configure your own Git name and email (change the sample values):

```powershell
git config --global user.name 'Your Name'
git config --global user.email 'your-github-email@example.com'
```

4. From your unzipped game folder, run:

```powershell
Set-Location (Join-Path $HOME 'MultiplayerGame')
pwsh -NoProfile -ExecutionPolicy Bypass -File .\PUBLISH_GITHUB.ps1
```

The script signs in with GitHub CLI when necessary, initializes Git, commits all game files, and creates a **public** repository on your GitHub account. Your source code is public, but **room tokens are not stored in the repository**. To create a private repository instead, add `-Private`.

To select a different repository name, add `-RepositoryName 'my-new-game'`.

## 4. Deploy publicly with Render

The game needs a persistent Node.js web service to coordinate live players. A static-only website will not work.

1. Open https://dashboard.render.com/ and sign in.
2. Select **New → Web Service**.
3. Choose **Build and deploy from a Git repository**, connect your GitHub account, and select the repository from Step 3.
4. Enter these settings:

| Render setting | Value |
|---|---|
| Name | `fourfall-multiplayer` (or any available name) |
| Language | `Node` |
| Branch | `main` |
| Build command | `npm ci` |
| Start command | `npm start` |
| Instance type | `Free`, if offered |
| Health check path | `/health` (if requested) |
| Environment variable | `NODE_VERSION=24` (optional if Render already uses a supported LTS version) |

5. Select **Deploy Web Service**. After the deployment shows **Live**, open the actual `https://...onrender.com` link Render assigns to your service.
6. On the live site, create a room and use **Copy invite link** to send the URL to another person in a different location. They enter their name and select **Join room**.

**Alternative:** Use Render's **New → Blueprint** and point it at this repo. The included `render.yaml` already declares the correct Node web service.

Render's Free service might sleep after 15 minutes without inbound traffic, then take time to resume. **Rooms and scores are in memory** and do not survive restart, redeployment, or spin-down. This is fine for a class/demo project; use paid always-on hosting and durable storage for a permanent game.

## 5. Test checklist

- [ ] `TEST_GAME.ps1` reports all tests passed.
- [ ] Open the local game and create a room with Player 1.
- [ ] Join that room as Player 2 from a separate private window or device.
- [ ] Player 2 sees moves almost instantly after Player 1 plays.
- [ ] Playing out of turn is rejected.
- [ ] Four connected discs produce a win and increment the score.
- [ ] Both players agree to a rematch and the next round begins.
- [ ] Both players can open the **actual hosted HTTPS URL** while on different networks.
- [ ] Copy the public URL as evidence of completing the assignment.

## 6. Common problems

| Symptom | Fix |
|---|---|
| `node is not recognized` | Install Node.js LTS and reopen PowerShell. |
| `.ps1 cannot be loaded` | Use `pwsh -NoProfile -ExecutionPolicy Bypass -File .\RUN_GAME.ps1` (only for this script). |
| `EADDRINUSE` or port 3000 busy | Close the previous Node server or run `pwsh -File .\RUN_GAME.ps1 -Port 3001`. |
| Other phone cannot open `localhost` | Use the PC's LAN IP or a Render public link; localhost is private to each device. |
| Friend sees "room not found" | Both must open the *same hosted service*; room codes from the local server do not carry over to Render. |
| Room full | Only two players can join; create another room. |
| Game paused | Give the disconnected player up to 2 minutes to reconnect with the same browser tab. |
| Render shows a loading page | The Free service may be spinning up from inactivity; reload when available. |
| Rooms disappear after deployment | In-memory state resets whenever the server restarts. |

## 7. Project files

- `server.js` — Node HTTP server, room management, real-time events, move authorization.
- `game.js` — pure Connect Four rules engine.
- `public/index.html` — game layout and instructions.
- `public/styles.css` — mobile-ready visual design.
- `public/app.js` — game controls, realtime updates, invites.
- `tests/*.test.js` — gameplay and HTTP/SSE integration tests.
- `RUN_GAME.ps1` — Windows PowerShell launcher.
- `TEST_GAME.ps1` — tests on Windows.
- `PUBLISH_GITHUB.ps1` — GitHub publishing helper.
- `render.yaml` — optional Render Blueprint deployment configuration.

## Follow-up prompt for ChatGPT

> I'm building my Fourfall multiplayer game. I have the source code, and I am using Windows 11, PowerShell 7, Node.js, GitHub, and Render. Help me test the actual game, analyze any PowerShell error or Render deploy log I paste, and give precise copy-paste commands and the minimum code changes needed. Preserve two-player separate-device support, clear rules, working turns/win detection, and a publicly accessible HTTPS URL. Do not claim deployment is successful until we have tested the real URL.

## Technical notes

Node.js serves both the frontend and backend. Browsers receive game updates using **Server-Sent Events (SSE)** and send their moves with normal HTTP `POST` requests. The server always validates player identity, the current turn, the selected column, and game completion. Each player's randomly generated token is stored in that browser tab's session storage, never in the invite link. SSE uses a query token that the host platform may log; for a high-security production system, replace this simple demo authentication with an account/session implementation. There is no account login, database, chat, or payments integration.
