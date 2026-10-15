import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import fs from "node:fs/promises";

export interface SpawnFirecrackerOptions {
  socketPath: string;
  binaryPath: string;
}

/**
 * Spawns the Firecracker process attached to the given Unix socket path.
 */
export async function spawnFirecracker(
  options: SpawnFirecrackerOptions,
): Promise<ChildProcess> {
  const { socketPath, binaryPath } = options;

  // Remove any leftover socket file from a previous crashed run
  await fs.rm(socketPath, { force: true });

  const child = spawn(binaryPath, ["--api-sock", socketPath], {
    stdio: ["ignore", "inherit", "inherit"],
  });

  return child;
}

/**
 * Polls the Unix socket by actually dialing it until it accepts connections
 * or the timeout expires.
 */
export async function waitForSocket(
  socketPath: string,
  timeoutMs = 3000,
  pollIntervalMs = 25,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const isReady = await tryDialSocket(socketPath);
    if (isReady) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for Firecracker socket at ${socketPath}`,
  );
}

function tryDialSocket(socketPath: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ path: socketPath });

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });

    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}
