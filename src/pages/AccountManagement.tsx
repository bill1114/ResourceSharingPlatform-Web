import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { AllRoles, roleDisplayName, Roles, type Role } from '../lib/enums'
import { supabase } from '../lib/supabaseClient'
import type { Profile, SupplyLocation } from '../types/db'

type Form = { id?: string; username: string; displayName: string; password: string; roleName: Role; locationId: number | null; isActive: boolean }
type LineBinding = { profile_id: string; line_user_id: string; line_display_name: string | null; notify_enabled: boolean; bound_at: string }
const emptyForm: Form = { username: '', displayName: '', password: '', roleName: Roles.SocialWorker, locationId: null, isActive: true }

export function AccountManagement() {
  const [profiles, setProfiles] = useState<Profile[]>([]), [locations, setLocations] = useState<SupplyLocation[]>([])
  const [bindings, setBindings] = useState<LineBinding[]>([])
  const [form, setForm] = useState<Form>(emptyForm), [keyword, setKeyword] = useState(''), [message, setMessage] = useState<{ok:boolean;text:string}|null>(null), [saving, setSaving] = useState(false)
  async function load() { const [p, l, b] = await Promise.all([supabase.from('profiles').select('*').order('username'), supabase.from('supply_location').select('*').eq('is_active', true).order('id'), supabase.functions.invoke('account-admin',{body:{action:'bindings'}})]); setProfiles((p.data ?? []) as Profile[]); setLocations((l.data ?? []) as SupplyLocation[]); setBindings((b.data?.bindings ?? []) as LineBinding[]) }
  useEffect(() => { void load() }, [])
  const filtered = useMemo(() => profiles.filter((x) => `${x.username} ${x.display_name ?? ''}`.toLowerCase().includes(keyword.toLowerCase())), [profiles, keyword])
  async function submit(e: FormEvent) { e.preventDefault(); setSaving(true); setMessage(null); const { data, error } = await supabase.functions.invoke('account-admin', { body: { action: form.id ? 'update' : 'create', ...form } }); setSaving(false); if (error || !data?.success) setMessage({ok:false,text:data?.message ?? error?.message ?? '儲存失敗'}); else { setMessage({ok:true,text:data.message}); setForm(emptyForm); await load() } }
  function edit(x: Profile) { setForm({ id:x.id, username:x.username, displayName:x.display_name ?? '', password:'', roleName:x.role_name, locationId:x.location_id, isActive:x.is_active }); window.scrollTo({top:0,behavior:'smooth'}) }
  async function lineAction(action:'createBindCode'|'unbind',id:string){setSaving(true);const{data,error}=await supabase.functions.invoke('account-admin',{body:{action,id}});setSaving(false);setMessage({ok:!!data?.success,text:data?.message??error?.message??'LINE 綁定操作失敗'});if(data?.success)await load()}
  return <div className="container-fluid mt-4"><h2><i className="bi bi-people" /> 帳號管理</h2><hr />
    {message && <div className={`alert alert-${message.ok?'success':'danger'}`}>{message.text}</div>}
    <div className="card shadow-sm mb-4"><div className="card-header">{form.id ? '編輯帳號' : '新增帳號'}</div><div className="card-body"><form onSubmit={submit}><div className="row g-3">
      <div className="col-md-3"><label className="form-label">帳號 *</label><input className="form-control" required disabled={!!form.id} value={form.username} onChange={(e)=>setForm({...form,username:e.target.value})}/></div>
      <div className="col-md-3"><label className="form-label">顯示名稱</label><input className="form-control" value={form.displayName} onChange={(e)=>setForm({...form,displayName:e.target.value})}/></div>
      <div className="col-md-3"><label className="form-label">{form.id?'新密碼（留空不變）':'密碼 *'}</label><input type="password" className="form-control" required={!form.id} minLength={6} value={form.password} onChange={(e)=>setForm({...form,password:e.target.value})}/></div>
      <div className="col-md-3"><label className="form-label">角色 *</label><select className="form-select" value={form.roleName} onChange={(e)=>setForm({...form,roleName:e.target.value as Role})}>{AllRoles.map(x=><option key={x} value={x}>{roleDisplayName(x)}</option>)}</select></div>
      <div className="col-md-4"><label className="form-label">所屬據點</label><select className="form-select" value={form.locationId ?? ''} onChange={(e)=>setForm({...form,locationId:e.target.value?Number(e.target.value):null})}><option value="">未指定</option>{locations.map(x=><option key={x.id} value={x.id}>{x.location_name}</option>)}</select></div>
      <div className="col-md-2 d-flex align-items-end"><div className="form-check form-switch mb-2"><input className="form-check-input" type="checkbox" checked={form.isActive} onChange={(e)=>setForm({...form,isActive:e.target.checked})}/><label className="form-check-label">啟用</label></div></div>
      <div className="col-md-6 d-flex align-items-end gap-2"><button className="btn btn-primary" disabled={saving}>{saving?'儲存中…':'儲存帳號'}</button>{form.id&&<button type="button" className="btn btn-secondary" onClick={()=>setForm(emptyForm)}>取消編輯</button>}</div>
    </div></form></div></div>
    <div className="card shadow-sm"><div className="card-body"><input className="form-control mb-3" placeholder="搜尋帳號或顯示名稱" value={keyword} onChange={(e)=>setKeyword(e.target.value)}/><div className="table-responsive"><table className="table table-hover"><thead><tr><th>帳號</th><th>名稱</th><th>角色</th><th>據點</th><th>LINE 綁定</th><th>狀態</th><th /></tr></thead><tbody>{filtered.map(x=>{const binding=bindings.find(b=>b.profile_id===x.id);return <tr key={x.id}><td>{x.username}</td><td>{x.display_name}</td><td>{roleDisplayName(x.role_name)}</td><td>{locations.find(l=>l.id===x.location_id)?.location_name ?? '未指定'}</td><td>{binding?<><span className="badge bg-success">{binding.line_display_name||'已綁定'}</span><div className="small text-muted text-truncate" style={{maxWidth:140}}>{binding.line_user_id}</div></>:<span className="text-muted">未綁定</span>}</td><td><span className={`badge bg-${x.is_active?'success':'secondary'}`}>{x.is_active?'啟用':'停用'}</span></td><td><div className="d-flex gap-1 flex-wrap"><button className="btn btn-outline-primary btn-sm" onClick={()=>edit(x)}>編輯</button>{binding?<button className="btn btn-outline-danger btn-sm" disabled={saving} onClick={()=>void lineAction('unbind',x.id)}>解除 LINE</button>:<button className="btn btn-outline-success btn-sm" disabled={saving} onClick={()=>void lineAction('createBindCode',x.id)}>產生綁定碼</button>}</div></td></tr>})}</tbody></table></div></div></div>
  </div>
}
