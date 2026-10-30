import { configStore } from "../config/ConfigStore";
import { IToolHandler } from "./ToolRegistry";

async function fetchJsonWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 12000): Promise<any> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "tidyproteomics-agent/1.0 (https://github.com/jeffsocal/tidyproteomics)",
        Accept: "application/json",
        ...(options.headers || {}),
      },
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(id);
  }
}

export function createWebSearchToolHandlers(): IToolHandler[] {
  const webSearchTool: IToolHandler = {
    definition: {
      name: "web_search",
      description:
        "Performs a web and scientific literature search for a given query. Automatically queries configured search provider (Tavily/Brave/SearXNG) or falls back to zero-key EuropePMC + DuckDuckGo/Wikipedia search.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query or keyphrase (e.g. 'Bacillus subtilis surfactin proteome cell wall hydrolase lytE')",
          },
          maxResults: {
            type: "number",
            description: "Maximum number of results to return (default: 6)",
          },
        },
        required: ["query"],
      },
    },
    execute: async (args) => {
      const query = String(args.query || "").trim();
      const maxResults = Math.min(15, Math.max(1, Number(args.maxResults || 6)));
      if (!query) return "Error: query is required.";

      const provider = configStore.get("searchProvider") || "auto";
      const apiKey = (configStore.get("searchApiKey") || "").trim();
      const searxngUrl = (configStore.get("searxngUrl") || "").trim();

      const sections: string[] = [];

      // 1. Optional Tavily API
      if ((provider === "tavily" || (provider === "auto" && apiKey.startsWith("tvly-"))) && apiKey) {
        try {
          const data = await fetchJsonWithTimeout("https://api.tavily.com/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              api_key: apiKey,
              query,
              max_results: maxResults,
              include_answer: true,
            }),
          });
          if (data.answer) {
            sections.push(`### Synthesis Answer\n${data.answer}`);
          }
          if (Array.isArray(data.results) && data.results.length > 0) {
            const items = data.results.map(
              (r: any, idx: number) =>
                `${idx + 1}. **${r.title || "Result"}**\n   - URL: ${r.url}\n   - Snippet: ${r.content || ""}`
            );
            sections.push(`### Web Results (Tavily)\n${items.join("\n\n")}`);
          }
        } catch (err: any) {
          sections.push(`*(Tavily search warning: ${err.message}; falling back to built-in scientific search)*`);
        }
      }

      // 2. Optional Brave Search API
      if (provider === "brave" && apiKey) {
        try {
          const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
          const data = await fetchJsonWithTimeout(url, {
            headers: { "X-Subscription-Token": apiKey },
          });
          const webResults = data?.web?.results || [];
          if (webResults.length > 0) {
            const items = webResults.map(
              (r: any, idx: number) =>
                `${idx + 1}. **${r.title}**\n   - URL: ${r.url}\n   - Snippet: ${r.description || ""}`
            );
            sections.push(`### Web Results (Brave)\n${items.join("\n\n")}`);
          }
        } catch (err: any) {
          sections.push(`*(Brave search warning: ${err.message}; falling back to built-in scientific search)*`);
        }
      }

      // 3. Optional SearXNG instance
      if ((provider === "searxng" || (provider === "auto" && searxngUrl)) && searxngUrl) {
        try {
          const base = searxngUrl.replace(/\/+$/, "");
          const url = `${base}/search?q=${encodeURIComponent(query)}&format=json`;
          const data = await fetchJsonWithTimeout(url);
          if (Array.isArray(data.results) && data.results.length > 0) {
            const items = data.results.slice(0, maxResults).map(
              (r: any, idx: number) =>
                `${idx + 1}. **${r.title}**\n   - URL: ${r.url}\n   - Snippet: ${r.content || ""}`
            );
            sections.push(`### Web Results (SearXNG)\n${items.join("\n\n")}`);
          }
        } catch (err: any) {
          sections.push(`*(SearXNG warning: ${err.message})*`);
        }
      }

      // 4. Built-in Zero-Key Europe PMC Scientific Literature Search (always included for scientific grounding)
      try {
        const epmcUrl = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(
          query
        )}&resultType=core&pageSize=${maxResults}&format=json`;
        const epmcData = await fetchJsonWithTimeout(epmcUrl);
        const results = epmcData?.resultList?.result || [];
        if (results.length > 0) {
          const formatted = results.map((paper: any, idx: number) => {
            const title = paper.title || "Untitled";
            const authors = paper.authorString || "Unknown authors";
            const journal = paper.journalTitle || paper.bookOrReportDetails?.publisher || "Preprint/Journal";
            const year = paper.pubYear || "N/A";
            const pmid = paper.pmid ? `PMID: ${paper.pmid}` : "";
            const doi = paper.doi ? `DOI: https://doi.org/${paper.doi}` : "";
            const abstractText = paper.abstractText
              ? String(paper.abstractText).replace(/<[^>]+>/g, "").slice(0, 650) +
                (String(paper.abstractText).length > 650 ? "..." : "")
              : "(No abstract available)";
            return `${idx + 1}. **${title}** (${year})\n   - *${authors}* — ${journal} ${[pmid, doi].filter(Boolean).join(" | ")}\n   - **Abstract**: ${abstractText}`;
          });
          sections.push(`### Scientific Literature Results (Europe PMC / PubMed)\n${formatted.join("\n\n")}`);
        }
      } catch (err: any) {
        sections.push(`*(Europe PMC query warning: ${err.message})*`);
      }

      // 5. Built-in Zero-Key Wikipedia / Knowledge Summary
      try {
        const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
          query
        )}&utf8=&format=json&srlimit=3`;
        const wikiData = await fetchJsonWithTimeout(wikiUrl);
        const searchHits = wikiData?.query?.search || [];
        if (searchHits.length > 0) {
          const items = searchHits.map((h: any) => {
            const cleanSnippet = String(h.snippet || "").replace(/<[^>]+>/g, "");
            return `- **${h.title}**: ${cleanSnippet}`;
          });
          sections.push(`### Encyclopedia & General Context\n${items.join("\n")}`);
        }
      } catch (_) {}

      if (sections.length === 0) {
        return `No external results found for query: "${query}". Try simplifying the search terms to 2-4 core gene symbols or biological keywords.`;
      }

      return sections.join("\n\n---\n\n");
    },
  };

  const pubmedSearchTool: IToolHandler = {
    definition: {
      name: "pubmed_search",
      description:
        "Searches PubMed / Europe PMC for peer-reviewed biomedical and proteomics papers, returning titles, authors, publication years, PMIDs, DOIs, and full abstracts.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "PubMed/EuropePMC search query (supports boolean AND/OR, gene symbols, organism names)",
          },
          maxResults: {
            type: "number",
            description: "Maximum number of papers to retrieve (default: 5, max: 8)",
          },
        },
        required: ["query"],
      },
    },
    execute: async (args) => {
      const query = String(args.query || "").trim();
      const maxResults = Math.min(8, Math.max(1, Number(args.maxResults || 5)));
      if (!query) return "Error: query is required.";

      try {
        const epmcUrl = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(
          query
        )}&resultType=core&pageSize=${maxResults}&format=json`;
        const epmcData = await fetchJsonWithTimeout(epmcUrl);
        const results = epmcData?.resultList?.result || [];
        if (results.length === 0) {
          return `No PubMed/EuropePMC articles found for query: "${query}".`;
        }

        const formatted = results.map((paper: any, idx: number) => {
          const title = paper.title || "Untitled";
          const authors = paper.authorString || "Unknown authors";
          const journal = paper.journalTitle || "Journal";
          const year = paper.pubYear || "N/A";
          const pmid = paper.pmid ? `PMID:${paper.pmid}` : "";
          const pmcid = paper.pmcid ? `PMCID:${paper.pmcid}` : "";
          const doi = paper.doi ? `DOI:${paper.doi}` : "";
          const citations = paper.citedByCount !== undefined ? `Cited by: ${paper.citedByCount}` : "";
          const rawAbstract = paper.abstractText
            ? String(paper.abstractText).replace(/<[^>]+>/g, "").trim()
            : "(No abstract available)";
          const abstractText =
            rawAbstract.length > 450
              ? rawAbstract.slice(0, 450).trim() + " ... [abstract condensed for context economy]"
              : rawAbstract;
          return `#### [${idx + 1}] ${title} (${year})\n- **Authors**: ${authors}\n- **Journal**: ${journal} (${[
            pmid,
            pmcid,
            doi,
            citations,
          ]
            .filter(Boolean)
            .join(" | ")})\n- **Abstract**: ${abstractText}`;
        });

        return `### PubMed / Europe PMC Results for "${query}" (${results.length} articles)\n\n${formatted.join(
          "\n\n"
        )}`;
      } catch (err: any) {
        return `Error querying PubMed/EuropePMC: ${err.message}`;
      }
    },
  };

  const uniprotSearchTool: IToolHandler = {
    definition: {
      name: "uniprot_search",
      description:
        "Queries the UniProtKB database for protein functional annotations, catalytic activity, subcellular localization, subunit interactions, and pathway membership.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Gene symbol, UniProt accession, or protein + organism query (e.g. 'gene:lytE AND Bacillus subtilis')",
          },
          maxResults: {
            type: "number",
            description: "Maximum number of UniProt entries to return (default: 5)",
          },
        },
        required: ["query"],
      },
    },
    execute: async (args) => {
      const query = String(args.query || "").trim();
      const maxResults = Math.min(10, Math.max(1, Number(args.maxResults || 5)));
      if (!query) return "Error: query is required.";

      try {
        const url = `https://rest.uniprot.org/uniprotkb/search?query=${encodeURIComponent(
          query
        )}&size=${maxResults}&format=json`;
        const data = await fetchJsonWithTimeout(url);
        const results = data?.results || [];
        if (results.length === 0) {
          return `No UniProtKB entries found for query: "${query}".`;
        }

        const formatted = results.map((entry: any, idx: number) => {
          const acc = entry.primaryAccession || "N/A";
          const id = entry.uniProtkbId || "";
          const protName =
            entry.proteinDescription?.recommendedName?.fullName?.value ||
            entry.proteinDescription?.submissionNames?.[0]?.fullName?.value ||
            "Unnamed protein";
          const genes = (entry.genes || [])
            .map((g: any) => g.geneName?.value || (g.orderedLocusNames?.[0]?.value ?? ""))
            .filter(Boolean)
            .join(", ");
          const organism = entry.organism?.scientificName || "Unknown organism";

          const comments = entry.comments || [];
          const funcTexts = comments
            .filter((c: any) => c.commentType === "FUNCTION")
            .flatMap((c: any) => (c.texts || []).map((t: any) => t.value));
          const subcellTexts = comments
            .filter((c: any) => c.commentType === "SUBCELLULAR LOCATION")
            .flatMap((c: any) =>
              (c.subcellularLocations || []).map((s: any) => s.location?.value).filter(Boolean)
            );
          const subunitTexts = comments
            .filter((c: any) => c.commentType === "SUBUNIT")
            .flatMap((c: any) => (c.texts || []).map((t: any) => t.value));
          const pathwayTexts = comments
            .filter((c: any) => c.commentType === "PATHWAY")
            .flatMap((c: any) => (c.texts || []).map((t: any) => t.value));

          const lines = [
            `#### [${idx + 1}] ${acc} (${id}) — ${protName}`,
            `- **Gene(s)**: ${genes || "N/A"} | **Organism**: *${organism}*`,
          ];
          if (funcTexts.length > 0) lines.push(`- **Function**: ${funcTexts.join(" ")}`);
          if (pathwayTexts.length > 0) lines.push(`- **Pathway**: ${pathwayTexts.join(" ")}`);
          if (subunitTexts.length > 0) lines.push(`- **Subunit / Interactors**: ${subunitTexts.join(" ")}`);
          if (subcellTexts.length > 0) lines.push(`- **Subcellular Location**: ${subcellTexts.join(", ")}`);

          return lines.join("\n");
        });

        return `### UniProtKB Functional Annotations for "${query}"\n\n${formatted.join("\n\n")}`;
      } catch (err: any) {
        return `Error querying UniProtKB: ${err.message}`;
      }
    },
  };

  return [webSearchTool, pubmedSearchTool, uniprotSearchTool];
}

