'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { GlobalChatPanel } from '@/components/GlobalChatPanel'

const MD_MEDIA = '(min-width: 768px)'
const STORAGE_EXPANDED = '500ligaen-global-chat-widget-expanded'

/**
 * Desktop-only global chat dock. League routes use the league chat dock instead (see LeagueChatDockProvider).
 * Excludes `/leagues` (embedded preview) and `/chat` (full page).
 */
function pathnameAllowsFloatingWidget(pathname: string | null): boolean {
  if (!pathname) return false
  const prefixes = [
    '/admin',
    '/profile',
    '/leaderboard',
    '/my-results',
    '/predictions',
  ]
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export function GlobalChatFloatingWidget() {
  const pathname = usePathname()
  const [isDesktop, setIsDesktop] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia(MD_MEDIA)
    const sync = () => setIsDesktop(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    try {
      if (sessionStorage.getItem(STORAGE_EXPANDED) === '1') {
        setExpanded(true)
      }
    } catch {
      /* private mode / SSR */
    }
  }, [])

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_EXPANDED, expanded ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [expanded])

  if (!isDesktop || !pathnameAllowsFloatingWidget(pathname)) {
    return null
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="fixed bottom-5 right-5 z-[80] flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg ring-2 ring-white/10 transition hover:bg-slate-800 hover:ring-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2"
        aria-label="Åpne global chat"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.75}
          stroke="currentColor"
          className="h-7 w-7"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
      </button>
    )
  }

  return (
    <div
      className="fixed bottom-5 right-5 z-[80] flex h-[min(72vh,28rem)] w-[min(22rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl ring-1 ring-slate-900/10"
      role="dialog"
      aria-label="Global chat"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-800 bg-slate-900 px-3 py-2.5 text-white">
        <span className="truncate text-sm font-semibold tracking-tight">Global chat</span>
        <div className="flex shrink-0 items-center gap-1">
          <Link
            href="/chat"
            className="rounded-md px-2 py-1 text-xs font-medium text-white/90 underline-offset-2 hover:bg-white/10 hover:text-white"
          >
            Åpne full
          </Link>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="rounded-md p-1.5 text-white/90 hover:bg-white/10 hover:text-white"
            aria-label="Minimer global chat"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="h-5 w-5"
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <GlobalChatPanel
          previewMessageLimit={35}
          compactLayout
          inputId="global-chat-widget-input"
          clearConfirmFieldId="global-chat-widget-clear-confirm"
        />
      </div>
    </div>
  )
}
