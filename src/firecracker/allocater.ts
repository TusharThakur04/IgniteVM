export interface VMLease {
  id: string;
  tapName: string;
  guestIp: string;
}

export class IpAllocator {
  private availableIds: number[] = [];
  private readonly subnetBase: string;

  /**
   * @param subnetBase The first 3 octets of the subnet (default: "172.16.0")
   * @param capacity Total number of IPs to make available (default: 253)
   */
  constructor(subnetBase = "172.16.0", capacity = 253) {
    this.subnetBase = subnetBase;

    // The host typically uses .1, so guest IPs start at .2
    for (let i = capacity + 1; i >= 2; i--) {
      this.availableIds.push(i);
    }
  }

  /**
   * Synchronously claims an available ID and IP from the pool.
   */
  public allocate(): VMLease {
    const idNum = this.availableIds.pop();

    if (idNum === undefined) {
      throw new Error(
        "Allocator exhausted: No available IP addresses in the pool.",
      );
    }

    return {
      id: `vm-${idNum}`,
      tapName: `tap-vm-${idNum}`,
      guestIp: `${this.subnetBase}.${idNum}`,
    };
  }

  /**
   * Synchronously returns a lease back to the free list.
   */
  public free(lease: VMLease): void {
    const idNum = parseInt(lease.id.replace("vm-", ""), 10);

    // Guard against double-frees duplicating the ID in the array
    if (!isNaN(idNum) && !this.availableIds.includes(idNum)) {
      this.availableIds.push(idNum);
    }
  }
}
