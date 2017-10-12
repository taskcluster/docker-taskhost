#! /bin/bash

set -e -v -x

sudo ln -s /vagrant /worker

NODE_VERSION=v6.9.1
DOCKER_VERSION=17.06.2~ce-0~ubuntu

# Kernels < 3.13.0.77 and > 3.13.0.71 have an AUFS bug which can cause docker
# containers to not exit properly because of zombie processes that can't be reaped.
KERNEL_VER=3.13.0-79-generic
V4L2LOOPBACK_VERSION=0.8.0

sudo apt-get update -y

## Update kernel
sudo apt-get install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    dkms \
    software-properties-common \
    linux-image-$KERNEL_VER \
    linux-headers-$KERNEL_VER \
    linux-image-extra-$KERNEL_VER \
    linux-image-extra-virtual \

# Add docker's gpg key
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -

# Add stable repo
sudo add-apt-repository \
   "deb [arch=amd64] https://download.docker.com/linux/ubuntu \
   $(lsb_release -cs) \
   stable"

sudo groupadd docker
sudo usermod -a -G docker vagrant

sudo apt-get update -y
apt-cache madison docker-ce

## Install all the packages
sudo apt-get install -y \
    unattended-upgrades \
    docker-ce=$DOCKER_VERSION \
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
    lxc

# Install node
cd /usr/local/ && \
  curl https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.gz | tar -xz --strip-components 1 && \
  node -v

# Install some necessary node packages
npm install -g yarn@1.0.2 babel-cli

# Install Video loopback devices
sudo apt-get install -y \
    v4l2loopback-utils \
    gstreamer0.10-plugins-ugly \
    gstreamer0.10-plugins-good \
    gstreamer0.10-plugins-bad

sh -c 'echo "v4l2loopback" >> /etc/modules'

cat << EOF > /etc/modprobe.d/test-modules.conf
options v4l2loopback devices=100
EOF

sudo modprobe v4l2loopback

# Install Audio loopback devices
sh -c 'echo "snd-aloop" >> /etc/modules'

cat << EOF > /etc/modprobe.d/test-modules.conf
options snd-aloop enable=1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1 index=0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29
EOF
sudo modprobe snd-aloop

# Create dependency file
depmod
