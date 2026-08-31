import { Search, Bell, HelpCircle } from 'lucide-react'

export default function Topbar({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-slate-200 px-6 py-3 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <h1 className="text-lg font-semibold text-slate-900 truncate">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 truncate">{subtitle}</p>}
      </div>

      <div className="relative hidden md:block">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          placeholder="Search listings, orders, ASINs…"
          className="w-64 pl-9 pr-3 py-2 text-sm bg-slate-100 border border-transparent rounded-lg focus:bg-white focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none transition"
        />
      </div>

      <button className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition">
        <HelpCircle className="w-5 h-5" />
      </button>
      <button className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition relative">
        <Bell className="w-5 h-5" />
        <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-error-500 rounded-full ring-2 ring-white" />
      </button>
    </header>
  )
}
