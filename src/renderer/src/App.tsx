import { useEffect } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Toaster } from './components/Toaster'
import { JobsDock } from './components/JobsDock'
import { Board } from './pages/Board'
import { Customers } from './pages/Customers'
import { Dashboard } from './pages/Dashboard'
import { DeviceWorkspace } from './pages/DeviceWorkspace'
import { Diagnostic } from './pages/Diagnostic'
import { Devices } from './pages/Devices'
import { NewRepair } from './pages/NewRepair'
import { RepairDetail } from './pages/RepairDetail'
import { Repairs } from './pages/Repairs'
import { Settings } from './pages/Settings'
import { useDevices } from './store/devices'
import { useJobs } from './store/jobs'

export default function App() {
  const init = useDevices((s) => s.init)
  const initJobs = useJobs((s) => s.init)
  useEffect(() => init(), [init])
  useEffect(() => initJobs(), [initJobs])

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/devices" element={<Devices />} />
        <Route path="/devices/:serial/:tab?" element={<DeviceWorkspace />} />
        <Route path="/repairs" element={<Repairs />} />
        <Route path="/repairs/new" element={<NewRepair />} />
        <Route path="/repairs/:id" element={<RepairDetail />} />
        <Route path="/repairs/:id/diagnostic/:phase" element={<Diagnostic />} />
        <Route path="/board" element={<Board />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/settings/:tab?" element={<Settings />} />
      </Routes>
      <JobsDock />
      <Toaster />
    </Layout>
  )
}
