import { Outlet, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { ProtectedRoute } from './components/ProtectedRoute'
import { RoleGate } from './components/RoleGate'
import { Login } from './pages/Login'
import { SupplyLocations } from './pages/SupplyLocations'
import { SupplyItems } from './pages/SupplyItems'
import { StockIn } from './pages/StockIn'
import { InventoryTypes } from './pages/InventoryTypes'
import { Dashboard } from './pages/Dashboard'
import { StatusList } from './pages/StatusList'
import { SupplyOutboundCreate, SupplyOutboundIndex } from './pages/SupplyOutbound'
import { SupplyDonationIndex } from './pages/SupplyDonation'
import { SupplyDisposalCreate, SupplyDisposalIndex } from './pages/SupplyDisposal'
import { SupplyTransferCreate, SupplyTransferIndex } from './pages/SupplyTransfer'
import { RecipientAnalysis } from './pages/RecipientAnalysis'
import { DonorAnalysis } from './pages/DonorAnalysis'
import { ItemLedger } from './pages/ItemLedger'
import { AccountManagement } from './pages/AccountManagement'
import { LineSettings, AISettings } from './pages/AdminSettings'
import { AIStockInCreate, AIStockInIndex } from './pages/AIStockIn'
import { EngineeringRoute } from './components/EngineeringRoute'
import { MobileFeatures, MobileInventory, MobilePickup, MobileTransfer, MobileVision, MobileNoAccess } from './pages/MobileFeatures'
import { Roles } from './lib/enums'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* LINE 圖文選單導向的手機頁面：全螢幕、不套桌面外殼，只需登入 + 角色權限。
          物資查詢／物資領用 全角色可用；物資轉讓／影像入庫 限管理員與幹部，
          其餘角色會看到 MobileNoAccess 無權限畫面。 */}
      <Route
        element={
          <ProtectedRoute>
            <Outlet />
          </ProtectedRoute>
        }
      >
        <Route path="/mobile/inventory" element={<MobileInventory />} />
        <Route path="/mobile/pickup" element={<MobilePickup />} />
        <Route
          path="/mobile/transfer"
          element={
            <RoleGate roles={[Roles.Admin, Roles.Cadre]} fallback={<MobileNoAccess />}>
              <MobileTransfer />
            </RoleGate>
          }
        />
        <Route
          path="/mobile/vision"
          element={
            <RoleGate roles={[Roles.Admin]} fallback={<MobileNoAccess />}>
              <MobileVision />
            </RoleGate>
          }
        />
      </Route>

      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/status/:status" element={<StatusList />} />
        <Route path="/supply-items" element={<SupplyItems />} />
        <Route path="/stock-in" element={<StockIn />} />
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
        <Route path="/donations/donor-analysis" element={<DonorAnalysis />} />
        <Route path="/donations" element={<SupplyDonationIndex />} />
        <Route
          path="/disposals/create"
          element={
            <RoleGate roles={[Roles.Admin]}>
              <SupplyDisposalCreate />
            </RoleGate>
          }
        />
        <Route path="/disposals" element={<SupplyDisposalIndex />} />
        <Route
          path="/item-ledger"
          element={
            <RoleGate roles={[Roles.Admin]}>
              <ItemLedger />
            </RoleGate>
          }
        />
        <Route
          path="/ai-stockin/create"
          element={
            <RoleGate roles={[Roles.Admin]}>
              <AIStockInCreate />
            </RoleGate>
          }
        />
        <Route
          path="/ai-stockin"
          element={
            <RoleGate roles={[Roles.Admin]}>
              <AIStockInIndex />
            </RoleGate>
          }
        />
        <Route path="/engineering/mobile-features" element={<EngineeringRoute><MobileFeatures /></EngineeringRoute>} />
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
