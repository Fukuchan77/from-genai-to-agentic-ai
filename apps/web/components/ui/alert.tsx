import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "./utils";

const alertVariants = cva(
	"relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[1rem_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current",
	{
		variants: {
			variant: {
				default: "border-border bg-card text-card-foreground",
				destructive: "border-destructive bg-card text-destructive",
			},
		},
		defaultVariants: { variant: "default" },
	},
);

type AlertProps = React.ComponentProps<"div"> & VariantProps<typeof alertVariants>;

/** `role="alert"` by default; pass `role="status"` for non-urgent notices. */
function Alert({ className, variant, role = "alert", ...props }: AlertProps) {
	return (
		<div
			data-slot="alert"
			role={role}
			className={cn(alertVariants({ variant }), className)}
			{...props}
		/>
	);
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-title"
			className={cn("col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight", className)}
			{...props}
		/>
	);
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-description"
			className={cn(
				"col-start-2 grid justify-items-start gap-1 text-sm [&_p]:leading-relaxed",
				className,
			)}
			{...props}
		/>
	);
}

export { Alert, AlertDescription, AlertTitle, alertVariants };
