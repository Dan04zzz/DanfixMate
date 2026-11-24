import type {
  BackupRecord,
  CreateRepairInput,
  Customer,
  CustomerUpdate,
  CustomerWithStats,
  DashboardStats,
  DataPolicy,
  DiagnosticPhase,
  DiagnosticResultValue,
  DiagnosticSession,
  Platform,
  SaveDiagnosticInput,
  ServiceCatalogAdminItem,
  ServiceCatalogEdit,
  Repair,
  RepairListItem,
  RepairService,
  RepairStatus,
  ServiceCatalogItem,
  ServiceCategory
} from '@shared/types'
import { REPAIR_STATUSES } from '@shared/types'
import type { DB } from './connection'

// ---------- mapping snake_case -> camelCase ----------

type Row = Record<string, unknown>

const toCustomer = (r: Row): Customer => ({
  id: r.id as number,
  firstName: r.first_name as string,
  lastName: r.last_name as string,
  phone: (r.phone as string) ?? null,
  email: (r.email as string) ?? null,
  notes: (r.notes as string) ?? null,
  createdAt: r.created_at as string
})

const toRepair = (r: Row): Repair => ({
  id: r.id as number,
  ticketNumber: r.ticket_number as string,
  customerId: r.customer_id as number,
  deviceId: r.device_id as number,
  status: r.status as RepairStatus,
  priority: r.priority as Repair['priority'],
  reportedIssue: r.reported_issue as string,
  intakeNotes: (r.intake_notes as string) ?? null,
  devicePasscode: (r.device_passcode as string) ?? null,
  dataPolicy: r.data_policy as DataPolicy,
  ownershipVerified: !!r.ownership_verified,
  ownershipProof: (r.ownership_proof as string) ?? null,
  quoteCents: r.quote_cents as number,
  laborCents: r.labor_cents as number,
  externalCostCents: r.external_cost_cents as number,
  depositCents: r.deposit_cents as number,
  estimatedReadyAt: (r.estimated_ready_at as string) ?? null,
  kanbanOrder: r.kanban_order as number,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
  deliveredAt: (r.delivered_at as string) ?? null
})

const toService = (r: Row): RepairService => ({
  id: r.id as number,
  serviceCode: r.service_code as string,
  label: r.label as string,
  priceCents: r.price_cents as number,
  done: !!r.done
})

const toCatalog = (r: Row): ServiceCatalogItem => ({
  code: r.code as string,
  label: r.label as string,
  category: r.category as ServiceCategory,
  defaultPriceCents: r.default_price_cents as number,
  requiresOwnership: !!r.requires_ownership,
  mayWipeData: !!r.may_wipe_data
})

const LIST_SQL = `
  SELECT r.*,
         c.first_name AS c_first_name, c.last_name AS c_last_name, c.phone AS c_phone,
         d.brand AS d_brand, d.model AS d_model, d.serial AS d_serial, d.imei AS d_imei, d.platform AS d_platform
  FROM repairs r
  JOIN customers c ON c.id = r.customer_id
  JOIN devices   d ON d.id = r.device_id
`

const clean = (v: string | undefined | null): string | null => {
  const t = v?.trim()
  return t ? t : null
}

// ---------- Repository ----------

export function createRepositories(db: DB) {
  const settingGet = db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?')
  const selectRepair = db.prepare('SELECT * FROM repairs WHERE id = ?')

  function servicesFor(ids: number[]): Map<number, RepairService[]> {
    const map = new Map<number, RepairService[]>()
    if (!ids.length) return map
    const rows = db
      .prepare(`SELECT * FROM repair_services WHERE repair_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`)
      .all(...ids) as Row[]
    for (const r of rows) {
      const k = r.repair_id as number
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(toService(r))
    }
    return map
  }

  function toListItems(rows: Row[]): RepairListItem[] {
    const services = servicesFor(rows.map((r) => r.id as number))
    return rows.map((r) => {
      const base = toRepair(r)
      return {
        ...base,
        customerName: `${r.c_first_name ?? ''} ${r.c_last_name ?? ''}`.trim(),
        customerPhone: (r.c_phone as string) ?? null,
        deviceLabel: [r.d_brand, r.d_model].filter(Boolean).join(' ') || 'Dispositivo',
        deviceSerial: (r.d_serial as string) ?? null,
        deviceImei: (r.d_imei as string) ?? null,
        devicePlatform: r.d_platform as Platform,
        services: services.get(base.id) ?? [],
        marginCents: base.quoteCents - base.externalCostCents - base.laborCents
      }
    })
  }

  function nextTicketNumber(): string {
    const prefix = settingGet.get('ticket.prefix')?.value ?? 'BM'
    const year = new Date().getFullYear()
    const last = db
      .prepare<[string], { ticket_number: string }>(
        'SELECT ticket_number FROM repairs WHERE ticket_number LIKE ? ORDER BY id DESC LIMIT 1'
      )
      .get(`${prefix}-${year}-%`)
    const seq = last ? Number.parseInt(last.ticket_number.split('-').pop() ?? '0', 10) + 1 : 1
    return `${prefix}-${year}-${String(seq).padStart(4, '0')}`
  }

  const customers = {
    search(query: string): Customer[] {
      const q = `%${query.trim()}%`
      return db
        .prepare(
          `SELECT * FROM customers
           WHERE first_name LIKE @q OR last_name LIKE @q OR phone LIKE @q OR email LIKE @q
              OR (first_name || ' ' || last_name) LIKE @q
           ORDER BY last_name, first_name LIMIT 20`
        )
        .all({ q })
        .map((r) => toCustomer(r as Row))
    }
  }

  const services = {
    catalog(): ServiceCatalogItem[] {
      return db
        .prepare('SELECT * FROM service_catalog WHERE active = 1 ORDER BY sort_order')
        .all()
        .map((r) => toCatalog(r as Row))
    }
  }

  const createTx = db.transaction((input: CreateRepairInput): Repair => {
    if (!input.reportedIssue?.trim()) throw new Error('Il problema segnalato è obbligatorio')
    if (!input.services?.length) throw new Error('Seleziona almeno un intervento')

    // Interventi: devono esistere a listino
    const catalog = new Map(services.catalog().map((c) => [c.code, c]))
    const chosen = input.services.map((s) => {
      const item = catalog.get(s.code)
      if (!item) throw new Error(`Intervento sconosciuto: ${s.code}`)
      // Generico: il tecnico scrive cosa ha fatto; se lascia vuoto resta il nome del listino
      const custom = item.category === 'generic' ? clean(s.label) : null
      return { item, priceCents: Math.max(0, Math.round(s.priceCents)), label: custom ?? item.label }
    })

    // Sblocchi e rimozione account: solo con proprietà verificata e documentata
    const needsOwnership = chosen.some((c) => c.item.requiresOwnership)
    if (needsOwnership && (!input.ownershipVerified || !clean(input.ownershipProof))) {
      throw new Error('Per sblocchi e rimozione account serve la verifica della proprietà con il documento usato')
    }
    // Interventi che cancellano i dati non sono compatibili con "conservare i dati"
    const wipes = chosen.filter((c) => c.item.mayWipeData)
    if (wipes.length && input.dataPolicy === 'keep') {
      throw new Error(
        `"${wipes[0].item.label}" può cancellare i dati: scegli "Backup, poi si può resettare" o "Dati non necessari"`
      )
    }

    // 1) Cliente
    let customerId: number
    if (input.customer.mode === 'existing') {
      customerId = input.customer.id
    } else {
      if (!input.customer.firstName.trim()) throw new Error('Nome cliente obbligatorio')
      customerId = Number(
        db
          .prepare(
            `INSERT INTO customers(first_name, last_name, phone, email)
             VALUES (@first, @last, @phone, @email)`
          )
          .run({
            first: input.customer.firstName.trim(),
            last: input.customer.lastName.trim(),
            phone: clean(input.customer.phone),
            email: clean(input.customer.email)
          }).lastInsertRowid
      )
    }

    // 2) Dispositivo: riusa se stesso seriale/IMEI dello stesso cliente
    const d = input.device
    const existing = db
      .prepare<[number, string | null, string | null], { id: number }>(
        `SELECT id FROM devices
         WHERE customer_id = ? AND ((serial IS NOT NULL AND serial = ?) OR (imei IS NOT NULL AND imei = ?))
         LIMIT 1`
      )
      .get(customerId, clean(d.serial), clean(d.imei))

    let deviceId: number
    if (existing) {
      deviceId = existing.id
      db.prepare(
        `UPDATE devices SET os_version = COALESCE(@os, os_version), color = COALESCE(@color, color) WHERE id = @id`
      ).run({ id: deviceId, os: clean(d.osVersion), color: clean(d.color) })
    } else {
      deviceId = Number(
        db
          .prepare(
            `INSERT INTO devices(customer_id, platform, brand, model, serial, imei, color, os_version)
             VALUES (@customerId, @platform, @brand, @model, @serial, @imei, @color, @os)`
          )
          .run({
            customerId,
            platform: d.platform,
            brand: clean(d.brand),
            model: clean(d.model),
            serial: clean(d.serial),
            imei: clean(d.imei),
            color: clean(d.color),
            os: clean(d.osVersion)
          }).lastInsertRowid
      )
    }

    // 3) Scheda (in coda alla colonna "Accettazione")
    const maxOrder =
      db.prepare<[], { m: number | null }>(`SELECT MAX(kanban_order) AS m FROM repairs WHERE status = 'intake'`).get()
        ?.m ?? 0
    const servicesTotal = chosen.reduce((a, c) => a + c.priceCents, 0)

    const repairId = Number(
      db
        .prepare(
          `INSERT INTO repairs(ticket_number, customer_id, device_id, priority, reported_issue, intake_notes,
                               device_passcode, data_policy, ownership_verified, ownership_proof,
                               quote_cents, labor_cents, external_cost_cents, deposit_cents,
                               estimated_ready_at, kanban_order)
           VALUES (@ticket, @customerId, @deviceId, @priority, @issue, @notes, @passcode, @dataPolicy,
                   @ownershipVerified, @ownershipProof, @quote, @labor, @external, @deposit, @eta, @order)`
        )
        .run({
          ticket: nextTicketNumber(),
          customerId,
          deviceId,
          priority: input.priority ?? 'normal',
          issue: input.reportedIssue.trim(),
          notes: clean(input.intakeNotes),
          passcode: clean(input.devicePasscode),
          dataPolicy: input.dataPolicy,
          ownershipVerified: input.ownershipVerified ? 1 : 0,
          ownershipProof: input.ownershipVerified ? clean(input.ownershipProof) : null,
          quote: input.quoteCents ?? servicesTotal,
          labor: input.laborCents ?? 0,
          external: input.externalCostCents ?? 0,
          deposit: input.depositCents ?? 0,
          eta: clean(input.estimatedReadyAt),
          order: maxOrder + 1
        }).lastInsertRowid
    )

    const insertService = db.prepare(
      'INSERT INTO repair_services(repair_id, service_code, label, price_cents) VALUES (?, ?, ?, ?)'
    )
    for (const c of chosen) insertService.run(repairId, c.item.code, c.label, c.priceCents)

    db.prepare(
      `INSERT INTO repair_status_history(repair_id, from_status, to_status, note) VALUES (?, NULL, 'intake', 'Scheda creata')`
    ).run(repairId)

    return toRepair(selectRepair.get(repairId) as Row)
  })

  const setStatusTx = db.transaction((id: number, status: RepairStatus, note?: string): Repair => {
    if (!REPAIR_STATUSES.includes(status)) throw new Error(`Stato non valido: ${status}`)
    const cur = db.prepare('SELECT status FROM repairs WHERE id = ?').get(id) as { status: RepairStatus } | undefined
    if (!cur) throw new Error('Riparazione non trovata')
    if (cur.status !== status) {
      db.prepare(
        `UPDATE repairs SET status = @status,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
           delivered_at = CASE WHEN @status = 'delivered' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END
         WHERE id = @id`
      ).run({ id, status })
      db.prepare('INSERT INTO repair_status_history(repair_id, from_status, to_status, note) VALUES (?,?,?,?)').run(
        id,
        cur.status,
        status,
        note ?? null
      )
    }
    return toRepair(selectRepair.get(id) as Row)
  })

  const moveTx = db.transaction((id: number, status: RepairStatus, index: number): Repair => {
    const siblings = db
      .prepare<[string, number], { id: number; kanban_order: number }>(
        'SELECT id, kanban_order FROM repairs WHERE status = ? AND id != ? ORDER BY kanban_order, id'
      )
      .all(status, id)
    const i = Math.max(0, Math.min(index, siblings.length))
    const before = siblings[i - 1]?.kanban_order
    const after = siblings[i]?.kanban_order
    let order: number
    if (before === undefined && after === undefined) order = 1
    else if (before === undefined) order = after! - 1
    else if (after === undefined) order = before + 1
    else order = (before + after) / 2

    // Precisione esaurita (molti spostamenti tra le stesse due schede): rinumera la colonna
    if (before !== undefined && after !== undefined && !(order > before && order < after)) {
      const renum = db.prepare('UPDATE repairs SET kanban_order = ? WHERE id = ?')
      siblings.forEach((s, k) => renum.run(k + 1 + (k >= i ? 1 : 0), s.id))
      order = i + 1
    }
    setStatusTx(id, status)
    db.prepare('UPDATE repairs SET kanban_order = ? WHERE id = ?').run(order, id)
    return toRepair(selectRepair.get(id) as Row)
  })

  const repairs = {
    list(filter?: { status?: RepairStatus; search?: string; customerId?: number }): RepairListItem[] {
      const where: string[] = []
      const params: Record<string, unknown> = {}
      if (filter?.customerId) {
        where.push('r.customer_id = @customerId')
        params.customerId = filter.customerId
      }
      if (filter?.status) {
        where.push('r.status = @status')
        params.status = filter.status
      }
      if (filter?.search?.trim()) {
        where.push(`(r.ticket_number LIKE @s OR c.first_name LIKE @s OR c.last_name LIKE @s
                     OR c.phone LIKE @s OR d.model LIKE @s OR d.brand LIKE @s OR d.imei LIKE @s
                     OR d.serial LIKE @s OR r.reported_issue LIKE @s
                     OR EXISTS (SELECT 1 FROM repair_services s WHERE s.repair_id = r.id AND s.label LIKE @s))`)
        params.s = `%${filter.search.trim()}%`
      }
      const sql = `${LIST_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                   ORDER BY r.status, r.kanban_order, r.created_at DESC`
      return toListItems(db.prepare(sql).all(params) as Row[])
    },

    get(id: number): RepairListItem | null {
      const r = db.prepare(`${LIST_SQL} WHERE r.id = ?`).get(id) as Row | undefined
      return r ? toListItems([r])[0] : null
    },

    create(input: CreateRepairInput): Repair {
      return createTx(input)
    },

    setStatus(id: number, status: RepairStatus, note?: string): Repair {
      return setStatusTx(id, status, note)
    },

    /** Drag & drop Kanban: sposta in `status` alla posizione `index` (ordine frazionario). */
    move(id: number, status: RepairStatus, index: number): Repair {
      return moveTx(id, status, index)
    },

    toggleService(repairServiceId: number, done: boolean): void {
      db.prepare(
        `UPDATE repair_services SET done = ?, done_at = CASE WHEN ? THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') END WHERE id = ?`
      ).run(done ? 1 : 0, done ? 1 : 0, repairServiceId)
    },

    markServiceDone(repairId: number, serviceCode: string): void {
      db.prepare(
        `UPDATE repair_services SET done = 1, done_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE repair_id = ? AND service_code = ? AND done = 0`
      ).run(repairId, serviceCode)
    }
  }

  const dashboard = {
    stats(): DashboardStats {
      const byStatus = Object.fromEntries(REPAIR_STATUSES.map((s) => [s, 0])) as Record<RepairStatus, number>
      for (const row of db
        .prepare<[], { status: RepairStatus; n: number }>('SELECT status, COUNT(*) AS n FROM repairs GROUP BY status')
        .all()) {
        byStatus[row.status] = row.n
      }
      const month = db
        .prepare<[], { n: number; revenue: number; margin: number }>(
          `SELECT COUNT(*) AS n,
                  COALESCE(SUM(quote_cents),0) AS revenue,
                  COALESCE(SUM(quote_cents - external_cost_cents - labor_cents),0) AS margin
           FROM repairs
           WHERE status = 'delivered' AND delivered_at >= strftime('%Y-%m-01T00:00:00Z','now')`
        )
        .get()!

      return {
        openRepairs: REPAIR_STATUSES.filter((s) => s !== 'delivered').reduce((a, s) => a + byStatus[s], 0),
        byStatus,
        readyForPickup: byStatus.ready,
        deliveredThisMonth: month.n,
        revenueThisMonthCents: month.revenue,
        marginThisMonthCents: month.margin,
        waitingCustomer: byStatus.waiting_customer
      }
    }
  }

  // ---------- Clienti (anagrafica) ----------
  Object.assign(customers, {
    list(query: string): CustomerWithStats[] {
      const q = `%${query.trim()}%`
      return (
        db
          .prepare(
            `SELECT c.*,
                    COUNT(r.id) AS repairs_count,
                    SUM(CASE WHEN r.status != 'delivered' THEN 1 ELSE 0 END) AS open_repairs,
                    MAX(r.created_at) AS last_repair_at,
                    COALESCE(SUM(CASE WHEN r.status = 'delivered' THEN r.quote_cents END), 0) AS total_spent
             FROM customers c LEFT JOIN repairs r ON r.customer_id = c.id
             WHERE @q = '%%' OR c.first_name LIKE @q OR c.last_name LIKE @q OR c.phone LIKE @q OR c.email LIKE @q
                OR (c.first_name || ' ' || c.last_name) LIKE @q
             GROUP BY c.id
             ORDER BY last_repair_at DESC NULLS LAST, c.last_name, c.first_name
             LIMIT 300`
          )
          .all({ q }) as Row[]
      ).map((r) => ({
        ...toCustomer(r),
        repairsCount: (r.repairs_count as number) ?? 0,
        openRepairs: (r.open_repairs as number) ?? 0,
        lastRepairAt: (r.last_repair_at as string) ?? null,
        totalSpentCents: (r.total_spent as number) ?? 0
      }))
    },

    update(input: CustomerUpdate): Customer {
      if (!input.firstName.trim()) throw new Error('Il nome è obbligatorio')
      db.prepare(
        `UPDATE customers SET first_name = @first, last_name = @last, phone = @phone, email = @email, notes = @notes,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = @id`
      ).run({
        id: input.id,
        first: input.firstName.trim(),
        last: input.lastName.trim(),
        phone: clean(input.phone),
        email: clean(input.email),
        notes: clean(input.notes)
      })
      return toCustomer(db.prepare('SELECT * FROM customers WHERE id = ?').get(input.id) as Row)
    }
  })

  // ---------- Listino (amministrazione) ----------
  const adminItem = (r: Row): ServiceCatalogAdminItem => ({
    ...toCatalog(r),
    active: !!r.active,
    usedCount: (r.used_count as number) ?? 0
  })
  const ADMIN_SQL = `SELECT s.*, (SELECT COUNT(*) FROM repair_services rs WHERE rs.service_code = s.code) AS used_count
                     FROM service_catalog s`
  Object.assign(services, {
    admin(): ServiceCatalogAdminItem[] {
      return (db.prepare(`${ADMIN_SQL} ORDER BY s.sort_order, s.label`).all() as Row[]).map(adminItem)
    },
    save(input: ServiceCatalogEdit): ServiceCatalogAdminItem {
      const label = input.label.trim()
      if (!label) throw new Error('Il nome dell’intervento è obbligatorio')
      const params = {
        label,
        category: input.category,
        price: Math.max(0, Math.round(input.defaultPriceCents)),
        own: input.requiresOwnership ? 1 : 0,
        wipe: input.mayWipeData ? 1 : 0,
        active: input.active ? 1 : 0
      }
      let code = input.code
      if (code) {
        const r = db
          .prepare(
            `UPDATE service_catalog SET label=@label, category=@category, default_price_cents=@price,
               requires_ownership=@own, may_wipe_data=@wipe, active=@active WHERE code=@code`
          )
          .run({ ...params, code })
        if (!r.changes) throw new Error('Intervento non trovato')
      } else {
        const base =
          label
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_|_$/g, '')
            .slice(0, 32) || 'servizio'
        code = base
        for (let n = 2; db.prepare('SELECT 1 FROM service_catalog WHERE code = ?').get(code); n++) code = `${base}_${n}`
        const maxOrder =
          (
            db.prepare('SELECT MAX(sort_order) AS m FROM service_catalog WHERE category = ?').get(input.category) as {
              m: number | null
            }
          ).m ?? 0
        db.prepare(
          `INSERT INTO service_catalog(code, label, category, default_price_cents, requires_ownership, may_wipe_data, active, sort_order)
           VALUES (@code, @label, @category, @price, @own, @wipe, @active, @order)`
        ).run({ ...params, code, order: maxOrder + 1 })
      }
      return adminItem(db.prepare(`${ADMIN_SQL} WHERE s.code = ?`).get(code) as Row)
    }
  })

  // ---------- Impostazioni (chiave/valore) ----------
  const settings = {
    get(key: string): string {
      return settingGet.get(key)?.value ?? ''
    },
    all(): Record<string, string> {
      return Object.fromEntries(
        (db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]).map((r) => [
          r.key,
          r.value
        ])
      )
    },
    set(values: Record<string, string>): void {
      const up = db.prepare(
        'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      db.transaction(() => {
        for (const [k, v] of Object.entries(values)) up.run(k, v)
      })()
    }
  }

  // ---------- Backup dati (storico) ----------
  // Un backup rimasto "running" significa che l'app è stata chiusa durante la copia
  db.prepare(
    `UPDATE backups SET status = 'error', message = 'Interrotto: app chiusa durante la copia', finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE status = 'running'`
  ).run()

  const toBackup = (r: Row): BackupRecord => ({
    id: r.id as number,
    repairId: (r.repair_id as number) ?? null,
    ticketNumber: (r.ticket_number as string) ?? null,
    deviceLabel: (r.device_label as string) ?? null,
    destPath: r.dest_path as string,
    categories: JSON.parse((r.categories as string) || '[]'),
    bytes: r.bytes as number,
    files: r.files as number,
    status: r.status as BackupRecord['status'],
    message: (r.message as string) ?? null,
    startedAt: r.started_at as string,
    finishedAt: (r.finished_at as string) ?? null
  })
  const backups = {
    start(b: {
      repairId?: number
      serial: string
      deviceLabel: string
      destPath: string
      categories: string[]
    }): number {
      return Number(
        db
          .prepare(
            `INSERT INTO backups(repair_id, device_serial, device_label, dest_path, categories)
             VALUES (?, ?, ?, ?, ?)`
          )
          .run(b.repairId ?? null, b.serial, b.deviceLabel, b.destPath, JSON.stringify(b.categories)).lastInsertRowid
      )
    },
    finish(id: number, f: { status: BackupRecord['status']; bytes: number; files: number; message?: string }): void {
      db.prepare(
        `UPDATE backups SET status = ?, bytes = ?, files = ?, message = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ?`
      ).run(f.status, f.bytes, f.files, f.message ?? null, id)
    },
    history(repairId?: number): BackupRecord[] {
      const rows = db
        .prepare(
          `SELECT b.*, r.ticket_number FROM backups b LEFT JOIN repairs r ON r.id = b.repair_id
           ${repairId ? 'WHERE b.repair_id = ?' : ''} ORDER BY b.id DESC LIMIT 100`
        )
        .all(...(repairId ? [repairId] : [])) as Row[]
      return rows.map(toBackup)
    }
  }

  // ---------- Diagnostica pre/post ----------
  const diagnostics = {
    get(repairId: number, phase: DiagnosticPhase): DiagnosticSession {
      const tests = (
        db.prepare('SELECT * FROM diagnostic_tests WHERE active = 1 ORDER BY sort_order').all() as Row[]
      ).map((r) => ({
        id: r.id as number,
        code: r.code as string,
        label: r.label as string,
        category: r.category as string,
        autoSource: (r.auto_source as string) ?? null
      }))
      const session = db
        .prepare('SELECT * FROM diagnostic_sessions WHERE repair_id = ? AND phase = ?')
        .get(repairId, phase) as Row | undefined
      const results = session
        ? (
            db
              .prepare('SELECT test_id, result, note FROM diagnostic_results WHERE session_id = ?')
              .all(session.id) as Row[]
          ).map((r) => ({
            testId: r.test_id as number,
            result: r.result as DiagnosticResultValue,
            note: (r.note as string) ?? null
          }))
        : []
      const sig = session?.signature_png as Uint8Array | null | undefined
      return {
        repairId,
        phase,
        tests,
        results,
        notes: (session?.notes as string) ?? null,
        signaturePng: sig && sig.length ? `data:image/png;base64,${Buffer.from(sig).toString('base64')}` : null,
        deviceSnapshot: session?.device_snapshot ? JSON.parse(session.device_snapshot as string) : null,
        pdfPath: (session?.pdf_path as string) ?? null,
        reportHeader: session?.report_header ? JSON.parse(session.report_header as string) : null,
        savedAt: (session?.created_at as string) ?? null
      }
    },

    save(input: SaveDiagnosticInput): void {
      saveDiagnosticTx(input)
    }
  } as {
    get(repairId: number, phase: DiagnosticPhase): DiagnosticSession
    save(input: SaveDiagnosticInput): void
    setPdfPath(repairId: number, phase: DiagnosticPhase, path: string): void
  }
  const saveDiagnosticTx = db.transaction((input: SaveDiagnosticInput): void => {
    if (!db.prepare('SELECT 1 FROM repairs WHERE id = ?').get(input.repairId)) throw new Error('Scheda non trovata')
    const sig =
      input.signaturePng && input.signaturePng.startsWith('data:image/png;base64,')
        ? Buffer.from(input.signaturePng.split(',')[1], 'base64')
        : null
    db.prepare(
      `INSERT INTO diagnostic_sessions(repair_id, phase, device_snapshot, notes, signature_png, report_header)
         VALUES (@repairId, @phase, @snapshot, @notes, @sig, @header)
         ON CONFLICT(repair_id, phase) DO UPDATE SET
           device_snapshot = COALESCE(excluded.device_snapshot, device_snapshot),
           notes = excluded.notes,
           signature_png = excluded.signature_png,
           report_header = COALESCE(excluded.report_header, report_header),
           created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
    ).run({
      repairId: input.repairId,
      phase: input.phase,
      snapshot: input.deviceSnapshot ? JSON.stringify(input.deviceSnapshot) : null,
      notes: clean(input.notes),
      sig,
      header: input.reportHeader ? JSON.stringify(input.reportHeader) : null
    })
    const sessionId = (
      db
        .prepare('SELECT id FROM diagnostic_sessions WHERE repair_id = ? AND phase = ?')
        .get(input.repairId, input.phase) as { id: number }
    ).id
    db.prepare('DELETE FROM diagnostic_results WHERE session_id = ?').run(sessionId)
    const ins = db.prepare('INSERT INTO diagnostic_results(session_id, test_id, result, note) VALUES (?,?,?,?)')
    for (const r of input.results) ins.run(sessionId, r.testId, r.result, clean(r.note))
  })
  Object.assign(diagnostics, {
    setPdfPath(repairId: number, phase: DiagnosticPhase, path: string): void {
      db.prepare('UPDATE diagnostic_sessions SET pdf_path = ? WHERE repair_id = ? AND phase = ?').run(
        path,
        repairId,
        phase
      )
    }
  })

  return {
    customers: customers as typeof customers & {
      list(query: string): CustomerWithStats[]
      update(input: CustomerUpdate): Customer
    },
    services: services as typeof services & {
      admin(): ServiceCatalogAdminItem[]
      save(input: ServiceCatalogEdit): ServiceCatalogAdminItem
    },
    repairs,
    dashboard,
    settings,
    backups,
    diagnostics
  }
}

export type Repositories = ReturnType<typeof createRepositories>
