// Minimal WebSocket server using WebSocket protocol on Vercel Node runtime
// This is a simplified implementation without Socket.IO, suitable for Vercel serverless.

import crypto from 'node:crypto';

// In-memory game state (serverless note: will reset between invocations; for demo only)
const rooms = new Map(); // code -> { createdBy, vsBot, clients:Set, foods:[], players: Map(clientId -> player) }

const MAP_W = 4000;
const MAP_H = 4000;
const INITIAL_R = 12;
const FOOD_R = 3;

function uid(n = 8) { return crypto.randomBytes(n).toString('hex'); }

function ensureFoods(room) {
  while ((room.foods?.length || 0) < 400) {
    room.foods.push({ x: Math.random() * MAP_W, y: Math.random() * MAP_H, r: FOOD_R });
  }
}

function color() { return `#${Math.floor(Math.random()*0xffffff).toString(16).padStart(6,'0')}`; }

function broadcast(room, type, payload) {
  const msg = JSON.stringify({ type, payload });
  for (const c of room.clients) {
    try { c.send(msg); } catch {}
  }
}

export default async function handler(req, res) {
  if (req.headers.upgrade !== 'websocket') {
    res.status(400).send('Expected websocket');
    return;
  }

  const { socket } = res;
  const key = req.headers['sec-websocket-key'];
  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
  ];
  socket.write(headers.concat('\r\n').join('\r\n'));

  const client = new WebSocketConnection(socket);
  client.onMessage((data) => handleMessage(client, data));
  client.onClose(() => handleClose(client));
}

class WebSocketConnection {
  constructor(socket) {
    this.socket = socket;
    this.id = uid(4);
    this.buf = Buffer.alloc(0);
    this.alive = true;
    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('end', () => this._close());
    socket.on('close', () => this._close());
    socket.on('error', () => this._close());
  }
  send(text) {
    if (!this.alive) return;
    const payload = Buffer.from(text);
    const b1 = 0x81; // FIN + text
    let header;
    if (payload.length < 126) {
      header = Buffer.from([b1, payload.length]);
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = b1; header[1] = 126; header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = b1; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    this.socket.write(Buffer.concat([header, payload]));
  }
  _onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (true) {
      if (this.buf.length < 2) return;
      const b1 = this.buf[0];
      const b2 = this.buf[1];
      const masked = (b2 & 0x80) === 0x80;
      let len = b2 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2); offset = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2)); offset = 10;
      }
      const mask = masked ? this.buf.slice(offset, offset + 4) : null;
      offset += masked ? 4 : 0;
      if (this.buf.length < offset + len) return;
      let payload = this.buf.slice(offset, offset + len);
      if (masked && mask) {
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      }
      this.buf = this.buf.slice(offset + len);
      const opcode = b1 & 0x0f;
      if (opcode === 0x8) { // close
        this._close();
        return;
      } else if (opcode === 0x1) { // text
        try { this._onMessage?.(payload.toString('utf8')); } catch {}
      }
    }
  }
  onMessage(cb) { this._onMessage = cb; }
  onClose(cb) { this._onClose = cb; }
  _close() { if (!this.alive) return; this.alive = false; try { this._onClose?.(); } catch {} }
}

function getOrCreateRoom(code, createdBy = 'system', vsBot = false) {
  if (!rooms.has(code)) {
    rooms.set(code, { createdBy, vsBot, clients: new Set(), foods: [], players: new Map() });
    ensureFoods(rooms.get(code));
    if (vsBot) addBot(code);
  }
  return rooms.get(code);
}

function addBot(code) {
  const room = rooms.get(code);
  if (!room) return;
  const id = `BOT#${uid(2)}`;
  room.players.set(id, { id, name: 'BOT', color: '#ff6b6b', x: Math.random()*MAP_W, y: Math.random()*MAP_H, r: INITIAL_R*1.2, dx:0, dy:0, isBot:true });
}

function handleMessage(client, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  const { type, payload } = msg || {};
  if (type === 'join') {
    const { code, name, vsBot } = payload;
    const room = getOrCreateRoom(code, name, !!vsBot);
    // capacity check (2 total; if vsBot then max 1 human)
    const humans = [...room.players.values()].filter(p => !p.isBot).length;
    const cap = room.vsBot ? 1 : 2;
    if (humans >= cap) {
      client.send(JSON.stringify({ type: 'error', payload: { message: 'Room penuh' } }));
      return;
    }
    room.clients.add(client);
    const id = `${name}#${client.id.slice(-3)}`;
    const player = { id, name, color: color(), x: Math.random()*MAP_W, y: Math.random()*MAP_H, r: INITIAL_R, dx:0, dy:0, isBot:false };
    room.players.set(id, player);
    client.roomCode = code;
    client.playerId = id;
    // Send init
    client.send(JSON.stringify({ type: 'init', payload: { you: player, map: { w: MAP_W, h: MAP_H }, foods: room.foods, players: Object.fromEntries([...room.players].map(([k,v])=>[k, {x:v.x,y:v.y,r:v.r,color:v.color,name:v.name}])) } }));
    broadcast(room, 'joined', { id, name });
  } else if (type === 'input') {
    const room = rooms.get(client.roomCode);
    if (!room) return;
    const p = room.players.get(client.playerId);
    if (!p) return;
    let { dx, dy } = payload;
    const mag = Math.hypot(dx, dy) || 1;
    p.dx = dx / mag; p.dy = dy / mag;
  }
}

function handleClose(client) {
  const room = rooms.get(client.roomCode);
  if (!room) return;
  room.clients.delete(client);
  if (client.playerId) room.players.delete(client.playerId);
}


