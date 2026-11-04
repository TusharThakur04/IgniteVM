#!/bin/bash
set -e

cd "$(dirname "$0")"

IMAGE_NAME="ignitevm-guest"
TAR_FILE="rootfs.tar"
EXT4_FILE="rootfs.ext4"
MOUNT_DIR="/tmp/ignitevm-rootfs"

echo "==> 1. Building Docker image..."
docker build -t $IMAGE_NAME .

echo "==> 2. Exporting container to $TAR_FILE..."
# Create a dummy container without running it
CONTAINER_ID=$(docker create $IMAGE_NAME)
docker export $CONTAINER_ID > $TAR_FILE
docker rm $CONTAINER_ID

echo "==> 3. Creating empty 500MB ext4 disk image..."
rm -f $EXT4_FILE
# Allocate a 500MB file
dd if=/dev/zero of=$EXT4_FILE bs=1M count=500
# Format it as an ext4 filesystem
mkfs.ext4 -q $EXT4_FILE

echo "==> 4. Mounting disk image and extracting files..."
mkdir -p $MOUNT_DIR
# Loop-mount the file so Linux treats it like a drive
sudo mount -o loop $EXT4_FILE $MOUNT_DIR

# Extract the docker filesystem into the mounted drive
sudo tar -xf $TAR_FILE -C $MOUNT_DIR

echo "==> 5. Unmounting and cleaning up..."
sudo umount $MOUNT_DIR
rm -rf $MOUNT_DIR
rm $TAR_FILE

echo "==> Disk image is ready: $EXT4_FILE"