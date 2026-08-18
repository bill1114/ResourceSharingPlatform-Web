// 物資入庫 — standalone page wrapper around the shared SupplyItemForm.
// Same behavior as the old 物資管理 "新增物資" modal, promoted to its own
// menu page so stock-in has a dedicated, bookmarkable entry point.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { SupplyItemForm } from '../components/SupplyItemForm'

export function StockIn() {
  const [message, setMessage] = useState<string | null>(null)

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

      {message && <div className="alert alert-success">{message}</div>}

      <div className="card shadow-sm">
        <div className="card-body">
          <SupplyItemForm onSaved={(m) => setMessage(m)} submitLabel="確認入庫" />
        </div>
      </div>
    </div>
  )
}
