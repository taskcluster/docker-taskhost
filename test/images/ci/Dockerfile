FROM ubuntu:14.04

ENV NODE_VERSION 6.9.1
ENV DOCKER_VERSION 17.06.2~ce-0~ubuntu

RUN apt-get update && apt-get install -y apt-transport-https ca-certificates curl software-properties-common

RUN curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -
RUN add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable"
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    ca-certificates \
    docker-ce=$DOCKER_VERSION \
    git \
    iptables \
    lxc \
    python \
    jq

RUN curl -SL "http://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.gz" | \
    tar xz -C /usr/local --strip-components=1 && \
    npm install -g babel-cli yarn@1.0.2

env HOME /home/tester
env SHELL /bin/bash
env PATH $PATH:/home/tester/bin
workdir /home/tester

COPY bin /home/tester/bin/
COPY ./wrapdocker /usr/local/bin/wrapdocker
COPY ./gitconfig /home/tester/.gitconfig

# install our custom git plugin
COPY git/target/doc/git-ci-checkout-pr.1 /usr/local/man/man1/git-ci-checkout-pr.1
COPY git/target/doc/git-ci-checkout-ref.1 /usr/local/man/man1/git-ci-checkout-ref.1
COPY git/target/doc/git-ci-checkout-setup.1 /usr/local/man/man1/git-ci-checkout-setup.1
COPY git/git-ci-checkout-pr /usr/local/bin/git-ci-checkout-pr
COPY git/git-ci-checkout-ref /usr/local/bin/git-ci-checkout-ref
COPY git/git-ci-checkout-setup /usr/local/bin/git-ci-checkout-setup

RUN chmod +x /usr/local/bin/wrapdocker
RUN chmod a+x /home/tester/bin/*

# Define additional metadata for our image.
VOLUME /var/lib/docker

ENTRYPOINT ["wrapdocker"]
