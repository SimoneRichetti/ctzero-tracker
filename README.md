# CTZero Tracker

Traccia il prezzo minimo **CardTrader Zero** di carte Magic e ti avvisa su Telegram quando scende sotto la soglia scelta.

## Requisiti
- Node.js 24 o superiore

## Configurazione
1. `cp .env.example .env`
2. **CardTrader**: genera il token API da https://www.cardtrader.com/it/full_api_app e mettilo in `CARDTRADER_TOKEN`.
3. **Telegram**:
   - su Telegram scrivi a `@BotFather`, comando `/newbot`, e copia il token in `TELEGRAM_BOT_TOKEN`;
   - manda un messaggio qualsiasi al tuo bot;
   - apri `https://api.telegram.org/bot<TOKEN>/getUpdates` e copia `message.chat.id` in `TELEGRAM_CHAT_ID`.
4. `npm install`

## Uso
- `npm start` → compila la UI e avvia tutto su http://localhost:3000
- Lo scheduler gira solo mentre il processo è acceso. All'avvio, se un aggiornamento è stato saltato, ne parte uno dopo circa 30 secondi.
- Pianificazione e percentuale di "ulteriore calo" si cambiano dalla pagina **Impostazioni**.

## Docker
- `docker compose up -d --build` → compila l'immagine e avvia il container su http://localhost:3000
- Con `restart: unless-stopped` il container riparte da solo a ogni avvio di Docker (quindi di WSL) e in caso di crash; `docker compose down` lo ferma.
- Dopo una modifica al codice serve di nuovo `docker compose up -d --build`, altrimenti resta in esecuzione la versione vecchia.
- Il `.env` viene letto dal container e `data/` è montata come volume: il database è lo stesso di `npm start` (non usarli in contemporanea).
- Log: `docker compose logs -f`.

## Sviluppo
- `npm run dev:server` (API su :3000, riavvio automatico)
- `npm run dev:web` (UI su :5173 con proxy verso l'API)
- `npm test`, `npm run typecheck`

## Dati
Tutto è in `data/ctzero.db` (SQLite). Per ripartire da zero basta cancellare la cartella `data/`.

## Limiti noti
- CardTrader restituisce solo le 25 inserzioni più economiche per stampa: se sono tutte non-Zero o in condizioni peggiori del minimo, la carta risulta "Nessuna offerta" anche se esistono offerte valide più care.
- Le spese di spedizione non sono considerate.
