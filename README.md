# Remi Indonesia
A web-based multiplayer implementation of the classic Indonesian card game Remi. Play against friends or bots in real-time.

## Features
- **Multiplayer Support**: Play with up to 4 players online via Socket.IO.
- **Bot Opponents**: Play against AI bots (Bot 1, Bot 2, Bot 3) with varying strategies.
- **Real-time Gameplay**: Instant updates, synchronized game state, and drag-and-drop card interactions.
- **Auto-Melding**: Automatically melds sequence cards from your hand when validating a discard pickup.
- **Audio Cues**: Sound effects for card dealing, discarding, and UI interactions.

## Prerequisites
Ensure you have the following installed:
- [Node.js](https://nodejs.org/) (v14 or newer)

## Installation & Setup
1. Clone the repository:
   ```bash
   git clone https://github.com/USERNAME/REPO_NAME.git
   cd REPO_NAME
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```
4. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

## Getting Started
- **Host a Room**: Click "Create Room" to start a new game and share the Room Code with friends.
- **Join a Room**: Enter a friend's Room Code to join their game.
- **Play with Bots**: Click "Play vs Bots" to immediately start a game against 3 AI opponents.

## How to Play (Remi Rules)
*(Add brief rules of Remi Indonesia here or link to a rules document)*

1. Draw a card from the deck or the discard pile.
2. Form valid melds (Runs of the same suit, or Sets of the same rank).
3. First melding requires a valid "Run" or four Aces.
4. You must discard a card at the end of your turn.
5. The game ends when a player successfully empties their hand after discarding (Tutup Deck), or when the draw deck runs out.

## Technologies Used
- **Backend:** Node.js, Express, Socket.IO
- **Frontend:** HTML5, CSS3, Vanilla JavaScript, Socket.IO Client

## License
MIT License
