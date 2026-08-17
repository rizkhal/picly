import { useEffect, useState } from 'react'

export type ThemeMode = 'system' | 'dark' | 'light'
export type ResolvedTheme = 'dark' | 'light'

const THEME_KEY = 'picly:theme'

function getStoredMode(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY)
    if (v === 'system' || v === 'dark' || v === 'light') return v
  } catch { /* ignore */ }
  return 'system'
}

function getSystemTheme(): ResolvedTheme {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'dark'
  }
}

function resolve(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? getSystemTheme() : mode
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(getStoredMode)
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(getStoredMode()))

  // Persist the user's choice so a reload keeps the same theme.
  useEffect(() => {
    try { localStorage.setItem(THEME_KEY, mode) } catch { /* ignore */ }
  }, [mode])

  // Apply the resolved theme and follow the OS when in "system" mode.
  useEffect(() => {
    const apply = () => {
      const r = resolve(mode)
      setResolved(r)
      document.documentElement.dataset.theme = r
    }
    apply()
    if (mode === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const onChange = () => apply()
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    }
  }, [mode])

  return { theme: mode, resolvedTheme: resolved, setTheme: setMode }
}
