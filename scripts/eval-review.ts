import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createReviewServer } from "../eval/server";
import { scenarios } from "../eval/scenarios";

const { values } = parseArgs({ options: { root: { type: "string", default: ".eval-artifacts" }, port: { type: "string" } }, strict: true });
const port = Number(values.port ?? process.env.EVAL_REVIEW_PORT ?? "4319");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Review port must be 1024 through 65535.");
const server = createReviewServer({ root: resolve(values.root), scenarios });
server.listen(port, "127.0.0.1", () => console.log(`Private evaluation review: http://127.0.0.1:${port}\nNo provider calls. Press Ctrl-C to stop; reports and reviews remain on disk.`));
