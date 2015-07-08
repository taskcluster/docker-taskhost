#!/bin/bash
trap 'kill -TERM $PID' TERM INT
(
	exec "$@"
)
PID=$!
wait $PID
trap - TERM INT
wait $PID
EXIT_STATUS=$?
# make sure it doesn't die before the interactive gets a hold of it
sleep 5
flock -x /tmp/interactive.lock true
exit $EXIT_STATUS
