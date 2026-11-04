import path from "node:path";
import os from "node:os";
import { VM } from "./firecracker/vm.js";

async function main(): Promise<void> {
  const currDir = import.meta.dirname;
  const homeDir = os.homedir();

  const binaryPath = path.join(
    homeDir,
    "firecracker/release-v1.17.0-x86_64/firecracker-v1.17.0-x86_64",
  );
  const kernelPath = path.join(homeDir, "firecracker/vm/vmlinux.bin");
  const baseRootfsPath = path.join(currDir, "envd/rootfs.ext4");

  console.log("==> 1. Booting MicroVM...");
  const vm = await VM.create({
    id: "test0",
    binaryPath,
    kernelPath,
    baseRootfsPath,
  });

  try {
    console.log("==> ✅ VM started successfully!");

    await new Promise((resolve) => setTimeout(resolve, 5000));
  } finally {
    console.log("==> 2. Tearing down VM...");
    await vm.close();
    console.log("==> VM destroyed cleanly.");
  }
}

main().catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
