#!/usr/bin/env sh
set -eu

git config core.hooksPath .githooks
printf 'Git hooks installed. pre-commit will run npm test before each commit.\n'
