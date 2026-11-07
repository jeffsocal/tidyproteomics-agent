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

# Read markdown
with open(INPUT_MD, "r", encoding="utf-8") as f:
    md_text = f.read()

# Build references.bib
# (We already have references.bib written in overleaf/references.bib)

# Citation replacement dictionary
# Note: replace compound citations first, then single ones
CITE_REPLACEMENTS = [
    (r"\[1, 2\]", r"\\cite{jones2023tidyproteomics, aebersold2016mass}"),
    (r"\[1, 5\]", r"\\cite{jones2023tidyproteomics, nesvizhskii2014proteomics}"),
    (r"\[1, 7\]", r"\\cite{jones2023tidyproteomics, karpievitch2012normalization}"),
    (r"\[8, 9\]", r"\\cite{lazar2016accounting, wei2018missing}"),
    (r"\[8, 10\]", r"\\cite{lazar2016accounting, willforss2019normalyzerde}"),
    (r"\[1, 14\]", r"\\cite{jones2023tidyproteomics, peng2011reproducible}"),
    (r"\[1, 15\]", r"\\cite{jones2023tidyproteomics, choi2014msstats}"),
    (r"\[1, 19\]", r"\\cite{jones2023tidyproteomics, gatto2014assessing}"),
    (r"\[19[–-]21\]", r"\\cite{gatto2014assessing, mangul2019systematic, batut2018community}"),
    (r"\[22[–-]28\]", r"\\cite{singhal2023large, moor2023foundation, boiko2023autonomous, bran2024augmenting, jimenez2024swebench, schick2023toolformer, lu2024aiscientist}"),
    (r"\[29[–-]31\]", r"\\cite{huang2023survey, ji2023survey, alberts2015selfcorrection}"),
    (r"\[29, 32, 33\]", r"\\cite{huang2023survey, karpievitch2010liquid, benjamini1995controlling}"),
    (r"\[26, 36\]", r"\\cite{jimenez2024swebench, chen2021evaluating}"),
    (r"\[38, 39\]", r"\\cite{meyer2012emerging, vandenboom2018vcp}"),
    (r"\[40, 41\]", r"\\cite{christianson2012defining, leitman2014herp}"),
    (r"\[42, 43\]", r"\\cite{radhakrishnan2010transcription, koizumi2016aspartyl}"),
    (r"\[3\]", r"\\cite{cox2008maxquant}"),
    (r"\[4\]", r"\\cite{demichev2020diann}"),
    (r"\[6\]", r"\\cite{wang2019deep}"),
    (r"\[11\]", r"\\cite{ritchie2015limma}"),
    (r"\[12\]", r"\\cite{korotkevich2021fgsea}"),
    (r"\[13\]", r"\\cite{tyanova2016perseus}"),
    (r"\[15\]", r"\\cite{choi2014msstats}"),
    (r"\[16\]", r"\\cite{zhang2018proteomewide}"),
    (r"\[17\]", r"\\cite{wickham2019welcome}"),
    (r"\[18\]", r"\\cite{altmetric2024tidyproteomics}"),
    (r"\[35\]", r"\\cite{liu2024lost}"),
    (r"\[37\]", r"\\cite{anthropic2024mcp}"),
    (r"\[44\]", r"\\cite{wilkinson2016fair}"),
    (r"\[45\]", r"\\cite{icmje2024authorship}"),
]

def apply_citations(text):
    for pattern, repl in CITE_REPLACEMENTS:
        text = re.sub(pattern, repl, text)
    return text

print("Defined apply_citations.")

