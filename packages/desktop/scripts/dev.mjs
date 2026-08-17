#!/usr/bin/env node
// Dev launcher: start vite (auto-picks free port), parse the real URL,
// hand it to electron via VITE_DEV_SERVER_URL. Kills both on exit.
import { spawn } from 'node:child_process'

const vite = spawn('vite', ['--port', '5173'], { stdio: ['ignore', 'pipe', 'inherit'] })
let electron = null

vite.stdout.on('data', (chunk) => {
  process.stdout.write(chunk)
  if (electron) return
  const m = chunk.toString().match(/Local:\s+(https?:\/\/localhost:\d+)/)
  if (!m) return
  electron = spawn('electron', ['.'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: m[1], NODE_ENV: 'development' },
  })
  electron.on('exit', (code) => { vite.kill(); process.exit(code ?? 0) })
})

vite.on('exit', (code) => {
  if (electron) electron.kill()
  process.exit(code ?? 0)
})

process.on('SIGINT', () => { vite.kill(); if (electron) electron.kill() })
process.on('SIGTERM', () => { vite.kill(); if (electron) electron.kill() })
