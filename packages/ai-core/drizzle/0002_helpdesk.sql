-- Help-desk tickets and plan revisions (003 plan C10 / Data Model). Timestamps come from the
-- application's Clock, so no column has a default and no statement calls now(). No extension is
-- created here; the statements are separated by the statement-breakpoint marker like 0001.
CREATE TABLE helpdesk_tickets (
	id text PRIMARY KEY,
	inquiry text NOT NULL,
	status text NOT NULL,
	answer text,
	escalation_reason text,
	steps_used integer NOT NULL,
	stopped_reason text,
	created_at timestamptz NOT NULL,
	updated_at timestamptz NOT NULL,
	CONSTRAINT helpdesk_tickets_id_check CHECK (id ~ '^T-[0-9]{4,}$'),
	CONSTRAINT helpdesk_tickets_steps_used_check CHECK (steps_used >= 0),
	CONSTRAINT helpdesk_tickets_stopped_reason_check CHECK (stopped_reason IN ('step-limit', 'aborted')),
	-- Every status value is named here, so an unknown status fails this check too.
	CONSTRAINT helpdesk_tickets_state_check CHECK (
		(status = 'open' AND answer IS NULL AND escalation_reason IS NULL)
		OR (status = 'resolved' AND answer IS NOT NULL AND escalation_reason IS NULL AND stopped_reason IS NULL)
		OR (status = 'escalated' AND answer IS NULL AND escalation_reason IS NOT NULL AND stopped_reason IS NULL)
	)
);
--> statement-breakpoint
CREATE TABLE helpdesk_plan_revisions (
	ticket_id text NOT NULL REFERENCES helpdesk_tickets (id) ON DELETE CASCADE,
	revision integer NOT NULL,
	plan jsonb NOT NULL,
	diff jsonb,
	reason text NOT NULL,
	created_at timestamptz NOT NULL,
	PRIMARY KEY (ticket_id, revision),
	-- Revision 0 has no diff, every later revision has one; a negative revision fails both arms.
	CONSTRAINT helpdesk_plan_revisions_diff_check CHECK (
		(revision = 0 AND diff IS NULL) OR (revision > 0 AND diff IS NOT NULL)
	)
);
