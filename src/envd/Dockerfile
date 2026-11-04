FROM ubuntu:22.04

# 1. Install utilities needed to install Bun
RUN apt-get update && apt-get install -y curl unzip ca-certificates && rm -rf /var/lib/apt/lists/*

# 2. Install Bun Runtime
ENV BUN_INSTALL="/usr/local"
RUN curl -fsSL https://bun.sh/install | bash

# 3. Copy compiled agent binary into the image
COPY envd /usr/local/bin/envd
RUN chmod +x /usr/local/bin/envd

# Copy the init script
COPY init.sh /init.sh
RUN chmod +x /init.sh