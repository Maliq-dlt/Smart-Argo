import { useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Moon, Sun } from 'lucide-react'

export default function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('smart-agro.theme')
      if (saved === 'light' || saved === 'dark') return saved
    } catch { /* Theme remains usable without storage. */ }
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const [changing, setChanging] = useState(false)
  const busy = useRef(false), button = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme }, [theme])

  async function changeTheme() {
    if (busy.current) return
    const next = theme === 'dark' ? 'light' : 'dark'
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const apply = () => {
      document.documentElement.dataset.theme = next
      flushSync(() => setTheme(next))
      try { localStorage.setItem('smart-agro.theme', next) } catch { /* Keep the current choice for this visit. */ }
    }
    // ponytail: circular reveal needs View Transitions; older browsers keep theme + icon motion.
    if (reduced || typeof document.startViewTransition !== 'function') {
      apply()
      if (!reduced) button.current?.querySelector('.theme-symbol')?.animate(
        [{ transform: 'rotate(-35deg) scale(.7)' }, { transform: 'rotate(0) scale(1)' }],
        { duration: 220, easing: 'ease-out' },
      )
      return
    }
    document.documentElement.dataset.themeTransition = 'true'
    busy.current = true
    setChanging(true)
    const rect = button.current!.getBoundingClientRect()
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 1
    try {
      const transition = document.startViewTransition(apply)
      await transition.ready
      await document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 480, easing: 'cubic-bezier(.22, 1, .36, 1)', pseudoElement: '::view-transition-new(root)' },
      ).finished
      await transition.finished
    } catch {
      // Snapshot capture can be interrupted by a hidden tab or an unsupported pseudo-element.
      apply()
    } finally {
      delete document.documentElement.dataset.themeTransition
      busy.current = false
      setChanging(false)
    }
  }

  return <button ref={button} className="icon-button theme-toggle" onClick={() => void changeTheme()}
    aria-disabled={changing} aria-busy={changing} aria-pressed={theme === 'dark'}
    aria-label={theme === 'dark' ? 'Gunakan tema terang' : 'Gunakan tema gelap'}
    title={`Tema ${theme === 'dark' ? 'gelap' : 'terang'} aktif`}>
    <span className="theme-symbol" data-theme-icon={theme} aria-hidden="true">{theme === 'dark' ? <Moon /> : <Sun />}</span>
  </button>
}
