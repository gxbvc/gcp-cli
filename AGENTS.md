# gcp-cli

Google Cloud and Firebase for agents. Covers the gaps in the official CLIs (Firestore document CRUD, single Auth user CRUD, a cross-project inventory) and passes everything else to `gcloud` and `firebase`.

Output: single-line JSON `{"ok":true,"data":...}` or `{"ok":false,"error":"...","code":"..."}`. Pipe to `jq`.

## Commands

```bash
gcp-cli projects [--all]                          # Projects you can see, newest first, with firebase flag
gcp-cli inventory [-p id1 id2] [--auth-cap 5000]  # What runs in each project (billing, apps, hosting, Firestore, Auth, functions, Run, buckets, VMs, SQL)

gcp-cli fs collections [docPath] -p PROJ          # Root collections, or subcollections of a doc
gcp-cli fs list <collection> -p PROJ [-l 25] [--ids]
gcp-cli fs get <docPath> -p PROJ
gcp-cli fs query <collection> -p PROJ -w "status == active" -w "age >= 21" -o "createdAt desc" -l 10 [--group] [--count]
gcp-cli fs add <collection> -p PROJ -d '{"name":"Ann"}'
gcp-cli fs set <docPath> -p PROJ -d '{...}' [--merge]
gcp-cli fs update <docPath> -p PROJ -d '{"profile.name":"Ann","old":{"$delete":true}}'
gcp-cli fs delete <docPath> -p PROJ --yes         # One doc. Subcollections stay.
#   --database <id> for a named database. -f file.json or -f - (stdin) instead of -d.

gcp-cli users list -p PROJ [-l 100]
gcp-cli users get <uid|email|+phone> -p PROJ
gcp-cli users create -p PROJ --email a@b.co --password '...' [--display-name] [--uid] [--email-verified]
gcp-cli users update <uid|email> -p PROJ -d '{"displayName":"Ann","disableUser":true,"customAttributes":{"admin":true}}'
gcp-cli users delete <uid|email> -p PROJ --yes

gcp-cli gcloud <args...>                          # gcloud with the same identity
gcp-cli firebase <args...>                        # firebase-tools
```

## Firestore value types

Output and input use `$` wrappers: `{"$timestamp":"2026-01-01T00:00:00Z"}`, `{"$ref":"users/abc"}`, `{"$geo":[lat,lng]}`, `{"$bytes":"base64"}`. Input only: `{"$serverTimestamp":true}`, `{"$delete":true}`, `{"$increment":1}`.

Where-clause values parse as JSON when they can: `-w "age >= 21"` is a number, `-w 'tags array-contains "a"'` is a string, `-w "status == active"` falls back to a string.

## Rules

- Deletes need `--yes`. Confirm with the user before you delete documents, users, or anything through `gcloud`/`firebase` in a production project.
- Delete a whole collection: `gcp-cli firebase firestore:delete -r <collection> --project PROJ` (confirm first).
- Do not delete projects, change billing, or change IAM unless the user asks for that exact change.

## Auth

Uses `GOOGLE_APPLICATION_CREDENTIALS` from `.env` (a service account key) when set. If it is not set, the tool uses your own gcloud login (Application Default Credentials). `GCP_QUOTA_PROJECT` in `.env` (now `genco-38c28`) is billed for API quota on calls that are not tied to one project.

There is no `firebase login`. firebase-tools uses the gcloud login instead, but it needs `GOOGLE_CLOUD_QUOTA_PROJECT` set. `gcp-cli firebase ...` sets it for you. Prefer that over bare `firebase`.

If a command reports `invalid_grant`, "Reauthentication failed", or "Could not load the default credentials", the human must log in again: `gcloud auth login --update-adc` (opens a browser).
