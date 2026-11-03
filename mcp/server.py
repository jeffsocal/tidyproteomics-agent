#!/usr/bin/env python3
"""
TidyProteomics Model Context Protocol (MCP) Server.
Comprehensive implementation covering all exported functions in tidyproteomics.
Communicates via JSON-RPC 2.0 over stdio with LLM clients (Claude, Cursor, Antigravity)
and delegates operations to the persistent R Daemon.
"""

import sys
import json
import os
import time
import datetime
import subprocess
import urllib.request
import urllib.error
import atexit
import signal

DAEMON_URL = os.environ.get("TIDY_DAEMON_URL", "http://127.0.0.1:8765")
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
R_DAEMON_SCRIPT = os.path.join(SCRIPT_DIR, "r_daemon.R")

daemon_process = None

def cleanup_daemon():
    """Cleanly shuts down the persistent R daemon and process group."""
    global daemon_process
    try:
        req = urllib.request.Request(
            f"{DAEMON_URL}/shutdown",
            data=b"{}",
            headers={"Content-Type": "application/json", "User-Agent": "MCP-Client"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=1):
            pass
    except Exception:
        pass

    if daemon_process is not None:
        try:
            if hasattr(os, "killpg") and hasattr(os, "getpgid"):
                os.killpg(os.getpgid(daemon_process.pid), signal.SIGTERM)
            else:
                daemon_process.terminate()
            daemon_process.wait(timeout=2)
        except Exception:
            try:
                if hasattr(os, "killpg") and hasattr(os, "getpgid"):
                    os.killpg(os.getpgid(daemon_process.pid), signal.SIGKILL)
                else:
                    daemon_process.kill()
            except Exception:
                pass
        daemon_process = None

atexit.register(cleanup_daemon)

def _sig_handler(signum, frame):
    cleanup_daemon()
    sys.exit(0)

signal.signal(signal.SIGTERM, _sig_handler)
signal.signal(signal.SIGINT, _sig_handler)

def ensure_daemon():
    """Checks if the R daemon is running; starts it if needed."""
    global daemon_process
    try:
        req = urllib.request.Request(f"{DAEMON_URL}/health", headers={"User-Agent": "MCP-Client"})
        with urllib.request.urlopen(req, timeout=1) as resp:
            if resp.status == 200:
                return
    except Exception:
        pass

    # Start R daemon with robust logging path
    log_dir = os.environ.get("TIDY_LOG_DIR")
    if not log_dir:
        if os.access(SCRIPT_DIR, os.W_OK):
            log_dir = SCRIPT_DIR
        else:
            log_dir = os.path.join(os.path.expanduser("~"), ".tidyproteomics")
    os.makedirs(log_dir, exist_ok=True)
    log_file = os.path.join(log_dir, "daemon.log")

    sys.stderr.write(f"[MCP Server] Starting persistent R Daemon: {R_DAEMON_SCRIPT} (log: {log_file}) ...\n")
    log_fd = open(log_file, "w")
    daemon_process = subprocess.Popen(
        ["Rscript", R_DAEMON_SCRIPT],
        stdout=log_fd,
        stderr=subprocess.STDOUT,
        preexec_fn=os.setsid if hasattr(os, "setsid") else None
    )

    # Wait for daemon to become ready
    for _ in range(30):
        time.sleep(0.5)
        try:
            req = urllib.request.Request(f"{DAEMON_URL}/health", headers={"User-Agent": "MCP-Client"})
            with urllib.request.urlopen(req, timeout=1) as resp:
                if resp.status == 200:
                    sys.stderr.write("[MCP Server] R Daemon is ready!\n")
                    return
        except Exception:
            continue
    raise RuntimeError("Failed to connect to R Daemon after 15 seconds.")

def get_daemon_stderr(max_lines=40):
    log_dir = os.environ.get("TIDY_LOG_DIR")
    if not log_dir:
        if os.access(SCRIPT_DIR, os.W_OK):
            log_dir = SCRIPT_DIR
        else:
            log_dir = os.path.join(os.path.expanduser("~"), ".tidyproteomics")
    log_file = os.path.join(log_dir, "daemon.log")
    if os.path.exists(log_file):
        try:
            with open(log_file, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
                return "".join(lines[-max_lines:])
        except Exception:
            pass
    return "No daemon stderr available."

def call_daemon(endpoint, payload=None):
    """Sends HTTP POST or GET to the R daemon."""
    ensure_daemon()
    url = f"{DAEMON_URL}{endpoint}"
    data = json.dumps(payload or {}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "User-Agent": "MCP-Client"},
        method="POST" if payload is not None else "GET"
    )
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            res_json = json.loads(resp.read().decode("utf-8"))
            return res_json
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        try:
            return json.loads(err_body)
        except Exception:
            return {"success": False, "error": f"HTTP {e.code}: {err_body}"}
    except Exception as e:
        return {"success": False, "error": str(e)}

TOOLS = [
    {
        "name": "tpa_health",
        "description": "Checks the status of the R Daemon, active tidyproteomics version, loaded datasets, and environment.",
        "inputSchema": {
            "type": "object",
            "properties": {}
        }
    },
    {
        "name": "tpa_load",
        "description": "Loads a dataset into persistent memory. Supports saved local RDS files ('data/tidyproteomics_data.rds'), remote URLs ('https://...'), built-in package datasets ('hela_proteins', 'p97KD_HCT116'), or raw external files.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {
                    "type": "string",
                    "description": "Dataset name ('hela_proteins', 'p97KD_HCT116') or external file path."
                },
                "platform": {
                    "type": "string",
                    "description": "Parser platform if loading external files: 'ProteomeDiscoverer', 'MaxQuant', 'DIA-NN', 'FragPipe', 'Skyline', 'mzTab', etc."
                },
                "analyte": {
                    "type": "string",
                    "enum": ["proteins", "peptides"],
                    "description": "Measurement level (default: 'proteins')."
                },
                "id": {
                    "type": "string",
                    "description": "Identifier for this dataset session (default: 'rdata')."
                },
                "load_local": {
                    "type": "string",
                    "description": "Optional path to a local .rds file saved previously via save_local."
                },
                "config": {
                    "type": "string",
                    "description": "Optional path to a custom platform configuration TSV file (e.g. 'MaxQuant_proteins.tsv')."
                }
            }
        }
    },
    {
        "name": "tpa_import_expression_table",
        "description": "Imports a pre-computed external differential expression table (CSV/TSV from MaxQuant, MSstats, Perseus, or Limma) directly into a persistent tidyproteomics object. Constructs necessary analysis and metadata slots so functional annotation fetching (GO/Reactome), pathway enrichment, volcano plotting, and manuscript synthesis work immediately.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Path to the flat differential expression CSV or TSV file."
                },
                "comparison": {
                    "type": "string",
                    "description": "Comparison contrast string (e.g. 'treatment/control')."
                },
                "id_col": {
                    "type": "string",
                    "description": "Protein accession/identifier column name (auto-detected if omitted)."
                },
                "gene_name_col": {
                    "type": "string",
                    "description": "Gene name/symbol column name (auto-detected if omitted)."
                },
                "log2fc_col": {
                    "type": "string",
                    "description": "Log2 fold-change column name (auto-detected if omitted)."
                },
                "pvalue_col": {
                    "type": "string",
                    "description": "Raw p-value column name (auto-detected if omitted)."
                },
                "padj_col": {
                    "type": "string",
                    "description": "Adjusted p-value / FDR / q-value column name (auto-detected if omitted)."
                },
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID in session memory (defaults to 'rdata')."
                }
            },
            "required": ["file_path"]
        }
    },
    {
        "name": "tpa_inspect",
        "description": "Introspects the active dataset: retrieves sample names, quantitation names, completed analyses, annotations, accounting columns or authoritative feature accounting breakdown, and experimental variables.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "what": {
                    "type": "string",
                    "enum": ["samples", "quants", "analyses", "annotations", "annotation_terms", "accountings", "accounting", "protein_accounting", "feature_accounting", "variables", "unique_variables", "experiments", "operations", "overview", "summary"],
                    "description": "What metadata to inspect. Use 'accounting' for the authoritative feature retention and modeled/unmodeled accounting table; use 'accountings' for accounting column types."
                },
                "variable": {
                    "type": "string",
                    "description": "Variable name when inspecting 'unique_variables' (e.g. 'sample', 'replicate'). Avoid querying high-cardinality entity variables like 'protein' or 'peptide' to prevent large output."
                },
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            },
            "required": ["what"]
        }
    },
    {
        "name": "tpa_summary",
        "description": "Computes and displays summary statistics, normalization comparisons, or contaminant reports for the active dataset.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "by": {
                    "type": "string",
                    "description": "Level of summary breakdown: 'global', 'sample', 'experiment', 'normalization', or any annotation term."
                },
                "contamination": {
                    "type": "string",
                    "description": "Contaminant prefix to report (e.g. 'CRAP', 'Keratin', 'BSA')."
                },
                "destination": {
                    "type": "string",
                    "enum": ["print", "save"],
                    "description": "'print' to view table, 'save' to export to a CSV file."
                },
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            }
        }
    },
    {
        "name": "tpa_subset",
        "description": "Filters the dataset using an R expression (supports '%like%', '!', '>', '==', etc.). Automatically updates the active persistent object.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "expression": {
                    "type": "string",
                    "description": "R subset expression, e.g. '!description %like% \"^CRAP\"', 'imputed == 0', or 'sample %in% c(\"control\")'."
                },
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            },
            "required": ["expression"]
        }
    },
    {
        "name": "tpa_reassign",
        "description": "Modifies sample names in the experimental design table, or updates sample origin provenance tracking. Supports either a batch mapping dictionary (mapping={'raw_1': 'clean_1', ...}) or single condition/replace expressions (e.g. condition='sample %like% \"surfactin\"', replace='surfactin').",
        "inputSchema": {
            "type": "object",
            "properties": {
                "target": {
                    "type": "string",
                    "enum": ["sample", "origin"],
                    "description": "'sample' for reassign(), 'origin' for origins()."
                },
                "mapping": {
                    "type": "object",
                    "description": "Optional dictionary mapping raw sample names to clean biological condition labels: {'st1_0': 'control', 'st1_surfactin': 'surfactin'}."
                },
                "condition": {
                    "type": "string",
                    "description": "Three-part expression condition (e.g. 'sample == \"control\"' or 'sample %like% \"surfactin\"')."
                },
                "replace": {
                    "type": "string",
                    "description": "Replacement string label (e.g. 'ctrl' or 'surfactin')."
                },
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            }
        }
    },
    {
        "name": "tpa_rm_mbr",
        "description": "Removes Match-Between-Runs (MBR) identifications from the dataset across sample segments.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "groups": {
                    "type": "string",
                    "enum": ["all", "sample"],
                    "description": "Level across which to remove MBR (default: 'sample')."
                },
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            }
        }
    },
    {
        "name": "tpa_annotate",
        "description": "Appends external biological annotations to the dataset from a CSV/TSV file.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Path to CSV/TSV table containing identifier, term, and annotation columns."
                },
                "duplicates": {
                    "type": "string",
                    "enum": ["replace", "merge", "leave"],
                    "description": "Action on duplicates (default: 'merge')."
                },
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            },
            "required": ["file_path"]
        }
    },
    {
        "name": "tpa_audit_annotations",
        "description": "Audits a local annotation file or active dataset annotations for schema compatibility, column synonyms, and protein identifier overlap percentage.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Optional path to CSV/TSV table. If omitted, audits active in-memory annotations on the dataset."
                },
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            }
        }
    },
    {
        "name": "tpa_integrate_annotations",
        "description": "Integrates external biological annotations from a CSV/TSV/delimited file into the active dataset with delimiter sniffing and column synonym mapping.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Path to CSV/TSV table containing identifier, term, and annotation columns."
                },
                "duplicates": {
                    "type": "string",
                    "enum": ["merge", "replace", "leave"],
                    "description": "Action on duplicates (default: 'merge')."
                },
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            },
            "required": ["file_path"]
        }
    },
    {
        "name": "tpa_fetch_annotations",
        "description": "Autonomously fetches biological annotations (GO terms, Reactome pathways, KEGG) from UniProt KB REST API for active dataset accessions, caches to data/annotations_<source>.tsv, and attaches to dataset.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {
                    "type": "string",
                    "enum": ["uniprot"],
                    "description": "Remote database provider (default: 'uniprot')."
                },
                "taxon_id": {
                    "type": "string",
                    "description": "NCBI Taxonomy ID (e.g. '9606' for Human, '10090' for Mouse). Optional."
                },
                "categories": {
                    "type": "string",
                    "description": "Comma-separated target ontologies (e.g. 'biological_process, cellular_component, molecular_function, reactome_pathway, kegg')."
                },
                "output_file": {
                    "type": "string",
                    "description": "Local workspace TSV path to cache annotations (default: 'data/annotations_uniprot.tsv')."
                },
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            }
        }
    },
    {
        "name": "tpa_list_annotations",
        "description": "Lists attached biological annotation ontologies, annotation counts per category, and protein coverage metrics for the active dataset.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            }
        }
    },
    {
        "name": "tpa_normalize",
        "description": "Runs one or more normalization algorithms and evaluates performance. Exposes all 7 tidyproteomics methods: linear models ('scaled', 'median', 'linear', 'limma') and non-linear models ('loess', 'svm', 'randomforest'). Defaults to the linear models plus loess (['scaled', 'median', 'linear', 'limma', 'loess']) unless HITL specifies 'svm' or 'randomforest' (which are more compute-intensive) or 'all'. When training normalization on a sub-population via subset_filter (e.g. 'description %like% \"Ribosome\"'), only linear models ('scaled', 'median', 'linear') and 'svm' can predict beyond the scope of the training set and are automatically selected.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "methods": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": ["scaled", "median", "linear", "limma", "loess", "svm", "randomforest", "default", "all"]
                    },
                    "description": "List of normalization methods to apply. Defaults to ['scaled', 'median', 'linear', 'limma', 'loess'] (linear models + loess), or ['scaled', 'median', 'linear', 'svm'] when subset_filter is provided. Include 'svm' or 'randomforest' (or 'all') when requested in Section 3 of docs/experiment.md."
                },
                "subset_filter": {
                    "type": "string",
                    "description": "Optional sub-population filter expression to train normalization factors on before applying to the full dataset (e.g. 'description %like% \"Ribosome\"' or '!description %like% \"mitochondrial\"'). Note: only linear models ('scaled', 'median', 'linear') and 'svm' can predict beyond the training subset."
                },
                "cores": {
                    "type": "integer",
                    "description": "Optional number of CPU threads for compute-intensive non-linear normalization ('svm', 'randomforest')."
                },
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            }
        }
    },
    {
        "name": "tpa_select_normalization",
        "description": "Explicitly selects or switches the active normalization source (e.g. 'limma', 'median') or selects optimal automatically.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "normalization": {
                    "type": "string",
                    "description": "Name of the normalization method to activate. Omit to run automatic optimal selection."
                },
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            }
        }
    },
    {
        "name": "tpa_impute",
        "description": "Imputes missing values in the active dataset. Defaults to Random Forest within sample groups ('impute.randomforest, method = \"matrix\", group_by_sample = TRUE') for general MAR missingness, or column-wise minimum ('base::min, method = \"column\"') for MNAR / knockouts / condition-exclusive switches.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "method": {
                    "type": "string",
                    "description": "Imputation expression or shorthand: 'impute.randomforest, method = \"matrix\", group_by_sample = TRUE' (or 'randomforest_grouped' for MAR default), or 'base::min, method = \"column\"' (or 'min_column' for MNAR/knockouts)."
                },
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            }
        }
    },
    {
        "name": "tpa_collapse",
        "description": "Collapses peptide-level measurements into protein-level data using specified aggregation and razor-protein assignment algorithms.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "collapse_to": {
                    "type": "string",
                    "description": "Target analyte level (default: 'protein')."
                },
                "assign_by": {
                    "type": "string",
                    "enum": ["all-possible", "razor-local", "razor-global", "non-homologous"],
                    "description": "Algorithm for assigning shared peptides."
                },
                "top_n": {
                    "type": "number",
                    "description": "Top N most abundant peptides to aggregate (default: Inf)."
                },
                "split_abundance": {
                    "type": "boolean",
                    "description": "Split abundance equally across candidate proteins."
                },
                "fasta_path": {
                    "type": "string",
                    "description": "Optional path to FASTA file for sequence verification."
                },
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            }
        }
    },
    {
        "name": "tpa_merge",
        "description": "Merges two in-memory tidyproteomics datasets into a single unified dataset.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "id1": {
                    "type": "string",
                    "description": "First dataset ID (default: active dataset)."
                },
                "id2": {
                    "type": "string",
                    "description": "Second dataset ID to merge with."
                },
                "new_id": {
                    "type": "string",
                    "description": "ID for the resulting merged dataset (default: 'merged_data')."
                }
            },
            "required": ["id2"]
        }
    },
    {
        "name": "tpa_expression",
        "description": "Performs two-sample differential expression analysis between two conditions (e.g. 'knockdown/control').",
        "inputSchema": {
            "type": "object",
            "properties": {
                "comparison": {
                    "type": "string",
                    "description": "Pairwise contrast expression, e.g. 'knockdown/control'."
                },
                "method": {
                    "type": "string",
                    "enum": ["limma", "t.test", "wilcoxon", "mixed-effects"],
                    "description": "Statistical method to use (default: 'limma')."
                },
                "p_adjust": {
                    "type": "string",
                    "description": "P-value adjustment method: 'BH', 'bonferroni', 'holm', etc. (default: 'BH')."
                },
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            },
            "required": ["comparison"]
        }
    },
    {
        "name": "tpa_enrichment",
        "description": "Computes GO term or pathway enrichment analysis on previous differential expression results.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "comparison": {
                    "type": "string",
                    "description": "Contrast expression (e.g. 'knockdown/control')."
                },
                "terms": {
                    "type": "string",
                    "description": "Annotation ontology term to group by (e.g. 'biological_process', 'cellular_component', 'molecular_function', 'reactome_pathway', 'wiki_pathway')."
                },
                "method": {
                    "type": "string",
                    "enum": ["gsea", "wilcoxon", "fisher"],
                    "description": "Statistical enrichment method (default: 'gsea')."
                },
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            },
            "required": ["comparison"]
        }
    },
    {
        "name": "tpa_batch_analysis",
        "description": "Executes automated end-to-end batch differential expression (analyze_expressions) or batch enrichment (analyze_enrichments) across all completed comparisons.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "type": {
                    "type": "string",
                    "enum": ["expressions", "enrichments", "expression", "enrichment"],
                    "description": "Batch analysis pipeline to run ('expressions'/'analyze_expressions' or 'enrichments'/'analyze_enrichments')."
                },
                "labels_column": {
                    "type": "string",
                    "description": "Column for volcano plot labels in batch expressions (default: 'gene_name')."
                },
                "top_n": {
                    "type": "integer",
                    "description": "Top N terms to display in batch enrichment faceted plot (default: 50)."
                },
                "significance_max": {
                    "type": "number",
                    "description": "Adjusted p-value significance threshold (default: 0.05)."
                },
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            },
            "required": ["type"]
        }
    },
    {
        "name": "tpa_intersection",
        "description": "Extracts specific overlapping or exclusive segments from Venn/Euler sets (e.g. proteins present in control but absent in knockdown).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "include": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Sample names that must contain the protein (e.g. ['control'])."
                },
                "exclude": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Sample names that must NOT contain the protein (e.g. ['knockdown'])."
                },
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            }
        }
    },
    {
        "name": "tpa_extract",
        "description": "Extracts a tidy long tibble of quantitative abundances, annotations, and accounting data.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "values": {
                    "type": "string",
                    "description": "Abundance source to extract: specific method name like 'loess', 'median', 'linear', 'limma', or 'raw' (do not use 'normalized')."
                },
                "na_rm": {
                    "type": "boolean",
                    "description": "Remove rows with NA abundances (default: false)."
                },
                "save_csv": {
                    "type": "string",
                    "description": "Optional CSV filename to export the extracted data table to disk."
                },
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            }
        }
    },
    {
        "name": "tpa_query_expression",
        "description": "Queries statistical differential expression results for specific comparisons with threshold filters (e.g., log2FC, adj.p-value). Returns a ranked candidate list and optionally writes filtered candidates to a CSV/TSV.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "comparison": {
                    "type": "string",
                    "description": "The comparison contrast, e.g. 'p97_kd/ctl' or 'treatment/control'. If omitted, the first available comparison is used."
                },
                "min_log2fc": {
                    "type": "number",
                    "description": "Minimum absolute log2 fold-change threshold (e.g. 0.5 or 1.0). Default is 0.0 (no filter)."
                },
                "max_adjp": {
                    "type": "number",
                    "description": "Maximum adjusted p-value threshold (e.g. 0.05 or 0.01). Default is 1.0 (no filter)."
                },
                "max_p": {
                    "type": "number",
                    "description": "Optional maximum nominal p-value threshold."
                },
                "direction": {
                    "type": "string",
                    "enum": ["up", "down", "both"],
                    "description": "Direction of differential expression: 'up' (log2FC >= min_log2fc), 'down' (log2FC <= -min_log2fc), or 'both' (|log2FC| >= min_log2fc). Default is 'both'."
                },
                "sort_by": {
                    "type": "string",
                    "enum": ["adj_p_value", "log2_foldchange", "p_value"],
                    "description": "Column to sort candidate results by. Default is 'adj_p_value'."
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum candidate rows to return in markdown preview. Default is 50."
                },
                "save_csv": {
                    "type": "string",
                    "description": "Optional file path to write the full filtered candidates table (CSV or TSV)."
                },
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            }
        }
    },
    {
        "name": "tpa_query_enrichment",
        "description": "Queries pathway and functional enrichment results across annotation categories (GO, Reactome, WikiPathways) with filters for comparison contrast, ontology terms, significance threshold, Wilcoxon score direction, and leading driver genes. Automatically resolves Reactome IDs to human-readable names.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "comparison": {
                    "type": "string",
                    "description": "The comparison contrast, e.g. 'p97_knockout/control'. If omitted, the first available comparison is used."
                },
                "terms": {
                    "type": "string",
                    "description": "Annotation category to query: 'all', 'reactome_pathway', 'biological_process', 'cellular_component', 'molecular_function', or 'wiki_pathway'. Default is 'all'."
                },
                "max_adjp": {
                    "type": "number",
                    "description": "Maximum adjusted p-value threshold (e.g. 0.05 or 0.01). Default is 1.0 (no filter)."
                },
                "max_p": {
                    "type": "number",
                    "description": "Optional maximum nominal p-value threshold."
                },
                "direction": {
                    "type": "string",
                    "enum": ["up", "down", "positive", "negative", "both"],
                    "description": "Direction of enrichment: 'positive'/'up' (higher abundance in treatment), 'negative'/'down' (lower abundance in treatment), or 'both'. Default is 'both'."
                },
                "sort_by": {
                    "type": "string",
                    "enum": ["adj_p_value", "enrichment", "p_value"],
                    "description": "Column to sort candidate results by. Default is 'adj_p_value'."
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum pathway rows to return in markdown preview. Default is 50."
                },
                "resolve_reactome": {
                    "type": "boolean",
                    "description": "Whether to resolve Reactome accession IDs (R-HSA-*) to human-readable names. Default is true."
                },
                "save_csv": {
                    "type": "string",
                    "description": "Optional file path to write the full filtered enrichment table (CSV or TSV)."
                },
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            }
        }
    },
    {
        "name": "tpa_plot",
        "description": "Generates any visualization from the tidyproteomics suite and saves it to a PNG file.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "type": {
                    "type": "string",
                    "enum": [
                        "counts", "quantrank", "venn", "euler", "normalization",
                        "variation_cv", "variation_pca", "dynamic_range", "heatmap",
                        "pca", "volcano", "proportion", "enrichment", "proteins_enrichment", "compexp",
                        "expression", "protein", "signatures", "candidates", "programs", "forest"
                    ],
                    "description": "The visualization to generate."
                },
                "comparison": {
                    "type": "string",
                    "description": "Contrast for volcano, proportion, enrichment, or expression plots (e.g. 'knockdown/control')."
                },
                "terms": {
                    "type": "string",
                    "description": "Ontology term for enrichment plots (e.g. 'biological_process')."
                },
                "protein": {
                    "type": "string",
                    "description": "Protein accession or identifier for plot_protein or plot_expression."
                },
                "file_name": {
                    "type": "string",
                    "description": "Optional destination file name or relative path in data/ (e.g. 'volcano_final.png')."
                },
                "extra_args": {
                    "type": "string",
                    "description": "Optional extra comma-separated R arguments (e.g. 'significance_column = \"p_value\", log2fc_min = 1')."
                },
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            },
            "required": ["type"]
        }
    },
    {
        "name": "tpa_protein_map",
        "description": "Parses a FASTA file and maps peptide coordinates and modifications to the primary protein sequence.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "fasta_path": {
                    "type": "string",
                    "description": "Path to FASTA database file."
                },
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            },
            "required": ["fasta_path"]
        }
    },
    {
        "name": "tpa_export_table",
        "description": "Exports specialized analysis tables (abundance matrices, differential expression, comparative expression, platform configs) to disk.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "type": {
                    "type": "string",
                    "enum": ["quant", "analysis", "compexp", "config", "skill", "template"],
                    "description": "Type of export."
                },
                "file_name": {
                    "type": "string",
                    "description": "Destination file path (.csv, .xlsx, .tsv, .rds)."
                },
                "comparison": {
                    "type": "string",
                    "description": "Comparison expression for analysis/compexp export (e.g. 'knockdown/control')."
                },
                "analysis": {
                    "type": "string",
                    "enum": ["expression", "enrichment"],
                    "description": "Analysis type when exporting analysis tables."
                },
                "term": {
                    "type": "string",
                    "description": "Term name if exporting enrichment tables."
                },
                "append": {
                    "type": "string",
                    "description": "Optional annotation term to append as a grouped member string (e.g. 'gene_name' to attach member genes to enrichment exports)."
                },
                "platform": {
                    "type": "string",
                    "description": "Platform name when exporting configs (e.g. 'ProteomeDiscoverer')."
                },
                "template_type": {
                    "type": "string",
                    "enum": ["discovery", "profiling", "pairwise", "multicontrast", "extracting"],
                    "description": "Template type when retrieving prompt templates."
                },
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            },
            "required": ["type"]
        }
    },
    {
        "name": "tpa_export_sdrf",
        "description": "Generates a ProteomeXchange-compliant SDRF (Sample and Data Relationship Format) metadata file (data/sdrf.tsv) adhering to PRIDE/MassIVE repository standards.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "file_name": {
                    "type": "string",
                    "description": "Destination file path (defaults to 'data/sdrf.tsv')."
                },
                "organism": {
                    "type": "string",
                    "description": "Scientific species name (e.g. 'Homo sapiens', 'Mus musculus')."
                },
                "cell_line_or_tissue": {
                    "type": "string",
                    "description": "Cell line or tissue name (e.g. 'HeLa', 'lung tissue')."
                },
                "ncbi_taxon_id": {
                    "type": "string",
                    "description": "NCBI Taxonomy ID (e.g. 'NCBITaxon:9606' for human)."
                },
                "instrument_model": {
                    "type": "string",
                    "description": "Mass spectrometer model (e.g. 'Orbitrap Exploris 480', 'Q Exactive HF-X')."
                },
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            }
        }
    },
    {
        "name": "tpa_export_config",
        "description": "Exports a platform import configuration TSV (e.g., 'MaxQuant', 'ProteomeDiscoverer') to the workspace for inspection and custom regex or column mapping modifications.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "platform": {
                    "type": "string",
                    "description": "Parser platform: 'MaxQuant', 'ProteomeDiscoverer', 'DIA-NN', 'FragPipe', 'Skyline', 'mzTab', etc."
                },
                "analyte": {
                    "type": "string",
                    "enum": ["proteins", "peptides"],
                    "description": "Measurement level (default: 'proteins')."
                },
                "output_path": {
                    "type": "string",
                    "description": "Optional output file path in workspace (default: '<platform>_<analyte>.tsv')."
                }
            },
            "required": ["platform"]
        }
    },
    {
        "name": "tpa_input_audit",
        "description": "Audits raw proteomics data headers (e.g. MaxQuant proteinGroups.txt, FragPipe, ProteomeDiscoverer TSV/XLSX) against active platform configuration regexes, returning match statuses and rules-based suggestions for unmapped or alternative columns (e.g. gene names, descriptions, MaxLFQ intensity). Note: advisory diagnostic; successful tpa_load is the ultimate ground truth for ingestion.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {
                    "type": "string",
                    "description": "Path to the raw proteomics data file (e.g. 'data/raw/proteinGroups.txt')."
                },
                "platform": {
                    "type": "string",
                    "description": "Parser platform: 'MaxQuant', 'ProteomeDiscoverer', 'DIA-NN', 'FragPipe', 'Skyline', 'mzTab', etc."
                },
                "analyte": {
                    "type": "string",
                    "enum": ["proteins", "peptides"],
                    "description": "Measurement level (default: 'proteins')."
                },
                "config": {
                    "type": "string",
                    "description": "Optional custom config TSV path."
                }
            },
            "required": ["source", "platform"]
        }
    },
    {
        "name": "tpa_ingest_config",
        "description": "Edits or customizes a platform ingestion configuration TSV to adjust regex patterns, add embedded annotations (e.g. gene_name, description, fasta_header), switch quantitative layers (e.g. MaxLFQ vs raw intensity), or auto_fix configurations based on raw data headers.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "platform": {
                    "type": "string",
                    "description": "Platform source (e.g. 'MaxQuant', 'ProteomeDiscoverer', 'FragPipe', 'DIA-NN')."
                },
                "analyte": {
                    "type": "string",
                    "enum": ["proteins", "peptides"],
                    "description": "Analyte level (default: 'proteins')."
                },
                "config_file": {
                    "type": "string",
                    "description": "Optional path to config TSV (defaults to '<platform>_<analyte>.tsv')."
                },
                "action": {
                    "type": "string",
                    "enum": ["view", "set", "add", "remove", "auto_fix"],
                    "description": "Action to perform ('view', 'set', 'add', 'remove', 'auto_fix')."
                },
                "category": {
                    "type": "string",
                    "enum": ["identifier", "quantitative", "accounting", "annotation", "sample", "impute"],
                    "description": "Category for the column (for action 'add' or 'set')."
                },
                "column_defined": {
                    "type": "string",
                    "description": "Target tidyproteomics column name (e.g. 'gene_name', 'description', 'abundance_raw', 'protein')."
                },
                "column_import": {
                    "type": "string",
                    "description": "Regex pattern matching raw column header (e.g. '^Gene names$', '^LFQ intensity\\s')."
                },
                "pattern_extract": {
                    "type": "string",
                    "description": "Optional regex to extract substring."
                },
                "pattern_remove": {
                    "type": "string",
                    "description": "Optional regex to remove."
                },
                "pattern_split": {
                    "type": "string",
                    "description": "Optional regex to split (e.g. '\\;')."
                },
                "pivot": {
                    "type": "boolean",
                    "description": "True if column should pivot across samples."
                },
                "file_name": {
                    "type": "string",
                    "description": "Path to raw data file when action is 'auto_fix'."
                },
                "use_lfq": {
                    "type": "boolean",
                    "description": "Whether to prioritize MaxLFQ when action is 'auto_fix' (default: true)."
                },
                "output_file": {
                    "type": "string",
                    "description": "Optional output TSV file path."
                }
            },
            "required": ["platform"]
        }
    },
    {
        "name": "tpa_normalization_sensitivity",
        "description": "Evaluates differential expression sensitivity across multiple candidate normalizations (e.g. median, loess, limma, randomforest) to quantify concordance and identify high-confidence biological candidates.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "comparison": {
                    "type": "string",
                    "description": "Contrast expression (e.g. 'knockdown/control')."
                },
                "methods": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "List of normalization methods to compare (e.g. ['median', 'linear', 'limma'])."
                },
                "p_cutoff": {
                    "type": "number",
                    "description": "Significance p-value/adjusted p-value cutoff (defaults to 0.05)."
                },
                "log2fc_cutoff": {
                    "type": "number",
                    "description": "Magnitude |log2FC| cutoff (defaults to 1.0)."
                },
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            },
            "required": ["comparison"]
        }
    },
    {
        "name": "tpa_run_code",
        "description": "Executes arbitrary R code expressions in the active session. The active dataset is bound to variable 'rdata'. Any updates to 'rdata' persist.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "code": {
                    "type": "string",
                    "description": "R code string to evaluate."
                }
            },
            "required": ["code"]
        }
    },
    {
        "name": "tpa_export_state",
        "description": "Exports the active tidyproteomics object to an RDS file and writes out the complete reproducible R pipeline script to disk.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "rds_path": {
                    "type": "string",
                    "description": "Optional filename/path for the saved .rds object (defaults to 'tidyproteomics_final.rds')."
                },
                "script_path": {
                    "type": "string",
                    "description": "Optional filename/path for the reproducible .R script (defaults to 'reproduce_pipeline.R')."
                },
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            }
        }
    },
    {
        "name": "tpa_update_data_doc",
        "description": "Compiles and writes or updates 'docs/data.md' containing structured tables for Ingestion Configuration, Input Header Audit, Sample Accounting Summaries, Sample Variabilities, and Functional Annotations. Can be called during Phase 01 or subsequent phases to keep data overview current.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Path to data document (default: 'docs/data.md')."
                },
                "phase": {
                    "type": "string",
                    "description": "Optional phase label or context string (e.g. 'Phase 01: Ingestion & Inspection')."
                },
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            }
        }
    },
    {
        "name": "tpa_compile_summary",
        "description": "Compiles the authoritative primary observations summary (docs/observations_summary.md) from the active tidyproteomics dataset, extracting quality metrics, target perturbation efficacy, top upregulated/downregulated candidates with statistical precision and imputation risk scoring, multi-category pathway enrichments, and cross-contrast concordances. Automatically writes the reproducible code/06_observations.R script and verifies checkpoints.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "target_gene": {
                    "type": "string",
                    "description": "Optional primary perturbation target gene symbol or accession (e.g. 'VCP'). If omitted, automatically checks docs/experiment.md or defaults to untargeted discovery scope."
                },
                "output_summary": {
                    "type": "string",
                    "description": "Optional output path for markdown summary. Defaults to 'docs/observations_summary.md'."
                },
                "output_script": {
                    "type": "string",
                    "description": "Optional output path for reproducible R script. Defaults to 'code/06_observations.R'."
                },
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            }
        }
    },
    {
        "name": "tpa_operations",
        "description": "Returns the complete non-destructive audit trail of all transformations applied to the dataset.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "id": {
                    "type": "string",
                    "description": "Optional dataset ID."
                }
            }
        }
    },
    {
        "name": "tpa_set_workspace",
        "description": "Sets the active working directory for the R Daemon and optionally resets active datasets.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "workspace": {
                    "type": "string",
                    "description": "Absolute or relative path to the project directory."
                },
                "reset": {
                    "type": "boolean",
                    "description": "Whether to reset all in-memory datasets and pipeline logs. Defaults to false. WARNING: Keep false to preserve loaded datasets between phases; only set to true if you explicitly intend to purge all session data."
                }
            },
            "required": ["workspace"]
        }
    },
    {
        "name": "tpa_reset",
        "description": "Resets the active R Daemon session, clearing all datasets and logged code.",
        "inputSchema": {
            "type": "object",
            "properties": {}
        }
    }
]

def handle_tool_call(name, args):
    if name.startswith("tidy_"):
        name = "tpa_" + name[5:]
    if name == "tpa_health":
        res = call_daemon("/health")
        return json.dumps(res, indent=2)

    elif name == "tpa_load":
        res = call_daemon("/load", args)
        if res.get("success"):
            return f"Dataset '{res.get('id')}' loaded successfully!\n\n```\n{res.get('summary')}\n```"
        return f"Error loading data: {res.get('error')}"

    elif name == "tpa_import_expression_table":
        res = call_daemon("/import_expression_table", args)
        if res.get("success"):
            return f"### Expression Table Imported\n- Comparison: {res.get('comparison')}\n- Total Proteins: {res.get('n_proteins')}\n- Significant (|log2FC| >= 1, q <= 0.05): {res.get('n_significant')}\n\n{res.get('summary')}"
        return f"Error importing expression table: {res.get('error')}"

    elif name == "tpa_inspect":
        res = call_daemon("/inspect", args)
        if res.get("success"):
            return f"### Inspection: {res.get('what')}\n\n```\n{res.get('result')}\n```"
        return f"Error in inspection: {res.get('error')}"

    elif name == "tpa_summary":
        res = call_daemon("/summary", args)
        if res.get("success"):
            return f"### Summary Output\n\n```\n{res.get('output')}\n```"
        return f"Error in summary: {res.get('error')}"

    elif name == "tpa_subset":
        res = call_daemon("/subset", args)
        if res.get("success"):
            return f"Subset applied successfully!\n\n```\n{res.get('summary')}\n```"
        return f"Error in subset: {res.get('error')}"

    elif name == "tpa_reassign":
        res = call_daemon("/reassign", args)
        if res.get("success"):
            return f"Successfully updated {res.get('target')}!\n\n```\n{res.get('experiments')}\n```"
        return f"Error in reassign: {res.get('error')}"

    elif name == "tpa_rm_mbr":
        res = call_daemon("/rm_mbr", args)
        if res.get("success"):
            return f"Match-Between-Runs removed!\n\n```\n{res.get('summary')}\n```"
        return f"Error in rm_mbr: {res.get('error')}"

    elif name == "tpa_audit_annotations":
        res = call_daemon("/audit_annotations", args)
        if res.get("success"):
            return res.get("summary", "Annotation audit completed.")
        return f"Error in audit_annotations: {res.get('error')}"

    elif name in ["tpa_annotate", "tpa_integrate_annotations"]:
        res = call_daemon("/annotate", args)
        if res.get("success"):
            terms = ", ".join(res.get("available_terms", []))
            return res.get("summary", f"Annotations added successfully! Available terms: {terms}")
        return f"Error in annotate: {res.get('error')}"

    elif name == "tpa_fetch_annotations":
        res = call_daemon("/fetch_annotations", args)
        taxon = args.get("taxon_id") or "auto"
        source = args.get("source") or "uniprot"
        status_file = f"data/annotations_{source}.tsv.status.json"

        if res.get("success"):
            try:
                os.makedirs("data", exist_ok=True)
                if not os.path.exists(status_file):
                    with open(status_file, "w") as f:
                        json.dump({
                            "written": True,
                            "source": source,
                            "taxon": str(taxon),
                            "timestamp": datetime.datetime.now().isoformat()
                        }, f, indent=2)
            except Exception:
                pass
            return res.get("summary", "UniProt annotations fetched successfully.")

        err_msg = res.get("error") or res.get("message") or "Unknown error from annotation daemon."
        stderr_snippet = get_daemon_stderr(40)

        try:
            os.makedirs("data", exist_ok=True)
            with open(status_file, "w") as f:
                json.dump({
                    "written": False,
                    "source": source,
                    "url": "https://rest.uniprot.org",
                    "taxon": str(taxon),
                    "error": str(err_msg),
                    "stderr": stderr_snippet,
                    "timestamp": datetime.datetime.now().isoformat()
                }, f, indent=2)
        except Exception:
            pass

        return (
            f"Error in fetch_annotations: [ANNOTATION_DAEMON_ERROR]\n"
            f"- Taxon ID: {taxon}\n"
            f"- Endpoint URL: https://rest.uniprot.org\n"
            f"- Status: FAILED\n"
            f"- Error: {err_msg}\n"
            f"- Daemon Stderr:\n```\n{stderr_snippet.strip()}\n```"
        )

    elif name == "tpa_list_annotations":
        res = call_daemon("/list_annotations", args)
        if res.get("success"):
            return res.get("summary", "List annotations completed.")
        return f"Error in list_annotations: {res.get('error')}"

    elif name == "tpa_normalize":
        res = call_daemon("/normalize", args)
        if res.get("success"):
            return f"Normalization evaluated and applied!\n\n```\n{res.get('summary')}\n```"
        return f"Error in normalization: {res.get('error')}"

    elif name == "tpa_select_normalization":
        res = call_daemon("/select_normalization", args)
        if res.get("success"):
            return f"Active normalization source set to: `{res.get('active_source')}`"
        return f"Error in select_normalization: {res.get('error')}"

    elif name == "tpa_impute":
        res = call_daemon("/impute", args)
        if res.get("success"):
            return f"Imputation applied!\n\n```\n{res.get('summary')}\n```"
        return f"Error in imputation: {res.get('error')}"

    elif name == "tpa_collapse":
        res = call_daemon("/collapse", args)
        if res.get("success"):
            return f"Peptides collapsed to proteins successfully!\n\n```\n{res.get('summary')}\n```"
        return f"Error in collapse: {res.get('error')}"

    elif name == "tpa_merge":
        res = call_daemon("/merge", args)
        if res.get("success"):
            return f"Datasets merged into '{res.get('new_id')}'!\n\n```\n{res.get('summary')}\n```"
        return f"Error in merge: {res.get('error')}"

    elif name == "tpa_expression":
        res = call_daemon("/expression", args)
        if res.get("success"):
            return f"Differential expression completed!\n\n```\n{res.get('analyses')}\n```"
        return f"Error in expression analysis: {res.get('error')}"

    elif name == "tpa_enrichment":
        if isinstance(args.get("terms"), list):
            args["terms"] = ",".join(args["terms"])
        res = call_daemon("/enrichment", args)
        if res.get("success"):
            return f"Enrichment analysis completed!\n\n```\n{res.get('analyses')}\n```"
        return f"Error in enrichment: {res.get('error')}"

    elif name == "tpa_batch_analysis":
        res = call_daemon("/batch_analysis", args)
        if res.get("success"):
            return f"{res.get('message')}"
        return f"Error in batch analysis: {res.get('error')}"

    elif name == "tpa_intersection":
        res = call_daemon("/intersection", args)
        if res.get("success"):
            return f"Intersection subset created!\n\n```\n{res.get('summary')}\n```"
        return f"Error in intersection: {res.get('error')}"

    elif name == "tpa_extract":
        res = call_daemon("/extract", args)
        if res.get("success"):
            saved = f"\nSaved to: `{res.get('saved_file')}`" if res.get('saved_file') else ""
            return f"Extracted {res.get('rows')} rows × {res.get('columns')} columns.{saved}\n\n```\n{res.get('preview')}\n```"
        return f"Error in extract: {res.get('error')}"

    elif name == "tpa_query_expression":
        res = call_daemon("/query_expression", args)
        if res.get("success"):
            saved = f"\nSaved full results to: `{res.get('saved_file')}`" if res.get('saved_file') else ""
            return (
                f"Expression Query for `{res.get('comparison')}`:\n"
                f"- Total candidates matching criteria: {res.get('total_candidates')}\n"
                f"- Displaying top: {res.get('returned_count')}{saved}\n\n"
                f"{res.get('markdown_table')}"
            )
        return f"Error in query_expression: {res.get('error')}"

    elif name == "tpa_query_enrichment":
        res = call_daemon("/query_enrichment", args)
        if res.get("success"):
            saved = f"\nSaved full results to: `{res.get('saved_file')}`" if res.get('saved_file') else ""
            return (
                f"Enrichment Query for `{res.get('comparison')}`:\n"
                f"- Total pathways/terms matching criteria: {res.get('total_terms')}\n"
                f"- Displaying top: {res.get('returned_count')}{saved}\n\n"
                f"{res.get('markdown_table')}"
            )
        return f"Error in query_enrichment: {res.get('error')}"

    elif name == "tpa_plot":
        res = call_daemon("/plot", args)
        if res.get("success"):
            return f"Plot `{res.get('plot_type')}` generated successfully.\nSaved file: `{res.get('file_created')}`"
        return f"Error generating plot: {res.get('error')}"

    elif name == "tpa_protein_map":
        res = call_daemon("/protein_map", args)
        if res.get("success"):
            return f"{res.get('message')}"
        return f"Error in protein_map: {res.get('error')}"

    elif name == "tpa_export_table":
        res = call_daemon("/export_table", args)
        if res.get("success"):
            return f"{res.get('message')}"
        return f"Error in export_table: {res.get('error')}"

    elif name == "tpa_export_sdrf":
        res = call_daemon("/export_sdrf", args)
        if res.get("success"):
            return f"{res.get('message')}"
        return f"Error exporting SDRF: {res.get('error')}"

    elif name == "tpa_export_config":
        res = call_daemon("/export_config", args)
        if res.get("success"):
            return f"{res.get('message')}\n\n```tsv\n{res.get('content')}\n```"
        return f"Error exporting config: {res.get('error')}"

    elif name == "tpa_input_audit":
        res = call_daemon("/input_audit", args)
        if res.get("success"):
            suggestions_md = ""
            if res.get("suggestions"):
                suggestions_md = "\n### Actionable Suggestions:\n" + "\n".join([f"- {s}" for s in res.get("suggestions")])
            return (
                f"### Input Header Audit: {args.get('platform')} ({args.get('analyte', 'proteins')})\n"
                f"- **Matched Columns:** {res.get('matched_columns')} / {res.get('total_columns')}\n"
                f"- **Identifier:** `{res.get('identifier_column')}`\n"
                f"- **Quantitative Channels:** {len(res.get('quantitative_columns', []))} sample columns matched\n"
                f"- **Annotations:** {', '.join(res.get('annotation_columns', [])) if res.get('annotation_columns') else 'None'}\n"
                f"{suggestions_md}\n\n"
                f"{res.get('audit_table')}"
            )
        return f"Error auditing input headers: {res.get('error')}"

    elif name == "tpa_ingest_config":
        res = call_daemon("/ingest_config", args)
        if res.get("success"):
            return (
                f"### Ingestion Configuration ({res.get('action')}): `{res.get('file')}`\n\n"
                f"{res.get('config_table')}"
            )
        return f"Error in ingest_config: {res.get('error')}"

    elif name == "tpa_normalization_sensitivity":
        res = call_daemon("/normalization_sensitivity", args)
        if res.get("success"):
            candidates = ", ".join(res.get("robust_candidates", []))
            return (
                f"### Normalization Sensitivity & Concordance Report\n\n"
                f"{res.get('concordance_table')}\n\n"
                f"- **High-Confidence Robust Candidates ({res.get('robust_protein_count')} proteins):** {candidates}\n"
                f"- **Summary:** {res.get('message')}"
            )
        return f"Error evaluating normalization sensitivity: {res.get('error')}"

    elif name == "tpa_run_code":
        res = call_daemon("/run_code", args)
        if res.get("success"):
            return f"R Code executed:\n\n```\n{res.get('output')}\n```"
        return f"Error executing R code: {res.get('error')}"

    elif name == "tpa_export_state":
        res = call_daemon("/export", args)
        if res.get("success"):
            data_doc_note = f"\n- **Data Overview:** `{res.get('data_doc')}`" if res.get("data_doc") else ""
            return (
                f"### State Successfully Exported\n"
                f"- **Data Object (RDS):** `{res.get('rds_saved')}`\n"
                f"- **Reproducible R Script:** `{res.get('script_saved')}`"
                f"{data_doc_note}\n"
                f"\nYou can now open `{res.get('script_saved')}` outside Docker to reproduce the exact pipeline."
            )
        return f"Error exporting state: {res.get('error')}"

    elif name == "tpa_update_data_doc":
        res = call_daemon("/update_data_doc", args)
        if res.get("success"):
            return (
                f"### Data Overview Document Successfully Updated\n"
                f"- **File:** `{res.get('file')}`\n\n"
                f"Generated/updated tables for **Ingestion Configuration**, **Input Header Audit**, "
                f"**Sample Accounting Summaries**, **Sample Variabilities**, and **Functional Annotations**."
            )
        return f"Error updating data overview document: {res.get('error')}"

    elif name == "tpa_compile_summary":
        res = call_daemon("/compile_summary", args)
        if res.get("success"):
            return (
                f"### Primary Observations Summary Successfully Compiled\n"
                f"- **Summary Output:** `{res.get('summary_file')}`\n"
                f"- **Reproducible R Script:** `{res.get('script_file')}`\n"
                f"- **Modeled Features:** {res.get('features_modeled')}\n"
                f"- **Contrasts Summarized:** {res.get('contrasts_summarized')}\n\n"
                f"```markdown\n{res.get('preview')}\n...\n```"
            )
        return f"Error compiling observations summary: {res.get('error')}"

    elif name == "tpa_operations":
        res = call_daemon("/operations", args)
        if res.get("success"):
            ops = res.get("operations", [])
            if isinstance(ops, str):
                ops = [ops]
            lines = "\n".join([f"{i+1}. {op}" for i, op in enumerate(ops)])
            return f"### Audit Trail (operations)\n\n{lines}"
        return f"Error getting operations: {res.get('error')}"

    elif name == "tpa_set_workspace":
        res = call_daemon("/set_workspace", args)
        if res.get("success"):
            return f"Active workspace set to: `{res.get('workspace')}`"
        return f"Error setting workspace: {res.get('error')}"

    elif name == "tpa_reset":
        res = call_daemon("/reset", args)
        if res.get("success"):
            return res.get("message", "Session reset successfully.")
        return f"Error resetting session: {res.get('error')}"

    return f"Unknown tool: {name}"

def main():
    sys.stderr.write("[MCP Server] Starting tidyproteomics MCP Server (stdio)...\n")
    try:
        ensure_daemon()

        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                req = json.loads(line)
            except Exception:
                continue

            req_id = req.get("id")
            method = req.get("method")
            params = req.get("params", {})

            if method == "initialize":
                ws = params.get("workspaceRoot") or params.get("rootPath") or os.getcwd()
                try:
                    call_daemon("/set_workspace", {"workspace": ws, "reset": True})
                except Exception as e:
                    sys.stderr.write(f"[MCP Server] Notice: Could not sync workspace on init: {e}\n")

                resp = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {
                            "tools": {}
                        },
                        "serverInfo": {
                            "name": "tidyproteomics-mcp",
                            "version": "1.0.0"
                        }
                    }
                }
                sys.stdout.write(json.dumps(resp) + "\n")
                sys.stdout.flush()

            elif method == "notifications/initialized":
                pass

            elif method == "tools/list":
                resp = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "tools": TOOLS
                    }
                }
                sys.stdout.write(json.dumps(resp) + "\n")
                sys.stdout.flush()

            elif method == "tools/call":
                tool_name = params.get("name")
                tool_args = params.get("arguments", {})
                try:
                    result_text = handle_tool_call(tool_name, tool_args)
                    is_err = isinstance(result_text, str) and (
                        result_text.startswith("Error") or
                        result_text.startswith("Tool error:") or
                        result_text.startswith("Execution halted") or
                        "Error in " in result_text[:100]
                    )
                    resp = {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {
                            "content": [
                                {
                                    "type": "text",
                                    "text": result_text
                                }
                            ],
                            "isError": is_err
                        }
                    }
                except Exception as e:
                    resp = {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {
                            "content": [
                                {
                                    "type": "text",
                                    "text": f"Tool error: {str(e)}"
                                }
                            ],
                            "isError": True
                        }
                    }
                sys.stdout.write(json.dumps(resp) + "\n")
                sys.stdout.flush()

            elif method == "ping":
                resp = {"jsonrpc": "2.0", "id": req_id, "result": {}}
                sys.stdout.write(json.dumps(resp) + "\n")
                sys.stdout.flush()

            else:
                if req_id is not None:
                    resp = {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "error": {
                            "code": -32601,
                            "message": f"Method '{method}' not found"
                        }
                    }
                    sys.stdout.write(json.dumps(resp) + "\n")
                    sys.stdout.flush()
    finally:
        cleanup_daemon()

if __name__ == "__main__":
    main()
