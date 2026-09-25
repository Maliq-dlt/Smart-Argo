import type { ComponentProps } from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverClose = PopoverPrimitive.Close

export function PopoverContent({ className = '', ...props }: ComponentProps<typeof PopoverPrimitive.Content>) {
  return <PopoverPrimitive.Portal><PopoverPrimitive.Content className={`ui-popover ${className}`} sideOffset={8} collisionPadding={12} {...props} data-lenis-prevent /></PopoverPrimitive.Portal>
}
