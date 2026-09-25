import type { ComponentProps } from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'

// shadcn/Radix composition, styled with the app's existing tokens.
export const Select = SelectPrimitive.Root
export const SelectGroup = SelectPrimitive.Group
export const SelectValue = SelectPrimitive.Value

export function SelectTrigger({ className = '', children, ...props }: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return <SelectPrimitive.Trigger className={`ui-select-trigger ${className}`} {...props}>
    {children}<SelectPrimitive.Icon asChild><ChevronDown /></SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
}

export function SelectContent({ children, ...props }: ComponentProps<typeof SelectPrimitive.Content>) {
  return <SelectPrimitive.Portal><SelectPrimitive.Content className="ui-select-content" position="popper" sideOffset={6} collisionPadding={12} {...props} data-lenis-prevent>
    <SelectPrimitive.ScrollUpButton className="ui-select-scroll"><ChevronUp /></SelectPrimitive.ScrollUpButton>
    <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
    <SelectPrimitive.ScrollDownButton className="ui-select-scroll"><ChevronDown /></SelectPrimitive.ScrollDownButton>
  </SelectPrimitive.Content></SelectPrimitive.Portal>
}

export function SelectItem({ children, ...props }: ComponentProps<typeof SelectPrimitive.Item>) {
  return <SelectPrimitive.Item className="ui-select-item" {...props}>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    <SelectPrimitive.ItemIndicator><Check /></SelectPrimitive.ItemIndicator>
  </SelectPrimitive.Item>
}

export function SelectField({ label, value, onValueChange, options, placeholder = 'Pilih', ...props }: {
  label: string; value: string | number; onValueChange: (value: string) => void
  options: { value: string | number; label: string }[]; placeholder?: string; disabled?: boolean; id?: string
}) {
  return <Select value={String(value)} onValueChange={onValueChange} disabled={props.disabled}>
    <SelectTrigger aria-label={label} id={props.id}><SelectValue placeholder={placeholder} /></SelectTrigger>
    <SelectContent><SelectGroup>{options.map(option => <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
  </Select>
}
