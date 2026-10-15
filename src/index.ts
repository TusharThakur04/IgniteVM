import path from "node:path";
import os from "node:os";
import { FirecrackerClient } from "./firecracker/client.ts";
import { spawnFirecracker, waitForSocket } from "./firecracker/process.ts";

async function main(): Promise<void> {
  const socketPath = "/tmp/firecracker.socket";
  const homeDir = os.homedir();
  const binaryPath = path.join(
    homeDir,
    "firecracker/release-v1.17.0-x86_64/firecracker-v1.17.0-x86_64",
  );
  const kernelPath = path.join(homeDir, "firecracker/vm/vmlinux.bin");
  const rootfsPath = path.join(homeDir, "firecracker/vm/rootfs.ext4");

  console.log("==> Spawning Firecracker process...");
  const fcProcess = await spawnFirecracker({ socketPath, binaryPath });

  // Handle unexpected early exit
  fcProcess.once("error", (err) => {
    console.error("Failed to start Firecracker binary:", err);
    process.exit(1);
  });

  console.log("==> Waiting for API socket to become ready...");
  await waitForSocket(socketPath, 5000);

  const client = new FirecrackerClient(socketPath);

  console.log("==> Configuring boot source...");
  await client.setBootSource({
    kernel_image_path: kernelPath,
    boot_args: "console=ttyS0 reboot=k panic=1 pci=off",
  });

  console.log("==> Configuring root filesystem...");
  await client.setDrive({
    drive_id: "rootfs",
    path_on_host: rootfsPath,
    is_root_device: true,
    is_read_only: false,
  });

  console.log("==> Configuring machine...");
  await client.setMachineConfig({
    vcpu_count: 1,
    mem_size_mib: 512,
  });

  console.log("==> Starting microVM...");
  await client.startInstance();

  console.log("==> microVM started! Attached to serial console below:");
}

main().catch((err: unknown) => {
  console.error("Fatal error booting microVM:", err);
  process.exit(1);
});
