#!/bin/bash
# or ./busybox sh, both work
exec "${@:2}"
sleep $1
(
flock -x 200
echo
) 200>/tmp/interactive.lock
