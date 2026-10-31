#!/usr/bin/env bash
export PATH="/home/ken/.gemini/antigravity/scratch/node/bin:$PATH"
cd "$(dirname "$0")"
pnpm build
