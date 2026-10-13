# SHADOW OPS FPS

A browser-based 3D first-person shooter starter with realtime Socket.IO multiplayer, private invite-code rooms, balanced Alpha/Bravo teams, a host Play button, readiness, maps, weapon selection, basic demo-credit armory, mobile touch controls, kills/deaths, and score-to-30 team deathmatch.

## Deploy
This is a Node web service, not a static-only site. GitHub Pages cannot run the Socket.IO server.

- Render service: runtime Node, build command \`npm install\`, start command \`npm start\`, health path \`/health\`, region Singapore.
- GitHub Actions workflow runs syntax checks and a live HTTP smoke test on each push. It can also trigger a Render deployment if the repository secret \`RENDER_DEPLOY_HOOK\` is added.
- On Render, open the service Settings and create a Deploy Hook. In GitHub, open Settings → Secrets and variables → Actions → New repository secret, name it \`RENDER_DEPLOY_HOOK\`, paste the hook URL, and save.
- Free Render web services can sleep when inactive. The first visit may take a bit to wake.

## Controls
Desktop: WASD to move, mouse to look, click to fire, Space to jump, Shift to sprint.
iPad: use the on-screen D-pad, drag the Look zone, and hold FIRE.

This is a playable prototype, not a finished commercial game. Rooms and stats are in memory and reset if the server restarts. Three.js loads from a public CDN. Add stronger authoritative movement/collision, anti-cheat, moderation, persistent accounts, and production security before public launch.