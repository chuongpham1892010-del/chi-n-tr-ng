'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const http = require('node:http');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT || 3000);
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rooms = new Map();
const socketSeat = new Map();
const SNAPSHOT_MIN_INTERVAL_MS = 350;
const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function safeName(value, fallback) {
  const name = String(value || '').trim().replace(/[<>\u0000-\u001f]/g, '').slice(0, 24);
  return name || fallback;
}

function publicRoom(room) {
  return {
    roomCode: room.code,
    status: room.status,
    config: { ...room.config },
    hostPlayerIndex: room.hostPlayerIndex,
    players: room.seats.map((seat, index) => ({
      index,
      kind: seat.kind,
      name: seat.name,
      ready: seat.kind === 'bot' ? true : !!seat.ready,
      connected: seat.kind === 'bot' ? true : !!seat.connected
    })),
    serverTime: Date.now(),
    startAt: room.startAt || 0,
    endAt: room.endAt || 0,
    matchStart: room.matchStart || null
  };
}

function emitRoom(room) {
  io.to(room.code).emit('room:state', publicRoom(room));
}

function getSeat(socket) {
  const record = socketSeat.get(socket.id);
  if (!record) return null;
  const room = rooms.get(record.code);
  if (!room) return null;
  const seat = room.seats[record.playerIndex];
  if (!seat || seat.socketId !== socket.id) return null;
  return { room, seat, playerIndex: record.playerIndex };
}

function removeSocketFromRoom(socket, reason = 'disconnect') {
  const record = socketSeat.get(socket.id);
  if (!record) return;
  socketSeat.delete(socket.id);
  const room = rooms.get(record.code);
  if (!room) return;
  const seat = room.seats[record.playerIndex];
  if (!seat || seat.socketId !== socket.id) return;

  seat.connected = false;
  seat.socketId = null;
  seat.ready = false;
  if (reason === 'leave') { seat.token = null; seat.name = `Người chơi ${record.playerIndex + 1}`; }
  io.to(room.code).emit('player:disconnected', {
    playerIndex: record.playerIndex,
    reason,
    serverTime: Date.now()
  });

  if (room.hostPlayerIndex === record.playerIndex) {
    const next = room.seats.findIndex((candidate, index) => index !== record.playerIndex && candidate.kind === 'human' && candidate.connected);
    if (next >= 0) {
      room.hostPlayerIndex = next;
      io.to(room.code).emit('host:changed', {
        hostPlayerIndex: next, disconnectedPlayerIndex: record.playerIndex,
        snapshot: room.latestSnapshot, serverTime: Date.now()
      });
    } else if (room.status === 'running') {
      room.status = 'paused';
      io.to(room.code).emit('room:paused', { reason: 'no-connected-human', serverTime: Date.now() });
    }
  }

  if (room.status === 'lobby' && !room.seats.some(s => s.kind === 'human' && s.connected)) {
    rooms.delete(room.code);
    return;
  }
  emitRoom(room);
}

function resumeSeat(room, socket, token, name) {
  const index = room.seats.findIndex(s => s.kind === 'human' && s.token === token);
  if (index < 0) return null;
  const seat = room.seats[index];
  if (seat.socketId && seat.socketId !== socket.id) {
    const old = io.sockets.sockets.get(seat.socketId);
    if (old) old.disconnect(true);
  }
  seat.socketId = socket.id;
  seat.connected = true;
  seat.name = safeName(name, seat.name || `Người chơi ${index + 1}`);
  seat.ready = room.status === 'running' ? true : seat.ready;
  socket.join(room.code);
  socketSeat.set(socket.id, { code: room.code, playerIndex: index });
  if (room.status === 'paused') { room.status = 'running'; room.hostPlayerIndex = index; io.to(room.code).emit('host:changed', { hostPlayerIndex: index, disconnectedPlayerIndex: index, snapshot: room.latestSnapshot, serverTime: Date.now() }); }
  io.to(room.code).emit('player:reconnected', { playerIndex: index, serverTime: Date.now() });
  return index;
}

const app = express();
app.disable('x-powered-by');
app.get('/health', (_req, res) => res.json({ ok: true, service: 'chien-truong-online', rooms: rooms.size, time: Date.now() }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const server = http.createServer(app);
const allowed = String(process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);
const corsOrigin = allowed.includes('*') ? '*' : allowed;
const io = new Server(server, {
  cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
  maxHttpBufferSize: MAX_SNAPSHOT_BYTES,
  perMessageDeflate: { threshold: 1024 }
});

io.on('connection', socket => {
  socket.data.rate = [];
  socket.data.lastSnapshotAt = 0;

  function ack(cb, value) { if (typeof cb === 'function') cb(value); }
  function rateOk(limit = 30) {
    const now = Date.now();
    socket.data.rate = socket.data.rate.filter(t => now - t < 1000);
    if (socket.data.rate.length >= limit) return false;
    socket.data.rate.push(now);
    return true;
  }

  socket.on('room:create', (payload = {}, cb) => {
    if (!rateOk(5)) return ack(cb, { ok: false, error: 'RATE_LIMIT' });
    const humanPlayers = Number(payload.humanPlayers);
    const bots = Number(payload.bots);
    const durationMinutes = Number(payload.durationMinutes);
    const token = String(payload.token || '');
    if (![2, 3, 4].includes(humanPlayers) || !Number.isInteger(bots) || bots < 0 || bots > 5 - humanPlayers || ![30, 45, 60].includes(durationMinutes) || token.length < 16 || token.length > 128) {
      return ack(cb, { ok: false, error: 'INVALID_CONFIG', message: 'Cấu hình phòng không hợp lệ.' });
    }
    const code = makeCode();
    const seats = Array.from({ length: humanPlayers + bots }, (_, index) => index < humanPlayers ? ({
      kind: 'human', name: index === 0 ? safeName(payload.name, 'Chủ phòng') : `Người chơi ${index + 1}`,
      token: index === 0 ? token : null, socketId: index === 0 ? socket.id : null,
      connected: index === 0, ready: index === 0
    }) : ({ kind: 'bot', name: `Bot ${index - humanPlayers + 1}`, token: null, socketId: null, connected: true, ready: true }));
    const room = {
      code, config: { humanPlayers, bots, durationMinutes }, seats,
      hostPlayerIndex: 0, status: 'lobby', createdAt: Date.now(), startAt: 0, endAt: 0,
      timer: null, latestSnapshot: null, lastSnapshotAt: 0, matchStart: null
    };
    rooms.set(code, room);
    socket.join(code);
    socketSeat.set(socket.id, { code, playerIndex: 0 });
    ack(cb, { ok: true, playerIndex: 0, room: publicRoom(room), serverTime: Date.now() });
    emitRoom(room);
  });

  socket.on('room:join', (payload = {}, cb) => {
    if (!rateOk(8)) return ack(cb, { ok: false, error: 'RATE_LIMIT' });
    const code = String(payload.roomCode || '').trim().toUpperCase();
    const token = String(payload.token || '');
    const room = rooms.get(code);
    if (!room) return ack(cb, { ok: false, error: 'ROOM_NOT_FOUND', message: 'Không tìm thấy phòng.' });
    if (token.length >= 16) {
      const existing = resumeSeat(room, socket, token, payload.name);
      if (existing !== null) {
        ack(cb, { ok: true, playerIndex: existing, room: publicRoom(room), resumed: true, snapshot: room.latestSnapshot, match: room.matchStart, serverTime: Date.now() });
        emitRoom(room);
        return;
      }
    }
    if (room.status !== 'lobby') return ack(cb, { ok: false, error: 'MATCH_ALREADY_STARTED', message: 'Trận đấu đã bắt đầu; không nhận người chơi mới.' });
    const index = room.seats.findIndex(s => s.kind === 'human' && !s.connected && !s.token);
    if (index < 0) return ack(cb, { ok: false, error: 'ROOM_FULL', message: 'Phòng đã đủ người.' });
    const seat = room.seats[index];
    seat.token = token;
    seat.socketId = socket.id;
    seat.connected = true;
    seat.ready = false;
    seat.name = safeName(payload.name, `Người chơi ${index + 1}`);
    socket.join(room.code);
    socketSeat.set(socket.id, { code: room.code, playerIndex: index });
    ack(cb, { ok: true, playerIndex: index, room: publicRoom(room), resumed: false, serverTime: Date.now() });
    emitRoom(room);
  });

  socket.on('room:ready', (payload = {}, cb) => {
    const current = getSeat(socket);
    if (!current || current.room.status !== 'lobby' || current.seat.kind !== 'human') return ack(cb, { ok: false, error: 'NOT_IN_LOBBY' });
    current.seat.ready = !!payload.ready;
    ack(cb, { ok: true });
    emitRoom(current.room);
  });

  socket.on('room:start', (_payload = {}, cb) => {
    const current = getSeat(socket);
    if (!current) return ack(cb, { ok: false, error: 'NOT_IN_ROOM' });
    const { room, playerIndex } = current;
    if (room.status !== 'lobby') return ack(cb, { ok: false, error: 'INVALID_ROOM_STATE' });
    if (room.hostPlayerIndex !== playerIndex) return ack(cb, { ok: false, error: 'HOST_ONLY', message: 'Chỉ chủ phòng mới được bắt đầu.' });
    const humans = room.seats.filter(s => s.kind === 'human');
    if (humans.length !== room.config.humanPlayers || humans.some(s => !s.connected)) return ack(cb, { ok: false, error: 'WAITING_PLAYERS', message: 'Đang chờ đủ người chơi.' });
    if (humans.some(s => !s.ready)) return ack(cb, { ok: false, error: 'NOT_ALL_READY', message: 'Chưa phải tất cả người chơi đã sẵn sàng.' });
    const now = Date.now();
    room.status = 'running';
    room.startAt = now + 1500;
    room.endAt = room.startAt + room.config.durationMinutes * 60000;
    room.seed = crypto.randomInt(1, 0x7fffffff);
    room.matchStart = {
      config: { ...room.config }, seed: room.seed, startAt: room.startAt, endAt: room.endAt,
      hostPlayerIndex: room.hostPlayerIndex, serverTime: now
    };
    room.timer = setTimeout(() => {
      if (room.status !== 'running') return;
      room.status = 'ended';
      io.to(room.code).emit('game:ended', { reason: 'time', serverTime: Date.now() });
      emitRoom(room);
    }, Math.max(0, room.endAt - now));
    ack(cb, { ok: true, match: room.matchStart });
    io.to(room.code).emit('match:start', room.matchStart);
    emitRoom(room);
  });

  socket.on('game:command', (payload = {}, cb) => {
    if (!rateOk(35)) return ack(cb, { ok: false, error: 'RATE_LIMIT' });
    const current = getSeat(socket);
    if (!current || current.room.status !== 'running') return ack(cb, { ok: false, error: 'NOT_IN_MATCH' });
    const command = payload.command;
    const allowedCommands = new Set(['army:order','city:recruit','city:wall','tower:build','army:mode','army:formation','army:assign','army:split','army:retreat','rebel:deploy']);
    if (!command || typeof command !== 'object' || !allowedCommands.has(command.type) || !command.data || typeof command.data !== 'object') return ack(cb, { ok: false, error: 'INVALID_COMMAND' });
    try { if (Buffer.byteLength(JSON.stringify(command)) > 12000) return ack(cb, { ok: false, error: 'COMMAND_TOO_LARGE' }); } catch { return ack(cb, { ok: false, error: 'INVALID_COMMAND' }); }
    io.to(current.room.code).emit('game:command', {
      playerIndex: current.playerIndex,
      command,
      sequence: Number.isInteger(payload.sequence) ? payload.sequence : 0,
      serverTime: Date.now()
    });
    ack(cb, { ok: true });
  });

  socket.on('game:snapshot', (payload = {}, cb) => {
    if (!rateOk(4)) return ack(cb, { ok: false, error: 'RATE_LIMIT' });
    const current = getSeat(socket);
    if (!current || current.room.status !== 'running') return ack(cb, { ok: false, error: 'NOT_IN_MATCH' });
    const room = current.room;
    if (room.hostPlayerIndex !== current.playerIndex) return ack(cb, { ok: false, error: 'HOST_ONLY' });
    const now = Date.now();
    if (now - room.lastSnapshotAt < SNAPSHOT_MIN_INTERVAL_MS) return ack(cb, { ok: false, error: 'SNAPSHOT_TOO_FAST' });
    if (!payload.state || typeof payload.state !== 'object') return ack(cb, { ok: false, error: 'INVALID_SNAPSHOT' });
    let bytes;
    try { bytes = Buffer.byteLength(JSON.stringify(payload.state)); }
    catch { return ack(cb, { ok: false, error: 'INVALID_SNAPSHOT' }); }
    if (bytes > MAX_SNAPSHOT_BYTES) return ack(cb, { ok: false, error: 'SNAPSHOT_TOO_LARGE' });
    room.latestSnapshot = payload.state;
    room.lastSnapshotAt = now;
    io.to(room.code).emit('game:snapshot', { state: payload.state, hostPlayerIndex: room.hostPlayerIndex, serverTime: now });
    ack(cb, { ok: true });
  });

  socket.on('game:finish', (payload = {}, cb) => {
    const current = getSeat(socket);
    if (!current || current.room.status !== 'running' || current.room.hostPlayerIndex !== current.playerIndex) return ack(cb, { ok: false, error: 'HOST_ONLY' });
    const room = current.room;
    room.status = 'ended';
    if (room.timer) clearTimeout(room.timer);
    const result = { reason: payload.reason === 'time' ? 'time' : 'conquest', winner: Number.isInteger(payload.winner) ? payload.winner : -1, rows: Array.isArray(payload.rows) ? payload.rows.slice(0, 5) : [] };
    io.to(room.code).emit('game:ended', { ...result, serverTime: Date.now() });
    emitRoom(room);
    ack(cb, { ok: true });
  });

  socket.on('room:leave', (_payload, cb) => {
    const current = getSeat(socket);
    if (!current) return ack(cb, { ok: true });
    removeSocketFromRoom(socket, 'leave');
    socket.leave(current.room.code);
    ack(cb, { ok: true });
  });

  socket.on('disconnect', reason => removeSocketFromRoom(socket, reason));
});

function start(port = PORT, host = '0.0.0.0') {
  return new Promise(resolve => server.listen(port, host, () => resolve(server.address())));
}

if (require.main === module) {
  start().then(address => console.log(`Chiến Trường Online server listening on ${address.address}:${address.port}`));
}

module.exports = { app, server, io, rooms, start, publicRoom };
