#! /bin/bash -vex

make -C git
docker build -t $(cat DOCKER_TAG):$(cat VERSION) $PWD

echo "If deploying now you can run 'docker push $(cat DOCKER_TAG):$(cat VERSION)'"
