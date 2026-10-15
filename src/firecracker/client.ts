import http from "node:http";

export interface BootSourceConfig {
  kernel_image_path: string;
  boot_args: string;
  initrd_path?: string;
}

export interface DriveConfig {
  drive_id: string;
  path_on_host: string;
  is_root_device: boolean;
  is_read_only: boolean;
}

export interface MachineConfig {
  vcpu_count: number;
  mem_size_mib: number;
  smt?: boolean;
}

export interface NetworkInterfaceConfig {
  iface_id: string;
  host_dev_name: string;
  guest_mac?: string;
}

interface FirecrackerErrorBody {
  fault_message?: string;
}

// 2. The Client (replaces client.go + fcurl)
export class FirecrackerClient {
  private readonly socketPath: string;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  private async put<T extends object>(path: string, body: T): Promise<void> {
    const payload = JSON.stringify(body);

    return new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          socketPath: this.socketPath,
          path,
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const rawBody = Buffer.concat(chunks).toString("utf8");
            const status = res.statusCode ?? 0;

            if (status >= 200 && status < 300) {
              resolve();
              return;
            }

            // Surface Firecracker's actual fault_message on error
            let faultMessage = rawBody;
            try {
              const parsed = JSON.parse(rawBody) as FirecrackerErrorBody;
              if (parsed.fault_message) {
                faultMessage = parsed.fault_message;
              }
            } catch {
              // Fallback to rawBody if response isn't valid JSON
            }

            reject(
              new Error(
                `Firecracker API error (${status} on PUT ${path}): ${faultMessage}`,
              ),
            );
          });
        },
      );

      req.on("error", (err) => reject(err));
      req.write(payload);
      req.end();
    });
  }

  public async setBootSource(config: BootSourceConfig): Promise<void> {
    await this.put("/boot-source", config);
  }

  public async setDrive(config: DriveConfig): Promise<void> {
    await this.put(`/drives/${config.drive_id}`, config);
  }

  public async setMachineConfig(config: MachineConfig): Promise<void> {
    await this.put("/machine-config", config);
  }

  public async setNetworkInterface(
    config: NetworkInterfaceConfig,
  ): Promise<void> {
    await this.put(`/network-interfaces/${config.iface_id}`, config);
  }

  public async startInstance(): Promise<void> {
    await this.put("/actions", { action_type: "InstanceStart" });
  }
}
