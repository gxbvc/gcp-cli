# gcp-cli

Google Cloud and Firebase for humans and agents, across all your projects.

The official CLIs (`gcloud` and `firebase`) do most jobs. They cannot read or write one Firestore document, and they cannot get, create, update, or delete one Firebase Auth user. `gcp-cli` adds those commands, a cross-project inventory, and passthrough to both official CLIs with the same identity.

## Prerequisites

- Node 20+
- Google Cloud SDK (`gcloud`): https://cloud.google.com/sdk/docs/install
- firebase-tools: `npm i -g firebase-tools`

## Setup

```bash
cd ~/tools/gcp-cli
npm install && npm run build && npm link

# Log in as yourself. --update-adc also writes the Application Default
# Credentials that gcp-cli reads.
gcloud auth login --update-adc
firebase login
```

To run agents as a service account instead of as yourself, put the key path in `.env` as `GOOGLE_APPLICATION_CREDENTIALS` (see `.env.example`), then give that service account roles on each project.

## Commands

See [AGENTS.md](AGENTS.md) for the full command list and examples.

## How it works

- `projects` and `inventory` call the Google REST APIs directly (Resource Manager, Cloud Billing, Service Usage, Firebase Management, Hosting, Firestore, Realtime Database, Identity Toolkit, Cloud Functions, Cloud Run, Storage, Compute, Cloud SQL, App Engine, API Keys). Inventory only calls an API when that API is turned on in the project, so it does not turn anything on.
- `firestore` uses `@google-cloud/firestore`.
- `users` calls the Identity Toolkit REST API, which is what the Firebase Admin SDK uses.
- When you use your own login, requests send `x-goog-user-project: <project>` so quota is billed to the target project.
- `gcloud` and `firebase` subcommands run the real CLIs. With a service account key, gcloud gets `CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE`.
