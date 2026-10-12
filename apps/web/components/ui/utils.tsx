import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merges class names, letting later Tailwind utilities override earlier ones (shadcn `cn`). */
export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}
