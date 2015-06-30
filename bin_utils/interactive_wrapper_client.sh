#!/bin/bash
flock -s /tmp/interactive.lock $@
