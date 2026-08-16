import { useCallback, useEffect, useState } from 'react'
import type { AuthStatus, UpdateInfo } from '../types'
import * as ipc from '../lib/electron'

export function useAuth() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>({ loggedIn: false, email: null })
  const [authModal, setAuthModal] = useState<'login' | 'register' | null>(null)
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  // Update state (Fase 3: in-app update banner)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [updateDismissed, setUpdateDismissed] = useState(false)
  const [updateChecking, setUpdateChecking] = useState(false)

  // Load persisted auth status on mount
  useEffect(() => {
    ipc.auth.status().then((s) => setAuthStatus(s))
  }, [])

  const submitAuth = useCallback(async (mode: 'login' | 'register') => {
    if (!authEmail || !authPassword) {
      setAuthError('Email and password are required.')
      return
    }
    setAuthBusy(true)
    setAuthError(null)
    try {
      const res = mode === 'login'
        ? await ipc.auth.login(authEmail, authPassword)
        : await ipc.auth.register(authEmail, authPassword)
      if (res?.ok) {
        setAuthStatus({ loggedIn: true, email: res.email || authEmail })
        setAuthModal(null)
        setAuthEmail('')
        setAuthPassword('')
      } else {
        setAuthError(res?.error || 'Failed. Try again.')
      }
    } catch (e: any) {
      setAuthError(e?.message || String(e))
    } finally {
      setAuthBusy(false)
    }
  }, [authEmail, authPassword])

  const handleLogout = useCallback(async () => {
    await ipc.auth.logout()
    setAuthStatus({ loggedIn: false, email: null })
  }, [])

  // Fase 3: check for an update on startup (backend serves the manifest)
  const checkForUpdate = useCallback(async (silent = false) => {
    setUpdateChecking(true)
    try {
      const res = await ipc.update.check()
      setUpdateInfo(res)
      setUpdateDismissed(false)
      if (!silent && res?.error) console.warn('Update check failed:', res.error)
    } finally {
      setUpdateChecking(false)
    }
  }, [])

  const openUpdatePage = useCallback(async () => {
    if (!updateInfo?.url) return
    await ipc.update.openPage(updateInfo.url)
  }, [updateInfo])

  return {
    authStatus,
    setAuthStatus,
    authModal,
    setAuthModal,
    authEmail,
    setAuthEmail,
    authPassword,
    setAuthPassword,
    authBusy,
    authError,
    setAuthError,
    updateInfo,
    updateDismissed,
    setUpdateDismissed,
    updateChecking,
    submitAuth,
    handleLogout,
    checkForUpdate,
    openUpdatePage,
  }
}
