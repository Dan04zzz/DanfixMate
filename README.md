# DanfixMate

Gestionale desktop per laboratori di riparazione smartphone (Android / iOS).
Electron + React 19 + TypeScript + Tailwind 4 + SQLite locale (better-sqlite3).

## Avvio rapido (Windows)

Requisiti: **Node.js 22 LTS** (o più recente), Git.

```powershell
cd D:\Developer\PROGETTI\DanFix
npm install          # installa e ricompila better-sqlite3 per Electron (postinstall)
npm run dev          # avvia l'app in sviluppo con hot reload
```

Se `npm install` fallisce su better-sqlite3 (raro: di norma scarica un binario precompilato),
installa "Desktop development with C++" da Visual Studio Build Tools e riesegui `npm run rebuild:native`.

### Binari esterni

Automatici: al primo avvio DanfixMate scarica **adb** (Android platform-tools) e **scrcpy**
in `%APPDATA%\DanfixMate\bin` se non li trova già (in `resources/bin`, nell'Android SDK o nel PATH).
Dettagli in `resources/bin/README.md`.

### Comandi

| Comando | Cosa fa |
|---|---|
| `npm run dev` | Sviluppo con hot reload |
| `npm run typecheck` | Controllo tipi main + renderer |
| `npm run build` | Build di produzione in `out/` |
| `npm run dist:win` | Installer NSIS in `dist/` |

### Dove sono i dati

`%APPDATA%\DanfixMate\data\danfixmate.sqlite` (modalità WAL). Backup a caldo da sidebar o `Ctrl+Shift+B`.

## Scorciatoie da tastiera

| Tasto | Azione |
|---|---|
| `Ctrl+N` | Nuova scheda |
| `Ctrl+1…6` | Dashboard / Dispositivi / Bacheca / Riparazioni / Clienti / Impostazioni |
| `Ctrl+K` | Cerca riparazioni |
| `Ctrl+Enter` | Salva scheda · `Ctrl+S` salva diagnostica |
| `F5` | Rileggi dispositivi o cartella |
| `Backspace` | Cartella superiore (gestione file) |
| `Ctrl+Shift+B` | Backup database |
| `Esc` | Annulla / indietro |

Le azioni distruttive (riavvio, elimina, disinstalla, cancella dati) usano la **doppia conferma**:
il primo click arma il pulsante, il secondo esegue entro 3 secondi.

## Dove finiscono i file

- Database: `%APPDATA%\DanfixMate\data\danfixmate.sqlite` (+ copie `pre-vN` prima di ogni migrazione)
- Backup dei telefoni: `Documenti\DanfixMate\Backup` (modificabile)
- Report PDF: `Documenti\DanfixMate\Report`
- adb e scrcpy scaricati: `%APPDATA%\DanfixMate\bin`

## Documentazione

- `docs/ARCHITECTURE.md` — architettura, flussi, schema DB, roadmap.
