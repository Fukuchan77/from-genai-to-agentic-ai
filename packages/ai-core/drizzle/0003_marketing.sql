-- Marketing catalogue and council personas (003 plan C12 / Data Model, CL-15, CL-23). Kept apart
-- from 0002_helpdesk.sql because the two features land in different waves. No extension is created
-- here and no column has a default except tags; the statements are separated by the
-- statement-breakpoint marker like 0001 and 0002.
-- marketing_products: `P-` + 3 digits is the key recommendations are checked against (Req 6.5), so
-- the pattern is enforced here and not only in the seed. tags is NOT NULL with an empty default so
-- the profile-to-tag matching never has to handle NULL.
CREATE TABLE marketing_products (
	id text PRIMARY KEY,
	name text NOT NULL,
	category text NOT NULL,
	price_yen integer NOT NULL,
	description text NOT NULL,
	tags text[] NOT NULL DEFAULT '{}',
	CONSTRAINT marketing_products_id_check CHECK (id ~ '^P-[0-9]{3}$'),
	CONSTRAINT marketing_products_price_yen_check CHECK (price_yen >= 0)
);
--> statement-breakpoint
-- marketing_personas: one row per council role. `viewpoint` is the role's standpoint that becomes
-- the speaker's instructions (Req 6.1); `ordinal` is the round-robin order, so two roles can never
-- share a turn.
CREATE TABLE marketing_personas (
	id text PRIMARY KEY,
	name text NOT NULL,
	viewpoint text NOT NULL,
	ordinal integer NOT NULL,
	CONSTRAINT marketing_personas_ordinal_unique UNIQUE (ordinal)
);
