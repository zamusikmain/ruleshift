import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadModule } from "./load.mjs";

test("teardown targets staging only and removes its class and bindings before deletion", () => {
  const config = JSON.parse(readFileSync(new URL("../wrangler.staging-retire.jsonc", import.meta.url), "utf8"));
  assert.equal(config.name, "ruleshift-2-staging");
  assert.equal(config.workers_dev, false);
  assert.deepEqual(config.routes, []);
  assert.equal(config.durable_objects, undefined);
  assert.equal(config.assets, undefined);
  assert.deepEqual(config.migrations.at(-1), { tag: "staging-retire-v2", deleted_classes: ["GameRoom"] });
  assert.equal(config.main, "worker/staging-retired.ts");
  assert.equal(/export.*GameRoom/.test(readFileSync(new URL("../worker/staging-retired.ts", import.meta.url), "utf8")), false);
});

test("staging uses an independent Worker-owned DO namespace and no external resources", () => {
  const config = JSON.parse(readFileSync(new URL("../wrangler.staging.jsonc", import.meta.url), "utf8"));
  assert.equal(config.name, "ruleshift-2-staging");
  assert.equal(config.main, "worker/index.ts");
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, []);
  assert.deepEqual(config.assets, { directory: "./dist", binding: "ASSETS", run_worker_first: ["/api/*"] });
  assert.deepEqual(config.durable_objects.bindings, [{ name: "ROOMS", class_name: "GameRoom" }]);
  assert.deepEqual(config.migrations, [{ tag: "v1", new_sqlite_classes: ["GameRoom"] }]);
  for (const key of ["services", "kv_namespaces", "d1_databases", "r2_buckets", "vars", "env", "account_id", "dispatch_namespaces", "unsafe", "queues", "send_email", "secrets_store_secrets", "workflows", "vectorize", "hyperdrive"])
    assert.equal(config[key], undefined, `${key} must not couple staging to another environment`);
});

test("staging client and Worker use the same protocol v8 and same-origin routing", () => {
  assert.equal(loadModule("shared/protocol").PROTOCOL_VERSION, 8);
  const client = readFileSync(new URL("../src/online/client.ts", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.ok(client.includes('fetch("/api/rooms"'));
  assert.ok(client.includes('location.href'));
  assert.ok(client.includes('PROTOCOL_VERSION'));
  assert.ok(worker.includes('PROTOCOL_VERSION'));
  assert.equal(/ruleshift\.zamusik-play\.workers\.dev/.test(client + worker), false);
  for (const locale of ["en", "ru"])
    assert.ok(readFileSync(new URL(`../src/locales/${locale}.ts`, import.meta.url), "utf8").includes("versionMismatch:"));
});
