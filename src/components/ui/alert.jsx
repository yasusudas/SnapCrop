import React from "react";
import { cn } from "@/lib/utils";

export const Alert = React.forwardRef(function Alert({ className, ...props }, ref) {
  return <div ref={ref} role="alert" className={cn("relative w-full rounded-lg border p-4", className)} {...props} />;
});

export const AlertDescription = React.forwardRef(function AlertDescription({ className, ...props }, ref) {
  return <div ref={ref} className={cn("text-sm [&_p]:leading-relaxed", className)} {...props} />;
});
