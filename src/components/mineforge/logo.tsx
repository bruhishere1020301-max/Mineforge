'use client'

import { cn } from '@/lib/utils'

/** Pixel-art style "grass block" logo built with pure CSS. */
export function PixelLogo({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative inline-grid shrink-0 grid-cols-3 grid-rows-3 overflow-hidden rounded-[4px]',
        'h-7 w-7 shadow-[inset_0_-2px_0_rgba(0,0,0,0.35)]',
        className
      )}
      style={{ gap: '1px', background: '#3d2c20', padding: '1.5px' }}
    >
      {/* top row: grass */}
      <i className="rounded-[1px] bg-[#5ebd4a]" />
      <i className="rounded-[1px] bg-[#4fae3e]" />
      <i className="rounded-[1px] bg-[#5ebd4a]" />
      {/* middle: dirt transition */}
      <i className="rounded-[1px] bg-[#6f543c]" />
      <i className="rounded-[1px] bg-[#5ebd4a]/80" />
      <i className="rounded-[1px] bg-[#6f543c]" />
      {/* bottom: dirt */}
      <i className="rounded-[1px] bg-[#7a5c40]" />
      <i className="rounded-[1px] bg-[#8a6a4a]" />
      <i className="rounded-[1px] bg-[#7a5c40]" />
    </span>
  )
}

export function BrandTitle({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <PixelLogo />
      <span className="flex min-w-0 flex-col leading-none">
        <span className="font-pixel text-[11px] text-emerald-500">MINEFORGE</span>
        {!compact && (
          <span className="mt-1 truncate text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            Mod &amp; Shader AI Studio
          </span>
        )}
      </span>
    </span>
  )
}
