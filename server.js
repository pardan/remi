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
            const state = room.game.getStateForPlayer(index);
            state.isHost = (index === room.hostIndex);
            socket.emit('gameState', state);
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

    room.playerSockets.forEach((socket, index) => {
        if (socket && socket.connected) {
            socket.emit('lobbyUpdate', { ...lobbyData, isHost: index === room.hostIndex });
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

function replacePlayerWithBot(roomCode, playerIndex) {
    const room = rooms.get(roomCode);
    if (!room || !room.game) return;

    const oldName = room.players[playerIndex]?.name || `Player ${playerIndex}`;
    const botName = `🤖 ${oldName}`;

    // Create bot at the same index
    const bot = new serverBot(botName, playerIndex, room, (bIdx, axn, pyld) => handleGameAction(roomCode, bIdx, axn, pyld));
    room.players[playerIndex] = { name: botName, socketId: bot.socketId };
    room.playerSockets[playerIndex] = bot;
    room.isBotMode = true;

    // Sync name to game state
    if (room.game.players[playerIndex]) {
        room.game.players[playerIndex].name = botName;
    }

    // If the host left, transfer host to first available human player
    if (room.hostIndex === playerIndex) {
        const newHostIdx = room.playerSockets.findIndex((s, i) => s && s.connected && !s.doAction && i !== playerIndex);
        if (newHostIdx !== -1) {
            room.hostIndex = newHostIdx;
            console.log(`[Room ${roomCode}] Host transferred to Player ${newHostIdx} (${room.players[newHostIdx].name})`);
        }
    }

    // Notify remaining human players
    room.playerSockets.forEach((s, i) => {
        if (s && s.connected && !s.doAction) {
            s.emit('playerReplaced', { oldName, botName, playerIndex });
        }
    });

    console.log(`[Room ${roomCode}] ${oldName} replaced by bot at index ${playerIndex}`);

    // If the game is in 'gameover' phase, the bot's emit handler will auto-vote for next round
    // Otherwise, broadcast state so the bot can play if it's their turn
    broadcastGameState(roomCode);

    // Show notification popup to all human players
    room.playerSockets.forEach((s) => {
        if (s && s.connected && !s.doAction) {
            s.emit('playerNotification', {
                title: '👋 Pemain Keluar',
                message: `${oldName} keluar dari room dan digantikan oleh Bot.`
            });
        }
    });
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
        console.log(`[ActionFailed] Player ${playerIndex} (Bot? ${!(!room.playerSockets[playerIndex] || !room.playerSockets[playerIndex].doAction)}) failed to ${action}: ${result.reason}`);
        const s = room.playerSockets[playerIndex];
        if (s && s.connected && !s.doAction) { // Real socket
            s.emit('actionResult', { success: false, reason: result.reason });
        }
        return;
    }

    // Validate cekih declarations after every successful action
    if (room.game) {
        room.game.validateCekihDeclarations();
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
            isBotMode: false,
            hostIndex: 0
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
            isBotMode: true,
            hostIndex: 0
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
            // New Logic: Ask Host to admit
            const hostSocket = room.playerSockets[room.hostIndex];
            if (hostSocket && hostSocket.connected && !hostSocket.doAction) { // Ensure host is a real player
                hostSocket.emit('lateJoinRequest', {
                    playerName,
                    socketId: socket.id,
                    players: room.players.map((p, i) => ({ id: i, name: p.name })) // Send current players list
                });
                socket.emit('waitingForAdmit');
                // Temporarily store join data
                socket.pendingName = playerName;
                socket.pendingRoomCode = code;
                return;
            } else {
                socket.emit('error', { message: 'Game sudah dimulai dan Host tidak tersedia untuk memberikan ijin.' });
                return;
            }
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
            fillBotsAndStart(code);
        }
    });

    // HOST STARTS GAME (with 2-3 players + bots)
    socket.on('hostStartGame', () => {
        if (!socket.roomCode) return;
        const room = rooms.get(socket.roomCode);
        if (!room || room.started) return;
        if (socket.playerIndex !== room.hostIndex) {
            socket.emit('error', { message: 'Hanya host yang bisa memulai game.' });
            return;
        }
        if (room.players.length < 2) {
            socket.emit('error', { message: 'Minimal 2 pemain untuk memulai.' });
            return;
        }
        fillBotsAndStart(socket.roomCode);
    });

    // HOST ADMITS LATE JOIN
    socket.on('admitResponse', ({ joiningSocketId, action, replaceIndex }) => {
        const admitRoom = rooms.get(socket.roomCode);
        if (!admitRoom || socket.playerIndex !== admitRoom.hostIndex) return; // Only host
        const room = rooms.get(socket.roomCode);
        if (!room) return;

        // Find the joining socket across all connected clients
        const joiningSocket = io.sockets.sockets.get(joiningSocketId);
        if (!joiningSocket || joiningSocket.pendingRoomCode !== socket.roomCode) return;

        if (action === 'refuse') {
            joiningSocket.emit('lateJoinRejected', { message: 'Host menolak permintaan bergabung Anda.' });
            delete joiningSocket.pendingName;
            delete joiningSocket.pendingRoomCode;
            return;
        }

        if (action === 'admit') {
            const oldSocket = room.playerSockets[replaceIndex];

            // Disconnect old socket if it's a real player, or just clean up if bot
            if (oldSocket && oldSocket.id !== joiningSocketId) {
                if (oldSocket.doAction) {
                    oldSocket.connected = false; // Disable bot
                } else {
                    oldSocket.emit('roomClosed', { reason: 'Anda telah digantikan oleh pemain baru.' });
                    oldSocket.leave(socket.roomCode);
                    delete oldSocket.roomCode;
                    delete oldSocket.playerIndex;
                }
            }

            // Setup new player — inherits score and hand seamlessly
            joiningSocket.join(socket.roomCode);
            joiningSocket.roomCode = socket.roomCode;
            joiningSocket.playerIndex = replaceIndex;

            room.players[replaceIndex] = { name: joiningSocket.pendingName, socketId: joiningSocket.id };
            room.playerSockets[replaceIndex] = joiningSocket;

            // Sync name to game state
            if (room.game && room.game.players[replaceIndex]) {
                room.game.players[replaceIndex].name = joiningSocket.pendingName;
            }

            delete joiningSocket.pendingName;
            delete joiningSocket.pendingRoomCode;

            console.log(`[Room ${socket.roomCode}] ${room.players[replaceIndex].name} admitted replacing Player ${replaceIndex}`);
            joiningSocket.emit('joinedRoom', { roomCode: socket.roomCode, playerIndex: replaceIndex });
            joiningSocket.emit('gameStarted', { playerIndex: replaceIndex });

            // Notify all players and broadcast current game state (no restart)
            room.playerSockets.forEach((s, i) => {
                if (s && s.connected && !s.doAction && i !== replaceIndex) {
                    s.emit('playerReplaced', { oldName: '(bot)', botName: joiningSocket.pendingName || room.players[replaceIndex].name, playerIndex: replaceIndex });
                }
            });
            broadcastGameState(socket.roomCode);

            // Show notification popup to all human players
            const joinedName = room.players[replaceIndex].name;
            room.playerSockets.forEach((s) => {
                if (s && s.connected && !s.doAction) {
                    s.emit('playerNotification', {
                        title: '👋 Pemain Bergabung',
                        message: `${joinedName} bergabung ke room!`
                    });
                }
            });
        }
    });

    // ======= GAME ACTIONS (Routes to handleGameAction) =======

    socket.on('initialDiscard', (payload) => handleGameAction(socket.roomCode, socket.playerIndex, 'initialDiscard', payload));
    socket.on('drawFromDeck', () => handleGameAction(socket.roomCode, socket.playerIndex, 'drawFromDeck'));
    socket.on('drawFromDiscard', (payload) => handleGameAction(socket.roomCode, socket.playerIndex, 'drawFromDiscard', payload));
    socket.on('playMeld', (payload) => handleGameAction(socket.roomCode, socket.playerIndex, 'playMeld', payload));
    socket.on('discard', (payload) => handleGameAction(socket.roomCode, socket.playerIndex, 'discard', payload));
    socket.on('requestNextRound', () => handleGameAction(socket.roomCode, socket.playerIndex, 'requestNextRound'));

    // DECLARE CEKIH
    socket.on('declareCekih', () => {
        if (!socket.roomCode) return;
        const room = rooms.get(socket.roomCode);
        if (!room || !room.game) return;

        const result = room.game.declareCekih(socket.playerIndex);
        if (result.success) {
            broadcastGameState(socket.roomCode);
        } else {
            socket.emit('actionResult', { success: false, reason: result.reason });
        }
    });

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

    // HOST: RESTART ROUND (re-deal, keep scores and round number)
    socket.on('hostRestartRound', () => {
        if (!socket.roomCode) return;
        const room = rooms.get(socket.roomCode);
        if (!room || !room.game) return;
        if (socket.playerIndex !== room.hostIndex) return;

        console.log(`[Room ${socket.roomCode}] Host restarted round`);
        room.game.initRound();
        room.game.deal();
        room.nextRoundVotes = null;

        room.playerSockets.forEach((s, idx) => {
            if (s && s.connected) {
                s.emit('roundRestarted');
                s.emit('gameStarted', { playerIndex: idx });
            }
        });
        broadcastGameState(socket.roomCode);
    });

    // HOST: RESTART GAME (reset all scores, round 1)
    socket.on('hostRestartGame', () => {
        if (!socket.roomCode) return;
        const room = rooms.get(socket.roomCode);
        if (!room || !room.game) return;
        if (socket.playerIndex !== room.hostIndex) return;

        console.log(`[Room ${socket.roomCode}] Host restarted game`);
        room.game.players.forEach(p => p.score = 0);
        room.game.round = 1;
        room.game.initRound();
        room.game.deal();
        room.nextRoundVotes = null;

        room.playerSockets.forEach((s, idx) => {
            if (s && s.connected) {
                s.emit('gameRestarted');
                s.emit('gameStarted', { playerIndex: idx });
            }
        });
        broadcastGameState(socket.roomCode);
    });

    // ======= DISCONNECT =======

    socket.on('disconnect', () => {
        console.log(`[Disconnect] ${socket.id}`);
        if (socket.roomCode) {
            const roomCode = socket.roomCode;
            const room = rooms.get(roomCode);
            if (room) {
                const playerName = room.players[socket.playerIndex]?.name || 'Unknown';
                console.log(`[Room ${roomCode}] ${playerName} disconnected`);

                if (room.started) {
                    // Game in progress — check if any human players would remain
                    const remainingHumans = room.playerSockets.filter((s, i) => s && s.connected && !s.doAction && i !== socket.playerIndex);

                    if (remainingHumans.length === 0) {
                        // No humans left — close room
                        cleanupRoom(roomCode);
                    } else {
                        // Replace disconnected player with bot
                        replacePlayerWithBot(roomCode, socket.playerIndex);
                    }
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
                        rooms.delete(roomCode);
                    } else {
                        broadcastLobby(roomCode);
                    }
                }
            }
        }
    });

    socket.on('leaveRoom', () => {
        if (socket.roomCode) {
            const roomCode = socket.roomCode;
            const room = rooms.get(roomCode);
            if (room && room.started) {
                // Game in progress — check if any human players would remain
                const remainingHumans = room.playerSockets.filter((s, i) => s && s.connected && !s.doAction && i !== socket.playerIndex);

                if (remainingHumans.length === 0) {
                    cleanupRoom(roomCode);
                } else {
                    replacePlayerWithBot(roomCode, socket.playerIndex);
                }
            } else if (room) {
                socket.leave(roomCode);
                room.playerSockets[socket.playerIndex] = null;
                room.players.splice(socket.playerIndex, 1);
                room.playerSockets = room.playerSockets.filter(Boolean);
                while (room.playerSockets.length < NUM_PLAYERS) room.playerSockets.push(null);
                room.players.forEach((p, i) => {
                    const s = room.playerSockets[i];
                    if (s) s.playerIndex = i;
                });
                if (room.players.length === 0) rooms.delete(roomCode);
                else broadcastLobby(roomCode);
            }
            delete socket.roomCode;
            delete socket.playerIndex;
        }
    });
});

// ======= START GAME =======

function fillBotsAndStart(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;

    // Fill remaining slots with bots
    const botsNeeded = NUM_PLAYERS - room.players.length;
    if (botsNeeded > 0) {
        room.isBotMode = true;
        let botNum = 1;
        for (let i = room.players.length; i < NUM_PLAYERS; i++) {
            const bot = new serverBot(`\uD83E\uDD16 Bot ${botNum}`, i, room, (bIdx, axn, pyld) => handleGameAction(roomCode, bIdx, axn, pyld));
            room.players.push({ name: bot.name, socketId: bot.socketId });
            room.playerSockets[i] = bot;
            botNum++;
        }
    }

    startGame(roomCode);
}

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
