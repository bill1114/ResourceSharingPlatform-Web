import { Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
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
import { RecipientAnalysis } from './pages/RecipientAnalysis'
import { AccountManagement } from './pages/AccountManagement'
import { LineSettings, AISettings } from './pages/AdminSettings'
import { AIStockInCreate, AIStockInIndex } from './pages/AIStockIn'
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
        <Route path="/outbound/recipient-analysis" element={<RecipientAnalysis />} />
        <Route path="/donations/create" element={<SupplyDonationCreate />} />
        <Route path="/donations" element={<SupplyDonationIndex />} />
        <Route path="/disposals/create" element={<SupplyDisposalCreate />} />
        <Route path="/disposals" element={<SupplyDisposalIndex />} />
        <Route path="/ai-stockin/create" element={<RoleGate roles={[Roles.Admin, Roles.Cadre]}><AIStockInCreate /></RoleGate>} />
        <Route path="/ai-stockin" element={<AIStockInIndex />} />
        <Route
          path="/admin/accounts"
          element={
            <RoleGate roles={[Roles.Admin]}>
              <AccountManagement />
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
              <LineSettings />
            </RoleGate>
          }
        />
        <Route
          path="/admin/ai-settings"
          element={
            <RoleGate roles={[Roles.Admin]}>
              <AISettings />
            </RoleGate>
          }
        />
      </Route>
    </Routes>
  )
}

export default App
