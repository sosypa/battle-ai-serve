'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const MAX_PLAYERS = 4;
const rooms = new Map();
const clients = new Map();
const MAPS = new Set(['factory', 'metro', 'docks']);
const MODES = new Set(['normal', 'advanced']);
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, service: 'metro-royale-online', rooms: rooms.size, players: clients.size }));
  }
  if (url.pathname !== '/' && url.pathname !== '/index.html') {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  fs.readFile(path.join(ROOT, 'index.html'), (err, data) => {
    if (err) { res.writeHead(500); return res.end('Game file unavailable'); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
server.on('upgrade', (req, socket, head) => {
  if (req.url !== '/ws') { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function cleanName(v) {
  const s = String(v || 'Рейдер').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 18);
  return s || 'Рейдер';
}
function newCode() {
  let code;
  do { code = Array.from({ length: 5 }, () => alphabet[crypto.randomInt(alphabet.length)]).join(''); } while (rooms.has(code));
  return code;
}
function currentRoom(p) { return p.room ? rooms.get(p.room) : null; }
function publicPlayers(room) {
  return Array.from(room.players.values(), p => ({
    id: p.id, name: p.name, x: p.state.x, y: p.state.y,
    hp: p.state.hp, alive: p.state.alive, host: p.id === room.host
  }));
}
function updateRoom(room) {
  if (!room) return;
  const msg = { type: 'room_update', code: room.code, host: false, players: publicPlayers(room), map: room.map, mode: room.mode, started: room.started };
  for (const p of room.players.values()) send(p.ws, { ...msg, host: p.id === room.host });
}
function broadcast(room, msg) {
  for (const p of room.players.values()) send(p.ws, msg);
}
function leave(p) {
  if (!p.room) return;
  const room = rooms.get(p.room);
  p.room = null;
  if (!room) return;
  room.players.delete(p.id);
  if (!room.players.size) { rooms.delete(room.code); return; }
  if (room.host === p.id) room.host = room.players.keys().next().value;
  broadcast(room, { type: 'notice', text: p.name + ' покинул комнату.' });
  updateRoom(room);
}
function err(ws, text) { send(ws, { type: 'error', text }); }

wss.on('connection', ws => {
  const p = { id: crypto.randomUUID(), ws, room: null, name: 'Рейдер', state: { x: 150, y: 150, hp: 100, alive: true }, lastMove: 0 };
  clients.set(p.id, p);
  send(ws, { type: 'hello', id: p.id, online: clients.size });
  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return err(ws, 'Некорректное сообщение.'); }
    if (!m || typeof m.type !== 'string') return;
    if (m.type === 'create') {
      leave(p);
      p.name = cleanName(m.name);
      const room = { code: newCode(), host: p.id, players: new Map(), map: MAPS.has(m.map) ? m.map : 'factory', mode: MODES.has(m.mode) ? m.mode : 'normal', started: false, created: Date.now() };
      p.room = room.code; p.state = { x: 150, y: 150, hp: 100, alive: true };
      room.players.set(p.id, p); rooms.set(room.code, room);
      send(ws, { type: 'created', code: room.code });
      updateRoom(room);
      return;
    }
    if (m.type === 'join') {
      const code = String(m.code || '').trim().toUpperCase().slice(0, 5);
      const room = rooms.get(code);
      if (!room) return err(ws, 'Комната не найдена. Проверь код.');
      if (room.players.size >= MAX_PLAYERS) return err(ws, 'Комната заполнена.');
      if (room.started) return err(ws, 'Рейд уже начался.');
      leave(p);
      p.name = cleanName(m.name);
      p.room = room.code; p.state = { x: 170 + room.players.size * 20, y: 170, hp: 100, alive: true };
      room.players.set(p.id, p);
      send(ws, { type: 'joined', code: room.code });
      broadcast(room, { type: 'notice', text: p.name + ' подключился к отряду.' });
      updateRoom(room);
      return;
    }
    const room = currentRoom(p);
    if (m.type === 'leave') { leave(p); send(ws, { type: 'left' }); return; }
    if (!room) return err(ws, 'Сначала создай комнату или войди по коду.');
    if (m.type === 'settings') {
      if (room.host !== p.id || room.started) return err(ws, 'Настройки меняет лидер до старта.');
      if (MAPS.has(m.map)) room.map = m.map;
      if (MODES.has(m.mode)) room.mode = m.mode;
      return updateRoom(room);
    }
    if (m.type === 'start') {
      if (room.host !== p.id) return err(ws, 'Только лидер отряда может начать рейд.');
      if (room.started) return;
      room.started = true;
      for (const member of room.players.values()) member.state = { x: 145 + Math.random() * 35, y: 145 + Math.random() * 35, hp: 100, alive: true };
      broadcast(room, { type: 'raid_started', map: room.map, mode: room.mode });
      updateRoom(room);
      return;
    }
    if (m.type === 'move') {
      if (!room.started) return;
      const now = Date.now();
      if (now - p.lastMove < 35) return;
      p.lastMove = now;
      const x = Number(m.x), y = Number(m.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      p.state.x = Math.max(24, Math.min(1400, x));
      p.state.y = Math.max(24, Math.min(900, y));
      if (Number.isFinite(m.hp)) p.state.hp = Math.max(0, Math.min(100, m.hp));
      if (typeof m.alive === 'boolean') p.state.alive = m.alive;
      broadcast(room, { type: 'player_move', player: { id: p.id, x: p.state.x, y: p.state.y, hp: p.state.hp, alive: p.state.alive } });
      return;
    }
    if (m.type === 'chat') {
      const text = String(m.text || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 120);
      if (text) broadcast(room, { type: 'chat', id: p.id, name: p.name, text });
    }
  });
  ws.on('close', () => { leave(p); clients.delete(p.id); });
  ws.on('error', () => { leave(p); clients.delete(p.id); });
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (now - room.created > 6 * 60 * 60 * 1000 && room.players.size === 0) rooms.delete(room.code);
  }
}, 60_000).unref();

server.listen(PORT, '0.0.0.0', () => console.log('Metro Royale Online listening on ' + PORT));
