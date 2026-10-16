import { FormEvent, type ReactElement } from 'react'
import {
  Radio,
  Plus,
  Loader2,
  Users,
  ClipboardPaste,
  Play
} from 'lucide-react'
import { sanitizeCodeInput } from '../utils'

interface LobbyBentoGridProps {
  handleCreateRoom: () => void
  busy: boolean
  joinCodeInput: string
  setJoinCodeInput: (code: string) => void
  handleJoinWithCode: (e: FormEvent) => void
}

export default function LobbyBentoGrid({
  handleCreateRoom,
  busy,
  joinCodeInput,
  setJoinCodeInput,
  handleJoinWithCode
}: LobbyBentoGridProps): ReactElement {
  return (
    <>
      {/* 2-Column Responsive Grid: Host vs Join */}
      <section className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5 animate-fade-in">
        {/* Card 1: Host a Session */}
        <div className="group relative flex flex-col justify-between rounded-2xl border border-border bg-surface-elevated p-5 sm:p-6 shadow-sm transition-all duration-200 hover:border-border/80">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-2xl bg-surface border border-border text-text">
                <Radio className="h-5 w-5 sm:h-6 sm:w-6" />
              </div>
              <span className="rounded-full bg-surface border border-border px-2.5 py-1 text-[10px] font-mono font-bold text-text-muted tracking-wider">
                HOST ROOM
              </span>
            </div>

            <h2 className="mt-4 text-lg sm:text-xl font-bold text-text tracking-tight">
              Start a Listening Room
            </h2>
            <p className="mt-2 text-xs text-text-muted leading-relaxed">
              Create an instant live room for your friends. Broadcast your local music queue or stream your computer's audio with zero driver setup.
            </p>

            {/* Feature bullet list */}
            <ul className="mt-4 space-y-2 border-t border-border pt-3 text-[11px] text-text-muted">
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-text-muted shrink-0" />
                <span>Real-time queue auto-sync & friend join</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-text-muted shrink-0" />
                <span>Lossless WASAPI system audio broadcast</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-text-muted shrink-0" />
                <span>In-room live chat & Discord bot integration</span>
              </li>
            </ul>
          </div>

          <div className="mt-6 pt-4 border-t border-border">
            <button
              type="button"
              onClick={handleCreateRoom}
              disabled={busy}
              className="w-full flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-primary hover:bg-primary-hover text-primary-foreground px-5 py-2.5 text-xs font-bold transition-all shadow-sm cursor-pointer disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 stroke-[2.5]" />}
              <span>Create Room Now</span>
            </button>
          </div>
        </div>

        {/* Card 2: Join with Room Code */}
        <div className="group relative flex flex-col justify-between rounded-2xl border border-border bg-surface-elevated p-5 sm:p-6 shadow-sm transition-all duration-200 hover:border-border/80">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-2xl bg-surface border border-border text-text">
                <Users className="h-5 w-5 sm:h-6 sm:w-6" />
              </div>
              <span className="rounded-full bg-surface border border-border px-2.5 py-1 text-[10px] font-mono font-bold text-text-muted tracking-wider">
                LISTENER ACCESS
              </span>
            </div>

            <h2 className="mt-4 text-lg sm:text-xl font-bold text-text tracking-tight">
              Join with Room Code
            </h2>
            <p className="mt-2 text-xs text-text-muted leading-relaxed">
              Have a 6-character room code from a friend or Discord? Enter it below to sync playback instantly in your browser or desktop.
            </p>

            {/* Helpful tips */}
            <div className="mt-4 rounded-xl border border-border bg-surface p-3 text-[11px] text-text-muted">
              <p className="leading-snug">
                Codes are 6 letters (e.g. <strong className="text-text font-mono">AB12CD</strong>). You can also click or paste invite links.
              </p>
            </div>
          </div>

          <form onSubmit={handleJoinWithCode} className="mt-6 pt-4 border-t border-border">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  maxLength={128}
                  placeholder="ENTER CODE"
                  value={joinCodeInput}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode="text"
                  onChange={(e) => setJoinCodeInput(sanitizeCodeInput(e.target.value))}
                  className="h-11 w-full rounded-xl border border-border bg-surface px-3 pr-10 text-center sm:text-left sm:pl-3.5 text-sm sm:text-base font-bold font-mono tracking-widest text-text outline-none focus:border-primary transition-colors uppercase placeholder:normal-case placeholder:tracking-normal placeholder:font-medium placeholder:text-text-muted/40"
                />
                {/* Quick Paste button from clipboard */}
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText()
                      if (text) {
                        setJoinCodeInput(sanitizeCodeInput(text))
                      }
                    } catch {
                      // ignore if clipboard permissions not granted
                    }
                  }}
                  title="Paste from clipboard"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-text-muted hover:text-text hover:bg-hover transition-colors cursor-pointer"
                >
                  <ClipboardPaste className="h-4 w-4" />
                </button>
              </div>

              <button
                type="submit"
                disabled={busy || !joinCodeInput.trim()}
                className="flex h-11 min-h-[44px] items-center justify-center gap-2 rounded-xl bg-primary hover:bg-primary-hover px-6 text-xs font-bold text-primary-foreground transition-all disabled:opacity-50 cursor-pointer shrink-0 shadow-sm"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
                <span>Join Session</span>
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* Guide: 3 Easy Steps to Join */}
      <section className="mt-8 rounded-2xl border border-border bg-surface-elevated p-5 sm:p-6 shadow-sm animate-fade-in">
        <div className="mb-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">
            How to Join • 3 Steps
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center gap-2.5 mb-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-surface-elevated border border-border text-text font-mono text-xs font-bold">
                1
              </span>
              <h4 className="text-xs font-bold text-text">Get Your 6-Letter Code</h4>
            </div>
            <p className="text-[11px] text-text-muted leading-relaxed">
              Ask your friend for their code (e.g. <strong className="text-text font-mono">XKFRM5</strong>), or type <span className="font-mono text-text bg-surface-elevated px-1 py-0.5 rounded border border-border">/invite</span> or <span className="font-mono text-text bg-surface-elevated px-1 py-0.5 rounded border border-border">/join</span> in Discord.
            </p>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center gap-2.5 mb-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-surface-elevated border border-border text-text font-mono text-xs font-bold">
                2
              </span>
              <h4 className="text-xs font-bold text-text">Enter Code or Click Link</h4>
            </div>
            <p className="text-[11px] text-text-muted leading-relaxed">
              Paste the code into the box above and hit <strong>Join Session</strong>, or click any direct invite link to connect instantly.
            </p>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center gap-2.5 mb-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-surface-elevated border border-border text-text font-mono text-xs font-bold">
                3
              </span>
              <h4 className="text-xs font-bold text-text">Lossless Stereo Playback</h4>
            </div>
            <p className="text-[11px] text-text-muted leading-relaxed">
              You're in! You will immediately hear the host's queue in real-time. Missing tracks stream in lossless quality directly in RAM.
            </p>
          </div>
        </div>
      </section>
    </>
  )
}
