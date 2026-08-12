import { Aperture, MagnifyingGlass, FolderOpen, ShieldCheck, Cpu, HardDrives, ArrowRight, GithubLogo, DownloadSimple, ShieldStar } from '@phosphor-icons/react'

function Navbar() {
  return (
    <header className="nav">
      <div className="nav-inner">
        <a href="#" className="brand">
          <Aperture size={26} weight="fill" className="brand-icon" />
          <span className="brand-name">Picly</span>
        </a>
        <nav className="nav-links">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#privacy">Privacy</a>
        </nav>
        <a href="https://github.com/rizkhal/picly" className="btn btn-ghost nav-cta" target="_blank" rel="noreferrer">
          <GithubLogo size={16} weight="fill" />
          GitHub
        </a>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section className="hero">
      <div className="hero-inner">
        <div className="hero-badge">
          <ShieldStar size={14} weight="fill" />
          macOS · Apple Silicon
        </div>
        <h1 className="hero-title">
          Face search from
          <br />
          your <span className="hero-accent">local drives</span>.
        </h1>
        <p className="hero-sub">
          Picly finds any face across your photos — entirely on your device.
          No cloud, no upload, no account required.
        </p>
        <div className="hero-actions">
          <a href="#download" className="btn btn-primary btn-lg">
            <DownloadSimple size={18} weight="bold" />
            Download for macOS
          </a>
          <a href="#how" className="btn btn-ghost btn-lg">
            See how it works
            <ArrowRight size={16} weight="bold" />
          </a>
        </div>
        <div className="hero-stats">
          <div className="hero-stat">
            <div className="hero-stat-value">100%</div>
            <div className="hero-stat-label">On-device</div>
          </div>
          <div className="hero-stat">
            <div className="hero-stat-value">0</div>
            <div className="hero-stat-label">Photos uploaded</div>
          </div>
          <div className="hero-stat">
            <div className="hero-stat-value">~190MB</div>
            <div className="hero-stat-label">Models bundled</div>
          </div>
        </div>
      </div>
    </section>
  )
}

const FEATURES = [
  {
    icon: MagnifyingGlass,
    title: 'Search by face',
    desc: 'Drop a photo and find every matching face across your drives — instantly, with ranked results.',
  },
  {
    icon: FolderOpen,
    title: 'Auto-tag people',
    desc: 'InsightFace clustering groups the same person across photos, so your library organizes itself.',
  },
  {
    icon: Cpu,
    title: 'ONNX on-device',
    desc: 'SCRFD detection + ArcFace recognition run natively via ONNX Runtime. No servers involved.',
  },
  {
    icon: ShieldCheck,
    title: 'Private by design',
    desc: 'Everything stays on your machine. Your photos never leave your device — not even for a second.',
  },
  {
    icon: HardDrives,
    title: 'Your drives, scanned',
    desc: 'Point it at any folder or drive. Hash dedup + thumbnails keep the library fast even at scale.',
  },
  {
    icon: Aperture,
    title: 'Offline-first',
    desc: 'Works fully offline. No internet, no backend, no account needed for scanning and search.',
  },
]

function Features() {
  return (
    <section id="features" className="section">
      <div className="section-inner">
        <h2 className="section-title">Everything local, nothing uploaded</h2>
        <p className="section-sub">A photo manager that respects your privacy by never seeing your photos.</p>
        <div className="features-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="feature-card">
              <div className="feature-icon"><f.icon size={22} weight="bold" /></div>
              <h3 className="feature-title">{f.title}</h3>
              <p className="feature-desc">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

const STEPS = [
  {
    num: '01',
    title: 'Add a folder',
    desc: 'Point Picly at any folder or external drive. It scans in the background with live progress.',
  },
  {
    num: '02',
    title: 'Faces get indexed',
    desc: 'Each face is detected and embedded into a local SQLite database — on your machine.',
  },
  {
    num: '03',
    title: 'Search instantly',
    desc: 'Drop a reference photo. Picly finds every matching face, grouped by person, in milliseconds.',
  },
]

function HowItWorks() {
  return (
    <section id="how" className="section section-alt">
      <div className="section-inner">
        <h2 className="section-title">How it works</h2>
        <p className="section-sub">Three steps from photos to a searchable face library.</p>
        <div className="steps">
          {STEPS.map((s) => (
            <div key={s.num} className="step">
              <div className="step-num">{s.num}</div>
              <h3 className="step-title">{s.title}</h3>
              <p className="step-desc">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Privacy() {
  const points = [
    { icon: ShieldCheck, text: 'No cloud upload, ever' },
    { icon: ShieldCheck, text: 'Face embeddings stay in a local SQLite DB' },
    { icon: ShieldCheck, text: 'No account required to use core features' },
    { icon: ShieldCheck, text: 'The only network call is an optional update check' },
  ]
  return (
    <section id="privacy" className="section section-privacy">
      <div className="section-inner privacy-split">
        <div className="privacy-copy">
          <h2 className="section-title">Your photos never leave your device</h2>
          <p className="section-sub">
            Picly is a desktop app built around one principle: your photos belong to you.
            The ML models run locally, the database lives locally, and the app works fully offline.
          </p>
        </div>
        <ul className="privacy-list">
          {points.map((p) => (
            <li key={p.text} className="privacy-item">
              <div className="privacy-item-icon">
                <p.icon size={18} weight="bold" />
              </div>
              <span>{p.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function Cta() {
  return (
    <section id="download" className="section section-cta">
      <div className="section-inner cta-inner">
        <h2 className="section-title">Ready to find your faces?</h2>
        <p className="section-sub">Download Picly for macOS and scan your first folder in under a minute.</p>
        <a href="https://github.com/rizkhal/picly/releases/latest" className="btn btn-primary btn-lg">
          <DownloadSimple size={18} weight="bold" />
          Download Picly
        </a>
        <p className="cta-hint">macOS 12+ · Apple Silicon · DMG</p>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Aperture size={18} weight="fill" className="brand-icon" />
          <span>Picly</span>
        </div>
        <div className="footer-meta">
          <span>© {new Date().getFullYear()} Picly</span>
          <a href="https://github.com/rizkhal/picly" target="_blank" rel="noreferrer">
            <GithubLogo size={16} weight="fill" />
            GitHub
          </a>
        </div>
      </div>
    </footer>
  )
}

export default function App() {
  return (
    <div className="page">
      <Navbar />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <Privacy />
        <Cta />
      </main>
      <Footer />
    </div>
  )
}
