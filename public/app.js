import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { clone as cloneSkeleton } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/utils/SkeletonUtils.js';

const socket = typeof io === 'function' ? io(
  location.hostname === 'localhost' ||
  location.hostname === '127.0.0.1' ||
  location.hostname.endsWith('.onrender.com')
    ? undefined
    : (window.SHADOW_MULTIPLAYER_SERVER || location.origin)
) : {
  connected: false,
  on() { return this; },
  emit() { return false; },
  connect() { return this; },
  disconnect() {}
};
const $ = id => document.getElementById(id);
const state = { selfId:null, room:null, view:'home', name:localStorage.getItem('shadowName')||'OPERATOR', tool:localStorage.getItem('shadowTool')||'Pulse', skin:localStorage.getItem('shadowSkin')||'default', credits:Number(localStorage.getItem('shadowCredits')||1200), ready:false };
let modalMode='create', quickStartRequested=false, quickStartTimer=null, toastTimer=null, scene=null, camera=null, renderer=null, clock=null, local={x:0,y:1.7,z:0,yaw:0,pitch:0,vy:0}, keys={}, remoteMeshes=new Map(), arenaBuilt=false, lastMoveAt=0, lastPulseAt=0, lookPointer=null, lookStart=null, movePointer=null, touchMove={x:0,z:0}, isJumping=false, gameActive=false, tagHeld=false, toolMesh=null, mapBuilt='', thirdPerson=false, localAvatar=null, killCount=0, deathCount=0, operatorTemplate=null, heroRenderer=null, heroScene=null, heroCamera=null, heroModel=null, muzzlePoint=null, muzzleFlash=null, muzzleLight=null, magazineMesh=null, ammoInMag=30, reserveAmmo=120, isReloading=false, reloadStarted=0, reloadDuration=1250, reloadTimer=null, recoilKick=0, aiming=false, arenaColliders=[], streakCount=0, practiceBots=[], backroomsActive=false, backroomsCooldown=0, sniperToolMesh=null, sniperMuzzlePoint=null, renderLoopId=0;

$('operator-pill').textContent=state.name;
$('callsign').value=state.name;
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2600);}
function showView(name){state.view=name;['home','lobby','armory','game'].forEach(v=>$(v+'-view').classList.toggle('hidden',v!==name));window.scrollTo(0,0);}
function updateNetwork(){const good=socket.connected;$('network-label').textContent=good?'ONLINE / LINK STABLE':'OFFLINE / RETRYING';$('network-label').style.color=good?'#c8fa69':'#ff646b';document.querySelector('.network i').style.background=good?'#c8fa69':'#ff646b';document.querySelector('.network i').style.color=good?'#c8fa69':'#ff646b';$('reconnect-button')?.classList.toggle('net-online',good);}
async function checkConnection(){updateNetwork();try{const base=window.SHADOW_MULTIPLAYER_SERVER||location.origin;const response=await fetch(base.replace(/\/$/,'')+'/health',{cache:'no-store'});if(!response.ok)throw new Error('HTTP '+response.status);const data=await response.json();toast(data.ok?'SERVER ONLINE · '+(data.rooms??0)+' ACTIVE ROOMS':'Server responded, but health check failed.');}catch(error){toast('SERVER UNREACHABLE — reconnect or use Practice vs Bots.');}if(!socket.connected)socket.connect();setTimeout(updateNetwork,900);}
socket.on('connect',()=>{updateNetwork();const code=new URLSearchParams(location.search).get('room')||location.hash.replace('#','');if(code&&code.length===5&& !state.room){$('join-code').value=code.toUpperCase();openModal('join');}});
socket.on('disconnect',()=>updateNetwork());socket.on('connect_error',()=>updateNetwork());
socket.on('notice',n=>toast(n.text));
socket.on('joinedRoom',d=>{state.selfId=d.selfId;state.room=d.room;state.ready=false;localStorage.setItem('shadowName',state.name);renderRoom();showView('lobby');closeModal();updateUrl();if(quickStartRequested){quickStartRequested=false;clearTimeout(quickStartTimer);socket.emit('startMatch');}});
socket.on('roomState',r=>{if(!state.room||state.room.code===r.code){state.room=r;renderRoom();syncPlayers(r);if(r.status==='lobby'&&state.view==='game')showView('lobby');}});
socket.on('feed',f=>{if(state.view==='game')addFeed(f.text);});
socket.on('matchStarted',r=>{state.room=r;localPlayer();renderRoom();launchGame();});
socket.on('returnedToLobby',r=>{state.room=r;gameActive=false;$('map-vote').classList.add('hidden');$('game-message').classList.add('hidden');showView('lobby');renderRoom();});
socket.on('matchEnded',d=>{if(state.room)state.room.status='ended';gameActive=false;$('game-message-title').textContent=d.winner===myTeam()?'VICTORY':'MATCH OVER';$('game-message-text').textContent='ALPHA '+d.score.blue+' — BRAVO '+d.score.red+'. Vote for the next map below.';$('map-vote').classList.remove('hidden');$('map-vote-status').textContent='Voting closes in '+(d.voteSeconds||15)+' seconds.';$('game-message').classList.remove('hidden');});
socket.on('mapVoteUpdate',d=>{const votes=d.votes||{};$('map-vote-status').textContent='Votes — '+Object.entries(votes).map(([m,n])=>m+': '+n).join(' · ');});
socket.on('tagHit',d=>{if(d.targetId===state.selfId){$('hp-value').textContent=d.hp;$('hp-bar').style.width=d.hp+'%';}});
socket.on('tagOut',d=>{if(d.targetId===state.selfId){deathCount++;streakCount=0;$('death-count').textContent=deathCount;toast('ELIMINATED — STREAK RESET');addFeed('YOU WERE ELIMINATED');}if(d.shooterId===state.selfId){killCount++;streakCount++;$('kill-count').textContent=killCount;toast('ELIMINATION +1');addFeed('ENEMY ELIMINATED  +1');if(streakCount>=3&&!localStorage.getItem('ownedArc')){localStorage.setItem('ownedArc','1');toast('3 STREAK: ARC TAGGER UNLOCKED');}if(streakCount>=5&&!localStorage.getItem('ownedNova')){localStorage.setItem('ownedNova','1');toast('5 STREAK: NOVA TAGGER UNLOCKED');}if(streakCount>=8&&!localStorage.getItem('ownedCyan')){localStorage.setItem('ownedCyan','1');toast('8 STREAK: CYAN WEAPON SKIN UNLOCKED');}}});
socket.on('pulseFx',d=>{if(!scene)return;const start=new THREE.Vector3(d.x,d.y,d.z);const end=start.clone().add(new THREE.Vector3(d.dir.x,d.dir.y,d.dir.z).multiplyScalar(d.hitId?Math.min(25,Math.hypot(d.x,d.z)+8):10));const geo=new THREE.BufferGeometry().setFromPoints([start,end]);const line=new THREE.Line(geo,new THREE.LineBasicMaterial({color:d.hitId?'#ff6fe5':'#65f4e0',transparent:true,opacity:.75}));scene.add(line);setTimeout(()=>{scene&&scene.remove(line);geo.dispose();line.material.dispose();},90);});

function updateUrl(){const url=new URL(location.href);if(state.room)url.searchParams.set('room',state.room.code);else url.searchParams.delete('room');history.replaceState(null,'',url.pathname+url.search);}
function openModal(mode){modalMode=mode;$('modal').classList.remove('hidden');$('callsign').value=state.name;$('join-code').classList.toggle('hidden',mode!=='join');$('code-label').classList.toggle('hidden',mode!=='join');$('create-map').parentElement && ($('create-map').style.display=mode==='join'?'none':'');$('private-check').parentElement.style.display=mode==='create'?'flex':'none';$('modal-title').innerHTML=mode==='join'?'JOIN THE <em>SQUAD</em>':mode==='quick'?'QUICK <em>MATCH</em>':'CREATE A <em>ROOM</em>';$('modal-copy').textContent=mode==='join'?'Enter the five-character invite code from your friend.':mode==='quick'?'Find or open a public room for team deathmatch.':'Choose your callsign and deployment map.';$('modal-confirm').textContent=mode==='join'?'JOIN ROOM →':mode==='quick'?'FIND MATCH →':'CREATE ROOM →';}
function closeModal(){$('modal').classList.add('hidden');}
function getName(){state.name=$('callsign').value.trim().slice(0,16)||'OPERATOR';localStorage.setItem('shadowName',state.name);$('operator-pill').textContent=state.name;return state.name;}
function createRoom(){if(!socket.connected){socket.connect();checkConnection();return toast('Private rooms need the online server. Reconnecting now — try CREATE ROOM again when ONLINE.');}state.name=getName();socket.emit('createRoom',{name:state.name,map:$('create-map').value,privateRoom:$('private-check').checked});}
function joinRoom(){if(!socket.connected)return toast('Connecting to server — try again in a moment.');state.name=getName();const code=$('join-code').value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5);if(code.length!==5)return toast('Enter the 5-character room code.');socket.emit('joinRoom',{name:state.name,code});}
function renderRoom(){if(!state.room)return;const r=state.room;$('room-code').textContent=r.code;$('roster-count').textContent=String(r.players.length).padStart(2,'0')+'/10';$('lobby-map').value=r.map;$('lobby-map').disabled=r.hostId!==state.selfId||r.status!=='lobby';$('start-match').disabled=r.hostId!==state.selfId||r.status!=='lobby';$('start-match').style.opacity=$('start-match').disabled?'.48':'1';$('start-match').innerHTML=r.hostId===state.selfId?'▶ &nbsp; PLAY <b>→</b>':'WAITING FOR HOST';const self=r.players.find(p=>p.id===state.selfId);state.ready=!!(self&&self.ready);$('ready-button').textContent=state.ready?'✓ READY — CLICK TO UNREADY':"✓ I'M READY";$('ready-button').classList.toggle('primary',state.ready);$('roster').innerHTML='';const sorted=[...r.players].sort((a,b)=>a.team.localeCompare(b.team));for(let i=0;i<10;i++){const p=sorted[i];const el=document.createElement('div');el.className='player-row '+(p?p.team:'');if(p)el.innerHTML='<div class="player-avatar">'+escapeHtml(p.name.slice(0,2).toUpperCase())+'</div><div class="player-info"><b>'+escapeHtml(p.name)+(p.id===r.hostId?' ★':'')+'</b><small>'+(p.team==='blue'?'ALPHA SQUAD':'BRAVO SQUAD')+' · '+escapeHtml(p.tool||'PULSE')+'</small></div><span class="ready-status '+(p.ready?'':'wait')+'">'+(p.ready?'READY':'WAITING')+'</span>';else el.innerHTML='<div class="player-avatar">+</div><div class="player-info"><b>OPEN SLOT</b><small>SHARE CODE TO INVITE</small></div>'; $('roster').appendChild(el);}if(r.status==='playing'&&state.view==='lobby')launchGame();}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function myTeam(){return state.room?.players.find(p=>p.id===state.selfId)?.team||'blue';}
function addNameTag(model,name,team){const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;const ctx=canvas.getContext('2d');ctx.clearRect(0,0,512,128);ctx.fillStyle=team==='blue'?'rgba(20,55,76,.88)':'rgba(72,29,28,.88)';ctx.beginPath();ctx.roundRect(18,18,476,92,12);ctx.fill();ctx.strokeStyle=team==='blue'?'#69baff':'#ff646b';ctx.lineWidth=5;ctx.stroke();ctx.font='bold 42px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#ffffff';ctx.fillText(String(name||'OPERATOR').slice(0,18).toUpperCase(),256,64);const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;const mat=new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false});const tag=new THREE.Sprite(mat);tag.position.set(0,2.35,0);tag.scale.set(2.0,.5,1);tag.renderOrder=5;model.add(tag);model.userData.nameTag=tag;}function syncPlayers(r){if(!scene||!r)return;const ids=new Set(r.players.filter(p=>p.id!==state.selfId).map(p=>p.id));for(const [id,m] of remoteMeshes)if(!ids.has(id)){scene.remove(m);remoteMeshes.delete(id);}for(const p of r.players){if(p.id===state.selfId){if($('hp-value'))$('hp-value').textContent=p.hp;if($('hp-bar'))$('hp-bar').style.width=p.hp+'%';if($('score-blue'))$('score-blue').textContent=r.score.blue;if($('score-red'))$('score-red').textContent=r.score.red;continue;}let m=remoteMeshes.get(p.id);if(!m){m=makeOperator(p.team,p.skin);addNameTag(m,p.name,p.team);scene.add(m);remoteMeshes.set(p.id,m);m.position.set(p.x,0,p.z);}m.userData.targetPosition||(m.userData.targetPosition=new THREE.Vector3());m.userData.targetPosition.set(p.x,0,p.z);m.userData.targetYaw=p.yaw||0;m.visible=p.alive!==false;}}
function addFeed(text){const e=document.createElement('div');e.textContent=text;$('killfeed').prepend(e);while($('killfeed').children.length>4)$('killfeed').lastChild.remove();setTimeout(()=>e.remove(),5000);}

function openArmory(){renderArmory();showView('armory');}
function renderArmory(){ $('credit-count').textContent=state.credits;const items=[{name:'PULSE',type:'TAG DEVICE',cost:0,owned:true,art:'╱▰━━╸',desc:'All-round pulse tagger. Stable and reliable.'},{name:'SNIPER',type:'TAG DEVICE',cost:0,owned:true,art:'╱▰━━━━━━╸',desc:'Free precision rifle with 4× scope and long-range shots.'},{name:'ARC',type:'TAG DEVICE',cost:450,owned:state.tool==='Arc'||localStorage.getItem('ownedArc')==='1',art:'╱▰━━╸',desc:'Rapid arc pulses recharge quickly.'},{name:'NOVA',type:'TAG DEVICE',cost:650,owned:state.tool==='Nova'||localStorage.getItem('ownedNova')==='1',art:'╱▰▰━╸',desc:'A charged pulse for close-range tag-outs.'},{name:'RECON',type:'SKIN',cost:0,owned:true,art:'⬟',desc:'Standard issue tactical kit.'},{name:'ARCTIC',type:'SKIN',cost:300,owned:state.skin==='arctic'||localStorage.getItem('ownedArctic')==='1',art:'⬟',desc:'Low-visibility pale field camo.'},{name:'EMBER',type:'SKIN',cost:300,owned:state.skin==='ember'||localStorage.getItem('ownedEmber')==='1',art:'⬟',desc:'High contrast red operator style.'},{name:'CYAN',type:'WEAPON SKIN',cost:650,owned:localStorage.getItem('ownedCyan')==='1',art:'╱▰━━╸',desc:'Bright cyan finish for your field kit.'},{name:'GOLD',type:'WEAPON SKIN',cost:900,owned:localStorage.getItem('ownedGold')==='1',art:'╱▰━━╸',desc:'A warm metallic finish for your field kit.'}];$('armory-grid').innerHTML='';items.forEach(item=>{const id=item.name.toLowerCase();const el=document.createElement('article');el.className='armory-item';el.innerHTML='<div class="armory-art">'+item.art+'</div><span class="eyebrow">'+item.type+'</span><h3>'+item.name+'</h3><p>'+item.desc+'</p><button class="btn '+(item.owned?'owned':'primary')+'" data-buy="'+id+'">'+(item.owned?'OWNED / EQUIP':('◈ '+item.cost+' CREDITS'))+'</button>';el.querySelector('button').onclick=()=>buyItem(item);$('armory-grid').appendChild(el);});}
function makeOperator(team,skin){if(operatorTemplate)return detailedOperator(team,skin);const g=new THREE.Group();g.userData.limbs=[];g.userData.walkPhase=0;const cloth=skin==='arctic'?0xc8c8bb:skin==='ember'?0x725147:team==='blue'?0x4c5946:0x665044;const mat=new THREE.MeshStandardMaterial({color:cloth,roughness:.72,metalness:.08});const dark=new THREE.MeshStandardMaterial({color:0x252720,roughness:.9});const trimMatAvatar=new THREE.MeshStandardMaterial({color:team==='red'?0xc05d4c:0x91a2a2,metalness:.22,roughness:.65});const armor=new THREE.MeshStandardMaterial({color:0x373b32,roughness:.8,metalness:.12});const visorMat=new THREE.MeshStandardMaterial({color:team==='red'?0xff564d:0x63d9ff,emissive:team==='red'?0x5c0907:0x07334c,emissiveIntensity:.65,metalness:.35,roughness:.25});const head=new THREE.Mesh(new THREE.SphereGeometry(.235,16,12),dark);head.position.y=1.57;g.add(head);const helmet=new THREE.Mesh(new THREE.SphereGeometry(.285,16,10,0,Math.PI*2,0,Math.PI*.60),armor);helmet.position.y=1.69;g.add(helmet);const helmetRim=new THREE.Mesh(new THREE.CylinderGeometry(.27,.28,.055,16),dark);helmetRim.position.y=1.64;g.add(helmetRim);const visor=new THREE.Mesh(new THREE.BoxGeometry(.30,.065,.055),visorMat);visor.position.set(0,1.63,-.218);g.add(visor);
const helmetMount=new THREE.Mesh(new THREE.BoxGeometry(.10,.10,.20),dark);helmetMount.position.set(0,1.86,-.02);g.add(helmetMount);
const helmetSideL=new THREE.Mesh(new THREE.CylinderGeometry(.065,.065,.08,10),dark);helmetSideL.rotation.z=Math.PI/2;helmetSideL.position.set(-.27,1.64,0);g.add(helmetSideL);
const helmetSideR=helmetSideL.clone();helmetSideR.position.x=.27;g.add(helmetSideR);const torso=new THREE.Mesh(new THREE.BoxGeometry(.66,.72,.40),mat);torso.position.y=1.02;g.add(torso);const vest=new THREE.Mesh(new THREE.BoxGeometry(.52,.48,.43),armor);vest.position.set(0,1.05,-.012);g.add(vest);for(const side of [-1,1]){const arm=new THREE.Mesh(new THREE.CapsuleGeometry(.115,.38,4,8),mat);arm.position.set(side*.42,1.03,-.02);arm.rotation.z=side*.13;g.add(arm);g.userData.limbs.push({mesh:arm,kind:'arm',side,base:arm.rotation.x});const leg=new THREE.Mesh(new THREE.CapsuleGeometry(.13,.42,4,8),dark);leg.position.set(side*.17,.40,0);g.add(leg);g.userData.limbs.push({mesh:leg,kind:'leg',side,base:leg.rotation.x});const boot=new THREE.Mesh(new THREE.BoxGeometry(.23,.13,.34),armor);boot.position.set(side*.17,.1,-.06);g.add(boot);}const belt=new THREE.Mesh(new THREE.BoxGeometry(.56,.12,.43),dark);belt.position.set(0,.72,0);g.add(belt);
const pack=new THREE.Mesh(new THREE.BoxGeometry(.4,.48,.2),dark);pack.position.set(0,1.12,.25);g.add(pack);
const packTop=new THREE.Mesh(new THREE.BoxGeometry(.30,.10,.22),armor);packTop.position.set(0,1.38,.25);g.add(packTop);
for(let side of [-1,1]){
 const magazine=new THREE.Mesh(new THREE.BoxGeometry(.11,.25,.09),dark);magazine.position.set(side*.12,.89,-.245);magazine.rotation.x=-.12;g.add(magazine);
 const glove=new THREE.Mesh(new THREE.SphereGeometry(.105,10,8),dark);glove.position.set(side*.42,.76,-.11);g.add(glove);
 const elbow=new THREE.Mesh(new THREE.SphereGeometry(.14,10,8),armor);elbow.position.set(side*.43,.91,-.03);g.add(elbow);
}
const chestRig=new THREE.Mesh(new THREE.BoxGeometry(.40,.26,.055),dark);chestRig.position.set(0,1.18,-.24);g.add(chestRig);
for(let i=0;i<3;i++){const mag=new THREE.Mesh(new THREE.BoxGeometry(.075,.16,.04),trimMatAvatar);mag.position.set((i-1)*.12,1.16,-.278);mag.castShadow=true;g.add(mag);}
const neck=new THREE.Mesh(new THREE.CylinderGeometry(.105,.12,.13,12),dark);neck.position.set(0,1.43,0);g.add(neck);
const chestPlate=new THREE.Mesh(new THREE.BoxGeometry(.39,.29,.07),armor);chestPlate.position.set(0,1.14,-.25);g.add(chestPlate);
for(let side of [-1,1]){
 const strapDetail=new THREE.Mesh(new THREE.BoxGeometry(.055,.48,.035),trimMatAvatar);strapDetail.position.set(side*.22,1.13,-.267);strapDetail.rotation.z=side*.09;g.add(strapDetail);
 const thigh=new THREE.Mesh(new THREE.BoxGeometry(.24,.18,.29),mat);thigh.position.set(side*.17,.49,-.015);g.add(thigh);
 const bootToe=new THREE.Mesh(new THREE.BoxGeometry(.19,.10,.16),dark);bootToe.position.set(side*.17,.085,-.19);g.add(bootToe);
 const kneeStrap=new THREE.Mesh(new THREE.BoxGeometry(.25,.045,.29),trimMatAvatar);kneeStrap.position.set(side*.17,.36,-.13);g.add(kneeStrap);
}

const shoulderRadio=new THREE.Mesh(new THREE.BoxGeometry(.13,.17,.11),dark);shoulderRadio.position.set(-.25,1.32,.01);g.add(shoulderRadio);
const radioAntenna=new THREE.Mesh(new THREE.CylinderGeometry(.012,.012,.28,6),dark);radioAntenna.position.set(-.28,1.52,.02);radioAntenna.rotation.z=-.10;g.add(radioAntenna);
const kneePadMaterial=armor;
const pouchMat=new THREE.MeshStandardMaterial({color:team==='red'?0x4c2826:0x202b2a,roughness:.94});

for(const side of [-1,1]){
 const shoulder=new THREE.Mesh(new THREE.BoxGeometry(.25,.20,.37),armor);shoulder.position.set(side*.39,1.27,-.01);shoulder.rotation.z=side*.12;shoulder.castShadow=true;g.add(shoulder);
 const knee=new THREE.Mesh(new THREE.BoxGeometry(.27,.24,.31),armor);knee.position.set(side*.17,.40,-.13);knee.castShadow=true;g.add(knee);
 const pouch=new THREE.Mesh(new THREE.BoxGeometry(.15,.17,.09),pouchMat);pouch.position.set(side*.14,.99,-.225);pouch.castShadow=true;g.add(pouch);
 const bootLace=new THREE.Mesh(new THREE.BoxGeometry(.15,.018,.015),trimMatAvatar);bootLace.position.set(side*.17,.13,-.255);g.add(bootLace);
}
const strap=new THREE.Mesh(new THREE.BoxGeometry(.09,.53,.045),dark);strap.position.set(.19,1.08,-.205);strap.rotation.z=-.22;g.add(strap);
const headset=new THREE.Mesh(new THREE.BoxGeometry(.48,.07,.10),dark);headset.position.set(0,1.76,.10);g.add(headset);
const mic=new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,.20,8),armor);mic.position.set(.22,1.49,-.15);mic.rotation.z=-.6;g.add(mic);
const avatarGunMetal=new THREE.MeshStandardMaterial({color:0x242b2d,metalness:.68,roughness:.36});const avatarGunPolymer=new THREE.MeshStandardMaterial({color:0x151b1d,metalness:.12,roughness:.6});
const rifle=new THREE.Group();
const rifleBody=new THREE.Mesh(new THREE.BoxGeometry(.12,.12,.52),avatarGunPolymer);rifleBody.position.set(.27,1.08,-.28);rifleBody.rotation.x=.12;rifle.add(rifleBody);
const rifleBarrel=new THREE.Mesh(new THREE.CylinderGeometry(.022,.022,.42,8),avatarGunMetal);rifleBarrel.rotation.x=Math.PI/2;rifleBarrel.position.set(.27,1.1,-.67);rifle.add(rifleBarrel);
const rifleStock=new THREE.Mesh(new THREE.BoxGeometry(.09,.10,.19),dark);rifleStock.position.set(.27,1.08,.04);rifle.add(rifleStock);
rifle.traverse(o=>{if(o.isMesh)o.castShadow=true;});g.add(rifle);
g.userData.team=team;g.userData.skin=skin;return g;}
function detailedOperator(team,skin){const root=new THREE.Group();const model=cloneSkeleton(operatorTemplate);model.scale.multiplyScalar(1.04);model.rotation.y=Math.PI;model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;if(o.material){o.material=o.material.clone();if(o.material.color)o.material.color.lerp(new THREE.Color(skin==='arctic'?0xc8d5d6:skin==='ember'?0x883e3e:team==='red'?0x853e39:0x3c6975),.18);}}});root.add(model);root.userData.team=team;root.userData.skin=skin;return root;}
function upgradeOperators(){if(!operatorTemplate||!scene)return;const upgrade=old=>{if(!old)return old;const n=detailedOperator(old.userData.team||'blue',old.userData.skin||'default');n.position.copy(old.position);n.rotation.copy(old.rotation);n.visible=old.visible;const tag=old.userData.nameTag;if(tag){old.remove(tag);n.add(tag);n.userData.nameTag=tag;}scene.remove(old);scene.add(n);return n;};localAvatar=upgrade(localAvatar);for(const [id,old] of remoteMeshes)remoteMeshes.set(id,upgrade(old));for(const bot of practiceBots)bot.mesh=upgrade(bot.mesh);}
function initHeroScene(template){const host=$('hero-render');if(!host||heroRenderer)return;try{heroScene=new THREE.Scene();heroScene.background=null;heroScene.fog=new THREE.Fog(0x17262b,12,38);heroCamera=new THREE.PerspectiveCamera(37,1,.1,100);heroCamera.position.set(4.5,2.6,7.8);heroCamera.lookAt(0,1.05,0);heroRenderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});heroRenderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.25));heroRenderer.outputColorSpace=THREE.SRGBColorSpace;heroRenderer.toneMapping=THREE.ACESFilmicToneMapping;heroRenderer.toneMappingExposure=1.05;heroRenderer.setClearColor(0x0b151a,0);host.appendChild(heroRenderer.domElement);host.classList.add('has-model');const hemi=new THREE.HemisphereLight(0xdcecf1,0x172126,2.0);heroScene.add(hemi);const key=new THREE.DirectionalLight(0xffe3c1,3.1);key.position.set(-4,9,5);heroScene.add(key);const rim=new THREE.DirectionalLight(0x6ee7dc,2.4);rim.position.set(5,4,-5);heroScene.add(rim);const ground=new THREE.Mesh(new THREE.PlaneGeometry(60,60),new THREE.MeshStandardMaterial({color:0x202c2e,roughness:.92,metalness:.08}));ground.rotation.x=-Math.PI/2;ground.position.y=-.04;heroScene.add(ground);const metal=new THREE.MeshStandardMaterial({color:0x35454a,roughness:.75,metalness:.2});const cargo=new THREE.MeshStandardMaterial({color:0x394e50,roughness:.82,metalness:.12});for(let i=0;i<5;i++){const crate=new THREE.Mesh(new THREE.BoxGeometry(2.4,2.1,2.4),i%2?metal:cargo);crate.position.set(-5.3+i*2.6,1.05,-4.6-(i%2)*1.5);heroScene.add(crate);for(let x=-.8;x<=.8;x+=.8){const rib=new THREE.Mesh(new THREE.BoxGeometry(.055,1.9,.055),metal);rib.position.set(crate.position.x+x,1.05,crate.position.z-1.22);heroScene.add(rib);}}const barriers=new THREE.Mesh(new THREE.BoxGeometry(12,.55,.45),metal);barriers.position.set(0,.28,2.5);heroScene.add(barriers);heroModel=cloneSkeleton(template);heroModel.scale.multiplyScalar(1.3);heroModel.position.set(.5,0,.2);heroModel.rotation.y=-.18;heroModel.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;if(o.material){o.material=o.material.clone();if(o.material.color)o.material.color.lerp(new THREE.Color(0x49666c),.12);}}});heroScene.add(heroModel);resizeHero();window.addEventListener('resize',resizeHero);const animate=()=>{requestAnimationFrame(animate);if(!heroRenderer||!heroScene)return;if(state.view==='home'){if(heroModel)heroModel.rotation.y=-.18+Math.sin(performance.now()*.00025)*.07;heroRenderer.render(heroScene,heroCamera);}};animate();}catch(e){console.warn('Hero preview unavailable',e);}}
function resizeHero(){if(!heroRenderer||!heroCamera)return;const host=$('hero-render');if(!host||!host.clientWidth||!host.clientHeight)return;heroRenderer.setSize(host.clientWidth,host.clientHeight,false);heroCamera.aspect=host.clientWidth/host.clientHeight;heroCamera.updateProjectionMatrix();}
function loadOperatorModel(){
  // Keep the procedural operator model in live gameplay. The external Soldier.glb
  // asset has been observed rendering at the wrong scale in some browsers/devices.
  // Do not assign operatorTemplate or swap active player/bot meshes after spawn.
  operatorTemplate=null;
  initHeroScene(makeOperator(myTeam(),'default'));
}
function makeGroundTexture(map){
 const c=document.createElement('canvas');c.width=c.height=512;const ctx=c.getContext('2d');
 const base=map==='Desert'?'#88765d':map==='Factory'?'#454846':map==='Docks'?'#565b50':'#52483a';
 ctx.fillStyle=base;ctx.fillRect(0,0,512,512);
 // Broad damp earth patches, wheel-worn lanes and scattered grit.
 for(let i=0;i<460;i++){const x=Math.random()*512,y=Math.random()*512,rx=4+Math.random()*38,ry=2+Math.random()*23;
  const v=Math.random()>.5?'rgba(20,19,16,':'rgba(174,151,117,';
  ctx.fillStyle=v+(0.025+Math.random()*.10)+')';ctx.beginPath();ctx.ellipse(x,y,rx,ry,Math.random()*Math.PI,0,Math.PI*2);ctx.fill();}
 for(let i=0;i<2800;i++){const v=Math.floor(35+Math.random()*105),alpha=.05+Math.random()*.22,size=.25+Math.random()*2.1;
  ctx.fillStyle='rgba('+v+','+Math.floor(v*.91)+','+Math.floor(v*.77)+','+alpha+')';
  ctx.fillRect(Math.random()*512,Math.random()*512,size,size);}
 if(map==='Harbor'){
  ctx.strokeStyle='rgba(18,17,15,.19)';ctx.lineWidth=5;
  for(const y of [214,244,274]){ctx.beginPath();ctx.moveTo(0,y);ctx.bezierCurveTo(130,y-12,350,y+16,512,y-6);ctx.stroke();}
  for(let i=0;i<750;i++){const x=Math.random()*512,y=Math.random()*512,r=.8+Math.random()*2.8;ctx.fillStyle=Math.random()>.5?'rgba(20,24,20,.30)':'rgba(178,157,122,.32)';ctx.beginPath();ctx.ellipse(x,y,r,r*.55,Math.random(),0,Math.PI*2);ctx.fill();}
 }else if(map!=='Desert'){
  ctx.strokeStyle='rgba(21,24,21,.20)';ctx.lineWidth=1;
  for(let i=0;i<34;i++){const x=Math.random()*512,y=Math.random()*512;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+Math.random()*30,y+Math.random()*10);ctx.stroke();}
 }
 const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;return tex;
}
function makeSkyTexture(map){
 const c=document.createElement('canvas');c.width=1024;c.height=512;const ctx=c.getContext('2d');
 const g=ctx.createLinearGradient(0,0,0,512);
 g.addColorStop(0,map==='Desert'?'#617b91':'#647f91');g.addColorStop(.48,map==='Desert'?'#b3b2a3':'#b0b3ad');g.addColorStop(1,'#d0b99b');ctx.fillStyle=g;ctx.fillRect(0,0,1024,512);
 for(let i=0;i<42;i++){const x=Math.random()*1024,y=40+Math.random()*270,rx=28+Math.random()*110,ry=5+Math.random()*24;
  const cloud=ctx.createRadialGradient(x,y,2,x,y,rx);cloud.addColorStop(0,'rgba(245,235,215,'+(.02+Math.random()*.055)+')');cloud.addColorStop(1,'rgba(245,235,215,0)');
  ctx.fillStyle=cloud;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill();}
 const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;return tex;
}
function addRuggedBattlefield(box,wallMat,trimMat,stripeMat,map){
 const dirtRock=new THREE.MeshStandardMaterial({color:0x62594c,roughness:.98,metalness:0});
 const darkRock=new THREE.MeshStandardMaterial({color:0x45433d,roughness:1});
 const sunRock=new THREE.MeshStandardMaterial({color:0x817361,roughness:1});
 const olive=new THREE.MeshStandardMaterial({color:0x384338,roughness:.97});
 const leafMat=new THREE.MeshStandardMaterial({color:0x394735,roughness:1});
 const dryGrass=new THREE.MeshStandardMaterial({color:0x857a50,roughness:1});
 const trunkMat=new THREE.MeshStandardMaterial({color:0x3e3329,roughness:1});
 const sandbagMat=new THREE.MeshStandardMaterial({color:0x77715b,roughness:1});
 const woodMat=new THREE.MeshStandardMaterial({color:0x514032,roughness:.94});
 const steel=new THREE.MeshStandardMaterial({color:0x363c3d,metalness:.55,roughness:.63});
 const rusty=new THREE.MeshStandardMaterial({color:0x594337,metalness:.25,roughness:.9});
 const rubber=new THREE.MeshStandardMaterial({color:0x171a19,roughness:.98});
 const rockGeo=new THREE.DodecahedronGeometry(1,1);
 const pos=rockGeo.attributes.position;
 for(let i=0;i<pos.count;i++){const f=.79+Math.random()*.39;pos.setXYZ(i,pos.getX(i)*f,pos.getY(i)*f,pos.getZ(i)*f);}
 rockGeo.computeVertexNormals();
 function rock(x,y,z,sx,sy,sz,mat=dirtRock,collide=false){
  const m=new THREE.Mesh(rockGeo,mat);m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.rotation.set((Math.random()-.5)*.2,Math.random()*Math.PI,(Math.random()-.5)*.16);m.castShadow=true;m.receiveShadow=true;scene.add(m);
  if(collide&&sx>.8)arenaColliders.push({minX:x-sx*.82,maxX:x+sx*.82,minZ:z-sz*.82,maxZ:z+sz*.82});
  return m;
 }
 function foliage(x,y,z,r){
  const g=new THREE.IcosahedronGeometry(r,1);const p=g.attributes.position;
  for(let i=0;i<p.count;i++){const f=.78+Math.random()*.45;p.setXYZ(i,p.getX(i)*f,p.getY(i)*f,p.getZ(i)*f);}g.computeVertexNormals();
  const m=new THREE.Mesh(g,leafMat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;scene.add(m);return m;
 }
 // Broken cliff line beyond the fight lane, with irregular boulders instead of a hard flat wall.
 for(let z=-25;z<=25;z+=2.6){if(Math.abs(z-8)<4.6)continue;const h=3.2+Math.random()*5.4,s=1.2+Math.random()*2.2;
  rock(37+Math.random()*2,h*.38,z+(Math.random()-.5)*1.4,s,h*.65,1.8+Math.random()*1.6,Math.random()>.5?dirtRock:darkRock,true);}
 for(let i=0;i<52;i++){
  const x=-9+Math.random()*44,z=(Math.random()>.5?1:-1)*(8+Math.random()*17);
  const s=.3+Math.random()*1.15;rock(x,s*.53,z,s*(.8+Math.random()),s*.55,s*(.8+Math.random()),Math.random()>.65?sunRock:dirtRock, s>1.0&&Math.random()>.45);
 }
 // A broken, muddy road remains open through the middle.
 // A softly worn path is painted into the procedural mud texture; no hard-edged overlay.
 // Tufts of grass: instanced so the scene stays light enough for an iPad.
 const grassGeo=new THREE.ConeGeometry(.045,.34,4);
 const grassGreen=new THREE.MeshStandardMaterial({color:0x4c5637,roughness:1,side:THREE.DoubleSide});
 const grassDry=new THREE.MeshStandardMaterial({color:0x8b805b,roughness:1,side:THREE.DoubleSide});
 for(const [material,count] of [[grassGreen,1150],[grassDry,680]]){
  const inst=new THREE.InstancedMesh(grassGeo,material,count);const dummy=new THREE.Object3D();
  for(let i=0;i<count;i++){const z=(Math.random()>.5?1:-1)*(2.8+Math.random()*19),x=-15+Math.random()*46;
   const scale=.35+Math.random()*1.65;dummy.position.set(x,.13*scale,z);dummy.rotation.set((Math.random()-.5)*.12,Math.random()*Math.PI,(Math.random()-.5)*.12);dummy.scale.set(.65+Math.random()*.6,scale,.65+Math.random()*.6);dummy.updateMatrix();inst.setMatrixAt(i,dummy.matrix);}
  inst.instanceMatrix.needsUpdate=true;inst.castShadow=false;inst.receiveShadow=true;scene.add(inst);
 }
 // Trees and snapped branches framing the scene.
 for(const [x,z] of [[2,-19],[13,-22],[24,-20],[31,20],[18,23],[3,20]]){
  const height=6+Math.random()*4;const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.2,.48,height,7),trunkMat);
  trunk.position.set(x,height/2,z);trunk.rotation.z=(Math.random()-.5)*.12;trunk.castShadow=true;scene.add(trunk);
  for(let b=0;b<3;b++){const branch=new THREE.Mesh(new THREE.CylinderGeometry(.055,.16,2.2,6),trunkMat);branch.position.set(x+(Math.random()-.5)*1.1,height*.55+b*.35,z+(Math.random()-.5)*1.2);branch.rotation.z=.55+(Math.random()-.5)*.5;branch.rotation.x=(Math.random()-.5)*.6;scene.add(branch);}
  foliage(x,height*.82,z,2.1+Math.random()*1.4);foliage(x-1,height*.72,z+.6,1.6);foliage(x+1,height*.77,z-.5,1.5);
 }
 // Sandbag nest on the left; flattened fabric bags, wooden braces and dark recess behind them.
 for(let row=0;row<3;row++){for(let i=0;i<7;i++){const bag=new THREE.Mesh(new THREE.SphereGeometry(.55,12,8),sandbagMat);bag.scale.set(1.05,.52,.62);bag.position.set(1.8+row*.48,.30+row*.42,-11+i*1.05+(row%2)*.45);bag.castShadow=true;bag.receiveShadow=true;scene.add(bag);}}
 box(3.05,1.35,-7.8,3.0,2.8,.22,woodMat,-.08);box(2.8,2.85,-7.8,3.3,.14,.28,steel);
 for(let z of [-11,-7.5,-4.2]){const post=new THREE.Mesh(new THREE.CylinderGeometry(.09,.13,2.7,7),woodMat);post.position.set(2.5,1.35,z);post.rotation.z=.04;post.castShadow=true;scene.add(post);}
 arenaColliders.push({minX:.8,maxX:3.8,minZ:-11.8,maxZ:-3.7});
 // A burned-out armored carrier on the right, with wheel hubs, sloped front plate and damaged roof.
 const hull=box(7,.95,9.2,5.8,1.55,2.75,rusty,-.16);hull.rotation.z=-.035;
 box(7.35,1.82,9.2,3.1,.55,2.45,steel,-.16);
 box(9.35,1.25,9.2,1.1,.48,2.5,rusty,-.16);
 box(5.2,1.35,9.2,1.5,.75,2.6,steel,-.16);
 for(const x of [5,6.4,7.9,9.2])for(const side of [-1,1]){
  const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.45,.45,.24,14),rubber);wheel.rotation.x=Math.PI/2;wheel.position.set(x,.48,9.2+side*1.37);wheel.castShadow=true;scene.add(wheel);
  const hub=new THREE.Mesh(new THREE.CylinderGeometry(.20,.20,.26,12),steel);hub.rotation.x=Math.PI/2;hub.position.set(x,.48,9.2+side*1.38);scene.add(hub);
 }
 for(let i=0;i<9;i++){const pipe=new THREE.Mesh(new THREE.CylinderGeometry(.025,.035,.9+Math.random()*.65,6),rusty);pipe.position.set(4.7+Math.random()*4,1.9+Math.random()*.5,8.1+Math.random()*2.2);pipe.rotation.z=(Math.random()-.5)*1.2;pipe.rotation.x=Math.random()*.5;scene.add(pipe);}
 arenaColliders.push({minX:4,maxX:10,minZ:7.4,maxZ:11.0});
 // Small drifting smoke puffs on the wreck, animated in the main frame loop.
 scene.userData.smokePuffs=[];
 const smokeGeo=new THREE.SphereGeometry(1,8,6);
 for(let i=0;i<17;i++){const mat=new THREE.MeshBasicMaterial({color:i%3===0?0x77776f:0xaaa69a,transparent:true,opacity:.12+Math.random()*.1,depthWrite:false});
  const puff=new THREE.Mesh(smokeGeo,mat);const baseX=6.5+(Math.random()-.5)*1.9,baseZ=8.9+(Math.random()-.5)*1.5,baseY=2.1+Math.random()*4.2;
  puff.position.set(baseX,baseY,baseZ);const sc=.22+Math.random()*.58;puff.scale.set(sc*1.2,sc,sc);puff.userData.smoke={baseX,baseY,baseZ,phase:Math.random()*6.28,scale:sc};scene.add(puff);scene.userData.smokePuffs.push(puff);}
 // Debris and a few muzzle-scarred barriers.
 for(let i=0;i<28;i++){const x=-1+Math.random()*28,z=(Math.random()>.5?1:-1)*(3+Math.random()*13);
  const debris=rock(x,.10+Math.random()*.15,z,.15+Math.random()*.28,.08+Math.random()*.13,.13+Math.random()*.28,Math.random()>.5?darkRock:sunRock,false);}
 // Distant haze and natural rock silhouettes.
 const hazeMat=new THREE.MeshStandardMaterial({color:0x8f897d,roughness:1});
 for(let z=-25;z<=25;z+=5){const ridge=rock(43,1+Math.random()*2.5,z,3+Math.random()*2,4+Math.random()*3,3.2,hazeMat,false);ridge.material=hazeMat;}
 if(map==='Docks'){
  const waterMat=new THREE.MeshStandardMaterial({color:0x465e61,roughness:.25,metalness:.08,transparent:true,opacity:.82});
  const water=new THREE.Mesh(new THREE.PlaneGeometry(100,100),waterMat);water.rotation.x=-Math.PI/2;water.position.set(0,-.04,30);scene.add(water);
 }
 if(map==='Desert'){
  const drySlope=new THREE.MeshStandardMaterial({color:0x88745d,roughness:1});for(let z=-23;z<=23;z+=5)rock(35,3+Math.random()*2,z,4,5,3,sunRock,false);
 }
 if(map==='Factory'){
  for(let z=-18;z<=18;z+=6){box(26,1.6,z,2.8,3.2,3.4,wallMat);box(26,3.3,z,.35,.12,3.5,trimMat);}
 }
}
function buildArena(){
 if(!scene)throw new Error('Scene not initialized');
 arenaColliders=[];remoteMeshes.clear();
 const map=state.room?.map||'Harbor';
 scene.background=new THREE.Color(0x9ca9aa);
 scene.fog=new THREE.Fog(0x9ca9aa,110,220);
 const hemi=new THREE.HemisphereLight(0xdbe6e8,0x403a30,1.8);scene.add(hemi);
 const sun=new THREE.DirectionalLight(0xffe0b5,2.35);sun.position.set(-24,38,18);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-58;sun.shadow.camera.right=58;sun.shadow.camera.top=58;sun.shadow.camera.bottom=-58;sun.shadow.camera.near=.5;sun.shadow.camera.far=120;sun.shadow.bias=-.00025;scene.add(sun);
 const dirtCanvas=document.createElement('canvas');dirtCanvas.width=dirtCanvas.height=512;const dctx=dirtCanvas.getContext('2d');
 const groundBase=map==='Desert'?'#88745d':map==='Factory'?'#555956':map==='Docks'?'#59635d':'#625a4c';dctx.fillStyle=groundBase;dctx.fillRect(0,0,512,512);
 for(let i=0;i<900;i++){const x=Math.random()*512,y=Math.random()*512,rx=3+Math.random()*28,ry=2+Math.random()*14;dctx.fillStyle=Math.random()>.5?'rgba(20,18,15,.10)':'rgba(190,168,132,.09)';dctx.beginPath();dctx.ellipse(x,y,rx,ry,Math.random()*3.14,0,Math.PI*2);dctx.fill();}
 for(let i=0;i<2400;i++){const v=35+Math.floor(Math.random()*95);dctx.fillStyle='rgba('+v+','+Math.floor(v*.92)+','+Math.floor(v*.79)+','+(.05+Math.random()*.18)+')';dctx.fillRect(Math.random()*512,Math.random()*512,.5+Math.random()*1.8,.5+Math.random()*1.8);}
 const dirtTexture=new THREE.CanvasTexture(dirtCanvas);dirtTexture.wrapS=dirtTexture.wrapT=THREE.RepeatWrapping;dirtTexture.repeat.set(6,6);dirtTexture.colorSpace=THREE.SRGBColorSpace;
 const floorMat=new THREE.MeshStandardMaterial({color:0xffffff,map:dirtTexture,roughness:1});
 const floor=new THREE.Mesh(new THREE.PlaneGeometry(120,120),floorMat);floor.rotation.x=-Math.PI/2;floor.position.y=-.06;floor.receiveShadow=true;scene.add(floor);
 const wallMat=new THREE.MeshStandardMaterial({color:0x454943,roughness:.96});
 const crateMat=new THREE.MeshStandardMaterial({color:0x665744,roughness:.93});
 const trimMat=new THREE.MeshStandardMaterial({color:0x77766a,roughness:.8});
 const concreteMat=new THREE.MeshStandardMaterial({color:0x77766a,roughness:.98});
 const darkMetal=new THREE.MeshStandardMaterial({color:0x292d2b,metalness:.55,roughness:.65});
 const foliageMat=new THREE.MeshStandardMaterial({color:0x414b38,roughness:1});
 const sandbagMat=new THREE.MeshStandardMaterial({color:0x77715c,roughness:1});
 const woodMat=new THREE.MeshStandardMaterial({color:0x514334,roughness:.96});
 const stripeMat=new THREE.MeshStandardMaterial({color:0x777052,roughness:1});
 function box(x,y,z,w,h,d,mat,rot=0){
  const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);o.position.set(x,y,z);o.rotation.y=rot;o.castShadow=true;o.receiveShadow=true;scene.add(o);
  if(y-h/2<3.4&&y+h/2>.55&&h>=1&&w>=.8&&d>=.8){const c=Math.abs(Math.cos(rot)),s=Math.abs(Math.sin(rot)),ex=(c*w+s*d)/2,ez=(s*w+c*d)/2;arenaColliders.push({minX:x-ex,maxX:x+ex,minZ:z-ez,maxZ:z+ez});}
  return o;
 }
 // Guaranteed visible cover in every map, laid out around a clear central lane.
 for(let side of [-1,1])for(let i=0;i<5;i++){
  const z=-20+i*10;box(side*14,1.2,z,3.5,2.4,4.5,crateMat,side*.035);box(side*25,.95,z+4,4.5,1.9,3.2,wallMat,side*.05);
 }
 box(-2,1.05,-8,5.2,2.1,1.2,crateMat);box(5,1.05,1,4.4,2.1,1.2,wallMat);box(-8,1.0,9,4.2,2,1.4,crateMat);
 // Buildings with recessed dark window bays, roof lips and concrete foundations.
 for(let side of [-1,1])for(let i=0;i<3;i++){const z=-15+i*15,x=side*34;box(x,2.6,z,2.5,5.2,8,wallMat);box(x,5.3,z,2.8,.2,8,trimMat);for(let wz of [-2.3,0,2.3]){const win=new THREE.Mesh(new THREE.BoxGeometry(.05,1.15,1.1),darkMetal);win.position.set(x-side*1.27,3.1,z+wz);scene.add(win);}box(x,0.18,z,3.1,.36,8.4,concreteMat);}
 // Sandbag fighting positions with individual fabric bags and staggered rows.
 for(const [cx,cz] of [[-8,-13],[12,13]])for(let row=0;row<2;row++)for(let i=0;i<6;i++){const bag=new THREE.Mesh(new THREE.SphereGeometry(.48,10,7),sandbagMat);bag.scale.set(1.05,.48,.62);bag.position.set(cx+row*.24,.25+row*.40,cz+i*.86+(row%2)*.4);bag.castShadow=true;bag.receiveShadow=true;scene.add(bag);}
 // Broken tree line and irregular low rocks along the edges, leaving combat lanes open.
 const rockGeo=new THREE.DodecahedronGeometry(1,1);
 for(let i=0;i<28;i++){const x=(Math.random()>.5?1:-1)*(20+Math.random()*17),z=-27+Math.random()*54,s=.35+Math.random()*1.2;const rock=new THREE.Mesh(rockGeo,i%3===0?concreteMat:crateMat);rock.position.set(x,s*.38,z);rock.scale.set(s*1.3,s*.7,s);rock.rotation.y=Math.random()*3.14;rock.castShadow=true;rock.receiveShadow=true;scene.add(rock);}
 for(const [x,z] of [[-25,-22],[-28,-6],[-26,14],[25,-19],[28,2],[26,22]]){const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.22,.4,4.2,7),woodMat);trunk.position.set(x,2.1,z);trunk.rotation.z=(Math.random()-.5)*.1;trunk.castShadow=true;scene.add(trunk);for(let j=0;j<3;j++){const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(1.8-j*.22,1),foliageMat);crown.position.set(x+(Math.random()-.5)*1.5,4.0+j*.65,z+(Math.random()-.5)*1.5);crown.scale.set(1.1,.85,1);crown.castShadow=true;scene.add(crown);}}
 // A damaged utility vehicle provides a recognizable battlefield landmark.
 const hull=new THREE.Mesh(new THREE.BoxGeometry(4.8,1.25,2.3),darkMetal);hull.position.set(7,.8,10);hull.rotation.y=-.18;hull.castShadow=true;hull.receiveShadow=true;scene.add(hull);
 const cabin=new THREE.Mesh(new THREE.BoxGeometry(2.2,.85,1.95),crateMat);cabin.position.set(7.35,1.75,10);cabin.rotation.y=-.18;cabin.castShadow=true;scene.add(cabin);
 for(const x of [5.3,6.7,8.2,9.4])for(const side of [-1,1]){const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.43,.43,.22,12),new THREE.MeshStandardMaterial({color:0x171918,roughness:1}));wheel.rotation.x=Math.PI/2;wheel.position.set(x,.45,10+side*1.12);wheel.castShadow=true;scene.add(wheel);}
 // Utility poles, cables and low haze establish depth without blocking movement.
 for(let i=-2;i<=2;i++){const pole=new THREE.Mesh(new THREE.CylinderGeometry(.12,.18,5,8),darkMetal);pole.position.set(i*15,2.5,-36);scene.add(pole);}
 // Keep optional art isolated: a failed decoration can never prevent the base map loading.
 try{if(typeof addRuggedBattlefield==='function')addRuggedBattlefield(box,wallMat,trimMat,stripeMat,map);}catch(e){console.warn('Optional terrain detail skipped',e);}
 try{if(typeof addBackroomsArea==='function')addBackroomsArea(box,wallMat,trimMat,stripeMat);}catch(e){console.warn('Optional secret area skipped',e);}
 // Environmental dressing: layered concrete seams, weather streaks, drains, fences and industrial fixtures.
 const seamConcrete=new THREE.MeshStandardMaterial({color:0x555b58,roughness:.98});
 const rustMetal=new THREE.MeshStandardMaterial({color:0x594b3c,metalness:.42,roughness:.82});
 const warningPaint=new THREE.MeshStandardMaterial({color:0xb09b57,roughness:.88});
 const glassDark=new THREE.MeshStandardMaterial({color:0x172426,metalness:.25,roughness:.22,emissive:0x071012});
 // Concrete expansion joints and worn painted lane markers.
 for(let z=-30;z<=30;z+=10){box(0,.012,z,112,.018,.055,seamConcrete);box(-2,.018,z+2,5,.025,.08,warningPaint,-.08);}
 // Corrugated warehouse wall panels and utility doors on the outer structures.
 for(const side of [-1,1])for(let k=0;k<7;k++){
  const z=-22+k*7.1,x=side*32.68;
  for(let rib=0;rib<5;rib++){const panel=new THREE.Mesh(new THREE.BoxGeometry(.045,3.3,.035),trimMat);panel.position.set(x,2.65,z-.95+rib*.43);panel.castShadow=true;scene.add(panel);}
  if(k%2===0){box(x-side*.04,1.45,z,.08,2.65,1.55,darkMetal);box(x-side*.10,1.48,z,.07,2.4,1.28,wallMat);box(x-side*.15,2.65,z,.04,.08,1.38,rustMetal);}
  const vent=new THREE.Mesh(new THREE.BoxGeometry(.08,.36,1.15),darkMetal);vent.position.set(x-side*.07,4.15,z);scene.add(vent);
  for(let sl=0;sl<4;sl++){const fin=new THREE.Mesh(new THREE.BoxGeometry(.10,.025,1.1),trimMat);fin.position.set(x-side*.13,4.02+sl*.075,z);scene.add(fin);}
 }
 // Industrial perimeter fencing: posts, rails and fine mesh panels.
 for(const side of [-1,1]){
  for(let z=-34;z<=34;z+=4){const post=new THREE.Mesh(new THREE.BoxGeometry(.12,2.35,.12),darkMetal);post.position.set(side*43,1.17,z);post.castShadow=true;scene.add(post);}
  for(const y of [.35,2.15]){const rail=new THREE.Mesh(new THREE.BoxGeometry(.055,.055,68),rustMetal);rail.position.set(side*43,y,0);scene.add(rail);}
  const meshMat=new THREE.MeshStandardMaterial({color:0x4c5551,metalness:.35,roughness:.8,wireframe:true});
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(68,1.72,34,8),meshMat);mesh.position.set(side*43,1.25,0);mesh.rotation.y=side*Math.PI/2;scene.add(mesh);
 }
 // Floodlight poles and lamps to create believable silhouettes and local highlights.
 for(const [x,z] of [[-42,-28],[42,-28],[-42,28],[42,28],[-18,34],[18,34]]){
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(.09,.15,7.5,8),darkMetal);pole.position.set(x,3.75,z);pole.castShadow=true;scene.add(pole);
  const arm=new THREE.Mesh(new THREE.BoxGeometry(1.15,.09,.11),darkMetal);arm.position.set(x+(x<0?.48:-.48),7.25,z);scene.add(arm);
  const lamp=new THREE.Mesh(new THREE.BoxGeometry(.48,.16,.34),trimMat);lamp.position.set(x+(x<0?.92:-.92),7.17,z);scene.add(lamp);
  const glow=new THREE.Mesh(new THREE.BoxGeometry(.34,.035,.23),new THREE.MeshStandardMaterial({color:0xffe4a8,emissive:0x5b4721,emissiveIntensity:.6}));glow.position.set(lamp.position.x,7.08,z);scene.add(glow);
 }
 // Drain grates and oil-dark patches near the wreck and cover.
 for(const [x,z] of [[-5,5],[14,-4],[2,15],[-17,-2]]){
  const grate=new THREE.Mesh(new THREE.BoxGeometry(2.2,.025,.75),darkMetal);grate.position.set(x,.012,z);scene.add(grate);
  for(let n=0;n<8;n++){const bar=new THREE.Mesh(new THREE.BoxGeometry(.035,.03,.68),trimMat);bar.position.set(x-1+n*.28,.03,z);scene.add(bar);}
 }
 // Add shallow roof-mounted ducts and exhaust pipes to break up the boxy silhouettes.
 for(const side of [-1,1])for(const z of [-15,15]){
  const duct=new THREE.Mesh(new THREE.BoxGeometry(1.05,.45,2.8),darkMetal);duct.position.set(side*34.1,5.35,z);scene.add(duct);
  for(let n=0;n<3;n++){const band=new THREE.Mesh(new THREE.BoxGeometry(1.12,.045,.07),rustMetal);band.position.set(side*34.1,5.18,z-.8+n*.8);scene.add(band);}
 }
 const gunMetal=new THREE.MeshStandardMaterial({color:0x242b2d,metalness:.78,roughness:.3});
const weaponFinish=localStorage.getItem('shadowWeaponSkin')||'standard';const gunPolymer=new THREE.MeshStandardMaterial({color:weaponFinish==='cyan'?0x18cbd0:weaponFinish==='gold'?0xc99b36:0x151b1d,metalness:weaponFinish==='gold' ? 0.72 : 0.15,roughness:weaponFinish==='gold' ? 0.3 : 0.58});
const gunEdge=new THREE.MeshStandardMaterial({color:0x465257,metalness:.7,roughness:.32});
const glassMat=new THREE.MeshStandardMaterial({color:0x152c30,metalness:.25,roughness:.14,transparent:true,opacity:.9,emissive:0x082326});
const gloveMat=new THREE.MeshStandardMaterial({color:0x202624,roughness:.92});
const sleeveMat=new THREE.MeshStandardMaterial({color:0x38443d,roughness:.96});
const seamMat=new THREE.MeshStandardMaterial({color:0x596057,roughness:1});
toolMesh=new THREE.Group();
function gunPart(geo,mat,x,y,z,rx=0,ry=0,rz=0){const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.castShadow=true;m.receiveShadow=true;toolMesh.add(m);return m;}
// Stock, receiver, handguard, barrel and muzzle.
gunPart(new THREE.BoxGeometry(.17,.14,.34),gunPolymer,.32,-.28,-.26);
gunPart(new THREE.BoxGeometry(.19,.16,.49),gunMetal,.32,-.28,-.59);
gunPart(new THREE.BoxGeometry(.155,.13,.39),gunPolymer,.32,-.275,-.91);
gunPart(new THREE.BoxGeometry(.18,.11,.07),gunEdge,.32,-.28,-.10);
gunPart(new THREE.BoxGeometry(.10,.12,.08),gunPolymer,.32,-.30,-.08);
gunPart(new THREE.BoxGeometry(.105,.235,.17),gunPolymer,.32,-.445,-.56,-.16);
gunPart(new THREE.BoxGeometry(.115,.20,.15),gunPolymer,.32,-.425,-.42,-.24);
gunPart(new THREE.CylinderGeometry(.034,.042,.48,14),gunMetal,.32,-.26,-1.17,Math.PI/2);
gunPart(new THREE.CylinderGeometry(.058,.058,.09,14),gunEdge,.32,-.26,-1.405,Math.PI/2);
gunPart(new THREE.BoxGeometry(.20,.035,.32),gunMetal,.32,-.188,-.90);
for(let z=-1.04;z<-.72;z+=.065){gunPart(new THREE.BoxGeometry(.164,.018,.027),gunEdge,.32,-.263,z);gunPart(new THREE.BoxGeometry(.018,.09,.025),gunEdge,.235,-.27,z);gunPart(new THREE.BoxGeometry(.018,.09,.025),gunEdge,.405,-.27,z);}
gunPart(new THREE.BoxGeometry(.075,.025,.60),gunEdge,.32,-.174,-.65);
 // More convincing rifle furniture: adjustable stock, raised sights, ejection port,
 // charging handle, selector, front sight tower, and a perforated handguard.
 gunPart(new THREE.BoxGeometry(.13,.12,.28),gunPolymer,.32,-.275,-.035);
 gunPart(new THREE.BoxGeometry(.095,.095,.10),gunEdge,.32,-.245,-.16);
 gunPart(new THREE.BoxGeometry(.045,.035,.14),gunMetal,.43,-.235,-.47);
 gunPart(new THREE.BoxGeometry(.065,.045,.12),gunEdge,.215,-.225,-.56);
 gunPart(new THREE.BoxGeometry(.035,.105,.04),gunMetal,.32,-.115,-1.08);
 gunPart(new THREE.BoxGeometry(.16,.035,.055),gunEdge,.32,-.17,-1.10);
 gunPart(new THREE.BoxGeometry(.065,.045,.07),gunMetal,.32,-.11,-.27);
 gunPart(new THREE.BoxGeometry(.035,.055,.045),gunEdge,.405,-.22,-.45);
 // Individual receiver pins and rail slots add readable metal detail at close range.
 for(const side of [-1,1]){
  for(const z of [-.42,-.58,-.73]){
   const pin=gunPart(new THREE.CylinderGeometry(.014,.014,.012,10),gunEdge,.32+side*.097,-.29,z,Math.PI/2);
  }
 }

gunPart(new THREE.BoxGeometry(.105,.07,.20),gunEdge,.32,-.125,-.88);
gunPart(new THREE.CylinderGeometry(.066,.066,.39,18),gunMetal,.32,-.075,-.86,Math.PI/2);
gunPart(new THREE.CylinderGeometry(.085,.085,.055,18),gunEdge,.32,-.075,-.68,Math.PI/2);
gunPart(new THREE.CylinderGeometry(.078,.078,.018,18),glassMat,.32,-.075,-.646,Math.PI/2);
gunPart(new THREE.CylinderGeometry(.075,.075,.045,18),gunEdge,.32,-.075,-1.045,Math.PI/2);
gunPart(new THREE.CylinderGeometry(.061,.061,.012,18),glassMat,.32,-.075,-1.071,Math.PI/2);
gunPart(new THREE.BoxGeometry(.13,.025,.10),gunPolymer,.32,-.16,-.86);

for(let z=-.91;z<-.37;z+=.065)gunPart(new THREE.BoxGeometry(.055,.014,.026),gunMetal,.32,-.154,z);
gunPart(new THREE.BoxGeometry(.105,.095,.17),gunPolymer,.32,-.105,-.62);
gunPart(new THREE.CylinderGeometry(.046,.046,.105,16),gunMetal,.32,-.101,-.63,Math.PI/2);
gunPart(new THREE.CylinderGeometry(.032,.032,.009,16),glassMat,.32,-.101,-.688,Math.PI/2);
gunPart(new THREE.BoxGeometry(.015,.055,.16),gunEdge,.418,-.26,-.61);
gunPart(new THREE.BoxGeometry(.018,.05,.095),gunPolymer,.424,-.25,-.57);
gunPart(new THREE.BoxGeometry(.10,.012,.15),gunEdge,.32,-.39,-.47);
gunPart(new THREE.BoxGeometry(.018,.115,.045),gunMetal,.39,-.46,-.48,-.12);
for(let i=0;i<3;i++)gunPart(new THREE.BoxGeometry(.125,.012,.018),gunEdge,.32,-.43-i*.032,-.61);
// First-person tactical sleeves and gloved hands.
function armSegment(a,b,r,mat){const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),d=B.clone().sub(A);const m=new THREE.Mesh(new THREE.CylinderGeometry(r*.78,r,d.length(),10),mat);m.position.copy(A).add(B).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());m.castShadow=true;toolMesh.add(m);return m;}
armSegment([.92,-.69,-.12],[.58,-.52,-.43],.105,sleeveMat);
armSegment([-.82,-.70,-.18],[.02,-.49,-.76],.115,sleeveMat);
armSegment([.80,-.63,-.22],[.69,-.56,-.32],.112,seamMat);
armSegment([-.62,-.62,-.34],[-.39,-.55,-.50],.118,seamMat);
function gloveHand(x,y,z,scale=1){const palm=new THREE.Mesh(new THREE.SphereGeometry(.105,12,9),gloveMat);palm.position.set(x,y,z);palm.scale.set(1.12,.72,1.28);palm.castShadow=true;toolMesh.add(palm);for(let i=0;i<4;i++){const finger=new THREE.Mesh(new THREE.CapsuleGeometry(.023,.085,3,6),gloveMat);finger.position.set(x+(i-1.5)*.042,y-.012,z-.075);finger.rotation.x=-.22;finger.rotation.z=(i-1.5)*.09;finger.scale.setScalar(scale);toolMesh.add(finger);}const thumb=new THREE.Mesh(new THREE.CapsuleGeometry(.025,.075,3,6),gloveMat);thumb.position.set(x+.095,y-.012,z-.005);thumb.rotation.z=-.82;toolMesh.add(thumb);}
gloveHand(.39,-.425,-.53);
gloveHand(.08,-.405,-.80,.88);
magazineMesh=gunPart(new THREE.BoxGeometry(.115,.215,.15),gunMetal,.32,-.445,-.69,-.13);
gunPart(new THREE.BoxGeometry(.125,.025,.16),gunPolymer,.32,-.555,-.69,-.13);
muzzlePoint=new THREE.Object3D();muzzlePoint.position.set(.32,-.26,-1.43);toolMesh.add(muzzlePoint);
muzzleFlash=new THREE.Group();muzzleFlash.visible=false;muzzleFlash.position.set(0,0,-.10);muzzlePoint.add(muzzleFlash);
const flashCore=new THREE.Mesh(new THREE.SphereGeometry(.07,8,6),new THREE.MeshBasicMaterial({color:0xfff1b1}));flashCore.scale.set(.8,.8,1.8);muzzleFlash.add(flashCore);
const flashCone=new THREE.Mesh(new THREE.ConeGeometry(.105,.28,8),new THREE.MeshBasicMaterial({color:0xffa342,transparent:true,opacity:.94,side:THREE.DoubleSide}));flashCone.rotation.x=-Math.PI/2;flashCone.position.z=-.13;muzzleFlash.add(flashCone);
const flashSide=new THREE.Mesh(new THREE.ConeGeometry(.05,.18,7),new THREE.MeshBasicMaterial({color:0xfff0b0,transparent:true,opacity:.85,side:THREE.DoubleSide}));flashSide.rotation.set(-Math.PI/2,0,.8);flashSide.position.z=-.11;muzzleFlash.add(flashSide);
muzzleLight=new THREE.PointLight(0xffb65d,0,5);muzzleLight.position.set(0,0,-.12);muzzlePoint.add(muzzleLight);
// Dedicated low-profile precision rifle model. Keep the hands attached to the camera so
// switching loadouts changes the actual visible weapon, not just the HUD label.
sniperToolMesh=new THREE.Group();
const sniperMetal=new THREE.MeshStandardMaterial({color:0x252d31,metalness:.78,roughness:.28});
const sniperPolymer=new THREE.MeshStandardMaterial({color:0x151a1d,metalness:.12,roughness:.62});
const sniperGlass=new THREE.MeshStandardMaterial({color:0x1a4247,metalness:.35,roughness:.15,emissive:0x07191d});
function sniperPart(geo,mat,x,y,z,rx=0,ry=0,rz=0){const part=new THREE.Mesh(geo,mat);part.position.set(x,y,z);part.rotation.set(rx,ry,rz);part.castShadow=true;part.receiveShadow=true;sniperToolMesh.add(part);return part;}
sniperPart(new THREE.BoxGeometry(.16,.15,.36),sniperPolymer,.32,-.30,-.29);
sniperPart(new THREE.BoxGeometry(.19,.17,.58),sniperMetal,.32,-.275,-.70);
sniperPart(new THREE.BoxGeometry(.15,.13,.38),sniperPolymer,.32,-.27,-1.05);
sniperPart(new THREE.CylinderGeometry(.037,.044,1.02,14),sniperMetal,.32,-.25,-1.38,Math.PI/2);
sniperPart(new THREE.CylinderGeometry(.062,.062,.105,14),sniperMetal,.32,-.25,-1.90,Math.PI/2);
sniperPart(new THREE.BoxGeometry(.11,.12,.22),sniperPolymer,.32,-.43,-.72,-.12);
sniperPart(new THREE.BoxGeometry(.10,.18,.20),sniperPolymer,.32,-.43,-1.00,-.17);
sniperPart(new THREE.BoxGeometry(.22,.04,.36),sniperMetal,.32,-.175,-.90);
sniperPart(new THREE.CylinderGeometry(.062,.062,.36,18),sniperMetal,.32,-.09,-.86,Math.PI/2);
sniperPart(new THREE.CylinderGeometry(.087,.087,.045,18),sniperMetal,.32,-.09,-.67,Math.PI/2);
sniperPart(new THREE.CylinderGeometry(.073,.073,.012,18),sniperGlass,.32,-.09,-.644,Math.PI/2);
sniperPart(new THREE.CylinderGeometry(.078,.078,.045,18),sniperMetal,.32,-.09,-1.045,Math.PI/2);
sniperPart(new THREE.CylinderGeometry(.061,.061,.012,18),sniperGlass,.32,-.09,-1.07,Math.PI/2);
sniperPart(new THREE.BoxGeometry(.09,.06,.12),sniperMetal,.32,-.17,-.86);
sniperPart(new THREE.BoxGeometry(.07,.10,.12),sniperPolymer,.32,-.12,-.58);
const sniperSleeve=new THREE.MeshStandardMaterial({color:0x37443e,roughness:.96});
const sniperGlove=new THREE.MeshStandardMaterial({color:0x1c2423,roughness:.9});
function sniperArm(a,b,r,mat){const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),d=B.clone().sub(A);const part=new THREE.Mesh(new THREE.CylinderGeometry(r*.78,r,d.length(),10),mat);part.position.copy(A).add(B).multiplyScalar(.5);part.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());part.castShadow=true;sniperToolMesh.add(part);}
sniperArm([.92,-.69,-.12],[.58,-.52,-.43],.105,sniperSleeve);
sniperArm([-.82,-.70,-.18],[.02,-.49,-.76],.115,sniperSleeve);
for(const [x,y,z] of [[.39,-.425,-.53],[.08,-.405,-.80]]){const hand=new THREE.Mesh(new THREE.SphereGeometry(.105,12,9),sniperGlove);hand.position.set(x,y,z);hand.scale.set(1.12,.72,1.28);sniperToolMesh.add(hand);}
sniperMuzzlePoint=new THREE.Object3D();sniperMuzzlePoint.position.set(.32,-.25,-1.94);sniperToolMesh.add(sniperMuzzlePoint);
sniperToolMesh.visible=false;
camera.add(toolMesh);camera.add(sniperToolMesh);scene.add(camera);for(const p of state.room?.players||[])if(p.id!==state.selfId){const m=makeOperator(p.team,p.skin);addNameTag(m,p.name,p.team);m.position.set(p.x,0,p.z);m.userData.targetPosition=new THREE.Vector3(p.x,0,p.z);m.userData.targetYaw=p.yaw||0;scene.add(m);remoteMeshes.set(p.id,m);}mapBuilt=map;}
function initRenderer(){const host=$('game-canvas');renderLoopId++;if(renderer){gameActive=false;renderer.dispose();host.innerHTML='';}scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(76,host.clientWidth/host.clientHeight||1,.1,250);camera.rotation.order='YXZ';renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.75));renderer.setSize(host.clientWidth||900,host.clientHeight||600);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;host.appendChild(renderer.domElement);renderer.domElement.setAttribute('aria-label','SHADOW OPS game view');clock=new THREE.Clock();localPlayer();buildArena();localAvatar=makeOperator(myTeam(),state.skin);scene.add(localAvatar);localAvatar.visible=thirdPerson;if(state.selfId==='practice-local')spawnPracticeBots();$('camera-toggle').textContent=thirdPerson?'VIEW: 3P':'VIEW: 1P';$('match-map-wrap').classList.toggle('hidden',state.selfId!=='practice-local');$('match-map').value=state.room?.map||'Harbor';gameActive=true;tick(renderLoopId);}
function localPlayer(){const p=state.room?.players.find(p=>p.id===state.selfId);if(p){local.x=p.x;local.y=p.y||1.7;local.z=p.z;local.yaw=p.yaw||0;local.pitch=p.pitch||0;}}
function beginQuickPlay(){state.name=getName();if(!socket.connected){startPractice();return;}state.room=null;quickStartRequested=true;socket.emit('quickPlay',{name:state.name,map:$('create-map').value||'Harbor'});closeModal();clearTimeout(quickStartTimer);quickStartTimer=setTimeout(()=>{if(quickStartRequested&&!state.room)startPractice();},5500);}
function leaveMatch(){gameActive=false;tagHeld=false;aiming=false;document.exitPointerLock?.();if(state.selfId==='practice-local'||!socket.connected){practiceBots.forEach(b=>{if(scene&&b.mesh)scene.remove(b.mesh);});practiceBots=[];state.room=null;state.selfId=null;updateUrl();showView('home');toast('You left the match.');return;}socket.emit('returnToLobby');$('game-message').classList.add('hidden');toast('Returning to squad lobby…');}
function startPractice(){quickStartRequested=false;clearTimeout(quickStartTimer);closeModal();practiceBots=[];backroomsActive=false;backroomsCooldown=0;state.selfId='practice-local';state.room={code:'TRAIN',privateRoom:false,map:$('create-map').value||'Harbor',status:'playing',hostId:'practice-local',players:[{id:'practice-local',name:state.name,team:'blue',x:-20,y:1.7,z:0,yaw:-Math.PI/2,pitch:0,hp:100,alive:true,ready:true,tool:state.tool,skin:state.skin}],score:{blue:0,red:0}};toast('BOT TRAINING — find the green glitch wall on the east-side warehouse to enter the Backrooms.');launchGame();}
function launchGame(){backroomsActive=false;backroomsCooldown=0;showView('game');$('game-message').classList.add('hidden');killCount=0;deathCount=0;streakCount=0;aiming=false;$('aim-toggle').textContent='AIM: OFF';$('aim-toggle').setAttribute('aria-pressed','false');ammoInMag=30;reserveAmmo=120;isReloading=false;clearTimeout(reloadTimer);recoilKick=0;updateAmmoHud();$('kill-count').textContent='0';$('death-count').textContent='0';thirdPerson=false;$('camera-toggle').textContent='VIEW: 1P';$('game-map-label').textContent=(state.room?.map||'Harbor').toUpperCase();$('match-map').value=state.room?.map||'Harbor';$('match-map-wrap').classList.toggle('hidden',state.selfId!=='practice-local');$('hud-tool').textContent=state.tool.toUpperCase();try{initRenderer();}catch(e){gameActive=false;console.error('SHADOW OPS startup failed:',e);const host=$('game-canvas');if(host){host.innerHTML='<div style="padding:24px;color:#fff;background:#171b1c;border:1px solid #ff646b;border-radius:12px;margin:12px;font:14px/1.5 system-ui"><b>MAP FAILED TO LOAD</b><br> '+String(e?.message||e).replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]))+'<br><br>Tap BASE, then try Practice again. If this repeats, send a screenshot of this error.</div>';}toast('Map startup failed — see the error in the game area.');}}
function tick(loopId=renderLoopId){if(!gameActive||!renderer||!scene||loopId!==renderLoopId)return;requestAnimationFrame(()=>tick(loopId));const dt=Math.min(clock.getDelta(),.05);if(keys.ShiftLeft||keys.ShiftRight){}let f=(keys.KeyW||keys.ArrowUp?1:0)-(keys.KeyS||keys.ArrowDown?1:0)-touchMove.z;let side=(keys.KeyD||keys.ArrowRight?1:0)-(keys.KeyA||keys.ArrowLeft?1:0)+touchMove.x;const speed=(keys.ShiftLeft||keys.ShiftRight?11:7.4)*dt;const dx=(-Math.sin(local.yaw)*f+Math.cos(local.yaw)*side)*speed;const dz=(-Math.cos(local.yaw)*f-Math.sin(local.yaw)*side)*speed;const nx=THREE.MathUtils.clamp(local.x+dx,-48,backroomsActive?92:48),nz=THREE.MathUtils.clamp(local.z+dz,-48,48);if(canOccupy(nx,local.z))local.x=nx;if(canOccupy(local.x,nz))local.z=nz;updateBackroomsTransition();if(keys.Space&&!isJumping){local.vy=6;isJumping=true;}local.vy-=18*dt;local.y+=local.vy*dt;if(local.y<1.7){local.y=1.7;local.vy=0;isJumping=false;}if(localAvatar){localAvatar.position.set(local.x,0,local.z);localAvatar.rotation.y=local.yaw;localAvatar.visible=thirdPerson;animateOperator(localAvatar,Math.abs(f)+Math.abs(side)>.12,dt);}for(const bot of practiceBots){if(bot.mesh?.visible)animateOperator(bot.mesh,!!bot.moving,dt);}if(thirdPerson){camera.position.set(local.x+Math.sin(local.yaw)*4.8,local.y+1.05,local.z+Math.cos(local.yaw)*4.8);camera.lookAt(local.x,1.15+local.pitch*1.8,local.z);}else{camera.position.set(local.x,local.y,local.z);camera.rotation.set(local.pitch,local.yaw,0,'YXZ');}const targetFov=aiming&&!thirdPerson?(state.tool==='Sniper'?16:22):76;const stage=$('game-stage');if(stage)stage.classList.toggle('scoped',aiming&&!thirdPerson);if(Math.abs(camera.fov-targetFov)>.1){camera.fov=THREE.MathUtils.lerp(camera.fov,targetFov,.22);camera.updateProjectionMatrix();}if(toolMesh){toolMesh.visible=!thirdPerson&&state.tool!=='Sniper';if(sniperToolMesh)sniperToolMesh.visible=!thirdPerson&&state.tool==='Sniper';const moving=Math.abs(f)+Math.abs(side)>.1;const bob=moving?Math.sin(performance.now()*.008)*.018:Math.sin(performance.now()*.003)*.004;const rp=isReloading?Math.min(1,(performance.now()-reloadStarted)/reloadDuration):0;toolMesh.position.y=-.03+bob-(isReloading?Math.sin(rp*Math.PI)*.13:0);toolMesh.position.z=-recoilKick+(isReloading?Math.sin(rp*Math.PI)*.14:0);toolMesh.rotation.x=isReloading?Math.sin(rp*Math.PI)*.62:0;recoilKick=Math.max(0,recoilKick-dt*.65);if(magazineMesh){const drop=isReloading&&rp>.27&&rp<.72?Math.sin((rp-.27)/.45*Math.PI)*.16:0;magazineMesh.position.y=-.445-drop;magazineMesh.rotation.x=-.13+drop*.45;}}const now=performance.now();if(now-lastMoveAt>70&&state.room?.status==='playing'){socket.emit('move',{x:local.x,y:local.y,z:local.z,yaw:local.yaw,pitch:local.pitch});lastMoveAt=now;}for(const m of remoteMeshes.values()){if(m.userData.targetPosition){m.position.lerp(m.userData.targetPosition,Math.min(1,dt*12));const dy=((m.userData.targetYaw||0)-m.rotation.y+Math.PI*3)%(Math.PI*2)-Math.PI;m.rotation.y+=dy*Math.min(1,dt*12);}}if(state.selfId==='practice-local')updatePracticeBots(dt,now);if(scene.userData.smokePuffs){for(const puff of scene.userData.smokePuffs){const p=puff.userData.smoke;if(p){puff.position.x=p.baseX+Math.sin(now*.00019+p.phase)*.24;puff.position.z=p.baseZ+Math.cos(now*.00017+p.phase)*.18;puff.position.y=p.baseY+(now*.00055+p.phase)%2.5;puff.material.opacity=.07+Math.max(0,Math.sin(now*.0003+p.phase))*.10;}}}if(tagHeld&&now-lastPulseAt>180)pulse();renderer.render(scene,camera);}
function animateOperator(model,moving,dt){const limbs=model?.userData?.limbs;if(!limbs)return;model.userData.walkPhase=(model.userData.walkPhase||0)+(moving?dt*10:dt*2);const swing=moving?Math.sin(model.userData.walkPhase)*.58:0;for(const limb of limbs){if(limb.kind==='leg')limb.mesh.rotation.x=limb.base+swing*limb.side;else limb.mesh.rotation.x=limb.base-swing*limb.side*.55;}model.position.y=moving?Math.abs(Math.sin(model.userData.walkPhase*2))*.035:0;}
function canOccupy(x,z){const r=.78;const maxX=backroomsActive?92:48;return x>-49&&x<maxX&&z>-49&&z<49&&!arenaColliders.some(c=>x+r>c.minX&&x-r<c.maxX&&z+r>c.minZ&&z-r<c.maxZ);}
function lineBlocked(ax,az,bx,bz){const distance=Math.hypot(bx-ax,bz-az),steps=Math.ceil(distance/.35);for(let i=1;i<steps;i++){const x=ax+(bx-ax)*i/steps,z=az+(bz-az)*i/steps;if(arenaColliders.some(c=>x>c.minX-.05&&x<c.maxX+.05&&z>c.minZ-.05&&z<c.maxZ+.05))return true;}return false;}
function addBackroomsArea(box,wallMat,trimMat,stripeMat){
 const floorMat=new THREE.MeshStandardMaterial({color:0xb7b47a,roughness:1});
 const wallMatYellow=new THREE.MeshStandardMaterial({color:0xc7c17b,roughness:.96});
 const stained=new THREE.MeshStandardMaterial({color:0xaaa76b,roughness:1});
 const ceilingMat=new THREE.MeshStandardMaterial({color:0xbdbb9b,roughness:.9});
 const backFloor=new THREE.Mesh(new THREE.PlaneGeometry(34,36),floorMat);backFloor.rotation.x=-Math.PI/2;backFloor.position.set(76,-.045,0);backFloor.receiveShadow=true;scene.add(backFloor);
 box(40,2.7,8,2,5.4,10,wallMat);
 const panel=new THREE.Mesh(new THREE.BoxGeometry(.08,2.4,2.1),new THREE.MeshStandardMaterial({color:0x6cbb88,emissive:0x275b3d,emissiveIntensity:1.1,roughness:.25}));panel.position.set(38.92,2.5,8);scene.add(panel);
 const glitch=new THREE.Mesh(new THREE.BoxGeometry(.12,2.8,2.5),new THREE.MeshBasicMaterial({color:0xd6ff9d,transparent:true,opacity:.22,side:THREE.DoubleSide}));glitch.position.set(38.82,2.5,8);scene.add(glitch);
 const addWall=(x,y,z,w,h,d,mat=wallMatYellow)=>{const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;scene.add(o);if(h>1)arenaColliders.push({minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2});return o;};
 addWall(59.5,3,-10.5,1,6,15);addWall(59.5,3,10.5,1,6,15);
 addWall(76,3,-18,34,6,.8);addWall(76,3,18,34,6,.8);addWall(92.5,3,0,1,6,36);
 addWall(70,1.8,-8,.45,3.6,12,stained);addWall(82,1.8,8,.45,3.6,12,stained);
 addWall(86,1.8,-5,9,3.6,.45,stained);addWall(67,1.8,7,8,3.6,.45,stained);
 const ceiling=new THREE.Mesh(new THREE.PlaneGeometry(34,36),ceilingMat);ceiling.rotation.x=Math.PI/2;ceiling.position.set(76,6,0);scene.add(ceiling);
 for(const [x,z] of [[66,0],[76,-12],[85,2],[76,12]]){const fixture=new THREE.Mesh(new THREE.BoxGeometry(2.8,.12,.65),new THREE.MeshStandardMaterial({color:0xf3f0c6,emissive:0xe5e2a7,emissiveIntensity:1.3}));fixture.position.set(x,5.88,z);scene.add(fixture);const light=new THREE.PointLight(0xffedaa,3.2,15);light.position.set(x,5.2,z);scene.add(light);}
 for(let i=0;i<18;i++){const stain=new THREE.Mesh(new THREE.PlaneGeometry(.7+Math.random()*1.7,.5+Math.random()*1.2),new THREE.MeshBasicMaterial({color:0x77794d,transparent:true,opacity:.12,side:THREE.DoubleSide}));stain.position.set(61+Math.random()*29,.08,-16+Math.random()*32);stain.rotation.x=-Math.PI/2;scene.add(stain);}
}
function spawnBackroomsEnemies(){if(state.selfId!=='practice-local'||!scene)return;[[72,-3],[84,4]].forEach((p,i)=>{const mesh=makeOperator('red',i?'ember':'default');addNameTag(mesh,'BACKROOMS ENTITY '+(i+1),'red');mesh.position.set(p[0],0,p[1]);mesh.visible=false;scene.add(mesh);practiceBots.push({id:'backrooms-'+i,mesh,x:p[0],z:p[1],hp:5,maxHp:5,nextShot:performance.now()+1200+i*500,respawnAt:0,alive:true,team:'red',backrooms:true});});}
function updateBackroomsTransition(){const now=performance.now();if(now<backroomsCooldown)return;if(!backroomsActive&&local.x>36.5&&local.x<39.2&&Math.abs(local.z-8)<2.2){backroomsActive=true;backroomsCooldown=now+1500;local.x=63.5;local.z=0;local.y=1.7;local.vy=0;toast('GLITCH FOUND — WELCOME TO THE BACKROOMS');if(state.selfId==='practice-local')practiceBots.forEach(b=>{if(b.backrooms)b.mesh.visible=true;});}else if(backroomsActive&&local.x<62.5&&Math.abs(local.z)<2.8){backroomsActive=false;backroomsCooldown=now+1500;local.x=37.8;local.z=8;local.y=1.7;local.vy=0;toast('ESCAPED THE BACKROOMS');}}

function spawnPracticeBots(){if(!scene)return;practiceBots.forEach(b=>{if(b.mesh)scene.remove(b.mesh);});practiceBots=[];const spawns=[[30,0,0],[35,0,-28],[-34,0,-12],[34,0,24],[0,0,40]];spawns.forEach((p,i)=>{const mesh=makeOperator('red',['ember','default','arctic'][i%3]);addNameTag(mesh,'BOT-'+String(i+1).padStart(2,'0'),'red');mesh.position.set(p[0],0,p[2]);mesh.visible=true;scene.add(mesh);practiceBots.push({id:'bot-'+i,mesh,x:p[0],z:p[2],hp:3,maxHp:3,nextShot:performance.now()+900+i*250,respawnAt:0,alive:true,team:'red',backrooms:false});});spawnBackroomsEnemies();}
function spawnBotShot(bot){if(!scene)return;const start=new THREE.Vector3(bot.x,.98,bot.z).add(new THREE.Vector3(-Math.sin(bot.mesh.rotation.y)*.7,0,-Math.cos(bot.mesh.rotation.y)*.7));const end=new THREE.Vector3(local.x,1.15,local.z);const geo=new THREE.BufferGeometry().setFromPoints([start,end]);const mat=new THREE.LineBasicMaterial({color:0xffb65d,transparent:true,opacity:.9});const tracer=new THREE.Line(geo,mat);scene.add(tracer);const flash=new THREE.Mesh(new THREE.SphereGeometry(.09,6,5),new THREE.MeshBasicMaterial({color:0xffe4a1}));flash.position.copy(start);scene.add(flash);setTimeout(()=>{if(scene){scene.remove(tracer);scene.remove(flash);}geo.dispose();mat.dispose();flash.geometry.dispose();flash.material.dispose();},115);}
function updatePracticeBots(dt,now){if(state.selfId!=='practice-local'||!scene)return;for(const bot of practiceBots){if(bot.backrooms!==backroomsActive){bot.mesh.visible=false;continue;}if(!bot.alive){if(now>=bot.respawnAt){bot.alive=true;bot.hp=bot.maxHp;const spots=bot.backrooms?[[72,-3],[84,4]]:[[30,0,0],[35,0,-28],[-34,0,-12],[34,0,24],[0,0,40]];const p=spots[Number(bot.id.split('-')[1])%spots.length];bot.x=p[0];bot.z=p[bot.backrooms?1:2];bot.mesh.position.set(bot.x,0,bot.z);bot.mesh.visible=true;}continue;}bot.mesh.visible=true;const dx=local.x-bot.x,dz=local.z-bot.z,dist=Math.hypot(dx,dz);bot.mesh.rotation.y=Math.atan2(-dx,-dz);bot.moving=dist>8;if(dist>8){const step=Math.min(3.0*dt,dist-7);const nx=bot.x+dx/dist*step,nz=bot.z+dz/dist*step;if(canOccupy(nx,bot.z))bot.x=nx;if(canOccupy(bot.x,nz))bot.z=nz;bot.mesh.position.set(bot.x,0,bot.z);}if(dist<42&&now>bot.nextShot){bot.nextShot=now+1050+Math.random()*550;if(Math.random()>.08){spawnBotShot(bot);const hp=Math.max(0,Number($('hp-value').textContent||100)-8);$('hp-value').textContent=hp;$('hp-bar').style.width=hp+'%';if(hp===0){deathCount++;$('death-count').textContent=deathCount;toast('BOT ELIMINATED YOU — RESPAWNING');setTimeout(()=>{if(state.selfId==='practice-local'&&state.room){$('hp-value').textContent='100';$('hp-bar').style.width='100%';local.x=-20;local.z=0;local.y=1.7;}},900);}}}}}
function hitPracticeBot(dir,sniper=false){const origin=camera.getWorldPosition(new THREE.Vector3());let hit=null,best=sniper?100:38;for(const bot of practiceBots){if(!bot.alive||bot.backrooms!==backroomsActive)continue;const target=new THREE.Vector3(bot.x,1.25,bot.z),to=target.clone().sub(origin),along=to.dot(dir);if(along<=0||along>=best)continue;const closest=origin.clone().add(dir.clone().multiplyScalar(along));if(closest.distanceTo(target)>(sniper?1.8:1.15)||lineBlocked(local.x,local.z,bot.x,bot.z))continue;best=along;hit=bot;}if(hit){hit.hp-=sniper?hit.maxHp:1;if(hit.hp<=0){hit.alive=false;hit.mesh.visible=false;hit.respawnAt=performance.now()+4200;killCount++;streakCount++;$('kill-count').textContent=killCount;toast('BOT ELIMINATED +1');addFeed('BOT-'+String(Number(hit.id.split('-')[1])+1).padStart(2,'0')+' ELIMINATED');}else toast('HIT CONFIRMED · '+hit.hp+' HP LEFT');}}
function updateAmmoHud(){const el=$('charge-value');if(el)el.innerHTML=ammoInMag+' <span>/ '+reserveAmmo+' · AMMO</span>';}
function reloadWeapon(){if(!gameActive||isReloading)return;if(ammoInMag>=30){toast('MAGAZINE FULL');return;}if(reserveAmmo<=0){toast('NO RESERVE AMMO');return;}isReloading=true;reloadStarted=performance.now();toast('RELOADING…');tagHeld=false;clearTimeout(reloadTimer);reloadTimer=setTimeout(()=>{const need=30-ammoInMag,load=Math.min(need,reserveAmmo);ammoInMag+=load;reserveAmmo-=load;isReloading=false;recoilKick=0;updateAmmoHud();toast('MAGAZINE READY');},reloadDuration);}
function spawnShotFx(){if(!camera||!scene)return;if(muzzleFlash){muzzleFlash.visible=true;if(muzzleLight)muzzleLight.intensity=8;setTimeout(()=>{if(muzzleFlash)muzzleFlash.visible=false;if(muzzleLight)muzzleLight.intensity=0;},72);}const dir=new THREE.Vector3();camera.getWorldDirection(dir);const activeMuzzle=state.tool==='Sniper'?sniperMuzzlePoint:muzzlePoint;const start=activeMuzzle?activeMuzzle.getWorldPosition(new THREE.Vector3()):camera.getWorldPosition(new THREE.Vector3()).add(dir.clone().multiplyScalar(.8));const end=start.clone().add(dir.clone().multiplyScalar(24));const geo=new THREE.BufferGeometry().setFromPoints([start,end]);const material=new THREE.LineBasicMaterial({color:0xffdf88,transparent:true,opacity:.95});const tracer=new THREE.Line(geo,material);scene.add(tracer);const bullet=new THREE.Mesh(new THREE.SphereGeometry(.035,8,6),new THREE.MeshBasicMaterial({color:0xffe5a1}));bullet.position.copy(start);scene.add(bullet);const born=performance.now(),duration=135;function travel(now){if(!scene){geo.dispose();material.dispose();bullet.geometry.dispose();bullet.material.dispose();return;}const p=Math.min(1,(now-born)/duration);bullet.position.copy(start).lerp(end,p);material.opacity=1-p;if(p<1)requestAnimationFrame(travel);else{scene.remove(tracer);scene.remove(bullet);geo.dispose();material.dispose();bullet.geometry.dispose();bullet.material.dispose();}}requestAnimationFrame(travel);recoilKick=Math.min(.16,recoilKick+.055);}
function pulse(){if(!gameActive||state.room?.status!=='playing'||isReloading)return;const sniper=state.tool==='Sniper';if(performance.now()-lastPulseAt<(sniper?700:110))return;if(ammoInMag<=0){reloadWeapon();return;}ammoInMag--;updateAmmoHud();const dir=new THREE.Vector3();camera.getWorldDirection(dir);if(state.selfId==='practice-local')hitPracticeBot(dir,sniper);else socket.emit('tagPulse',{dir:{x:dir.x,y:dir.y,z:dir.z}});lastPulseAt=performance.now();spawnShotFx();if(ammoInMag===0)setTimeout(()=>{if(gameActive&&!isReloading)reloadWeapon();},180);}
function aim(dx,dy){const sens=Number(localStorage.getItem('shadowSens')||1)*(aiming&&!thirdPerson?.48:1);local.yaw-=dx*.0032*sens;local.pitch-=dy*.0032*sens;local.pitch=THREE.MathUtils.clamp(local.pitch,-1.15,1.15);}
function resize(){if(renderer&&camera){const host=$('game-canvas');if(!host.clientWidth||!host.clientHeight)return;renderer.setSize(host.clientWidth,host.clientHeight,false);camera.aspect=host.clientWidth/host.clientHeight;camera.updateProjectionMatrix();}}
window.addEventListener('resize',resize);
document.addEventListener('keydown',e=>{keys[e.code]=true;if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();if(e.code==='KeyR'&&state.view==='game')reloadWeapon();if(e.code==='Escape'&&state.view==='game')toast('Tap the game area to aim again.');});
document.addEventListener('keyup',e=>{keys[e.code]=false;});
$('game-canvas').addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button===0&&state.view==='game'){tagHeld=true;pulse();}});window.addEventListener('pointerup',e=>{if(e.pointerType==='mouse')tagHeld=false;});$('game-canvas').addEventListener('click',()=>{if(state.view==='game'&&renderer?.domElement.requestPointerLock)renderer.domElement.requestPointerLock();});
document.addEventListener('mousemove',e=>{if(document.pointerLockElement===$('game-canvas').firstElementChild)aim(e.movementX,e.movementY);});
function hold(el,on,off){el.addEventListener('pointerdown',e=>{e.preventDefault();try{el.setPointerCapture(e.pointerId);}catch(_){}on();});['pointerup','pointercancel','lostpointercapture'].forEach(ev=>el.addEventListener(ev,e=>{e.preventDefault();off();}));}
const stick=$('move-stick'),knob=stick?.querySelector('.stick-knob');
function setStick(e){if(!stick||!knob)return;const r=stick.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,rad=Math.min(r.width,r.height)*.34;let dx=e.clientX-cx,dy=e.clientY-cy;const len=Math.hypot(dx,dy);if(len>rad){dx=dx/len*rad;dy=dy/len*rad;}let x=dx/rad,y=dy/rad;if(Math.abs(x)<.09)x=0;if(Math.abs(y)<.09)y=0;touchMove={x,z:y};knob.style.transform=`translate(${dx}px,${dy}px)`;}
function resetStick(e){if(movePointer!==e.pointerId)return;movePointer=null;touchMove={x:0,z:0};if(knob)knob.style.transform='translate(0,0)';}
if(stick){stick.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();if(movePointer!==null)return;movePointer=e.pointerId;try{stick.setPointerCapture(e.pointerId);}catch(_){}setStick(e);});stick.addEventListener('pointermove',e=>{if(e.pointerId===movePointer){e.preventDefault();setStick(e);}});['pointerup','pointercancel','lostpointercapture'].forEach(ev=>stick.addEventListener(ev,resetStick));}

hold($('fire-button'),()=>{tagHeld=true;pulse();},()=>{tagHeld=false;});$('reload-button').addEventListener('click',reloadWeapon);$('aim-toggle').addEventListener('click',()=>{aiming=!aiming;$('aim-toggle').textContent=aiming?'AIM: ON · 4×':'AIM: OFF';$('aim-toggle').setAttribute('aria-pressed',String(aiming));const stage=$('game-stage');if(stage)stage.classList.toggle('scoped',aiming&&!thirdPerson);});
hold($('jump-button'),()=>{keys.Space=true;},()=>{keys.Space=false;});
$('look-zone').addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();if(lookPointer!==null)return;lookPointer=e.pointerId;lookStart={x:e.clientX,y:e.clientY};try{$('look-zone').setPointerCapture(e.pointerId);}catch(_){}});
$('look-zone').addEventListener('pointermove',e=>{if(lookPointer!==e.pointerId||!lookStart)return;e.preventDefault();aim(e.clientX-lookStart.x,e.clientY-lookStart.y);lookStart={x:e.clientX,y:e.clientY};});
['pointerup','pointercancel','lostpointercapture'].forEach(ev=>$('look-zone').addEventListener(ev,e=>{if(lookPointer===e.pointerId){lookPointer=null;lookStart=null;}}));
window.addEventListener('blur',()=>{keys={};tagHeld=false;movePointer=null;touchMove={x:0,z:0};if(knob)knob.style.transform='translate(0,0)';lookPointer=null;lookStart=null;});
document.querySelectorAll('[data-vote-map]').forEach(b=>b.onclick=()=>{if(state.room?.status!=='ended')return;socket.emit('voteMap',b.dataset.voteMap);$('map-vote-status').textContent='Your vote: '+b.textContent;});
$('match-map').addEventListener('change',()=>{if(state.selfId!=='practice-local'||!state.room)return;const nextMap=$('match-map').value;if(!['Harbor','Desert','Factory','Docks'].includes(nextMap))return;state.room.map=nextMap;const me=state.room.players.find(p=>p.id===state.selfId);if(me){me.x=-20;me.y=1.7;me.z=0;me.yaw=-Math.PI/2;me.pitch=0;}local.x=-20;local.y=1.7;local.z=0;local.yaw=-Math.PI/2;local.pitch=0;local.vy=0;isJumping=false;backroomsActive=false;practiceBots=[];launchGame();toast('MAP CHANGED · '+nextMap.toUpperCase());});
$('camera-toggle').onclick=()=>{thirdPerson=!thirdPerson;if(localAvatar)localAvatar.visible=thirdPerson;if(toolMesh)toolMesh.visible=!thirdPerson;$('camera-toggle').textContent=thirdPerson?'VIEW: 3P':'VIEW: 1P';$('camera-toggle').setAttribute('aria-pressed',String(thirdPerson));toast(thirdPerson?'THIRD-PERSON VIEW':'FIRST-PERSON VIEW');};

$('connection-check').onclick=checkConnection;$('reconnect-button').onclick=()=>{socket.connect();checkConnection();toast('Reconnecting to multiplayer server…');};$('bot-play').onclick=startPractice;$('hero-play').onclick=beginQuickPlay;$('hero-create').onclick=()=>openModal('create');$('open-create').onclick=()=>openModal('create');$('quick-play').onclick=beginQuickPlay;$('hero-play').setAttribute('aria-label','Play now');$('open-armory').onclick=openArmory;$('modal-close').onclick=closeModal;$('modal').addEventListener('click',e=>{if(e.target===$('modal'))closeModal();});$('modal-confirm').onclick=()=>{if(modalMode==='create')createRoom();else if(modalMode==='join')joinRoom();else{beginQuickPlay();}};$('home-join').onclick=()=>{openModal('join');$('join-code').value=$('home-code').value.toUpperCase();};$('home-code').addEventListener('input',()=>{$('home-code').value=$('home-code').value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5);});$('join-code').addEventListener('input',()=>{$('join-code').value=$('join-code').value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5);});$('quick-play').onclick=()=>openModal('quick');$('open-armory').onclick=openArmory;$('armory-back').onclick=()=>showView('home');$('armory-return').onclick=()=>showView('home');$('lobby-back').onclick=()=>{socket.emit('leaveRoom');state.room=null;state.selfId=null;practiceBots=[];updateUrl();showView('home');};$('ready-button').onclick=()=>socket.emit('ready',!state.ready);$('start-match').onclick=()=>{if(state.room?.hostId!==state.selfId)return toast('Waiting for the room host.');socket.emit('startMatch');};$('lobby-map').onchange=()=>socket.emit('setMap',$('lobby-map').value);$('copy-invite').onclick=async()=>{const invite=location.origin+location.pathname+'?room='+state.room.code;try{await navigator.clipboard.writeText(invite);toast('Invite link copied!');}catch(e){prompt('Copy this invite link:',invite);}};$('leave-match').onclick=leaveMatch;$('return-lobby').onclick=()=>{if(state.selfId==='practice-local'){leaveMatch();return;}socket.emit('returnToLobby');$('game-message').classList.add('hidden');};$('game-home').onclick=leaveMatch;document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{state.tool=b.dataset.tool;localStorage.setItem('shadowTool',state.tool);document.querySelectorAll('[data-tool]').forEach(x=>x.classList.toggle('selected',x===b));socket.emit('selectLoadout',{tool:state.tool,skin:state.skin});$('hud-tool').textContent=state.tool.toUpperCase();});document.querySelectorAll('[data-skin]').forEach(b=>b.onclick=()=>{const skin=b.dataset.skin;if(skin!=='default'&&localStorage.getItem('owned'+skin[0].toUpperCase()+skin.slice(1))!=='1')return toast('Unlock this skin in the Armory first.');state.skin=skin;localStorage.setItem('shadowSkin',skin);document.querySelectorAll('[data-skin]').forEach(x=>x.classList.toggle('selected',x===b));socket.emit('selectLoadout',{tool:state.tool,skin:state.skin});});$('armory-return').onclick=()=>showView('home');$('return-lobby').onclick=()=>socket.emit('returnToLobby');$('game-home').onclick=leaveMatch;$('save-settings')?.addEventListener('click',()=>{});
document.querySelectorAll('.nav-item').forEach(b=>b.onclick=()=>{if(b.dataset.view==='armory')openArmory();else if(b.dataset.view==='home')showView('home');});
function initLoadout(){document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('selected',b.dataset.tool===state.tool));document.querySelectorAll('[data-skin]').forEach(b=>b.classList.toggle('selected',b.dataset.skin===state.skin));}
function buyItem(item){const id=item.name.toLowerCase();const flag='owned'+id[0].toUpperCase()+id.slice(1);if(item.cost&&!localStorage.getItem(flag)){if(state.credits<item.cost)return toast('Not enough demo credits.');state.credits-=item.cost;localStorage.setItem('shadowCredits',String(state.credits));localStorage.setItem(flag,'1');}if(item.type==='TAG DEVICE'){state.tool=item.name[0]+item.name.slice(1).toLowerCase();localStorage.setItem('shadowTool',state.tool);}else if(item.type==='WEAPON SKIN'){localStorage.setItem('shadowWeaponSkin',id==='cyan'?'cyan':'gold');}else{state.skin=id==='recon'?'default':id;localStorage.setItem('shadowSkin',state.skin);}socket.emit('selectLoadout',{tool:state.tool,skin:state.skin});renderArmory();initLoadout();toast(item.name+' equipped.');}
initLoadout();updateNetwork();loadOperatorModel();