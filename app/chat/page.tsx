'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Message = {
  id: string
  user_id: string
  content: string
  created_at: string
}

export default function ChatPage() {
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [content, setContent] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [loadingMessages, setLoadingMessages] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const loadChat = async () => {
      setError('')

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        router.push('/login')
        return
      }

      setUserId(user.id)

      const { data, error: messagesError } = await supabase
        .from('messages')
        .select('id, user_id, content, created_at')
        .order('created_at', { ascending: true })

      if (messagesError) {
        setError(messagesError.message)
      } else {
        setMessages(data ?? [])
      }

      setLoadingMessages(false)
    }

    void loadChat()
  }, [router])

  const handleSend = async (e: FormEvent) => {
    e.preventDefault()

    const trimmed = content.trim()
    if (!trimmed || !userId) return

    setSending(true)
    setError('')

    const { data, error: insertError } = await supabase
      .from('messages')
      .insert({
        user_id: userId,
        content: trimmed,
      })
      .select('id, user_id, content, created_at')
      .single()

    setSending(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    setMessages((prev) => [...prev, data])
    setContent('')
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto flex h-[calc(100vh-3rem)] w-full max-w-md flex-col rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="border-b border-slate-200 px-4 py-3">
          <h1 className="text-lg font-semibold text-slate-900">500ligaen Chat</h1>
          <p className="text-xs text-slate-500">Global chat</p>
        </div>

        <section className="flex-1 space-y-3 overflow-y-auto p-4">
          {loadingMessages ? (
            <p className="text-sm text-slate-500">Laster meldinger...</p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-slate-500">Ingen meldinger ennå.</p>
          ) : (
            messages.map((message) => (
              <article key={message.id} className="rounded-xl bg-slate-100 px-3 py-2">
                <p className="text-sm text-slate-900">{message.content}</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {message.user_id} •{' '}
                  {new Date(message.created_at).toLocaleString('nb-NO')}
                </p>
              </article>
            ))
          )}
        </section>

        <form onSubmit={handleSend} className="space-y-2 border-t border-slate-200 p-4">
          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          ) : null}

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Skriv en melding..."
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              disabled={sending || loadingMessages}
            />
            <button
              type="submit"
              disabled={sending || loadingMessages || !content.trim()}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {sending ? 'Sender...' : 'Send'}
            </button>
          </div>
        </form>
      </div>
    </main>
  )
}
