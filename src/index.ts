import path from "node:path";
import os from "node:os";
import { VM } from "./firecracker/vm.js";

async function main(): Promise<void> {
  const homeDir = os.homedir();
  const binaryPath = path.join(
    homeDir,
    "firecracker/release-v1.17.0-x86_64/firecracker-v1.17.0-x86_64",
  );
  const kernelPath = path.join(homeDir, "firecracker/vm/vmlinux.bin");
  const baseRootfsPath = path.join(homeDir, "firecracker/vm/rootfs.ext4");

  const iterations = 50;

  for (let i = 1; i <= iterations; i++) {
    console.log(`\n==> [Iteration ${i}/${iterations}] Creating VM...`);
    const vm = await VM.create({
      id: "test0",
      binaryPath,
      kernelPath,
      baseRootfsPath,
    });

    try {
      console.log(
        `==> [Iteration ${i}/${iterations}] VM running, tearing down...`,
      );
    } finally {
      await vm.close();
      console.log(`==> [Iteration ${i}/${iterations}] VM closed cleanly.`);
    }
  }
}

main().catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
