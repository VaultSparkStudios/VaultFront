import { metrics } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import * as dotenv from "dotenv";
import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import { GameManager } from "./GameManager";
import { getOtelResource, getPromLabels } from "./OtelResource";
import { registerTelemetryHandle } from "./TelemetryLifecycle";
import { VaultMetrics } from "./VaultMetrics";

dotenv.config();

export function initWorkerMetrics(gameManager: GameManager): void {
  // Get server configuration
  const config = getServerConfigFromServer();

  // Create resource with worker information
  const resource = getOtelResource();

  // Configure auth headers
  const headers: Record<string, string> = {};
  if (config.otelEnabled()) {
    headers["Authorization"] = "Basic " + config.otelAuthHeader();
  }

  // Create metrics exporter
  const metricExporter = new OTLPMetricExporter({
    url: `${config.otelEndpoint()}/v1/metrics`,
    headers,
  });

  // Configure the metric reader
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 15000, // Export metrics every 15 seconds
  });

  // Create a meter provider
  const meterProvider = new MeterProvider({
    resource,
    readers: [metricReader],
  });

  // Register as the global meter provider so VaultMetrics (and any other
  // module using metrics.getMeter()) picks up this provider automatically.
  metrics.setGlobalMeterProvider(meterProvider);
  registerTelemetryHandle("metrics", meterProvider);

  // Get meter for creating metrics
  const meter = meterProvider.getMeter("worker-metrics");

  // Create observable gauges
  const activeGamesGauge = meter.createObservableGauge(
    "vaultfront.active_games.gauge",
    {
      description: "Number of active games on this worker",
    },
  );

  const connectedClientsGauge = meter.createObservableGauge(
    "vaultfront.connected_clients.gauge",
    {
      description: "Number of connected clients on this worker",
    },
  );

  const desyncsGauge = meter.createObservableGauge("vaultfront.desyncs.gauge", {
    description: "Number of detected desyncs on active games on this worker",
  });

  const memoryUsageGauge = meter.createObservableGauge(
    "vaultfront.memory_usage.bytes",
    {
      description: "Current memory usage of the worker process in bytes",
    },
  );

  activeGamesGauge.addCallback((result) => {
    const count = gameManager.activeGames();
    result.observe(count, getPromLabels());
  });

  connectedClientsGauge.addCallback((result) => {
    const count = gameManager.activeClients();
    result.observe(count, getPromLabels());
  });

  desyncsGauge.addCallback((result) => {
    const count = gameManager.desyncCount();
    result.observe(count, getPromLabels());
  });

  memoryUsageGauge.addCallback((result) => {
    const memoryUsage = process.memoryUsage();
    result.observe(memoryUsage.heapUsed, getPromLabels());
  });

  // Initialise VaultFront game-event counters using the global meter provider.
  VaultMetrics.init();

  console.log("Metrics initialized with GameManager");
}
