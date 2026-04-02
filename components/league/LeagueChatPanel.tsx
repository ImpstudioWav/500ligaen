'use client'

import { FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getProfileByUserId, getUsernameMap, shortenUserId } from '@/lib/profiles'

type Message = {
  id: string
  user_id: string
  content: string
  created_at: string
  league_id?: string | null
}

type Props = {
  leagueId: string
  /** page: full route. embed: short stack. hub: tall in-league dashboard + optional link to full chat. */
  variant: 'page' | 'embed' | 'hub'
  /** Hub: opens dedicated chat route */
  fullChatHref?: string
}

export function LeagueChatPanel({ leagueId, variant, fullChatHref }: Props) {
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [content, setContent] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [loadingMessages, setLoadingMessages] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [usernameMap, setUsernameMap] = useState<Record<string, string>>({})
  const [resolvedLeagueName, setResolvedLeagueName] = useState('')

  const addMessageIfMissing = (prev: Message[], incoming: Message) => {
    if (prev.some((message) => message.id === incoming.id)) {
      return prev
    }
    return [...prev, incoming].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )
  }

  useEffect(() => {
    let isMounted = true
    let removeChannel: (() => void) | undefined

    const loadChat = async () => {
      setError('')

      if (!leagueId) {
        setError('Ugyldig liga.')
        setLoadingMessages(false)
        return
      }

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        router.replace('/login')
        return
      }

      if (!isMounted) return

      const profile = await getProfileByUserId(user.id)
      if (!profile) {
        router.replace('/complete-profile')
        return
      }

      const { data: membership, error: memberError } = await supabase
        .from('league_members')
        .select('league_id')
        .eq('user_id', user.id)
        .eq('league_id', leagueId)
        .maybeSingle()

      if (memberError) {
        if (isMounted) setError(memberError.message)
        if (isMounted) setLoadingMessages(false)
        return
      }

      if (!membership) {
        router.replace('/leagues')
        return
      }

      const { data: leagueRow } = await supabase
        .from('leagues')
        .select('name')
        .eq('id', leagueId)
        .maybeSingle()

      if (isMounted) {
        setResolvedLeagueName((leagueRow as { name: string | null } | null)?.name || 'Liga')
      }

      setUserId(user.id)

      const { data, error: messagesError } = await supabase
        .from('messages')
        .select('id, user_id, content, created_at, league_id')
        .eq('league_id', leagueId)
        .order('created_at', { ascending: true })

      if (messagesError) {
        if (isMounted) setError(messagesError.message)
      } else {
        const fetchedMessages = data ?? []
        if (isMounted) {
          setMessages(fetchedMessages)
          const usernames = await getUsernameMap(fetchedMessages.map((m) => m.user_id))
          if (isMounted) setUsernameMap(usernames)
        }
      }

      if (isMounted) setLoadingMessages(false)

      const channel = supabase
        .channel(`league-messages:${leagueId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `league_id=eq.${leagueId}`,
          },
          (payload) => {
            const newMessage = payload.new as Message
            if (newMessage.league_id !== leagueId) return
            setMessages((prev) => addMessageIfMissing(prev, newMessage))
            void getUsernameMap([newMessage.user_id]).then((usernames) => {
              setUsernameMap((prev) => ({ ...prev, ...usernames }))
            })
          }
        )
        .subscribe()

      removeChannel = () => {
        void supabase.removeChannel(channel)
      }
    }

    void loadChat()

    return () => {
      isMounted = false
      removeChannel?.()
    }
  }, [leagueId, router])

  const handleSend = async (e: FormEvent) => {
    e.preventDefault()

    const trimmed = content.trim()
    if (!trimmed || !userId || !leagueId) return

    setSending(true)
    setError('')

    const { data, error: insertError } = await supabase
      .from('messages')
      .insert({
        user_id: userId,
        content: trimmed,
        league_id: leagueId,
      })
      .select('id, user_id, content, created_at, league_id')
      .single()

    setSending(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    setMessages((prev) => addMessageIfMissing(prev, data))
    setContent('')
  }

  const outerClass =
    variant === 'page'
      ? 'flex h-[calc(100dvh-11rem)] min-h-[280px] w-full flex-col rounded-2xl bg-white shadow-sm ring-1 ring-slate-200'
      : variant === 'hub'
        ? 'flex h-[min(58dvh,24rem)] w-full min-h-[16rem] flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 sm:h-[min(56dvh,28rem)] lg:h-[min(78dvh,44rem)] lg:max-h-[calc(100dvh-6rem)] lg:min-h-[22rem]'
        : 'flex h-[min(420px,52vh)] min-h-[220px] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200'

  return (
    <div className={outerClass}>
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0">
          {variant === 'page' ? (
            <>
              <h1 className="text-lg font-semibold text-slate-900">
                {resolvedLeagueName || 'Liga'}
              </h1>
              <p className="text-xs text-slate-500">Ligachat</p>
            </>
          ) : variant === 'hub' ? (
            <>
              <h2 className="text-base font-semibold text-slate-900">💬 Ligachat</h2>
              <p className="text-xs text-slate-500">Meldinger og svar her</p>
            </>
          ) : (
            <>
              <h2 className="text-sm font-semibold text-slate-900">Ligachat</h2>
              <p className="text-xs text-slate-500">Meldinger i ligaen</p>
            </>
          )}
        </div>
        {variant === 'hub' && fullChatHref ? (
          <Link
            href={fullChatHref}
            prefetch
            className="shrink-0 pt-0.5 text-xs font-medium text-slate-700 underline decoration-slate-300 underline-offset-2 hover:text-slate-900"
          >
            Åpne full chat
          </Link>
        ) : null}
      </div>

      <section
        className={`min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4 sm:space-y-3 ${
          variant === 'hub' ? 'bg-slate-50/60' : ''
        }`}
      >
        {loadingMessages ? (
          <p className="text-sm text-slate-500">Laster meldinger...</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-slate-500">Ingen meldinger i denne ligaen ennå.</p>
        ) : (
          messages.map((message) => (
            <article key={message.id} className="rounded-xl bg-slate-100 px-3 py-2">
              <p className="text-sm text-slate-900">{message.content}</p>
              <p className="mt-1 text-[11px] text-slate-500">
                {usernameMap[message.user_id] ?? shortenUserId(message.user_id)} •{' '}
                {new Date(message.created_at).toLocaleString('nb-NO')}
              </p>
            </article>
          ))
        )}
      </section>

      <form onSubmit={handleSend} className="shrink-0 space-y-2 border-t border-slate-200 p-4">
        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : null}

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Skriv en melding..."
            className="w-full min-w-0 rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            disabled={sending || loadingMessages}
          />
          <button
            type="submit"
            disabled={sending || loadingMessages || !content.trim()}
            className="shrink-0 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sending ? 'Sender...' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  )
}
