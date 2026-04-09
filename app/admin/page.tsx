'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AppNav } from '@/components/AppNav'
import { AdminChatPanel } from '@/components/AdminChatPanel'
import { supabase } from '@/lib/supabase'
import { getProfileByUserId, profileHasUsername, shortenUserId } from '@/lib/profiles'

type LeagueRow = {
  id: string
  name: string | null
  status: string | number | null
  join_code: string | null
  prediction_open_at: string | null
  prediction_close_at: string | null
}

type MemberRow = {
  league_id: string
  user_id: string
}

type ProfileRow = {
  id: string
  username: string | null
  is_admin: boolean | null
  created_at: string | null
}

function formatPredictionAt(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('nb-NO', { dateStyle: 'short', timeStyle: 'short' })
}

export default function AdminOverviewPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [leagues, setLeagues] = useState<LeagueRow[]>([])
  const [members, setMembers] = useState<MemberRow[]>([])
  const [profiles, setProfiles] = useState<ProfileRow[]>([])
  const [userSearch, setUserSearch] = useState('')
  const [emailsByUserId, setEmailsByUserId] = useState<Record<string, string>>({})
  const [emailsError, setEmailsError] = useState('')
  const [copiedUserId, setCopiedUserId] = useState<string | null>(null)
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** League id -> member list expanded */
  const [membersExpanded, setMembersExpanded] = useState<Record<string, boolean>>({})
  /** League id -> card details expanded (compact by default) */
  const [leagueCardExpanded, setLeagueCardExpanded] = useState<Record<string, boolean>>({})
  const [deletePanelLeagueId, setDeletePanelLeagueId] = useState<string | null>(null)
  const [deleteTypeConfirm, setDeleteTypeConfirm] = useState('')
  const [deleteCardError, setDeleteCardError] = useState('')
  const [deletingLeagueId, setDeletingLeagueId] = useState<string | null>(null)
  const [leagueDeleteSuccess, setLeagueDeleteSuccess] = useState('')

  useEffect(() => {
    return () => {
      if (copyResetRef.current) {
        clearTimeout(copyResetRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const load = async () => {
      setError('')

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        router.replace('/login')
        return
      }

      const profile = await getProfileByUserId(user.id)
      if (!profileHasUsername(profile)) {
        router.replace('/complete-profile')
        return
      }

      if (!profile.is_admin) {
        router.replace('/leagues')
        return
      }

      const [leaguesRes, membersRes, profilesRes] = await Promise.all([
        supabase
          .from('leagues')
          .select('id, name, status, join_code, prediction_open_at, prediction_close_at')
          .order('name', { ascending: true }),
        supabase.from('league_members').select('league_id, user_id'),
        supabase
          .from('profiles')
          .select('id, username, is_admin, created_at')
          .order('username', { ascending: true }),
      ])

      if (leaguesRes.error) {
        setError(leaguesRes.error.message)
        setLoading(false)
        return
      }
      if (membersRes.error) {
        setError(membersRes.error.message)
        setLoading(false)
        return
      }
      if (profilesRes.error) {
        setError(profilesRes.error.message)
        setLoading(false)
        return
      }

      setLeagues((leaguesRes.data ?? []) as LeagueRow[])
      setMembers((membersRes.data ?? []) as MemberRow[])
      setProfiles((profilesRes.data ?? []) as ProfileRow[])

      setEmailsError('')
      setEmailsByUserId({})
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const accessToken = session?.access_token
      if (accessToken) {
        try {
          const emailRes = await fetch('/api/admin/user-emails', {
            headers: { Authorization: `Bearer ${accessToken}` },
          })
          const emailPayload = (await emailRes.json().catch(() => ({}))) as {
            error?: string
            emailsById?: Record<string, string>
          }
          if (emailRes.ok && emailPayload.emailsById && typeof emailPayload.emailsById === 'object') {
            setEmailsByUserId(emailPayload.emailsById)
          } else {
            setEmailsError(emailPayload.error || 'Kunne ikke laste e-post.')
          }
        } catch {
          setEmailsError('Kunne ikke laste e-post.')
        }
      }

      setLoading(false)
    }

    void load()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        router.replace('/login')
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [router])

  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles])

  const stats = useMemo(
    () => ({
      leagues: leagues.length,
      users: profiles.length,
      admins: profiles.filter((p) => p.is_admin === true).length,
    }),
    [leagues, profiles]
  )

  const filteredProfiles = useMemo(() => {
    const q = userSearch.trim().toLowerCase()
    const list =
      q === ''
        ? [...profiles]
        : profiles.filter((p) => (p.username ?? '').toLowerCase().includes(q))

    const sortLabel = (p: ProfileRow) =>
      (p.username?.trim() || shortenUserId(p.id)).toLowerCase()

    list.sort((a, b) => {
      const aAdmin = a.is_admin === true ? 1 : 0
      const bAdmin = b.is_admin === true ? 1 : 0
      if (aAdmin !== bAdmin) return bAdmin - aAdmin
      return sortLabel(a).localeCompare(sortLabel(b), 'nb')
    })

    return list
  }, [profiles, userSearch])

  const handleCopyEmail = async (uid: string, email: string) => {
    try {
      await navigator.clipboard.writeText(email)
      if (copyResetRef.current) {
        clearTimeout(copyResetRef.current)
      }
      setCopiedUserId(uid)
      copyResetRef.current = setTimeout(() => {
        setCopiedUserId(null)
        copyResetRef.current = null
      }, 2000)
    } catch {
      // Clipboard unavailable
    }
  }

  const openDeletePanel = (leagueId: string) => {
    setDeletePanelLeagueId(leagueId)
    setDeleteTypeConfirm('')
    setDeleteCardError('')
    setLeagueCardExpanded((prev) => ({ ...prev, [leagueId]: true }))
  }

  const closeDeletePanel = () => {
    setDeletePanelLeagueId(null)
    setDeleteTypeConfirm('')
    setDeleteCardError('')
  }

  const handleConfirmDeleteLeague = async (leagueId: string, leagueDisplayName: string) => {
    if (deleteTypeConfirm !== 'DELETE') return

    const ok = window.confirm(
      `Slette «${leagueDisplayName}»?\n\nLigaen og all tilhørende data (medlemmer, meldinger, prediksjoner, poeng m.m.) blir permanent slettet. Dette kan ikke angres.`
    )
    if (!ok) return

    setDeleteCardError('')
    setDeletingLeagueId(leagueId)

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) {
        setDeleteCardError('Fant ikke innlogging. Prøv å logge inn på nytt.')
        setDeletingLeagueId(null)
        return
      }

      const res = await fetch('/api/admin/delete-league', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ leagueId }),
      })

      const payload = (await res.json().catch(() => ({}))) as { error?: string }

      if (!res.ok) {
        setDeleteCardError(payload.error || `Kunne ikke slette (HTTP ${res.status}).`)
        setDeletingLeagueId(null)
        return
      }

      setLeagues((prev) => prev.filter((l) => l.id !== leagueId))
      setMembers((prev) => prev.filter((m) => m.league_id !== leagueId))
      setMembersExpanded((prev) => {
        const next = { ...prev }
        delete next[leagueId]
        return next
      })
      setLeagueCardExpanded((prev) => {
        const next = { ...prev }
        delete next[leagueId]
        return next
      })
      closeDeletePanel()
      setLeagueDeleteSuccess(`«${leagueDisplayName}» ble slettet.`)
      window.setTimeout(() => {
        setLeagueDeleteSuccess('')
      }, 5000)
    } catch {
      setDeleteCardError('Nettverksfeil ved sletting. Prøv igjen.')
    } finally {
      setDeletingLeagueId(null)
    }
  }

  const leaguesWithMembers = useMemo(() => {
    return leagues.map((league) => {
      const leagueMemberRows = members.filter((m) => m.league_id === league.id)
      const memberProfiles = leagueMemberRows
        .map((m) => profileById.get(m.user_id))
        .filter((p): p is ProfileRow => p != null)
        .sort((a, b) =>
          (a.username ?? shortenUserId(a.id)).localeCompare(b.username ?? shortenUserId(b.id), 'nb')
        )
      return { league, memberProfiles, memberCount: leagueMemberRows.length }
    })
  }, [leagues, members, profileById])

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <AppNav />

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Admin — oversikt</h1>
            <p className="mt-1 text-sm text-slate-600">Samlet oversikt over ligaer og brukere.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/leagues"
              prefetch
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50"
            >
              Til ligaer
            </Link>
            <Link
              href="/admin/leagues/new"
              prefetch
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50"
            >
              Ny liga
            </Link>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">Laster...</p>
        ) : error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : (
          <>
            <section aria-label="Statistikk" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Ligaer</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{stats.leagues}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Brukere</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{stats.users}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Admins</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{stats.admins}</p>
              </div>
            </section>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-stretch">
              <div className="min-w-0 lg:col-span-7 lg:min-h-0">
                <section aria-label="Ligaer">
                  <h2 className="text-sm font-semibold text-slate-900">Ligaer</h2>
                  {leagueDeleteSuccess ? (
                    <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                      {leagueDeleteSuccess}
                    </p>
                  ) : null}
                  <div className="mt-3 space-y-2">
                    {leaguesWithMembers.length === 0 ? (
                      <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                        Ingen ligaer ennå.
                      </p>
                    ) : (
                      leaguesWithMembers.map(({ league, memberProfiles, memberCount }) => {
                        const detailsOpen = leagueCardExpanded[league.id] === true
                        return (
                          <article
                            key={league.id}
                            className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-200/80"
                          >
                            <div className="flex flex-wrap items-center gap-2 p-2.5 sm:gap-3 sm:px-3 sm:py-2">
                              <div className="min-w-0 flex-1">
                                <h3 className="truncate text-sm font-semibold text-slate-900">
                                  {league.name?.trim() || 'Uten navn'}
                                </h3>
                                <p className="text-[11px] text-slate-500">
                                  {memberCount} medlem{memberCount === 1 ? '' : 'mer'}
                                </p>
                              </div>
                              <button
                                type="button"
                                aria-expanded={detailsOpen}
                                aria-controls={`league-details-${league.id}`}
                                id={`league-details-toggle-${league.id}`}
                                onClick={() => {
                                  if (detailsOpen && deletePanelLeagueId === league.id) {
                                    closeDeletePanel()
                                  }
                                  setLeagueCardExpanded((prev) => ({
                                    ...prev,
                                    [league.id]: !detailsOpen,
                                  }))
                                }}
                                className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-800 transition hover:bg-slate-100 active:bg-slate-100"
                              >
                                {detailsOpen ? 'Skjul detaljer' : 'Vis detaljer'}
                              </button>
                            </div>

                            {detailsOpen ? (
                              <div
                                id={`league-details-${league.id}`}
                                role="region"
                                aria-labelledby={`league-details-toggle-${league.id}`}
                                className="border-t border-slate-100"
                              >
                                <div className="space-y-3 p-3 sm:p-4">
                                  <p className="text-xs text-slate-600">
                                    Status:{' '}
                                    <span className="font-medium text-slate-800">
                                      {league.status != null ? String(league.status) : '—'}
                                    </span>
                                    {' · '}
                                    Ligakode:{' '}
                                    <span className="font-mono font-semibold text-slate-900">
                                      {league.join_code?.trim() || '—'}
                                    </span>
                                  </p>
                                  <dl className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                                    <div>
                                      <dt className="text-slate-500">Prediction åpner</dt>
                                      <dd className="font-medium text-slate-800">
                                        {formatPredictionAt(league.prediction_open_at)}
                                      </dd>
                                    </div>
                                    <div>
                                      <dt className="text-slate-500">Prediction stenger</dt>
                                      <dd className="font-medium text-slate-800">
                                        {formatPredictionAt(league.prediction_close_at)}
                                      </dd>
                                    </div>
                                  </dl>
                                  <div className="flex flex-wrap gap-2">
                                    <Link
                                      href={`/league/${league.id}`}
                                      prefetch
                                      className="inline-flex rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:bg-slate-100"
                                    >
                                      Åpne liga
                                    </Link>
                                    <button
                                      type="button"
                                      onClick={() => openDeletePanel(league.id)}
                                      className="inline-flex rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-800 transition hover:border-red-300 hover:bg-red-100"
                                    >
                                      Slett liga
                                    </button>
                                  </div>

                                  {deletePanelLeagueId === league.id ? (
                                    <div className="space-y-3 rounded-lg border border-red-200/90 bg-red-50/50 p-3 sm:p-4">
                                      <p className="text-xs leading-relaxed text-red-950/85">
                                        Du sletter <strong>{league.name?.trim() || 'ligaen'}</strong>. Ligaen og
                                        all tilhørende data slettes permanent (medlemmer, meldinger,
                                        prediksjoner, poeng m.m. via databasens sletteregler). Dette kan ikke
                                        angres.
                                      </p>
                                      <div>
                                        <label
                                          htmlFor={`admin-delete-league-${league.id}`}
                                          className="mb-1 block text-xs font-medium text-red-950/90"
                                        >
                                          Bekreft ved å skrive{' '}
                                          <span className="font-mono font-semibold">DELETE</span> (store
                                          bokstaver)
                                        </label>
                                        <input
                                          id={`admin-delete-league-${league.id}`}
                                          type="text"
                                          autoComplete="off"
                                          value={deleteTypeConfirm}
                                          onChange={(e) => {
                                            setDeleteTypeConfirm(e.target.value)
                                            if (deleteCardError) setDeleteCardError('')
                                          }}
                                          disabled={deletingLeagueId === league.id}
                                          placeholder="DELETE"
                                          className="w-full rounded-lg border border-red-200 bg-white px-2.5 py-2 font-mono text-sm text-slate-900 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100 disabled:opacity-60"
                                        />
                                      </div>
                                      {deleteCardError ? (
                                        <p className="rounded-md bg-red-100 px-2.5 py-1.5 text-xs text-red-800">
                                          {deleteCardError}
                                        </p>
                                      ) : null}
                                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                                        <button
                                          type="button"
                                          disabled={
                                            deletingLeagueId === league.id ||
                                            deleteTypeConfirm !== 'DELETE'
                                          }
                                          onClick={() =>
                                            void handleConfirmDeleteLeague(
                                              league.id,
                                              league.name?.trim() || 'Liga'
                                            )
                                          }
                                          className="rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-medium text-red-800 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          {deletingLeagueId === league.id
                                            ? 'Sletter...'
                                            : 'Bekreft sletting'}
                                        </button>
                                        <button
                                          type="button"
                                          disabled={deletingLeagueId === league.id}
                                          onClick={closeDeletePanel}
                                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                                        >
                                          Avbryt
                                        </button>
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                                <div className="border-t border-slate-100 bg-slate-50/80 px-3 py-2.5 sm:px-4">
                                  {memberProfiles.length === 0 ? (
                                    <p className="text-xs text-slate-500">Ingen medlemmer.</p>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        aria-expanded={membersExpanded[league.id] === true}
                                        aria-controls={`league-members-${league.id}`}
                                        id={`league-members-toggle-${league.id}`}
                                        onClick={() =>
                                          setMembersExpanded((prev) => ({
                                            ...prev,
                                            [league.id]: !prev[league.id],
                                          }))
                                        }
                                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 sm:w-auto sm:min-w-[11rem]"
                                      >
                                        {membersExpanded[league.id]
                                          ? 'Skjul medlemmer'
                                          : `Medlemmer (${memberCount})`}
                                      </button>
                                      {membersExpanded[league.id] ? (
                                        <ul
                                          id={`league-members-${league.id}`}
                                          role="list"
                                          aria-labelledby={`league-members-toggle-${league.id}`}
                                          className="mt-2 max-h-52 space-y-1.5 overflow-y-auto overscroll-contain rounded-lg border border-slate-200/80 bg-white px-2.5 py-2 sm:max-h-48"
                                        >
                                          {memberProfiles.map((p) => (
                                            <li
                                              key={p.id}
                                              className="flex flex-wrap items-center gap-2 border-b border-slate-100 py-1.5 text-sm text-slate-800 last:border-b-0"
                                            >
                                              <span className="font-medium">
                                                {p.username?.trim() || shortenUserId(p.id)}
                                              </span>
                                              {p.is_admin === true ? (
                                                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-900">
                                                  Admin
                                                </span>
                                              ) : null}
                                            </li>
                                          ))}
                                        </ul>
                                      ) : null}
                                    </>
                                  )}
                                </div>
                              </div>
                            ) : null}
                          </article>
                        )
                      })
                    )}
                  </div>
                </section>
              </div>

              <section
                aria-label="Admin-chat"
                className="min-w-0 w-full shrink-0 lg:col-span-5 lg:self-start"
              >
                <h2 className="text-sm font-semibold text-slate-900">Admin-chat</h2>
                <div className="mt-2">
                  <AdminChatPanel fillColumn />
                </div>
              </section>
            </div>

            <section aria-label="Brukere">
              <h2 className="text-sm font-semibold text-slate-900">Brukere (profiler)</h2>
              <div className="mt-2 space-y-2">
                <div>
                  <label
                    htmlFor="admin-user-search"
                    className="mb-1 block text-xs font-medium text-slate-600"
                  >
                    Søk på brukernavn
                  </label>
                  <input
                    id="admin-user-search"
                    type="search"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    autoComplete="off"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    placeholder="Filtrer listen…"
                  />
                </div>
                {emailsError ? (
                  <p className="text-xs text-amber-800">{emailsError}</p>
                ) : null}
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-200/80">
                  {profiles.length === 0 ? (
                    <p className="p-3 text-xs text-slate-600">Ingen profiler.</p>
                  ) : filteredProfiles.length === 0 ? (
                    <p className="p-3 text-xs text-slate-600">Ingen treff.</p>
                  ) : (
                    <ul
                      className="max-h-[14rem] divide-y divide-slate-100 overflow-y-auto overscroll-contain sm:max-h-[13.5rem]"
                      style={{ WebkitOverflowScrolling: 'touch' }}
                    >
                      {filteredProfiles.map((p) => {
                        const email = emailsByUserId[p.id] ?? ''
                        return (
                          <li key={p.id} className="px-3 py-2">
                            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                  <span className="text-sm font-medium text-slate-900">
                                    {p.username?.trim() || shortenUserId(p.id)}
                                  </span>
                                  {p.is_admin === true ? (
                                    <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-amber-900">
                                      Admin
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-slate-500">Bruker</span>
                                  )}
                                </div>
                                <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-600">
                                  <span className="min-w-0 truncate" title={email || undefined}>
                                    {email || '—'}
                                  </span>
                                  {email ? (
                                    <button
                                      type="button"
                                      onClick={() => void handleCopyEmail(p.id, email)}
                                      className="shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 transition hover:bg-slate-100 active:bg-slate-100"
                                    >
                                      {copiedUserId === p.id ? 'Kopiert!' : 'Kopier'}
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                              <div className="shrink-0 text-[10px] leading-tight text-slate-500 tabular-nums">
                                {p.created_at
                                  ? new Date(p.created_at).toLocaleString('nb-NO', {
                                      day: 'numeric',
                                      month: 'short',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })
                                  : '—'}
                              </div>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
                <p className="text-[10px] text-slate-500">
                  {filteredProfiles.length} av {profiles.length} brukere
                  {userSearch.trim() ? ' (filtrert)' : ''}
                </p>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  )
}
