import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ComponentProps } from "react";

const buttonVariants = cva("inline-flex items-center justify-center rounded-md px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50", {
  variants: {
    variant: {
      default: "bg-[#262626] text-white hover:bg-[#404040]",
      outline: "border border-[#d4d4d4] bg-white text-[#262626] hover:bg-[#f5f5f5]"
    }
  },
  defaultVariants: { variant: "default" }
});

export function Button({ className, variant, ...props }: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button className={twMerge(clsx(buttonVariants({ variant }), className))} {...props} />;
}
