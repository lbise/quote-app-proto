import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createReviewServer, privateReviewAddresses } from "../eval/server";
import { scenarios } from "../eval/scenarios";

const { values } = parseArgs({ options: { root: { type: "string", default: ".eval-artifacts" }, port: { type: "string" }, host: { type: "string", default: "0.0.0.0" } }, strict: true });
const port = Number(values.port ?? process.env.EVAL_REVIEW_PORT ?? "4319");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Review port must be 1024 through 65535.");
const addresses = privateReviewAddresses();
if (!["127.0.0.1", "0.0.0.0", ...addresses].includes(values.host)) throw new Error("Review host must be loopback, a local private IPv4 address, or 0.0.0.0.");
const server = createReviewServer({ root: resolve(values.root), scenarios, networkAccess: values.host !== "127.0.0.1" });
server.listen(port, values.host, () => {
  const urls = (values.host === "0.0.0.0" ? ["127.0.0.1", ...addresses] : [values.host]).map(address => `http://${address}:${port}`);
  console.log(`Evaluation review:\n${urls.join("\n")}\nNo login: trusted network users can read commercial data and save reviews. Do not expose through a public proxy or port forward.\nNo provider calls. Press Ctrl-C to stop; reports and reviews remain on disk.`);
});
