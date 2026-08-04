import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import { getTelemetryIdentity } from "./TelemetryIdentity";

const config = getServerConfigFromServer();

export function getOtelResource() {
  const identity = getTelemetryIdentity();
  return resourceFromAttributes({
    [ATTR_SERVICE_NAME]: identity.service,
    [ATTR_SERVICE_VERSION]: identity.version,
    "deployment.environment.name": identity.environment,
    "vcs.ref.head.revision": identity.revision,
    ...getPromLabels(),
  });
}

export function getPromLabels() {
  return {
    "service.instance.id": process.env.HOSTNAME,
    "vaultfront.environment": config.env(),
    "vaultfront.host": process.env.HOST,
    "vaultfront.domain": process.env.DOMAIN,
    "vaultfront.subdomain": process.env.SUBDOMAIN,
    "vaultfront.component": process.env.WORKER_ID
      ? "Worker " + process.env.WORKER_ID
      : "Master",
  };
}
