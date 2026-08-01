"use client"

import * as React from "react"
import { Slider as SliderPrimitive, type SliderRoot } from "@base-ui/react/slider"

import { cn } from "@/lib/utils"

// `ticks` marks discrete stops on the track. Pass the number of stops, not the
// step: a 5-level scale is `ticks={5}`, drawn at 0%, 25%, 50%, 75%, 100%.
function Slider({
  className,
  ticks = 0,
  ...props
}: SliderRoot.Props<number> & { ticks?: number }) {
  return (
    <SliderPrimitive.Root data-slot="slider" className={cn("w-full", className)} {...props}>
      <SliderPrimitive.Control
        data-slot="slider-control"
        className="flex h-4 w-full touch-none items-center select-none data-disabled:opacity-50"
      >
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative h-1 w-full rounded-full bg-foreground/12"
        >
          {ticks > 1 &&
            Array.from({ length: ticks }, (_, index) => (
              <span
                key={index}
                aria-hidden="true"
                className="absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/25"
                style={{ left: `${(index / (ticks - 1)) * 100}%` }}
              />
            ))}
          <SliderPrimitive.Indicator
            data-slot="slider-indicator"
            className="absolute rounded-full bg-primary"
          />
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            className="size-4 rounded-full border border-primary bg-primary shadow-sm transition-[box-shadow] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
