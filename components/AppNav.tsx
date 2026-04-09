'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { getProfileByUserId } from '@/lib/profiles'
import { NavNotifications } from '@/components/NavNotifications'
import { LeagueChatLauncherButton } from '@/components/league/LeagueChatLauncherButton'

type NavLink = {
  href: string
  label: string
}

const BASE_NAV_LINKS: NavLink[] = [
  { href: '/leagues', label: 'Leagues' },
  { href: '/profile', label: 'Profile' },
]

function isLinkActive(pathname: string, href: string): boolean {
  if (href === '/leagues') {
    return pathname === '/leagues' || pathname.startsWith('/league/')
  }
  if (href === '/admin') {
    return pathname === '/admin' || pathname.startsWith('/admin/')
  }
  return pathname === href
}

type AppNavProps = {
  className?: string
}

export function AppNav({ className = '' }: AppNavProps) {
  const pathname = usePathname()
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    let cancelled = false

    const checkAdmin = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (cancelled) return

      if (!user) {
        setIsAdmin(false)
        return
      }

      try {
        const profile = await getProfileByUserId(user.id)
        if (cancelled) return
        setIsAdmin(profile?.is_admin === true)
      } catch {
        if (!cancelled) setIsAdmin(false)
      }
    }

    void checkAdmin()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void checkAdmin()
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  const links: NavLink[] = isAdmin
    ? [...BASE_NAV_LINKS, { href: '/admin', label: 'Admin' }]
    : BASE_NAV_LINKS

  return (
    <nav
      className={`sticky top-0 z-[60] rounded-lg border border-slate-200 bg-white px-1.5 py-0.5 shadow-sm shadow-slate-900/10 ring-1 ring-slate-900/[0.04] sm:rounded-xl sm:p-2 ${className}`}
      aria-label="Hovedmeny"
    >
      {/* Mobile: one horizontal band (scrollable links + icons) to minimize height; sm+ centered wrap */}
      <div className="flex flex-row items-center justify-between gap-1.5 sm:justify-between sm:gap-3">
        <ul className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto py-0 [-ms-overflow-style:none] [scrollbar-width:none] sm:flex-wrap sm:justify-center sm:gap-1 sm:py-0.5 [&::-webkit-scrollbar]:hidden">
          {links.map(({ href, label }) => {
            const active = isLinkActive(pathname, href)
            return (
              <li key={href} className="shrink-0">
                <Link
                  href={href}
                  prefetch
                  className={
                    active
                      ? 'block whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-sm font-medium text-white sm:rounded-lg sm:px-3 sm:py-2'
                      : 'block whitespace-nowrap rounded-md px-2 py-1 text-sm font-medium text-slate-700 transition hover:bg-slate-100 sm:rounded-lg sm:px-3 sm:py-2'
                  }
                >
                  {label}
                </Link>
              </li>
            )
          })}
        </ul>
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <LeagueChatLauncherButton />
          <NavNotifications />
        </div>
      </div>
    </nav>
  )
}
