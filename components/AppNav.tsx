'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_LINKS = [
  { href: '/chat', label: 'Chat' },
  { href: '/predictions', label: 'Predictions' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/my-results', label: 'My Results' },
  { href: '/leagues', label: 'Leagues' },
  { href: '/profile', label: 'Profile' },
] as const

type AppNavProps = {
  className?: string
}

export function AppNav({ className = '' }: AppNavProps) {
  const pathname = usePathname()

  return (
    <nav
      className={`rounded-xl border border-slate-200 bg-white p-2 shadow-sm ${className}`}
      aria-label="Hovedmeny"
    >
      <ul className="flex gap-1 overflow-x-auto py-0.5 [-ms-overflow-style:none] [scrollbar-width:none] sm:flex-wrap sm:justify-center [&::-webkit-scrollbar]:hidden">
        {NAV_LINKS.map(({ href, label }) => {
          const active =
            href === '/leaderboard'
              ? pathname === '/leaderboard' ||
                /\/league\/[^/]+\/leaderboard\/?$/.test(pathname)
              : pathname === href
          return (
            <li key={href} className="shrink-0">
              <Link
                href={href}
                prefetch
                className={
                  active
                    ? 'block whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white'
                    : 'block whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100'
                }
              >
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
