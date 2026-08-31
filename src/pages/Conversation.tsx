import { useParams, useNavigate } from 'react-router-dom'
import { useState, useRef, useEffect } from 'react'
import { ArrowLeft, Send, ExternalLink, Loader2 } from 'lucide-react'
import { useStoreData } from '../lib/DataContext'
import { timeAgo, cn } from '../lib/utils'

export default function Conversation() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { conversations, loading } = useStoreData()
  const conv = conversations.find(c => c.id === id)
  const [messages, setMessages] = useState(conv?.messages || [])
  const [input, setInput] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (conv) setMessages(conv.messages)
  }, [conv])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function send() {
    if (!input.trim()) return
    setMessages([...messages, {
      id: `m-${Date.now()}`,
      from: 'seller',
      body: input,
      date: new Date().toISOString(),
    }])
    setInput('')
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-brand-600 animate-spin" /></div>
  }

  if (!conv) {
    return (
      <div className="max-w-4xl mx-auto text-center py-20">
        <p className="text-sm text-slate-500">Conversation not found.</p>
        <button onClick={() => navigate('/messages')} className="btn-secondary mt-4">Back to Messages</button>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="card overflow-hidden flex flex-col" style={{ height: 'calc(100vh - 140px)' }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-200">
          <button onClick={() => navigate(-1)} className="btn-ghost p-1.5"><ArrowLeft className="w-4 h-4" /></button>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-slate-900">{conv.buyerName}</h3>
            <p className="text-xs text-slate-500 truncate">{conv.listingTitle}</p>
          </div>
          <a href="#" className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1">
            View listing <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-slate-50">
          {messages.length === 0 ? (
            <div className="text-center text-sm text-slate-400 py-8">No messages yet.</div>
          ) : (
            messages.map(msg => (
              <div key={msg.id} className={cn('flex', msg.from === 'seller' ? 'justify-end' : 'justify-start')}>
                <div className={cn(
                  'max-w-[70%] rounded-lg px-4 py-2.5 text-sm',
                  msg.from === 'seller' ? 'bg-brand-600 text-white' : 'bg-white border border-slate-200 text-slate-900',
                )}>
                  <p>{msg.body}</p>
                  <p className={cn('text-xs mt-1', msg.from === 'seller' ? 'text-brand-200' : 'text-slate-400')}>{timeAgo(msg.date)}</p>
                </div>
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>

        {/* Input */}
        <div className="border-t border-slate-200 p-3 flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()}
            placeholder="Type a reply…"
            className="input flex-1"
          />
          <button onClick={send} className="btn-primary"><Send className="w-4 h-4" /> Send</button>
        </div>
      </div>
    </div>
  )
}
