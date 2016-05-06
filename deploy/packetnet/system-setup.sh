#!/bin/bash

set -e -v

DOCKER_VERSION=1.10.1-0~trusty
KERNEL_VER=`uname -r`
V4L2LOOPBACK_VERSION=0.8.0
node_version=0.12.4

lsb_release -a

apt-get update -y

[ -e /usr/lib/apt/methods/https ] || {
  apt-get install apt-transport-https
}

# Add docker gpg key and update sources
apt-key adv --keyserver hkp://p80.pool.sks-keyservers.net:80 --recv-keys 58118E89F3A912897C070ADBF76221572C52609D
sh -c "echo deb https://apt.dockerproject.org/repo ubuntu-trusty main\
> /etc/apt/sources.list.d/docker.list"

## Update to pick up new registries
apt-get update -y

## Update kernel
apt-get install -y \
    linux-image-$KERNEL_VER \
    linux-headers-$KERNEL_VER \
    linux-image-extra-$KERNEL_VER \
    linux-image-extra-virtual \
    dkms

## Install all the packages
apt-get install -y \
    unattended-upgrades \
    docker-engine=$DOCKER_VERSION \
    btrfs-tools \
    lvm2 \
    curl \
    build-essential \
    git-core \
    gstreamer0.10-alsa \
    gstreamer0.10-plugins-bad \
    gstreamer0.10-plugins-base \
    gstreamer0.10-plugins-good \
    gstreamer0.10-plugins-ugly \
    gstreamer0.10-tools \
    pbuilder \
    python-mock \
    python-configobj \
    python-support \
    cdbs \
    python-pip \
    jq \
    rsyslog-gnutls \
    openvpn \
    lxc \
    screen

## Install v4l2loopback
cd /usr/src
rm -rf v4l2loopback-$V4L2LOOPBACK_VERSION
git clone https://github.com/umlaeute/v4l2loopback.git v4l2loopback-$V4L2LOOPBACK_VERSION
cd v4l2loopback-$V4L2LOOPBACK_VERSION
sudo dkms install -m v4l2loopback -v $V4L2LOOPBACK_VERSION -k ${KERNEL_VER}
sudo dkms build -m v4l2loopback -v $V4L2LOOPBACK_VERSION -k ${KERNEL_VER}

echo "v4l2loopback" | sudo tee --append /etc/modules

cat <<EOF | sudo tee --append /etc/modprobe.d/test-modules.conf >&2
options v4l2loopback devices=100
EOF


# Install Audio loopback devices
echo "snd-aloop" | sudo tee --append /etc/modules

cat <<EOF | sudo tee --append /etc/modprobe.d/test-modules.conf >&2
options snd-aloop enable=1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1 index=0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29
EOF

# Initialize video and sound loopback modules
modprobe v4l2loopback
modprobe snd-aloop
# Create dependency file
depmod

# Install nodejs
url=http://nodejs.org/dist/v$node_version/node-v$node_version-linux-x64.tar.gz

# Download and install node to the /usr/ directory
sudo curl $url > /tmp/node-$node_version.tar.gz
sudo tar xzf /tmp/node-$node_version.tar.gz \
        -C /usr/local/ --strip-components=1

# test it out
node --version

npm install -g babel@4.7.16
