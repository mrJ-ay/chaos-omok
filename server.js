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

io.on('connection', (socket) => {
  socket.on('joinRoom', ({ roomId, nickname }) => {
    let room = rooms[roomId];
    if (!room) {
      room = {
        id: roomId,
        players: [],
        board: Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0)),
        turn: 1,
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
      const defaultName = role === 1 ? '흑돌 플레이어' : '백돌 플레이어';
      room.players.push({
        id: socket.id,
        role,
        nickname: (nickname && nickname.trim()) ? nickname.trim().substring(0, 8) : defaultName
      });
    }

    const myPlayer = room.players.find(p => p.id === socket.id);
    socket.emit('init', {
      role: myPlayer.role,
      board: room.board,
      turn: room.turn,
      roomId,
      players: room.players.map(p => ({ role: p.role, nickname: p.nickname }))
    });

    io.to(roomId).emit('updatePlayers', room.players.map(p => ({ role: p.role, nickname: p.nickname })));
  });

  // 일반 착수
  socket.on('makeMove', ({ roomId, r, c }) => {
    const room = rooms[roomId];
    if (!room || room.gameOver || room.players.length < 2) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.role !== room.turn || room.board[r][c] !== 0) return;

    let eventLog = '';

    // 꼭짓점 각성 체크 (크러셔: 100, 200)
    const isCorner = (r === 0 || r === GRID_SIZE - 1) && (c === 0 || c === GRID_SIZE - 1);
    if (isCorner) {
      room.board[r][c] = player.role * 100;
      eventLog = `🔨 [${player.nickname}] 꼭짓점 각성! 철퇴 크러셔 돌 소환!`;
    } else {
      room.board[r][c] = player.role;
    }

    // 日(해 일)자 완성 검사 -> 태양 융합
    const sunPos = checkAndFuseSun(room.board, player.role);
    if (sunPos) eventLog = `☀️ [${player.nickname}] '해 일(日)' 자 완성! 거대 태양 융합!`;

    // 태양계 발동 검사
    if (checkSolarSystem(room.board, player.role)) {
      room.gameOver = true;
      io.to(roomId).emit('updateState', {
        board: room.board, turn: room.turn,
        log: `🌌 [${player.nickname}] 태양계 발동 즉시 승리!`,
        winner: player.role,
        winnerName: player.nickname
      });
      return;
    }

    // 십자성 80% 강탈
    if (!isCorner && checkCrossSteal(room.board, r, c, player.role)) {
      const stolen = executeSteal(room.board, player.role);
      eventLog = `⚡ [${player.nickname}] 십자성 완성! 상대 돌 80%(${stolen}개) 강탈!`;
    }

    // 일반 5목 체크
    if (!isCorner && checkFive(room.board, r, c, player.role)) {
      room.gameOver = true;
      io.to(roomId).emit('updateState', {
        board: room.board, turn: room.turn,
        log: `🎉 [${player.nickname}] 5목 완성 승리!`,
        winner: player.role,
        winnerName: player.nickname
      });
      return;
    }

    room.turn = room.turn === 1 ? 2 : 1;
    io.to(roomId).emit('updateState', { board: room.board, turn: room.turn, log: eventLog, winner: null });
  });

  // 크러셔 밀어내기
  socket.on('pushMove', ({ roomId, fromR, fromC, dr, dc }) => {
    const room = rooms[roomId];
    if (!room || room.gameOver || room.players.length < 2) return;

    const player = room.players.find(p => p.id === socket.id);
    const crusherVal = player.role * 100;
    if (!player || player.role !== room.turn || room.board[fromR][fromC] !== crusherVal) return;

    let r = fromR + dr, c = fromC + dc;
    let line = [];
    while (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) {
      line.push({ r, c, val: room.board[r][c] });
      r += dr;
      c += dc;
    }

    for (let i = line.length - 1; i > 0; i--) {
      line[i].val = line[i - 1].val;
    }
    line[0].val = 0;

    room.board[fromR][fromC] = 0;
    room.board[fromR + dr][fromC + dc] = crusherVal;

    for (let i = 1; i < line.length; i++) {
      room.board[line[i].r][line[i].c] = line[i].val;
    }

    room.turn = room.turn === 1 ? 2 : 1;
    io.to(roomId).emit('updateState', {
      board: room.board,
      turn: room.turn,
      log: `🔨 [${player.nickname}] 크러셔 돌진으로 상대 돌을 낙사시켰습니다!`,
      winner: null
    });
  });

  socket.on('disconnect', () => {
    for (const [roomId, room] of Object.entries(rooms)) {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        io.to(roomId).emit('updatePlayers', room.players.map(p => ({ role: p.role, nickname: p.nickname })));
        if (room.players.length === 0) delete rooms[roomId];
        break;
      }
    }
  });
});

function checkAndFuseSun(board, p) {
  for (let r = 0; r <= GRID_SIZE - 3; r++) {
    for (let c = 0; c <= GRID_SIZE - 2; c++) {
      if (board[r][c] === p && board[r][c+1] === p &&
          board[r+1][c] === p && board[r+1][c+1] === p &&
          board[r+2][c] === p && board[r+2][c+1] === p) {
        board[r][c] = 0; board[r][c+1] = 0;
        board[r+1][c] = 0; board[r+1][c+1] = 0;
        board[r+2][c] = 0; board[r+2][c+1] = 0;
        board[r+1][c] = p * 10;
        return { r: r+1, c };
      }
    }
  }
  return null;
}

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
  const count = Math.floor(oppStones.length * 0.8);
  oppStones.sort(() => Math.random() - 0.5);
  for (let i = 0; i < count; i++) {
    board[oppStones[i].r][oppStones[i].c] = p;
  }
  return count;
}

function checkFive(board, r, c, p) {
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (let [dr, dc] of dirs) {
    let count = 1;
    for (let s = 1; s < 5; s++) {
      let nr = r + dr * s, nc = c + dc * s;
      if (nr < 0 || nr >= GRID_SIZE || nc < 0 || nc >= GRID_SIZE || board[nr][nc] !== p) break;
      count++;
    }
    for (let s = 1; s < 5; s++) {
      let nr = r - dr * s, nc = c - dc * s;
      if (nr < 0 || nr >= GRID_SIZE || nc < 0 || nc >= GRID_SIZE || board[nr][nc] !== p) break;
      count++;
    }
    if (count >= 5) return true;
  }
  return false;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));