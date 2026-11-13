import { useId, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

// Halaska: https://21st.dev/@halaska-studio/components/segmented-control
// Native radios replace the source resize listener and keyboard handler.
export default function SegmentedControl({ label, value, options, onValueChange }: {
  label: string; value: string; options: { value: string; label: ReactNode }[]; onValueChange: (value: string) => void
}) {
  const id = useId(), reduced = useReducedMotion()
  return <fieldset className="segmented-control">
    <legend className="sr-only">{label}</legend>
    <div className="segment-options">{options.map(option => <label className="segment" key={option.value}>
      <input type="radio" name={id} value={option.value} checked={value === option.value} onChange={() => onValueChange(option.value)} />
      {value === option.value && <motion.span className="segment-selection" layoutId={`${id}-selection`} layoutDependency={value} initial={false}
        transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 40 }} aria-hidden="true" />}
      <span className="segment-label">{option.label}</span>
    </label>)}</div>
  </fieldset>
}
