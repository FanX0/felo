import { FormEvent, type ReactElement } from 'react'
import { X, ClipboardPaste, Loader2, AlertCircle } from 'lucide-react'
import { sanitizeCodeInput } from '../utils'

interface JoinCodeModalProps {
  isOpen: boolean
  onClose: () => void
  joinCodeInput: string
  setJoinCodeInput: (code: string) => void
  onSubmit: (e: FormEvent) => void
  busy: boolean
  error?: string | null
}

export default function JoinCodeModal({
  isOpen,
  onClose,
  joinCodeInput,
  setJoinCodeInput,
  onSubmit,
  busy,
  error
}: JoinCodeModalProps): ReactElement | null {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 sm:p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-text">Join with Room Code</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-text-muted hover:bg-hover hover:text-text cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-xs text-text-muted">
          Enter the 6-character room code shared by your friend.
        </p>

        <div className="relative mt-4">
          <input
            type="text"
            required
            maxLength={128}
            placeholder="e.g. AB12CD"
            value={joinCodeInput}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            onChange={(e) => setJoinCodeInput(sanitizeCodeInput(e.target.value))}
            className={`h-12 w-full rounded-xl border ${error ? 'border-red-500/80 focus:border-red-500' : 'border-border focus:border-primary'} bg-surface-elevated px-3 pr-10 text-center text-lg font-bold font-mono tracking-widest text-text outline-none transition-colors uppercase`}
          />
          <button
            type="button"
            onClick={async () => {
              try {
                const text = await navigator.clipboard.readText()
                if (text) {
                  setJoinCodeInput(sanitizeCodeInput(text))
                }
              } catch {
                // ignore
              }
            }}
            title="Paste from clipboard"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text cursor-pointer"
          >
            <ClipboardPaste className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-400 animate-in fade-in">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="leading-snug">{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !joinCodeInput.trim()}
          className="mt-5 flex h-11 min-h-[44px] w-full items-center justify-center rounded-xl bg-primary text-xs font-bold text-primary-foreground transition-all hover:bg-primary-hover disabled:opacity-50 cursor-pointer shadow-sm"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Join Session'}
        </button>
      </form>
    </div>
  )
}
