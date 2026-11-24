import { create } from 'zustand'
import type { Job } from '@shared/types'
import { api } from '../lib/api'

interface JobsState {
  jobs: Job[]
  dismissed: Set<string>
  init: () => () => void
  dismiss: (id: string) => void
}

/** Operazioni lunghe (backup, download, installazioni) con avanzamento dal processo principale. */
export const useJobs = create<JobsState>((set, get) => ({
  jobs: [],
  dismissed: new Set(),
  init: () => {
    void api.invoke('jobs:list').then((jobs) => set({ jobs }))
    return api.on('jobs:changed', (jobs) => {
      const prev = new Map(get().jobs.map((j) => [j.id, j.status]))
      set({ jobs })
      // notifica il completamento delle operazioni che erano in corso
      for (const j of jobs) {
        if (prev.get(j.id) === 'running' && j.status !== 'running') {
          window.dispatchEvent(new CustomEvent('danfixmate:job-finished', { detail: j }))
        }
      }
    })
  },
  dismiss: (id) => set({ dismissed: new Set([...get().dismissed, id]) })
}))
