import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "./utils";

const buttonVariants = cva(
	"inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-60 aria-disabled:pointer-events-none aria-disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground hover:bg-primary/90",
				destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
				outline:
					"border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground",
				secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
				ghost: "text-foreground hover:bg-accent hover:text-accent-foreground",
				link: "text-foreground underline underline-offset-4 hover:no-underline",
			},
			size: {
				default: "h-9 px-4 py-2",
				sm: "h-8 gap-1.5 px-3",
				lg: "h-10 px-6",
				icon: "size-9",
			},
		},
		defaultVariants: { variant: "default", size: "default" },
	},
);

type ButtonProps = React.ComponentProps<"button"> &
	VariantProps<typeof buttonVariants> & {
		/** Renders the single child element with the button's classes (for links). */
		asChild?: boolean;
	};

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
	const Component = asChild ? Slot.Root : "button";
	return (
		<Component
			data-slot="button"
			className={cn(buttonVariants({ variant, size }), className)}
			{...props}
		/>
	);
}

export { Button, type ButtonProps, buttonVariants };
