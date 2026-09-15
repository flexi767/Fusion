/**
 * Drizzle schema for the central (global coordination) database.
 *
 * FNXC:PostgresSchema 2026-06-24-03:00:
 * Snapshotted from CENTRAL_SCHEMA_SQL in packages/core/src/central-db.ts
 * (CENTRAL_SCHEMA_VERSION=13). All migrations through v13 are collapsed into
 * the final shape: every ALTER TABLE ADD COLUMN from v2/v3/v4/v7 is folded
 * into the base table definition, and every CREATE TABLE migration is merged.
 *
 * Central DB stores the project registry, unified activity feed, global
 * concurrency limits, node mesh state, plugin install registry, durable mesh
 * shared-state snapshots, offline write queue, global secrets, and the
 * authoritative cross-node task claims table.
 */

import {
  boolean,
  pgSchema,
  text,
  integer,
  bigint,
  jsonb,
  primaryKey,
  foreignKey,
  unique,
  check,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { CENTRAL_SCHEMA, bytea } from "./_shared.js";

/**
 * FNXC:PostgresSchema 2026-06-24-03:00:
 * Dedicated PostgreSQL schema for the central database. Isolation topology
 * (VAL-SCHEMA-008): project/central/archive are distinct schemas in one cluster.
 */
export const centralSchema = pgSchema(CENTRAL_SCHEMA);

// ── Projects (project registry) ──────────────────────────────────────
export const projects = centralSchema.table("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  path: text("path").notNull().unique(),
  status: text("status").notNull().default("active"),
  isolationMode: text("isolation_mode").notNull().default("in-process"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  lastActivityAt: text("last_activity_at"),
  nodeId: text("node_id"),
  settings: jsonb("settings"),
}, (t) => [
  index("idxProjectsPath").on(t.path),
  index("idxProjectsStatus").on(t.status),
]);

// ── Nodes (runtime hosts) ────────────────────────────────────────────
export const nodes = centralSchema.table("nodes", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  type: text("type").notNull(),
  url: text("url"),
  apiKey: text("api_key"),
  status: text("status").notNull().default("offline"),
  capabilities: jsonb("capabilities"),
  systemMetrics: jsonb("system_metrics"),
  knownPeers: jsonb("known_peers"),
  versionInfo: jsonb("version_info"),
  pluginVersions: jsonb("plugin_versions"),
  dockerConfig: jsonb("docker_config"),
  maxConcurrent: integer("max_concurrent").notNull().default(2),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [
  check("nodes_type_check", sql`${t.type} IN ('local', 'remote')`),
  index("idxNodesStatus").on(t.status),
  index("idxNodesType").on(t.type),
]);

// ── Per-project, per-node working directory mappings ─────────────────
export const projectNodePathMappings = centralSchema.table("project_node_path_mappings", {
  projectId: text("project_id").notNull(),
  nodeId: text("node_id").notNull(),
  path: text("path").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.projectId, t.nodeId] }),
  foreignKey({ columns: [t.projectId], foreignColumns: [projects.id] }).onDelete("cascade"),
  foreignKey({ columns: [t.nodeId], foreignColumns: [nodes.id] }).onDelete("cascade"),
  index("idxProjectNodePathMappingsProjectId").on(t.projectId),
  index("idxProjectNodePathMappingsNodeId").on(t.nodeId),
]);

// ── Project health ───────────────────────────────────────────────────
export const projectHealth = centralSchema.table("project_health", {
  projectId: text("project_id").primaryKey(),
  status: text("status").notNull(),
  activeTaskCount: integer("active_task_count").default(0),
  inFlightAgentCount: integer("in_flight_agent_count").default(0),
  lastActivityAt: text("last_activity_at"),
  lastErrorAt: text("last_error_at"),
  lastErrorMessage: text("last_error_message"),
  totalTasksCompleted: integer("total_tasks_completed").default(0),
  totalTasksFailed: integer("total_tasks_failed").default(0),
  averageTaskDurationMs: integer("average_task_duration_ms"),
  updatedAt: text("updated_at").notNull(),
}, (t) => [foreignKey({ columns: [t.projectId], foreignColumns: [projects.id] }).onDelete("cascade")]);

// ── Central activity log ─────────────────────────────────────────────
export const centralActivityLog = centralSchema.table("central_activity_log", {
  id: text("id").primaryKey(),
  timestamp: text("timestamp").notNull(),
  type: text("type").notNull(),
  projectId: text("project_id").notNull(),
  projectName: text("project_name").notNull(),
  taskId: text("task_id"),
  taskTitle: text("task_title"),
  details: text("details").notNull(),
  metadata: jsonb("metadata"),
}, (t) => [
  foreignKey({ columns: [t.projectId], foreignColumns: [projects.id] }).onDelete("cascade"),
  index("idxActivityLogTimestamp").on(t.timestamp),
  index("idxActivityLogType").on(t.type),
  index("idxActivityLogProjectId").on(t.projectId),
  index("idxCentralActivityLogTaskIdTimestamp").on(t.taskId, t.timestamp),
]);

// ── Global concurrency state (single row) ────────────────────────────
/*
FNXC:CapacityModel 2026-07-29-08:10 (drop the cross-project cap — table half):
The `global_concurrency` singleton table is DELETED (migration 0037). It held the
machine-wide agent cap plus currently_active/queued_count counters whose only
writers — acquireGlobalSlot/releaseGlobalSlot — had no production caller. Capacity
is two numbers PER PROJECT; live cross-project telemetry comes from
CentralCore.getLiveRunningAgentCounts, never from a persisted counter.
*/

// ── Central settings (single row) ────────────────────────────────────
export const centralSettings = centralSchema.table("central_settings", {
  id: integer("id").primaryKey(),
  defaultProjectId: text("default_project_id"),
  updatedAt: text("updated_at").notNull(),
}, (t) => [check("central_settings_id_check", sql`${t.id} = 1`)]);

// ── Peer nodes ───────────────────────────────────────────────────────
export const peerNodes = centralSchema.table("peer_nodes", {
  id: text("id").primaryKey(),
  nodeId: text("node_id").notNull(),
  peerNodeId: text("peer_node_id").notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  status: text("status").notNull().default("unknown"),
  lastSeen: text("last_seen").notNull(),
  connectedAt: text("connected_at").notNull(),
}, (t) => [
  unique("peer_nodes_node_id_peer_node_id_unique").on(t.nodeId, t.peerNodeId),
  foreignKey({ columns: [t.nodeId], foreignColumns: [nodes.id] }).onDelete("cascade"),
  index("idxPeerNodesNodeId").on(t.nodeId),
]);

// ── Settings sync state ──────────────────────────────────────────────
export const settingsSyncState = centralSchema.table("settings_sync_state", {
  nodeId: text("node_id").notNull(),
  remoteNodeId: text("remote_node_id").notNull(),
  lastSyncedAt: text("last_synced_at"),
  localChecksum: text("local_checksum"),
  remoteChecksum: text("remote_checksum"),
  syncCount: integer("sync_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.nodeId, t.remoteNodeId] }),
  foreignKey({ columns: [t.nodeId], foreignColumns: [nodes.id] }).onDelete("cascade"),
  index("idxSettingsSyncNode").on(t.nodeId),
]);

// ── Managed Docker nodes ─────────────────────────────────────────────
export const managedDockerNodes = centralSchema.table("managed_docker_nodes", {
  id: text("id").primaryKey(),
  nodeId: text("node_id"),
  name: text("name").notNull().unique(),
  imageName: text("image_name").notNull(),
  imageTag: text("image_tag").notNull(),
  containerId: text("container_id"),
  status: text("status").notNull().default("creating"),
  hostConfig: jsonb("host_config").notNull().default({}),
  envVars: jsonb("env_vars").notNull().default({}),
  volumeMounts: jsonb("volume_mounts").notNull().default([]),
  resourceSizing: jsonb("resource_sizing").notNull().default({}),
  extraClis: jsonb("extra_clis").notNull().default([]),
  persistentStorage: integer("persistent_storage").notNull().default(1),
  reachableUrl: text("reachable_url"),
  apiKey: text("api_key"),
  errorMessage: text("error_message"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [
  foreignKey({ columns: [t.nodeId], foreignColumns: [nodes.id] }).onDelete("set null"),
  index("idxManagedDockerNodesStatus").on(t.status),
  index("idxManagedDockerNodesNodeId").on(t.nodeId),
]);

// ── Global plugin install registry ───────────────────────────────────
export const pluginInstalls = centralSchema.table("plugin_installs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  version: text("version").notNull(),
  description: text("description"),
  author: text("author"),
  homepage: text("homepage"),
  path: text("path").notNull(),
  settings: jsonb("settings").default({}),
  settingsSchema: jsonb("settings_schema"),
  dependencies: jsonb("dependencies").default([]),
  aiScanOnLoad: integer("ai_scan_on_load").notNull().default(0),
  lastSecurityScan: text("last_security_scan"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const projectPluginStates = centralSchema.table("project_plugin_states", {
  projectPath: text("project_path").notNull(),
  pluginId: text("plugin_id").notNull(),
  enabled: integer("enabled").notNull().default(0),
  state: text("state").notNull().default("installed"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.projectPath, t.pluginId] }),
  foreignKey({ columns: [t.pluginId], foreignColumns: [pluginInstalls.id] }).onDelete("cascade"),
  index("idxProjectPluginStatesProjectPath").on(t.projectPath),
  index("idxProjectPluginStatesPluginId").on(t.pluginId),
]);

// ── Mesh shared-state snapshots ──────────────────────────────────────
export const meshSharedSnapshots = centralSchema.table("mesh_shared_snapshots", {
  nodeId: text("node_id").notNull(),
  projectId: text("project_id"),
  scope: text("scope").notNull(),
  payload: jsonb("payload").notNull(),
  snapshotVersion: text("snapshot_version").notNull(),
  capturedAt: text("captured_at").notNull(),
  sourceNodeId: text("source_node_id"),
  sourceRunId: text("source_run_id"),
  staleAfter: text("stale_after"),
  updatedAt: text("updated_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.nodeId, t.projectId, t.scope] }),
  index("idxMeshSharedSnapshotsLookup").on(t.nodeId, t.projectId, t.scope),
]);

// ── Mesh offline write queue ─────────────────────────────────────────
export const meshWriteQueue = centralSchema.table("mesh_write_queue", {
  id: text("id").primaryKey(),
  originNodeId: text("origin_node_id").notNull(),
  targetNodeId: text("target_node_id").notNull(),
  projectId: text("project_id"),
  scope: text("scope").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  operation: text("operation").notNull(),
  payload: jsonb("payload").notNull(),
  intentVersion: text("intent_version").notNull(),
  status: text("status").notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  lastAttemptAt: text("last_attempt_at"),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  appliedAt: text("applied_at"),
}, (t) => [
  check("mesh_write_queue_status_check", sql`${t.status} IN ('pending', 'replaying', 'applied', 'failed')`),
  index("idxMeshWriteQueueReplay").on(t.targetNodeId, t.status, t.createdAt, t.id),
]);

// ── Global secrets ───────────────────────────────────────────────────
export const secretsGlobal = centralSchema.table("secrets_global", {
  id: text("id").primaryKey(),
  key: text("key").notNull(),
  valueCiphertext: bytea("value_ciphertext").notNull(),
  nonce: bytea("nonce").notNull(),
  description: text("description"),
  accessPolicy: text("access_policy").notNull().default("auto"),
  envExportable: integer("env_exportable").notNull().default(0),
  envExportKey: text("env_export_key"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  lastReadAt: text("last_read_at"),
  lastReadBy: text("last_read_by"),
}, (t) => [
  unique("secrets_global_key_unique").on(t.key),
  check("secrets_global_access_policy_check", sql`${t.accessPolicy} IN ('auto', 'prompt', 'deny')`),
  check("secrets_global_env_exportable_check", sql`${t.envExportable} IN (0, 1)`),
]);

// ── Authoritative cross-node task claims ─────────────────────────────
export const taskClaims = centralSchema.table("task_claims", {
  projectId: text("project_id").notNull(),
  taskId: text("task_id").notNull(),
  ownerNodeId: text("owner_node_id").notNull(),
  ownerAgentId: text("owner_agent_id").notNull(),
  ownerRunId: text("owner_run_id"),
  leaseEpoch: integer("lease_epoch").notNull(),
  leaseRenewedAt: text("lease_renewed_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.projectId, t.taskId] }),
  index("idxTaskClaimsOwner").on(t.ownerNodeId),
]);

/** FNXC:SettingsBackups 2026-07-16-15:00: a unique central name makes a shared-cluster routine impossible to duplicate per project. */
export const globalRoutines = centralSchema.table("global_routines", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  agentId: text("agent_id").notNull().default(""),
  triggerType: text("trigger_type").notNull(),
  triggerConfig: jsonb("trigger_config").notNull(),
  command: text("command"),
  enabled: integer("enabled").notNull().default(1),
  lastRunAt: text("last_run_at"),
  lastRunResult: jsonb("last_run_result"),
  nextRunAt: text("next_run_at"),
  runCount: integer("run_count").notNull().default(0),
  runHistory: jsonb("run_history").notNull().default([]),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// External agents never participate in project task lifecycle or project-path matching.
export const sessionCollectors = centralSchema.table("session_collectors", {
  hostId: text("host_id").primaryKey(),
  collectorVersion: text("collector_version").notNull(),
  lastHeartbeatAt: text("last_heartbeat_at"),
  lastAcknowledgementAt: text("last_acknowledgement_at"),
  diagnostics: jsonb("diagnostics").notNull().default({}),
});
export const externalSessions = centralSchema.table("external_sessions", {
  id: text("id").primaryKey(),
  hostId: text("host_id").notNull().references(() => sessionCollectors.hostId),
  provider: text("provider").notNull(),
  nativeSessionId: text("native_session_id").notNull(),
  revision: bigint("revision", { mode: "number" }).notNull(),
  observation: jsonb("observation").$type<import("../../external-sessions/observation.js").SessionObservation>().notNull(),
  receivedAt: text("received_at").notNull(),
}, (table) => [unique("external_sessions_host_native").on(table.hostId, table.provider, table.nativeSessionId)]);

export const externalSessionTurns = centralSchema.table("external_session_turns", {
  sessionId: text("session_id").notNull().references(() => externalSessions.id, { onDelete: "cascade" }),
  id: text("id").notNull(), revision: bigint("revision", { mode: "number" }).notNull(),
  startedAt: text("started_at").notNull(),
  result: jsonb("result").$type<import("../../external-sessions/turn.js").SessionTurn>().notNull(),
}, (table) => [primaryKey({ columns: [table.sessionId, table.id] })]);

export const externalSessionDetails = centralSchema.table("external_session_details", {
  sessionId: text("session_id").primaryKey().references(() => externalSessions.id, { onDelete: "cascade" }),
  importedMetadata: jsonb("imported_metadata").$type<import("../../external-sessions/imported-metadata.js").ImportedSessionMetadata>(),
  archived: boolean("archived").notNull().default(false), pinned: boolean("pinned").notNull().default(false),
  preferencesRevision: bigint("preferences_revision", { mode: "number" }).notNull().default(0),
  notes: text("notes").notNull().default(""), notesRevision: bigint("notes_revision", { mode: "number" }).notNull().default(0),
  summary: jsonb("summary").$type<{ text: string; at: string; firstTurn: string; lastTurn: string; coveredTurns: number; model: string }>(),
  summaryHash: text("summary_hash"), summaryLeaseUntil: text("summary_lease_until"), summaryRetryAt: text("summary_retry_at"),
  summaryFailures: integer("summary_failures").notNull().default(0), lastSummaryError: text("last_summary_error"),
});
export const externalSessionCommands = centralSchema.table("external_session_commands", {
  id: text("id").primaryKey(), sessionId: text("session_id").notNull().references(() => externalSessions.id, { onDelete: "cascade" }),
  hostId: text("host_id").notNull(), nativeSessionId: text("native_session_id").notNull(), generation: text("generation").notNull(),
  operation: text("operation").notNull(), text: text("text"), status: text("status").notNull(), createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(), updatedAt: text("updated_at").notNull(), failure: text("failure"),
});
export const externalSessionRuntimes = centralSchema.table("external_session_runtimes", {
  sessionId: text("session_id").primaryKey().references(() => externalSessions.id, { onDelete: "cascade" }),
  generation: text("generation").notNull(), capabilities: jsonb("capabilities").$type<string[]>().notNull(), expiresAt: text("expires_at").notNull(),
});

// ── Schema version meta ──────────────────────────────────────────────
export const centralMeta = centralSchema.table("__meta", {
  key: text("key").primaryKey(),
  value: text("value"),
});

/**
 * FNXC:PostgresSchema 2026-06-24-03:05:
 * Registry of all central-schema table names.
 */
export const centralTableNames = [
  "projects", "nodes", "project_node_path_mappings", "project_health",
  "central_activity_log", "central_settings",
  "peer_nodes", "settings_sync_state", "managed_docker_nodes",
  "plugin_installs", "project_plugin_states", "mesh_shared_snapshots",
  "mesh_write_queue", "secrets_global", "task_claims", "global_routines", "session_collectors", "external_sessions", "external_session_turns", "external_session_details", "external_session_commands", "external_session_runtimes", "__meta",
] as const;
