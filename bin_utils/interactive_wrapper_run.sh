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
flock -x /tmp/interactive.lock true
exit $EXIT_STATUS
