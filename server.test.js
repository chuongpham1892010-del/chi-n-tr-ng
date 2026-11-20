'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { start, io: serverIo } = require('../server');
const { io: clientIo } = require('socket.io-client');

function ack(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(4000).emit(event, payload, (error, response) => {
      if (error) return reject(error);
      resolve(response);
    });
  });
}

function connect(url) {
  const socket = clientIo(url, { transports: ['websocket'], reconnection: false, timeout: 4000 });
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

test('room lifecycle: create, join, release seat, ready, start, command and snapshot', async () => {
  const address = await start(0, '127.0.0.1');
  const url = `http://127.0.0.1:${address.port}`;
  const host = await connect(url);
  const firstGuest = await connect(url);
  let replacement;

  try {
    const health = await fetch(`${url}/health`).then(r => r.json());
    assert.equal(health.ok, true);

    const created = await ack(host, 'room:create', {
      humanPlayers: 2, bots: 1, durationMinutes: 30,
      token: 'host-token-1234567890', name: 'Host'
    });
    assert.equal(created.ok, true);
    const roomCode = created.room.roomCode;
    assert.match(roomCode, /^[A-HJ-NP-Z2-9]{6}$/);

    const joined = await ack(firstGuest, 'room:join', {
      roomCode, token: 'guest-token-1234567890', name: 'Guest'
    });
    assert.equal(joined.ok, true);
    assert.equal(joined.playerIndex, 1);

    const left = await ack(firstGuest, 'room:leave', {});
    assert.equal(left.ok, true);
    firstGuest.disconnect();

    replacement = await connect(url);
    const rejoined = await ack(replacement, 'room:join', {
      roomCode, token: 'replacement-token-1234567890', name: 'Replacement'
    });
    assert.equal(rejoined.ok, true);
    assert.equal(rejoined.playerIndex, 1, 'explicitly leaving should free a lobby seat');

    assert.equal((await ack(replacement, 'room:ready', { ready: true })).ok, true);
    const startedEvent = once(replacement, 'match:start');
    assert.equal((await ack(host, 'room:start', {})).ok, true);
    const [match] = await startedEvent;
    assert.equal(match.config.humanPlayers, 2);

    const snapshotEvent = once(replacement, 'game:snapshot');
    assert.equal((await ack(host, 'game:snapshot', { state: { p: [], c: [], u: [], t: [] } })).ok, true);
    const [snapshot] = await snapshotEvent;
    assert.deepEqual(snapshot.state, { p: [], c: [], u: [], t: [] });

    const commandEvent = once(host, 'game:command');
    assert.equal((await ack(replacement, 'game:command', {
      sequence: 1, command: { type: 'army:mode', data: { mode: 1, unitIds: [10] } }
    })).ok, true);
    const [command] = await commandEvent;
    assert.equal(command.playerIndex, 1);
    assert.equal(command.command.type, 'army:mode');

    const hostChanged = once(replacement, 'host:changed');
    host.disconnect();
    const [migration] = await hostChanged;
    assert.equal(migration.hostPlayerIndex, 1, 'the connected guest should take over as host');
  } finally {
    host.disconnect();
    firstGuest.disconnect();
    replacement?.disconnect();
    await new Promise(resolve => serverIo.close(resolve));
  }
});
