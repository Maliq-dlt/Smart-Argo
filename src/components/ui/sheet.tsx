import type { ComponentProps } from 'react'
import { DialogContent } from './dialog'

export { Dialog as Sheet, DialogTrigger as SheetTrigger, DialogTitle as SheetTitle, DialogDescription as SheetDescription, DialogClose as SheetClose } from './dialog'

export function SheetContent({ className = '', ...props }: ComponentProps<typeof DialogContent>) {
  return <DialogContent className={`ui-sheet ${className}`} {...props} />
}
