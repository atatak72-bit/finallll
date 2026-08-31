import { useState } from 'react'
import { Send, MessageSquare, Search, Loader2 } from 'lucide-react'
import { useStoreData } from '../lib/DataContext'
import { timeAgo, cn } from '../lib/utils'

export default function Messages() {
  const { conversations, loading } = useStoreData()
  const [search, setSearch] = useState('')

  const filtered = conversations.filter(c =>
    c.buyerName.toLowerCase().includes(search.toLowerCase()) ||
    c.listingTitle.toLowerCase().includes(search.toLowerCase())
  )

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-brand-600 animate-spin" /></div>
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="card overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4">
          {/* Conversation list */}
          <div className="border-r border-slate-200 max-h-[600px] overflow-y-auto">
            <div className="p-3 border-b border-slate-200 sticky top-0 bg-white z-10">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search conversations…"
                  className="input pl-9 text-sm"
                />
              </div>
            </div>
            {filtered.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-400">No conversations yet.</div>
            ) : (
              filtered.map(conv => (
                <a
                  key={conv.id}
                  href={`/messages/${conv.id}`}
                  className={cn(
                    'flex flex-col gap-1 p-3 border-b border-slate-100 hover:bg-slate-50 transition cursor-pointer',
                    conv.unread && 'bg-brand-50/50',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className={cn('text-sm font-medium', conv.unread ? 'text-slate-900' : 'text-slate-700')}>{conv.buyerName}</span>
                    {conv.unread && <span className="w-2 h-2 bg-brand-500 rounded-full" />}
                  </div>
                  <p className="text-xs text-slate-500 truncate">{conv.listingTitle}</p>
                  <p className={cn('text-xs truncate', conv.unread ? 'text-slate-700 font-medium' : 'text-slate-400')}>{conv.lastMessage}</p>
                  <p className="text-xs text-slate-400">{timeAgo(conv.lastMessageDate)}</p>
                </a>
              ))
            )}
          </div>

          {/* Empty state / preview */}
          <div className="md:col-span-2 lg:col-span-3 flex flex-col items-center justify-center p-12 text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
              <MessageSquare className="w-6 h-6 text-slate-400" />
            </div>
            <p className="text-sm font-medium text-slate-600">Select a conversation</p>
            <p className="text-sm text-slate-400 mt-1">Click a conversation on the left to read and reply.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
