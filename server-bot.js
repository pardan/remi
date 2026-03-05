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
            // Auto-declare cekih if bot has potential and hasn't declared yet
            this.tryDeclareCekih();

            if (data.isMyTurn) {
                // Add a small delay for "thinking"
                setTimeout(() => this.playTurn(data), 1000 + Math.random() * 1500);
            }
        } else if (event === 'gameOver') {
            // Auto-vote for next round
            setTimeout(() => {
                this.actionCallback(this.playerIndex, 'requestNextRound');
            }, 4000 + Math.random() * 2000);
        } else if (event === 'actionResult') {
            // Ignore action results for bot
        }
    }

    tryDeclareCekih() {
        if (!this.connected || !this.room.game) return;
        const game = this.room.game;
        const me = game.players[this.playerIndex];
        if (!me || me.cekihDeclared) return;
        if (game.phase === 'gameover') return;

        const potential = game.checkCekihPotential(me);
        if (potential) {
            // Small delay to simulate "noticing" cekih
            setTimeout(() => {
                if (!this.connected || !this.room.game) return;
                const result = this.room.game.declareCekih(this.playerIndex);
                if (result.success) {
                    console.log(`[Bot ${this.name}] Declared CEKIH! Targets: ${result.targets}`);
                    // Broadcast state to human players and other bots (skip self to avoid re-triggers)
                    this.room.playerSockets.forEach((s, i) => {
                        if (s && s.connected && i !== this.playerIndex) {
                            const state = this.room.game.getStateForPlayer(i);
                            state.isHost = (i === this.room.hostIndex);
                            s.emit('gameState', state);
                        }
                    });
                }
            }, 500 + Math.random() * 1000);
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

        // Use live game phase to avoid stale state from delayed setTimeout
        const phase = game.phase;
        if (phase === 'gameover') return;

        const me = game.players[this.playerIndex];
        if (!me || me.hand.length === 0) return; // Guard against empty hand

        console.log(`[Bot ${this.name}] playing turn in phase: ${phase}`);

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

        // Safety valve: if drew from discard but can't use it in a meld, force unblock
        if (game.drawnFromDiscard && !game.usedDrawnDiscardThisTurn) {
            console.log(`[Bot ${this.name}] SAFETY: stuck with drawn discard card, force unblocking`);
            game.usedDrawnDiscardThisTurn = true;
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
        if (!me.hand || me.hand.length === 0) return; // Guard against empty hand

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
        if (game.drawnFromDiscard && !game.usedDrawnDiscardThisTurn) {
            const mandatoryMelds = validMelds.filter(meld => meld.some(c => game.drawnDiscardIds.has(c.id)));
            if (mandatoryMelds.length > 0) return mandatoryMelds;
            // No mandatory meld found yet — but there might be prerequisite melds needed first (e.g., a RUN before a SET)
            // If the player hasn't run yet, try playing any available RUN first to unlock SET melds with drawn cards
            if (!player.hasRun && validMelds.length > 0) {
                const runMelds = validMelds.filter(m => game.validateMeld(m).type === 'run');
                if (runMelds.length > 0) return runMelds;
            }
            // No valid meld with drawn card — return empty so bot doesn't try non-mandatory melds first
            return [];
        }

        return validMelds;
    }

    calcMeldPoints(cards, game) {
        return cards.reduce((sum, c) => sum + (c.isJoker(game) ? 0 : this.getCardValue(c, game)), 0);
    }
}

module.exports = serverBot;
