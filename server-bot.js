const { Meld } = require('./server-game');

class serverBot {
    constructor(botName, playerIndex, room, actionCallback) {
        this.name = botName;
        this.playerIndex = playerIndex;
        this.room = room;
        this.actionCallback = actionCallback;
        this.socketId = 'BOT_' + playerIndex;
        this.connected = true;
    }

    // Mock socket.emit behavior to receive state updates from the server
    emit(event, data) {
        if (event === 'gameState') {
            if (data.isMyTurn) {
                // Add a small delay for "thinking"
                setTimeout(() => this.playTurn(data), 1000 + Math.random() * 1500);
            }
        } else if (event === 'gameOver') {
            // Auto-vote for next round
            setTimeout(() => {
                this.actionCallback(this.playerIndex, 'requestNextRound');
            }, 4000 + Math.random() * 2000);
        }
    }

    // Helper: call action via the provided callback
    doAction(action, payload) {
        console.log(`[Bot ${this.name}] Attempting action: ${action}`, payload);
        this.actionCallback(this.playerIndex, action, payload);
    }

    playTurn(state) {
        if (!this.connected) return;

        const game = this.room.game;
        if (!game || game.currentPlayerIndex !== this.playerIndex) return;

        console.log(`[Bot ${this.name}] playing turn in phase: ${state.phase}`);

        const phase = state.phase;
        const me = game.players[this.playerIndex];

        if (phase === 'draw') {
            this.doDraw(me, game);
        } else if (phase === 'meld') {
            this.doMeld(me, game);
        } else if (phase === 'discard') {
            this.doDiscard(me);
        }
    }

    getCardValue(card, game) {
        if (game.jokerRevealed && card.isJoker(game)) return -999; // Never discard joker
        if (card.rank === 'A') return 15;
        if (['J', 'Q', 'K'].includes(card.rank)) return 10;
        return 5;
    }

    // Removed doInitialDiscard since it's no longer used

    doDraw(me, game) {
        // Try to draw from discard pile if it makes a meld
        const discardPile = game.discardPile;
        const maxPickup = game.getMaxDiscardPickup();

        if (game.jokerRevealed && maxPickup > 0 && discardPile.length > 0) {
            for (let count = 1; count <= maxPickup; count++) {
                const discards = discardPile.slice(-count);
                if (game.canMeldWithDiscardCards(me, discards)) {
                    this.doAction('drawFromDiscard', { count });
                    return;
                }
            }
        }
        // Otherwise draw from deck
        this.doAction('drawFromDeck');
    }

    doMeld(me, game) {
        if (!game.jokerRevealed) {
            this.doDiscard(me);
            return;
        }

        let maxAttempts = 5;
        let melded = false;

        while (maxAttempts-- > 0) {
            const possibleMelds = this.findAllMelds(me.hand, me, game);
            if (possibleMelds.length === 0) break;

            // Prioritize RUN if hasn't run yet
            let chosenMeld = null;
            if (!me.hasRun) {
                chosenMeld = possibleMelds.find(m => game.validateMeld(m).type === 'run');
                // Or 4 Aces
                if (!chosenMeld) {
                    chosenMeld = possibleMelds.find(m => m.length === 4 && m.filter(c => !c.isJoker(game)).every(c => c.rank === 'A'));
                }
            }

            if (!chosenMeld) {
                chosenMeld = possibleMelds[0]; // Just take the largest point meld
            }

            if (chosenMeld) {
                melded = true;
                this.doAction('playMeld', { cardIds: chosenMeld.map(c => c.id) });
                return; // The 'playMeld' action will cause a state broadcast, re-triggering this bot's turn!
            } else {
                break;
            }
        }

        // If no more melds to play, proceed to discard
        if (!melded || game.phase === 'discard' || game.phase === 'meld') {
            if (game.phase === 'meld') {
                game.phase = 'discard';
            }
            this.doDiscard(me);
        }
    }

    doDiscard(me) {
        const game = this.room.game;
        // Evaluate deadwood
        let worstCard = me.hand[0];
        let maxVal = -9999;

        for (const c of me.hand) {
            let v = this.getCardValue(c, game);
            if (c.rank === 'A') v -= 10; // Keep Aces slightly preferred
            if (v > maxVal) {
                maxVal = v;
                worstCard = c;
            }
        }

        this.doAction('discard', { cardId: worstCard.id });
    }

    // --- MELD FINDING LOGIC ---
    findAllMelds(cards, player, game) {
        const validMelds = [];

        // Simple combinations (Size 3 to 7)
        const getCombos = (arr, size) => {
            const result = [];
            const runner = (start, combo) => {
                if (combo.length === size) { result.push([...combo]); return; }
                for (let i = start; i < arr.length; i++) runner(i + 1, [...combo, arr[i]]);
            };
            runner(0, []);
            return result;
        };

        for (let size = 3; size <= Math.min(7, cards.length); size++) {
            // Must leave at least 1 card to discard, unless maybe they have exactly 3 cards and it's allowed?
            // Actually, server-game.js block melding if (player.hand.length - cards.length < 1)
            if (cards.length - size < 1) continue;

            const combos = getCombos(cards, size);
            for (const combo of combos) {
                const validation = game.validateMeld(combo);
                if (validation.valid) {
                    // Check if it's a valid first meld
                    if (!player.hasRun) {
                        const isAllAces = combo.filter(c => !c.isJoker(game)).every(c => c.rank === 'A') && combo.length === 4;
                        if (validation.type === 'run' || isAllAces) {
                            validMelds.push(combo);
                        }
                    } else {
                        validMelds.push(combo);
                    }
                }
            }
        }

        // Sort by point value descending to play best melds first
        validMelds.sort((a, b) => this.calcMeldPoints(b, game) - this.calcMeldPoints(a, game));

        // Enforce the rule: if drawn from discard, and haven't used any drawn cards yet, MUST play a meld containing drawn cards
        if (game.drawnFromDiscard) {
            const drawnCardsInHandCount = player.hand.filter(c => game.drawnDiscardIds.has(c.id)).length;
            // If all drawn cards are still in hand, it means we haven't used any of them yet
            if (drawnCardsInHandCount === game.drawnDiscardIds.size) {
                const mandatoryMelds = validMelds.filter(meld => meld.some(c => game.drawnDiscardIds.has(c.id)));
                if (mandatoryMelds.length > 0) return mandatoryMelds;
            }
        }

        return validMelds;
    }

    calcMeldPoints(cards, game) {
        return cards.reduce((sum, c) => sum + (c.isJoker(game) ? 0 : this.getCardValue(c, game)), 0);
    }
}

module.exports = serverBot;
