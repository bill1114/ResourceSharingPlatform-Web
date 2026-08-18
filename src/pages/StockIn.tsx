// 物資入庫 — standalone page wrapper around the shared SupplyItemForm.
// Same behavior as the old 物資管理 "新增物資" modal, promoted to its own
// menu page so stock-in has a dedicated, bookmarkable entry point.
import { Link, useNavigate } from 'react-router-dom'
import { SupplyItemForm } from '../components/SupplyItemForm'

export function StockIn() {
  const navigate = useNavigate()

  return (
    <div className="container mt-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2>
          <i className="bi bi-box-arrow-in-down" /> 物資入庫
        </h2>
        <Link className="btn btn-outline-secondary" to="/supply-items">
          <i className="bi bi-list-ul" /> 物資清單
        </Link>
      </div>

      <div className="card shadow-sm">
        <div className="card-body">
          {/* 入庫成功後回到物資清單，並在那裡顯示成功訊息（避免停在空表單） */}
          <SupplyItemForm onSaved={(m) => navigate('/supply-items', { state: { flash: m } })} submitLabel="確認入庫" />
        </div>
      </div>
    </div>
  )
}
