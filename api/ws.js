// Edge WebSocket on Vercel using WebSocketPair
export const config = { runtime: 'edge' };

// In-memory state (per Edge isolate)
const rooms = new Map(); // code -> { createdBy, vsBot, sockets:Set<WebSocket>, foods:[], players: Map(id->player) }

const MAP_W = 4000;
const MAP_H = 4000;
const INITIAL_R = 12;
const FOOD_R = 3;

function uid() { return Math.random().toString(36).slice(2, 10); }
function color() { return `#${Math.floor(Math.random()*0xffffff).toString(16).padStart(6,'0')}`; }

function ensureFoods(room) {
  if (!room.foods) room.foods = [];
  while (room.foods.length < 400) {
    room.foods.push({ x: Math.random()*MAP_W, y: Math.random()*MAP_H, r: FOOD_R });
  }
}

function getOrCreateRoom(code, createdBy = 'system', vsBot = false) {
  if (!rooms.has(code)) {
    rooms.set(code, { createdBy, vsBot, sockets: new Set(), foods: [], players: new Map() });
    ensureFoods(rooms.get(code));
    if (vsBot) addBot(code);
  }
  return rooms.get(code);
}

function addBot(code) {
  const room = rooms.get(code);
  if (!room) return;
  const id = `BOT#${uid().slice(-3)}`;
  room.players.set(id, { id, name: 'BOT', color: '#ff6b6b', x: Math.random()*MAP_W, y: Math.random()*MAP_H, r: INITIAL_R*1.2, dx:0, dy:0, isBot:true });
}

function broadcast(room, type, payload) {
  const data = JSON.stringify({ type, payload });
  for (const ws of room.sockets) {
    try { ws.send(data); } catch {}
  }
}

function stepRooms() {
  for (const [code, room] of rooms) {
    // Move players
    for (const p of room.players.values()) {
      const speed = 260 * (INITIAL_R / Math.max(INITIAL_R, p.r));
      if (p.isBot) {
        // naive bot target
        let tx = Math.random()*MAP_W, ty = Math.random()*MAP_H;
        const mag = Math.hypot(tx - p.x, ty - p.y) || 1;
        p.dx = (tx - p.x) / mag; p.dy = (ty - p.y) / mag;
      }
      p.x = Math.max(0, Math.min(MAP_W, p.x + p.dx * speed * 0.05));
      p.y = Math.max(0, Math.min(MAP_H, p.y + p.dy * speed * 0.05));
    }
    // Broadcast snapshot (throttled by interval)
    const snapshot = {
      players: Object.fromEntries([...room.players].map(([k,v])=>[k, { x:v.x, y:v.y, r:v.r, color:v.color, name:v.name }])),
      foods: room.foods.slice(0, 200),
      map: { w: MAP_W, h: MAP_H }
    };
    broadcast(room, 'state', snapshot);
  }
}

let ticking = false;
if (!ticking) {
  ticking = true;
  setInterval(stepRooms, 50); // 20 FPS
}

export default function handler(req) {
  const upgrade = req.headers.get('upgrade') || '';
  if (upgrade.toLowerCase() !== 'websocket') {
    return new Response('Expected websocket', { status: 400 });
  }
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();

  const ws = server;
  ws.id = uid();
  ws.addEventListener('message', (event) => {
    let msg; try { msg = JSON.parse(event.data); } catch { return; }
    const { type, payload } = msg || {};
    if (type === 'join') {
      const { code, name, vsBot } = payload || {};
      const room = getOrCreateRoom(code, name, !!vsBot);
      // capacity check (2 total; if vsBot then max 1 human)
      const humans = [...room.players.values()].filter(p => !p.isBot).length;
      const cap = room.vsBot ? 1 : 2;
      if (humans >= cap) {
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Room penuh' } }));
        return;
      }
      room.sockets.add(ws);
      ws.roomCode = code;
      ws.playerId = `${name}#${ws.id.slice(-3)}`;
      const player = { id: ws.playerId, name, color: color(), x: Math.random()*MAP_W, y: Math.random()*MAP_H, r: INITIAL_R, dx:0, dy:0, isBot:false };
      room.players.set(ws.playerId, player);
      ws.send(JSON.stringify({ type: 'init', payload: { you: player, map: { w: MAP_W, h: MAP_H }, foods: room.foods, players: Object.fromEntries([...room.players].map(([k,v])=>[k,{x:v.x,y:v.y,r:v.r,color:v.color,name:v.name}])) } }));
      broadcast(room, 'joined', { id: ws.playerId, name });
    } else if (type === 'input') {
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      const p = room.players.get(ws.playerId);
      if (!p) return;
      let { dx, dy } = payload || { dx: 0, dy: 0 };
      const mag = Math.hypot(dx, dy) || 1; p.dx = dx / mag; p.dy = dy / mag;
    }
  });

  ws.addEventListener('close', () => {
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    room.sockets.delete(ws);
    if (ws.playerId) room.players.delete(ws.playerId);
  });

  return new Response(null, { status: 101, webSocket: client });
}


