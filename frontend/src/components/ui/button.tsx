import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-[background-color,box-shadow,transform] duration-fast ease-out focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-brand text-brand-ink hover:bg-brand-hover [--press:var(--action-primary-press)]",
        destructive: "bg-danger text-white hover:bg-danger-hover [--press:var(--feedback-error-press)]",
        success: "bg-ok text-white hover:brightness-110 [--press:var(--feedback-success-press)]",
        outline: "border-2 border-line-strong/60 bg-surface text-ink hover:border-line-strong hover:bg-sunken [--press:var(--border-press)]",
        secondary: "bg-sunken text-ink hover:bg-line [--press:var(--border-press)]",
        ghost: "text-ink hover:bg-sunken",
        link: "text-brand underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        md: "min-h-tap px-4 text-base",
        lg: "min-h-tap-lg rounded-xl px-5 text-lg",
        xl: "min-h-[72px] rounded-2xl px-6 text-xl font-bold",
        icon: "h-9 w-9",
      },
      tactile: {
        // Chunky press-down feedback for large citizen controls (warm, tactile direction).
        true: "shadow-[0_4px_0_0_rgb(var(--press))] active:translate-y-[3px] active:shadow-[0_1px_0_0_rgb(var(--press))]",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      tactile: false,
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
