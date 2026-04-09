'use client'

import {
  type KeyboardEvent,
  type MutableRefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { getActiveMentionState } from '@/lib/leagueMentions'

export type ChatMentionCandidate = { userId: string; username: string }

export type ChatMentionTextFieldProps = {
  id: string
  /** Screen-reader label for the input */
  label: string
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  placeholder?: string
  candidates: ChatMentionCandidate[]
  /**
   * Shown after user-`candidates` in the @ suggestion list (e.g. everyone, admin).
   * Inserted text is still `@${username}` using the handle string.
   */
  specialMentionHandles?: string[]
  /** When @ is active and `candidates` is empty */
  emptyCandidatesHint?: string
  listAriaLabel?: string
  /** Optional ref to the underlying `<input>` (e.g. desktop autofocus from parent panels). */
  inputRef?: MutableRefObject<HTMLInputElement | null>
}

/**
 * Single-line chat input with @mention dropdown (league / global / admin).
 */
const DEFAULT_SPECIAL_MENTIONS = ['everyone', 'admin']

export function ChatMentionTextField({
  id,
  label,
  value,
  onChange,
  disabled,
  placeholder,
  candidates,
  specialMentionHandles = DEFAULT_SPECIAL_MENTIONS,
  emptyCandidatesHint = 'Ingen brukere å foreslå.',
  listAriaLabel = 'Nevn bruker',
  inputRef: inputRefProp,
}: ChatMentionTextFieldProps) {
  const [inputCursor, setInputCursor] = useState(0)
  const [mentionHighlight, setMentionHighlight] = useState(0)
  const innerRef = useRef<HTMLInputElement>(null)

  const assignInputRef = useCallback((node: HTMLInputElement | null) => {
    innerRef.current = node
    if (inputRefProp) {
      inputRefProp.current = node
    }
  }, [inputRefProp])

  useLayoutEffect(() => {
    const el = innerRef.current
    if (!el || document.activeElement !== el) return
    const p = el.selectionStart ?? el.value.length
    setInputCursor((prev) => (p !== prev ? p : prev))
  }, [value])

  const mentionState = useMemo(
    () => getActiveMentionState(value, inputCursor),
    [value, inputCursor]
  )

  const mergedCandidates = useMemo(() => {
    const specials: ChatMentionCandidate[] = specialMentionHandles.map((handle) => ({
      userId: `__special_${handle}`,
      username: handle,
    }))
    return [...specials, ...candidates]
  }, [specialMentionHandles, candidates])

  const mentionSuggestions = useMemo(() => {
    if (!mentionState) return []
    const q = mentionState.query.toLowerCase()
    if (q.length === 0) return mergedCandidates.slice(0, 8)
    return mergedCandidates
      .filter((m) => m.username.toLowerCase().includes(q))
      .slice(0, 8)
  }, [mentionState, mergedCandidates])

  useEffect(() => {
    setMentionHighlight(0)
  }, [mentionState?.atIndex, mentionState?.query, mentionSuggestions.length])

  const insertMentionUsername = useCallback(
    (username: string) => {
      const ms = getActiveMentionState(value, inputCursor)
      if (!ms) return
      const before = value.slice(0, ms.atIndex)
      const after = value.slice(inputCursor)
      const ins = `@${username} `
      const next = before + ins + after
      const newCursor = before.length + ins.length
      onChange(next)
      setInputCursor(newCursor)
      requestAnimationFrame(() => {
        const el = innerRef.current
        if (el) {
          el.focus()
          el.setSelectionRange(newCursor, newCursor)
        }
      })
    },
    [value, inputCursor, onChange]
  )

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && mentionState) {
      e.preventDefault()
      const ms = mentionState
      const before = value.slice(0, ms.atIndex)
      const after = value.slice(inputCursor)
      const next = before + after
      const nc = ms.atIndex
      onChange(next)
      setInputCursor(nc)
      requestAnimationFrame(() => {
        const el = innerRef.current
        if (el) el.setSelectionRange(nc, nc)
      })
      return
    }

    if (!mentionState) return

    if (e.key === 'ArrowDown' && mentionSuggestions.length > 0) {
      e.preventDefault()
      setMentionHighlight((i) => (i + 1) % mentionSuggestions.length)
      return
    }
    if (e.key === 'ArrowUp' && mentionSuggestions.length > 0) {
      e.preventDefault()
      setMentionHighlight((i) => (i - 1 + mentionSuggestions.length) % mentionSuggestions.length)
      return
    }
    if (e.key === 'Enter' && mentionSuggestions.length > 0) {
      e.preventDefault()
      const pick = mentionSuggestions[mentionHighlight]
      if (pick) insertMentionUsername(pick.username)
    }
  }

  return (
    <div className="relative z-20 min-w-0 flex-1 overflow-visible">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        ref={assignInputRef}
        id={id}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setInputCursor(e.target.selectionStart ?? e.target.value.length)
        }}
        onSelect={(e) => {
          const t = e.currentTarget
          setInputCursor(t.selectionStart ?? t.value.length)
        }}
        onClick={(e) => {
          setInputCursor(e.currentTarget.selectionStart ?? e.currentTarget.value.length)
        }}
        onKeyUp={(e) => {
          setInputCursor(e.currentTarget.selectionStart ?? e.currentTarget.value.length)
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        className="relative z-10 w-full min-w-0 rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
        disabled={disabled}
      />
      {mentionState ? (
        <ul
          className="absolute bottom-full left-0 right-0 z-[100] mb-1 max-h-36 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
          role="listbox"
          aria-label={listAriaLabel}
        >
          {mergedCandidates.length === 0 ? (
            <li className="px-3 py-2 text-xs text-slate-500">{emptyCandidatesHint}</li>
          ) : mentionSuggestions.length === 0 ? (
            <li className="px-3 py-2 text-xs text-slate-500">Ingen treff</li>
          ) : (
            mentionSuggestions.map((m, idx) => {
              const active = idx === mentionHighlight
              return (
                <li key={m.userId} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`flex w-full px-3 py-1.5 text-left text-sm transition-colors ${
                      active
                        ? 'bg-slate-200 font-medium text-slate-900'
                        : 'text-slate-800 hover:bg-slate-100'
                    }`}
                    onMouseDown={(ev) => ev.preventDefault()}
                    onMouseEnter={() => setMentionHighlight(idx)}
                    onClick={() => insertMentionUsername(m.username)}
                  >
                    @{m.username}
                  </button>
                </li>
              )
            })
          )}
        </ul>
      ) : null}
    </div>
  )
}
