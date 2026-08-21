import { createHash } from "node:crypto";

// RFC 4122 DNS namespace. The application-specific prefix below keeps these
// name-based IDs isolated from ordinary DNS-name UUIDs.
const UUID_V5_DNS_NAMESPACE = Buffer.from(
  "6ba7b8109dad11d180b400c04fd430c8",
  "hex"
);

/**
 * Produces the same database-compatible UUID for one project/scene identity.
 * UUIDv5 is used because every existing ShotCL UUID boundary accepts versions
 * 1–5, including Scene List deletion and Progress media scoping.
 */
export function createDeterministicSceneListId(projectId: string, sceneNo: string) {
  const canonicalProjectId = projectId.trim().toLowerCase();
  const bytes = createHash("sha1")
    .update(UUID_V5_DNS_NAMESPACE)
    .update(`shotcl:scene-list:auto:${canonicalProjectId}\0${sceneNo}`, "utf8")
    .digest()
    .subarray(0, 16);

  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const value = bytes.toString("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
