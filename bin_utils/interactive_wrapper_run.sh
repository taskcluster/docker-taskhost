#!/bin/bash
trap 'kill -TERM $PID' TERM INT
${@:2} &
PID=$!
wait $PID
trap - TERM INT
wait $PID
EXIT_STATUS=$?
sleep $1
flock -x /tmp/interactive.lock true
exit EXIT_STATUS
