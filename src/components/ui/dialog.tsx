import type { ComponentProps } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogTitle = DialogPrimitive.Title
export const DialogDescription = DialogPrimitive.Description
export const DialogClose = DialogPrimitive.Close

export function DialogContent({ className = '', children, showCloseButton = true, ...props }: ComponentProps<typeof DialogPrimitive.Content> & { showCloseButton?: boolean }) {
  return <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="ui-overlay" data-lenis-prevent />
    <DialogPrimitive.Content className={`ui-dialog modal ${className}`} {...props} data-lenis-prevent>
      {children}
      {showCloseButton && <DialogPrimitive.Close className="icon-button ui-close" aria-label="Tutup panel"><X /></DialogPrimitive.Close>}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
}
