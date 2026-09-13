const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {}; // roomId -> { players: [], board, turn, gameOver }
const GRID_SIZE = 15;

io.on('connection', (socket) => {
  socket.on('joinRoom', (roomId) => {
    let room = rooms[roomId];
    if (!room) {
      room = {
        id: roomId,
        players: [],
        board: Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0)),
        turn: 1, // 1: 흑, 2: 백
        gameOver: false
      };
      rooms[roomId] = room;
    }

    if (room.players.length >= 2 && !room.players.some(p => p.id === socket.id)) {
      socket.emit('roomFull');
      return;
    }

    socket.join(roomId);
    if (!room.players.some(p => p.id === socket.id)) {
      const role = room.players.length === 0 ? 1 : 2;
      room.players.push({ id: socket.id, role });
    }

    const myRole = room.players.find(p => p.id === socket.id).role;
    socket.emit('init', { role: myRole, board: room.board, turn: room.turn, roomId });
    io.to(roomId).emit('playerCount', room.players.length);
  });

  socket.on('makeMove', ({ roomId, r, c }) => {
    const room = rooms[roomId];
    if (!room || room.gameOver || room.players.length < 2) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.role !== room.turn) return;
    if (room.board[r][c] !== 0) return;

    // 20% 확률 태양 돌 각성
    const isSuperSun = Math.random() < 0.20;
    room.board[r][c] = isSuperSun ? player.role * 10 : player.role;

    let eventLog = isSuperSun ? '초거대 태양 각성!' : '';

    // 1. 태양계 발동 체크
    if (checkSolarSystem(room.board, player.role)) {
      room.gameOver = true;
      io.to(roomId).emit('updateState', {
        board: room.board,
        turn: room.turn,
        log: `${player.role === 1 ? '흑돌' : '백돌'} [태양계 발동] 즉시 승리!`,
        winner: player.role
      });
      return;
    }

    // 2. 십자성 80% 강탈 체크
    if (!isSuperSun && checkCrossSteal(room.board, r, c, player.role)) {
      const stolen = executeSteal(room.board, player.role);
      eventLog = `십자성 완성! 상대 돌의 80%(${stolen}개) 강탈!`;
    }

    // 3. 일반 5목 체크
    if (!isSuperSun && checkFive(room.board, r, c, player.role)) {
      room.gameOver = true;
      io.to(roomId).emit('updateState', {
        board: room.board,
        turn: room.turn,
        log: `${player.role === 1 ? '흑돌' : '백돌'} 5목 완성 승리!`,
        winner: player.role
      });
      return;
    }

    room.turn = room.turn === 1 ? 2 : 1;
    io.to(roomId).emit('updateState', {
      board: room.board,
      turn: room.turn,
      log: eventLog,
      winner: null
    });
  });

  socket.on('disconnect', () => {
    for (const [roomId, room] of Object.entries(rooms)) {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        io.to(roomId).emit('playerCount', room.players.length);
        if (room.players.length === 0) delete rooms[roomId];
        break;
      }
    }
  });
});

function checkSolarSystem(board, p) {
  const sunVal = p * 10;
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (board[r][c] === sunVal) {
        if (c > 0 && c < GRID_SIZE - 1 && board[r][c-1] === p && board[r][c+1] === p) return true;
        if (r > 0 && r < GRID_SIZE - 1 && board[r-1][c] === p && board[r+1][c] === p) return true;
      }
    }
  }
  return false;
}

function checkCrossSteal(board, r, c, p) {
  if (r > 0 && r < GRID_SIZE - 1 && c > 0 && c < GRID_SIZE - 1) {
    return board[r-1][c] === p && board[r+1][c] === p && board[r][c-1] === p && board[r][c+1] === p;
  }
  return false;
}

function executeSteal(board, p) {
  const opp = p === 1 ? 2 : 1;
  let oppStones = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (board[r][c] === opp) oppStones.push({ r, c });
    }
  }
  const stealCount = Math.floor(oppStones.length * 0.8);
  oppStones.sort(() => Math.random() - 0.5);
  for (let i = 0; i < stealCount; i++) {
    board[oppStones[i].r][oppStones[i].c] = p;
  }
  return stealCount;
}

function checkFive(board, r, c, p) {
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (let [dr, dc] of dirs) {
    let count = 1;
    for (let step = 1; step < 5; step++) {
      let nr = r + dr * step, nc = c + dc * step;
      if (nr < 0 || nr >= GRID_SIZE || nc < 0 || nc >= GRID_SIZE || board[nr][nc] !== p) break;
      count++;
    }
    for (let step = 1; step < 5; step++) {
      let nr = r - dr * step, nc = c - dc * step;
      if (nr < 0 || nr >= GRID_SIZE || nc < 0 || nc >= GRID_SIZE || board[nr][nc] !== p) break;
      count++;
    }
    if (count >= 5) return true;
  }
  return false;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));