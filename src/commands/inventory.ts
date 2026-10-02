import { Command } from "commander";
import { api, paged } from "../lib/google.js";
import { ok } from "../lib/output.js";
import { listProjects } from "./projects.js";

// Run a check and record its error instead of failing the whole inventory.
async function safe<T>(errors: Record<string, string>, key: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e: any) {
    errors[key] = e?.message || String(e);
    return undefined;
  }
}

// Count Auth users (up to `cap`) and find the newest sign-in and sign-up.
async function authSummary(project: string, cap: number) {
  let count = 0;
  let lastLogin = 0;
  let lastCreated = 0;
  let nextPageToken: string | undefined;
  do {
    const data: any = await api(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:batchGet`, {
      quotaProject: project,
      params: { maxResults: 1000, nextPageToken },
    });
    for (const u of data?.users || []) {
      count++;
      lastLogin = Math.max(lastLogin, Number(u.lastLoginAt || 0));
      lastCreated = Math.max(lastCreated, Number(u.createdAt || 0));
    }
    nextPageToken = data?.nextPageToken;
  } while (nextPageToken && count < cap);
  const iso = (ms: number) => (ms ? new Date(ms).toISOString() : null);
  return { count: nextPageToken ? `${count}+` : count, lastLogin: iso(lastLogin), lastSignup: iso(lastCreated) };
}

// Sum a Cloud Monitoring metric over the last `days`, optionally grouped by one label.
// Gauges (sizes) use the mean of the last day instead.
async function metric(project: string, type: string, opts: { groupBy?: string; gauge?: boolean; days?: number } = {}) {
  const days = opts.gauge ? 2 : opts.days || 30;
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400_000);
  const data: any = await api(`https://monitoring.googleapis.com/v3/projects/${project}/timeSeries`, {
    params: {
      filter: `metric.type="${type}"`,
      "interval.startTime": start.toISOString(),
      "interval.endTime": end.toISOString(),
      "aggregation.alignmentPeriod": `${opts.gauge ? 86400 : days * 86400}s`,
      "aggregation.perSeriesAligner": opts.gauge ? "ALIGN_MEAN" : "ALIGN_SUM",
      "aggregation.crossSeriesReducer": "REDUCE_SUM",
      "aggregation.groupByFields": opts.groupBy,
    },
  });
  const val = (s: any) => {
    const pt = s.points?.[0]?.value || {};
    return Math.round(Number(pt.int64Value ?? pt.doubleValue ?? 0));
  };
  const series = data?.timeSeries || [];
  if (!opts.groupBy) return series.reduce((n: number, s: any) => n + val(s), 0);
  const label = opts.groupBy.split(".").pop()!;
  return Object.fromEntries(series.map((s: any) => [s.resource?.labels?.[label] ?? s.metric?.labels?.[label], val(s)]));
}

async function usage(project: string, has: (svc: string) => boolean, errors: Record<string, string>) {
  const out: Record<string, any> = {};
  const tasks: [string, string, Parameters<typeof metric>[2]][] = [];
  if (has("run.googleapis.com")) tasks.push(["cloudRunRequests", "run.googleapis.com/request_count", { groupBy: "resource.label.service_name" }]);
  if (has("cloudfunctions.googleapis.com"))
    tasks.push(["gen1FunctionCalls", "cloudfunctions.googleapis.com/function/execution_count", { groupBy: "resource.label.function_name" }]);
  if (has("firestore.googleapis.com")) {
    tasks.push(["firestoreReads", "firestore.googleapis.com/document/read_ops_count", {}]);
    tasks.push(["firestoreWrites", "firestore.googleapis.com/document/write_ops_count", {}]);
    tasks.push(["firestoreBytes", "firestore.googleapis.com/storage/data_and_index_storage_bytes", { gauge: true }]);
  }
  if (has("firebasehosting.googleapis.com"))
    tasks.push(["hostingBytesSent", "firebasehosting.googleapis.com/network/sent_bytes_count", { groupBy: "resource.label.site_name" }]);
  if (has("storage.googleapis.com") || has("storage-component.googleapis.com"))
    tasks.push(["bucketBytes", "storage.googleapis.com/storage/total_bytes", { gauge: true, groupBy: "resource.label.bucket_name" }]);
  if (has("appengine.googleapis.com"))
    tasks.push(["appEngineResponses", "appengine.googleapis.com/http/server/response_count", { groupBy: "resource.label.module_id" }]);
  await Promise.all(
    tasks.map(([key, type, o]) =>
      metric(project, type, o)
        .then((v) => void (out[key] = v))
        .catch((e) => void (errors[`usage.${key}`] = e.message)),
    ),
  );
  return out;
}

async function inventoryProject(p: any, opts: { authCap: number }) {
  const id = p.projectId;
  const errors: Record<string, string> = {};
  const q = { quotaProject: id };
  const out: any = { ...p, errors };

  const billing: any = await safe(errors, "billing", () => api(`https://cloudbilling.googleapis.com/v1/projects/${id}/billingInfo`));
  out.billing = billing ? { enabled: !!billing.billingEnabled, account: billing.billingAccountName?.split("/").pop() || null } : null;

  const services = await safe(errors, "services", () =>
    paged<any>(`https://serviceusage.googleapis.com/v1/projects/${id}/services`, "services", {
      ...q,
      params: { filter: "state:ENABLED", pageSize: 200 },
    }),
  );
  const enabled = new Set((services || []).map((s: any) => s.config?.name));
  out.enabledServices = [...enabled].sort();
  const has = (svc: string) => enabled.has(svc);

  const checks: Promise<void>[] = [];
  const add = (key: string, svc: string | null, fn: () => Promise<any>) => {
    if (svc && services && !has(svc)) return;
    checks.push(safe(errors, key, fn).then((v) => void (out[key] = v)));
  };

  add("firebaseApps", "firebase.googleapis.com", async () =>
    (await paged<any>(`https://firebase.googleapis.com/v1beta1/projects/${id}:searchApps`, "apps", { ...q, params: { pageSize: 100 } })).map(
      (a) => ({ platform: a.platform, name: a.displayName || null, appId: a.appId, namespace: a.namespace || null, state: a.state }),
    ),
  );

  add("hostingSites", "firebasehosting.googleapis.com", async () => {
    const sites = await paged<any>(`https://firebasehosting.googleapis.com/v1beta1/projects/${id}/sites`, "sites", q);
    return Promise.all(
      sites.map(async (s) => {
        const site = s.name.split("/").pop();
        const rel: any = await api(`https://firebasehosting.googleapis.com/v1beta1/sites/${site}/releases`, { ...q, params: { pageSize: 1 } }).catch(
          () => null,
        );
        const domains: any = await api(`https://firebasehosting.googleapis.com/v1beta1/sites/${site}/domains`, q).catch(() => null);
        return {
          site,
          url: s.defaultUrl,
          lastRelease: rel?.releases?.[0]?.releaseTime || null,
          customDomains: (domains?.domains || []).map((d: any) => d.domainName).filter((d: string) => !/\.(web\.app|firebaseapp\.com)$/.test(d)),
        };
      }),
    );
  });

  add("firestore", "firestore.googleapis.com", async () => {
    const data: any = await api(`https://firestore.googleapis.com/v1/projects/${id}/databases`, q);
    return Promise.all(
      (data?.databases || []).map(async (d: any) => {
        const dbId = d.name.split("/").pop();
        const cols: any = await api(`https://firestore.googleapis.com/v1/projects/${id}/databases/${dbId}/documents:listCollectionIds`, {
          ...q,
          body: { pageSize: 100 },
        }).catch((e) => ({ error: e.message }));
        return { database: dbId, type: d.type, location: d.locationId, collections: cols?.collectionIds || [], error: cols?.error };
      }),
    );
  });

  add("realtimeDatabases", "firebasedatabase.googleapis.com", async () =>
    (await paged<any>(`https://firebasedatabase.googleapis.com/v1beta/projects/${id}/locations/-/instances`, "instances", q)).map((i) => ({
      name: i.name.split("/").pop(),
      url: i.databaseUrl,
      type: i.type,
      state: i.state,
    })),
  );

  add("auth", "identitytoolkit.googleapis.com", () =>
    authSummary(id, opts.authCap).catch((e) => {
      if (/CONFIGURATION_NOT_FOUND/.test(e.message)) return null; // Auth never set up
      throw e;
    }),
  );

  if (services) checks.push(usage(id, has, errors).then((u) => void (out.usage30d = u)));

  add("functions", "cloudfunctions.googleapis.com", async () =>
    (await paged<any>(`https://cloudfunctions.googleapis.com/v2/projects/${id}/locations/-/functions`, "functions", q)).map((f) => ({
      name: f.name.split("/").pop(),
      region: f.name.split("/")[3],
      gen: f.environment === "GEN_1" ? 1 : 2,
      runtime: f.buildConfig?.runtime,
      state: f.state,
      updated: f.updateTime,
    })),
  );

  add("cloudRun", "run.googleapis.com", async () =>
    (await paged<any>(`https://run.googleapis.com/v2/projects/${id}/locations/-/services`, "services", q)).map((s) => ({
      name: s.name.split("/").pop(),
      region: s.name.split("/")[3],
      url: s.uri,
      updated: s.updateTime,
    })),
  );

  add("buckets", "storage.googleapis.com", async () =>
    (await paged<any>(`https://storage.googleapis.com/storage/v1/b`, "items", { ...q, params: { project: id } })).map((b) => ({
      name: b.name,
      location: b.location,
      storageClass: b.storageClass,
      created: b.timeCreated,
    })),
  );

  add("computeInstances", "compute.googleapis.com", async () => {
    const data: any = await api(`https://compute.googleapis.com/compute/v1/projects/${id}/aggregated/instances`, q);
    return Object.values(data?.items || {})
      .flatMap((z: any) => z.instances || [])
      .map((i: any) => ({ name: i.name, zone: i.zone?.split("/").pop(), machineType: i.machineType?.split("/").pop(), status: i.status }));
  });

  add("cloudSql", "sqladmin.googleapis.com", async () => {
    const data: any = await api(`https://sqladmin.googleapis.com/v1/projects/${id}/instances`, q);
    return (data?.items || []).map((i: any) => ({ name: i.name, version: i.databaseVersion, tier: i.settings?.tier, state: i.state }));
  });

  add("appEngine", "appengine.googleapis.com", async () => {
    const app: any = await api(`https://appengine.googleapis.com/v1/apps/${id}`, q).catch(() => null);
    if (!app) return null;
    const svcs: any = await api(`https://appengine.googleapis.com/v1/apps/${id}/services`, q).catch(() => null);
    return { location: app.locationId, servingStatus: app.servingStatus, url: app.defaultHostname, services: (svcs?.services || []).map((s: any) => s.id) };
  });

  add("apiKeys", "apikeys.googleapis.com", async () =>
    (await paged<any>(`https://apikeys.googleapis.com/v2/projects/${id}/locations/global/keys`, "keys", q)).map((k) => ({
      name: k.displayName || k.uid,
      created: k.createTime,
    })),
  );

  await Promise.all(checks);
  return out;
}

// Run `fn` over items with at most `n` running at once.
async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
        process.stderr.write(`. ${(items[idx] as any).projectId}\n`);
      }
    }),
  );
  return out;
}

export function registerInventory(program: Command) {
  program
    .command("inventory")
    .description("Describe what runs in each project: billing, Firebase apps, hosting, Firestore, Auth, functions, Run, buckets, VMs, SQL")
    .option("-p, --project <id...>", "Only these projects (default: all active projects)")
    .option("--auth-cap <n>", "Stop counting Auth users after this many per project", "5000")
    .option("--concurrency <n>", "Projects to scan at once", "6")
    .action(async (opts: { project?: string[]; authCap: string; concurrency: string }) => {
      let projects = await listProjects();
      if (opts.project) projects = projects.filter((p) => opts.project!.includes(p.projectId));
      ok(await pool(projects, Number(opts.concurrency), (p) => inventoryProject(p, { authCap: Number(opts.authCap) })));
    });
}
