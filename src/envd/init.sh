#!/bin/bash
# Mount essential virtual filesystems
mount -t proc none /proc
mount -t sysfs none /sys

# Inject standard Linux paths so the agent can find the 'bun' binary
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin"

# Replace this bash process with the envd agent
exec /usr/local/bin/envd