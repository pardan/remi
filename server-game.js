// ============================================================
// REMI INDONESIA - Server-Side Game Engine
// Node.js module version of the game logic
// ============================================================

const SUITS = ['♠', '♥', '♦', '♣'];
const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RANK_FULL = { 'A': 'ace', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9', '10': '10', 'J': 'jack', 'Q': 'queen', 'K': 'king' };
const RANK_VALUES = { 'A': 15, '2': 5, '3': 5, '4': 5, '5': 5, '6': 5, '7': 5, '8': 5, '9': 5, '10': 5, 'J': 10, 'Q': 10, 'K': 10 };
const RANK_ORDER = { 'A': 14, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 };

const INITIAL_CARDS = 7;
const MAX_DISCARD_PICKUP = 7;
const NUM_PLAYERS = 4;

const NUMBER_RANKS = new Set(['2', '3', '4', '5', '6', '7', '8', '9', '10']);
const FACE_RANKS = new Set(['J', 'Q', 'K']);
function isNumberRank(rank) { return NUMBER_RANKS.has(rank); }
function isFaceRank(rank) { return FACE_RANKS.has(rank); }
function getRunGroup(rank) { return isNumberRank(rank) ? 'number' : isFaceRank(rank) ? 'face' : 'none'; }

class Card {
    constructor(suit, rank, id) {
        this.suit = suit;
        this.rank = rank;
        this.id = id;
    }
    get value() { return RANK_VALUES[this.rank] || 0; }
    get order() { return RANK_ORDER[this.rank] || 0; }
    get suitName() { return SUIT_NAMES[SUITS.indexOf(this.suit)]; }
    get displayName() { return `${this.rank}${this.suit}`; }
    get imageFile() { return `${RANK_FULL[this.rank]}_of_${this.suitName}.png`; }
    isJoker(game) { return game && game.jokerRank && this.rank === game.jokerRank; }
    toJSON() { return { suit: this.suit, rank: this.rank, id: this.id, value: this.value, order: this.order, suitName: this.suitName, displayName: this.displayName, imageFile: this.imageFile }; }
}

class Meld {
    constructor(cards, owner, id, game) {
        this.cards = [...cards];
        this.owner = owner;
        this.id = id;
        this.game = game;
        this.type = Meld.detectType(cards, game);
    }
    static detectType(cards, game) {
        const nonJokers = cards.filter(c => !c.isJoker(game));
        if (nonJokers.length < 2) return 'unknown';
        const ranks = new Set(nonJokers.map(c => c.rank));
        const suits = new Set(nonJokers.map(c => c.suit));
        if (ranks.size === 1 && suits.size === nonJokers.length) return 'set';
        if (suits.size === 1) return 'run';
        return 'unknown';
    }
    get totalValue() { return this.cards.reduce((sum, c) => sum + c.value, 0); }
    toJSON() { return { id: this.id, owner: this.owner, type: this.type, cards: this.cards.map(c => c.toJSON()) }; }
}

class ServerGame {
    constructor(playerNames) {
        this.deck = [];
        this.discardPile = [];
        this.players = playerNames.map((name, i) => ({
            id: i, name, hand: [], hasMelded: false, hasRun: false, score: 0, hasDrawnFromDiscardThisRound: false
        }));
        this.melds = [];
        this.currentPlayerIndex = 0;
        this.phase = 'idle';
        this.round = 1;
        this.meldIdCounter = 0;
        this.cardIdCounter = 0;
        this.hasDrawn = false;
        this.drawnFromDiscard = false;
        this.meldedThisTurn = false;
        this.usedDrawnDiscardThisTurn = false; // New property
        this.drawnDiscardIds = new Set(); // New property
        this.drawnDiscardCount = 0; // New Cekih restriction property
        this.winner = null;
        this.jokerRank = null;
        this.jokerCard = null;
        this.jokerRevealed = false;
        this.initialDiscardCount = 0;
        this.initialPenalties = {};
        this.lastRoundScores = {}; // Stores each player's roundScore from the previous round
    }

    // ======= INIT & DEAL =======

    initRound() {
        this.createDeck();
        this.shuffleDeck();
        this.players.forEach(p => { p.hand = []; p.hasMelded = false; p.hasRun = false; p.hasDrawnFromDiscardThisRound = false; });
        this.melds = [];
        this.discardPile = [];
        this.currentPlayerIndex = 0;
        this.winner = null;
        this.meldIdCounter = 0;
        this.hasDrawn = false;
        this.drawnFromDiscard = false;
        this.meldedThisTurn = false;
        this.usedDrawnDiscardThisTurn = false; // Reset for new round
        this.drawnDiscardIds = new Set(); // Reset for new round
        this.drawnDiscardCount = 0; // Reset for new round
        this.jokerRevealed = false;
        this.initialDiscardCount = 0;
        this.initialPenalties = {};

        this.jokerCard = this.deck.pop();
        this.jokerRank = this.jokerCard.rank;
        this.phase = 'dealing';
    }

    deal() {
        for (let i = 0; i < INITIAL_CARDS; i++) {
            for (let p = 0; p < NUM_PLAYERS; p++) {
                if (this.deck.length > 0) {
                    this.players[p].hand.push(this.deck.pop());
                }
            }
        }
        this.players.forEach(p => this.sortHand(p));
        this.phase = 'draw';

        // Determine first player of the round
        if (this.round === 1) {
            this.currentPlayerIndex = 0; // Host or first joined
        } else {
            // Player with highest round score from the PREVIOUS round goes first
            let maxRoundScore = -Infinity;
            let firstPlayerIdx = 0;
            this.players.forEach((p, idx) => {
                const prevRoundScore = this.lastRoundScores[p.id] || 0;
                if (prevRoundScore > maxRoundScore) {
                    maxRoundScore = prevRoundScore;
                    firstPlayerIdx = idx;
                }
            });
            this.currentPlayerIndex = firstPlayerIdx;
        }
    }

    // ======= JOKER REVEAL =======

    revealJoker() {
        this.jokerRevealed = true;
        const penalties = [];
        this.discardPile.forEach((card, idx) => {
            if (card.rank === this.jokerRank) {
                const playerId = card.discardedBy != null ? card.discardedBy : idx;
                const penaltyValues = { 'A': -150, 'J': -100, 'Q': -100, 'K': -100 };
                const penalty = penaltyValues[card.rank] || -50;
                this.initialPenalties[playerId] = penalty;
                this.players[playerId].score += penalty;
                penalties.push({ playerId, card: card.toJSON(), penalty });
            }
        });
        return penalties;
    }

    // ======= DRAW =======

    drawFromDeck(playerId) {
        if (this.phase !== 'draw' || this.hasDrawn) return { success: false, reason: 'Bukan fase ambil kartu' };
        if (this.currentPlayerIndex !== playerId) return { success: false, reason: 'Bukan giliran kamu' };
        if (this.deck.length === 0) {
            return this.handleDeckEmpty();
        }
        const card = this.deck.pop();
        this.players[playerId].hand.push(card);
        this.sortHand(this.players[playerId]);
        this.hasDrawn = true;
        this.drawnFromDiscard = false;
        this.meldedThisTurn = false;
        this.usedDrawnDiscardThisTurn = false; // Reset for deck draw
        this.drawnDiscardIds = new Set(); // Reset for deck draw
        this.drawnDiscardCount = 0; // Reset for deck draw
        this.phase = 'meld';
        return { success: true, card: card.toJSON() };
    }

    getMaxDiscardPickup() {
        if (!this.jokerRevealed || this.discardPile.length === 0) return Math.min(MAX_DISCARD_PICKUP, this.discardPile.length);
        let count = 0;
        for (let i = this.discardPile.length - 1; i >= 0; i--) {
            if (this.discardPile[i].rank === this.jokerRank) break;
            count++;
        }
        return Math.min(count, MAX_DISCARD_PICKUP);
    }

    canMeldWithDiscardCards(player, discardCards) {
        const allCards = [...player.hand, ...discardCards];
        const game = this;
        const discardIds = new Set(discardCards.map(c => c.id));
        const handIds = new Set(player.hand.map(c => c.id));
        const bottomCard = discardCards[0];

        const isValidPickup = (meldCards) => {
            const fromDiscard = meldCards.filter(c => discardIds.has(c.id)).length;
            const fromHand = meldCards.filter(c => handIds.has(c.id)).length;
            const includesBottom = meldCards.some(c => c.id === bottomCard.id);
            // The player's hand after picking up discard cards and melding must have at least 1 card remaining to discard.
            // Total cards = (player.hand.length + discardCards.length)
            // Cards used in meld = meldCards.length
            // Remaining cards = (player.hand.length + discardCards.length) - meldCards.length
            // This must be >= 1
            const leavesOneCard = (player.hand.length + discardCards.length - meldCards.length) >= 1;
            return fromDiscard >= 1 && fromHand >= 2 && includesBottom && leavesOneCard;
        };

        const nonJokers = allCards.filter(c => !c.isJoker(game));
        const jokers = allCards.filter(c => c.isJoker(game));

        // Check runs (group by suit only)
        const bySuit = {};
        nonJokers.forEach(c => {
            if (jokers.length === 0 && c.rank === 'A') return; // ACE excluded without joker
            const suit = c.suit;
            if (!bySuit[suit]) bySuit[suit] = [];
            bySuit[suit].push(c);
        });

        for (const suit in bySuit) {
            const suitCards = bySuit[suit].sort((a, b) => a.order - b.order);
            const unique = []; const seenOrders = new Set();
            suitCards.forEach(c => { if (!seenOrders.has(c.order)) { seenOrders.add(c.order); unique.push(c); } });
            for (let i = 0; i < unique.length; i++) {
                const run = [unique[i]]; let jokersUsed = 0; let lastOrder = unique[i].order;
                for (let j = i + 1; j < unique.length; j++) {
                    const gap = unique[j].order - lastOrder - 1;
                    if (gap === 0) { run.push(unique[j]); lastOrder = unique[j].order; }
                    else if (gap <= jokers.length - jokersUsed) {
                        for (let g = 0; g < gap; g++) { run.push(jokers[jokersUsed++]); }
                        run.push(unique[j]); lastOrder = unique[j].order;
                    } else break;
                }

                // Allow substrings of this maximal run
                for (let len = 3; len <= run.length; len++) {
                    for (let start = 0; start <= run.length - len; start++) {
                        const subRun = run.slice(start, start + len);
                        if (isValidPickup(subRun)) {
                            const runNonJokers = subRun.filter(c => !c.isJoker(game));
                            const groups = new Set(runNonJokers.map(c => getRunGroup(c.rank)));
                            const hasAce = runNonJokers.some(c => c.rank === 'A');

                            // Strict rule: Never mix numbers and faces
                            if (groups.size > 1) continue;

                            // Strict rule: Ace cannot be used in runs without a joker
                            if (jokers.length === 0 && hasAce) continue;

                            return true;
                        }
                    }
                }
            }
        }

        const checkSetWithRunInHand = (setCards) => {
            if (player.hasRun) return true;

            // 4 As is allowed as first meld
            const isAllAces = setCards.filter(c => !c.isJoker(game)).every(c => c.rank === 'A') && setCards.length === 4;
            if (isAllAces) return true;

            const setIds = new Set(setCards.map(c => c.id));
            const remainingHand = player.hand.filter(c => !setIds.has(c.id));
            const handMelds = game.findHandMelds(remainingHand).melds;
            return handMelds.some(m => m.type === 'run');
        };

        // Check sets
        const byRank = {};
        nonJokers.forEach(c => { if (!byRank[c.rank]) byRank[c.rank] = []; byRank[c.rank].push(c); });
        for (const rank in byRank) {
            const group = byRank[rank];
            const uniqueSuits = []; const seen = new Set();
            group.forEach(c => { if (!seen.has(c.suit)) { seen.add(c.suit); uniqueSuits.push(c); } });

            if (uniqueSuits.length >= 3) {
                const setCards = uniqueSuits.slice(0, Math.min(4, uniqueSuits.length));
                if (isValidPickup(setCards) && checkSetWithRunInHand(setCards)) return true;
            }
            if (uniqueSuits.length === 2 && jokers.length > 0) {
                const setCards = [...uniqueSuits, jokers[0]];
                if (isValidPickup(setCards) && checkSetWithRunInHand(setCards)) return true;
            }
        }

        // 4 aces
        const aces = allCards.filter(c => c.rank === 'A' && !c.isJoker(game));
        if (aces.length >= 3) {
            const setCards = aces.slice(0, Math.min(4, aces.length));
            if (isValidPickup(setCards) && checkSetWithRunInHand(setCards)) return true;
        }

        return false;
    }
    drawFromDiscard(playerId, count = 1) {
        if (!this.jokerRevealed) return { success: false, reason: 'Joker belum dibuka, harus ambil dari deck' };
        if (this.phase !== 'draw' || this.hasDrawn) return { success: false, reason: 'Bukan fase ambil kartu' };
        if (this.currentPlayerIndex !== playerId) return { success: false, reason: 'Bukan giliran kamu' };
        const maxPickup = this.getMaxDiscardPickup();
        if (maxPickup === 0) return { success: false, reason: 'Kartu teratas buangan adalah joker — tidak bisa diambil.' };
        if (count < 1 || count > maxPickup) return { success: false, reason: `Hanya bisa ambil 1-${maxPickup} kartu` };
        if (count > this.discardPile.length) return { success: false, reason: 'Kartu buangan tidak cukup' };

        const discardCards = this.discardPile.slice(-count);
        if (!this.canMeldWithDiscardCards(this.players[playerId], discardCards)) {
            return { success: false, reason: 'Tidak bisa turun dengan kartu buangan ini.' };
        }

        const taken = [];
        for (let i = 0; i < count; i++) { taken.push(this.discardPile.pop()); }
        taken.forEach(c => this.players[playerId].hand.push(c));
        this.sortHand(this.players[playerId]);
        this.hasDrawn = true;
        this.drawnFromDiscard = true;
        this.players[playerId].hasDrawnFromDiscardThisRound = true;
        this.lastDrawnDiscardProvider = discardCards[0].discardedBy; // Cekih tracking
        this.drawnDiscardIds = new Set(taken.map(c => c.id));
        this.drawnDiscardCount = count; // Track how many cards were drawn for Cekih
        this.meldedThisTurn = false;
        this.usedDrawnDiscardThisTurn = false; // Reset for discard draw
        this.phase = 'meld';

        // Removed auto-meld run logic as per instruction

        return { success: true, cards: taken.map(c => c.toJSON()) };
    }

    // ======= MELD =======

    validateMeld(cards) {
        if (cards.length < 3) return { valid: false, reason: 'Minimal 3 kartu untuk turun' };
        const game = this;
        const nonJokers = cards.filter(c => !c.isJoker(game));
        const jokerCount = cards.filter(c => c.isJoker(game)).length;
        if (nonJokers.length < 2) return { valid: false, reason: 'Minimal 2 kartu asli' };
        const ranks = new Set(nonJokers.map(c => c.rank));
        const suits = new Set(nonJokers.map(c => c.suit));

        if (ranks.size === 1 && suits.size === nonJokers.length) {
            if (cards.length > 4) return { valid: false, reason: 'Set maksimal 4 kartu' };
            return { valid: true, type: 'set' };
        }

        const groups = new Set(nonJokers.map(c => getRunGroup(c.rank)));
        if (groups.size > 1) return { valid: false, reason: 'Angka dan gambar tidak bisa dicampur.' };

        if (jokerCount === 0) {
            if (nonJokers.some(c => c.rank === 'A')) return { valid: false, reason: 'AS hanya untuk set (tanpa joker).' };
        }

        if (suits.size === 1) {
            const orders = nonJokers.map(c => c.order).sort((a, b) => a - b);
            let needed = 0;
            for (let i = 0; i < orders.length - 1; i++) {
                const gap = orders[i + 1] - orders[i] - 1;
                if (gap < 0) return { valid: false, reason: 'Kartu duplikat dalam run' };
                needed += gap;
            }
            if (needed <= jokerCount) return { valid: true, type: 'run' };
            else return { valid: false, reason: 'Kartu tidak berurutan' };
        }
        return { valid: false, reason: 'Bukan set atau run yang valid' };
    }

    playMeld(playerId, cardIds) {
        if (!this.jokerRevealed) return { success: false, reason: 'Joker belum dibuka, tidak bisa turun' };
        if (this.phase !== 'meld' && this.phase !== 'draw') return { success: false, reason: 'Bukan fase turun' };
        if (this.currentPlayerIndex !== playerId) return { success: false, reason: 'Bukan giliran kamu' };
        const player = this.players[playerId];
        const cards = cardIds.map(id => player.hand.find(c => c.id === id)).filter(Boolean);
        if (cards.length !== cardIds.length) return { success: false, reason: 'Kartu tidak ditemukan' };

        // Block melding if it would leave 0 cards (need at least 1 to discard)
        if (player.hand.length - cards.length < 1) {
            return { success: false, reason: 'Harus ada minimal 1 kartu tersisa untuk dibuang!' };
        }

        const validation = this.validateMeld(cards);
        if (!validation.valid) return { success: false, reason: validation.reason };

        if (!player.hasRun && validation.type === 'set') {
            const isAllAces = cards.filter(c => !c.isJoker(this)).every(c => c.rank === 'A') && cards.length === 4;
            if (!isAllAces) return { success: false, reason: 'Turun pertama harus Run. Atau 4 As.' };
        }

        cards.forEach(card => { const idx = player.hand.findIndex(c => c.id === card.id); if (idx !== -1) player.hand.splice(idx, 1); });
        const meld = new Meld(cards, playerId, this.meldIdCounter++, this);
        this.melds.push(meld);
        player.hasMelded = true;
        this.meldedThisTurn = true;
        if (this.drawnFromDiscard && cardIds.some(id => this.drawnDiscardIds.has(id))) {
            this.usedDrawnDiscardThisTurn = true; // Updated property name
        }
        if (validation.type === 'run') player.hasRun = true;
        if (validation.type === 'set' && cards.length === 4 && cards.filter(c => !c.isJoker(this)).every(c => c.rank === 'A')) {
            player.hasRun = true;
        }

        if (player.hand.length === 0) {
            // Last card was melded — but in Remi you must discard to win, so this shouldn't happen with proper play
            // We treat it as a valid finish
        }
        return { success: true, meld: meld.toJSON() };
    }

    // ======= DISCARD =======

    discard(playerId, cardId) {
        if (this.phase !== 'meld' && this.phase !== 'discard') return { success: false, reason: 'Bukan fase buang' };
        if (this.currentPlayerIndex !== playerId) return { success: false, reason: 'Bukan giliran kamu' };

        const player = this.players[playerId];

        if (this.drawnFromDiscard) {
            if (!this.usedDrawnDiscardThisTurn) { // Updated property name
                return { success: false, reason: 'Ambil dari buangan, minimal 1 kartu buangan harus digunakan untuk turun kartu (meld) terlebih dahulu!' };
            }
        }

        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return { success: false, reason: 'Kartu tidak ditemukan' };

        if (player.hand.length === 1) {
            const card = player.hand.splice(cardIndex, 1)[0];
            return this.handleTutupDeck(player, card);
        }

        const card = player.hand.splice(cardIndex, 1)[0];
        let jokerPenalty = 0;

        // Only apply immediate penalty if the Joker is already revealed.
        // If discarded before reveal, it will be handled inside revealJoker().
        if (this.jokerRevealed && card.isJoker(this)) {
            const penaltyValues = { 'A': -150, 'J': -100, 'Q': -100, 'K': -100 };
            jokerPenalty = penaltyValues[card.rank] || -50;
            player.score += jokerPenalty;
        }

        // --- Tris Four Rule ---
        // Player hasn't melded, hasn't drawn from discard, joker is revealed, hand has exactly 7 cards.
        if (this.jokerRevealed && !player.hasMelded && !player.hasDrawnFromDiscardThisRound && player.hand.length === 7) {
            if (this.isTrisFour(player.hand)) {
                // If they threw a joker just now, revert the penalty because Tris Four grants exactly +300 pure win
                if (jokerPenalty < 0) {
                    player.score -= jokerPenalty;
                    jokerPenalty = 0;
                }
                return this.handleGameEnd(player, 0, card, null, null, true);
            }
        }

        // Tag the card with who discarded it for Cekih
        card.discardedBy = playerId;
        this.discardPile.push(card);

        if (this.deck.length === 0) {
            const endResult = this.handleDeckEmpty();
            endResult.jokerPenalty = jokerPenalty;
            endResult.discardedCard = card;
            return endResult;
        }

        let jokerRevealData = null;
        if (!this.jokerRevealed && this.discardPile.length === NUM_PLAYERS) {
            const penalties = this.revealJoker();
            jokerRevealData = { jokerCard: this.jokerCard.toJSON(), jokerRank: this.jokerRank, penalties };
        }

        this.nextTurn();
        return { success: true, jokerPenalty, discardedCard: card, jokerRevealData };
    }

    // ======= GAME END =======

    handleTutupDeck(player, card) {
        let bonus = 0;
        let zeroDiscardBonus = null;
        if (!player.hasDrawnFromDiscardThisRound) {
            zeroDiscardBonus = card.isJoker(this) ? 500 : 250;
        }

        if (card.isJoker(this)) bonus = 500;
        else if (card.rank === 'A') bonus = 150;
        else if (isFaceRank(card.rank)) bonus = 100;
        else bonus = 50;

        // Cekih Penalty Logic
        let cekihDetails = null;
        // System 1: Ambil 1 kartu → tutup deck → pembuang kena cekih
        if (this.drawnFromDiscard && this.drawnDiscardCount === 1 && this.lastDrawnDiscardProvider !== null && this.lastDrawnDiscardProvider !== player.id) {
            const penalty = -bonus;
            cekihDetails = {
                providerId: this.lastDrawnDiscardProvider,
                penalty: penalty
            };
        }
        // System 2: Ambil 2 kartu → tutup deck → pembuang kartu paling bawah kena cekih
        if (!cekihDetails && this.drawnFromDiscard && this.drawnDiscardCount === 2 && this.lastDrawnDiscardProvider !== null && this.lastDrawnDiscardProvider !== player.id) {
            const penalty = -bonus;
            cekihDetails = {
                providerId: this.lastDrawnDiscardProvider,
                penalty: penalty
            };
        }

        return this.handleGameEnd(player, bonus, card, cekihDetails, zeroDiscardBonus);
    }

    handleDeckEmpty() {
        // If no player has melded at all, it's a deadlock — everyone gets 0
        const anyoneMelded = this.players.some(p => p.hasMelded);
        const isDeadlock = !anyoneMelded;
        return this.handleGameEnd(null, 0, null, null, isDeadlock ? 0 : null);
    }

    calcMeldPoints(meld) {
        let total = 0;
        const game = this;
        const nonJokers = meld.cards.filter(c => !c.isJoker(game));
        if (meld.type === 'set') {
            const rankValue = nonJokers.length > 0 ? nonJokers[0].value : 5;
            total = meld.cards.length * rankValue;
        } else if (meld.type === 'run') {
            const group = nonJokers.length > 0 ? getRunGroup(nonJokers[0].rank) : 'number';
            total = meld.cards.length * (group === 'face' ? 10 : 5);
        } else {
            total = meld.cards.reduce((s, c) => s + c.value, 0);
        }
        return total;
    }

    findHandMelds(hand, hasExistingRun = false) {
        const game = this;
        if (hand.length === 0) return { melds: [], singles: [] };

        // Step 1: Find ALL possible valid melds from hand
        const allPossibleMelds = [];
        const getCombos = (arr, size) => {
            const result = [];
            const runner = (start, combo) => {
                if (combo.length === size) { result.push([...combo]); return; }
                for (let i = start; i < arr.length; i++) runner(i + 1, [...combo, arr[i]]);
            };
            runner(0, []);
            return result;
        };

        for (let size = 3; size <= Math.min(7, hand.length); size++) {
            const combos = getCombos(hand, size);
            for (const combo of combos) {
                const validation = game.validateMeld(combo);
                if (validation.valid) {
                    allPossibleMelds.push({ cards: combo, type: validation.type, ids: new Set(combo.map(c => c.id)) });
                }
            }
        }

        if (allPossibleMelds.length === 0) {
            return { melds: [], singles: [...hand] };
        }

        // Step 2: Calculate penalty for remaining cards
        const calcPenalty = (cards) => {
            let penalty = 0;
            cards.forEach(c => {
                if (c.isJoker(game)) {
                    const pv = { 'A': 150, 'J': 100, 'Q': 100, 'K': 100 };
                    penalty += (pv[c.rank] || 50);
                } else {
                    penalty += c.value;
                }
            });
            return penalty;
        };

        // Step 3: Calculate meld points
        const calcMeldPts = (meld) => {
            const nonJokers = meld.cards.filter(c => !c.isJoker(game));
            if (meld.type === 'set') {
                const rankValue = nonJokers.length > 0 ? nonJokers[0].value : 5;
                return meld.cards.length * rankValue;
            } else if (meld.type === 'run') {
                const group = nonJokers.length > 0 ? getRunGroup(nonJokers[0].rank) : 'number';
                return meld.cards.length * (group === 'face' ? 10 : 5);
            }
            return meld.cards.reduce((s, c) => s + c.value, 0);
        };

        // Step 4: Recursive search for best non-overlapping combination
        let bestScore = -Infinity;
        let bestMelds = [];

        const usedIds = new Set();
        const chosenMelds = [];

        const isRunOrAces = (m) => {
            return m.type === 'run' || (m.type === 'set' && m.cards.length === 4 && m.cards.filter(c => !c.isJoker(game)).every(c => c.rank === 'A'));
        };

        const search = (startIdx) => {
            // Check if this combination has a run (or 4 Aces)
            const comboHasRun = hasExistingRun || chosenMelds.some(m => isRunOrAces(m));

            // Calculate current score — sets only count if a run exists
            let meldPoints = 0;
            const setCardIds = new Set(); // track set cards that don't count without a run
            chosenMelds.forEach(m => {
                if (comboHasRun || isRunOrAces(m)) {
                    meldPoints += calcMeldPts(m);
                } else {
                    // No run: set cards become penalty (minus), not meld points
                    m.ids.forEach(id => setCardIds.add(id));
                }
            });
            // Remaining cards + set cards without run all count as penalty
            const penaltyCards = hand.filter(c => !usedIds.has(c.id) || setCardIds.has(c.id));
            const penalty = calcPenalty(penaltyCards);
            const netScore = meldPoints - penalty;

            if (netScore > bestScore) {
                bestScore = netScore;
                bestMelds = [...chosenMelds];
            }

            // Try adding more melds
            for (let i = startIdx; i < allPossibleMelds.length; i++) {
                const meld = allPossibleMelds[i];
                // Check no overlap with already used cards
                let overlap = false;
                for (const id of meld.ids) {
                    if (usedIds.has(id)) { overlap = true; break; }
                }
                if (overlap) continue;

                // Use this meld
                meld.ids.forEach(id => usedIds.add(id));
                chosenMelds.push(meld);
                search(i + 1);
                chosenMelds.pop();
                meld.ids.forEach(id => usedIds.delete(id));
            }
        };

        search(0);

        // Step 5: Build result from best combination
        const bestIds = new Set();
        const resultMelds = bestMelds.map(m => {
            m.cards.forEach(c => bestIds.add(c.id));
            return new Meld(m.cards, -1, -1, game);
        });
        const singles = hand.filter(c => !bestIds.has(c.id));

        return { melds: resultMelds, singles };
    }

    calculatePlayerScore(player, isWinner, bonus = 0) {
        let meldedPositive = 0, handPositive = 0, handNegative = 0;
        const playerMelds = this.melds.filter(m => m.owner === player.id);
        playerMelds.forEach(m => { meldedPositive += this.calcMeldPoints(m); });

        // Check if player has a run or 4 Aces (either already melded or in hand)
        let hasValidBaseMeld = playerMelds.some(m => m.type === 'run' || (m.type === 'set' && m.cards.length === 4 && m.cards.filter(c => !c.isJoker(this)).every(c => c.rank === 'A')));

        let handMelds = [];
        let singles = [];

        if (player.hand.length > 0) {
            const result = this.findHandMelds(player.hand, hasValidBaseMeld);
            handMelds = result.melds;
            singles = result.singles;

            // Also check hand melds for run or 4 Aces
            if (!hasValidBaseMeld) {
                hasValidBaseMeld = handMelds.some(m => m.type === 'run' || (m.type === 'set' && m.cards.length === 4 && m.cards.filter(c => !c.isJoker(this)).every(c => c.rank === 'A')));
            }

            // If still no valid base meld, all sets in hand become singles
            if (!hasValidBaseMeld) {
                handMelds.forEach(m => {
                    if (m.type === 'set') {
                        singles.push(...m.cards);
                    }
                });
                handMelds = handMelds.filter(m => m.type !== 'set'); // Remove them from melds
            }

            handMelds.forEach(m => { handPositive += this.calcMeldPoints(m); });

            singles.forEach(c => {
                if (c.isJoker(this)) {
                    const penaltyValues = { 'A': 150, 'J': 100, 'Q': 100, 'K': 100 };
                    handNegative -= (penaltyValues[c.rank] || 50);
                } else {
                    handNegative -= c.value;
                }
            });
        }

        const roundScore = meldedPositive + handPositive + handNegative + bonus;
        return { playerId: player.id, playerName: player.name, meldedPositive, handPositive, handNegative, tutupDeckBonus: bonus, roundScore, totalScore: player.score + roundScore, isWinner };
    }

    handleGameEnd(winner, bonus = 0, tutupDeckCard = null, cekihDetails = null, zeroDiscardBonus = null, isTrisFour = false) {
        this.phase = 'gameover';
        this.winner = winner;

        // --- Overtake Rule Implementation Start ---
        // 1. Snapshot initial scores
        const initialScores = {};
        this.players.forEach(p => initialScores[p.id] = p.score);

        // Find players who already have >= 100 points
        const targetPlayers = this.players.filter(p => p.score >= 100).map(p => p.id);

        // 2. Calculate preliminary round details
        const details = this.players.map(p => {
            const isWinner = winner && p.id === winner.id;

            let detail;
            // Handle Tris Four
            if (isTrisFour) {
                detail = {
                    playerId: p.id,
                    playerName: p.name,
                    meldedPositive: 0,
                    handPositive: 0,
                    handNegative: 0,
                    tutupDeckBonus: isWinner ? 300 : 0,
                    roundScore: isWinner ? 300 : 0,
                    isWinner
                };
            } else if (zeroDiscardBonus !== null) {
                // If special zero discard bonus applies, zero out everything for everyone except winner's bonus
                detail = this.calculatePlayerScore(p, isWinner, 0); // Call for base structure
                detail.roundScore = isWinner ? zeroDiscardBonus : 0;
                detail.handPositive = 0;
                detail.handNegative = 0;
                detail.meldedPositive = 0;
                if (isWinner) detail.tutupDeckBonus = zeroDiscardBonus;
            } else {
                detail = this.calculatePlayerScore(p, isWinner, isWinner ? bonus : 0);

                // Apply Cekih if applicable
                if (cekihDetails && p.id === cekihDetails.providerId) {
                    detail.cekihPenalty = cekihDetails.penalty;
                    detail.roundScore += cekihDetails.penalty;
                }
            }

            detail.preliminaryTotal = p.score + detail.roundScore;
            return detail;
        });

        // 3. Check for overtakes
        const resettablePlayers = new Set();
        targetPlayers.forEach(targetId => {
            const initialScore = initialScores[targetId];

            // Only count overtake if someone who was BELOW this player now reaches or passes them
            const isOvertaken = details.some(d => {
                if (d.playerId === targetId) return false;
                const otherInitialScore = initialScores[d.playerId];
                // Other player must have been BELOW target before this round
                return otherInitialScore < initialScore && d.preliminaryTotal >= initialScore;
            });
            if (isOvertaken) {
                resettablePlayers.add(targetId);
            }
        });

        // 4. Apply final scores
        const scores = details.map(detail => {
            const p = this.players.find(player => player.id === detail.playerId);

            if (resettablePlayers.has(p.id)) {
                // Reset to 0
                detail.totalScore = 0;
                detail.wasOvertaken = true; // Add flag for UI if needed
                p.score = 0;
            } else {
                detail.totalScore = detail.preliminaryTotal;
                p.score = detail.totalScore;
            }
            delete detail.preliminaryTotal; // Cleanup temporary property

            return detail;
        });
        // --- Overtake Rule Implementation End ---

        // Store round scores for next round's first player determination
        this.lastRoundScores = {};
        scores.forEach(s => { this.lastRoundScores[s.playerId] = s.roundScore; });

        return {
            success: true, gameOver: true,
            winner: winner ? { id: winner.id, name: winner.name } : null,
            tutupDeckCard: tutupDeckCard ? tutupDeckCard.toJSON() : null,
            scores
        };
    }

    // ======= UTILITIES =======

    createDeck() {
        this.deck = [];
        this.cardIdCounter = 0;
        for (const suit of SUITS) {
            for (const rank of RANKS) {
                this.deck.push(new Card(suit, rank, this.cardIdCounter++));
            }
        }
    }

    shuffleDeck() {
        for (let i = this.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }
    }

    sortHand(player) {
        const game = this;
        player.hand.sort((a, b) => {
            if (game.jokerRevealed) {
                if (a.isJoker(game) && !b.isJoker(game)) return 1;
                if (!a.isJoker(game) && b.isJoker(game)) return -1;
            }
            if (a.suitName !== b.suitName) return SUIT_NAMES.indexOf(a.suitName) - SUIT_NAMES.indexOf(b.suitName);
            return a.order - b.order;
        });
    }

    nextTurn() {
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % NUM_PLAYERS;
        this.phase = 'draw';
        this.hasDrawn = false;
        this.drawnFromDiscard = false;
        this.meldedThisTurn = false;
        this.usedDrawnDiscardThisTurn = false; // Reset for next turn
        this.drawnDiscardIds = new Set(); // Reset for next turn
        this.drawnDiscardCount = 0; // Reset for next turn
    }

    get currentPlayer() { return this.players[this.currentPlayerIndex]; }

    // Get state visible to a specific player
    getStateForPlayer(playerId) {
        return {
            id: this.id,
            phase: this.phase,
            round: this.round,
            currentPlayerIndex: this.currentPlayerIndex,
            isMyTurn: this.currentPlayerIndex === playerId,
            myPlayerId: playerId,
            deckCount: this.deck.length,
            discardPile: this.discardPile.map(c => c.toJSON()),
            maxDiscardPickup: this.getMaxDiscardPickup(),
            jokerCard: this.jokerRevealed ? this.jokerCard.toJSON() : null,
            jokerRank: this.jokerRevealed ? this.jokerRank : null,
            jokerRevealed: this.jokerRevealed,
            drawnFromDiscard: this.drawnFromDiscard,
            hasDrawnFromDiscardThisRound: this.players.find(p => p.id === playerId)?.hasDrawnFromDiscardThisRound || false,
            meldedThisTurn: this.meldedThisTurn,
            usedDrawnDiscardThisTurn: this.usedDrawnDiscardThisTurn, // Expose new property
            hasDrawn: this.hasDrawn,
            melds: this.melds.map(m => m.toJSON()),
            players: this.players.map(p => ({
                id: p.id,
                name: p.name,
                cardCount: p.hand.length,
                hasMelded: p.hasMelded,
                hasRun: p.hasRun,
                score: p.score,
                isCekih: this.checkCekihPotential(p),
                hand: p.id === playerId ? p.hand.map(c => {
                    const json = c.toJSON();
                    json.isJoker = this.jokerRevealed && c.rank === this.jokerRank;
                    return json;
                }) : null
            })),
            initialPenalties: this.initialPenalties
        };
    }

    isTrisFour(hand) {
        if (hand.length !== 7) return false;

        const getCombos = (arr, size) => {
            const result = [];
            const runner = (start, combo) => {
                if (combo.length === size) { result.push([...combo]); return; }
                for (let i = start; i < arr.length; i++) runner(i + 1, [...combo, arr[i]]);
            };
            runner(0, []);
            return result;
        };

        const combos3 = getCombos(hand, 3);
        const game = this;
        for (const combo3 of combos3) {
            const combo3Ids = new Set(combo3.map(c => c.id));
            const combo4 = hand.filter(c => !combo3Ids.has(c.id));

            const val3 = game.validateMeld(combo3);
            const val4 = game.validateMeld(combo4);

            // BOTH must be valid SETS
            if (val3.valid && val3.type === 'set' && val4.valid && val4.type === 'set') {
                return true;
            }
        }
        return false;
    }

    canPartitionIntoMelds(cards, needRun) {
        if (cards.length === 0) return !needRun;
        if (cards.length < 3) return false;

        let firstIdx = cards.findIndex(c => !c.isJoker(this));
        if (firstIdx === -1) return false; // purely jokers left

        const firstCard = cards[firstIdx];
        const rest = cards.filter((c, i) => i !== firstIdx);

        // Filter to reasonable cards for this set/run
        const relevantRest = rest.filter(c => c.isJoker(this) || c.rank === firstCard.rank || c.suit === firstCard.suit);

        const getCombos = (arr, size) => {
            const result = [];
            const runner = (start, combo) => {
                if (combo.length === size) { result.push(combo); return; }
                for (let i = start; i < arr.length; i++) {
                    runner(i + 1, [...combo, arr[i]]);
                }
            };
            runner(0, []);
            return result;
        };

        for (let size = 2; size <= Math.min(6, relevantRest.length); size++) {
            const combos = getCombos(relevantRest, size);
            for (const combo of combos) {
                const potentialMeld = [firstCard, ...combo];
                const validation = this.validateMeld(potentialMeld);
                if (validation.valid) {
                    let stillNeedRun = needRun;
                    if (needRun) {
                        const isAllAces = potentialMeld.filter(c => !c.isJoker(this)).every(c => c.rank === 'A') && potentialMeld.length === 4;
                        if (validation.type === 'run' || isAllAces) stillNeedRun = false;
                    }

                    if (stillNeedRun && potentialMeld.length === cards.length) continue;

                    const usedIds = new Set(combo.map(c => c.id));
                    const remaining = rest.filter(c => !usedIds.has(c.id));

                    if (this.canPartitionIntoMelds(remaining, stillNeedRun)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    checkCekihPotential(player) {
        if (!this.jokerRevealed || player.hand.length < 2) return false;

        const uniqueCardsToTest = [];
        let testId = 9000;
        for (const s of SUITS) {
            for (const r of RANKS) {
                const c = new Card(s, r, testId++);
                if (!c.isJoker(this)) uniqueCardsToTest.push(c);
            }
        }
        uniqueCardsToTest.push(new Card('🃏', 'Joker', testId++));
        if (this.jokerRank) uniqueCardsToTest.push(new Card('♠', this.jokerRank, testId++));

        const needRun = !player.hasRun;

        let system1Potential = false;
        let system2Potential = false;

        for (const c of uniqueCardsToTest) {
            const testHand = [...player.hand, c];

            // System 2 Potential (perfect melds, 0 discard needed since taking 2 cards allows discarding the top one)
            if (!system2Potential && this.canPartitionIntoMelds(testHand, needRun)) {
                system2Potential = true;
            }

            // System 1 Potential (perfect melds + 1 discard from hand)
            if (!system1Potential) {
                for (let i = 0; i < player.hand.length; i++) {
                    const discardId = player.hand[i].id;
                    const remaining = testHand.filter(card => card.id !== discardId);
                    if (this.canPartitionIntoMelds(remaining, needRun)) {
                        system1Potential = true;
                        break;
                    }
                }
            }

            if (system1Potential && system2Potential) break;
        }

        if (!system1Potential && !system2Potential) return false;

        const pIndex = this.players.findIndex(p => p.id === player.id);
        const pSystem1 = this.players[(pIndex + 3) % 4];
        const pSystem2 = this.players[(pIndex + 2) % 4];

        const targets = [];
        if (system1Potential && pSystem1) targets.push(pSystem1.name);
        if (system2Potential && pSystem2) targets.push(pSystem2.name);

        return targets.length > 0 ? targets.join(', ').toUpperCase() : false;
    }
}

module.exports = { ServerGame, Card, Meld, NUM_PLAYERS, isFaceRank };
