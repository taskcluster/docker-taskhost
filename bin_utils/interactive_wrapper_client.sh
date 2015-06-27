#!/bin/bash
# or ./busybox sh, both work
(
flock -s 200
exec $@
) 200>/tmp/interactive.lock
