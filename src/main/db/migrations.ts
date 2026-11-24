// Migrazioni versionate. Ogni voce viene eseguita una sola volta (PRAGMA user_version).
// Regola: non modificare mai una migrazione già rilasciata, aggiungine una nuova.

export const migrations: string[] = [
  /* v1 — schema iniziale completo */ `
  -- ===== Anagrafica =====
  CREATE TABLE customers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name    TEXT NOT NULL,
    last_name     TEXT NOT NULL DEFAULT '',
    phone         TEXT,                    -- formato E.164 consigliato (+39…), usato per WhatsApp
    email         TEXT,
    tax_code      TEXT,                    -- CF / P.IVA per eventuale fattura
    address       TEXT,
    notes         TEXT,
    marketing_ok  INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_customers_name  ON customers(last_name, first_name);
  CREATE INDEX idx_customers_phone ON customers(phone);

  CREATE TABLE devices (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id   INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    platform      TEXT NOT NULL CHECK (platform IN ('android','ios')),
    brand         TEXT,
    model         TEXT,
    serial        TEXT,                    -- seriale adb / UDID iOS
    imei          TEXT,
    imei2         TEXT,
    color         TEXT,
    os_version    TEXT,
    storage_gb    INTEGER,
    last_snapshot TEXT,                    -- JSON dell'ultima lettura USB (batteria, storage…)
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_devices_customer ON devices(customer_id);
  CREATE INDEX idx_devices_serial   ON devices(serial);
  CREATE INDEX idx_devices_imei     ON devices(imei);

  -- ===== Riparazioni =====
  CREATE TABLE repairs (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_number      TEXT NOT NULL UNIQUE,  -- BM-2026-0001
    customer_id        INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    device_id          INTEGER NOT NULL REFERENCES devices(id)   ON DELETE RESTRICT,
    status             TEXT NOT NULL DEFAULT 'intake'
                       CHECK (status IN ('intake','diagnosis','in_progress','waiting_parts','ready','delivered')),
    priority           TEXT NOT NULL DEFAULT 'normal'
                       CHECK (priority IN ('low','normal','high','urgent')),
    reported_issue     TEXT NOT NULL,
    intake_notes       TEXT,                  -- graffi, ammaccature, accessori consegnati…
    device_passcode    TEXT,                  -- PIN/sequenza fornito dal cliente (opzionale)
    technician_notes   TEXT,
    quote_cents        INTEGER NOT NULL DEFAULT 0,  -- prezzo al cliente
    labor_cents        INTEGER NOT NULL DEFAULT 0,  -- costo manodopera interna
    parts_cost_cents   INTEGER NOT NULL DEFAULT 0,  -- costo ricambi (ricalcolato da repair_parts)
    deposit_cents      INTEGER NOT NULL DEFAULT 0,  -- acconto
    estimated_ready_at TEXT,
    kanban_order       REAL NOT NULL DEFAULT 0,     -- ordinamento dentro la colonna (drag&drop)
    created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    delivered_at       TEXT
  );
  CREATE INDEX idx_repairs_status   ON repairs(status, kanban_order);
  CREATE INDEX idx_repairs_customer ON repairs(customer_id);
  CREATE INDEX idx_repairs_device   ON repairs(device_id);

  -- Storico cambi di stato (timeline + statistiche tempi medi)
  CREATE TABLE repair_status_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    repair_id   INTEGER NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
    from_status TEXT,
    to_status   TEXT NOT NULL,
    note        TEXT,
    changed_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_rsh_repair ON repair_status_history(repair_id, changed_at);

  -- Log notifiche inviate (WhatsApp, ecc.)
  CREATE TABLE notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    repair_id  INTEGER NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
    channel    TEXT NOT NULL DEFAULT 'whatsapp',
    message    TEXT NOT NULL,
    sent_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  -- ===== Diagnostica =====
  CREATE TABLE diagnostic_tests (           -- catalogo test configurabile
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    code       TEXT NOT NULL UNIQUE,
    label      TEXT NOT NULL,
    category   TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active     INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE diagnostic_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    repair_id   INTEGER NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
    phase       TEXT NOT NULL CHECK (phase IN ('pre','post')),
    device_snapshot TEXT,                   -- JSON letto via USB al momento del test
    notes       TEXT,
    signature_png BLOB,                     -- firma cliente (fase 2)
    pdf_path    TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (repair_id, phase)
  );

  CREATE TABLE diagnostic_results (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  INTEGER NOT NULL REFERENCES diagnostic_sessions(id) ON DELETE CASCADE,
    test_id     INTEGER NOT NULL REFERENCES diagnostic_tests(id),
    result      TEXT NOT NULL CHECK (result IN ('ok','faulty','not_testable','pending')),
    note        TEXT,
    UNIQUE (session_id, test_id)
  );

  -- ===== Magazzino =====
  CREATE TABLE part_categories (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL UNIQUE
  );

  CREATE TABLE parts (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    sku              TEXT UNIQUE,
    name             TEXT NOT NULL,
    category_id      INTEGER REFERENCES part_categories(id) ON DELETE SET NULL,
    compatible_with  TEXT,                  -- es. "iPhone 13, iPhone 13 Pro"
    quality          TEXT,                  -- Originale, OEM, Incell, OLED…
    supplier         TEXT,
    cost_cents       INTEGER NOT NULL DEFAULT 0,
    price_cents      INTEGER NOT NULL DEFAULT 0,
    stock_qty        INTEGER NOT NULL DEFAULT 0,
    min_stock_qty    INTEGER NOT NULL DEFAULT 1,  -- soglia sottoscorta
    location         TEXT,                  -- cassetto / scaffale
    active           INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_parts_name ON parts(name);

  -- Ricambi associati a una riparazione (lo scarico avviene via stock_movements)
  CREATE TABLE repair_parts (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    repair_id        INTEGER NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
    part_id          INTEGER NOT NULL REFERENCES parts(id)  ON DELETE RESTRICT,
    qty              INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
    unit_cost_cents  INTEGER NOT NULL,      -- congelato al momento dell'uso
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_repair_parts_repair ON repair_parts(repair_id);

  -- Registro movimenti: unica fonte di verità per le giacenze
  CREATE TABLE stock_movements (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    part_id     INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
    delta       INTEGER NOT NULL,           -- +carico / -scarico
    reason      TEXT NOT NULL CHECK (reason IN ('purchase','repair_use','repair_return','adjustment','loss')),
    repair_id   INTEGER REFERENCES repairs(id) ON DELETE SET NULL,
    note        TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_stock_mov_part ON stock_movements(part_id, created_at);

  -- Trigger: ogni movimento aggiorna la giacenza
  CREATE TRIGGER trg_stock_apply AFTER INSERT ON stock_movements
  BEGIN
    UPDATE parts SET stock_qty = stock_qty + NEW.delta WHERE id = NEW.part_id;
  END;

  -- Trigger: aggiunta ricambio a riparazione => scarico automatico + ricalcolo costo
  CREATE TRIGGER trg_repair_part_insert AFTER INSERT ON repair_parts
  BEGIN
    INSERT INTO stock_movements(part_id, delta, reason, repair_id)
    VALUES (NEW.part_id, -NEW.qty, 'repair_use', NEW.repair_id);
    UPDATE repairs SET parts_cost_cents =
      (SELECT COALESCE(SUM(qty * unit_cost_cents),0) FROM repair_parts WHERE repair_id = NEW.repair_id),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = NEW.repair_id;
  END;

  CREATE TRIGGER trg_repair_part_delete AFTER DELETE ON repair_parts
  BEGIN
    INSERT INTO stock_movements(part_id, delta, reason, repair_id)
    VALUES (OLD.part_id, OLD.qty, 'repair_return', OLD.repair_id);
    UPDATE repairs SET parts_cost_cents =
      (SELECT COALESCE(SUM(qty * unit_cost_cents),0) FROM repair_parts WHERE repair_id = OLD.repair_id),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = OLD.repair_id;
  END;

  -- ===== Impostazioni (chiave/valore) =====
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- ===== Seed =====
  INSERT INTO settings(key, value) VALUES
    ('lab.name', 'Il mio laboratorio'),
    ('lab.address', ''),
    ('lab.phone', ''),
    ('lab.vat', ''),
    ('lab.logo_path', ''),
    ('ticket.prefix', 'BM'),
    ('whatsapp.template',
     'Ciao {nome}, il tuo {modello} è ora in stato: *{stato}*. Importo: {importo}. Grazie, {laboratorio}');

  INSERT INTO part_categories(name) VALUES
    ('Schermi'),('Batterie'),('Connettori di ricarica'),('Fotocamere'),
    ('Back cover'),('Altoparlanti/Microfoni'),('Tasti e flex'),('Consumabili');

  INSERT INTO diagnostic_tests(code, label, category, sort_order) VALUES
    ('display',     'Display',                'Schermo',      10),
    ('touch',       'Touch screen',           'Schermo',      20),
    ('earpiece',    'Capsula auricolare',     'Audio',        30),
    ('speaker',     'Altoparlante',           'Audio',        40),
    ('mic',         'Microfono',              'Audio',        50),
    ('cam_rear',    'Fotocamera posteriore',  'Fotocamere',   60),
    ('cam_front',   'Fotocamera frontale',    'Fotocamere',   70),
    ('charging',    'Ricarica cavo',          'Alimentazione',80),
    ('wireless_chg','Ricarica wireless',      'Alimentazione',90),
    ('wifi',        'Wi-Fi',                  'Rete',         100),
    ('cellular',    'Rete cellulare / SIM',   'Rete',         110),
    ('bluetooth',   'Bluetooth',              'Rete',         120),
    ('biometric',   'Biometria (Face ID / impronta)', 'Sicurezza', 130),
    ('buttons',     'Tasti fisici',           'Hardware',     140),
    ('vibration',   'Vibrazione',             'Hardware',     150),
    ('sensors',     'Sensori (prossimità/luce)', 'Hardware',  160);
  `,

  /* v2 — il laboratorio fa SOLO riparazioni software: via ricambi/magazzino, arrivano
     listino interventi, criterio sui dati, verifica proprietà e diagnostica software.
     Le migrazioni girano con foreign_keys = OFF (vedi migrate()), necessario per
     ricostruire la tabella repairs senza far scattare i CASCADE. */ `
  -- ===== Via il magazzino ricambi =====
  DROP TRIGGER IF EXISTS trg_repair_part_insert;
  DROP TRIGGER IF EXISTS trg_repair_part_delete;
  DROP TRIGGER IF EXISTS trg_stock_apply;
  DROP TABLE IF EXISTS repair_parts;
  DROP TABLE IF EXISTS stock_movements;
  DROP TABLE IF EXISTS parts;
  DROP TABLE IF EXISTS part_categories;

  -- ===== Ricostruzione repairs (nuovi stati e campi) =====
  CREATE TABLE repairs_new (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_number       TEXT NOT NULL UNIQUE,
    customer_id         INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    device_id           INTEGER NOT NULL REFERENCES devices(id)   ON DELETE RESTRICT,
    status              TEXT NOT NULL DEFAULT 'intake'
                        CHECK (status IN ('intake','diagnosis','in_progress','waiting_customer','ready','delivered')),
    priority            TEXT NOT NULL DEFAULT 'normal'
                        CHECK (priority IN ('low','normal','high','urgent')),
    reported_issue      TEXT NOT NULL,
    intake_notes        TEXT,
    device_passcode     TEXT,
    technician_notes    TEXT,
    -- cosa fare dei dati del cliente: decide se si può flashare/resettare
    data_policy         TEXT NOT NULL DEFAULT 'keep'
                        CHECK (data_policy IN ('keep','backup_then_wipe','wipe_ok')),
    -- obbligatoria per sblocchi e rimozione account
    ownership_verified  INTEGER NOT NULL DEFAULT 0,
    ownership_proof     TEXT,
    quote_cents         INTEGER NOT NULL DEFAULT 0,  -- prezzo al cliente
    labor_cents         INTEGER NOT NULL DEFAULT 0,  -- costo manodopera interna
    external_cost_cents INTEGER NOT NULL DEFAULT 0,  -- crediti server, licenze software, ecc.
    deposit_cents       INTEGER NOT NULL DEFAULT 0,
    estimated_ready_at  TEXT,
    kanban_order        REAL NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    delivered_at        TEXT
  );
  INSERT INTO repairs_new (id, ticket_number, customer_id, device_id, status, priority, reported_issue,
                           intake_notes, device_passcode, technician_notes, quote_cents, labor_cents,
                           external_cost_cents, deposit_cents, estimated_ready_at, kanban_order,
                           created_at, updated_at, delivered_at)
  SELECT id, ticket_number, customer_id, device_id,
         CASE status WHEN 'waiting_parts' THEN 'waiting_customer' ELSE status END,
         priority, reported_issue, intake_notes, device_passcode, technician_notes, quote_cents, labor_cents,
         parts_cost_cents, deposit_cents, estimated_ready_at, kanban_order, created_at, updated_at, delivered_at
  FROM repairs;
  DROP TABLE repairs;
  ALTER TABLE repairs_new RENAME TO repairs;
  CREATE INDEX idx_repairs_status   ON repairs(status, kanban_order);
  CREATE INDEX idx_repairs_customer ON repairs(customer_id);
  CREATE INDEX idx_repairs_device   ON repairs(device_id);

  UPDATE repair_status_history SET from_status = 'waiting_customer' WHERE from_status = 'waiting_parts';
  UPDATE repair_status_history SET to_status   = 'waiting_customer' WHERE to_status   = 'waiting_parts';

  -- ===== Listino interventi software =====
  CREATE TABLE service_catalog (
    code                TEXT PRIMARY KEY,
    label               TEXT NOT NULL,
    category            TEXT NOT NULL CHECK (category IN ('firmware','data','unlock','cleanup')),
    default_price_cents INTEGER NOT NULL DEFAULT 0,
    requires_ownership  INTEGER NOT NULL DEFAULT 0,  -- richiede prova di proprietà
    may_wipe_data       INTEGER NOT NULL DEFAULT 0,  -- può cancellare i dati utente
    sort_order          INTEGER NOT NULL DEFAULT 0,
    active              INTEGER NOT NULL DEFAULT 1
  );

  -- Interventi di una scheda (etichetta e prezzo "congelati" al momento della scheda)
  CREATE TABLE repair_services (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    repair_id    INTEGER NOT NULL REFERENCES repairs(id) ON DELETE CASCADE,
    service_code TEXT NOT NULL REFERENCES service_catalog(code),
    label        TEXT NOT NULL,
    price_cents  INTEGER NOT NULL DEFAULT 0,
    done         INTEGER NOT NULL DEFAULT 0,
    done_at      TEXT
  );
  CREATE INDEX idx_repair_services_repair ON repair_services(repair_id);

  -- Prezzi di partenza indicativi: si modificano per scheda (listino modificabile in Fase 2)
  INSERT INTO service_catalog(code, label, category, default_price_cents, requires_ownership, may_wipe_data, sort_order) VALUES
    ('fw_reinstall',   'Reinstallazione firmware ufficiale',               'firmware', 4900, 0, 1, 10),
    ('fw_update',      'Aggiornamento sistema operativo',                  'firmware', 2500, 0, 0, 20),
    ('bootloop_fix',   'Risoluzione bootloop / blocco al logo',            'firmware', 4900, 0, 1, 30),
    ('fw_change',      'Downgrade / cambio versione firmware',             'firmware', 5900, 0, 1, 40),
    ('data_backup',    'Backup dati (foto, contatti, documenti)',          'data',     2900, 0, 0, 110),
    ('chat_backup',    'Backup chat WhatsApp',                             'data',     2500, 0, 0, 120),
    ('data_transfer',  'Trasferimento dati su nuovo telefono',             'data',     3500, 0, 0, 130),
    ('data_recovery',  'Recupero dati da telefono non avviabile',          'data',     7900, 0, 0, 140),
    ('screen_unlock',  'Rimozione blocco schermo dimenticato',             'unlock',   3900, 1, 1, 210),
    ('google_account', 'Rimozione account Google del proprietario (FRP)',  'unlock',   4900, 1, 1, 220),
    ('icloud_assist',  'Assistenza sblocco iCloud tramite Apple',          'unlock',   2900, 1, 0, 230),
    ('carrier_unlock', 'Sblocco operatore (codice ufficiale)',             'unlock',   2500, 1, 0, 240),
    ('malware',        'Rimozione malware / adware',                       'cleanup',  3900, 0, 0, 310),
    ('debloat',        'Rimozione app indesiderate e ottimizzazione',      'cleanup',  2900, 0, 0, 320),
    ('storage',        'Liberare spazio di archiviazione',                 'cleanup',  1900, 0, 0, 330),
    ('factory_reset',  'Reset di fabbrica e configurazione iniziale',      'cleanup',  2500, 0, 1, 340);

  -- ===== Diagnostica software =====
  DELETE FROM diagnostic_results;
  DELETE FROM diagnostic_sessions;
  DELETE FROM diagnostic_tests;
  ALTER TABLE diagnostic_tests ADD COLUMN auto_source TEXT; -- campo letto via USB che precompila l'esito
  INSERT INTO diagnostic_tests(code, label, category, sort_order, auto_source) VALUES
    ('boot',          'Avvio completo del sistema',             'Sistema',   10, 'state'),
    ('os_integrity',  'Integrità OS (verified boot)',           'Sistema',   20, 'software.verifiedBoot'),
    ('bootloader',    'Bootloader bloccato',                    'Sistema',   30, 'software.bootloaderLocked'),
    ('root',          'Assenza root / jailbreak',               'Sistema',   40, 'software.rooted'),
    ('os_updates',    'Sistema aggiornato',                     'Sistema',   50, 'securityPatch'),
    ('screen_lock',   'Blocco schermo noto o rimovibile',       'Accesso',   60, NULL),
    ('accounts',      'Account Google/iCloud del proprietario', 'Accesso',   70, 'software.googleAccounts'),
    ('encryption',    'Crittografia dati attiva',               'Accesso',   80, 'software.encrypted'),
    ('storage',       'Spazio di archiviazione sufficiente',    'Prestazioni', 90, 'storage'),
    ('performance',   'Fluidità e avvio app',                   'Prestazioni', 100, NULL),
    ('battery_drain', 'Consumo batteria normale',               'Prestazioni', 110, 'battery'),
    ('malware',       'Assenza malware / adware',               'Sicurezza', 120, NULL),
    ('apps',          'App indesiderate',                       'Sicurezza', 130, 'software.thirdPartyApps'),
    ('wifi',          'Connessione Wi-Fi',                      'Rete',      140, NULL),
    ('cellular',      'Rete cellulare / SIM',                   'Rete',      150, NULL),
    ('backup',        'Backup dati presente',                   'Dati',      160, NULL);
  `,

  /* v3 — Fase 2: storico backup dati e impostazioni del report */ `
  CREATE TABLE backups (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    repair_id     INTEGER REFERENCES repairs(id) ON DELETE SET NULL,
    device_serial TEXT,
    device_label  TEXT,
    dest_path     TEXT NOT NULL,
    categories    TEXT NOT NULL,              -- JSON array di BackupCategoryId
    bytes         INTEGER NOT NULL DEFAULT 0,
    files         INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','cancelled','error')),
    message       TEXT,
    started_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    finished_at   TEXT
  );
  CREATE INDEX idx_backups_repair ON backups(repair_id);

  INSERT OR IGNORE INTO settings(key, value) VALUES
    ('lab.email', ''),
    ('report.footer',
     'Il cliente dichiara di aver ricevuto il dispositivo nelle condizioni descritte. Il laboratorio non risponde dei dati non inclusi nel backup concordato.');
  `,

  /* v4 — intestazione del report modificabile per singola diagnostica + tecnico predefinito */ `
  ALTER TABLE diagnostic_sessions ADD COLUMN report_header TEXT; -- JSON ReportHeader, NULL = usa le impostazioni
  INSERT OR IGNORE INTO settings(key, value) VALUES ('lab.technician', '');
  `,

  /* v5 — categoria "Generico" per interventi fuori listino (descrizione libera nella scheda).
     SQLite non permette di cambiare un CHECK: si ricostruisce la tabella (FK spente in migrate()). */ `
  CREATE TABLE service_catalog_new (
    code                TEXT PRIMARY KEY,
    label               TEXT NOT NULL,
    category            TEXT NOT NULL CHECK (category IN ('firmware','data','unlock','cleanup','generic')),
    default_price_cents INTEGER NOT NULL DEFAULT 0,
    requires_ownership  INTEGER NOT NULL DEFAULT 0,
    may_wipe_data       INTEGER NOT NULL DEFAULT 0,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    active              INTEGER NOT NULL DEFAULT 1
  );
  INSERT INTO service_catalog_new SELECT code, label, category, default_price_cents, requires_ownership,
                                         may_wipe_data, sort_order, active FROM service_catalog;
  DROP TABLE service_catalog;
  ALTER TABLE service_catalog_new RENAME TO service_catalog;

  INSERT OR IGNORE INTO service_catalog(code, label, category, default_price_cents, requires_ownership, may_wipe_data, sort_order)
  VALUES ('generic', 'Intervento generico', 'generic', 0, 0, 0, 410);
  `
]
