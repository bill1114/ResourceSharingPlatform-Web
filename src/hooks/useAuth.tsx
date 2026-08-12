// Replaces ASP.NET Cookie auth + claims (ClaimTypes.Role / "DisplayName" / "LocationId")
// with Supabase Auth + a `profiles` row fetched once after sign-in. Login keeps the
// existing 帳號登入 UX: the caller types a bare username, this hook translates it to the
// synthetic `{username}@local.invalid` email Supabase Auth actually stores (see migration
// plan §二) — no DB lookup needed, it's a deterministic string transform.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import type { Profile } from '../types/db'

const SYNTHETIC_EMAIL_SUFFIX = '@local.invalid'

interface AuthContextValue {
  session: Session | null
  profile: Profile | null
  loading: boolean
  signIn: (username: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadProfile(userId: string) {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
    if (error) {
      console.error('Failed to load profile', error)
      setProfile(null)
      return
    }
    setProfile(data as Profile)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session?.user) {
        loadProfile(session.user.id).finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      if (newSession?.user) {
        loadProfile(newSession.user.id)
      } else {
        setProfile(null)
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  async function signIn(username: string, password: string): Promise<{ error: string | null }> {
    const email = `${username.trim()}${SYNTHETIC_EMAIL_SUFFIX}`
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      // Generic message on purpose (mirrors AccountController's "帳號或密碼錯誤" —
      // don't reveal whether the username exists).
      return { error: '帳號或密碼錯誤' }
    }
    return { error: null }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
