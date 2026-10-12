import type * as React from "react";
import { cn } from "./utils";

/** A placeholder block. It is decorative, so it is hidden from assistive technology. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="skeleton"
			aria-hidden="true"
			className={cn("animate-pulse rounded-md bg-muted motion-reduce:animate-none", className)}
			{...props}
		/>
	);
}

export { Skeleton };
