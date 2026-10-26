# METRO ROYALE: EXTRACTION — Online Alpha

A browser-first 2D extraction-survival prototype with a Node.js WebSocket room server.

## Features
- Lobby with map and difficulty selection
- Local solo raid with simple AI opponents, loot containers and extraction
- Rooms with five-character invite codes, up to four players
- Live player position and health updates over WebSockets
- Squad chat, host-controlled settings and raid start
- Local browser save for credits, level, evacuations and stash
- `GET /health` status endpoint

## Run locally
Requirements: Node.js 20+
```sh
npm install
npm start
``
Open http://localhost:3000. The WebSocket endpoint is `/ws`.

## Render deployment
Create a Node web service pointing at this repository, branch `main`, region Frankfurt:
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/health`
- Plan: Free for early testing

Render assigns `PORT` automatically; the server listens on `0.0.0.0`.

## Current prototype limitations
This is an online-room alpha, not a production multiplayer game. The server owns room membership and relays/clamps player position updates. AI, shooting damage, loot and extraction are still simulated on each browser, so combat outcomes are not authoritative or fully synchronized between players. Room state is kept in memory and resets when the service restarts. Do not use it for real accounts, purchases or valuable persistent data.

## Controls
Desktop: WASD / arrow keys to move, Space or E to interact, mouse click or FIRE to shoot.
Mobile: on-screen directional buttons, FIRE and LOOT / EXIT.
