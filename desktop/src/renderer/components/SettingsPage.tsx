import { useEffect, useState } from 'react'
import { User, HardDrives, FaceMask, Brain, Info } from '@phosphor-icons/react'
import type { AuthStatus, LocalModels, UpdateInfo } from '../types'
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
  showSingletons: boolean
  onToggleShowSingletons: () => void
  section: SettingsSectionId
  onSectionChange: (section: SettingsSectionId) => void
}

type StoreStats = {
  photos: number
  faces: number
  persons: number
  folders: number
}

export type SettingsSectionId = 'account' | 'storage' | 'faces' | 'models' | 'about'

function ModelRow({ title, desc, installed, latest }: { title: string; desc: string; installed: string | null; latest?: string | null }) {
  const hasNewer = !!latest && latest !== installed
  return (
    <div className="settings-model-row">
      <div className="settings-model-main">
        <div className="settings-model-title">{title}</div>
        <div className="settings-model-desc">{desc}</div>
      </div>
      <div className="settings-model-meta">
        <div className="settings-model-version">{installed || 'tidak ditemukan'}</div>
        {hasNewer && <div className="settings-model-newer">Terbaru: {latest}</div>}
      </div>
    </div>
  )
}

const MENU: Array<{ id: SettingsSectionId; label: string; icon: React.ReactNode }> = [
  { id: 'account', label: 'Akun', icon: <User size={16} /> },
  { id: 'storage', label: 'Penyimpanan', icon: <HardDrives size={16} /> },
  { id: 'faces', label: 'Wajah', icon: <FaceMask size={16} /> },
  { id: 'models', label: 'Model (ML)', icon: <Brain size={16} /> },
  { id: 'about', label: 'Tentang', icon: <Info size={16} /> },
]

export function SettingsPage({ authStatus, onLogout, onOpenAuth, updateInfo, updateChecking, onCheckUpdate, onOpenUpdate, onClose, showSingletons, onToggleShowSingletons, section, onSectionChange }: SettingsPageProps) {
  const [stats, setStats] = useState<StoreStats | null>(null)
  const [localModels, setLocalModels] = useState<LocalModels | null>(null)

  useEffect(() => {
    ipc.local.stats().then((s: any) => setStats(s || null))
    ipc.update.localModels().then((m) => setLocalModels(m))
  }, [])

  return (
    <div className="settings-page">
      <div className="settings-header">
        <div className="settings-title">Settings</div>
        <button className="modal-close" onClick={onClose}>×</button>
      </div>

      <div className="settings-layout">
        {/* Left: section menu */}
        <nav className="settings-nav">
          {MENU.map((m) => (
            <button
              key={m.id}
              className={`settings-nav-item${section === m.id ? ' active' : ''}`}
              onClick={() => onSectionChange(m.id)}
            >
              <span className="settings-nav-icon">{m.icon}</span>
              <span className="settings-nav-label">{m.label}</span>
            </button>
          ))}
        </nav>

        {/* Right: active section content */}
        <div className="settings-content">
          {section === 'account' && (
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
          )}

          {section === 'storage' && (
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
          )}

          {section === 'faces' && (
            <section className="settings-section">
              <div className="settings-section-title">Wajah</div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-label">Tampilkan person sekali muncul</div>
                  <div className="settings-row-hint">Foto ramai: person yang hanya muncul 1× juga ditampilkan di filter wajah (yang blur/kualitas rendah tetap disembunyikan).</div>
                </div>
                <button
                  className={`toggle-btn ${showSingletons ? 'on' : ''}`}
                  role="switch"
                  aria-checked={showSingletons}
                  onClick={onToggleShowSingletons}
                  title={showSingletons ? 'Nonaktifkan' : 'Aktifkan'}
                >
                  <span className="toggle-knob" />
                </button>
              </div>
            </section>
          )}

          {section === 'models' && (
            <section className="settings-section">
              <div className="settings-section-title">Model (ML)</div>
              {!localModels ? (
                <div className="settings-row-hint">Memuat…</div>
              ) : (
                <div className="settings-model-list">
                  <ModelRow
                    title="Deteksi wajah"
                    desc="SCRFD 10G — menemukan semua wajah di foto."
                    installed={localModels.detector}
                    latest={updateInfo?.models?.detector}
                  />
                  <ModelRow
                    title="Pengenalan wajah"
                    desc="ArcFace (buffalo_l) — mengubah wajah menjadi embedding untuk pengelompokan."
                    installed={localModels.recognizer}
                    latest={updateInfo?.models?.recognizer}
                  />
                  <ModelRow
                    title="Kualitas wajah"
                    desc="eDifFIQA — menilai ketajaman wajah sebelum diproses lebih lanjut."
                    installed={localModels.quality}
                    latest={updateInfo?.models?.quality}
                  />
                </div>
              )}
            </section>
          )}

          {section === 'about' && (
            <section className="settings-section">
              <div className="settings-section-title">Tentang</div>
              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-label">
                    Picly
                    {updateInfo?.available && updateInfo?.latest && (
                      <span className="update-chip">Update tersedia: {updateInfo.latest}</span>
                    )}
                  </div>
                  <div className="settings-row-hint">
                    Pengelola foto lokal — face recognition via ONNX (buffalo_l), semua data di perangkat.
                  </div>
                  <div className="settings-row-hint">
                    Versi terpasang: <span className="mono">{updateInfo?.current || '—'}</span>
                    {updateInfo?.latest && updateInfo?.latest !== updateInfo?.current && (
                      <> · Terbaru: <span className="mono">{updateInfo.latest}</span></>
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
                  {updateInfo?.available && updateInfo?.models && (
                    <div className="settings-row-hint">
                      Termasuk model baru: {[updateInfo.models.detector, updateInfo.models.recognizer, updateInfo.models.quality].filter(Boolean).join(', ')}
                    </div>
                  )}
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
          )}
        </div>
      </div>
    </div>
  )
}
