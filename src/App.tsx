import { Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { Placeholder } from './components/Placeholder'
import { ProtectedRoute } from './components/ProtectedRoute'
import { RoleGate } from './components/RoleGate'
import { Login } from './pages/Login'
import { SupplyLocations } from './pages/SupplyLocations'
import { SupplyItems } from './pages/SupplyItems'
import { InventoryTypes } from './pages/InventoryTypes'
import { Dashboard } from './pages/Dashboard'
import { SupplyMap } from './pages/SupplyMap'
import { SupplyOutboundCreate, SupplyOutboundIndex } from './pages/SupplyOutbound'
import { SupplyDonationCreate, SupplyDonationIndex } from './pages/SupplyDonation'
import { SupplyDisposalCreate, SupplyDisposalIndex } from './pages/SupplyDisposal'
import { SupplyTransferCreate, SupplyTransferIndex } from './pages/SupplyTransfer'
import { Roles } from './lib/enums'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/map" element={<SupplyMap />} />
        <Route path="/supply-items" element={<SupplyItems />} />
        <Route path="/supply-locations" element={<SupplyLocations />} />
        <Route
          path="/transfers/create"
          element={
            <RoleGate roles={[Roles.Admin, Roles.Cadre]}>
              <SupplyTransferCreate />
            </RoleGate>
          }
        />
        <Route path="/transfers" element={<SupplyTransferIndex />} />
        <Route path="/outbound/create" element={<SupplyOutboundCreate />} />
        <Route path="/outbound" element={<SupplyOutboundIndex />} />
        <Route path="/outbound/recipient-analysis" element={<Placeholder title="領取分析" />} />
        <Route path="/donations/create" element={<SupplyDonationCreate />} />
        <Route path="/donations" element={<SupplyDonationIndex />} />
        <Route path="/disposals/create" element={<SupplyDisposalCreate />} />
        <Route path="/disposals" element={<SupplyDisposalIndex />} />
        <Route path="/ai-stockin/create" element={<Placeholder title="AI 智慧入庫" />} />
        <Route path="/ai-stockin" element={<Placeholder title="AI 辨識紀錄" />} />
        <Route
          path="/admin/accounts"
          element={
            <RoleGate roles={[Roles.Admin]}>
              <Placeholder title="帳號管理" />
            </RoleGate>
          }
        />
        <Route
          path="/admin/inventory-types"
          element={
            <RoleGate roles={[Roles.Admin]}>
              <InventoryTypes />
            </RoleGate>
          }
        />
        <Route
          path="/admin/line-settings"
          element={
            <RoleGate roles={[Roles.Admin]}>
              <Placeholder title="LINE 通知設定" />
            </RoleGate>
          }
        />
        <Route
          path="/admin/ai-settings"
          element={
            <RoleGate roles={[Roles.Admin]}>
              <Placeholder title="AI 智慧入庫設定" />
            </RoleGate>
          }
        />
      </Route>
    </Routes>
  )
}

export default App
