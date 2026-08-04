import * as logsAPI from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import { OpenTelemetryTransportV3 } from "@opentelemetry/winston-transport";
import * as dotenv from "dotenv";
import winston from "winston";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import { getOtelResource } from "./OtelResource";
import { getTelemetryIdentity } from "./TelemetryIdentity";
import { registerTelemetryHandle } from "./TelemetryLifecycle";
dotenv.config();

const config = getServerConfigFromServer();

const resource = getOtelResource();

if (config.otelEnabled()) {
  console.log("OTEL enabled");
  // Configure OpenTelemetry endpoint with basic auth (if provided)
  const headers: Record<string, string> = {};
  headers["Authorization"] = "Basic " + config.otelAuthHeader();
  // Add OTLP exporter for logs
  const logExporter = new OTLPLogExporter({
    url: `${config.otelEndpoint()}/v1/logs`,
    headers,
  });

  // SDK 0.220 registers processors at provider construction time.
  const loggerProvider = new LoggerProvider({
    resource,
    processors: [new BatchLogRecordProcessor({ exporter: logExporter })],
  });

  // Set as the global logger provider
  logsAPI.logs.setGlobalLoggerProvider(loggerProvider);
  registerTelemetryHandle("logs", loggerProvider);
} else {
  console.log(
    "No OTLP endpoint and credentials provided, remote logging disabled",
  );
}

// Custom format to add severity tag based on log level
const addSeverityFormat = winston.format((info) => {
  return {
    ...info,
    severity: info.level,
  };
});

// Define your base/parent logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    addSeverityFormat(),
    winston.format.json(),
  ),
  defaultMeta: {
    ...getTelemetryIdentity(),
  },
  transports: [
    new winston.transports.Console(),
    new OpenTelemetryTransportV3(),
  ],
});

// Export both the main logger and the child logger factory
export { logger };
