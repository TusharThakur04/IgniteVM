import http from "node:http";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { VM } from "./firecracker/vm.js";
import { IpAllocator, type VMLease } from "./firecracker/allocater.js";

const currDir = import.meta.dirname;
const homeDir = os.homedir();
const binaryPath = path.join(
  homeDir,
  "firecracker/release-v1.17.0-x86_64/firecracker-v1.17.0-x86_64",
);
const kernelPath = path.join(homeDir, "firecracker/vm/vmlinux.bin");
const baseRootfsPath = path.join(currDir, "envd/rootfs.ext4");

const allocator = new IpAllocator();

const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");

  // Route: POST /api/execute
  if (req.method === "POST" && req.url === "/api/execute") {
    let rawBody = "";
    req.on("data", (chunk: Buffer) => {
      rawBody += chunk.toString();
    });

    req.on("end", () => {
      void (async () => {
        let vm: VM | undefined;
        let logStream: fs.WriteStream | undefined;
        let lease: VMLease | undefined;

        try {
          const body = JSON.parse(rawBody) as { code: unknown };
          if (!body.code) {
            res.writeHead(400);
            res.end(
              JSON.stringify({ error: "Missing 'code' in request body" }),
            );
            return;
          }

          lease = allocator.allocate();

          // Open a stream to capture Firecracker kernel boot logs
          logStream = fs.createWriteStream(
            path.join(currDir, `${lease.id}.log`),
            {
              flags: "a",
            },
          );

          console.log(`\n[${lease.id}] 1. Booting MicroVM...`);
          vm = await VM.create({
            id: lease.id,
            guestIp: lease.guestIp,
            binaryPath,
            kernelPath,
            baseRootfsPath,
            logStream,
          });

          const guestUrl = `http://${vm.guestIp}:3000`;
          console.log(
            `[${lease.id}] 2. Waiting for envd agent at ${guestUrl}...`,
          );

          let ready = false;
          for (let i = 0; i < 50; i++) {
            try {
              const health = await fetch(`${guestUrl}/health`, {
                signal: AbortSignal.timeout(100),
              });
              if (health.ok) {
                ready = true;
                break;
              }
            } catch {
              await new Promise((r) => setTimeout(r, 50));
            }
          }

          if (!ready) throw new Error("Agent failed to start within timeout");
          console.log(`[${lease.id}] Agent ready. Sending code...`);

          // Proxy the execution request to the guest VM
          const response = await fetch(`${guestUrl}/execute`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: body.code }),
            signal: AbortSignal.timeout(10000), // 10-second outer timeout
          });

          const result = (await response.json()) as unknown;

          res.writeHead(200);
          res.end(JSON.stringify(result));
        } catch (error) {
          console.error(
            `[${lease?.id ?? "unassigned"}] Request failed:`,
            error,
          );
          if (!res.headersSent) {
            res.writeHead(500);
            res.end(
              JSON.stringify({
                error: error instanceof Error ? error.message : "Unknown error",
              }),
            );
          }
        } finally {
          if (lease) {
            console.log(`[${lease.id}] 3. Tearing down VM...`);
          }
          if (vm) await vm.close();
          if (logStream) logStream.end();
          if (lease) {
            allocator.free(lease);
            console.log(`[${lease.id}] Cleanup complete.\n`);
          }
        }
      })();
    });
  } else {
    // 404 for all other routes
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  }
});

const PORT = 4000;
server.listen(PORT, () => {
  console.log(`Host server listening on http://localhost:${PORT}`);
});
