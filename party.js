const { ServerGame, NUM_PLAYERS, isFaceRank } = require('./server-game');
const serverBot = require('./server-bot');

class SocketWrapper {
    constructor(conn) {
        this.conn = conn;
        this.id = conn.id;
        this.connected = true;
        this.roomCode = null;
        this.playerIndex = null;
    }
    emit(event, data) {
        try {
            this.conn.send(JSON.stringify({ type: event, payload: data || {} }));
        } catch (e) {
            this.connected = false;
        }
    }
    leave() {
        // Do nothing in partykit (closing is handled externally)
    }
}

export default class RemiServer {
    constructor(room) {
        this.room = room; // This room instance
        this.state = {
            players: [], // { name, socketId }
            playerSockets: [null, null, null, null], // SocketWrapper or serverBot
            game: null,
            started: false,
            isBotMode: false,
            hostIndex: 0,
            nextRoundVotes: null
        };
        // Keep a map of raw conn.id -> SocketWrapper
        this.socketWrappers = new Map();
        // Setup a global function to allow testing if necessary

        // Lobby state (only used if this.room.id === 'lobby')
        this.activeGames = new Map();
    }

    // Load persisted lobby state when room spins up
    async onStart() {
        if (this.room.id === 'lobby') {
            const savedGames = await this.room.storage.get('activeGames');
            if (savedGames) {
                this.activeGames = new Map(savedGames);
            }
        }
    }

    // Handle HTTP requests (used for the lobby to serve room lists to clients)
    async onRequest(req) {
        if (this.room.id === 'lobby') {
            if (req.method === 'GET') {
                const rooms = Array.from(this.activeGames.values());
                return new Response(JSON.stringify(rooms), {
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            } else if (req.method === 'POST') {
                try {
                    const data = await req.json();
                    if (data.action === 'upsert') {
                        this.activeGames.set(data.room.id, data.room);
                    } else if (data.action === 'delete') {
                        this.activeGames.delete(data.roomId);
                    }
                    // Persist state across instances
                    await this.room.storage.put('activeGames', Array.from(this.activeGames.entries()));
                    return new Response('OK', { status: 200, headers: { 'Access-Control-Allow-Origin': '*' } });
                } catch (e) {
                    return new Response('Error', { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } });
                }
            } else if (req.method === 'OPTIONS') {
                return new Response(null, {
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                        'Access-Control-Allow-Headers': 'Content-Type'
                    }
                });
            }
        }
        return new Response("Not found", { status: 404 });
    }

    // Helper to notify the central lobby room about this room's state
    async notifyLobby() {
        if (this.room.id === 'lobby') return; // Don't notify self

        try {
            const lobbyParty = this.room.context.parties.main.get('lobby');

            // If room is empty, remove from public list
            if (this.state.players.length === 0) {
                await lobbyParty.fetch("/", {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'delete', roomId: this.room.id })
                });
                return;
            }

            // Otherwise, update the lobby with current info
            const hostSocket = this.state.playerSockets[this.state.hostIndex];
            const hostName = hostSocket && !hostSocket.doAction && this.state.players[this.state.hostIndex]
                ? this.state.players[this.state.hostIndex].name
                : 'Unknown';
            // Count actual human players (not bots)
            const humanCount = this.state.playerSockets.filter(s => s && s.connected && !s.doAction).length;
            const status = this.state.started ? "Bermain" : "Menunggu";

            await lobbyParty.fetch("/", {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'upsert',
                    room: {
                        id: this.room.id,
                        host: hostName,
                        humanCount: humanCount,
                        maxPlayers: NUM_PLAYERS,
                        status: status
                    }
                })
            });
        } catch (e) {
            console.error('[Lobby Sync Error]', e.message);
        }
    }

    onClose(conn) {
        const socket = this.socketWrappers.get(conn.id);
        if (socket) {
            socket.connected = false;
            this.handleDisconnect(socket);
            this.socketWrappers.delete(conn.id);
        }
    }

    onError(conn, err) {
        this.onClose(conn);
    }

    onMessage(messageStr, conn) {
        let msg;
        try {
            msg = JSON.parse(messageStr);
        } catch (e) {
            return;
        }

        const action = msg.type;
        const payload = msg.payload || {};

        let socket = this.socketWrappers.get(conn.id);
        if (!socket) {
            socket = new SocketWrapper(conn);
            this.socketWrappers.set(conn.id, socket);
        }

        // --- LOBBY EVENT TRANSLATION ---
        if (action === 'hostGame' || action === 'hostBotGame') {
            const { playerName } = payload;
            if (this.state.players.length > 0) {
                // Room already initialized (maybe by another host connection very quickly)
                return;
            }

            this.state.isBotMode = (action === 'hostBotGame');
            this.state.hostIndex = 0;

            this.state.players.push({ name: playerName, socketId: socket.id });
            this.state.playerSockets[0] = socket;
            socket.roomCode = this.room.id;
            socket.playerIndex = 0;

            console.log(`[Room ${this.room.id}] Created by ${playerName} (${this.state.isBotMode ? 'BOT MODE' : 'Multiplayer'})`);
            socket.emit('roomCreated', { roomCode: this.room.id, playerIndex: 0 });

            if (this.state.isBotMode) {
                // Add 3 Bots
                const botNames = ['🤖 Bot 1', '🤖 Bot 2', '🤖 Bot 3'];
                for (let i = 1; i <= 3; i++) {
                    // Create a dummy room object to give to bots
                    const botRoomEnv = {
                        game: this.state.game,
                        players: this.state.players,
                        playerSockets: this.state.playerSockets,
                        hostIndex: this.state.hostIndex,
                        nextRoundVotes: this.state.nextRoundVotes,
                        isBotMode: this.state.isBotMode
                    };
                    // Instead of full room, just wrap enough state so bot can read `room.game` and `room.players`.
                    // Actually, the bot needs `room` reference because it reads `room.game` dynamically.
                    const bot = new serverBot(botNames[i - 1], i, this.state, (bIdx, axn, pyld) => this.handleGameAction(bIdx, axn, pyld));
                    this.state.players.push({ name: bot.name, socketId: bot.socketId });
                    this.state.playerSockets[i] = bot;
                }
                this.startGame();
            } else {
                this.broadcastLobby();
                this.notifyLobby();
            }
            return;
        }

        if (action === 'joinGame') {
            const { playerName } = payload;

            // Jeda 60 Detik: Cek jika pemain sedang dalam grace period
            if (this.state.started && this.disconnectTimers) {
                const disconnectedIndex = this.state.players.findIndex((p, i) => 
                    p.name === playerName && this.disconnectTimers.has(i)
                );
                
                if (disconnectedIndex !== -1) {
                    clearTimeout(this.disconnectTimers.get(disconnectedIndex));
                    this.disconnectTimers.delete(disconnectedIndex);
                    
                    // Recover the spot
                    socket.roomCode = this.room.id;
                    socket.playerIndex = disconnectedIndex;
                    this.state.playerSockets[disconnectedIndex] = socket;
                    socket.connected = true;
                    
                    console.log(`[Room ${this.room.id}] ${playerName} RECONNECTED to index ${disconnectedIndex}`);
                    
                    socket.emit('joinedRoom', { roomCode: this.room.id, playerIndex: disconnectedIndex });
                    socket.emit('gameStarted', { playerIndex: disconnectedIndex });
                    
                    this.state.playerSockets.forEach(s => {
                        if (s && s.connected && !s.doAction && s.id !== socket.id) {
                            s.emit('playerNotification', {
                                title: '✅ Pemain Kembali',
                                message: `${playerName} berhasil terhubung kembali!`
                            });
                            s.emit('playerReconnected', { playerName });
                        }
                    });
                    
                    this.broadcastGameState();
                    this.notifyLobby();
                    return;
                }
            }

            if (this.state.started) {
                const hostSocket = this.state.playerSockets[this.state.hostIndex];
                if (hostSocket && hostSocket.connected && !hostSocket.doAction) {
                    hostSocket.emit('lateJoinRequest', {
                        playerName,
                        socketId: socket.id,
                        players: this.state.players.map((p, i) => ({ id: i, name: p.name }))
                    });
                    socket.emit('waitingForAdmit');
                    socket.pendingName = playerName;
                    return;
                } else {
                    socket.emit('error', { message: 'Game sudah dimulai dan Host tidak tersedia untuk memberikan ijin.' });
                    return;
                }
            }

            if (this.state.players.length >= NUM_PLAYERS) {
                socket.emit('error', { message: 'Room sudah penuh.' });
                return;
            }

            const playerIndex = this.state.players.length;
            this.state.players.push({ name: playerName, socketId: socket.id });
            this.state.playerSockets[playerIndex] = socket;

            socket.roomCode = this.room.id;
            socket.playerIndex = playerIndex;

            console.log(`[Room ${this.room.id}] ${playerName} joined as Player ${playerIndex}`);
            socket.emit('joinedRoom', { roomCode: this.room.id, playerIndex });
            this.broadcastLobby();
            this.notifyLobby();

            if (this.state.players.length === NUM_PLAYERS) {
                this.fillBotsAndStart();
            }
            return;
        }

        if (action === 'hostStartGame') {
            if (socket.playerIndex !== this.state.hostIndex) {
                socket.emit('error', { message: 'Hanya host yang bisa memulai game.' });
                return;
            }
            if (this.state.players.length < 2) {
                socket.emit('error', { message: 'Minimal 2 pemain untuk memulai.' });
                return;
            }
            this.fillBotsAndStart();
            return;
        }

        if (action === 'admitResponse') {
            const { joiningSocketId, action: admitAction, replaceIndex } = payload;
            if (socket.playerIndex !== this.state.hostIndex) return;

            const joiningSocket = this.socketWrappers.get(joiningSocketId);
            if (!joiningSocket) return;

            if (admitAction === 'refuse') {
                joiningSocket.emit('lateJoinRejected', { message: 'Host menolak permintaan bergabung Anda.' });
                delete joiningSocket.pendingName;
                return;
            }

            if (admitAction === 'admit') {
                const oldSocket = this.state.playerSockets[replaceIndex];

                if (oldSocket && oldSocket.id !== joiningSocketId) {
                    if (oldSocket.doAction) {
                        oldSocket.connected = false;
                    } else {
                        oldSocket.emit('roomClosed', { reason: 'Anda telah digantikan oleh pemain baru.' });
                        delete oldSocket.roomCode;
                        delete oldSocket.playerIndex;
                    }
                }

                joiningSocket.roomCode = this.room.id;
                joiningSocket.playerIndex = replaceIndex;

                this.state.players[replaceIndex] = { name: joiningSocket.pendingName, socketId: joiningSocket.id };
                this.state.playerSockets[replaceIndex] = joiningSocket;

                if (this.state.game && this.state.game.players[replaceIndex]) {
                    this.state.game.players[replaceIndex].name = joiningSocket.pendingName;
                }

                delete joiningSocket.pendingName;

                joiningSocket.emit('joinedRoom', { roomCode: this.room.id, playerIndex: replaceIndex });
                joiningSocket.emit('gameStarted', { playerIndex: replaceIndex });

                this.state.playerSockets.forEach((s, i) => {
                    if (s && s.connected && !s.doAction && i !== replaceIndex) {
                        s.emit('playerReplaced', {
                            oldName: oldSocket && oldSocket.doAction ? oldSocket.name : '(Pemain Lain)',
                            botName: joiningSocket.pendingName || this.state.players[replaceIndex].name,
                            playerIndex: replaceIndex
                        });
                    }
                });
                this.broadcastGameState();
                this.notifyLobby();

                const joinedName = this.state.players[replaceIndex].name;
                this.state.playerSockets.forEach((s) => {
                    if (s && s.connected && !s.doAction) {
                        s.emit('playerNotification', {
                            title: '👋 Pemain Bergabung',
                            message: `${joinedName} bergabung ke room!`
                        });
                    }
                });
            }
            return;
        }

        // --- GAME ACTIONS ---
        const gameActions = ['initialDiscard', 'drawFromDeck', 'drawFromDiscard', 'playMeld', 'discard', 'requestNextRound'];
        if (gameActions.includes(action)) {
            this.handleGameAction(socket.playerIndex, action, payload);
            return;
        }

        if (action === 'declareCekih') {
            if (!this.state.game) return;
            const result = this.state.game.declareCekih(socket.playerIndex);
            if (result.success) {
                this.broadcastGameState();
            } else {
                socket.emit('actionResult', { success: false, reason: result.reason });
            }
            return;
        }

        if (action === 'triggerGunshot') {
            this.state.playerSockets.forEach(s => {
                if (s && s.connected) {
                    s.emit('playGunshot');
                }
            });
            return;
        }

        if (action === 'sendEmoji') {
            this.state.playerSockets.forEach((s) => {
                if (s && s.connected) {
                    s.emit('showEmoji', { playerId: socket.playerIndex, emoji: payload.emoji });
                }
            });
            return;
        }

        if (action === 'sendChat') {
            const senderName = this.state.players[socket.playerIndex]?.name || `Player ${socket.playerIndex}`;
            this.state.playerSockets.forEach((s) => {
                if (s && s.connected) {
                    s.emit('receiveChat', {
                        senderName,
                        message: payload.message,
                        playerId: socket.playerIndex,
                        isSystem: false
                    });
                }
            });
            return;
        }

        if (action === 'hostRestartRound' && socket.playerIndex === this.state.hostIndex) {
            if (!this.state.game) return;
            this.state.game.initRound();
            this.state.game.deal();
            this.state.nextRoundVotes = null;

            this.state.playerSockets.forEach((s, idx) => {
                if (s && s.connected) {
                    s.emit('roundRestarted');
                    s.emit('gameStarted', { playerIndex: idx });
                }
            });
            this.broadcastGameState();
            return;
        }

        if (action === 'hostRestartGame' && socket.playerIndex === this.state.hostIndex) {
            if (!this.state.game) return;
            this.state.game.players.forEach(p => p.score = 0);
            this.state.game.round = 1;
            this.state.game.initRound();
            this.state.game.deal();
            this.state.nextRoundVotes = null;

            this.state.playerSockets.forEach((s, idx) => {
                if (s && s.connected) {
                    s.emit('gameRestarted');
                    s.emit('gameStarted', { playerIndex: idx });
                }
            });
            this.broadcastGameState();
            return;
        }

        if (action === 'leaveRoom') {
            this.handleDisconnect(socket);
            return;
        }
    }

    // --- REFACTORED SHARED LOGIC ---

    broadcastGameState() {
        if (!this.state.game) return;
        this.state.playerSockets.forEach((socket, index) => {
            if (socket && socket.connected) {
                const state = this.state.game.getStateForPlayer(index);
                state.isHost = (index === this.state.hostIndex);
                socket.emit('gameState', state);
            }
        });
    }

    broadcastLobby() {
        const lobbyData = {
            roomCode: this.room.id,
            players: this.state.players.map((p, i) => ({ id: i, name: p.name, connected: !!this.state.playerSockets[i] })),
            count: this.state.players.length,
            needed: NUM_PLAYERS
        };

        this.state.playerSockets.forEach((socket, index) => {
            if (socket && socket.connected) {
                socket.emit('lobbyUpdate', { ...lobbyData, isHost: index === this.state.hostIndex });
            }
        });
    }

    broadcastGameOver(result) {
        this.state.playerSockets.forEach((socket, index) => {
            if (socket && socket.connected) {
                socket.emit('gameOver', {
                    winner: result.winner,
                    tutupDeckCard: result.tutupDeckCard,
                    scores: result.scores,
                    gameState: this.state.game.getStateForPlayer(index)
                });
            }
        });
    }

    cleanupRoom() {
        this.state.playerSockets.forEach(socket => {
            if (socket && socket.connected) {
                socket.emit('roomClosed', { reason: 'Pemain keluar, room ditutup.' });
                delete socket.roomCode;
                delete socket.playerIndex;
                if (socket.doAction) socket.connected = false;
            }
        });
        this.state.players = []; // Force empty to delete room from lobby
        this.notifyLobby();
        // PartyKit cleans up the room when all connections close naturally
    }

    replacePlayerWithBot(playerIndex) {
        if (!this.state.game) return;

        const oldName = this.state.players[playerIndex]?.name || `Player ${playerIndex}`;
        const botName = `🤖 ${oldName}`;

        const bot = new serverBot(botName, playerIndex, this.state, (bIdx, axn, pyld) => this.handleGameAction(bIdx, axn, pyld));
        this.state.players[playerIndex] = { name: botName, socketId: bot.socketId };
        this.state.playerSockets[playerIndex] = bot;
        this.state.isBotMode = true;

        if (this.state.game.players[playerIndex]) {
            this.state.game.players[playerIndex].name = botName;
        }

        if (this.state.hostIndex === playerIndex) {
            const newHostIdx = this.state.playerSockets.findIndex((s, i) => s && s.connected && !s.doAction && i !== playerIndex);
            if (newHostIdx !== -1) {
                this.state.hostIndex = newHostIdx;
            }
        }

        this.state.playerSockets.forEach((s, i) => {
            if (s && s.connected && !s.doAction) {
                s.emit('playerReplaced', { oldName, botName, playerIndex });
                s.emit('playerNotification', {
                    title: '👋 Pemain Keluar',
                    message: `${oldName} keluar dari room dan digantikan oleh Bot.`
                });
            }
        });

        this.broadcastGameState();
        this.notifyLobby();
    }

    handleDisconnect(socket) {
        if (!socket || socket.playerIndex === undefined || socket.playerIndex === null) return;

        const playerIndex = socket.playerIndex;
        const playerName = this.state.players[playerIndex]?.name || 'Unknown';
        console.log(`[Room ${this.room.id}] ${playerName} disconnected`);

        if (this.state.started) {
            const remainingHumans = this.state.playerSockets.filter((s, i) => s && s.connected && !s.doAction && i !== playerIndex);
            
            if (remainingHumans.length > 0) {
                this.state.playerSockets.forEach(s => {
                    if (s && s.connected && !s.doAction && s.id !== socket.id) {
                        s.emit('playerNotification', {
                            title: '⚠️ Masalah Koneksi',
                            message: `${playerName} terputus. Menunggu 60 detik untuk kembali...`
                        });
                        s.emit('playerDisconnected', { playerName, gracePeriod: true });
                    }
                });
            }

            if (!this.disconnectTimers) this.disconnectTimers = new Map();
            if (this.disconnectTimers.has(playerIndex)) {
                clearTimeout(this.disconnectTimers.get(playerIndex));
            }

            const timerId = setTimeout(() => {
                this.disconnectTimers.delete(playerIndex);
                // Check if reconnected in the meantime
                const currentSocketObj = this.state.playerSockets[playerIndex];
                if (currentSocketObj && currentSocketObj.connected && !currentSocketObj.doAction) {
                    return;
                }

                const stillRemainingHumans = this.state.playerSockets.filter((s, i) => s && s.connected && !s.doAction && i !== playerIndex);
                if (stillRemainingHumans.length === 0) {
                    this.cleanupRoom();
                } else {
                    this.replacePlayerWithBot(playerIndex);
                }
            }, 60000);

            this.disconnectTimers.set(playerIndex, timerId);
            this.broadcastLobby();
            this.notifyLobby();

            // DO NOT delete socket.roomCode / playerIndex, keep them bounded
        } else {
            this.state.playerSockets[playerIndex] = null;
            this.state.players.splice(playerIndex, 1);
            this.state.playerSockets = this.state.playerSockets.filter(Boolean);
            while (this.state.playerSockets.length < NUM_PLAYERS) this.state.playerSockets.push(null);
            this.state.players.forEach((p, i) => {
                const s = this.state.playerSockets[i];
                if (s) s.playerIndex = i;
            });

            if (this.state.players.length > 0) {
                this.broadcastLobby();
            }
            this.notifyLobby();
            
            delete socket.roomCode;
            delete socket.playerIndex;
        }
    }

    fillBotsAndStart() {
        const botsNeeded = NUM_PLAYERS - this.state.players.length;
        if (botsNeeded > 0) {
            this.state.isBotMode = true;
            let botNum = 1;
            for (let i = this.state.players.length; i < NUM_PLAYERS; i++) {
                const bot = new serverBot(`🤖 Bot ${botNum}`, i, this.state, (bIdx, axn, pyld) => this.handleGameAction(bIdx, axn, pyld));
                this.state.players.push({ name: bot.name, socketId: bot.socketId });
                this.state.playerSockets[i] = bot;
                botNum++;
            }
        }
        this.startGame();
    }

    startGame() {
        const playerNames = this.state.players.map(p => p.name);
        this.state.game = new ServerGame(playerNames);
        this.state.game.initRound();
        this.state.started = true;

        this.state.playerSockets.forEach((socket, index) => {
            if (socket && socket.connected) {
                socket.emit('gameStarted', { playerIndex: index });
            }
        });

        this.state.game.deal();
        this.broadcastGameState();
        this.notifyLobby();
    }

    handleGameAction(playerIndex, action, payload = {}) {
        if (!this.state.game) return;

        let result;
        if (action === 'drawFromDeck') result = this.state.game.drawFromDeck(playerIndex);
        else if (action === 'drawFromDiscard') result = this.state.game.drawFromDiscard(playerIndex, payload.count);
        else if (action === 'playMeld') result = this.state.game.playMeld(playerIndex, payload.cardIds);
        else if (action === 'discard') result = this.state.game.discard(playerIndex, payload.cardId);
        else if (action === 'requestNextRound') {
            if (!this.state.nextRoundVotes) this.state.nextRoundVotes = new Set();
            this.state.nextRoundVotes.add(playerIndex);

            if (this.state.isBotMode) {
                this.state.playerSockets.forEach((s, i) => {
                    if (s && s.doAction) this.state.nextRoundVotes.add(i);
                });
            }

            this.state.playerSockets.forEach(s => {
                if (s && s.connected) {
                    s.emit('nextRoundVotes', { count: this.state.nextRoundVotes.size, needed: NUM_PLAYERS });
                }
            });

            if (this.state.nextRoundVotes.size >= NUM_PLAYERS) {
                this.state.nextRoundVotes = null;
                this.state.game.round++;
                this.state.game.initRound();
                this.state.game.deal();
                this.broadcastGameState();
            }
            return;
        }

        if (result && result.gameOver) {
            this.broadcastGameOver(result);
            return;
        }

        if (result && !result.success) {
            const s = this.state.playerSockets[playerIndex];
            if (s && s.connected && !s.doAction) {
                s.emit('actionResult', { success: false, reason: result.reason });
            }
            return;
        }

        if (this.state.game) {
            this.state.game.validateCekihDeclarations();
        }

        this.broadcastGameState();

        if (action === 'discard' && result && result.jokerPenalty) {
            const playerName = this.state.players[playerIndex]?.name || `Player ${playerIndex}`;
            this.state.playerSockets.forEach((s) => {
                if (s && s.connected) {
                    s.emit('jokerDiscarded', {
                        playerName,
                        penalty: result.jokerPenalty,
                        card: result.discardedCard
                    });
                }
            });
        }

        if (action === 'discard' && result && result.jokerRevealData) {
            setTimeout(() => {
                this.state.playerSockets.forEach((s) => {
                    if (s && s.connected) {
                        s.emit('jokerRevealed', result.jokerRevealData);
                    }
                });
                this.broadcastGameState();
            }, 1500);
        }
    }
}
