import { execFile as execFileCb, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import { FirecrackerClient } from "./client.js";
import { spawnFirecracker, waitForSocket } from "./process.js";
import type { WriteStream } from "node:fs";

const execFile = promisify(execFileCb);

export interface VMOptions {
  id: string;
  binaryPath: string;
  kernelPath: string;
  baseRootfsPath: string;
  logStream: WriteStream;
  hostIp?: string;
  guestIp?: string;
  vcpuCount?: number;
  memSizeMib?: number;
}

export class VM {
  public readonly id: string;
  public readonly tapName: string;
  public readonly socketPath: string;
  public readonly rootfsPath: string;
  public readonly guestIp: string;

  private process: ChildProcess | null = null;
  private isClosed = false;

  private constructor({ id, guestIp }: VMOptions) {
    this.id = id;
    this.tapName = `tap-${id}`;
    this.socketPath = `/tmp/fc-${id}.socket`;
    this.rootfsPath = `/tmp/fc-${id}-rootfs.ext4`;
    this.guestIp = guestIp ?? "172.16.0.2";
  }

  public static async create(opts: VMOptions): Promise<VM> {
    const vm = new VM(opts);
    const hostIp = opts.hostIp ?? "172.16.0.1";

    try {
      // 1. Create a per-VM copy of the rootfs
      await fs.copyFile(opts.baseRootfsPath, vm.rootfsPath);

      // 2. Setup TAP device and attach it to the master bridge
      await vm.deleteTapDevice().catch(() => undefined);
      await execFile("sudo", [
        "ip",
        "tuntap",
        "add",
        "dev",
        vm.tapName,
        "mode",
        "tap",
      ]);
      // Attach to bridge
      await execFile("sudo", [
        "ip",
        "link",
        "set",
        "dev",
        vm.tapName,
        "master",
        "vm-bridge",
      ]);
      await execFile("sudo", ["ip", "link", "set", "dev", vm.tapName, "up"]);

      // 3. Spawn Firecracker and wait for socket
      vm.process = await spawnFirecracker({
        socketPath: vm.socketPath,
        binaryPath: opts.binaryPath,
        logStream: opts.logStream,
      });
      await waitForSocket(vm.socketPath, 5000);

      // 4. Configure and boot the microVM
      const client = new FirecrackerClient(vm.socketPath);

      const bootArgs = [
        "console=ttyS0",
        "reboot=k",
        "panic=1",
        "pci=off",
        `ip=${vm.guestIp}::${hostIp}:255.255.255.0::eth0:off`,
        "init=/init.sh",
      ].join(" ");

      await client.setBootSource({
        kernel_image_path: opts.kernelPath,
        boot_args: bootArgs,
      });

      await client.setDrive({
        drive_id: "rootfs",
        path_on_host: vm.rootfsPath,
        is_root_device: true,
        is_read_only: false,
      });

      await client.setMachineConfig({
        vcpu_count: opts.vcpuCount ?? 1,
        mem_size_mib: opts.memSizeMib ?? 512,
      });

      // Convert the numeric ID (e.g., 254) to a 2-character hex string (e.g., "fe")
      const idNum = parseInt(opts.id.replace("vm-", ""), 10);
      const hexId = idNum.toString(16).padStart(2, "0");

      await client.setNetworkInterface({
        iface_id: "eth0",
        host_dev_name: vm.tapName,
        guest_mac: `AA:FC:00:00:00:${hexId}`, // Ensures every VM gets a unique MAC
      });

      await client.startInstance();

      return vm;
    } catch (err) {
      // Partial cleanup if any step in create() failed
      await vm.close();
      throw err;
    }
  }

  // resource cleanup - reverse everything create() did

  public async close(): Promise<void> {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;

    // Kill Firecracker process and wait for it to actually exit
    if (this.process) {
      try {
        await this.killProcess(this.process);
      } catch (err) {
        console.error(`[vm=${this.id}] Failed to kill process:`, err);
      } finally {
        this.process = null;
      }
    }

    // Delete TAP network device
    try {
      await this.deleteTapDevice();
    } catch (err) {
      console.error(
        `[vm=${this.id}] Failed to delete TAP ${this.tapName}:`,
        err,
      );
    }

    // Remove Unix socket file
    try {
      await fs.rm(this.socketPath, { force: true });
    } catch (err) {
      console.error(`[vm=${this.id}] Failed to remove socket:`, err);
    }

    // 4. Remove per-VM rootfs copy
    try {
      await fs.rm(this.rootfsPath, { force: true });
    } catch (err) {
      console.error(`[vm=${this.id}] Failed to remove rootfs copy:`, err);
    }
  }

  private async killProcess(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) {
      return; // Already exited
    }

    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill("SIGKILL");
    });
  }

  private async deleteTapDevice(): Promise<void> {
    try {
      await execFile("sudo", ["ip", "link", "del", this.tapName]);
    } catch (err: unknown) {
      // Ignore "Cannot find device" so cleanup remains idempotent
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("Cannot find device")) {
        throw err;
      }
    }
  }
}
