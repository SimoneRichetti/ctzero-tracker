# CTZero Tracker

Tracks the minimum **CardTrader Zero** price of Magic cards and notifies you on Telegram when it drops below your chosen threshold.

## Requirements
- Node.js 24 or later

## Configuration
1. `cp .env.example .env`
2. **CardTrader**: generate an API token at https://www.cardtrader.com/it/full_api_app and put it in `CARDTRADER_TOKEN`.
3. **Telegram**:
   - on Telegram, message `@BotFather` with the `/newbot` command and copy the token into `TELEGRAM_BOT_TOKEN`;
   - send any message to your bot;
   - open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `message.chat.id` into `TELEGRAM_CHAT_ID`.
4. `npm install`

## Usage
- `npm start` → builds the UI and starts everything on http://localhost:3000
- The scheduler only runs while the process is up. On startup, if an update was missed, one starts after about 30 seconds.
- The schedule and the "further drop" percentage can be changed from the **Settings** page.

## Docker
- `docker compose up -d --build` → builds the image and starts the container on http://localhost:3000
- With `restart: unless-stopped` the container restarts automatically whenever Docker (and therefore WSL) starts and after a crash; `docker compose down` stops it.
- After a code change you need to run `docker compose up -d --build` again, otherwise the old version keeps running.
- The `.env` file is read by the container and `data/` is mounted as a volume: the database is the same one used by `npm start` (don't run both at the same time).
- Logs: `docker compose logs -f`.

## Development
- `npm run dev:server` (API on :3000, auto-restart)
- `npm run dev:web` (UI on :5173 with a proxy to the API)
- `npm test`, `npm run typecheck`

## Data
Everything lives in `data/ctzero.db` (SQLite). To start from scratch, just delete the `data/` folder.

## Known limitations
- CardTrader only returns the 25 cheapest listings per printing: if they are all non-Zero or in worse condition than the minimum, the card shows "No offers" even if valid, more expensive offers exist.
- Shipping costs are not taken into account.

## License
MIT — see [LICENSE](LICENSE).
