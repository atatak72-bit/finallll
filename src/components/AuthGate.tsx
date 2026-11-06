import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Lock, Loader2, LogOut } from 'lucide-react'
import { supabase } from '../lib/supabase'

/**
 * Nothing in the app loads until the owner signs in. The database and edge functions only
 * answer signed-in users, so the public anon key in the page bundle is no longer enough on its own.
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      setSession(data.session)
      setChecking(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [])

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    )
  }
  if (!session) return <LoginForm />
  return <>{children}</>
}

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (err) setError(err.message === 'Invalid login credentials' ? 'E-posta veya şifre yanlış.' : err.message)
    setBusy(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <form onSubmit={submit} className="card w-full max-w-sm">
        <div className="card-body space-y-4">
          <div className="flex items-center gap-2">
            <Lock className="w-5 h-5 text-brand-600" />
            <h1 className="text-lg font-semibold text-slate-900">Tubika giriş</h1>
          </div>
          <div>
            <label className="label">E-posta</label>
            <input className="input" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="label">Şifre</label>
            <input className="input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button className="btn-primary w-full justify-center" disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Giriş yap'}
          </button>
        </div>
      </form>
    </div>
  )
}

export function SignOutButton() {
  return (
    <button
      className="btn-secondary text-sm inline-flex items-center gap-1"
      onClick={() => { void supabase.auth.signOut() }}
      title="Çıkış yap"
    >
      <LogOut className="w-4 h-4" /> Çıkış
    </button>
  )
}
