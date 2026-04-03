'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { getProfileByUserId } from '@/lib/profiles'

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
      className={`rounded-xl border border-slate-200 bg-white p-2 shadow-sm ${className}`}
      aria-label="Hovedmeny"
    >
      <ul className="flex gap-1 overflow-x-auto py-0.5 [-ms-overflow-style:none] [scrollbar-width:none] sm:flex-wrap sm:justify-center [&::-webkit-scrollbar]:hidden">
        {links.map(({ href, label }) => {
          const active = isLinkActive(pathname, href)
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
