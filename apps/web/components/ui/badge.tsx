import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "./utils";

const badgeVariants = cva(
	"inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium [&>svg]:size-3 [&>svg]:pointer-events-none",
	{
		variants: {
			variant: {
				default: "border-transparent bg-primary text-primary-foreground",
				secondary: "border-transparent bg-secondary text-secondary-foreground",
				destructive: "border-transparent bg-destructive text-destructive-foreground",
				outline: "border-input text-foreground",
			},
		},
		defaultVariants: { variant: "default" },
	},
);

type BadgeProps = React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
	return (
		<span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
	);
}

export { Badge, type BadgeProps, badgeVariants };
