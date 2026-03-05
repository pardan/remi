// ============================================================
// REMI INDONESIA - Multiplayer Client
// Socket.IO based, all game logic runs on server
// ============================================================

const CARD_IMAGE_BASE = 'https://raw.githubusercontent.com/hayeah/playing-cards-assets/master/png/';
const RANK_FULL = { 'A': 'ace', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9', '10': '10', 'J': 'jack', 'Q': 'queen', 'K': 'king' };
const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs'];
const SUITS = ['♠', '♥', '♦', '♣'];
const FACE_RANKS = new Set(['J', 'Q', 'K']);
function isFaceRank(rank) { return FACE_RANKS.has(rank); }

// ======= AUDIO CONTROLLER =======

class AudioController {
    constructor() {
        this.sounds = {
            bgMusic: new Audio('/audio/bg_music.mp3'),
            deal: new Audio('/audio/book_page.mp3'),
            place: new Audio('/audio/card_place.mp3'),
            select: new Audio('/audio/card_select.mp3'),
            turn: new Audio('/audio/whistle.mp3'),
            gunshot: new Audio('/audio/gunshot.mp3'),
            panic: new Audio('/audio/Panic_Attack.mp3')
        };

        // Configure looping sounds
        this.sounds.bgMusic.loop = true;
        this.sounds.panic.loop = true;

        this.musicMuted = true;
        this.musicVolume = 1;

        this.sfxMuted = false;
        this.sfxVolume = 1;

        this.applyVolumes();

        this._lastPlayed = {};   // Cooldown timestamps per sound
        this._cooldowns = { deal: 80, place: 100, select: 60, turn: 300 };
        this._activeSounds = [];  // Track active clones for cleanup
        this._maxConcurrent = 4;  // Max simultaneous sound clones
    }

    applyVolumes() {
        this.sounds.bgMusic.volume = this.musicVolume;
        this.sounds.deal.volume = this.sfxVolume;
        this.sounds.place.volume = this.sfxVolume;
        this.sounds.select.volume = this.sfxVolume;
        this.sounds.turn.volume = this.sfxVolume;
        this.sounds.panic.volume = this.sfxVolume;
    }

    setMusicVolume(vol) {
        this.musicVolume = parseFloat(vol);
        this.applyVolumes();
    }

    setSfxVolume(vol) {
        this.sfxVolume = parseFloat(vol);
        this.applyVolumes();
    }

    toggleMusicMute(isMuted) {
        this.musicMuted = isMuted;
        if (this.musicMuted) {
            this.sounds.bgMusic.pause();
        } else {
            this.sounds.bgMusic.play().catch(() => { });
        }
    }

    toggleSfxMute(isMuted) {
        this.sfxMuted = isMuted;
        if (this.sfxMuted) this.stopPanic();
    }

    playPanic() {
        if (this.sfxMuted) return;
        if (this.isPanicPlaying) return;
        this.isPanicPlaying = true;
        this.sounds.panic.play().catch(() => { });
    }

    stopPanic() {
        if (!this.isPanicPlaying) return;
        this.isPanicPlaying = false;
        this.sounds.panic.pause();
        this.sounds.panic.currentTime = 0;
    }

    play(soundName) {
        if (!this.sounds[soundName]) return;

        if (soundName === 'bgMusic') {
            if (this.musicMuted) return;
            this.sounds.bgMusic.play().catch(() => { });
            return;
        }

        if (this.sfxMuted) return;

        // Cooldown: skip if played too recently
        const now = performance.now();
        const cooldown = this._cooldowns[soundName] || 50;
        if (this._lastPlayed[soundName] && now - this._lastPlayed[soundName] < cooldown) return;
        this._lastPlayed[soundName] = now;

        // Cleanup finished sounds
        this._activeSounds = this._activeSounds.filter(s => !s.ended && !s.paused);

        // Limit concurrent sounds
        if (this._activeSounds.length >= this._maxConcurrent) {
            const oldest = this._activeSounds.shift();
            oldest.pause();
            oldest.currentTime = 0;
        }

        const sound = this.sounds[soundName].cloneNode();
        // apply current sfxVolume
        sound.volume = this.sounds[soundName].volume;
        sound.play().catch(() => { });
        sound.addEventListener('ended', () => {
            const idx = this._activeSounds.indexOf(sound);
            if (idx > -1) this._activeSounds.splice(idx, 1);
        });
        this._activeSounds.push(sound);
    }
}

// ======= CARD RENDERER =======

const CardRenderer = {
    createCardElement(card, faceUp = true, selectable = false, isJoker = false) {
        const el = document.createElement('div');
        el.className = `card ${faceUp ? 'face-up' : 'face-down'} ${selectable ? 'selectable' : ''} ${isJoker ? 'is-joker' : ''}`;
        el.dataset.cardId = card.id;

        if (faceUp) {
            const suitName = card.suitName || SUIT_NAMES[SUITS.indexOf(card.suit)];
            const rankFull = RANK_FULL[card.rank];
            const imageFile = card.imageFile || `${rankFull}_of_${suitName}.png`;
            const face = document.createElement('div');
            face.className = 'card-face';
            const img = document.createElement('img');
            img.className = 'card-image';
            img.src = CARD_IMAGE_BASE + imageFile;
            img.alt = card.displayName;
            img.loading = 'lazy';
            face.appendChild(img);
            el.appendChild(face);
            if (isJoker) {
                const badge = document.createElement('div');
                badge.className = 'joker-badge';
                badge.textContent = '★';
                el.appendChild(badge);
            }
        } else {
            const back = document.createElement('div');
            back.className = 'card-back';
            back.innerHTML = '<span style="font-size:1.5rem;opacity:0.3">🂠</span>';
            el.appendChild(back);
        }
        return el;
    }
};

// ======= CLIENT APP =======

class RemiClient {
    constructor() {
        this.socket = io();
        this.myPlayerId = null;
        this.roomCode = null;
        this.gameState = null;
        this.selectedCards = new Set();
        this.previousHandIds = new Set();
        this.newlyDrawnIds = new Set();
        this.isDealing = false;
        this.customHandOrder = null; // Store user's manual sorting preference
        this.myTurnActive = false; // Simple flag to track if it's currently my turn

        this.gunshotTimer = null;
        this.gunshotFired = false;
        this.dealAnimationPending = false;
        this.dealAnimationPlaying = false;

        this.audio = new AudioController();

        this.bindLobbyEvents();
        this.bindSocketEvents();
        this.bindGameEvents();
    }

    // ======= LOBBY =======

    bindLobbyEvents() {
        // Main menu buttons -> show sub-sections
        document.getElementById('btn-host-bot').addEventListener('click', () => this.showBotSection());
        document.getElementById('btn-host').addEventListener('click', () => this.showHostSection());
        document.getElementById('btn-join').addEventListener('click', () => this.showJoinSection());

        // Bot section
        document.getElementById('btn-bot-confirm').addEventListener('click', () => this.hostBotGame());
        document.getElementById('btn-bot-cancel').addEventListener('click', () => this.showLobbyMenu());
        document.getElementById('bot-player-name').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.hostBotGame();
        });

        // Host section
        document.getElementById('btn-host-confirm').addEventListener('click', () => this.hostGame());
        document.getElementById('btn-host-cancel').addEventListener('click', () => this.showLobbyMenu());
        document.getElementById('host-player-name').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.hostGame();
        });

        // Join section
        document.getElementById('btn-join-confirm').addEventListener('click', () => this.joinGame());
        document.getElementById('btn-join-cancel').addEventListener('click', () => this.showLobbyMenu());
        document.getElementById('join-player-name').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') document.getElementById('room-code-input').focus();
        });
        document.getElementById('room-code-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.joinGame();
        });

        // Waiting room
        document.getElementById('btn-copy-code').addEventListener('click', () => this.copyRoomCode());
        document.getElementById('btn-leave-room').addEventListener('click', () => this.leaveRoom());
        document.getElementById('btn-start-game').addEventListener('click', () => this.startGame());
    }

    showBotSection() {
        document.getElementById('lobby-menu').classList.add('hidden');
        document.getElementById('bot-section').classList.remove('hidden');
        document.getElementById('bot-player-name').focus();
    }

    showHostSection() {
        document.getElementById('lobby-menu').classList.add('hidden');
        document.getElementById('host-section').classList.remove('hidden');
        document.getElementById('host-player-name').focus();
    }

    showJoinSection() {
        document.getElementById('lobby-menu').classList.add('hidden');
        document.getElementById('join-section').classList.remove('hidden');
        document.getElementById('join-player-name').focus();
    }

    hostBotGame() {
        const name = document.getElementById('bot-player-name').value.trim();
        if (!name) { this.showToast('Masukkan nama kamu!', 'error'); return; }
        this.socket.emit('hostBotGame', { playerName: name });
    }

    hostGame() {
        const name = document.getElementById('host-player-name').value.trim();
        if (!name) { this.showToast('Masukkan nama kamu!', 'error'); return; }
        this.socket.emit('hostGame', { playerName: name });
    }

    joinGame() {
        const name = document.getElementById('join-player-name').value.trim();
        if (!name) { this.showToast('Masukkan nama kamu!', 'error'); return; }
        const code = document.getElementById('room-code-input').value.trim();
        if (!code) { this.showToast('Masukkan kode room!', 'error'); return; }
        this.socket.emit('joinGame', { playerName: name, roomCode: code });
    }

    copyRoomCode() {
        navigator.clipboard.writeText(this.roomCode).then(() => {
            this.showToast('Kode room disalin!', 'success');
        }).catch(() => {
            this.showToast(this.roomCode, 'info');
        });
    }

    leaveRoom() {
        this.audio.stopPanic();
        this.socket.emit('leaveRoom');
        this.showLobbyMenu();
    }

    startGame() {
        this.socket.emit('hostStartGame');
        document.getElementById('btn-start-game').disabled = true;
        document.getElementById('btn-start-game').textContent = '⏳ Memulai...';
    }

    showLobbyMenu() {
        this.audio.stopPanic();
        document.getElementById('lobby-screen').classList.remove('hidden');
        document.getElementById('game-container').classList.add('hidden');
        document.getElementById('lobby-menu').classList.remove('hidden');
        document.getElementById('bot-section').classList.add('hidden');
        document.getElementById('host-section').classList.add('hidden');
        document.getElementById('join-section').classList.add('hidden');
        document.getElementById('waiting-room').classList.add('hidden');
        document.getElementById('gameover-modal').classList.remove('active');
    }

    showWaitingRoom() {
        this.audio.stopPanic();
        document.getElementById('lobby-menu').classList.add('hidden');
        document.getElementById('bot-section').classList.add('hidden');
        document.getElementById('host-section').classList.add('hidden');
        document.getElementById('join-section').classList.add('hidden');
        document.getElementById('waiting-room').classList.remove('hidden');
    }

    updatePlayersList(players, count, needed, isHost = false) {
        const list = document.getElementById('players-list');
        list.innerHTML = '';
        for (let i = 0; i < needed; i++) {
            const slot = document.createElement('div');
            if (i < players.length) {
                slot.className = 'player-slot connected';
                slot.innerHTML = `<span class="slot-icon">👤</span> <span>${players[i].name}</span>`;
            } else {
                slot.className = 'player-slot empty';
                slot.innerHTML = `<span class="slot-icon">⏳</span> <span>Menunggu...</span>`;
            }
            list.appendChild(slot);
        }

        const botsNeeded = needed - count;
        const statusText = count >= needed
            ? `Siap mulai! (${count}/${needed})`
            : `Menunggu pemain... (${count}/${needed})${botsNeeded > 0 && count >= 2 ? ` — ${botsNeeded} slot akan diisi Bot` : ''}`;
        document.getElementById('waiting-status').textContent = statusText;

        // Show start button for host when 2+ players
        const startBtn = document.getElementById('btn-start-game');
        if (isHost && count >= 2) {
            startBtn.classList.remove('hidden');
            startBtn.disabled = false;
            startBtn.textContent = '🎮 Mulai Game';
        } else {
            startBtn.classList.add('hidden');
        }
    }

    // ======= SOCKET EVENTS =======

    bindSocketEvents() {
        this.socket.on('roomCreated', ({ roomCode, playerIndex }) => {
            this.roomCode = roomCode;
            this.myPlayerId = playerIndex;
            document.getElementById('display-room-code').textContent = roomCode;
            this.showWaitingRoom();
        });

        this.socket.on('joinedRoom', ({ roomCode, playerIndex }) => {
            this.roomCode = roomCode;
            this.myPlayerId = playerIndex;
            document.getElementById('display-room-code').textContent = roomCode;
            this.showWaitingRoom();
        });

        this.socket.on('lobbyUpdate', ({ players, count, needed, isHost }) => {
            this.updatePlayersList(players, count, needed, isHost);
        });

        this.socket.on('error', ({ message }) => {
            this.audio.stopPanic();
            this.showToast(message, 'error');
        });

        this.socket.on('actionResult', ({ success, reason }) => {
            if (!success) {
                this.showToast(reason, 'error');
                this.pendingDiscardDraw = null;
                this.pendingDeckDraw = null;
            }
        });

        this.socket.on('gameStarted', ({ playerIndex }) => {
            this.myPlayerId = playerIndex;
            document.getElementById('lobby-screen').classList.add('hidden');
            document.getElementById('game-container').classList.remove('hidden');
            document.getElementById('header-room-code').textContent = this.roomCode;
            this.dealAnimationPending = true;
        });

        this.socket.on('gameState', (state) => {
            const previousPhase = this.gameState ? this.gameState.phase : null;
            this.gameState = state;

            // Show/hide host controls in settings modal (must run before early returns)
            const hostControls = document.getElementById('host-controls');
            if (hostControls) {
                if (state.isHost) {
                    hostControls.classList.remove('hidden');
                } else {
                    hostControls.classList.add('hidden');
                }
            }

            // If deal animation is pending, play it before rendering
            if (this.dealAnimationPending) {
                this.dealAnimationPending = false;
                this.playShuffleAndDealAnimation();
                return; // Don't render yet, animation will handle it
            }

            // Skip normal rendering while deal animation is playing
            if (this.dealAnimationPlaying) return;

            // Trigger animations on confirmed draw success
            if (state.isMyTurn && previousPhase === 'draw' && state.phase === 'meld') {
                if (state.drawnFromDiscard && this.pendingDiscardDraw) {
                    this.animateCardsToHand(this.pendingDiscardDraw.rect, this.pendingDiscardDraw.count);
                    this.pendingDiscardDraw = null;
                } else if (!state.drawnFromDiscard && this.pendingDeckDraw) {
                    this.animateCardsToHand(this.pendingDeckDraw.rect, this.pendingDeckDraw.count);
                    this.pendingDeckDraw = null;
                }
            }

            // Show turn modal and play sound if a normal turn just started
            const isNormalTurn = state.phase === 'draw' || state.phase === 'meld' || state.phase === 'discard';

            if (state.isMyTurn && isNormalTurn) {
                // If it just became my turn, show the modal
                if (!this.myTurnActive) {
                    this.myTurnActive = true;
                    document.getElementById('turn-modal').classList.add('active');
                    this.audio.play('turn');
                }
            } else {
                // It's not my turn or not a normal phase
                this.myTurnActive = false;
                document.getElementById('turn-modal').classList.remove('active');
            }

            this.renderAll();
        });

        this.socket.on('jokerDiscarded', ({ playerName, penalty, card }) => {
            this.showToast(`⚠️ ${playerName} buang Joker! ${penalty} poin`, 'error');
        });

        this.socket.on('jokerRevealed', ({ jokerCard, jokerRank, penalties }) => {
            this.renderJokerCard(jokerCard);
            penalties.forEach(p => {
                const name = this.gameState?.players[p.playerId]?.name || `Player ${p.playerId}`;
                this.showToast(`⚠️ ${name} buang kartu joker! ${p.penalty} poin`, 'warning');
            });
        });

        this.socket.on('gameOver', ({ winner, tutupDeckCard, scores, gameState }) => {
            this.gameState = gameState;
            this.renderAll();
            if (winner && tutupDeckCard) {
                const bonusText = tutupDeckCard.rank === this.gameState.jokerRank ? `JOKER! +500`
                    : tutupDeckCard.rank === 'A' ? `AS! +150`
                        : isFaceRank(tutupDeckCard.rank) ? `${tutupDeckCard.displayName}! +100`
                            : `${tutupDeckCard.displayName}! +50`;
                this.showToast(`🏆 ${winner.name} TUTUP DECK! ${bonusText}`, 'success');
            } else if (!winner) {
                this.showToast('📦 Deck habis! Permainan selesai.', 'warning');
            }
            setTimeout(() => this.showGameOverModal(winner, scores, tutupDeckCard), 1500);
        });

        this.socket.on('nextRoundVotes', ({ count, needed }) => {
            document.getElementById('vote-status').textContent = `(${count}/${needed} siap)`;
        });

        this.socket.on('playGunshot', () => {
            if (this.gameState && this.gameState.phase === 'gameover') return;
            this.audio.play('gunshot');
        });

        this.socket.on('playerDisconnected', ({ playerName }) => {
            this.showToast(`❌ ${playerName} keluar dari room.`, 'warning');
        });

        this.socket.on('playerReplaced', ({ oldName, botName, playerIndex }) => {
            this.showToast(`🤖 ${oldName} diganti oleh Bot. Game tetap lanjut!`, 'info');
        });

        this.socket.on('roomClosed', ({ reason }) => {
            this.audio.stopPanic();
            this.showToast(reason, 'error');
            this.showLobbyMenu();
        });

        this.socket.on('roundRestarted', () => {
            this.showToast('🔄 Room Master me-restart round!', 'info');
        });

        this.socket.on('gameRestarted', () => {
            this.showToast('🔁 Room Master me-restart game! Semua skor direset.', 'info');
        });

        // --- Late Join Events ---
        this.socket.on('lateJoinRequest', ({ playerName, socketId, players }) => {
            document.getElementById('admit-player-name').textContent = `${playerName} ingin bergabung`;
            const select = document.getElementById('admit-replace-select');
            select.innerHTML = '';
            players.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = `Pemain ${p.id + 1}: ${p.name}`;
                select.appendChild(opt);
            });
            this.pendingJoinSocketId = socketId;
            document.getElementById('admit-modal').style.display = 'flex';
        });

        this.socket.on('waitingForAdmit', () => {
            this.showToast('Menunggu persetujuan Room Master...', 'info');
        });

        this.socket.on('lateJoinRejected', ({ message }) => {
            this.audio.stopPanic();
            this.showToast(message, 'error');
            this.showLobbyMenu();
        });
    }

    // ======= GAME EVENTS (UI) =======

    bindGameEvents() {
        document.getElementById('draw-pile').addEventListener('click', () => this.onDrawPileClick());
        document.getElementById('discard-pile-area').addEventListener('click', (e) => this.onDiscardPileClick(e));
        document.getElementById('btn-meld').addEventListener('click', () => this.onMeldClick());
        document.getElementById('btn-discard').addEventListener('click', () => this.onDiscardClick());
        document.getElementById('btn-next-round').addEventListener('click', () => this.onNextRound());

        // Turn modal OK
        document.getElementById('btn-turn-ok').addEventListener('click', () => {
            this.audio.play('select');
            document.getElementById('turn-modal').classList.remove('active');

            // Start 10s idle timer
            if (this.gunshotTimer) clearTimeout(this.gunshotTimer);
            this.gunshotTimer = setTimeout(() => {
                if (this.gameState && this.gameState.isMyTurn && !this.gunshotFired && this.gameState.phase !== 'gameover') {
                    this.gunshotFired = true;
                    this.socket.emit('triggerGunshot');
                }
            }, 20000);
        });

        // Settings Modal Events
        document.getElementById('btn-settings').addEventListener('click', () => {
            document.getElementById('settings-modal').classList.add('active');
        });

        document.getElementById('btn-settings-close').addEventListener('click', () => {
            document.getElementById('settings-modal').classList.remove('active');
        });

        // Host Restart Controls
        document.getElementById('btn-restart-round').addEventListener('click', () => {
            if (confirm('Yakin ingin restart round ini? Kartu akan dibagikan ulang, skor tetap.')) {
                this.socket.emit('hostRestartRound');
                document.getElementById('settings-modal').classList.remove('active');
            }
        });

        document.getElementById('btn-restart-game').addEventListener('click', () => {
            if (confirm('Yakin ingin restart game? Semua skor akan direset ke 0!')) {
                this.socket.emit('hostRestartGame');
                document.getElementById('settings-modal').classList.remove('active');
            }
        });

        // Admit Late Join Modal Events
        document.getElementById('btn-admit-accept').addEventListener('click', () => {
            const replaceIndex = parseInt(document.getElementById('admit-replace-select').value, 10);
            this.socket.emit('admitResponse', {
                joiningSocketId: this.pendingJoinSocketId,
                action: 'admit',
                replaceIndex
            });
            document.getElementById('admit-modal').style.display = 'none';
            this.pendingJoinSocketId = null;
        });

        document.getElementById('btn-admit-reject').addEventListener('click', () => {
            this.socket.emit('admitResponse', {
                joiningSocketId: this.pendingJoinSocketId,
                action: 'refuse'
            });
            document.getElementById('admit-modal').style.display = 'none';
            this.pendingJoinSocketId = null;
        });

        document.getElementById('music-toggle').addEventListener('change', (e) => {
            this.audio.toggleMusicMute(!e.target.checked);
        });

        document.getElementById('sfx-toggle').addEventListener('change', (e) => {
            this.audio.toggleSfxMute(!e.target.checked);
        });

        document.getElementById('music-slider').addEventListener('input', (e) => {
            this.audio.setMusicVolume(e.target.value);
        });

        document.getElementById('sfx-slider').addEventListener('input', (e) => {
            this.audio.setSfxVolume(e.target.value);
        });
    }

    onDrawPileClick() {
        if (!this.gameState || !this.gameState.isMyTurn || this.gameState.phase !== 'draw') return;
        this.audio.play('select');

        // Record intent to animate on success
        const drawPileEl = document.getElementById('draw-pile');
        this.pendingDeckDraw = {
            rect: drawPileEl.getBoundingClientRect(),
            count: 1
        };

        this.socket.emit('drawFromDeck');
    }

    onDiscardPileClick(e) {
        if (!this.gameState || !this.gameState.isMyTurn || this.gameState.phase !== 'draw') return;
        const dp = this.gameState.discardPile;
        if (dp.length === 0) return;

        const maxPickup = this.gameState.maxDiscardPickup;
        if (maxPickup === 0) {
            this.audio.play('select'); // Still play select for interaction feedback
            this.showToast('Kartu teratas buangan adalah joker — tidak bisa diambil!', 'error');
            return;
        }

        // Find which card was clicked
        const clickedCard = e.target.closest('.card');
        if (!clickedCard) return;

        const cardId = parseInt(clickedCard.dataset.cardId);
        const cardIndex = dp.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return;

        const count = dp.length - cardIndex;
        if (count > maxPickup) {
            this.showToast(`Kamu hanya bisa mengambil maksimal ${maxPickup} kartu.`, 'warning');
            return;
        }

        this.audio.play('select');

        // Record intent to animate on success
        this.pendingDiscardDraw = {
            rect: clickedCard.getBoundingClientRect(),
            count: count
        };

        this.socket.emit('drawFromDiscard', { count });
    }

    onMeldClick() {
        if (!this.gameState || !this.gameState.isMyTurn) return;
        const phase = this.gameState.phase;
        if (phase !== 'meld' && phase !== 'draw') return;
        if (this.selectedCards.size < 3) return;

        // Block if melding all remaining cards (must keep at least 1 to discard)
        const me = this.gameState.players[this.myPlayerId];
        if (me && me.hand && me.hand.length - this.selectedCards.size < 1) {
            this.showToast('Harus ada minimal 1 kartu tersisa untuk dibuang!', 'error');
            return;
        }

        this.audio.play('place');
        const cardIds = [...this.selectedCards];
        this.socket.emit('playMeld', { cardIds });
        this.selectedCards.clear();
    }

    onDiscardClick() {
        if (!this.gameState || !this.gameState.isMyTurn) return;
        if (this.selectedCards.size !== 1) return;

        const phase = this.gameState.phase;
        if (phase === 'meld' || phase === 'discard') {
            if (this.gameState.drawnFromDiscard && !this.gameState.usedDrawnDiscardThisTurn) {
                this.showToast('Ambil dari buangan harus digunakan untuk turun kartu (meld) terlebih dahulu!', 'error');
                return;
            }
            const cardId = [...this.selectedCards][0];
            this.audio.play('place');
            this.socket.emit('discard', { cardId });
            this.selectedCards.clear();
        }
    }



    onNextRound() {
        this.socket.emit('requestNextRound');
        document.getElementById('btn-next-round').disabled = true;
        document.getElementById('btn-next-round').textContent = '⏳ Menunggu pemain lain...';
    }

    toggleCardSelection(cardId) {
        if (!this.gameState || !this.gameState.isMyTurn) return;
        const phase = this.gameState.phase;
        if (phase !== 'meld' && phase !== 'discard' && phase !== 'draw') return;

        this.audio.play('select');

        const el = document.querySelector(`#player-hand .card[data-card-id="${cardId}"]`);
        // Stop overriding animations if clicked
        if (el) el.classList.remove('new-draw');

        if (this.selectedCards.has(cardId)) {
            this.selectedCards.delete(cardId);
            if (el) el.classList.remove('selected');
        } else {
            this.selectedCards.add(cardId);
            if (el) el.classList.add('selected');
        }
        this.updateActionButtons();
    }

    // ======= RENDERING =======

    renderAll() {
        if (!this.gameState) return;

        const me = this.gameState.players[this.gameState.myPlayerId];
        if (me && me.hand && this.customHandOrder) {
            // Apply user's manual sort preference
            const idToPos = new Map(this.customHandOrder.map((id, index) => [id, index]));
            me.hand.sort((a, b) => {
                const aPos = idToPos.has(a.id) ? idToPos.get(a.id) : 999;
                const bPos = idToPos.has(b.id) ? idToPos.get(b.id) : 999;
                return aPos - bPos;
            });
        }

        const wasMyTurn = this.lastRenderTurn;
        this.lastRenderTurn = this.gameState.isMyTurn;

        if (!wasMyTurn && this.gameState.isMyTurn) {
            // Turn just started
            this.audio.play('turn');
            this.gunshotFired = false;
        }

        if (!this.gameState.isMyTurn) {
            if (this.gunshotTimer) {
                clearTimeout(this.gunshotTimer);
                this.gunshotTimer = null;
            }
        }

        this.detectNewDrawsAndDeal();

        // Dismiss game over modal when a new round starts + trigger deal animation
        if (this.gameState.phase !== 'gameover') {
            const modal = document.getElementById('gameover-modal');
            if (modal.classList.contains('active')) {
                modal.classList.remove('active');
                this.customHandOrder = null; // Reset manual sort for new round
                this.selectedCards.clear();
                // Trigger deal animation for new round
                this.dealAnimationPlaying = true;
                this.playShuffleAndDealAnimation();
                return; // Don't render yet, animation callback will call renderAll
            }
        }

        // Trigger panic sound if the current player is the TARGET of a Cekih
        const currentPlaying = this.gameState.players.find(p => p.id === this.gameState.currentPlayerIndex);
        let inDanger = false;

        if (currentPlaying && this.gameState.phase !== 'gameover') {
            const currentNameUpper = currentPlaying.name.toUpperCase();
            inDanger = this.gameState.players.some(p => {
                if (!p.isCekih) return false;
                const targets = p.isCekih.split(', ');
                return targets.includes(currentNameUpper);
            });
        }

        if (inDanger) {
            this.audio.playPanic();
        } else {
            this.audio.stopPanic();
        }

        this.renderHeader();
        this.renderOpponents();
        this.renderPiles();
        this.renderDiscardPile();
        this.renderMelds();
        this.renderPlayerHand();
        this.renderPlayerInfo();
        this.updateActionButtons();
    }

    detectNewDrawsAndDeal() {
        const s = this.gameState;
        const me = s.players[this.myPlayerId];
        if (!me || !me.hand) return;

        // Only trigger deal animation on the very first deal (dealing phase)
        if (s.phase === 'dealing' && this.previousHandIds.size === 0) {
            this.isDealing = true;
            this.newlyDrawnIds.clear();
        } else {
            if (this.isDealing && s.phase === 'draw') {
                // Keep isDealing true ONCE for the transition from dealing to draw
                // so the animation plays, then turn it off
                this.isDealing = true;
            } else {
                this.isDealing = false;
            }
            // Detect newly drawn cards
            const currentIds = new Set(me.hand.map(c => c.id));
            this.newlyDrawnIds.clear();
            for (let id of currentIds) {
                if (!this.previousHandIds.has(id)) {
                    this.newlyDrawnIds.add(id);
                }
            }
        }

        // Update previous hand for next render
        this.previousHandIds = new Set(me.hand.map(c => c.id));
    }

    renderHeader() {
        const s = this.gameState;
        document.getElementById('deck-count').textContent = `Deck: ${s.deckCount}`;
        document.getElementById('round-info').textContent = `Ronde ${s.round || 1}`;
        if (s.jokerRevealed && s.jokerCard) {
            this.renderJokerCard(s.jokerCard);
        } else {
            document.getElementById('joker-display').innerHTML = '';
        }
    }

    renderJokerCard(jokerCard) {
        const display = document.getElementById('joker-display');
        display.innerHTML = `
            <div class="joker-display-inner">
                <span class="joker-display-label">★ Joker</span>
                <div class="joker-display-card-wrapper"></div>
            </div>
        `;
        const wrapper = display.querySelector('.joker-display-card-wrapper');
        wrapper.appendChild(CardRenderer.createCardElement(jokerCard, true, false, true));
    }

    renderOpponents() {
        const s = this.gameState;
        // Map other players to positions (left, top, right) relative to me
        const opponentZones = ['opponent-left', 'opponent-top', 'opponent-right'];
        const otherPlayers = [];
        for (let i = 1; i <= 3; i++) {
            const idx = (this.myPlayerId + i) % 4;
            otherPlayers.push(s.players[idx]);
        }

        otherPlayers.forEach((player, i) => {
            const zone = document.getElementById(opponentZones[i]);
            if (!zone || !player) return;

            const nameEl = zone.querySelector('.opponent-name');
            const countEl = zone.querySelector('.opponent-card-count');
            const scoreEl = zone.querySelector('.opponent-score');
            const infoEl = zone.querySelector('.opponent-info');

            nameEl.textContent = player.name;
            countEl.textContent = `${player.cardCount} 🃏`;
            scoreEl.textContent = `${player.score} pts`;

            const badgeEl = zone.querySelector('.cekih-badge');
            if (badgeEl) {
                if (player.isCekih) {
                    badgeEl.classList.remove('hidden');
                    badgeEl.textContent = `CEKIH ${player.isCekih}`;
                } else {
                    badgeEl.classList.add('hidden');
                }
            }

            if (s.currentPlayerIndex === player.id) {
                infoEl.classList.add('active');
            } else {
                infoEl.classList.remove('active');
            }

            const cardsContainer = zone.querySelector('.opponent-cards');
            cardsContainer.innerHTML = '';
            for (let c = 0; c < player.cardCount; c++) {
                const dummyCard = { suit: '♠', rank: 'A', id: -1, displayName: '' };
                const el = CardRenderer.createCardElement(dummyCard, false);
                cardsContainer.appendChild(el);
            }
        });
    }

    renderPiles() {
        const s = this.gameState;
        const drawPile = document.getElementById('draw-pile');
        const drawContainer = drawPile.querySelector('.pile-card-container');
        drawContainer.innerHTML = '';

        const isDrawPhase = s.phase === 'draw' && s.isMyTurn;
        drawPile.className = `pile ${isDrawPhase ? 'clickable' : ''}`;

        if (s.deckCount > 0) {
            const stackCount = Math.min(3, s.deckCount);
            for (let i = 0; i < stackCount; i++) {
                const dummyCard = { suit: '♠', rank: 'A', id: -1, displayName: '' };
                const el = CardRenderer.createCardElement(dummyCard, false);
                drawContainer.appendChild(el);
            }
        }
        drawPile.querySelector('.pile-count').textContent = `${s.deckCount} kartu`;
    }

    renderDiscardPile() {
        const s = this.gameState;
        const container = document.getElementById('discard-pile-cards');
        container.innerHTML = '';
        const area = document.getElementById('discard-pile-area');

        const isDrawPhase = s.phase === 'draw' && s.isMyTurn;
        area.className = `discard-pile-area ${isDrawPhase && s.discardPile.length > 0 ? 'clickable' : ''}`;

        s.discardPile.forEach(card => {
            const el = CardRenderer.createCardElement(card, true, false, s.jokerRevealed && card.rank === s.jokerRank);
            container.appendChild(el);
        });

        // Auto-scroll to end
        setTimeout(() => { area.scrollLeft = area.scrollWidth; }, 50);
    }

    renderMelds() {
        const s = this.gameState;

        // Player melds
        const playerMeldsContainer = document.getElementById('player-melds');
        playerMeldsContainer.innerHTML = '';
        s.melds.filter(m => m.owner === this.myPlayerId).forEach(meld => {
            playerMeldsContainer.appendChild(this.createMeldElement(meld));
        });

        // Opponent melds
        const opponentZones = ['opponent-left', 'opponent-top', 'opponent-right'];
        for (let i = 1; i <= 3; i++) {
            const idx = (this.myPlayerId + i) % 4;
            const zone = document.getElementById(opponentZones[i - 1]);
            if (!zone) continue;
            const container = zone.querySelector('.opponent-melds');
            container.innerHTML = '';
            s.melds.filter(m => m.owner === idx).forEach(meld => {
                container.appendChild(this.createMeldElement(meld));
            });
        }
    }

    createMeldElement(meld) {
        const group = document.createElement('div');
        group.className = 'meld-group';
        meld.cards.forEach(card => {
            const isJoker = this.gameState.jokerRevealed && card.rank === this.gameState.jokerRank;
            group.appendChild(CardRenderer.createCardElement(card, true, false, isJoker));
        });
        return group;
    }

    renderPlayerHand() {
        if (this.isDraggingCard) return;

        const s = this.gameState;
        const handContainer = document.getElementById('player-hand');
        handContainer.innerHTML = '';

        const me = s.players[this.myPlayerId];
        if (!me || !me.hand) return;

        // Apply custom hand order if available
        if (this.customHandOrder) {
            const idToPos = new Map(this.customHandOrder.map((id, index) => [id, index]));
            me.hand.sort((a, b) => {
                const aPos = idToPos.has(a.id) ? idToPos.get(a.id) : 999;
                const bPos = idToPos.has(b.id) ? idToPos.get(b.id) : 999;
                return aPos - bPos;
            });
        }

        const canSelect = s.isMyTurn && (s.phase === 'meld' || s.phase === 'discard' || s.phase === 'draw');
        const canDrag = true; // Always allow drag-and-drop ordering

        me.hand.forEach((card, i) => {
            const el = CardRenderer.createCardElement(card, true, canSelect, card.isJoker);
            if (this.selectedCards.has(card.id)) {
                el.classList.add('selected');
            }
            if (this.isDealing) {
                el.classList.add('deal-from-deck');
                el.style.animationDelay = `${i * 0.1}s`;
                setTimeout(() => { if (this.isDealing) this.audio.play('deal'); }, i * 100);
            } else if (this.newlyDrawnIds.has(card.id)) {
                el.classList.add('new-draw');
                this.audio.play('place');
            }

            if (canSelect) {
                el.addEventListener('click', () => this.toggleCardSelection(card.id));
            }

            // Always allow drag-and-drop for manual ordering
            el.draggable = true;

            el.addEventListener('dragstart', (e) => {
                this.isDraggingCard = true;
                e.dataTransfer.setData('text/plain', card.id);
                el.classList.add('dragging');

                // Prevent dealing/drawing animations from re-triggering when the DOM node is moved
                document.querySelectorAll('#player-hand .card').forEach(c => {
                    c.classList.remove('deal-from-deck', 'new-draw');
                    c.style.animationDelay = '0s';
                });
                this.isDealing = false;

                setTimeout(() => el.style.opacity = '0.5', 0);
            });

            el.addEventListener('dragend', () => {
                el.classList.remove('dragging');
                el.style.opacity = '1';
                this.isDraggingCard = false;
            });

            handContainer.appendChild(el);
        });

        // Add drop zone logic to hand container — bind ONCE to avoid accumulation
        if (!handContainer._dragBound) {
            handContainer._dragBound = true;
            let dragThrottle = 0;
            handContainer.addEventListener('dragover', e => {
                e.preventDefault();
                const now = performance.now();
                if (now - dragThrottle < 30) return; // Throttle to ~33fps
                dragThrottle = now;
                const afterElement = this.getDragAfterElement(handContainer, e.clientX);
                const dragging = document.querySelector('.dragging');
                if (!dragging) return;
                if (afterElement == null) {
                    handContainer.appendChild(dragging);
                } else {
                    handContainer.insertBefore(dragging, afterElement);
                }
            });

            handContainer.addEventListener('drop', e => {
                e.preventDefault();
                this.audio.play('place');
                const newOrderIds = Array.from(handContainer.querySelectorAll('.card')).map(el => parseInt(el.dataset.cardId));
                this.customHandOrder = newOrderIds;
                this.isDraggingCard = false;
            });
        }
        // Clear newlyDrawn tracking after 1 second so it doesn't keep animating if re-rendered
        if (this.newlyDrawnIds.size > 0) {
            setTimeout(() => this.newlyDrawnIds.clear(), 1000);
        }
    }

    getDragAfterElement(container, x) {
        const draggableElements = [...container.querySelectorAll('.card:not(.dragging)')];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = x - box.left - box.width / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    renderPlayerInfo() {
        const s = this.gameState;
        const me = s.players[this.myPlayerId];

        document.getElementById('my-name').textContent = me.name;
        document.getElementById('my-score').textContent = `${me.score} pts`;

        const myBadge = document.getElementById('my-cekih-badge');
        if (myBadge) {
            if (me.isCekih) {
                myBadge.classList.remove('hidden');
                myBadge.textContent = `CEKIH ${me.isCekih}`;
            } else {
                myBadge.classList.add('hidden');
            }
        }

        const phaseEl = document.getElementById('phase-indicator');
        if (s.isMyTurn) {
            const phaseText = {
                'draw': 'Ambil kartu dari Deck atau Buangan',
                'meld': 'Turun atau Buang kartu',
                'discard': 'Buang kartu',
                'gameover': 'Game Selesai'
            };
            phaseEl.textContent = `🟢 ${phaseText[s.phase] || s.phase}`;
            phaseEl.style.color = 'var(--accent-green)';
        } else {
            const current = s.players[s.currentPlayerIndex];
            phaseEl.textContent = `⏳ Giliran ${current?.name || '...'}`;
            phaseEl.style.color = 'var(--text-muted)';
        }
    }

    updateActionButtons() {
        const s = this.gameState;
        if (!s) return;

        const isMyTurn = s.isMyTurn;
        const phase = s.phase;

        const btnMeld = document.getElementById('btn-meld');
        const btnDiscard = document.getElementById('btn-discard');

        btnMeld.disabled = !(isMyTurn && (phase === 'meld' || (phase === 'draw' && s.jokerRevealed && !s.hasDrawn)) && this.selectedCards.size >= 3);

        const mustMeldFirst = s.drawnFromDiscard && !s.usedDrawnDiscardThisTurn;
        btnDiscard.disabled = !(isMyTurn && (phase === 'meld' || phase === 'discard') && this.selectedCards.size === 1 && !mustMeldFirst);

        if (mustMeldFirst && isMyTurn && phase === 'meld') {
            btnDiscard.textContent = '⚠️ Harus turun dulu!';
        } else {
            btnDiscard.textContent = '📤 Buang Kartu';
        }
    }

    // ======= GAME OVER MODAL =======

    showGameOverModal(winner, scores, tutupDeckCard) {
        this.audio.stopPanic();
        const modal = document.getElementById('gameover-modal');
        const tbody = document.getElementById('score-tbody');
        tbody.innerHTML = '';

        if (winner) {
            document.getElementById('winner-name').textContent =
                winner.id === this.myPlayerId ? '🎉 Kamu Tutup Deck!' : `🏆 ${winner.name} Tutup Deck!`;
        } else {
            document.getElementById('winner-name').textContent = '📦 Deck Habis — Hitung Skor!';
        }

        scores.forEach((detail) => {
            const { playerName, meldedPositive, handPositive, handNegative, tutupDeckBonus, roundScore, totalScore, isWinner, cekihPenalty } = detail;
            const tr = document.createElement('tr');
            tr.className = isWinner ? 'winner-row' : '';

            let breakdown = '';
            if (meldedPositive > 0) breakdown += `<span class="score-pos">Turun +${meldedPositive}</span> `;
            if (handPositive > 0) breakdown += `<span class="score-pos">Tangan +${handPositive}</span> `;
            if (handNegative < 0) breakdown += `<span class="score-neg">Sisa ${handNegative}</span> `;
            if (tutupDeckBonus > 0) breakdown += `<span class="score-bonus">Tutup +${tutupDeckBonus}</span> `;
            if (cekihPenalty < 0) breakdown += `<span class="score-neg" style="color:#ff4a5e; font-weight:bold;">Cekih ${cekihPenalty}</span> `;

            tr.innerHTML = `
                <td>${playerName} ${isWinner ? '👑' : ''}</td>
                <td class="score-breakdown">${breakdown || '—'}</td>
                <td class="${roundScore >= 0 ? 'score-pos' : 'score-neg'}">${roundScore >= 0 ? '+' : ''}${roundScore}</td>
                <td><strong>${totalScore}</strong></td>
            `;
            tbody.appendChild(tr);
        });

        // Reset next round button
        const btn = document.getElementById('btn-next-round');
        btn.disabled = false;
        btn.textContent = '🔁 Ronde Berikutnya';
        document.getElementById('vote-status').textContent = '';

        modal.classList.add('active');
    }

    // ======= TOAST =======

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => toast.classList.add('fade-out'), 2500);
        setTimeout(() => toast.remove(), 2800);
    }

    // ======= SHUFFLE & DEAL ANIMATION =======

    playShuffleAndDealAnimation() {
        this.dealAnimationPlaying = true;
        const overlay = document.getElementById('deal-overlay');
        overlay.classList.add('active');

        // Clear all card displays so the table looks clean
        document.getElementById('player-hand').innerHTML = '';
        document.getElementById('player-melds').innerHTML = '';
        document.getElementById('discard-pile-cards').innerHTML = '';
        document.getElementById('joker-display').innerHTML = '';
        ['opponent-left', 'opponent-top', 'opponent-right'].forEach(id => {
            const zone = document.getElementById(id);
            if (zone) {
                zone.querySelector('.opponent-cards').innerHTML = '';
                zone.querySelector('.opponent-melds').innerHTML = '';
            }
        });

        // Render header and basic layout (but hide hands/cards)
        this.renderHeader();
        this.renderPiles();

        // Show "Mengocok..." text and shuffle wobble
        const drawPile = document.getElementById('draw-pile');
        drawPile.classList.add('shuffling');

        const shuffleText = document.createElement('div');
        shuffleText.className = 'shuffle-text';
        shuffleText.textContent = '🔀 Mengocok kartu...';
        document.body.appendChild(shuffleText);

        this.audio.play('deal');

        // 1. Shuffle for 2 seconds
        setTimeout(() => {
            // Remove shuffle
            drawPile.classList.remove('shuffling');
            shuffleText.remove();

            // 2. Start dealing cards one by one
            this.dealCardsOneByOne(() => {
                // 3. Animation complete
                overlay.classList.remove('active');
                this.dealAnimationPlaying = false;
                this.showToast('🎮 Game dimulai!', 'success');
                this.renderAll();

                // 4. Trigger turn modal if it's my turn (after animation)
                if (this.gameState && this.gameState.isMyTurn) {
                    this.myTurnActive = true;
                    document.getElementById('turn-modal').classList.add('active');
                    this.audio.play('turn');
                }
            });
        }, 2000);
    }

    dealCardsOneByOne(onComplete) {
        const drawPile = document.getElementById('draw-pile');
        const deckRect = drawPile.getBoundingClientRect();
        const deckCenterX = deckRect.left + deckRect.width / 2;
        const deckCenterY = deckRect.top + deckRect.height / 2;

        // Get target positions for all 4 players
        const targets = this.getDealTargetPositions();
        const totalCards = 28; // 7 cards × 4 players
        const delayPerCard = 180; // ms between each card
        let dealt = 0;

        const dealNext = () => {
            if (dealt >= totalCards) {
                // Small pause after last card, then complete
                setTimeout(onComplete, 500);
                return;
            }

            const playerIdx = dealt % 4; // Alternate P0 → P1 → P2 → P3
            const target = targets[playerIdx];

            // Create flying card
            const flyCard = document.createElement('div');
            flyCard.className = 'deal-flying-card';
            flyCard.style.left = `${deckCenterX - 25}px`;
            flyCard.style.top = `${deckCenterY - 35}px`;
            document.body.appendChild(flyCard);

            // Play deal sound
            this.audio.play('deal');

            // Trigger fly animation
            requestAnimationFrame(() => {
                flyCard.classList.add('fly');
                flyCard.style.left = `${target.x - 25}px`;
                flyCard.style.top = `${target.y - 35}px`;
            });

            // Remove after arrival
            setTimeout(() => {
                flyCard.classList.add('arrived');
                setTimeout(() => flyCard.remove(), 200);
            }, 280);

            dealt++;
            setTimeout(dealNext, delayPerCard);
        };

        dealNext();
    }

    getDealTargetPositions() {
        // Target positions for 4 players: me (bottom), left, top, right
        // Order: player 0 = me, then opponents in the order they sit
        const positions = [];

        // Me (bottom - player hand area)
        const playerHand = document.getElementById('player-hand');
        if (playerHand) {
            const r = playerHand.getBoundingClientRect();
            positions.push({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
        } else {
            positions.push({ x: window.innerWidth / 2, y: window.innerHeight - 80 });
        }

        // Opponents: left, top, right (in game order relative to me)
        const opponentZones = ['opponent-left', 'opponent-top', 'opponent-right'];
        opponentZones.forEach(zoneId => {
            const zone = document.getElementById(zoneId);
            if (zone) {
                const r = zone.getBoundingClientRect();
                positions.push({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
            } else {
                positions.push({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
            }
        });

        return positions;
    }

    animateCardsToHand(sourceElOrRect, count = 1) {
        if (!sourceElOrRect) return;
        const rect = sourceElOrRect instanceof Element ? sourceElOrRect.getBoundingClientRect() : sourceElOrRect;
        const handEl = document.getElementById('player-hand');
        if (!handEl) return;
        const handRect = handEl.getBoundingClientRect();

        const targetX = handRect.left + handRect.width / 2;
        const targetY = handRect.top + handRect.height / 2;

        for (let i = 0; i < Math.min(count, 5); i++) {
            setTimeout(() => {
                const dummyCard = CardRenderer.createCardElement({ suit: '♠', rank: 'A', id: -1 }, false);
                dummyCard.className = 'card face-down floating-card';

                // Set initial position
                dummyCard.style.left = `${rect.left}px`;
                dummyCard.style.top = `${rect.top}px`;
                dummyCard.style.width = `${rect.width || 60}px`;
                dummyCard.style.height = `${rect.height || 85}px`;

                // Calculate displacement
                const tx = targetX - rect.left - (rect.width || 60) / 2;
                const ty = targetY - rect.top - (rect.height || 85) / 2;

                dummyCard.style.setProperty('--tx', `${tx}px`);
                dummyCard.style.setProperty('--ty', `${ty}px`);
                dummyCard.style.setProperty('--tx-mid', `${tx * 0.5}px`);
                dummyCard.style.setProperty('--ty-mid', `${ty * 0.5 - 50}px`); // arc upwards

                document.body.appendChild(dummyCard);

                setTimeout(() => {
                    if (document.body.contains(dummyCard)) {
                        document.body.removeChild(dummyCard);
                    }
                }, 600); // matches animation length
            }, i * 100);
        }
    }


}

// ======= INIT =======
function resizeGameWindow() {
    const gameContainer = document.getElementById('game-container');
    if (!gameContainer) return;

    // Use zoom scaling for a cleaner layout reflow
    const baseWidth = 1000;
    const baseHeight = 700;

    const scaleWidth = window.innerWidth / baseWidth;
    const scaleHeight = window.innerHeight / baseHeight;
    let scale = Math.min(scaleWidth, scaleHeight);

    if (scale > 1) scale = 1;

    // Setting zoom reflows the actual element size in the DOM
    gameContainer.style.zoom = scale;
}

document.addEventListener('DOMContentLoaded', () => {
    window.remiClient = new RemiClient();

    window.addEventListener('resize', resizeGameWindow);
    window.addEventListener('orientationchange', resizeGameWindow);
    setTimeout(resizeGameWindow, 100);
});
