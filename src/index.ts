import http from "node:http";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { VM } from "./firecracker/vm.js";

const currDir = import.meta.dirname;
const homeDir = os.homedir();
const binaryPath = path.join(
  homeDir,
  "firecracker/release-v1.17.0-x86_64/firecracker-v1.17.0-x86_64",
);
const kernelPath = path.join(homeDir, "firecracker/vm/vmlinux.bin");
const baseRootfsPath = path.join(currDir, "envd/rootfs.ext4");

const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");

  // Route: POST /api/execute
  if (req.method === "POST" && req.url === "/api/execute") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", async () => {
      let vm;
      let logStream;
      const vmId = "test0";

      try {
        const parsed = JSON.parse(body);
        if (!parsed.code) {
          res.writeHead(400);
          return res.end(
            JSON.stringify({ error: "Missing 'code' in request body" }),
          );
        }

        // Open a stream to capture Firecracker kernel boot logs
        logStream = fs.createWriteStream(path.join(currDir, `${vmId}.log`), {
          flags: "a",
        });

        console.log(`\n[${vmId}] 1. Booting MicroVM...`);
        vm = await VM.create({
          id: vmId,
          binaryPath,
          kernelPath,
          baseRootfsPath,
          logStream,
        });

        const guestUrl = `http://${vm.guestIp}:3000`;
        console.log(`[${vmId}] 2. Waiting for envd agent at ${guestUrl}...`);

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
          } catch (e) {
            await new Promise((r) => setTimeout(r, 50));
          }
        }

        if (!ready) throw new Error("Agent failed to start within timeout");
        console.log(`[${vmId}] Agent ready. Sending code...`);

        // Proxy the execution request to the guest VM
        const response = await fetch(`${guestUrl}/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: parsed.code }),
          signal: AbortSignal.timeout(10000), // 10-second outer timeout
        });

        const result = await response.json();

        res.writeHead(200);
        res.end(JSON.stringify(result));
      } catch (error) {
        console.error(`[${vmId}] Request failed:`, error);
        res.writeHead(500);
        res.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : "Unknown error",
          }),
        );
      } finally {
        console.log(`[${vmId}] 3. Tearing down VM...`);
        if (vm) await vm.close();
        if (logStream) logStream.end();
        console.log(`[${vmId}] Cleanup complete.\n`);
      }
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
