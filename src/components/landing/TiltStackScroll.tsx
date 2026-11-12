/* eslint-disable react-refresh/only-export-components -- vendored 21st.dev component keeps its exported helpers */
// Adapted from "Scroll Stacking Cards" by kedhareswer on 21st.dev
// (https://21st.dev/@kedhareswer/components/tilt-stack-scroll), retrieved 12 Nov 2026.
// Changes: Smart Agro type and copy, Indonesian labels, card links routed inside the site.

import { useEffect, useRef } from "react"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"

export type TiltStackCard = {
  title: string
  /** Small line above the title, e.g. "7 days · Dolomites". */
  kicker?: string
  description: string
  image: string
  alt?: string
  /** Short chips under the copy. */
  tags?: string[]
  /** Big figure on the right, e.g. "€1,840". */
  price?: string
  priceNote?: string
  cta?: string
  href?: string
  /** Tint for the chip dots and the button. */
  accent?: string
}

export type TiltStackScrollProps = {
  cards: TiltStackCard[]
  eyebrow?: string
  heading?: string
  /** Height of the sticky stage; the section scrolls one stage per card. */
  height?: string
  /** Settle on the nearest card when scrolling stops. */
  snap?: boolean
  className?: string
}

// #region pose
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

export type Pose = { y: number; scale: number; rx: number; rz: number; shade: number; opacity: number }

/** Where card i sits when the scroll is at p (0 = first card, n-1 = last).
 *  A card slides up tilted and turned, lands flat, then tips back and shrinks
 *  as later cards land on it. y is a percentage of the card's own height. */
export function pose(p: number, i: number, reduced: boolean): Pose {
  const enter = i === 0 ? 1 : clamp(p - (i - 1), 0, 1)
  const depth = clamp(p - i, 0, 3)
  if (reduced)
    return { y: 0, scale: 1, rx: 0, rz: 0, shade: Math.min(depth, 1) * 0.5, opacity: enter >= 1 ? 1 : enter }
  const e = easeOut(enter)
  return {
    y: (1 - e) * 130 - depth * 3.2,
    scale: (1 - depth * 0.07) * (0.9 + 0.1 * e),
    rx: (1 - e) * 22 - depth * 9,
    rz: (1 - e) * (i % 2 ? 5 : -5) + 0,
    shade: Math.min(depth, 2) * 0.34,
    opacity: depth > 2.6 ? clamp((3 - depth) / 0.4, 0, 1) : 1,
  }
}

export const toTransform = (q: Pose) =>
  "translate3d(0," + q.y.toFixed(3) + "%,0) perspective(1400px) rotateX(" + q.rx.toFixed(3) + "deg) rotateZ(" + q.rz.toFixed(3) + "deg) scale(" + q.scale.toFixed(4) + ")"

export const pad2 = (n: number) => (n < 10 ? "0" : "") + n
// #endregion

const SERIF = '"Fraunces",Georgia,serif'
const MONO = '"General Sans","Segoe UI",system-ui,sans-serif'

const CSS =
  ".tss-track{position:relative;width:100%}" +
  ".tss-stage{position:sticky;top:0;display:flex;flex-direction:column;overflow:hidden;background:var(--color-background);color:var(--color-foreground);box-sizing:border-box;padding:clamp(20px,4vh,44px) 16px clamp(20px,4vh,40px)}" +
  ".tss-head{position:relative;z-index:5;width:100%;max-width:1040px;margin:0 auto 22px;display:flex;align-items:flex-end;justify-content:space-between;gap:20px}" +
  ".tss-eyebrow{font:500 13px/1 " + MONO + ";letter-spacing:.2em;text-transform:uppercase;color:var(--color-muted-foreground);margin:0 0 12px}" +
  ".tss-h{font:420 clamp(36px,5vw,72px)/1.02 " + SERIF + ";font-variation-settings:'SOFT' 100;letter-spacing:-.025em;margin:0;max-width:16ch}" +
  ".tss-h span{display:inline-block}" +
  ".tss-count{flex:none;font:500 13px/1 " + MONO + ";letter-spacing:.12em;color:var(--color-muted-foreground);display:flex;align-items:center;gap:12px}" +
  ".tss-count b{font-weight:500;color:var(--color-foreground);font-size:22px;letter-spacing:0}" +
  ".tss-rail{width:90px;height:2px;border-radius:2px;background:var(--color-border);overflow:hidden}" +
  ".tss-rail i{display:block;height:100%;width:100%;background:var(--color-foreground);transform-origin:0 50%;transform:scaleX(0)}" +
  ".tss-deck{position:relative;flex:1;width:100%;max-width:1040px;margin:clamp(24px,6vh,60px) auto 0;min-height:0}" +
  ".tss-card{position:absolute;inset:0;border-radius:30px;overflow:hidden;transform-origin:50% 0;will-change:transform;backface-visibility:hidden;background:#0c0c0e;color:#fff;" +
  "box-shadow:0 1px 0 rgba(255,255,255,.18) inset,0 0 0 1px rgba(0,0,0,.08),0 50px 90px -40px rgba(8,10,20,.55),0 18px 40px -20px rgba(8,10,20,.45)}" +
  ".tss-card>img{position:absolute;inset:0;width:100%;height:100%;max-width:none;object-fit:cover;display:block;transform:scale(1.06)}" +
  ".tss-card::before{content:'';position:absolute;inset:0;z-index:1;background:linear-gradient(90deg,rgba(6,7,12,.82) 0%,rgba(6,7,12,.55) 38%,rgba(6,7,12,0) 70%),linear-gradient(0deg,rgba(6,7,12,.6),rgba(6,7,12,0) 45%)}" +
  ".tss-shade{position:absolute;inset:0;z-index:4;background:#05060a;opacity:0;pointer-events:none}" +
  ".tss-body{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;justify-content:space-between;padding:clamp(22px,3.4vw,44px)}" +
  ".tss-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}" +
  ".tss-num{font:400 clamp(56px,9vw,112px)/.8 " + SERIF + ";letter-spacing:-.04em;color:rgba(255,255,255,.92);font-feature-settings:'lnum'}" +
  ".tss-kick{font:500 12px/1 " + MONO + ";letter-spacing:.18em;text-transform:uppercase;padding:9px 12px;border-radius:999px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);white-space:nowrap}" +
  ".tss-bottom{display:flex;align-items:flex-end;justify-content:space-between;gap:28px}" +
  ".tss-copy{max-width:470px}" +
  ".tss-title{font:420 clamp(32px,4vw,56px)/1.02 " + SERIF + ";font-variation-settings:'SOFT' 100;letter-spacing:-.025em;margin:0 0 14px}" +
  ".tss-desc{font:400 clamp(15px,1.3vw,17px)/1.55 \"General Sans\",system-ui,sans-serif;color:rgba(255,255,255,.76);margin:0 0 18px}" +
  ".tss-tags{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0;list-style:none}" +
  ".tss-tags li{display:flex;align-items:center;gap:7px;font:500 13px/1 \"General Sans\",system-ui,sans-serif;padding:8px 11px;border-radius:999px;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.14)}" +
  ".tss-tags li::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--tss-accent)}" +
  ".tss-buy{flex:none;text-align:right}" +
  ".tss-price{font:400 clamp(28px,3.4vw,44px)/1 " + SERIF + ";letter-spacing:-.02em}" +
  ".tss-note{display:block;font:500 12px/1 " + MONO + ";letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.6);margin:8px 0 16px}" +
  ".tss-cta{display:inline-flex;align-items:center;gap:10px;font:600 15px/1 \"General Sans\",system-ui,sans-serif;color:#0b0b0d;background:var(--tss-accent);padding:14px 18px;border-radius:999px;text-decoration:none;border:0;cursor:pointer;" +
  "box-shadow:0 1px 0 rgba(255,255,255,.6) inset,0 10px 24px -10px var(--tss-accent);transition:transform .35s cubic-bezier(.34,1.56,.64,1),box-shadow .3s}" +
  ".tss-cta:hover{transform:translateY(-2px) scale(1.03)}" +
  ".tss-cta:active{transform:scale(.97)}" +
  ".tss-cta:focus-visible{outline:2px solid #fff;outline-offset:3px}" +
  ".tss-cta svg{transition:transform .35s cubic-bezier(.34,1.56,.64,1)}" +
  ".tss-cta:hover svg{transform:translateX(3px)}" +
  "@media (max-width:640px){.tss-bottom{flex-direction:column;align-items:flex-start;gap:18px}.tss-buy{text-align:left;display:flex;align-items:center;gap:16px;width:100%;justify-content:space-between}.tss-note{margin:6px 0 0}" +
  ".tss-card::before{background:linear-gradient(0deg,rgba(6,7,12,.92) 0%,rgba(6,7,12,.6) 55%,rgba(6,7,12,.1) 100%)}.tss-desc{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.tss-head{flex-direction:column;align-items:flex-start;gap:14px}.tss-card{border-radius:24px}}" +
  "@media (prefers-reduced-motion:reduce){.tss-cta,.tss-cta svg{transition:none}}"

export default function TiltStackScroll({
  cards,
  eyebrow = "Cara kerja",
  heading = "Empat langkah dari tanah ke saran",
  height = "100svh",
  snap = true,
  className = "",
}: TiltStackScrollProps) {
  const track = useRef(null as HTMLDivElement | null)
  const els = useRef([] as (HTMLElement | null)[])
  const shades = useRef([] as (HTMLDivElement | null)[])
  const count = useRef(null as HTMLElement | null)
  const rail = useRef(null as HTMLElement | null)
  const headWords = useRef(null as HTMLHeadingElement | null)
  const n = cards.length

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger)
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    let reduced = mq.matches
    let last = -1
    let p = 0

    const paint = () => {
      for (let i = 0; i < n; i++) {
        const el = els.current[i]
        if (!el) continue
        const q = pose(p, i, reduced)
        el.style.transform = toTransform(q)
        el.style.opacity = String(q.opacity)
        const sh = shades.current[i]
        if (sh) sh.style.opacity = String(q.shade)
      }
      const idx = Math.round(p)
      if (idx !== last && count.current) {
        last = idx
        count.current.textContent = pad2(idx + 1)
      }
      if (rail.current) rail.current.style.transform = "scaleX(" + (n > 1 ? p / (n - 1) : 1).toFixed(4) + ")"
    }

    const trigger = ScrollTrigger.create({
      trigger: track.current,
      start: "top top",
      end: "bottom bottom",
      onUpdate: (self) => {
        p = self.progress * Math.max(n - 1, 0)
        paint()
      },
      snap: snap && !reduced && n > 1 ? { snapTo: 1 / (n - 1), duration: { min: 0.25, max: 0.7 }, delay: 0.08, ease: "power2.inOut" } : undefined,
    })
    paint()

    // Entrance: the heading words rise, the first card lands from a tilt.
    // In a context so a StrictMode remount reverts the from() states instead of freezing them.
    const ctx = gsap.context(() => {
      if (reduced) return
      const intro = gsap.timeline({ defaults: { ease: "expo.out" } })
      const words = headWords.current ? headWords.current.querySelectorAll(".tss-w") : []
      intro.from(words, { yPercent: 110, opacity: 0, rotate: 4, duration: 1.1, stagger: 0.06 }, 0.1)
      if (els.current[0]) intro.from(els.current[0], { yPercent: 18, rotateX: 18, scale: 0.92, opacity: 0, duration: 1.4, clearProps: "rotateX" }, 0.25)
      intro.eventCallback("onComplete", paint)
    })

    const on = () => {
      reduced = mq.matches
      paint()
    }
    mq.addEventListener("change", on)
    return () => {
      mq.removeEventListener("change", on)
      trigger.kill()
      ctx.revert()
      paint()
    }
  }, [n, snap])

  return (
    <div ref={track} className={"tss-track " + className} style={{ height: "calc(" + height + " * " + Math.max(n, 1) + ")" }}>
      <style>{CSS}</style>
      <section className="tss-stage" style={{ height }} aria-roledescription="carousel" aria-label={heading}>
        <header className="tss-head">
          <div>
            <p className="tss-eyebrow">{eyebrow}</p>
            <h2 className="tss-h" ref={headWords}>
              {heading.split(" ").map((w, i) => (
                <span key={i} style={{ overflow: "hidden", paddingBottom: 4 }}>
                  <span className="tss-w">{w}</span>
                  {" "}
                </span>
              ))}
            </h2>
          </div>
          <div className="tss-count" aria-hidden="true">
            <b ref={count}>01</b> / {pad2(n)}
            <span className="tss-rail">
              <i ref={rail} />
            </span>
          </div>
        </header>
        <div className="tss-deck">
          {cards.map((c, i) => (
            <article
              key={c.title + i}
              className="tss-card"
              ref={(el) => {
                els.current[i] = el
              }}
              style={{ zIndex: i + 1, ["--tss-accent" as string]: c.accent ?? "#f4d35e" }}
              aria-roledescription="slide"
              aria-label={pad2(i + 1) + " dari " + pad2(n) + ": " + c.title}
            >
              <img src={c.image} alt={c.alt ?? ""} draggable={false} loading={i < 2 ? "eager" : "lazy"} />
              <div className="tss-body">
                <div className="tss-top">
                  <span className="tss-num">{pad2(i + 1)}</span>
                  {c.kicker && <span className="tss-kick">{c.kicker}</span>}
                </div>
                <div className="tss-bottom">
                  <div className="tss-copy">
                    <h3 className="tss-title">{c.title}</h3>
                    <p className="tss-desc">{c.description}</p>
                    {c.tags && c.tags.length > 0 && (
                      <ul className="tss-tags">
                        {c.tags.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {(c.price || c.cta) && (
                    <div className="tss-buy">
                      {c.price && (
                        <div>
                          <div className="tss-price">{c.price}</div>
                          {c.priceNote && <span className="tss-note">{c.priceNote}</span>}
                        </div>
                      )}
                      <a className={"tss-cta" + (c.href === "#simulasi" ? " ag-simulator-link" : "")} href={c.href ?? "#"} onClick={c.href ? undefined : (e) => e.preventDefault()}>
                        {c.cta ?? "Lihat"}
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                          <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </a>
                    </div>
                  )}
                </div>
              </div>
              <div
                className="tss-shade"
                ref={(el) => {
                  shades.current[i] = el
                }}
              />
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
