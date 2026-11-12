#!/bin/bash

# Detect the host's real network interface
EXT_IF=$(ip route show default | awk '/default/ {print $5}')

echo "Cleaning up host networking..."

# 1. Remove NAT routing rule
# Using -D (Delete) instead of -A (Append)
sudo iptables -t nat -D POSTROUTING -s 172.16.0.0/24 -o $EXT_IF -j MASQUERADE 2>/dev/null

# 2. Remove isolation rules
sudo iptables -D FORWARD -i vm-bridge -o vm-bridge -j DROP 2>/dev/null
sudo iptables -D FORWARD -i vm-bridge -d 169.254.169.254 -j DROP 2>/dev/null

# 3. Bring down and delete the bridge
sudo ip link set dev vm-bridge down 2>/dev/null
sudo ip link delete dev vm-bridge type bridge 2>/dev/null

echo "Network cleanup complete."