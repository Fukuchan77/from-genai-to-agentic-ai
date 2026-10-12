import type { Metadata, Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
	title: {
		default: "GenAI から Agentic AI へ",
		template: "%s | GenAI から Agentic AI へ",
	},
	description: "AI エージェントの構築・評価・運用を学ぶエンジニアリングガイドの実習アプリです。",
};

// `typedRoutes` only knows routes that exist; /chat, /agent and /summarize are added by their own
// features, so the hrefs are asserted as routes until then.
const NAV_ITEMS: readonly { readonly href: Route; readonly label: string }[] = [
	{ href: "/chat" as Route, label: "チャット" },
	{ href: "/agent" as Route, label: "ツールエージェント" },
	{ href: "/summarize" as Route, label: "要約" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="ja">
			<body className="min-h-screen font-sans antialiased">
				<a
					href="#main"
					className="sr-only rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus-visible:outline-2 focus-visible:outline-offset-2"
				>
					本文へ移動
				</a>
				<header className="border-b border-border">
					<div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
						<Link
							href="/"
							className="rounded-sm text-base font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
						>
							GenAI から Agentic AI へ
						</Link>
						<nav aria-label="メインナビゲーション">
							<ul className="flex flex-wrap items-center gap-1">
								{NAV_ITEMS.map((item) => (
									<li key={item.href}>
										<Link
											href={item.href}
											className="rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
										>
											{item.label}
										</Link>
									</li>
								))}
							</ul>
						</nav>
					</div>
				</header>
				<main id="main" tabIndex={-1} className="mx-auto max-w-5xl px-4 py-8">
					{children}
				</main>
			</body>
		</html>
	);
}
