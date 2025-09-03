#!/bin/bash
if git diff -U0 | grep -E "writeFileSync|fs\.writeFile|events\.json|bills\.json|policies\.json|property_documents\.json"; then
  echo "❌ JSON write detected"; exit 1; fi
