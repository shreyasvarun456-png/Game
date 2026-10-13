const express = require('express');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const { Server } = require('socket.io');


function worldSolids(map) {
  const a=[];
  const add=(x,y,z,w,h,d)=>a.push({minX:x-w/2,maxX:x+w/2,minY:0,maxY:h,minZ:z-d/2,maxZ:z+d/2});
  add(0,4,-43,90,4,2);add(0,4,43,90,4,2);add(-43,4,0,2,4,90);add(43,4,0,2,4,90);
  for(let i=-2;i<=2;i++){const z=i*12;add(-10,2.8,z,8,2.8,4);add(10,2.8,z+4,8,2.8,4);add(i*8,2.2,z+6,3.2,2.2,3.2);add(i*7,4.8,z-8,8,4.8,3.8);}
  for(let i=0;i<14;i++){const x=(i%7-3)*11,z=(Math.floor(i/7)?1:-1)*31;add(x,2.2,z,5,2.2,2.5);}
  for(const side of [-1,1])for(let j=0;j<4;j++){const x=side*(20+j*3.5),z=(j%2?-1:1)*23;add(x,3.8,z,3.2,3.8,6);}
  if(map==='Desert'){for(let i=0;i<10;i++){const x=(i%5-2)*13,z=(i<5?-1:1)*29;add(x,1.5,z,3.8,1.5,3.8);}}
  if(map==='Factory'){for(const x of [-25,25])add(x,5,-20,4.4,5,4.4);}
  return a;
}
function segmentHitsBox(sx,sy,sz,dx,dy,dz,maxDistance,b) {
  let lo=0.05,hi=maxDistance;
  for(const [s,d,mn,mx] of [[sx,dx,b.minX,b.maxX],[sy,dy,b.minY,b.maxY],[sz,dz,b.minZ,b.maxZ]]) {
    if(Math.abs(d)<1e-8){if(s<mn||s>mx)return false;continue;}
    let t1=(mn-s)/d,t2=(mx-s)/d;if(t1>t2)[t1,t2]=[t2,t1];
    lo=Math.max(lo,t1);hi=Math.min(hi,t2);if(lo>hi)return false;
  }
  return hi>=0.05&&lo<=maxDistance;
}
function blockedByWorld(room,sx,sy,sz,dx,dy,dz,range) {
  return worldSolids(room.map).some(b=>segmentHitsBox(sx,sy,sz,dx,dy,dz,range,b));
}
function insideWorldSolid(map,x,z,radius=0.62) {
  return worldSolids(map).some(b=>x+radius>b.minX&&x-radius<b.maxX&&z+radius>b.minZ&&z-radius<b.maxZ);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });
const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));
const rooms = new Map();
const MAX_PLAYERS = 10;
const MATCH_TARGET = 30;
const MAPS = new Set(['Harbor', 'Desert', 'Factory']);
const TAG_TOOLS = {
  Pulse: { interval: 190, tagPower: 34, range: 65 },
  Arc: { interval: 115, tagPower: 18, range: 55 },
  Nova: { interval: 330, tagPower: 65, range: 29 }
};

app.get('/health', (_req, res) => res.json({ ok: true, game: 'Shadow Ops Energy Tag', rooms: rooms.size }));
app.get('/api/status', (_req, res) => res.json({ ok: true, rooms: rooms.size, players: [...rooms.values()].reduce((n, r) => n + r.players.size, 0) }));

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do { code = Array.from({length: 5}, () => alphabet[crypto.randomInt(alphabet.length)]).join(''); } while (rooms.has(code));
  return code;
}
function cleanName(value) {
  return String(value || 'Rookie').replace(/[<>\\u0000-\\u001f]/g, '').trim().slice(0, 16) || 'Rookie';
}
function makeRoom(hostId, data) {
  const code = makeCode();
  const room = { code, hostId, privateRoom: !data || data.privateRoom !== false, map: MAPS.has(data && data.map) ? data.map : 'Harbor', status: 'lobby', players: new Map(), score: { blue: 0, red: 0 }, feed: [] };
  rooms.set(code, room);
  return room;
}
function currentRoom(socket) { return rooms.get(socket.data.roomCode); }
function counts(room) {
  let blue = 0, red = 0;
  for (const p of room.players.values()) { if (p.team === 'blue') blue++; else red++; }
  return { blue, red };
}
function spawnFor(team, index) {
  return { x: team === 'blue' ? -20 + (index % 2) * 2 : 20 - (index % 2) * 2, y: 1.7, z: ((index % 5) - 2) * 3.4 };
}
function publicPlayer(p) {
  return { id: p.id, name: p.name, team: p.team, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, hp: p.hp, kills: p.kills, deaths: p.deaths, alive: p.alive, ready: p.ready, tool: p.tool, skin: p.skin };
}
function snapshot(room) {
  return { code: room.code, privateRoom: room.privateRoom, map: room.map, status: room.status, hostId: room.hostId, players: [...room.players.values()].map(publicPlayer), score: room.score, target: MATCH_TARGET, maxPlayers: MAX_PLAYERS, feed: room.feed.slice(-6) };
}
function broadcast(room) { io.to(room.code).emit('roomState', snapshot(room)); }
function say(room, text) {
  room.feed.push({ text: String(text).slice(0, 110), at: Date.now() });
  room.feed = room.feed.slice(-12);
  io.to(room.code).emit('feed', room.feed[room.feed.length - 1]);
}
function leave(socket) {
  const room = currentRoom(socket);
  if (!room) { socket.data.roomCode = null; return; }
  const old = room.players.get(socket.id);
  room.players.delete(socket.id);
  socket.leave(room.code);
  socket.data.roomCode = null;
  if (old) say(room, old.name + ' left the room');
  if (room.hostId === socket.id) room.hostId = room.players.keys().next().value || null;
  if (!room.players.size) rooms.delete(room.code);
  else broadcast(room);
}
function join(socket, room, rawName) {
  if (!room) return socket.emit('notice', { type: 'error', text: 'Room not found. Check the invite code.' });
  if (room.status === 'playing') return socket.emit('notice', { type: 'error', text: 'That match has started. Ask the host to make a new room.' });
  if (room.players.size >= MAX_PLAYERS) return socket.emit('notice', { type: 'error', text: 'Room is full (10/10).' });
  if (currentRoom(socket)) leave(socket);
  const c = counts(room);
  const team = c.blue <= c.red ? 'blue' : 'red';
  const index = [...room.players.values()].filter(p => p.team === team).length;
  const spawn = spawnFor(team, index);
  const name = cleanName(rawName);
  const player = { id: socket.id, name, team, ...spawn, yaw: team === 'blue' ? -Math.PI / 2 : Math.PI / 2, pitch: 0, hp: 100, kills: 0, deaths: 0, alive: true, ready: false, tool: 'Pulse', skin: 'default', lastPulse: 0, lastMove: Date.now() };
  room.players.set(socket.id, player);
  if (!room.hostId) room.hostId = socket.id;
  socket.data.roomCode = room.code;
  socket.data.playerName = name;
  socket.join(room.code);
  socket.emit('joinedRoom', { selfId: socket.id, room: snapshot(room) });
  say(room, name + ' joined the squad');
  broadcast(room);
}
function respawn(room, p) {
  const teammates = [...room.players.values()].filter(x => x.team === p.team);
  const pos = spawnFor(p.team, Math.max(0, teammates.findIndex(x => x.id === p.id)));
  p.x = pos.x; p.y = pos.y; p.z = pos.z; p.hp = 100; p.alive = true;
  broadcast(room);
}
io.on('connection', socket => {
  socket.data.roomCode = null;
  socket.on('createRoom', data => {
    const room = makeRoom(socket.id, data || {});
    join(socket, room, data && data.name);
    socket.emit('notice', { type: 'success', text: 'Room created. Send the code to your friends!' });
  });
  socket.on('joinRoom', data => {
    const code = String(data && data.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    join(socket, rooms.get(code), data && data.name);
  });
  socket.on('quickPlay', data => {
    let room = [...rooms.values()].find(r => !r.privateRoom && r.status === 'lobby' && r.players.size < MAX_PLAYERS);
    if (!room) room = makeRoom(null, { privateRoom: false, map: data && data.map });
    join(socket, room, data && data.name);
  });
  socket.on('leaveRoom', () => leave(socket));
  socket.on('ready', value => {
    const room = currentRoom(socket), p = room && room.players.get(socket.id);
    if (!p || room.status !== 'lobby') return;
    p.ready = !!value; broadcast(room);
  });
  socket.on('setMap', map => {
    const room = currentRoom(socket);
    if (!room || room.hostId !== socket.id || room.status !== 'lobby' || !MAPS.has(map)) return;
    room.map = map; broadcast(room);
  });
  socket.on('selectLoadout', data => {
    const room = currentRoom(socket), p = room && room.players.get(socket.id);
    if (!p || !data) return;
    if (TAG_TOOLS[data.tool]) p.tool = data.tool;
    if (typeof data.skin === 'string' && /^[a-z0-9_-]{1,24}$/i.test(data.skin)) p.skin = data.skin;
    broadcast(room);
  });
  socket.on('startMatch', () => {
    const room = currentRoom(socket);
    if (!room || room.hostId !== socket.id || room.status !== 'lobby') return;
    if (!room.players.size) return socket.emit('notice', { type: 'error', text: 'Join the room first.' });
    room.status = 'playing'; room.score = { blue: 0, red: 0 };
    for (const p of room.players.values()) {
      p.kills = 0; p.deaths = 0; p.hp = 100; p.alive = true;
      const ix = [...room.players.values()].filter(q => q.team === p.team).findIndex(q => q.id === p.id);
      Object.assign(p, spawnFor(p.team, ix));
    }
    say(room, 'MATCH STARTED — first team to 30 eliminations wins!');
    io.to(room.code).emit('matchStarted', snapshot(room));
    broadcast(room);
  });
  socket.on('returnToLobby', () => {
    const room = currentRoom(socket);
    if (!room || !['playing', 'ended'].includes(room.status)) return;
    room.status = 'lobby'; room.score = { blue: 0, red: 0 };
    for (const p of room.players.values()) { p.ready = false; p.alive = true; p.hp = 100; }
    say(room, 'The squad returned to the lobby');
    broadcast(room);
    io.to(room.code).emit('returnedToLobby', snapshot(room));
  });
  socket.on('move', data => {
    const room = currentRoom(socket), p = room && room.players.get(socket.id);
    if (!p || room.status !== 'playing' || !p.alive || !data) return;
    const x = Number(data.x), z = Number(data.z), yaw = Number(data.yaw), pitch = Number(data.pitch);
    if (![x,z,yaw,pitch].every(Number.isFinite)) return;
    const nx = Math.max(-40, Math.min(40, x)), nz = Math.max(-40, Math.min(40, z));
    if (insideWorldSolid(room.map, nx, nz)) return;
    const dt = Math.max(0.03, Math.min(0.25, (Date.now() - p.lastMove) / 1000));
    const maxStep = 18 * dt + 2;
    const dx = nx - p.x, dz = nz - p.z, dist = Math.hypot(dx, dz);
    if (dist > maxStep) { p.x += dx * maxStep / dist; p.z += dz * maxStep / dist; } else { p.x = nx; p.z = nz; }
    p.y = Number(data.y) > 2.2 ? 2.8 : 1.7;
    p.yaw = yaw; p.pitch = Math.max(-1.25, Math.min(1.25, pitch)); p.lastMove = Date.now();
  });
  socket.on('tagPulse', data => {
    const room = currentRoom(socket), shooter = room && room.players.get(socket.id);
    if (!room || room.status !== 'playing' || !shooter || !shooter.alive || !data || !data.dir) return;
    const cfg = TAG_TOOLS[shooter.tool] || TAG_TOOLS.Pulse, now = Date.now();
    if (now - shooter.lastPulse < cfg.interval) return;
    shooter.lastPulse = now;
    const ray = { x: Number(data.dir.x), y: Number(data.dir.y), z: Number(data.dir.z) };
    if (![ray.x,ray.y,ray.z].every(Number.isFinite)) return;
    const len = Math.hypot(ray.x,ray.y,ray.z) || 1; ray.x/=len; ray.y/=len; ray.z/=len;
    let target = null, best = Infinity;
    for (const t of room.players.values()) {
      if (t.id === shooter.id || t.team === shooter.team || !t.alive) continue;
      const vx = t.x - shooter.x, vy = 1.1, vz = t.z - shooter.z;
      const along = vx*ray.x + vy*ray.y + vz*ray.z;
      if (along <= 0 || along > cfg.range) continue;
      const miss = Math.hypot(vx-ray.x*along, vy-ray.y*along, vz-ray.z*along);
      if (miss < 1.35 && along < best && !blockedByWorld(room, shooter.x, shooter.y || 1.7, shooter.z, ray.x, ray.y, ray.z, along)) { target = t; best = along; }
    }
    io.to(room.code).emit('pulseFx', { id: shooter.id, x: shooter.x, y: shooter.y, z: shooter.z, dir: ray, hitId: target && target.id, at: now });
    if (!target) return;
    target.hp -= cfg.tagPower;
    io.to(room.code).emit('tagHit', { shooterId: shooter.id, targetId: target.id, hp: Math.max(0, target.hp) });
    if (target.hp <= 0) {
      target.alive = false; target.deaths++; shooter.kills++; room.score[shooter.team]++;
      say(room, shooter.name + ' eliminated ' + target.name);
      broadcast(room);
      io.to(room.code).emit('tagOut', { shooterId: shooter.id, targetId: target.id, score: room.score });
      if (room.score[shooter.team] >= MATCH_TARGET) {
        room.status = 'ended';
        io.to(room.code).emit('matchEnded', { winner: shooter.team, score: room.score });
        broadcast(room);
      } else {
        const code = room.code, targetId = target.id;
        setTimeout(() => { const r = rooms.get(code), pl = r && r.players.get(targetId); if (r && pl && r.status === 'playing') respawn(r, pl); }, 2200);
      }
    } else broadcast(room);
  });
  socket.on('disconnect', () => leave(socket));
});

setInterval(() => {
  for (const room of rooms.values()) if (room.status === 'playing') broadcast(room);
}, 90);

server.listen(PORT, '0.0.0.0', () => console.log('Shadow Ops FPS listening on ' + PORT));
