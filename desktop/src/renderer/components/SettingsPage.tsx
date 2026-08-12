import { useEffect, useState } from 'react'
import type { AuthStatus, UpdateInfo } from '../types'
import * as ipc from '../lib/electron'

type SettingsPageProps = {
  authStatus: AuthStatus
  onLogout: () => void
  onOpenAuth: (mode: 'login' | 'register') => void
  updateInfo: UpdateInfo | null
  updateChecking: boolean
  onCheckUpdate: () => void
  onOpenUpdate: () => void
  onClose: () => void
}

type StoreStats = {
  photos: number
  faces: number
  persons: number
  folders: number
}

export function SettingsPage({ authStatus, onLogout, onOpenAuth, updateInfo, updateChecking, onCheckUpdate, onOpenUpdate, onClose }: SettingsPageProps) {
  const [stats, setStats] = useState<StoreStats | null>(null)

  useEffect(() => {
    ipc.local.stats().then((s: any) => setStats(s || null))
  }, [])

  return (
    <div className="settings-page">
      <div className="settings-header">
        <div className="settings-title">Settings</div>
        <button className="modal-close" onClick={onClose}>×</button>
      </div>

      {/* Account */}
      <section className="settings-section">
        <div className="settings-section-title">Akun</div>
        {authStatus.loggedIn ? (
          <div className="settings-row">
            <div className="settings-row-info">
              <div className="settings-row-label">{authStatus.email}</div>
              <div className="settings-row-hint">Tersambung</div>
            </div>
            <button className="btn" onClick={onLogout}>Logout</button>
          </div>
        ) : (
          <div className="settings-row">
            <div className="settings-row-info">
              <div className="settings-row-label">Belum login</div>
              <div className="settings-row-hint">Akun opsional — semua fitur lokal tetap jalan</div>
            </div>
            <div className="settings-row-actions">
              <button className="btn" onClick={() => onOpenAuth('login')}>Login</button>
              <button className="btn" onClick={() => onOpenAuth('register')}>Register</button>
            </div>
          </div>
        )}
      </section>

      {/* Storage */}
      <section className="settings-section">
        <div className="settings-section-title">Penyimpanan</div>
        {stats ? (
          <div className="settings-stats">
            <div className="stat-cell"><div className="stat-value">{stats.photos}</div><div className="stat-label">Photos</div></div>
            <div className="stat-cell"><div className="stat-value">{stats.faces}</div><div className="stat-label">Faces</div></div>
            <div className="stat-cell"><div className="stat-value">{stats.persons}</div><div className="stat-label">Persons</div></div>
            <div className="stat-cell"><div className="stat-value">{stats.folders}</div><div className="stat-label">Folders</div></div>
          </div>
        ) : (
          <div className="settings-row-hint">Memuat…</div>
        )}
      </section>

      {/* Update */}
      <section className="settings-section">
        <div className="settings-section-title">Update</div>
        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">
              Versi {updateInfo?.current || '—'}
              {updateInfo?.available && updateInfo?.latest && (
                <span className="update-chip">Update tersedia: {updateInfo.latest}</span>
              )}
            </div>
            <div className="settings-row-hint">
              {updateChecking ? 'Mengecek update…' : (
                updateInfo?.available
                  ? (updateInfo.notes?.length ?? 0) > 0
                    ? updateInfo.notes!.join(' · ')
                    : 'Versi baru tersedia.'
                  : updateInfo?.error
                    ? `Gagal cek update (${updateInfo.error})`
                    : 'Aplikasi sudah versi terbaru.'
              )}
            </div>
          </div>
          <div className="settings-row-actions">
            {updateInfo?.available && updateInfo?.url && (
              <button className="btn" onClick={onOpenUpdate}>Buka halaman</button>
            )}
            <button className="btn" onClick={onCheckUpdate} disabled={updateChecking}>
              {updateChecking ? 'Mengecek…' : 'Cek update'}
            </button>
          </div>
        </div>
      </section>

      {/* About */}
      <section className="settings-section">
        <div className="settings-section-title">Tentang</div>
        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">Picly</div>
            <div className="settings-row-hint">
              Pengelola foto lokal — face recognition via ONNX (buffalo_l), semua data di perangkat.
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
