// Tipi condivisi tra main, preload e renderer.
// Importi monetari SEMPRE in centesimi (interi) per evitare errori di arrotondamento.

export type Platform = 'android' | 'ios'

/** Stato connessione così come riportato da adb / libimobiledevice */
export type ConnectionState =
  | 'device' // autorizzato, pronto
  | 'unauthorized' // Debug USB attivo ma chiave RSA non accettata / iPhone non "Trust"
  | 'offline'
  | 'recovery'
  | 'sideload'
  | 'bootloader' // fastboot
  | 'unknown'

export interface BatteryInfo {
  level: number | null // 0-100
  health: string | null // Good, Overheat, Dead…
  temperatureC: number | null
  status: string | null // Charging, Discharging, Full…
  cycleCount: number | null // Android 14+ su alcuni modelli
}

export interface StorageInfo {
  totalBytes: number | null
  usedBytes: number | null
  freeBytes: number | null
}

/** Stato software letto via USB (Android: getprop/dumpsys; iOS: ideviceinfo) */
export interface SoftwareInfo {
  buildNumber: string | null
  bootloaderLocked: boolean | null
  verifiedBoot: 'green' | 'yellow' | 'orange' | 'red' | null // orange = bootloader sbloccato
  rooted: boolean | null
  encrypted: boolean | null
  googleAccounts: number | null // solo il numero: >0 => protezione FRP attiva dopo un reset
  thirdPartyApps: number | null
  activationLocked: boolean | null // iOS: Activation Lock / Dov'è
}

export interface LiveDevice {
  serial: string
  platform: Platform
  state: ConnectionState
  transport: 'usb' | 'tcp'
  brand: string | null
  manufacturer: string | null
  model: string | null
  marketName: string | null
  osVersion: string | null
  sdkLevel: number | null
  securityPatch: string | null
  hardwareSerial: string | null
  imei: string | null // spesso non leggibile su Android 10+ senza root
  battery: BatteryInfo | null
  storage: StorageInfo | null
  software: SoftwareInfo | null
  debugEnabled: boolean
  connectedAt: string // ISO
  lastUpdate: string // ISO
}

export interface ToolStatus {
  adb: { available: boolean; path: string | null; version: string | null }
  scrcpy: { available: boolean; path: string | null }
  libimobiledevice: { available: boolean; path: string | null }
}

export type ToolId = 'adb' | 'scrcpy'

/** Avanzamento del download automatico degli strumenti */
export interface ToolInstallProgress {
  phase: 'idle' | 'checking' | 'downloading' | 'extracting' | 'done' | 'error'
  tool: ToolId | null
  percent: number | null // 0-100 se nota la dimensione
  message: string
}

export type RebootMode = 'system' | 'recovery' | 'bootloader'

export interface ActionResult {
  ok: boolean
  message: string
}

// ---------- Dominio ----------

export const REPAIR_STATUSES = ['intake', 'diagnosis', 'in_progress', 'waiting_customer', 'ready', 'delivered'] as const
export type RepairStatus = (typeof REPAIR_STATUSES)[number]

export const REPAIR_STATUS_LABEL: Record<RepairStatus, string> = {
  intake: 'Accettazione',
  diagnosis: 'Diagnostica',
  in_progress: 'In Lavorazione',
  waiting_customer: 'Attesa Cliente',
  ready: 'Pronto al Ritiro',
  delivered: 'Consegnato'
}

export type RepairPriority = 'low' | 'normal' | 'high' | 'urgent'

/** Cosa fare dei dati del cliente: decide se si può flashare o resettare */
export type DataPolicy = 'keep' | 'backup_then_wipe' | 'wipe_ok'
export const DATA_POLICY_LABEL: Record<DataPolicy, string> = {
  keep: 'Conservare i dati',
  backup_then_wipe: 'Backup, poi si può resettare',
  wipe_ok: 'Dati non necessari'
}

export type ServiceCategory = 'firmware' | 'data' | 'unlock' | 'cleanup' | 'generic'
export const SERVICE_CATEGORY_LABEL: Record<ServiceCategory, string> = {
  firmware: 'Firmware / ROM',
  data: 'Backup e recupero dati',
  unlock: 'Sblocchi e account',
  cleanup: 'Pulizia e ottimizzazione',
  generic: 'Generico'
}

export interface ServiceCatalogItem {
  code: string
  label: string
  category: ServiceCategory
  defaultPriceCents: number
  requiresOwnership: boolean
  mayWipeData: boolean
}

export interface RepairService {
  id: number
  serviceCode: string
  label: string
  priceCents: number
  done: boolean
}

export const OWNERSHIP_PROOFS = [
  'Scontrino / fattura d’acquisto',
  'Scatola originale con IMEI/seriale',
  'Contratto operatore intestato',
  'Accesso dimostrato all’account',
  'Altro (vedi note)'
] as const

export interface Customer {
  id: number
  firstName: string
  lastName: string
  phone: string | null
  email: string | null
  notes: string | null
  createdAt: string
}

export interface Device {
  id: number
  customerId: number | null
  platform: Platform
  brand: string | null
  model: string | null
  serial: string | null
  imei: string | null
  color: string | null
  osVersion: string | null
  createdAt: string
}

export interface Repair {
  id: number
  ticketNumber: string
  customerId: number
  deviceId: number
  status: RepairStatus
  priority: RepairPriority
  reportedIssue: string
  intakeNotes: string | null
  devicePasscode: string | null
  dataPolicy: DataPolicy
  ownershipVerified: boolean
  ownershipProof: string | null
  quoteCents: number
  laborCents: number
  externalCostCents: number // crediti server, licenze software
  depositCents: number
  estimatedReadyAt: string | null
  kanbanOrder: number
  createdAt: string
  updatedAt: string
  deliveredAt: string | null
}

/** Riga arricchita per liste/kanban */
export interface RepairListItem extends Repair {
  customerName: string
  customerPhone: string | null
  deviceLabel: string
  deviceSerial: string | null
  deviceImei: string | null
  devicePlatform: Platform
  services: RepairService[]
  marginCents: number
}

export interface CreateRepairInput {
  customer:
    | { mode: 'existing'; id: number }
    | {
        mode: 'new'
        firstName: string
        lastName: string
        phone?: string
        email?: string
      }
  device: {
    platform: Platform
    brand?: string
    model?: string
    serial?: string
    imei?: string
    color?: string
    osVersion?: string
  }
  reportedIssue: string
  /** label: descrizione libera, usata per gli interventi della categoria Generico */
  services: { code: string; priceCents: number; label?: string }[]
  dataPolicy: DataPolicy
  ownershipVerified?: boolean
  ownershipProof?: string
  intakeNotes?: string
  devicePasscode?: string
  priority?: RepairPriority
  quoteCents?: number
  laborCents?: number
  externalCostCents?: number
  depositCents?: number
  estimatedReadyAt?: string
}

export interface DashboardStats {
  openRepairs: number
  byStatus: Record<RepairStatus, number>
  readyForPickup: number
  deliveredThisMonth: number
  revenueThisMonthCents: number
  marginThisMonthCents: number
  waitingCustomer: number
}

export interface BackupResult extends ActionResult {
  path?: string
}

// =====================================================================
// Fase 2 — strumenti dispositivo, job, diagnostica, impostazioni
// =====================================================================

export interface FileEntry {
  name: string
  path: string
  type: 'dir' | 'file' | 'link' | 'other'
  size: number
  modified: string | null // ISO
}

export interface FileListing {
  path: string
  entries: FileEntry[]
  error: string | null
}

export type AppFilter = 'user' | 'system' | 'disabled' | 'removed'

export interface AppEntry {
  packageName: string
  apkPath: string | null
  versionCode: number | null
  installer: string | null // com.android.vending = Play Store
  system: boolean
  disabled: boolean
  removedForUser: boolean
}

export interface AppDetails {
  packageName: string
  versionName: string | null
  firstInstall: string | null
  lastUpdate: string | null
  targetSdk: number | null
  grantedPermissions: string[]
}

export type AppAction = 'uninstall' | 'disable' | 'enable' | 'force_stop' | 'clear_data' | 'restore'

export type BackupCategoryId = 'photos' | 'documents' | 'audio' | 'whatsapp' | 'contacts'

export interface BackupCategoryScan {
  id: BackupCategoryId
  label: string
  paths: string[] // percorsi esistenti sul telefono
  bytes: number | null // null = non calcolabile (es. contatti)
  items: number | null
}

export interface BackupRequest {
  serial: string
  categories: BackupCategoryId[]
  destinationDir: string
  repairId?: number
}

export interface BackupRecord {
  id: number
  repairId: number | null
  ticketNumber: string | null
  deviceLabel: string | null
  destPath: string
  categories: BackupCategoryId[]
  bytes: number
  files: number
  status: 'running' | 'done' | 'cancelled' | 'error'
  message: string | null
  startedAt: string
  finishedAt: string | null
}

export type JobKind = 'backup' | 'pull' | 'push' | 'install' | 'apk_extract'

export interface Job {
  id: string
  kind: JobKind
  serial: string
  label: string
  status: 'running' | 'done' | 'cancelled' | 'error'
  bytesDone: number
  bytesTotal: number | null
  percent: number | null
  message: string
  resultPath: string | null
  startedAt: string
}

// ---------- Diagnostica ----------

export type DiagnosticPhase = 'pre' | 'post'
export type DiagnosticResultValue = 'ok' | 'faulty' | 'not_testable' | 'pending'

export const DIAGNOSTIC_RESULT_LABEL: Record<DiagnosticResultValue, string> = {
  ok: 'Funzionante',
  faulty: 'Difettoso',
  not_testable: 'Non testabile',
  pending: 'Da verificare'
}

export interface DiagnosticTest {
  id: number
  code: string
  label: string
  category: string
  autoSource: string | null
}

export interface DiagnosticEntry {
  testId: number
  result: DiagnosticResultValue
  note: string | null
}

/** Dati del laboratorio nella parte destra dell'intestazione del report */
export interface ReportHeader {
  labName: string
  address: string
  phone: string
  email: string
  vat: string
  technician: string
}

export interface DiagnosticSession {
  repairId: number
  phase: DiagnosticPhase
  tests: DiagnosticTest[]
  results: DiagnosticEntry[]
  notes: string | null
  signaturePng: string | null // data URL
  deviceSnapshot: LiveDevice | null
  pdfPath: string | null
  savedAt: string | null
  reportHeader: ReportHeader | null // null = mai personalizzata, si usano le impostazioni
}

export interface SaveDiagnosticInput {
  repairId: number
  phase: DiagnosticPhase
  results: DiagnosticEntry[]
  notes?: string
  signaturePng?: string | null
  deviceSnapshot?: LiveDevice | null
  reportHeader?: ReportHeader | null
}

// ---------- Impostazioni e anagrafiche ----------

export interface LabSettings {
  name: string
  address: string
  phone: string
  vat: string
  email: string
  technician: string
  logoDataUrl: string | null
  ticketPrefix: string
  reportFooter: string
}

export interface ServiceCatalogEdit {
  code?: string // assente = nuovo
  label: string
  category: ServiceCategory
  defaultPriceCents: number
  requiresOwnership: boolean
  mayWipeData: boolean
  active: boolean
}

export interface ServiceCatalogAdminItem extends ServiceCatalogItem {
  active: boolean
  usedCount: number
}

export interface CustomerWithStats extends Customer {
  repairsCount: number
  openRepairs: number
  lastRepairAt: string | null
  totalSpentCents: number
}

export interface CustomerUpdate {
  id: number
  firstName: string
  lastName: string
  phone: string | null
  email: string | null
  notes: string | null
}
