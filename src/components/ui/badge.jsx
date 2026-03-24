import React from "react";
import { cn } from "@/lib/utils";

const variants = {
  default: "border-transparent bg-slate-900 text-white",
  secondary: "border-transparent bg-slate-100 text-slate-700",
};

export const Badge = React.forwardRef(function Badge({ className, variant = "default", ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        "inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold transition",
        variants[variant] || variants.default,
        className,
      )}
      {...props}
    />
  );
});
