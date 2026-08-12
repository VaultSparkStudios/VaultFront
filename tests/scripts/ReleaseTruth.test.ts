import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

function nginxLocationBlocks(source: string): string[] {
  const blocks: string[] = [];
  const pattern = /^\s*location\b[^\n{]*\{/gmu;
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0;
    let depth = 0;
    for (
      let index = source.indexOf("{", start);
      index < source.length;
      index += 1
    ) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") depth -= 1;
      if (depth === 0) {
        blocks.push(source.slice(start, index + 1));
        break;
      }
    }
  }
  return blocks;
}

describe("release truth boundary", () => {
  it("uses the dedicated VaultFront Turnstile widget in both release environments", () => {
    const production = read("src/core/configuration/ProdConfig.ts");
    const preproduction = read("src/core/configuration/PreprodConfig.ts");
    const siteKey = "0x4AAAAAAENd8CLji_2o-S97";

    expect(production).toContain(siteKey);
    expect(preproduction).toContain(siteKey);
    expect(`${production}\n${preproduction}`).not.toMatch(
      /0x4AAAAAACFLkaecN39lS8sk|0x4AAAAAAB7QetxHwRCKw-aP/u,
    );
  });

  it("re-applies the security policy in every location with local headers", () => {
    const nginx = read("nginx.conf");
    const headerLocations = nginxLocationBlocks(nginx).filter((block) =>
      block.includes("add_header"),
    );

    expect(headerLocations.length).toBeGreaterThan(0);
    for (const block of headerLocations) {
      expect(block).toContain(
        "include /etc/nginx/snippets/vaultfront-security-headers.conf;",
      );
    }

    const policy = read("nginx-security-headers.conf");
    for (const header of [
      "Content-Security-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Permissions-Policy",
    ]) {
      expect(policy).toContain(`add_header ${header}`);
    }
    expect(policy).toContain("https://sdk.crazygames.com");
    expect(policy).toContain("https://www.googletagmanager.com");
    expect(policy).toContain("https://static.cloudflareinsights.com");
    expect(policy).toContain("https://cdn.intergient.com");
  });

  it("copies public launch files and image revision evidence into Docker", () => {
    const dockerfile = read("Dockerfile");
    expect(dockerfile).toContain("COPY public ./public");
    expect(dockerfile).toContain(
      "COPY --from=build /usr/src/app/config ./config",
    );
    expect(dockerfile).toContain("COPY nginx-security-headers.conf");
    expect(dockerfile).toContain(
      'LABEL org.opencontainers.image.revision="$GIT_COMMIT"',
    );
  });

  it("keeps runtime ingress outside the container and health-checks locally", () => {
    const dockerfile = read("Dockerfile");
    const supervisor = read("supervisord.conf");
    const updater = read("update.sh");

    expect(updater).toContain('NETWORK_NAME="${DEPLOYMENT_KEY}-private"');
    expect(updater).toContain(
      'docker network connect "$NETWORK_NAME" "$DATABASE_DOCKER_CONTAINER"',
    );
    expect(updater).toContain(
      '--publish "127.0.0.1:${DEPLOY_INGRESS_PORT}:80"',
    );
    expect(updater).toMatch(/docker login ghcr\.io[\s\S]*--password-stdin/u);
    expect(updater).toContain(
      "grep -Ev '^(GHCR_TOKEN|CF_API_TOKEN)=' \"$ENV_FILE\"",
    );
    expect(updater).not.toContain('--env-file "$ENV_FILE"');
    expect(updater).toContain('--env-file "$RUNTIME_ENV_FILE"');
    expect(updater).not.toContain("traefik.");
    expect(dockerfile).toContain(
      'ENTRYPOINT ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]',
    );
    expect(dockerfile).toContain("127.0.0.1/_health");
    expect(dockerfile).not.toMatch(
      /cloudflared|CF_API_TOKEN|CF_ACCOUNT_ID|startup.sh/u,
    );
    expect(supervisor).not.toMatch(/cloudflared|CLOUDFLARE_TUNNEL_TOKEN/u);
  });

  it("admits a healthy blue/green candidate before bounded incumbent drain", () => {
    const updater = read("update.sh");
    const supervisor = read("supervisord.conf");

    expect(updater).not.toMatch(/docker\s+rm\s+-f/u);
    expect(updater).toContain("DEPLOY_DRAIN_TIMEOUT_SECONDS");
    expect(updater).toContain("dump_candidate_diagnostics()");
    expect(updater).toContain(
      'docker logs --tail 200 "$CONTAINER_NAME" >&2 || true',
    );
    expect(updater).toContain('IMAGE_DIGEST="${GHCR_IMAGE##*@}"');
    expect(updater).toContain("activate_route()");
    expect(updater).toContain('activate_route "$CONTAINER_NAME" "$GHCR_IMAGE"');
    expect(updater).toContain(
      'if ! activate_route "$CONTAINER_NAME" "$GHCR_IMAGE"; then',
    );
    expect(updater).toContain('docker rm "$ROUTER_NAME"');
    expect(updater).toContain('rm -f "$ROUTER_CONFIG"');
    expect(updater).toContain("restore_incumbent_route || true");
    expect(updater).toContain(
      'docker exec "$ROUTER_NAME" nginx -s reload || {',
    );
    expect(updater).toContain(
      'curl -fsS --max-time 5 "http://127.0.0.1:${DEPLOY_INGRESS_PORT}/commit.txt"',
    );
    expect(updater.indexOf('run_container "$GHCR_IMAGE"')).toBeLessThan(
      updater.indexOf('docker stop --time "$DEPLOY_DRAIN_TIMEOUT_SECONDS"'),
    );
    expect(updater.indexOf('docker exec "$CONTAINER_NAME" curl')).toBeLessThan(
      updater.indexOf('docker stop --time "$DEPLOY_DRAIN_TIMEOUT_SECONDS"'),
    );
    expect(updater.indexOf('[[ "$DOCKER_HEALTHY" != "1" ]]')).toBeLessThan(
      updater.indexOf('docker stop --time "$DEPLOY_DRAIN_TIMEOUT_SECONDS"'),
    );
    expect(updater.indexOf('[[ "$CANDIDATE_ADMITTED" != "1" ]]')).toBeLessThan(
      updater.indexOf('docker stop --time "$DEPLOY_DRAIN_TIMEOUT_SECONDS"'),
    );
    expect(updater).toContain(
      'REVISION_URL="${DEPLOY_HEALTH_URL%/_health}/commit.txt"',
    );
    expect(updater).toContain('docker start "$OLD_CONTAINER"');
    expect(supervisor).toContain("stopsignal=TERM");
    expect(supervisor).toContain(
      "stopwaitsecs=%(ENV_DEPLOY_DRAIN_TIMEOUT_SECONDS)s",
    );
    expect(supervisor).toContain("stopasgroup=true");
    expect(supervisor).toContain("killasgroup=true");
  });

  it("verifies promotion by the image Git revision instead of its tag", () => {
    const promote = read(".github/workflows/promote.yml");
    expect(promote).toContain("org.opencontainers.image.revision");
    expect(promote).toContain("EXPECTED_GIT_SHA");
    expect(promote).toContain('== "$EXPECTED_GIT_SHA"');
    expect(promote).toContain("Promotion revision verification timed out");
    expect(promote).not.toContain('commit.txt)" != "${{ inputs.image_tag }}"');
  });

  it("publishes unavailable runtime truth without dead public CTAs", () => {
    const descriptor = JSON.parse(read("public/agents.json"));
    expect(descriptor.availability).toMatchObject({
      publicRuntime: "unavailable",
    });
    expect(descriptor.endpoints.landing).toBe("https://vaultfront.io/");
    expect(read("pages-stub/index.html")).not.toContain("vaultfront.io");
    expect(read("pages-stub/index.html")).toContain("Join Alpha");
    expect(read("public/.well-known/llms.txt")).toContain(
      "Public runtime: unavailable",
    );
  });

  it("uses public-safe metadata defaults and avoids the circular game-ui chunk", () => {
    const html = read("index.html");
    expect(html).not.toContain("%VITE_CANONICAL_URL%");
    expect(html).not.toContain("%VITE_OG_IMAGE_URL%");
    expect(html).toContain("https://vaultfront.io/");
    expect(read("vite.config.ts")).not.toContain('return "game-ui"');
  });
});
