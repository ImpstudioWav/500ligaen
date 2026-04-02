'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_LINKS = [
  { href: '/leagues', label: 'Leagues' },
  { href: '/profile', label: 'Profile' },
] as const

type NavHref = (typeof NAV_LINKS)[number]['href']

function isNavActive(pathname: string, href: NavHref): boolean {
  if (href === '/leagues') {
    return pathname === '/leagues' || pathname.startsWith('/league/')
  }
  return pathname === href
}

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
          const active = isNavActive(pathname, href)
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
