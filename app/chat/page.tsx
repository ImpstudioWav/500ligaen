'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { AppNav } from '@/components/AppNav'
import { GlobalChatPanel } from '@/components/GlobalChatPanel'

export default function GlobalChatPage() {
  const router = useRouter()

  useEffect(() => {
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

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto w-full max-w-md space-y-3">
        <AppNav />

        <p className="text-sm">
          <Link href="/leagues" className="font-medium text-slate-900 underline">
            Tilbake til ligaer
          </Link>
        </p>

        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-5">
          <div className="shrink-0 border-b border-slate-100 pb-3">
            <h1 className="text-lg font-semibold text-slate-900">500ligaen Chat</h1>
            <p className="text-xs text-slate-500">Global chat</p>
          </div>

          <div className="mt-4">
            <GlobalChatPanel />
          </div>
        </div>
      </div>
    </main>
  )
}
