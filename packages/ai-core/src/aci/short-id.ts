export interface ShortIdEntry {
	readonly index: number;
	readonly label: string;
}

/**
 * Gives the model small, readable handles for items whose real IDs are UUIDs (Req 1.13). The model
 * sees `{ index, label }` and passes the index back; `resolve` turns it into the item. One index
 * per tool run: each `assign` replaces the previous assignment.
 */
export class ShortIdIndex<T> {
	readonly #labelOf: (item: T) => string;
	#items: readonly T[] = [];

	constructor(labelOf: (item: T) => string) {
		this.#labelOf = labelOf;
	}

	assign(items: readonly T[]): readonly ShortIdEntry[] {
		this.#items = [...items];
		return this.#items.map((item, index) => ({ index, label: this.#labelOf(item) }));
	}

	resolve(index: number): T | undefined {
		return Number.isInteger(index) && index >= 0 ? this.#items[index] : undefined;
	}
}
