#!/usr/bin/env python3
import os
import re
import subprocess
import zipfile

OVERLEAF_DIR = "ai_benchmarking/overleaf"
DOCS_DIR = "ai_benchmarking/docs"
INPUT_MD = os.path.join(DOCS_DIR, "publication_draft_06.md")

os.makedirs(os.path.join(OVERLEAF_DIR, "figures"), exist_ok=True)

# Copy figures
FIG_NAMES = [
    "figure_1_system_architecture",
    "figure_2_biological_findings",
    "figure_3_benchmark_revisions",
    "figure_4_cost_intelligence_frontier",
    "figure_S1_verifier_architecture"
]
for fig in FIG_NAMES:
    for ext in [".png", ".pdf"]:
        src = os.path.join("ai_benchmarking/figures", fig + ext)
        dst = os.path.join(OVERLEAF_DIR, "figures", fig + ext)
        if os.path.exists(src):
            subprocess.run(["cp", src, dst], check=True)

print("Copied figures to Overleaf folder.")

