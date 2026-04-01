import Link from 'next/link'

export default function CheckEmailPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
        <p className="text-base text-slate-900">
          Sjekk e-posten din for å bekrefte kontoen.
        </p>
        <p className="mt-4 text-center text-sm text-slate-600">
          <Link href="/login" className="font-medium text-slate-900 underline">
            Tilbake til innlogging
          </Link>
        </p>
      </div>
    </main>
  )
}
