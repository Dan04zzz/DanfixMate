// Contratto IPC tipizzato: un'unica fonte di verità per canali e firme.
import type {
  ActionResult,
  AppAction,
  AppDetails,
  AppEntry,
  AppFilter,
  BackupCategoryScan,
  BackupRecord,
  BackupRequest,
  BackupResult,
  CreateRepairInput,
  Customer,
  CustomerUpdate,
  CustomerWithStats,
  DashboardStats,
  DiagnosticPhase,
  DiagnosticSession,
  FileListing,
  Job,
  LabSettings,
  LiveDevice,
  RebootMode,
  Repair,
  RepairListItem,
  RepairStatus,
  SaveDiagnosticInput,
  ServiceCatalogAdminItem,
  ServiceCatalogEdit,
  ServiceCatalogItem,
  ToolInstallProgress,
  ToolStatus
} from './types'

/** Canali invoke (renderer -> main, con risposta) */
export interface IpcInvokeMap {
  'devices:list': () => LiveDevice[]
  'devices:refresh': () => LiveDevice[]
  'devices:reboot': (serial: string, mode: RebootMode) => ActionResult
  'devices:mirror': (serial: string) => ActionResult
  'tools:status': () => ToolStatus
  'tools:install': () => ToolStatus
  'tools:progress': () => ToolInstallProgress

  // --- file sul telefono ---
  'files:list': (serial: string, path: string) => FileListing
  'files:pull': (serial: string, paths: string[]) => ActionResult // chiede la cartella di destinazione
  'files:push': (serial: string, remoteDir: string) => ActionResult // chiede i file da caricare
  'files:delete': (serial: string, paths: string[]) => ActionResult
  'files:mkdir': (serial: string, path: string) => ActionResult
  'files:rename': (serial: string, from: string, to: string) => ActionResult

  // --- app ---
  'apps:list': (serial: string, filter: AppFilter) => AppEntry[]
  'apps:details': (serial: string, pkg: string) => AppDetails
  'apps:action': (serial: string, pkg: string, action: AppAction) => ActionResult
  'apps:install': (serial: string) => ActionResult // chiede gli APK
  'apps:extract': (serial: string, pkg: string) => ActionResult // chiede la cartella

  // --- backup ---
  'backup:scan': (serial: string) => BackupCategoryScan[]
  'backup:chooseDir': () => string | null
  'backup:start': (req: BackupRequest) => ActionResult
  'backup:history': (repairId?: number) => BackupRecord[]

  // --- job / sistema ---
  'jobs:list': () => Job[]
  'jobs:cancel': (id: string) => ActionResult
  'shell:openPath': (path: string) => ActionResult

  // --- clienti ---
  'customers:search': (query: string) => Customer[]
  'customers:list': (query: string) => CustomerWithStats[]
  'customers:update': (input: CustomerUpdate) => Customer

  // --- listino ---
  'services:catalog': () => ServiceCatalogItem[]
  'services:admin': () => ServiceCatalogAdminItem[]
  'services:save': (input: ServiceCatalogEdit) => ServiceCatalogAdminItem

  // --- riparazioni ---
  'repairs:list': (filter?: { status?: RepairStatus; search?: string; customerId?: number }) => RepairListItem[]
  'repairs:get': (id: number) => RepairListItem | null
  'repairs:create': (input: CreateRepairInput) => Repair
  'repairs:setStatus': (id: number, status: RepairStatus, note?: string) => Repair
  'repairs:move': (id: number, status: RepairStatus, index: number) => Repair
  'repairs:toggleService': (repairServiceId: number, done: boolean) => ActionResult

  // --- diagnostica ---
  'diagnostic:get': (repairId: number, phase: DiagnosticPhase) => DiagnosticSession
  'diagnostic:save': (input: SaveDiagnosticInput) => DiagnosticSession
  'diagnostic:pdf': (repairId: number, phase: DiagnosticPhase) => BackupResult

  // --- impostazioni ---
  'settings:get': () => LabSettings
  'settings:save': (s: Omit<LabSettings, 'logoDataUrl'>) => LabSettings
  'settings:chooseLogo': () => LabSettings
  'settings:clearLogo': () => LabSettings

  'dashboard:stats': () => DashboardStats
  'db:backup': () => BackupResult
}

/** Eventi push (main -> renderer) */
export interface IpcEventMap {
  'devices:changed': LiveDevice[]
  'tools:changed': ToolStatus
  'tools:progress': ToolInstallProgress
  'jobs:changed': Job[]
}

export type InvokeChannel = keyof IpcInvokeMap
export type EventChannel = keyof IpcEventMap

/** Elenco esplicito usato dal preload come allow-list (il compilatore verifica che sia completo). */
export const INVOKE_CHANNELS = [
  'devices:list',
  'devices:refresh',
  'devices:reboot',
  'devices:mirror',
  'tools:status',
  'tools:install',
  'tools:progress',
  'files:list',
  'files:pull',
  'files:push',
  'files:delete',
  'files:mkdir',
  'files:rename',
  'apps:list',
  'apps:details',
  'apps:action',
  'apps:install',
  'apps:extract',
  'backup:scan',
  'backup:chooseDir',
  'backup:start',
  'backup:history',
  'jobs:list',
  'jobs:cancel',
  'shell:openPath',
  'customers:search',
  'customers:list',
  'customers:update',
  'services:catalog',
  'services:admin',
  'services:save',
  'repairs:list',
  'repairs:get',
  'repairs:create',
  'repairs:setStatus',
  'repairs:move',
  'repairs:toggleService',
  'diagnostic:get',
  'diagnostic:save',
  'diagnostic:pdf',
  'settings:get',
  'settings:save',
  'settings:chooseLogo',
  'settings:clearLogo',
  'dashboard:stats',
  'db:backup'
] as const satisfies readonly InvokeChannel[]

// Se manca un canale nell'elenco qui sopra, questa riga non compila.
type _MissingChannels = Exclude<InvokeChannel, (typeof INVOKE_CHANNELS)[number]>
export const _assertAllChannels: _MissingChannels extends never ? true : _MissingChannels = true

export const EVENT_CHANNELS = [
  'devices:changed',
  'tools:changed',
  'tools:progress',
  'jobs:changed'
] as const satisfies readonly EventChannel[]

/** API esposta dal preload su window.danfixmate */
export type DanfixMateApi = {
  invoke<C extends InvokeChannel>(
    channel: C,
    ...args: Parameters<IpcInvokeMap[C]>
  ): Promise<ReturnType<IpcInvokeMap[C]>>
  on<E extends EventChannel>(channel: E, listener: (payload: IpcEventMap[E]) => void): () => void
}
