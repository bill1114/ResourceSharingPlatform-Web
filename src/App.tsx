import { Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { Placeholder } from './components/Placeholder'
import { ProtectedRoute } from './components/ProtectedRoute'
import { RoleGate } from './components/RoleGate'
import { Login } from './pages/Login'
import { SupplyLocations } from './pages/SupplyLocations'
import { SupplyItems } from './pages/SupplyItems'
import { InventoryTypes } from './pages/InventoryTypes'
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
        <Route path="/" element={<Placeholder title="戰情總覽" />} />
        <Route path="/map" element={<Placeholder title="據點地圖" />} />
        <Route path="/supply-items" element={<SupplyItems />} />
        <Route path="/supply-locations" element={<SupplyLocations />} />
        <Route path="/transfers/create" element={<Placeholder title="物資轉移" />} />
        <Route path="/transfers" element={<Placeholder title="轉移紀錄" />} />
        <Route path="/outbound/create" element={<Placeholder title="物資出庫" />} />
        <Route path="/outbound" element={<Placeholder title="出庫紀錄" />} />
        <Route path="/outbound/recipient-analysis" element={<Placeholder title="領取分析" />} />
        <Route path="/donations/create" element={<Placeholder title="物資捐贈" />} />
        <Route path="/donations" element={<Placeholder title="捐贈紀錄" />} />
        <Route path="/disposals/create" element={<Placeholder title="物資報廢" />} />
        <Route path="/disposals" element={<Placeholder title="報廢紀錄" />} />
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
