// Toguz Korgool — minimal relay server.
// It does NOT know the game rules at all: it just pairs two clients
// into a "room" by code and forwards move messages between them.
// Both clients run the same deterministic rules.js locally, so as
// long as they receive the same moves in the same order, their
// boards stay perfectly in sync.

import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });
const rooms = new Map(); // roomId -> array of up to 2 sockets

function send(ws, obj){
  if(ws.readyState === 1) ws.send(JSON.stringify(obj));
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if(msg.type === 'join'){
      const roomId = String(msg.room || '').trim().toUpperCase().slice(0, 12);
      if(!roomId){ send(ws, { type: 'error', message: 'Пустой код комнаты' }); return; }

      let room = rooms.get(roomId);
      if(!room){ room = []; rooms.set(roomId, room); }

      if(room.length >= 2){
        send(ws, { type: 'error', message: 'Комната уже заполнена' });
        return;
      }

      ws.roomId = roomId;
      ws.playerIndex = room.length;
      room.push(ws);
      send(ws, { type: 'joined', youAre: ws.playerIndex, room: roomId });

      if(room.length === 2){
        room.forEach(s => send(s, { type: 'start' }));
      }
      return;
    }

    if(msg.type === 'move'){
      const room = rooms.get(ws.roomId);
      if(!room) return;
      room.forEach(s => { if(s !== ws) send(s, { type: 'move', idx: msg.idx }); });
      return;
    }

    if(msg.type === 'restart'){
      const room = rooms.get(ws.roomId);
      if(!room) return;
      room.forEach(s => { if(s !== ws) send(s, { type: 'restart' }); });
      return;
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomId);
    if(!room) return;
    const i = room.indexOf(ws);
    if(i !== -1) room.splice(i, 1);
    room.forEach(s => send(s, { type: 'peer-left' }));
    if(room.length === 0) rooms.delete(ws.roomId);
  });
});

// drop dead connections every 30s
setInterval(() => {
  wss.clients.forEach(ws => {
    if(ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

console.log('Toguz Korgool relay server listening on port', PORT);
