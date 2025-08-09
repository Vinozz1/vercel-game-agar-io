import React from 'react'
import { createRoot } from 'react-dom/client'

function App() {
  return (
    <div style={{ padding: 24, color: '#e6edf3', background: '#0d1117', minHeight: '100vh', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
      <h1>Multiplayer Agar.io</h1>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <form onSubmit={async (e) => {
          e.preventDefault()
          const fd = new FormData(e.currentTarget as HTMLFormElement)
          const name = String(fd.get('name') || '').trim()
          const vsbot = Boolean(fd.get('vsbot'))
          const res = await fetch('/api/create-room', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: name, vsBot: vsbot }) })
          const data = await res.json()
          if (!data.ok) { alert('Gagal membuat room'); return }
          const code = data.code
          location.href = `/room.html?code=${encodeURIComponent(code)}&name=${encodeURIComponent(name)}&vsbot=${vsbot ? '1' : '0'}`
        }} style={{ background: '#161b22', padding: 16, borderRadius: 12, border: '1px solid #30363d' }}>
          <h2>Buat Room</h2>
          <label>Nama</label>
          <input name="name" required style={{ width: '100%', padding: 8, borderRadius: 8, background: '#0b0f14', color: '#e6edf3', border: '1px solid #30363d' }} />
          <div style={{ marginTop: 8 }}>
            <label style={{ display: 'inline-flex', gap: 8 }}>
              <input name="vsbot" type="checkbox" /> VS Komputer
            </label>
          </div>
          <button type="submit" style={{ marginTop: 10, padding: '8px 12px' }}>Buat</button>
        </form>

        <form onSubmit={(e) => {
          e.preventDefault()
          const fd = new FormData(e.currentTarget as HTMLFormElement)
          const code = String(fd.get('code') || '').toUpperCase()
          const name = localStorage.getItem('username') || 'Guest'
          location.href = `/room.html?code=${encodeURIComponent(code)}&name=${encodeURIComponent(name)}`
        }} style={{ background: '#161b22', padding: 16, borderRadius: 12, border: '1px solid #30363d' }}>
          <h2>Masuk Room</h2>
          <label>Kode Room</label>
          <input name="code" required placeholder="ABC123" style={{ width: '100%', padding: 8, borderRadius: 8, background: '#0b0f14', color: '#e6edf3', border: '1px solid #30363d' }} />
          <button type="submit" style={{ marginTop: 10, padding: '8px 12px' }}>Masuk</button>
        </form>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)


