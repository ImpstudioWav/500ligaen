'use client'

import { useEffect, useState } from 'react'

export default function Home() {
  const [authErrorMessage, setAuthErrorMessage] = useState('')

  useEffect(() => {
    const url = new URL(window.location.href)
    const queryErrorCode = url.searchParams.get('error_code')
    const queryDescription = url.searchParams.get('error_description')?.toLowerCase() ?? ''
    const hashParams = new URLSearchParams(window.location.hash.replace('#', ''))
    const hashErrorCode = hashParams.get('error_code')
    const hashDescription = hashParams.get('error_description')?.toLowerCase() ?? ''

    const hasExpiredOrInvalidLink =
      queryErrorCode === 'otp_expired' ||
      hashErrorCode === 'otp_expired' ||
      queryDescription.includes('invalid') ||
      queryDescription.includes('expired') ||
      hashDescription.includes('invalid') ||
      hashDescription.includes('expired')

    if (hasExpiredOrInvalidLink) {
      setAuthErrorMessage('Bekreftelseslenken er ugyldig eller utløpt. Be om en ny e-post.')
    }
  }, [])

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <h1 className="text-3xl font-bold">500ligaen er i gang 🚀</h1>
        {authErrorMessage ? (
          <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {authErrorMessage}
          </p>
        ) : null}
      </div>
    </main>
  )
}