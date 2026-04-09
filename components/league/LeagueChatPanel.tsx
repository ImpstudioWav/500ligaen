'use client'

import { type FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { ChatMessageBubble } from '@/components/chat/ChatMessageBubble'
import { ChatMentionTextField } from '@/components/chat/ChatMentionTextField'
import { buildUsernameKeyToUserIdMap } from '@/lib/leagueMentions'
import {
  type ChatUserInfo,
  getProfileByUserId,
  getUsernameMap,
  profileHasUsername,
  shortenUserId,
} from '@/lib/profiles'
import { buildRepliedToPayload } from '@/lib/chatReplyPreview'

type LeagueMemberOption = { userId: string; username: string }

type Message = {
  id: string
  user_id: string
  content: string
  created_at: string
  league_id?: string | null
  reply_to_message_id?: string | null
}

type Props = {
  leagueId: string
  /** page: full route. embed: short stack. hub: tall in-league dashboard. float: desktop dock (no chrome row). */
  variant: 'page' | 'embed' | 'hub' | 'float'
  /** Hub: opens dedicated chat route */
  fullChatHref?: string
  /** Latest message id for launcher read-state / previews */
  onThreadActivity?: (info: { leagueId: string; latestMessageId: string | null }) => void
}

export function LeagueChatPanel({ leagueId, variant, fullChatHref, onThreadActivity }: Props) {
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [content, setContent] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [loadingMessages, setLoadingMessages] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [userInfoMap, setUserInfoMap] = useState<Record<string, ChatUserInfo>>({})
  const [resolvedLeagueName, setResolvedLeagueName] = useState('')
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null)
  const [leagueMembers, setLeagueMembers] = useState<LeagueMemberOption[]>([])
  const [replyTo, setReplyTo] = useState<Message | null>(null)

  const scrollContainerRef = useRef<HTMLElement>(null)
  const chatInputRef = useRef<HTMLInputElement>(null)
  /** Only this panel's realtime channel — never remove sibling panels (hub + float same league). */
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const loadGenerationRef = useRef(0)

  const usernameKeyToUserId = useMemo(
    () => buildUsernameKeyToUserIdMap(leagueMembers),
    [leagueMembers]
  )

  const addMessageIfMissing = (prev: Message[], incoming: Message) => {
    if (prev.some((message) => message.id === incoming.id)) {
      return prev
    }
    return [...prev, incoming].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )
  }

  useEffect(() => {
    if (loadingMessages || sending) return
    if (typeof window === 'undefined') return
    if (!window.matchMedia('(min-width: 768px)').matches) return
    const tid = window.setTimeout(() => {
      chatInputRef.current?.focus({ preventScroll: true })
    }, 50)
    return () => window.clearTimeout(tid)
  }, [loadingMessages, sending])

  const onThreadActivityRef = useRef(onThreadActivity)
  onThreadActivityRef.current = onThreadActivity

  useEffect(() => {
    if (!onThreadActivityRef.current) return
    const last = messages.length > 0 ? messages[messages.length - 1] : null
    onThreadActivityRef.current({ leagueId, latestMessageId: last?.id ?? null })
  }, [messages, leagueId])

  useEffect(() => {
    const gen = ++loadGenerationRef.current
    let isMounted = true

    const disposeRealtime = () => {
      if (realtimeChannelRef.current) {
        void supabase.removeChannel(realtimeChannelRef.current)
        realtimeChannelRef.current = null
      }
    }

    setLoadingMessages(true)
    setMessages([])

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

      if (!isMounted || gen !== loadGenerationRef.current) return

      if (userError || !user) {
        router.replace('/login')
        return
      }

      const profile = await getProfileByUserId(user.id)
      if (!isMounted || gen !== loadGenerationRef.current) return
      if (!profileHasUsername(profile)) {
        router.replace('/complete-profile')
        return
      }

      const { data: membership, error: memberError } = await supabase
        .from('league_members')
        .select('league_id')
        .eq('user_id', user.id)
        .eq('league_id', leagueId)
        .maybeSingle()

      if (!isMounted || gen !== loadGenerationRef.current) return

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

      if (!isMounted || gen !== loadGenerationRef.current) return

      if (isMounted) {
        setResolvedLeagueName((leagueRow as { name: string | null } | null)?.name || 'Liga')
      }

      setUserId(user.id)

      const { data: memberRows, error: membersError } = await supabase
        .from('league_members')
        .select('user_id')
        .eq('league_id', leagueId)

      if (!isMounted || gen !== loadGenerationRef.current) return

      if (membersError) {
        if (isMounted) setError(membersError.message)
      } else {
        let memberIds = Array.from(new Set((memberRows ?? []).map((r) => r.user_id as string)))
        if (memberIds.length === 0) {
          const { data: lbRows } = await supabase
            .from('leaderboard')
            .select('user_id')
            .eq('league_id', leagueId)
          memberIds = Array.from(
            new Set((lbRows ?? []).map((r) => (r as { user_id: string }).user_id))
          )
        }
        const memberMap = await getUsernameMap(memberIds)
        const options: LeagueMemberOption[] = []
        for (const uid of memberIds) {
          const info = memberMap[uid]
          const label = (info?.username ?? shortenUserId(uid)).trim()
          options.push({ userId: uid, username: label })
        }
        options.sort((a, b) => a.username.localeCompare(b.username, 'nb'))
        if (isMounted && gen === loadGenerationRef.current) {
          setLeagueMembers(options)
        }
      }

      if (!isMounted || gen !== loadGenerationRef.current) return

      const { data, error: messagesError } = await supabase
        .from('messages')
        .select('id, user_id, content, created_at, league_id, reply_to_message_id')
        .eq('league_id', leagueId)
        .order('created_at', { ascending: true })

      if (!isMounted || gen !== loadGenerationRef.current) return

      if (messagesError) {
        if (isMounted) setError(messagesError.message)
      } else {
        const fetchedMessages = data ?? []
        if (isMounted) {
          setMessages(fetchedMessages)
          const userInfos = await getUsernameMap(fetchedMessages.map((m) => m.user_id))
          if (isMounted && gen === loadGenerationRef.current) {
            setUserInfoMap(userInfos)
          }
        }
      }

      if (!isMounted || gen !== loadGenerationRef.current) return

      if (isMounted) setLoadingMessages(false)

      disposeRealtime()
      if (!isMounted || gen !== loadGenerationRef.current) return

      const channelName = `league-messages:${leagueId}:${crypto.randomUUID()}`
      const channel = supabase.channel(channelName).on(
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
          void getUsernameMap([newMessage.user_id]).then((infos) => {
            setUserInfoMap((prev) => ({ ...prev, ...infos }))
          })
        }
      )

      channel.subscribe()
      realtimeChannelRef.current = channel
    }

    void loadChat()

    return () => {
      isMounted = false
      disposeRealtime()
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
        reply_to_message_id: replyTo?.id ?? null,
      })
      .select('id, user_id, content, created_at, league_id, reply_to_message_id')
      .single()

    if (insertError) {
      setSending(false)
      setError(insertError.message)
      return
    }

    if (trimmed.includes('@')) {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (token) {
        const res = await fetch('/api/chat/apply-mentions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ messageId: data.id }),
        })
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string }
          setError(
            `Meldingen ble sendt, men nevnelser ble ikke lagret: ${payload.error ?? `HTTP ${res.status}`}.`
          )
        }
      }
    }

    setSending(false)

    setMessages((prev) => addMessageIfMissing(prev, data))
    setContent('')
    setReplyTo(null)
  }

  const handleDeleteOwnMessage = async (messageId: string) => {
    if (!userId) return
    if (!window.confirm('Slette denne meldingen?')) return

    setDeletingMessageId(messageId)
    try {
      const { error: delError } = await supabase
        .from('messages')
        .delete()
        .eq('id', messageId)
        .eq('user_id', userId)
      if (delError) {
        window.alert(delError.message)
        return
      }
      setMessages((prev) => prev.filter((m) => m.id !== messageId))
    } finally {
      setDeletingMessageId(null)
    }
  }

  useLayoutEffect(() => {
    if (loadingMessages) return

    const el = scrollContainerRef.current
    if (!el) return

    el.scrollTop = el.scrollHeight
  }, [loadingMessages, messages, userInfoMap])

  const outerClass =
    variant === 'float'
      ? 'flex min-h-0 flex-1 flex-col overflow-hidden bg-white'
      : variant === 'page'
        ? 'flex h-[calc(100dvh-11rem)] min-h-[280px] w-full flex-col overflow-visible rounded-2xl bg-white shadow-sm ring-1 ring-slate-200'
        : variant === 'hub'
          ? 'flex h-[min(58dvh,24rem)] w-full min-h-[16rem] flex-col overflow-x-hidden overflow-y-visible rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 sm:h-[min(56dvh,28rem)] lg:h-[min(78dvh,44rem)] lg:max-h-[calc(100dvh-6rem)] lg:min-h-[22rem]'
          : 'flex h-[min(420px,52vh)] min-h-[220px] w-full flex-col overflow-x-hidden overflow-y-visible rounded-2xl bg-white shadow-sm ring-1 ring-slate-200'

  const sectionClass =
    variant === 'float'
      ? 'min-h-0 flex-1 space-y-2 overflow-y-auto bg-slate-50/50 p-2.5'
      : `min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4 sm:space-y-3 ${
          variant === 'hub' ? 'bg-slate-50/60' : ''
        }`

  const formClass = variant === 'float' ? 'relative z-20 shrink-0 space-y-2 overflow-visible border-t border-slate-200 p-2.5' : 'relative z-20 shrink-0 space-y-2 overflow-visible border-t border-slate-200 p-4'

  const inputId =
    variant === 'float' ? `league-chat-float-${leagueId}` : `league-chat-input-${leagueId}`

  return (
    <div className={outerClass}>
      {variant !== 'float' ? (
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
      ) : null}

      <section ref={scrollContainerRef} className={sectionClass}>
        {loadingMessages ? (
          <p className="text-sm text-slate-500">Laster meldinger...</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-slate-500">Ingen meldinger i denne ligaen ennå.</p>
        ) : (
          messages.map((message) => {
            const info = userInfoMap[message.user_id]
            const label = info?.username ?? shortenUserId(message.user_id)
            const isOwn = userId !== null && message.user_id === userId
            return (
              <ChatMessageBubble
                key={message.id}
                content={message.content}
                usernameLabel={label}
                isAdmin={info?.isAdmin === true}
                createdAtLabel={new Date(message.created_at).toLocaleString('nb-NO')}
                isOwn={isOwn}
                repliedTo={buildRepliedToPayload(
                  messages,
                  message.reply_to_message_id,
                  userInfoMap,
                  shortenUserId,
                  userId
                )}
                onReply={
                  userId
                    ? () => {
                        setReplyTo(message)
                        requestAnimationFrame(() => chatInputRef.current?.focus())
                      }
                    : undefined
                }
                onDelete={
                  isOwn ? () => void handleDeleteOwnMessage(message.id) : undefined
                }
                deletePending={deletingMessageId === message.id}
              />
            )
          })
        )}
      </section>

      <form onSubmit={handleSend} className={formClass}>
        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : null}

        {replyTo ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-100/90 px-3 py-2 text-xs text-slate-700">
            <span className="min-w-0 truncate">
              <span className="font-medium">Svar til </span>
              {userInfoMap[replyTo.user_id]?.username ?? shortenUserId(replyTo.user_id)}:{' '}
              {replyTo.content.length > 80 ? `${replyTo.content.slice(0, 80)}…` : replyTo.content}
            </span>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              className="shrink-0 font-medium text-slate-600 underline underline-offset-2 hover:text-slate-900"
            >
              Avbryt
            </button>
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          <ChatMentionTextField
            id={inputId}
            label="Melding (bruk @ for å nevne medlemmer)"
            value={content}
            onChange={setContent}
            disabled={sending || loadingMessages}
            placeholder="Skriv en melding… (@ for å nevne)"
            candidates={leagueMembers}
            emptyCandidatesHint="Fant ingen ligamedlemmer (sjekk databasetilgang / league_members-policy)."
            listAriaLabel="Nevn medlem"
            inputRef={chatInputRef}
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
