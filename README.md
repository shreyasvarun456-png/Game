# SHADOW OPS — Energy Tag Arena

A browser-based 3D team arena with private invite-code rooms, live Alpha/Bravo rosters, a host Play button, map selection, Ready statuses, operator skins, pulse-tag devices, shield-based tag-outs, respawns, and score-to-30 matches. Includes on-screen touch controls for iPad.

## Published site

GitHub Actions publishes the static browser client to GitHub Pages at:

https://shreyasvarun456-png.github.io/Game/

The client connects to the online Socket.IO backend at https://shadow-ops-fps.onrender.com. GitHub Pages hosts static assets only; the Render Node service runs realtime rooms and game state.

## Automatic publishing

Every push to `main` runs JavaScript syntax checks and a backend HTTP/Socket.IO smoke test. If these pass, GitHub Actions deploys the `public/` directory to GitHub Pages. Render is also connected to this repository and auto-deploys Node server changes.

## Controls

Desktop: WASD to move, click the arena to use mouse-look, click to send a pulse, Space to jump, Shift to sprint.

 iPad: use the on-screen D-pad, drag the Look zone, and hold TAG.

## Notes

This is a playable prototype. Room data and scores are stored in memory and reset when the server restarts. The public Render free service can sleep during inactivity. Three.js is loaded from a public CDN. Add persistent accounts, moderation, rate limits, and more robust anti-cheat before a public launch.
