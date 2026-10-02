import { Command } from "commander";
import {
  DocumentReference,
  FieldValue,
  Firestore,
  GeoPoint,
  Timestamp,
  type Query,
  type WhereFilterOp,
} from "@google-cloud/firestore";
import { KEY_FILE } from "../config.js";
import { projectOf } from "../lib/google.js";
import { fail, ok, requireYes } from "../lib/output.js";
import { parseValue, readPayload } from "../lib/data.js";

type Opts = { project?: string; database?: string };

function db(opts: Opts): Firestore {
  const projectId = projectOf(opts);
  return new Firestore({
    projectId,
    databaseId: opts.database || "(default)",
    keyFilename: KEY_FILE,
    // Bill API quota to the target project when running on a user login.
    ...(KEY_FILE ? {} : { quotaProjectId: projectId }),
  } as any);
}

// Firestore value -> plain JSON. Special types use $-prefixed wrappers.
export function toJSON(v: any): any {
  if (v === null || v === undefined) return v ?? null;
  if (v instanceof Timestamp) return { $timestamp: v.toDate().toISOString() };
  if (v instanceof DocumentReference) return { $ref: v.path };
  if (v instanceof GeoPoint) return { $geo: [v.latitude, v.longitude] };
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { $bytes: Buffer.from(v).toString("base64") };
  if (Array.isArray(v)) return v.map(toJSON);
  if (typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toJSON(x)]));
  return v;
}

// Plain JSON -> Firestore value. Accepts the same $-wrappers, plus
// {$serverTimestamp:true}, {$delete:true}, {$increment:n}.
function fromJSON(store: Firestore, v: any): any {
  if (Array.isArray(v)) return v.map((x) => fromJSON(store, x));
  if (v && typeof v === "object") {
    const keys = Object.keys(v);
    if (keys.length === 1) {
      const [k] = keys;
      const x = v[k];
      if (k === "$timestamp") return Timestamp.fromDate(new Date(x));
      if (k === "$ref") return store.doc(x);
      if (k === "$geo") return new GeoPoint(x[0], x[1]);
      if (k === "$bytes") return Buffer.from(x, "base64");
      if (k === "$serverTimestamp") return FieldValue.serverTimestamp();
      if (k === "$delete") return FieldValue.delete();
      if (k === "$increment") return FieldValue.increment(x);
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fromJSON(store, x)]));
  }
  return v;
}

function docOut(snap: FirebaseFirestore.DocumentSnapshot) {
  return {
    id: snap.id,
    path: snap.ref.path,
    exists: snap.exists,
    createTime: snap.createTime?.toDate().toISOString(),
    updateTime: snap.updateTime?.toDate().toISOString(),
    data: snap.exists ? toJSON(snap.data()) : null,
  };
}

function isDocPath(path: string) {
  return path.split("/").filter(Boolean).length % 2 === 0;
}

function common(cmd: Command) {
  return cmd
    .option("-p, --project <id>", "GCP/Firebase project id")
    .option("--database <id>", "Firestore database id", "(default)");
}

export function registerFirestore(program: Command) {
  const fs = program.command("firestore").alias("fs").description("Firestore documents: get, list, query, set, update, delete");

  common(fs.command("get <docPath>").description("Read one document"))
    .action(async (path: string, opts: Opts) => {
      if (!isDocPath(path)) fail(`${path} is a collection path, not a document path`, "BAD_PATH");
      ok(docOut(await db(opts).doc(path).get()));
    });

  common(fs.command("collections [docPath]").description("List collection ids at the root or under a document"))
    .action(async (path: string | undefined, opts: Opts) => {
      const store = db(opts);
      const cols = path ? await store.doc(path).listCollections() : await store.listCollections();
      ok(cols.map((c) => c.id));
    });

  common(fs.command("list <collectionPath>").description("List documents in a collection"))
    .option("-l, --limit <n>", "Max documents", "25")
    .option("--ids", "Only return document ids (includes missing parent docs)")
    .action(async (path: string, opts: Opts & { limit: string; ids?: boolean }) => {
      const col = db(opts).collection(path);
      if (opts.ids) {
        const refs = await col.listDocuments();
        return ok(refs.slice(0, Number(opts.limit)).map((r) => r.id));
      }
      const snap = await col.limit(Number(opts.limit)).get();
      ok(snap.docs.map(docOut));
    });

  common(fs.command("query <collectionPath>").description("Query a collection (use --group for a collection group)"))
    .option("-w, --where <clause...>", 'Filter, e.g. "status == active" or "age >= 21". Values are JSON when they parse.')
    .option("-o, --order-by <field>", "Order by field; append ' desc' for descending")
    .option("-l, --limit <n>", "Max documents", "25")
    .option("--group", "Treat the argument as a collection group id")
    .option("--count", "Only return the number of matching documents")
    .action(async (path: string, opts: Opts & { where?: string[]; orderBy?: string; limit: string; group?: boolean; count?: boolean }) => {
      const store = db(opts);
      let q: Query = opts.group ? store.collectionGroup(path) : store.collection(path);
      for (const clause of opts.where || []) {
        const m = clause.match(/^\s*(\S+)\s+(==|!=|<=|>=|<|>|array-contains-any|array-contains|not-in|in)\s+(.+)$/);
        if (!m) fail(`Cannot parse where clause: ${clause}`, "BAD_WHERE");
        q = q.where(m[1], m[2] as WhereFilterOp, fromJSON(store, parseValue(m[3].trim())));
      }
      if (opts.orderBy) {
        const [field, dir] = opts.orderBy.split(/\s+/);
        q = q.orderBy(field, dir === "desc" ? "desc" : "asc");
      }
      if (opts.count) {
        const agg = await q.count().get();
        return ok({ count: agg.data().count });
      }
      const snap = await q.limit(Number(opts.limit)).get();
      ok(snap.docs.map(docOut));
    });

  common(fs.command("add <collectionPath>").description("Create a document with an auto id"))
    .option("-d, --data <json>", "Document JSON")
    .option("-f, --file <path>", "Read JSON from file, or - for stdin")
    .action(async (path: string, opts: Opts & { data?: string; file?: string }) => {
      const store = db(opts);
      const ref = await store.collection(path).add(fromJSON(store, readPayload(opts)));
      ok(docOut(await ref.get()));
    });

  common(fs.command("set <docPath>").description("Create or overwrite a document"))
    .option("-d, --data <json>", "Document JSON")
    .option("-f, --file <path>", "Read JSON from file, or - for stdin")
    .option("--merge", "Merge into the existing document instead of replacing it")
    .action(async (path: string, opts: Opts & { data?: string; file?: string; merge?: boolean }) => {
      const store = db(opts);
      const ref = store.doc(path);
      await ref.set(fromJSON(store, readPayload(opts)), { merge: !!opts.merge });
      ok(docOut(await ref.get()));
    });

  common(fs.command("update <docPath>").description("Update fields on an existing document (dot paths ok)"))
    .option("-d, --data <json>", 'Fields JSON, e.g. {"profile.name":"Ann","old":{"$delete":true}}')
    .option("-f, --file <path>", "Read JSON from file, or - for stdin")
    .action(async (path: string, opts: Opts & { data?: string; file?: string }) => {
      const store = db(opts);
      const ref = store.doc(path);
      await ref.update(fromJSON(store, readPayload(opts)));
      ok(docOut(await ref.get()));
    });

  common(fs.command("delete <docPath>").description("Delete one document (subcollections stay)"))
    .option("-y, --yes", "Confirm the delete")
    .action(async (path: string, opts: Opts & { yes?: boolean }) => {
      if (!isDocPath(path)) fail(`${path} is a collection. Use: gcp-cli firebase firestore:delete -r ${path}`, "BAD_PATH");
      requireYes(opts, `delete ${path}`);
      const ref = db(opts).doc(path);
      const before = await ref.get();
      await ref.delete();
      ok({ deleted: path, existed: before.exists, data: before.exists ? toJSON(before.data()) : null });
    });
}
