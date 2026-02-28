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

const INITIAL_CARDS = 8;
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
            id: i, name, hand: [], hasMelded: false, hasRun: false, score: 0
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
        this.winner = null;
        this.jokerRank = null;
        this.jokerCard = null;
        this.jokerRevealed = false;
        this.initialDiscardCount = 0;
        this.initialPenalties = {};
    }

    // ======= INIT & DEAL =======

    initRound() {
        this.createDeck();
        this.shuffleDeck();
        this.players.forEach(p => { p.hand = []; p.hasMelded = false; p.hasRun = false; });
        this.melds = [];
        this.discardPile = [];
        this.currentPlayerIndex = 0;
        this.winner = null;
        this.meldIdCounter = 0;
        this.hasDrawn = false;
        this.drawnFromDiscard = false;
        this.meldedThisTurn = false;
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
        this.phase = 'initial_discard';
        this.currentPlayerIndex = 0;
    }

    // ======= INITIAL DISCARD & JOKER =======

    initialDiscard(playerId, cardId) {
        if (this.phase !== 'initial_discard') return { success: false, reason: 'Bukan fase buang awal' };
        if (this.currentPlayerIndex !== playerId) return { success: false, reason: 'Bukan giliran kamu' };
        const player = this.players[playerId];
        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return { success: false, reason: 'Kartu tidak ditemukan' };
        const card = player.hand.splice(cardIndex, 1)[0];
        this.discardPile.push(card);
        this.initialDiscardCount++;

        if (this.initialDiscardCount >= NUM_PLAYERS) {
            this.phase = 'joker_reveal';
            return { success: true, allDone: true };
        }
        this.currentPlayerIndex = (this.currentPlayerIndex + 1) % NUM_PLAYERS;
        return { success: true, allDone: false };
    }

    revealJoker() {
        this.jokerRevealed = true;
        const penalties = [];
        this.discardPile.forEach((card, idx) => {
            if (card.rank === this.jokerRank) {
                const playerId = idx;
                const penaltyValues = { 'A': -150, 'J': -100, 'Q': -100, 'K': -100 };
                const penalty = penaltyValues[card.rank] || -50;
                this.initialPenalties[playerId] = penalty;
                this.players[playerId].score += penalty;
                penalties.push({ playerId, card: card.toJSON(), penalty });
            }
        });
        this.phase = 'draw';
        this.currentPlayerIndex = 0;
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
            return fromDiscard >= 1 && fromHand >= 2 && includesBottom;
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
        this.drawnDiscardIds = new Set(taken.map(c => c.id));
        this.meldedThisTurn = false;
        this.phase = 'meld';

        // Auto-meld run if player doesn't have one and there is a valid run in hand
        if (!this.players[playerId].hasRun) {
            const handMelds = this.findHandMelds(this.players[playerId].hand).melds;
            const runMeld = handMelds.find(m => m.type === 'run');
            if (runMeld) {
                const runCardIds = runMeld.cards.map(c => c.id);
                this.playMeld(playerId, runCardIds);
            }
        }

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
            if (!this.meldedThisTurn) {
                return { success: false, reason: 'Ambil dari buangan harus turun dulu!' };
            }
            // Ensure at least one drawn discard card was used in SOME meld this turn
            // The ones NOT melded are still in the hand (or being discarded right now).
            // So if the number of drawn cards in hand equals the original pickup size, none were melded.
            const drawnCardsInHandCount = player.hand.filter(c => this.drawnDiscardIds.has(c.id)).length;
            if (drawnCardsInHandCount === this.drawnDiscardIds.size) {
                return { success: false, reason: 'Ambil dari buangan, minimal 1 kartu buangan harus digunakan untuk turun!' };
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

        if (card.isJoker(this)) {
            const penaltyValues = { 'A': -150, 'J': -100, 'Q': -100, 'K': -100 };
            jokerPenalty = penaltyValues[card.rank] || -50;
            player.score += jokerPenalty;
        }

        this.discardPile.push(card);
        this.nextTurn();
        return { success: true, jokerPenalty, discardedCard: card };
    }

    // ======= GAME END =======

    handleTutupDeck(player, card) {
        let bonus = 0;
        if (card.isJoker(this)) bonus = 300;
        else if (card.rank === 'A') bonus = 150;
        else if (isFaceRank(card.rank)) bonus = 100;
        else bonus = 50;
        return this.handleGameEnd(player, bonus, card);
    }

    handleDeckEmpty() {
        return this.handleGameEnd(null, 0, null);
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

    findHandMelds(hand) {
        const game = this;
        const remaining = [...hand];
        const foundMelds = [];
        const nonJokers = remaining.filter(c => !c.isJoker(game));
        const jokers = remaining.filter(c => c.isJoker(game));
        const availableJokers = [...jokers];
        const usedIds = new Set();

        const bySuitAndGroup = {};
        nonJokers.forEach(c => {
            if (c.rank === 'A') return;
            const group = getRunGroup(c.rank);
            const key = `${c.suit}_${group}`;
            if (!bySuitAndGroup[key]) bySuitAndGroup[key] = [];
            bySuitAndGroup[key].push(c);
        });

        for (const key in bySuitAndGroup) {
            const suitCards = bySuitAndGroup[key].filter(c => !usedIds.has(c.id)).sort((a, b) => a.order - b.order);
            const unique = []; const seenOrders = new Set();
            suitCards.forEach(c => { if (!seenOrders.has(c.order)) { seenOrders.add(c.order); unique.push(c); } });

            for (let i = 0; i < unique.length; i++) {
                const run = [unique[i]]; let lastOrder = unique[i].order;
                let jokersUsed = [];
                for (let j = i + 1; j < unique.length; j++) {
                    const gap = unique[j].order - lastOrder - 1;
                    if (gap === 0 && !usedIds.has(unique[j].id)) {
                        run.push(unique[j]); lastOrder = unique[j].order;
                    } else if (gap > 0 && gap <= availableJokers.length && !usedIds.has(unique[j].id)) {
                        for (let g = 0; g < gap; g++) {
                            const jkr = availableJokers.pop();
                            run.push(jkr);
                            jokersUsed.push(jkr);
                        }
                        run.push(unique[j]); lastOrder = unique[j].order;
                    } else break;
                }

                // If run needs more cards to reach 3, and we have min 2 real cards, use jokers to extend
                let realCount = run.filter(c => !c.isJoker(game)).length;
                while (run.length < 3 && realCount >= 2 && availableJokers.length > 0) {
                    const jkr = availableJokers.pop();
                    run.push(jkr);
                    jokersUsed.push(jkr);
                }

                if (run.length >= 3 && realCount >= 2) {
                    run.forEach(c => usedIds.add(c.id));
                    foundMelds.push(new Meld(run, -1, -1, game));
                    i += realCount - 1;
                } else {
                    // Revert jokers
                    jokersUsed.forEach(jkr => availableJokers.push(jkr));
                }
            }
        }

        const remainingNonJokers = nonJokers.filter(c => !usedIds.has(c.id));
        const byRank = {};
        remainingNonJokers.forEach(c => { if (!byRank[c.rank]) byRank[c.rank] = []; byRank[c.rank].push(c); });

        for (const rank in byRank) {
            const group = byRank[rank];
            const uniqueSuits = []; const seen = new Set();
            group.forEach(c => { if (!seen.has(c.suit) && !usedIds.has(c.id)) { seen.add(c.suit); uniqueSuits.push(c); } });

            if (uniqueSuits.length >= 2) {
                const setCards = uniqueSuits.slice(0, Math.min(4, uniqueSuits.length));
                let jokersUsed = [];
                let realCount = setCards.length;

                while (setCards.length < 3 && realCount >= 2 && availableJokers.length > 0) {
                    const jkr = availableJokers.pop();
                    setCards.push(jkr);
                    jokersUsed.push(jkr);
                }

                if (setCards.length >= 3 && realCount >= 2) {
                    setCards.forEach(c => usedIds.add(c.id));
                    foundMelds.push(new Meld(setCards, -1, -1, game));
                } else {
                    jokersUsed.forEach(jkr => availableJokers.push(jkr));
                }
            }
        }

        // Add remaining jokers back into singles
        const singles = remaining.filter(c => !usedIds.has(c.id));
        return { melds: foundMelds, singles };
    }

    calculatePlayerScore(player, isWinner, bonus = 0) {
        let meldedPositive = 0, handPositive = 0, handNegative = 0;
        this.melds.filter(m => m.owner === player.id).forEach(m => { meldedPositive += this.calcMeldPoints(m); });

        if (player.hand.length > 0) {
            const { melds, singles } = this.findHandMelds(player.hand);
            melds.forEach(m => { handPositive += this.calcMeldPoints(m); });

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

    handleGameEnd(winner, bonus = 0, tutupDeckCard = null) {
        this.phase = 'gameover';
        this.winner = winner;
        const scores = this.players.map(p => {
            const isWinner = winner && p.id === winner.id;
            const detail = this.calculatePlayerScore(p, isWinner, isWinner ? bonus : 0);
            p.score += detail.roundScore;
            return detail;
        });
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
    }

    get currentPlayer() { return this.players[this.currentPlayerIndex]; }

    // Get state visible to a specific player
    getStateForPlayer(playerId) {
        return {
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
            meldedThisTurn: this.meldedThisTurn,
            melds: this.melds.map(m => m.toJSON()),
            players: this.players.map(p => ({
                id: p.id,
                name: p.name,
                cardCount: p.hand.length,
                hasMelded: p.hasMelded,
                hasRun: p.hasRun,
                score: p.score,
                hand: p.id === playerId ? p.hand.map(c => {
                    const json = c.toJSON();
                    json.isJoker = this.jokerRevealed && c.rank === this.jokerRank;
                    return json;
                }) : null
            })),
            initialPenalties: this.initialPenalties
        };
    }
}

module.exports = { ServerGame, Card, Meld, NUM_PLAYERS, isFaceRank };
