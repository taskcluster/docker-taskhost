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
# make sure it doesn't die before the interactive feature's file lock locks it
sleep 5
flock -x /.taskclusterinteractivesession.lock true
exit $EXIT_STATUS
