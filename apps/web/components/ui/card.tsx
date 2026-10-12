import type * as React from "react";
import { cn } from "./utils";

function Card({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card"
			className={cn(
				"flex flex-col gap-4 rounded-xl border border-border bg-card py-6 text-card-foreground",
				className,
			)}
			{...props}
		/>
	);
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-header"
			className={cn("flex flex-col gap-1.5 px-6", className)}
			{...props}
		/>
	);
}

type CardTitleProps = React.ComponentProps<"h2"> & {
	/** Heading level to render; pick the one that follows the page outline. */
	as?: "h2" | "h3" | "h4";
};

function CardTitle({ className, as: Component = "h2", ...props }: CardTitleProps) {
	return (
		<Component
			data-slot="card-title"
			className={cn("text-base font-semibold leading-none", className)}
			{...props}
		/>
	);
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
	return (
		<p
			data-slot="card-description"
			className={cn("text-sm text-muted-foreground", className)}
			{...props}
		/>
	);
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
	return <div data-slot="card-content" className={cn("px-6", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div data-slot="card-footer" className={cn("flex items-center px-6", className)} {...props} />
	);
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
