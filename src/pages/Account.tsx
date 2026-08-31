import { useState } from 'react'
import { User, Lock, Mail, Save } from 'lucide-react'

export default function Account() {
  const [name, setName] = useState('Store Owner')
  const [email, setEmail] = useState('owner@tubika.com')
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Account info */}
      <div className="card">
        <div className="card-header flex items-center gap-2">
          <User className="w-4 h-4 text-slate-400" />
          <h3 className="font-semibold text-slate-900">Account Information</h3>
        </div>
        <div className="card-body space-y-4">
          <p className="text-sm text-slate-500">Your personal login details — separate from your store or billing settings.</p>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-brand-600 text-white flex items-center justify-center text-xl font-semibold">A</div>
            <button className="btn-secondary text-sm">Change Avatar</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Full Name</label>
              <input className="input" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div>
              <label className="label">Email Address</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input className="input pl-9" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
            </div>
          </div>
          <button className="btn-primary"><Save className="w-4 h-4" /> Update</button>
        </div>
      </div>

      {/* Password */}
      <div className="card">
        <div className="card-header flex items-center gap-2">
          <Lock className="w-4 h-4 text-slate-400" />
          <h3 className="font-semibold text-slate-900">Password</h3>
        </div>
        <div className="card-body space-y-4">
          <p className="text-sm text-slate-500">Change your password, then click Update.</p>
          <div className="space-y-4 max-w-md">
            <div>
              <label className="label">Current Password</label>
              <input className="input" type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} placeholder="••••••••" />
            </div>
            <div>
              <label className="label">New Password</label>
              <input className="input" type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="••••••••" />
            </div>
            <div>
              <label className="label">Confirm New Password</label>
              <input className="input" type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} placeholder="••••••••" />
            </div>
          </div>
          <button className="btn-primary"><Save className="w-4 h-4" /> Update Password</button>
        </div>
      </div>
    </div>
  )
}
