import { createServer } from "node:https";
import { readFileSync } from "node:fs";

const [keyPath, certificatePath, expectedImage] = process.argv.slice(2);
if (!keyPath || !certificatePath || !expectedImage) process.exit(2);

let savedImage;
let deployed = false;
// Runtime-only fixture: no real credential and no committed password literal.
const registry = {
  username: "test-user",
  password: crypto.randomUUID(),
  registryUrl: "ghcr.io",
};

const server = createServer(
  {
    key: readFileSync(keyPath),
    cert: readFileSync(certificatePath),
  },
  async (request, response) => {
    const reply = (status, body) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };

    // Dokploy v0.19+ authenticates personal API keys through x-api-key.
    if (request.headers["x-api-key"] !== "test-token") {
      reply(401, { error: "unauthorized" });
      return;
    }

    const url = new URL(request.url, "https://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/api/application.one") {
      reply(200, {
        ...registry,
        sourceType: savedImage ? "docker" : "git",
        dockerImage: savedImage ?? "ghcr.io/example/old@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/deployment.all") {
      reply(200, deployed ? [{ deploymentId: "new-deployment", status: "done" }] : []);
      return;
    }

    let rawBody = "";
    for await (const chunk of request) rawBody += chunk;
    const body = JSON.parse(rawBody || "{}");

    if (request.method === "POST" && url.pathname === "/api/application.saveDockerProvider") {
      if (body.applicationId !== "test-app" || body.dockerImage !== expectedImage) {
        reply(400, { error: "wrong Docker provider payload" });
        return;
      }
      // All three registry properties are required, even for public images.
      if (Object.keys(registry).some((key) => body[key] !== registry[key])) {
        reply(400, { error: "registry fields missing or changed" });
        return;
      }
      savedImage = body.dockerImage;
      reply(200, true);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/application.deploy") {
      if (body.applicationId !== "test-app" || savedImage !== expectedImage) {
        reply(400, { error: "wrong deployment payload" });
        return;
      }
      deployed = true;
      reply(200, true);
      return;
    }

    reply(404, { error: "not found" });
  },
);

server.listen(0, "127.0.0.1", () => {
  process.stdout.write(`${server.address().port}\n`);
});
