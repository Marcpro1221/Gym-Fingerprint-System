# GymFlow PostgreSQL Setup

Run the schema first, then the seed:

```sql
\i database/schema/gymflow-postgres.sql
\i database/seeds/gymflow-demo-seed.sql
```

Tables:

- `membership_plans`: plan catalog such as `Monthly Payment` and `Single Day Access`
- `members`: the front-desk member profile with demo `member_id`, mobile number, status, and action label
- `member_subscriptions`: the current plan window and expiry date for each member
- `fingerprints`: fingerprint enrollment records, including the template format, stored template payload, and the original capture payload
- `scan_events`: every fingerprint capture attempt or registration capture that should be traceable later
- `attendance_logs`: the event history used for last visit, status, action, and plan snapshots
- `member_directory_view`: a readable view shaped for the `Member List` page

Current fingerprint note:

- The existing DigitalPersona bridge does not yet produce a true matcher template.
- The schema is ready for a real vendor template in `template_data_base64`.
- Until template extraction is added, the backend can store the captured scan payload or raw image artifact as the enrollment record.
