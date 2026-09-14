const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
const GRID_SIZE = 15;

function broadcastRoomList() {
  const roomList = Object.values(rooms).filter(r => r.players.length > 0).map(r => ({
    id: r.id, name: r.name || '카오스 오목방', players: r.players.length, isPlaying: r.players.length >= 2
  }));
  io.emit('roomList', roomList);
}

io.on('connection', (socket) => {
  broadcastRoomList();

  socket.on('createRoom', (roomName) => {
    const roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    rooms[roomId] = { id: roomId, name: roomName || '카오스 오목방', players: [], board: Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0)), turn: 1, gameOver: false };
    socket.emit('roomCreated', roomId);
    broadcastRoomList();
    setTimeout(() => { if (rooms[roomId] && rooms[roomId].players.length === 0) delete rooms[roomId]; }, 10000);
  });

  socket.on('joinRoom', ({ roomId, nickname }) => {
    let room = rooms[roomId];
    if (!room) {
      room = { id: roomId, name: '비밀 방', players: [], board: Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0)), turn: 1, gameOver: false };
      rooms[roomId] = room;
    }
    if (room.players.length >= 2 && !room.players.some(p => p.id === socket.id)) return socket.emit('roomFull');
    socket.join(roomId);
    
    if (!room.players.some(p => p.id === socket.id)) {
      const role = room.players.map(p => p.role).includes(1) ? 2 : 1; 
      room.players.push({ id: socket.id, role, nickname: (nickname && nickname.trim()) ? nickname.trim().substring(0, 8) : (role === 1 ? '흑돌' : '백돌') });
    }
    
    const myPlayer = room.players.find(p => p.id === socket.id);
    socket.emit('init', { role: myPlayer.role, board: room.board, turn: room.turn, roomId, players: room.players.map(p => ({ role: p.role, nickname: p.nickname })) });
    io.to(roomId).emit('updatePlayers', room.players.map(p => ({ role: p.role, nickname: p.nickname })));
    broadcastRoomList();
  });

  socket.on('makeMove', ({ roomId, r, c }) => {
    const room = rooms[roomId];
    if (!room || room.gameOver || room.players.length < 2) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.role !== room.turn || room.board[r][c] !== 0) return;

    let eventLog = '';
    const isCorner = (r === 0 || r === GRID_SIZE - 1) && (c === 0 || c === GRID_SIZE - 1);
    
    if (isCorner) { room.board[r][c] = player.role * 100; eventLog = `🔨 [${player.nickname}] 꼭짓점 각성! 철퇴 크러셔!`; } 
    else { room.board[r][c] = player.role; }

    if (checkAndFuseSun(room.board, player.role)) eventLog = `☀️ [${player.nickname}] '해 일(日)' 자 완성! 거대 태양 융합!`;
    if (checkSolarSystem(room.board, player.role)) {
      room.gameOver = true;
      return io.to(roomId).emit('updateState', { board: room.board, turn: room.turn, log: `🌌 [${player.nickname}] 태양계 발동 즉시 승리!`, winner: player.role, winnerName: player.nickname });
    }
    if (!isCorner && checkCrossSteal(room.board, r, c, player.role)) {
      eventLog = `⚡ [${player.nickname}] 십자성 완성! 상대 돌 80%(${executeSteal(room.board, player.role)}개) 강탈!`;
    }
    if (!isCorner && checkFive(room.board, r, c, player.role)) {
      room.gameOver = true;
      return io.to(roomId).emit('updateState', { board: room.board, turn: room.turn, log: `🎉 [${player.nickname}] 5목 완성 승리!`, winner: player.role, winnerName: player.nickname });
    }

    room.turn = room.turn === 1 ? 2 : 1;
    io.to(roomId).emit('updateState', { board: room.board, turn: room.turn, log: eventLog, winner: null });
  });

  // ★ 1. 당구 알까기 시작 신호
  socket.on('startPhysics', ({ roomId, fromR, fromC, vx, vy }) => {
    const room = rooms[roomId];
    if (!room || room.gameOver || room.players.length < 2) return;
    io.to(roomId).emit('startPhysicsAnimation', { fromR, fromC, vx, vy });
  });

  // ★ 2. 당구 알까기 멈춘 후 스냅 정렬
  socket.on('finalizePhysics', ({ roomId, newBoard }) => {
    const room = rooms[roomId];
    if (!room || room.gameOver || room.players.length < 2) return;
    const player = room.players.find(p => p.id === socket.id);
    room.board = newBoard;
    room.turn = room.turn === 1 ? 2 : 1;
    io.to(roomId).emit('updateState', { board: room.board, turn: room.turn, log: `🎳 [${player.nickname}] 알까기 충돌 완료! 바둑판 재정렬됨.`, winner: null });
  });

  socket.on('earthquakeMove', ({ roomId, type, index, dir }) => {
    const room = rooms[roomId];
    if (!room || room.gameOver || room.players.length < 2) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.role !== room.turn) return;

    if (type === 'row') {
      const row = room.board[index];
      if (dir === 1) { row.pop(); row.unshift(0); } else { row.shift(); row.push(0); }
    } else {
      let col = [];
      for (let r = 0; r < GRID_SIZE; r++) col.push(room.board[r][index]);
      if (dir === 1) { col.pop(); col.unshift(0); } else { col.shift(); col.push(0); }
      for (let r = 0; r < GRID_SIZE; r++) room.board[r][index] = col[r];
    }
    room.turn = room.turn === 1 ? 2 : 1;
    io.to(roomId).emit('updateState', { board: room.board, turn: room.turn, log: `🌋 [${player.nickname}] 지각 변동 발동!`, winner: null, quake: true });
  });

  socket.on('surrender', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.gameOver || room.players.length < 2) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    const winnerRole = player.role === 1 ? 2 : 1;
    const winnerName = room.players.find(p => p.role === winnerRole)?.nickname || '상대방';

    room.gameOver = true;
    io.to(roomId).emit('updateState', { board: room.board, turn: room.turn, log: `🏳️ [${player.nickname}] 님이 기권했습니다!`, winner: winnerRole, winnerName: winnerName });
  });

  socket.on('disconnect', () => {
    for (const [roomId, room] of Object.entries(rooms)) {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        io.to(roomId).emit('updatePlayers', room.players.map(p => ({ role: p.role, nickname: p.nickname })));
        if (room.players.length === 0) delete rooms[roomId]; 
        broadcastRoomList();
        break;
      }
    }
  });
});

function checkAndFuseSun(b, p) {
  for (let r=0; r<=GRID_SIZE-3; r++) for (let c=0; c<=GRID_SIZE-2; c++)
    if (b[r][c]===p&&b[r][c+1]===p&&b[r+1][c]===p&&b[r+1][c+1]===p&&b[r+2][c]===p&&b[r+2][c+1]===p) {
      b[r][c]=0; b[r][c+1]=0; b[r+1][c]=0; b[r+1][c+1]=0; b[r+2][c]=0; b[r+2][c+1]=0; b[r+1][c]=p*10; return true;
    } return false;
}
function checkSolarSystem(b, p) {
  for (let r=0; r<GRID_SIZE; r++) for (let c=0; c<GRID_SIZE; c++)
    if (b[r][c]===p*10) {
      if (c>0&&c<GRID_SIZE-1&&b[r][c-1]===p&&b[r][c+1]===p) return true;
      if (r>0&&r<GRID_SIZE-1&&b[r-1][c]===p&&b[r+1][c]===p) return true;
    } return false;
}
function checkCrossSteal(b, r, c, p) {
  if (r>0&&r<GRID_SIZE-1&&c>0&&c<GRID_SIZE-1) return b[r-1][c]===p&&b[r+1][c]===p&&b[r][c-1]===p&&b[r][c+1]===p; return false;
}
function executeSteal(b, p) {
  let opp = p===1?2:1, st = [];
  for (let r=0; r<GRID_SIZE; r++) for (let c=0; c<GRID_SIZE; c++) if (b[r][c]===opp) st.push({r,c});
  let count = Math.floor(st.length*0.8); st.sort(()=>Math.random()-0.5);
  for (let i=0; i<count; i++) b[st[i].r][st[i].c]=p; return count;
}
function checkFive(b, r, c, p) {
  for (let [dr, dc] of [[1,0],[0,1],[1,1],[1,-1]]) {
    let count = 1;
    for (let s=1; s<5; s++) { let nr=r+dr*s, nc=c+dc*s; if (nr<0||nr>=GRID_SIZE||nc<0||nc>=GRID_SIZE||b[nr][nc]!==p) break; count++; }
    for (let s=1; s<5; s++) { let nr=r-dr*s, nc=c-dc*s; if (nr<0||nr>=GRID_SIZE||nc<0||nc>=GRID_SIZE||b[nr][nc]!==p) break; count++; }
    if (count>=5) return true;
  } return false;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));