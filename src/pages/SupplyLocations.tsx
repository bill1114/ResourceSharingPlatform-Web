// Port of SupplyLocationController + Views/SupplyLocation/{Index,Create,Edit}.cshtml.
// Direct supabase-js CRUD gated by RLS (Admin write, everyone read) — no Edge Function
// needed, per migration plan §三.
import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { SupplyLocation } from '../types/db'
import { useAuth } from '../hooks/useAuth'
import { Roles } from '../lib/enums'

type FormState = {
  id: number | null
  location_name: string
  address: string
  phone: string
  contact_person: string
  latitude: string
  longitude: string
}

const emptyForm: FormState = {
  id: null,
  location_name: '',
  address: '',
  phone: '',
  contact_person: '',
  latitude: '',
  longitude: '',
}

export function SupplyLocations() {
  const { profile } = useAuth()
  const isAdmin = profile?.role_name === Roles.Admin
  const [locations, setLocations] = useState<SupplyLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('supply_location')
      .select('*')
      .eq('is_active', true)
      .order('id')
    if (error) {
      setError(error.message)
    } else {
      setLocations((data ?? []) as SupplyLocation[])
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  function openCreate() {
    setForm(emptyForm)
    setShowForm(true)
  }

  function openEdit(loc: SupplyLocation) {
    setForm({
      id: loc.id,
      location_name: loc.location_name,
      address: loc.address ?? '',
      phone: loc.phone ?? '',
      contact_person: loc.contact_person ?? '',
      latitude: loc.latitude?.toString() ?? '',
      longitude: loc.longitude?.toString() ?? '',
    })
    setShowForm(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const payload = {
      location_name: form.location_name.trim(),
      address: form.address.trim() || null,
      phone: form.phone.trim() || null,
      contact_person: form.contact_person.trim() || null,
      latitude: form.latitude ? Number(form.latitude) : null,
      longitude: form.longitude ? Number(form.longitude) : null,
      updated_at: form.id ? new Date().toISOString() : undefined,
    }

    const result = form.id
      ? await supabase.from('supply_location').update(payload).eq('id', form.id)
      : await supabase.from('supply_location').insert(payload)

    setSaving(false)
    if (result.error) {
      setError(result.error.message)
      return
    }
    setShowForm(false)
    void load()
  }

  async function handleDeactivate(loc: SupplyLocation) {
    if (!confirm(`確定停用「${loc.location_name}」嗎？`)) return
    const { error } = await supabase
      .from('supply_location')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', loc.id)
    if (error) {
      setError(error.message)
      return
    }
    void load()
  }

  return (
    <div className="container-fluid mt-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2>
          <i className="bi bi-buildings" /> 據點管理
        </h2>
        {isAdmin && (
          <button className="btn btn-primary" onClick={openCreate}>
            <i className="bi bi-plus-circle" /> 新增據點
          </button>
        )}
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="card shadow-sm">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-hover align-middle">
              <thead className="table-light">
                <tr>
                  <th>據點名稱</th>
                  <th>地址</th>
                  <th>聯絡人</th>
                  <th>聯絡電話</th>
                  <th>經緯度</th>
                  {isAdmin && <th>操作</th>}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="text-center text-muted py-4">
                      載入中…
                    </td>
                  </tr>
                ) : locations.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center text-muted py-4">
                      尚無據點資料
                    </td>
                  </tr>
                ) : (
                  locations.map((loc) => (
                    <tr key={loc.id}>
                      <td>
                        <strong>{loc.location_name}</strong>
                      </td>
                      <td>{loc.address}</td>
                      <td>{loc.contact_person}</td>
                      <td>{loc.phone}</td>
                      <td>
                        {loc.latitude != null && loc.longitude != null
                          ? `${loc.latitude}, ${loc.longitude}`
                          : '未設定'}
                      </td>
                      {isAdmin && (
                        <td className="text-nowrap">
                          <button className="btn btn-sm btn-outline-primary me-1" onClick={() => openEdit(loc)}>
                            編輯
                          </button>
                          <button className="btn btn-sm btn-outline-danger" onClick={() => void handleDeactivate(loc)}>
                            停用
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showForm && (
        <div className="modal d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <form onSubmit={handleSubmit}>
                <div className="modal-header">
                  <h5 className="modal-title">{form.id ? '編輯據點' : '新增據點'}</h5>
                  <button type="button" className="btn-close" onClick={() => setShowForm(false)} />
                </div>
                <div className="modal-body">
                  <div className="mb-3">
                    <label className="form-label">據點名稱 *</label>
                    <input
                      className="form-control"
                      required
                      value={form.location_name}
                      onChange={(e) => setForm({ ...form, location_name: e.target.value })}
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">地址</label>
                    <input
                      className="form-control"
                      value={form.address}
                      onChange={(e) => setForm({ ...form, address: e.target.value })}
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">聯絡人</label>
                    <input
                      className="form-control"
                      value={form.contact_person}
                      onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">聯絡電話</label>
                    <input
                      className="form-control"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    />
                  </div>
                  <div className="row">
                    <div className="col-6 mb-3">
                      <label className="form-label">緯度</label>
                      <input
                        className="form-control"
                        type="number"
                        step="any"
                        value={form.latitude}
                        onChange={(e) => setForm({ ...form, latitude: e.target.value })}
                      />
                    </div>
                    <div className="col-6 mb-3">
                      <label className="form-label">經度</label>
                      <input
                        className="form-control"
                        type="number"
                        step="any"
                        value={form.longitude}
                        onChange={(e) => setForm({ ...form, longitude: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>
                    取消
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? '儲存中…' : '儲存'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
