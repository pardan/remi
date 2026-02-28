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
            deal: new Audio('/audio/card_deal.mp3'),
            place: new Audio('/audio/card_place.mp3'),
            select: new Audio('/audio/card_select.mp3'),
            turn: new Audio('/audio/turn_start.mp3')
        };

        // Configure background music
        this.sounds.bgMusic.loop = true;
        this.sounds.bgMusic.volume = 0;

        // Configure SFX volume
        this.sounds.deal.volume = 0.1;
        this.sounds.place.volume = 1;
        this.sounds.select.volume = 1;
        this.sounds.turn.volume = 0.5;

        this.isMuted = false;
        this._lastPlayed = {};   // Cooldown timestamps per sound
        this._cooldowns = { deal: 80, place: 100, select: 60, turn: 300 };
        this._activeSounds = [];  // Track active clones for cleanup
        this._maxConcurrent = 4;  // Max simultaneous sound clones
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        if (this.isMuted) {
            this.sounds.bgMusic.pause();
        } else {
            this.sounds.bgMusic.play().catch(() => { });
        }
        return this.isMuted;
    }

    play(soundName) {
        if (this.isMuted || !this.sounds[soundName]) return;

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

        this.audio = new AudioController();

        this.bindLobbyEvents();
        this.bindSocketEvents();
        this.bindGameEvents();
    }

    // ======= LOBBY =======

    bindLobbyEvents() {
        document.getElementById('btn-host-bot').addEventListener('click', () => this.hostBotGame());
        document.getElementById('btn-host').addEventListener('click', () => this.hostGame());
        document.getElementById('btn-join').addEventListener('click', () => this.showJoinInput());
        document.getElementById('btn-join-confirm').addEventListener('click', () => this.joinGame());
        document.getElementById('btn-join-cancel').addEventListener('click', () => this.hideJoinInput());
        document.getElementById('btn-copy-code').addEventListener('click', () => this.copyRoomCode());
        document.getElementById('btn-leave-room').addEventListener('click', () => this.leaveRoom());

        document.getElementById('room-code-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.joinGame();
        });
        document.getElementById('player-name').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') document.getElementById('btn-host').click();
        });
    }

    getPlayerName() {
        const name = document.getElementById('player-name').value.trim();
        return name || `Pemain${Math.floor(Math.random() * 999)}`;
    }

    hostBotGame() {
        const name = this.getPlayerName();
        this.socket.emit('hostBotGame', { playerName: name });
    }

    hostGame() {
        const name = this.getPlayerName();
        this.socket.emit('hostGame', { playerName: name });
    }

    showJoinInput() {
        document.getElementById('lobby-menu').classList.add('hidden');
        document.getElementById('join-section').classList.remove('hidden');
        document.getElementById('room-code-input').focus();
    }

    hideJoinInput() {
        document.getElementById('join-section').classList.add('hidden');
        document.getElementById('lobby-menu').classList.remove('hidden');
    }

    joinGame() {
        const name = this.getPlayerName();
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
        this.socket.emit('leaveRoom');
        this.showLobbyMenu();
    }

    showLobbyMenu() {
        document.getElementById('lobby-screen').classList.remove('hidden');
        document.getElementById('game-container').classList.add('hidden');
        document.getElementById('lobby-menu').classList.remove('hidden');
        document.getElementById('join-section').classList.add('hidden');
        document.getElementById('waiting-room').classList.add('hidden');
        document.getElementById('gameover-modal').classList.remove('active');
    }

    showWaitingRoom() {
        document.getElementById('lobby-menu').classList.add('hidden');
        document.getElementById('join-section').classList.add('hidden');
        document.getElementById('waiting-room').classList.remove('hidden');
    }

    updatePlayersList(players, count, needed) {
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
        document.getElementById('waiting-status').textContent = `Menunggu pemain... (${count}/${needed})`;
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

        this.socket.on('lobbyUpdate', ({ players, count, needed }) => {
            this.updatePlayersList(players, count, needed);
        });

        this.socket.on('error', ({ message }) => {
            this.showToast(message, 'error');
        });

        this.socket.on('actionResult', ({ success, reason }) => {
            if (!success) this.showToast(reason, 'error');
        });

        this.socket.on('gameStarted', ({ playerIndex }) => {
            this.myPlayerId = playerIndex;
            document.getElementById('lobby-screen').classList.add('hidden');
            document.getElementById('game-container').classList.remove('hidden');
            document.getElementById('header-room-code').textContent = this.roomCode;
            this.showToast('🎮 Game dimulai!', 'success');
        });

        this.socket.on('gameState', (state) => {
            this.gameState = state;

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
                const bonusText = tutupDeckCard.rank === this.gameState.jokerRank ? `JOKER! +300`
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

        this.socket.on('playerDisconnected', ({ playerName }) => {
            this.showToast(`❌ ${playerName} keluar. Room ditutup.`, 'error');
            setTimeout(() => this.showLobbyMenu(), 3000);
        });

        this.socket.on('roomClosed', ({ reason }) => {
            this.showToast(reason, 'error');
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
        });

        // Audio Toggle
        const btnMute = document.createElement('button');
        btnMute.id = 'btn-mute';
        btnMute.className = 'btn btn-icon';
        btnMute.innerHTML = '🔊';
        btnMute.title = 'Nyalakan/Matikan Suara';
        btnMute.style.position = 'absolute';
        btnMute.style.top = '60px';
        btnMute.style.left = '12px';
        btnMute.style.zIndex = '100';
        document.body.appendChild(btnMute);

        btnMute.addEventListener('click', () => {
            const isMuted = this.audio.toggleMute();
            btnMute.innerHTML = isMuted ? '🔇' : '🔊';
        });
    }

    onDrawPileClick() {
        if (!this.gameState || !this.gameState.isMyTurn || this.gameState.phase !== 'draw') return;
        this.audio.play('select');
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
        if (phase === 'initial_discard') {
            const cardId = [...this.selectedCards][0];
            this.audio.play('place');
            this.socket.emit('initialDiscard', { cardId });
            this.selectedCards.clear();
            return;
        }

        if (phase === 'meld' || phase === 'discard') {
            if (this.gameState.drawnFromDiscard && !this.gameState.meldedThisTurn) {
                this.showToast('Ambil dari buangan harus turun dulu!', 'error');
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
        if (phase !== 'meld' && phase !== 'discard' && phase !== 'initial_discard' && phase !== 'draw') return;

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
        }

        this.detectNewDrawsAndDeal();

        // Dismiss game over modal when a new round starts
        if (this.gameState.phase !== 'gameover') {
            const modal = document.getElementById('gameover-modal');
            if (modal.classList.contains('active')) {
                modal.classList.remove('active');
                this.customHandOrder = null; // Reset manual sort for new round
                this.selectedCards.clear();
            }
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

        // Only trigger deal animation on the very first deal (dealing phase), NOT initial_discard
        if (s.phase === 'dealing' && this.previousHandIds.size === 0) {
            this.isDealing = true;
            this.newlyDrawnIds.clear();
        } else {
            if (this.isDealing && s.phase === 'initial_discard') {
                // Keep isDealing true ONCE for the transition from dealing to initial_discard
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

        const canSelect = s.isMyTurn && (s.phase === 'meld' || s.phase === 'discard' || s.phase === 'initial_discard' || s.phase === 'draw');
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

        const phaseEl = document.getElementById('phase-indicator');
        if (s.isMyTurn) {
            const phaseText = {
                'initial_discard': 'Buang 1 kartu (sebelum joker)',
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

        if (phase === 'initial_discard') {
            btnMeld.disabled = true;
            btnDiscard.disabled = !(isMyTurn && this.selectedCards.size === 1);
            btnDiscard.textContent = '📤 Buang 1 Kartu (Awal)';
            return;
        }

        btnMeld.disabled = !(isMyTurn && phase === 'meld' && this.selectedCards.size >= 3);

        const mustMeldFirst = s.drawnFromDiscard && !s.meldedThisTurn;
        btnDiscard.disabled = !(isMyTurn && (phase === 'meld' || phase === 'discard') && this.selectedCards.size === 1 && !mustMeldFirst);

        if (mustMeldFirst && isMyTurn && phase === 'meld') {
            btnDiscard.textContent = '⚠️ Harus turun dulu!';
        } else {
            btnDiscard.textContent = '📤 Buang Kartu';
        }
    }

    // ======= GAME OVER MODAL =======

    showGameOverModal(winner, scores, tutupDeckCard) {
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
            const { playerName, meldedPositive, handPositive, handNegative, tutupDeckBonus, roundScore, totalScore, isWinner } = detail;
            const tr = document.createElement('tr');
            tr.className = isWinner ? 'winner-row' : '';

            let breakdown = '';
            if (meldedPositive > 0) breakdown += `<span class="score-pos">Turun +${meldedPositive}</span> `;
            if (handPositive > 0) breakdown += `<span class="score-pos">Tangan +${handPositive}</span> `;
            if (handNegative < 0) breakdown += `<span class="score-neg">Sisa ${handNegative}</span> `;
            if (tutupDeckBonus > 0) breakdown += `<span class="score-bonus">Tutup +${tutupDeckBonus}</span> `;

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

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(30px)';
            toast.style.transition = 'all 0.3s';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
}

// ======= INIT =======
document.addEventListener('DOMContentLoaded', () => {
    window.remiClient = new RemiClient();
});
