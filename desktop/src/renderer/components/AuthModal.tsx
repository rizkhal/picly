type AuthModalProps = {
  mode: 'login' | 'register'
  email: string
  password: string
  busy: boolean
  error: string | null
  onEmail: (v: string) => void
  onPassword: (v: string) => void
  onSubmit: () => void
  onClose: () => void
  onSwitchMode: () => void
}

export function AuthModal({ mode, email, password, busy, error, onEmail, onPassword, onSubmit, onClose, onSwitchMode }: AuthModalProps) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div
        style={{ background: '#1e1e1e', border: '1px solid #333', borderRadius: 12, padding: 24, width: 340, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>
          {mode === 'login' ? 'Sign in' : 'Create account'}
        </div>
        <div style={{ fontSize: 12, color: '#8b8b8b', marginBottom: 16 }}>
          Account for entitlement & updates. Photos stay 100% local on this device.
        </div>

        <label style={{ fontSize: 12, color: '#a0a0a0', display: 'block', marginBottom: 4 }}>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => onEmail(e.target.value)}
          placeholder="you@email.com"
          style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, background: '#141414', border: '1px solid #3a3a3a', color: '#e8e8e8', fontSize: 14, marginBottom: 12, outline: 'none' }}
        />

        <label style={{ fontSize: 12, color: '#a0a0a0', display: 'block', marginBottom: 4 }}>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !busy) onSubmit() }}
          placeholder="At least 8 characters"
          style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, background: '#141414', border: '1px solid #3a3a3a', color: '#e8e8e8', fontSize: 14, marginBottom: 12, outline: 'none' }}
        />

        {error && (
          <div style={{ fontSize: 12, color: '#e5484d', marginBottom: 10 }}>{error}</div>
        )}

        <button
          onClick={onSubmit}
          disabled={busy}
          style={{ width: '100%', padding: '10px', borderRadius: 8, background: '#4a7cff', border: 'none', color: '#fff', fontSize: 14, fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}
        >
          {busy ? 'Processing…' : mode === 'login' ? 'Sign in' : 'Sign up'}
        </button>

        <div style={{ marginTop: 12, fontSize: 12, textAlign: 'center', color: '#8b8b8b' }}>
          {mode === 'login' ? (
            <>No account yet?{' '}
              <span style={{ color: '#4a7cff', cursor: 'pointer' }} onClick={onSwitchMode}>Sign up</span>
            </>
          ) : (
            <>Already have an account?{' '}
              <span style={{ color: '#4a7cff', cursor: 'pointer' }} onClick={onSwitchMode}>Sign in</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
