// ============================================================
// REMI INDONESIA - Multiplayer Server
// Node.js + Express + Socket.IO
// ============================================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { ServerGame, NUM_PLAYERS, isFaceRank } = require('./server-game');
const serverBot = require('./server-bot');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

// Serve static files from public/
app.use(express.static(path.join(__dirname, 'public')));

// ======= ROOM MANAGEMENT =======

const rooms = new Map(); // roomCode -> { players, game, playerSockets }

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do {
        code = '';
        for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    } while (rooms.has(code));
    return code;
}

function broadcastGameState(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || !room.game) return;

    room.playerSockets.forEach((socket, index) => {
        if (socket && socket.connected) {
            socket.emit('gameState', room.game.getStateForPlayer(index));
        }
    });
}

function broadcastLobby(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;

    const lobbyData = {
        roomCode,
        players: room.players.map((p, i) => ({ id: i, name: p.name, connected: !!room.playerSockets[i] })),
        count: room.players.length,
        needed: NUM_PLAYERS
    };

    room.playerSockets.forEach(socket => {
        if (socket && socket.connected) {
            socket.emit('lobbyUpdate', lobbyData);
        }
    });
}

function cleanupRoom(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;

    room.playerSockets.forEach(socket => {
        if (socket && socket.connected) {
            socket.emit('roomClosed', { reason: 'Pemain keluar, room ditutup.' });
            if (socket.leave) socket.leave(roomCode);
            delete socket.roomCode;
            delete socket.playerIndex;
            if (socket.doAction) socket.connected = false; // Disable bot
        }
    });

    rooms.delete(roomCode);
    console.log(`[Room ${roomCode}] Closed`);
}

// ======= GAME ACTION HANDLER (Used by Sockets & Bots) =======

function handleGameAction(roomCode, playerIndex, action, payload = {}) {
    const room = rooms.get(roomCode);
    if (!room || !room.game) return;

    let result;
    if (action === 'drawFromDeck') result = room.game.drawFromDeck(playerIndex);
    else if (action === 'drawFromDiscard') result = room.game.drawFromDiscard(playerIndex, payload.count);
    else if (action === 'playMeld') result = room.game.playMeld(playerIndex, payload.cardIds);
    else if (action === 'discard') result = room.game.discard(playerIndex, payload.cardId);
    else if (action === 'requestNextRound') {
        if (!room.nextRoundVotes) room.nextRoundVotes = new Set();
        room.nextRoundVotes.add(playerIndex);

        // In bot mode, auto-add all bot votes
        if (room.isBotMode) {
            room.playerSockets.forEach((s, i) => {
                if (s && s.doAction) room.nextRoundVotes.add(i);
            });
        }

        // Broadcast vote count
        room.playerSockets.forEach(s => {
            if (s && s.connected) {
                s.emit('nextRoundVotes', { count: room.nextRoundVotes.size, needed: NUM_PLAYERS });
            }
        });

        // All voted — start next round
        if (room.nextRoundVotes.size >= NUM_PLAYERS) {
            room.nextRoundVotes = null;
            room.game.round++;
            room.game.initRound();
            room.game.deal();
            broadcastGameState(roomCode);
        }
        return;
    }

    if (result && result.gameOver) {
        broadcastGameOver(roomCode, result);
        return;
    }

    if (result && !result.success) {
        const s = room.playerSockets[playerIndex];
        if (s && s.connected && !s.doAction) { // Real socket
            s.emit('actionResult', { success: false, reason: result.reason });
        }
        return;
    }

    broadcastGameState(roomCode);

    // Joker discard penalty notification
    if (action === 'discard' && result && result.jokerPenalty) {
        const playerName = room.players[playerIndex]?.name || `Player ${playerIndex}`;
        room.playerSockets.forEach((s) => {
            if (s && s.connected) {
                s.emit('jokerDiscarded', {
                    playerName,
                    penalty: result.jokerPenalty,
                    card: result.discardedCard
                });
            }
        });
    }

    // Special logic for joker reveal
    if (action === 'discard' && result && result.jokerRevealData) {
        setTimeout(() => {
            room.playerSockets.forEach((s) => {
                if (s && s.connected) {
                    s.emit('jokerRevealed', result.jokerRevealData);
                }
            });
            broadcastGameState(roomCode);
        }, 1500);
    }
}

// ======= SOCKET.IO EVENTS =======

io.on('connection', (socket) => {
    console.log(`[Connect] ${socket.id}`);

    // HOST GAME (MULTIPLAYER)
    socket.on('hostGame', ({ playerName }) => {
        if (socket.roomCode) {
            socket.emit('error', { message: 'Kamu sudah di room lain.' });
            return;
        }

        const roomCode = generateRoomCode();
        const room = {
            players: [{ name: playerName, socketId: socket.id }],
            playerSockets: [socket, null, null, null],
            game: null,
            started: false,
            isBotMode: false
        };

        rooms.set(roomCode, room);
        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.playerIndex = 0;

        console.log(`[Room ${roomCode}] Created by ${playerName} (Multiplayer)`);
        socket.emit('roomCreated', { roomCode, playerIndex: 0 });
        broadcastLobby(roomCode);
    });

    // HOST GAME (BOT MODE)
    socket.on('hostBotGame', ({ playerName }) => {
        if (socket.roomCode) {
            socket.emit('error', { message: 'Kamu sudah di room lain.' });
            return;
        }

        const roomCode = generateRoomCode();
        const room = {
            players: [{ name: playerName, socketId: socket.id }],
            playerSockets: [socket, null, null, null],
            game: null,
            started: false,
            isBotMode: true
        };

        rooms.set(roomCode, room);
        socket.join(roomCode);
        socket.roomCode = roomCode;
        socket.playerIndex = 0;

        // Add 3 Bots
        const botNames = ['🤖 Bot 1', '🤖 Bot 2', '🤖 Bot 3'];
        for (let i = 1; i <= 3; i++) {
            const bot = new serverBot(botNames[i - 1], i, room, (bIdx, axn, pyld) => handleGameAction(roomCode, bIdx, axn, pyld));
            room.players.push({ name: bot.name, socketId: bot.socketId });
            room.playerSockets[i] = bot;
        }

        console.log(`[Room ${roomCode}] Created by ${playerName} (BOT MODE)`);
        socket.emit('roomCreated', { roomCode, playerIndex: 0 });

        // Auto-start immediately since 4 slots are filled
        startGame(roomCode);
    });

    // JOIN GAME
    socket.on('joinGame', ({ playerName, roomCode }) => {
        if (socket.roomCode) {
            socket.emit('error', { message: 'Kamu sudah di room lain.' });
            return;
        }

        const code = roomCode.toUpperCase().trim();
        const room = rooms.get(code);

        if (!room) {
            socket.emit('error', { message: 'Room tidak ditemukan. Cek kode room.' });
            return;
        }
        if (room.started) {
            socket.emit('error', { message: 'Game sudah dimulai.' });
            return;
        }
        if (room.players.length >= NUM_PLAYERS) {
            socket.emit('error', { message: 'Room sudah penuh.' });
            return;
        }

        const playerIndex = room.players.length;
        room.players.push({ name: playerName, socketId: socket.id });
        room.playerSockets[playerIndex] = socket;

        socket.join(code);
        socket.roomCode = code;
        socket.playerIndex = playerIndex;

        console.log(`[Room ${code}] ${playerName} joined as Player ${playerIndex}`);
        socket.emit('joinedRoom', { roomCode: code, playerIndex });
        broadcastLobby(code);

        // Auto-start when 4 players
        if (room.players.length === NUM_PLAYERS) {
            startGame(code);
        }
    });

    // ======= GAME ACTIONS (Routes to handleGameAction) =======

    socket.on('initialDiscard', (payload) => handleGameAction(socket.roomCode, socket.playerIndex, 'initialDiscard', payload));
    socket.on('drawFromDeck', () => handleGameAction(socket.roomCode, socket.playerIndex, 'drawFromDeck'));
    socket.on('drawFromDiscard', (payload) => handleGameAction(socket.roomCode, socket.playerIndex, 'drawFromDiscard', payload));
    socket.on('playMeld', (payload) => handleGameAction(socket.roomCode, socket.playerIndex, 'playMeld', payload));
    socket.on('discard', (payload) => handleGameAction(socket.roomCode, socket.playerIndex, 'discard', payload));
    socket.on('requestNextRound', () => handleGameAction(socket.roomCode, socket.playerIndex, 'requestNextRound'));

    socket.on('triggerGunshot', () => {
        if (socket.roomCode) {
            const room = rooms.get(socket.roomCode);
            if (room) {
                room.playerSockets.forEach(s => {
                    if (s && s.connected) {
                        s.emit('playGunshot');
                    }
                });
            }
        }
    });

    // ======= DISCONNECT =======

    socket.on('disconnect', () => {
        console.log(`[Disconnect] ${socket.id}`);
        if (socket.roomCode) {
            const room = rooms.get(socket.roomCode);
            if (room) {
                const playerName = room.players[socket.playerIndex]?.name || 'Unknown';
                console.log(`[Room ${socket.roomCode}] ${playerName} disconnected`);

                if (room.started) {
                    // Game in progress — notify and close room
                    room.playerSockets.forEach((s, i) => {
                        if (s && s.connected && i !== socket.playerIndex && !s.doAction) {
                            s.emit('playerDisconnected', { playerName });
                        }
                    });
                    cleanupRoom(socket.roomCode);
                } else {
                    // In lobby — remove player
                    room.playerSockets[socket.playerIndex] = null;
                    room.players.splice(socket.playerIndex, 1);
                    // Re-index remaining players
                    room.playerSockets = room.playerSockets.filter(Boolean);
                    while (room.playerSockets.length < NUM_PLAYERS) room.playerSockets.push(null);
                    room.players.forEach((p, i) => {
                        const s = room.playerSockets[i];
                        if (s) s.playerIndex = i;
                    });

                    if (room.players.length === 0) {
                        rooms.delete(socket.roomCode);
                    } else {
                        broadcastLobby(socket.roomCode);
                    }
                }
            }
        }
    });

    socket.on('leaveRoom', () => {
        if (socket.roomCode) {
            const room = rooms.get(socket.roomCode);
            if (room && room.started) {
                const playerName = room.players[socket.playerIndex]?.name || 'Unknown';
                room.playerSockets.forEach((s, i) => {
                    if (s && s.connected && i !== socket.playerIndex && !s.doAction) {
                        s.emit('playerDisconnected', { playerName });
                    }
                });
                cleanupRoom(socket.roomCode);
            } else if (room) {
                socket.leave(socket.roomCode);
                room.playerSockets[socket.playerIndex] = null;
                room.players.splice(socket.playerIndex, 1);
                room.playerSockets = room.playerSockets.filter(Boolean);
                while (room.playerSockets.length < NUM_PLAYERS) room.playerSockets.push(null);
                room.players.forEach((p, i) => {
                    const s = room.playerSockets[i];
                    if (s) s.playerIndex = i;
                });
                if (room.players.length === 0) rooms.delete(socket.roomCode);
                else broadcastLobby(socket.roomCode);
            }
            delete socket.roomCode;
            delete socket.playerIndex;
        }
    });
});

// ======= START GAME =======

function startGame(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;

    const playerNames = room.players.map(p => p.name);
    room.game = new ServerGame(playerNames);
    room.game.initRound();
    room.started = true;

    console.log(`[Room ${roomCode}] Game started with ${playerNames.join(', ')}`);

    // Notify all players
    room.playerSockets.forEach((socket, index) => {
        if (socket && socket.connected) {
            socket.emit('gameStarted', { playerIndex: index });
        }
    });

    // Deal cards
    room.game.deal();
    broadcastGameState(roomCode);
}

function broadcastGameOver(roomCode, result) {
    const room = rooms.get(roomCode);
    if (!room) return;

    room.playerSockets.forEach((socket, index) => {
        if (socket && socket.connected) {
            socket.emit('gameOver', {
                winner: result.winner,
                tutupDeckCard: result.tutupDeckCard,
                scores: result.scores,
                gameState: room.game.getStateForPlayer(index)
            });
        }
    });
}

// ======= START SERVER =======

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🃏 Remi Indonesia server running on port ${PORT}`);
    console.log(`   http://localhost:${PORT}`);
});
