import type { Profile } from "@platform/ai-core/marketing";

/** The newest `data-marketing-profile` part; each write replaces the one before (Req 6.4). */
export type ProfileViewData = Profile;

export interface ProfileViewProps {
	/** `undefined` until the first profile part arrives. */
	readonly profile: ProfileViewData | undefined;
}

const YEN = new Intl.NumberFormat("ja-JP");

function ItemList({ label, items }: { readonly label: string; readonly items: readonly string[] }) {
	return (
		<div className="flex flex-col gap-1">
			<h3 className="text-sm font-medium">{label}</h3>
			{items.length === 0 ? (
				<p className="text-sm text-muted-foreground">まだ分かっていません</p>
			) : (
				<ul aria-label={label} className="list-disc pl-5 text-sm">
					{items.map((item) => (
						<li key={item}>{item}</li>
					))}
				</ul>
			)}
		</div>
	);
}

/**
 * What is known about the shopper: interests, budget and concerns (plan C14, Req 6.4). The region
 * is `aria-live="polite"` so a screen reader hears the profile change as the conversation goes on.
 * Values are drawn as plain text.
 */
export function ProfileView({ profile }: ProfileViewProps) {
	return (
		<section
			aria-label="お客様のプロファイル"
			aria-live="polite"
			className="flex flex-col gap-3 rounded-md border p-3"
		>
			{profile === undefined ? (
				<p className="text-sm text-muted-foreground">
					会話が始まると、ここに分かったことが表示されます
				</p>
			) : (
				<>
					<ItemList label="関心事" items={profile.interests} />
					<div className="flex flex-col gap-1">
						<h3 className="text-sm font-medium">予算</h3>
						<p className="text-sm">
							{profile.budgetYen === null ? "未確認" : `${YEN.format(profile.budgetYen)} 円`}
						</p>
					</div>
					<ItemList label="懸念点" items={profile.concerns} />
				</>
			)}
		</section>
	);
}
