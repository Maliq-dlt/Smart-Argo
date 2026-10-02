import { useRef, type ReactNode } from 'react'
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'

// Adapted from https://21st.dev/@manuarora700/components/container-scroll-animation
// ponytail: scroll flattens one surface; add a timeline only for coordinated camera scenes.
export default function ContainerScroll({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: root, offset: ['start end', 'center center'] })
  const rotateX = useTransform(scrollYProgress, [0, 1], [16, 0])
  const scale = useTransform(scrollYProgress, [0, 1], [.94, 1])
  const y = useTransform(scrollYProgress, [0, 1], [32, 0])
  return <div className="container-scroll" ref={root} data-reduced={Boolean(reduced)}>
    <motion.div className="container-scroll-surface" style={reduced ? undefined : { rotateX, scale, y }}>{children}</motion.div>
  </div>
}
