#!/bin/bash
if git diff -U0 | grep -E "writeFileSync|fs\.writeFile|events\.json|bills\.json"; then
  echo "❌ JSON write detected"; exit 1; fi
