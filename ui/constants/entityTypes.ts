/**
 * Catalogue of selectable Dynatrace entity types.
 *
 * `grailType`   — the Grail table used by `fetch <grailType>`.
 * `selectorType`— the classic entity-selector `type("…")` value, required by
 *                 the SLO API (which is a classic Environment API v2 endpoint
 *                 and does NOT understand Grail entity ids directly).
 *                 `null` means the type has no classic selector equivalent, so
 *                 SLO creation is not offered for it.
 */
export interface EntityTypeMeta {
  key: string;
  label: string;
  group: string;
  grailType: string;
  selectorType: string | null;
  /** Extra fields worth showing in the picker table, when present. */
  extraFields?: string[];
  /**
   * Some things you can monitor are NOT Grail entities — endpoints are the
   * main one: they exist only as the `endpoint.name` attribute on spans, so
   * `dt.entity.service_method` is empty even in environments full of traffic.
   * Virtual types are discovered from a signal table instead, and their
   * "id" is the attribute value rather than an ENTITY-XXXX id.
   */
  isVirtual?: boolean;
  /** For virtual types: the field carrying the value, e.g. `endpoint.name`. */
  virtualField?: string;
  /** For virtual types: the table to discover values from. */
  virtualSource?: "spans" | "logs";
}

export const ENTITY_TYPES: EntityTypeMeta[] = [
  // ── Services & code ──────────────────────────────────────────────────────
  { key: "service", label: "Services", group: "Services & code",
    grailType: "dt.entity.service", selectorType: "SERVICE" },
  // Real endpoints live on spans, not in `dt.entity.service_method` (which is
  // empty on Smartscape-on-Grail environments). This is what the Distributed
  // Tracing "Endpoint" facet shows.
  { key: "endpoint", label: "Endpoints", group: "Services & code",
    grailType: "endpoint.name", selectorType: null,
    isVirtual: true, virtualField: "endpoint.name", virtualSource: "spans" },
  { key: "service_method", label: "Service endpoints (classic)", group: "Services & code",
    grailType: "dt.entity.service_method", selectorType: "SERVICE_METHOD" },
  { key: "service_instance", label: "Service instances", group: "Services & code",
    grailType: "dt.entity.service_instance", selectorType: "SERVICE_INSTANCE" },
  { key: "process_group", label: "Process groups", group: "Services & code",
    grailType: "dt.entity.process_group", selectorType: "PROCESS_GROUP" },
  { key: "process_group_instance", label: "Process group instances", group: "Services & code",
    grailType: "dt.entity.process_group_instance", selectorType: "PROCESS_GROUP_INSTANCE" },

  // ── Frontend / RUM ───────────────────────────────────────────────────────
  { key: "application", label: "Web applications", group: "Frontend & RUM",
    grailType: "dt.entity.application", selectorType: "APPLICATION" },
  { key: "application_method", label: "User actions", group: "Frontend & RUM",
    grailType: "dt.entity.application_method", selectorType: "APPLICATION_METHOD" },
  { key: "mobile_application", label: "Mobile applications", group: "Frontend & RUM",
    grailType: "dt.entity.mobile_application", selectorType: "MOBILE_APPLICATION" },
  { key: "custom_application", label: "Custom applications", group: "Frontend & RUM",
    grailType: "dt.entity.custom_application", selectorType: "CUSTOM_APPLICATION" },

  // ── Infrastructure ───────────────────────────────────────────────────────
  { key: "host", label: "Hosts", group: "Infrastructure",
    grailType: "dt.entity.host", selectorType: "HOST",
    extraFields: ["osType", "hostGroupName", "cloudType"] },
  { key: "disk", label: "Disks", group: "Infrastructure",
    grailType: "dt.entity.disk", selectorType: "DISK" },
  { key: "custom_device", label: "Custom devices", group: "Infrastructure",
    grailType: "dt.entity.custom_device", selectorType: "CUSTOM_DEVICE" },

  // ── Kubernetes ───────────────────────────────────────────────────────────
  { key: "cloud_application", label: "K8s workloads", group: "Kubernetes",
    grailType: "dt.entity.cloud_application", selectorType: "CLOUD_APPLICATION" },
  { key: "cloud_application_namespace", label: "K8s namespaces", group: "Kubernetes",
    grailType: "dt.entity.cloud_application_namespace", selectorType: "CLOUD_APPLICATION_NAMESPACE" },
  { key: "kubernetes_cluster", label: "K8s clusters", group: "Kubernetes",
    grailType: "dt.entity.kubernetes_cluster", selectorType: "KUBERNETES_CLUSTER" },
  { key: "kubernetes_node", label: "K8s nodes", group: "Kubernetes",
    grailType: "dt.entity.kubernetes_node", selectorType: "KUBERNETES_NODE" },

  // ── Synthetic ────────────────────────────────────────────────────────────
  { key: "synthetic_test", label: "Browser monitors", group: "Synthetic",
    grailType: "dt.entity.synthetic_test", selectorType: "SYNTHETIC_TEST" },
  { key: "http_check", label: "HTTP monitors", group: "Synthetic",
    grailType: "dt.entity.http_check", selectorType: "HTTP_CHECK" },

  // ── Databases & queues ───────────────────────────────────────────────────
  // `dt.entity.database_service` does not exist in the semantic dictionary —
  // the real type is `relational_database_service`.
  { key: "relational_database_service", label: "Databases (RDS)", group: "Databases & queues",
    grailType: "dt.entity.relational_database_service", selectorType: "RELATIONAL_DATABASE_SERVICE" },
  { key: "queue", label: "Queues", group: "Databases & queues",
    grailType: "dt.entity.queue", selectorType: "QUEUE" },
];

export const ENTITY_TYPE_BY_KEY = new Map(ENTITY_TYPES.map((t) => [t.key, t]));

export const ENTITY_GROUPS = [...new Set(ENTITY_TYPES.map((t) => t.group))];
