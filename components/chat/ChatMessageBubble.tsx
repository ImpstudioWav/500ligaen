'use client'

import { useEffect, useRef, useState } from 'react'
import type { RepliedToPayload } from '@/lib/chatReplyPreview'

type ChatMessageBubbleProps = {
  content: string
  usernameLabel: string
  isAdmin?: boolean
  createdAtLabel: string
  /** `true` when `message.user_id` matches the logged-in user */
  isOwn: boolean
  /** Parent message summary when this row is a reply (UI only). */
  repliedTo?: RepliedToPayload
  onDelete?: () => void
  deletePending?: boolean
  /** Reply to this message (threads into reply_to_* on send). */
  onReply?: () => void
}

function ReplyIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 6 6v3" />
    </svg>
  )
}

function DotsVerticalIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <circle cx="12" cy="5" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="12" cy="19" r="1.75" />
    </svg>
  )
}

/**
 * Messenger-style row (no avatars): replies stack a faded “ghost” preview bubble (parent’s bubble language)
 * under the real bubble with overlap/offset; meta above; actions beside the stack.
 */
export function ChatMessageBubble({
  content,
  usernameLabel,
  isAdmin,
  createdAtLabel,
  isOwn,
  repliedTo,
  onDelete,
  deletePending,
  onReply,
}: ChatMessageBubbleProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuWrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      const el = menuWrapRef.current
      if (el && !el.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  const showActions = isOwn ? Boolean(onDelete) : Boolean(onReply || onDelete)
  const alignHeader = isOwn ? 'items-end' : 'items-start'
  const alignRow = isOwn ? 'justify-end' : 'justify-start'

  const actionsCluster = showActions ? (
    <div className="flex shrink-0 flex-row items-center gap-0.5 pb-px text-slate-500">
      {!isOwn && onReply ? (
        <button
          type="button"
          onClick={onReply}
          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
          aria-label="Svar"
        >
          <ReplyIcon className="h-4 w-4" />
        </button>
      ) : null}
      {onDelete ? (
        <div className="relative" ref={menuWrapRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
            aria-label="Flere handlinger"
            aria-expanded={menuOpen}
            aria-haspopup="true"
          >
            <DotsVerticalIcon className="h-4 w-4" />
          </button>
          {menuOpen ? (
            <ul
              className={`absolute z-20 min-w-[9rem] rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg ring-1 ring-slate-900/5 ${
                isOwn ? 'bottom-full left-0 mb-1' : 'bottom-full right-0 mb-1'
              }`}
              role="menu"
            >
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  disabled={deletePending}
                  className="flex w-full px-3 py-2 text-left text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                  onClick={() => {
                    setMenuOpen(false)
                    onDelete()
                  }}
                >
                  {deletePending ? 'Sletter…' : 'Slett'}
                </button>
              </li>
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  ) : null

  const replySummaryForA11y = repliedTo
    ? `Svar til ${repliedTo.authorLabel}${repliedTo.previewSnippet ? `: ${repliedTo.previewSnippet}` : ''}`
    : undefined

  const previewLine =
    repliedTo?.previewSnippet?.trim() ||
    (repliedTo ? '\u2014' : '')

  const bubbleBlock = repliedTo ? (
    <div
      className={`relative z-0 flex w-fit min-w-0 max-w-full flex-col ${
        isOwn ? 'items-end' : 'items-start'
      }`}
      aria-label={replySummaryForA11y}
    >
      {/* Faded preview bubble (parent message style); sits behind and peeks above the reply */}
      <div
        className={`z-0 w-fit max-w-full min-w-0 ${
          isOwn
            ? 'origin-bottom-right mb-1.5 translate-x-1 scale-[0.93] self-end sm:mb-2 sm:translate-x-1.5'
            : 'origin-bottom-left mb-1.5 -translate-x-1 scale-[0.93] self-start sm:mb-2 sm:-translate-x-1.5'
        } opacity-[0.66]`}
      >
        <div
          className={
            repliedTo.quoteStyle === 'own'
              ? 'rounded-2xl rounded-br-md bg-slate-600/88 px-2 py-1 text-slate-100 shadow-sm ring-1 ring-slate-900/20'
              : 'rounded-2xl rounded-bl-md border border-slate-200/85 bg-white/92 px-2 py-1 text-slate-600 shadow-sm'
          }
        >
          <div className="flex min-w-0 max-w-[min(70vw,18.5rem)] items-center gap-0.5 sm:max-w-[min(66vw,20.5rem)] pt-px">
            <ReplyIcon
              className={`h-2.5 w-2.5 shrink-0 ${
                repliedTo.quoteStyle === 'own' ? 'text-slate-300/85' : 'text-slate-400/90'
              }`}
            />
            <p
              className={`min-w-0 flex-1 truncate text-[11px] font-normal leading-tight ${
                repliedTo.quoteStyle === 'own' ? 'text-slate-100/95' : 'text-slate-600'
              }`}
              title={repliedTo.previewSnippet || undefined}
            >
              {previewLine}
            </p>
          </div>
        </div>
      </div>

      {/* Main reply bubble — same shape language as a normal message, layered in front */}
      <div
        className={
          isOwn
            ? 'relative z-10 w-fit min-w-0 max-w-full rounded-2xl rounded-br-md bg-slate-700 px-3 py-2 text-white shadow-md ring-1 ring-slate-900/10'
            : 'relative z-10 w-fit min-w-0 max-w-full rounded-2xl rounded-bl-md border border-slate-200/90 bg-white px-3 py-2 text-slate-900 shadow-md'
        }
      >
        <p className="max-w-full whitespace-pre-wrap break-words text-sm leading-relaxed">{content}</p>
      </div>
    </div>
  ) : (
    <div
      className={
        isOwn
          ? 'w-fit min-w-0 max-w-full rounded-2xl rounded-br-md bg-slate-700 px-3 py-2 text-white shadow-sm'
          : 'w-fit min-w-0 max-w-full rounded-2xl rounded-bl-md border border-slate-200/90 bg-white px-3 py-2 text-slate-900 shadow-sm'
      }
    >
      <p className="max-w-full whitespace-pre-wrap break-words text-sm leading-relaxed">{content}</p>
    </div>
  )

  return (
    <div className={`flex w-full min-w-0 ${isOwn ? 'justify-end' : 'justify-start'}`}>
      <article
        className={`flex w-fit min-w-0 max-w-[min(75%,22rem)] flex-col gap-1 sm:max-w-[min(72%,24rem)] ${alignHeader}`}
      >
        {/* Sender + time (name only for other users) */}
        <div className={`flex w-full max-w-full flex-col gap-0.5 ${alignHeader}`}>
          <div
            className={`flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 ${alignRow} text-left`}
          >
            {!isOwn ? (
              <span className="text-xs font-semibold leading-tight text-slate-700">{usernameLabel}</span>
            ) : null}
            {isAdmin ? (
              <span className="rounded-full border border-amber-200/90 bg-amber-50 px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-amber-900">
                ADMIN
              </span>
            ) : null}
            <span
              className="text-[10px] font-normal tabular-nums tracking-tight text-slate-400/95"
              title={createdAtLabel}
            >
              {createdAtLabel}
            </span>
          </div>
        </div>

        <div className={`flex w-full max-w-full flex-col ${alignHeader}`}>
          <div
            className={`flex max-w-full min-w-0 flex-row items-end gap-px ${
              isOwn ? 'justify-end' : 'justify-start'
            }`}
          >
            {isOwn ? (
              <>
                {actionsCluster}
                {bubbleBlock}
              </>
            ) : (
              <>
                {bubbleBlock}
                {actionsCluster}
              </>
            )}
          </div>
        </div>
      </article>
    </div>
  )
}
