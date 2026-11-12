#!/bin/bash

# 1. Create a single bridge for all microVMs
sudo ip link add name vm-bridge type bridge
sudo ip addr add 172.16.0.1/24 dev vm-bridge
sudo ip link set dev vm-bridge up

# 2. Detect the host's real network interface (e.g., eth0 or enp3s0)
EXT_IF=$(ip route show default | awk '/default/ {print $5}')

# 3. Enable MASQUERADE (Internet access covering the whole VM subnet range)
sudo iptables -t nat -A POSTROUTING -s 172.16.0.0/24 -o $EXT_IF -j MASQUERADE

# 4. Isolation: Explicit DROP rule blocking VM-to-VM traffic
sudo iptables -A FORWARD -i vm-bridge -o vm-bridge -j DROP

# 5. Isolation: Explicit DROP rule blocking guest access to cloud metadata (SSRF)
sudo iptables -A FORWARD -i vm-bridge -d 169.254.169.254 -j DROP

echo "Host networking configured on $EXT_IF"