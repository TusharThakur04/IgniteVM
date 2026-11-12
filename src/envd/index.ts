import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const PORT = 3000;
const EXECUTION_TIMEOUT_MS = 5000; // 5-second limit for LLM-generated code

const server = http.createServer((req, res) => {
  // 1. Health check for the host to poll during VM boot
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200);
    res.end("OK");
    return;
  }

  if (req.method === "POST" && req.url === "/execute") {
    let rawBody = "";
    req.on("data", (chunk: Buffer) => {
      rawBody += chunk.toString("utf8");
    });

    req.on("end", () => {
      (async () => {
        try {
          const body = JSON.parse(rawBody) as { code?: unknown };
          const userCode = body.code;

          if (typeof userCode !== "string") {
            res.writeHead(400);
            res.end("Bad Request: 'code' must be a string");
            return;
          }

          // 2. Create a unique temp directory per request
          const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "exec-"));
          const scriptPath = path.join(tempDir, "script.ts");
          await fs.writeFile(scriptPath, userCode);

          // 3. Setup the execution timeout using AbortController
          const ac = new AbortController();
          const timeoutId = setTimeout(() => ac.abort(), EXECUTION_TIMEOUT_MS);

          const child = spawn("bun", ["run", scriptPath], {
            signal: ac.signal,
            killSignal: "SIGKILL",
          });

          let stdout = "";
          let stderr = "";

          // 4. Capture stdout and stderr into separate buffers
          child.stdout.on("data", (data: Buffer) => {
            stdout += data.toString();
          });

          child.stderr.on("data", (data: Buffer) => {
            stderr += data.toString();
          });

          child.once("close", (code) => {
            (async () => {
              clearTimeout(timeoutId);

              // Cleanup the unique temp directory
              try {
                await fs.rm(tempDir, { recursive: true, force: true });
              } catch (err) {
                console.error(`Failed to clean temp dir ${tempDir}:`, err);
              }

              let finalExitCode = code ?? 1;
              if (ac.signal.aborted) {
                stderr += "\nExecution timed out.";
                finalExitCode = 124;
              }
              console.log(
                `[envd] Execution complete. Exit code: ${finalExitCode}, stdout length: ${stdout.length} bytes`,
              );

              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({ stdout, stderr, exitCode: finalExitCode }),
              );
            })().catch((err) => {
              console.error("Unhandled inner close failure:", err);
            });
          });

          child.once("error", (err) => {
            if (err.name !== "AbortError") {
              stderr += `\nInternal process error: ${err.message}`;
            }
          });
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: String(err) }));
        }
      })().catch((err) => {
        console.error("Unhandled request flow failure:", err);
      });
    });
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

server.listen(PORT, () => {
  console.log(`microVM listening on port ${PORT}`);
});
