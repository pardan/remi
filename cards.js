// ============================================================
// REMI INDONESIA - Card Renderer
// Uses PNG card images from public domain assets
// ============================================================

class CardRenderer {
    static BACK_IMAGE_URL = CARD_IMAGE_BASE + 'back.png';

    static createCardElement(card, faceUp = true, selectable = false, game = null) {
        const el = document.createElement('div');
        const isJoker = game && game.jokerRevealed && card.isJoker(game);
        el.className = `card ${faceUp ? 'face-up' : 'face-down'} ${selectable ? 'selectable' : ''} ${isJoker ? 'is-joker' : ''}`;
        el.dataset.cardId = card.id;
        el.dataset.suit = card.suitName;
        el.dataset.rank = card.rank;

        if (faceUp) {
            el.innerHTML = CardRenderer.createCardFace(card, isJoker);
        } else {
            el.innerHTML = CardRenderer.createCardBack();
        }

        return el;
    }

    static createCardFace(card, isJoker = false) {
        return `
            <div class="card-face">
                <img src="${card.imageUrl}" alt="${card.displayName}" class="card-image" draggable="false" loading="lazy">
                ${isJoker ? '<div class="joker-badge">★</div>' : ''}
            </div>
        `;
    }

    static createCardBack() {
        return `
            <div class="card-back">
                <img src="${CardRenderer.BACK_IMAGE_URL}" alt="Card Back" class="card-image" draggable="false" loading="lazy">
            </div>
        `;
    }

    static highlightCard(element, highlight = true) {
        if (highlight) {
            element.classList.add('highlighted');
        } else {
            element.classList.remove('highlighted');
        }
    }

    static selectCard(element, selected = true) {
        if (selected) {
            element.classList.add('selected');
        } else {
            element.classList.remove('selected');
        }
    }
}
