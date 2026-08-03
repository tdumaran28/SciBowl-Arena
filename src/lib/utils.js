import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
} 


// Guarded so this module can be evaluated during server rendering.
export const isIframe = typeof window !== 'undefined' && window.self !== window.top;
