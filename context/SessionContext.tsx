'use client'

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export interface PassInfo {
  code: string
  title: string
  type: string
  localiza: string
  start: string   // dd/mm/yyyy
  end: string     // dd/mm/yyyy
  active: boolean
}

export type PassStatus = 'active' | 'upcoming' | 'expired' | 'unknown'

export function getPassStatus(pass: Pick<PassInfo, 'start' | 'end' | 'active'>): PassStatus {
  const parse = (value: string) => {
    const [day, month, year] = value.split('/').map(Number)
    if (!day || !month || !year) return null
    const date = new Date(year, month - 1, day)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const start = parse(pass.start)
  const end = parse(pass.end)
  if (!start || !end) return pass.active ? 'active' : 'unknown'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (today < start) return 'upcoming'
  if (today > end) return 'expired'
  return 'active'
}

export interface RouteConfig {
  originName: string
  originCode: string
  destinationName: string
  destinationCode: string
}

interface SessionState {
  cookie: string
  passes: PassInfo[]
  selectedPassCode?: string
  selectedDates?: string[]
  route?: RouteConfig
  trainSelections?: Record<string, string>  // date -> departure "07.27"
}

interface SessionContextValue {
  session: SessionState | null
  setSession: (s: SessionState) => void
  updateSession: (patch: Partial<SessionState>) => void
  clearSession: () => void
}

const STORAGE_KEY = 'renfent_session'

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<SessionState | null>(null)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      if (raw) setSessionState(JSON.parse(raw))
    } catch {}
  }, [])

  function persist(s: SessionState | null) {
    try {
      if (s) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s))
      else sessionStorage.removeItem(STORAGE_KEY)
    } catch {}
  }

  function setSession(s: SessionState) {
    setSessionState(s)
    persist(s)
  }

  function updateSession(patch: Partial<SessionState>) {
    setSessionState(prev => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      persist(next)
      return next
    })
  }

  function clearSession() {
    setSessionState(null)
    persist(null)
  }

  return (
    <SessionContext.Provider value={{ session, setSession, updateSession, clearSession }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}
