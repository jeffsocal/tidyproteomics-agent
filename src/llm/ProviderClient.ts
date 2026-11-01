import { ChatMessage, LLMConfig, LLMProviderType, LLMRole, LLMResponse, LLMTierConfig, TokenUsage, ToolCall, ToolDefinition } from "../types";

export class ProviderClient {
  private roleClients = new Map<LLMRole, ProviderClient>();
  private modelClients = new Map<string, ProviderClient>();

  constructor(
    private config: LLMConfig,
    private isTierInstance = false
  ) {}

  public updateConfig(config: Partial<LLMConfig>) {
    this.config = { ...this.config, ...config };
    this.roleClients.clear();
    this.modelClients.clear();
  }

  public forRole(role: LLMRole): ProviderClient {
    if (this.isTierInstance) return this;
    if (this.config.multiModelEnabled === false) return this;
    if (this.roleClients.has(role)) return this.roleClients.get(role)!;

    const tierCfg: LLMTierConfig | undefined =
      role === "utility"
        ? this.config.tierUtility
        : role === "reasoner"
        ? this.config.tierReasoner
        : this.config.tierToolRunner;

    if (!tierCfg || !tierCfg.model) {
      return this;
    }

    const effectiveApiKey = (tierCfg.apiKey && tierCfg.apiKey.trim()) || this.config.apiKey || "";

    // Determine the effective provider for this tier
    let effectiveProvider: LLMProviderType;

    if (effectiveApiKey.startsWith("sk-or-v1")) {
      // 1. Any request using an OpenRouter key (sk-or-v1-*) MUST route to OpenRouter.
      // Calling api.anthropic.com or api.openai.com with an OpenRouter key will always fail.
      effectiveProvider = "openrouter";
    } else if (tierCfg.provider && tierCfg.apiKey && tierCfg.apiKey.trim()) {
      // 2. Explicit tier-level override with dedicated non-default key
      effectiveProvider = tierCfg.provider;
    } else if (this.config.provider === "openrouter" || (tierCfg.model && tierCfg.model.includes("/"))) {
      // 3. Either primary provider is OpenRouter, or model slug is in "vendor/model" format (OpenRouter syntax)
      effectiveProvider = "openrouter";
    } else if (!tierCfg.apiKey && this.config.provider) {
      // 4. Inherit primary provider when no tier key is supplied
      effectiveProvider = this.config.provider;
    } else {
      effectiveProvider = tierCfg.provider || this.config.provider;
    }

    const resolvedConfig: LLMConfig = {
      ...this.config,
      provider: effectiveProvider,
      model: tierCfg.model,
      apiKey: effectiveApiKey,
      baseUrl: tierCfg.baseUrl !== undefined && tierCfg.baseUrl !== "" ? tierCfg.baseUrl : this.config.baseUrl,
      maxTokens: tierCfg.maxTokens || this.config.maxTokens,
      temperature: tierCfg.temperature !== undefined ? tierCfg.temperature : this.config.temperature,
    };

    const clientInstance = new ProviderClient(resolvedConfig, true);
    this.roleClients.set(role, clientInstance);
    return clientInstance;
  }

  public forModel(model: string, provider?: LLMProviderType): ProviderClient {
    if (this.isTierInstance) return this;
    const cleanModel = model.trim();
    if (!cleanModel || cleanModel === this.config.model) return this;
    if (this.modelClients.has(cleanModel)) return this.modelClients.get(cleanModel)!;

    let effectiveProvider: LLMProviderType = provider || this.config.provider;
    if (cleanModel.includes("/") && (this.config.apiKey.startsWith("sk-or-v1") || this.config.provider === "openrouter")) {
      effectiveProvider = "openrouter";
    }

    const resolvedConfig: LLMConfig = {
      ...this.config,
      provider: effectiveProvider,
      model: cleanModel,
    };
    const clientInstance = new ProviderClient(resolvedConfig, true);
    this.modelClients.set(cleanModel, clientInstance);
    return clientInstance;
  }

  public forPhase(
    phaseId: string,
    fileName?: string,
    defaultRole?: LLMRole
  ): { client: ProviderClient; source: "phase" | "tier" | "default" } {
    if (this.config.multiModelEnabled === false) {
      return { client: this, source: "default" };
    }

    // 1. Check phase-specific override in phaseModels
    const phaseModels = this.config.phaseModels || {};
    const cleanId = phaseId.toLowerCase().trim();
    const cleanFile = (fileName || "").toLowerCase().trim();
    const baseFile = (fileName || "").replace(/\.md$/i, "").toLowerCase().trim();

    const customModel =
      phaseModels[phaseId] ||
      phaseModels[cleanId] ||
      (fileName ? phaseModels[fileName] || phaseModels[cleanFile] || phaseModels[baseFile] : undefined);

    if (customModel && typeof customModel === "string" && customModel.trim() && customModel.trim().toLowerCase() !== "default") {
      const client = this.forModel(customModel.trim());
      return { client, source: "phase" };
    }

    // 2. Check role tier
    if (defaultRole) {
      const tierClient = this.forRole(defaultRole);
      if (tierClient !== this) {
        return { client: tierClient, source: "tier" };
      }
    }

    return { client: this, source: "default" };
  }

  public getConfig(): LLMConfig {
    return { ...this.config };
  }

  public getTimeoutSeconds(): number {
    return this.config.timeoutSeconds && this.config.timeoutSeconds > 0
      ? this.config.timeoutSeconds
      : 600;
  }

  public getTimeoutMs(): number {
    return this.getTimeoutSeconds() * 1000;
  }

  public async chat(params: {
    system: string;
    messages: ChatMessage[];
    tools: ToolDefinition[];
    onToken?: (text: string) => void;
  }): Promise<LLMResponse> {
    switch (this.config.provider) {
      case "anthropic":
        return this.chatAnthropic(params);
      case "gemini":
        return this.chatGemini(params);
      case "openrouter":
        return this.chatOpenRouter(params);
      case "ollama":
        return this.chatOllama(params);
      case "openai":
      default:
        return this.chatOpenAI(params);
    }
  }

  /**
   * Anthropic Messages API with native Prompt Caching enabled on the static system prompt!
   */
  private async chatAnthropic(params: {
    system: string;
    messages: ChatMessage[];
    tools: ToolDefinition[];
    onToken?: (text: string) => void;
  }): Promise<LLMResponse> {
    const url = "https://api.anthropic.com/v1/messages";

    // Format tools for Anthropic
    const anthropicTools = (params.tools || []).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));

    // Convert messages to Anthropic format
    const rawAnthropic: any[] = [];
    let i = 0;
    while (i < params.messages.length) {
      const msg = params.messages[i];
      if (msg.role === "system") {
        i++;
        continue; // system prompt passed in top-level system parameter
      }
      if (msg.role === "tool") {
        const toolResults: any[] = [];
        while (i < params.messages.length && params.messages[i].role === "tool") {
          const tm = params.messages[i];
          toolResults.push({
            type: "tool_result",
            tool_use_id: tm.tool_call_id,
            content: tm.content,
          });
          i++;
        }
        rawAnthropic.push({
          role: "user",
          content: toolResults,
        });
        continue;
      } else if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
        const contentBlocks: any[] = [];
        if (msg.content) {
          contentBlocks.push({ type: "text", text: msg.content });
        }
        for (const tc of msg.tool_calls) {
          contentBlocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.args,
          });
        }
        rawAnthropic.push({ role: "assistant", content: contentBlocks });
      } else {
        rawAnthropic.push({
          role: msg.role === "assistant" ? "assistant" : "user",
          content: msg.content,
        });
      }
      i++;
    }

    // Anthropic strictly requires alternating roles: merge any consecutive messages with the same role
    const anthropicMessages: any[] = [];
    for (const m of rawAnthropic) {
      const last = anthropicMessages[anthropicMessages.length - 1];
      if (last && last.role === m.role) {
        const lastBlocks = Array.isArray(last.content) ? last.content : [{ type: "text", text: String(last.content) }];
        const currBlocks = Array.isArray(m.content) ? m.content : [{ type: "text", text: String(m.content) }];
        last.content = [...lastBlocks, ...currBlocks];
      } else {
        anthropicMessages.push(m);
      }
    }

    // Anthropic requires the first message to have role "user"
    while (anthropicMessages.length > 0 && anthropicMessages[0].role === "assistant") {
      anthropicMessages.shift();
    }
    if (anthropicMessages.length === 0) {
      anthropicMessages.push({ role: "user", content: "Hello" });
    }

    // System prompt with cache_control enabled on the massive static block
    const systemPayload = [
      {
        type: "text",
        text: params.system,
        cache_control: { type: "ephemeral" },
      },
    ];

    const maxTokens = this.config.maxTokens || 16384;
    const body = {
      model: this.config.model || "claude-3-7-sonnet-20250219",
      max_tokens: maxTokens,
      temperature: this.config.temperature ?? 0.2,
      system: systemPayload,
      messages: anthropicMessages,
      tools: anthropicTools,
    };

    const timeoutSeconds = this.getTimeoutSeconds();
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.config.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "prompt-caching-2024-07-31",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.getTimeoutMs()),
      });
    } catch (err: any) {
      this.handleFetchError(err, "Anthropic", url, timeoutSeconds);
    }

    if (!res.ok) {
      await this.handleHttpError(res, "Anthropic", url);
    }

    const data: any = await res.json();
    let textContent = "";
    const toolCalls: ToolCall[] = [];

    for (const block of data.content || []) {
      if (block.type === "text") {
        textContent += block.text;
        if (params.onToken) params.onToken(block.text);
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          args: block.input || {},
        });
      }
    }

    const stopReason = data.stop_reason;
    const isTruncated = stopReason === "max_tokens";
    if (isTruncated) {
      console.warn(`[ProviderClient] Anthropic generation cut off: hit max_tokens limit (${maxTokens}).`);
    }

    const cacheRead = data.usage?.cache_read_input_tokens || 0;
    const cacheCreation = data.usage?.cache_creation_input_tokens || 0;
    const rawInput = data.usage?.input_tokens || 0;
    const completionTokens = data.usage?.output_tokens || 0;
    const promptTokens = rawInput + cacheRead + cacheCreation;
    const totalTokens = promptTokens + completionTokens;

    const usage: TokenUsage = {
      promptTokens,
      completionTokens,
      totalTokens,
      cachedPromptTokens: cacheRead,
    };

    return {
      content: textContent,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
      finishReason: stopReason,
      truncationDetected: isTruncated,
    };
  }

  /**
   * Google Gemini API implementation
   */
  private async chatGemini(params: {
    system: string;
    messages: ChatMessage[];
    tools: ToolDefinition[];
    onToken?: (text: string) => void;
  }): Promise<LLMResponse> {
    const model = this.config.model || "gemini-1.5-pro";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.config.apiKey}`;

    // Convert tools to Gemini function declarations
    const geminiTools = [
      {
        functionDeclarations: (params.tools || []).map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      },
    ];

    // Format Gemini contents
    const rawContents: any[] = [];
    let j = 0;
    while (j < params.messages.length) {
      const msg = params.messages[j];
      if (msg.role === "system") {
        j++;
        continue;
      }
      if (msg.role === "tool") {
        const functionParts: any[] = [];
        while (j < params.messages.length && params.messages[j].role === "tool") {
          const tm = params.messages[j];
          functionParts.push({
            functionResponse: {
              name: tm.tool_name || tm.tool_call_id || "tool_result",
              response: { output: tm.content },
            },
          });
          j++;
        }
        rawContents.push({ role: "user", parts: functionParts });
        continue;
      } else if (msg.role === "assistant" && msg.tool_calls) {
        const parts: any[] = [];
        if (msg.content) parts.push({ text: msg.content });
        for (const tc of msg.tool_calls) {
          parts.push({
            functionCall: {
              name: tc.name,
              args: tc.args,
            },
          });
        }
        rawContents.push({ role: "model", parts });
      } else {
        rawContents.push({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }],
        });
      }
      j++;
    }

    // Gemini requires alternating roles: consolidate consecutive turns with identical roles
    const contents: any[] = [];
    for (const c of rawContents) {
      const last = contents[contents.length - 1];
      if (last && last.role === c.role) {
        last.parts.push(...c.parts);
      } else {
        contents.push(c);
      }
    }

    // Gemini requires the first content to have role "user"
    while (contents.length > 0 && contents[0].role === "model") {
      contents.shift();
    }
    if (contents.length === 0) {
      contents.push({ role: "user", parts: [{ text: "Hello" }] });
    }

    const maxTokens = this.config.maxTokens || 16384;
    const body = {
      systemInstruction: {
        parts: [{ text: params.system }],
      },
      contents,
      tools: geminiTools,
      generationConfig: {
        temperature: this.config.temperature ?? 0.2,
        maxOutputTokens: maxTokens,
      },
    };

    const timeoutSeconds = this.getTimeoutSeconds();
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.getTimeoutMs()),
      });
    } catch (err: any) {
      this.handleFetchError(err, "Gemini", url, timeoutSeconds);
    }

    if (!res.ok) {
      await this.handleHttpError(res, "Gemini", url);
    }

    const data: any = await res.json();
    const candidate = data.candidates?.[0];
    const finishReason = candidate?.finishReason;
    const isTruncated = finishReason === "MAX_TOKENS";
    if (isTruncated) {
      console.warn(`[ProviderClient] Gemini generation cut off: hit MAX_TOKENS limit (${maxTokens}).`);
    }

    let textContent = "";
    const toolCalls: ToolCall[] = [];

    for (const part of candidate?.content?.parts || []) {
      if (part.text) {
        textContent += part.text;
        if (params.onToken) params.onToken(part.text);
      }
      if (part.functionCall) {
        toolCalls.push({
          id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          name: part.functionCall.name,
          args: part.functionCall.args || {},
        });
      }
    }

    const promptTokens = data.usageMetadata?.promptTokenCount || 0;
    const completionTokens = data.usageMetadata?.candidatesTokenCount || 0;
    const cachedPromptTokens = data.usageMetadata?.cachedContentTokenCount || 0;
    const totalTokens = data.usageMetadata?.totalTokenCount ?? (promptTokens + completionTokens);

    const usage: TokenUsage = {
      promptTokens,
      completionTokens,
      totalTokens,
      cachedPromptTokens,
    };

    return {
      content: textContent,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
      finishReason,
      truncationDetected: isTruncated,
    };
  }

  /**
   * OpenAI / Compatible API implementation
   */
  private async chatOpenAI(params: {
    system: string;
    messages: ChatMessage[];
    tools: ToolDefinition[];
    onToken?: (text: string) => void;
  }): Promise<LLMResponse> {
    const baseUrl = this.config.baseUrl || "https://api.openai.com/v1";
    const url = `${baseUrl}/chat/completions`;

    const openAiTools = (params.tools || []).map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const formattedMessages: any[] = [{ role: "system", content: params.system }];
    for (const msg of params.messages) {
      if (msg.role === "tool") {
        formattedMessages.push({
          role: "tool",
          tool_call_id: msg.tool_call_id,
          content: msg.content,
        });
      } else if (msg.role === "assistant" && msg.tool_calls) {
        formattedMessages.push({
          role: "assistant",
          content: msg.content || null,
          tool_calls: msg.tool_calls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args),
            },
          })),
        });
      } else {
        formattedMessages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    const maxTokens = this.config.maxTokens || 16384;
    const body: Record<string, any> = {
      model: this.config.model || "gpt-4o",
      messages: formattedMessages,
      tools: openAiTools.length > 0 ? openAiTools : undefined,
      temperature: this.config.temperature ?? 0.2,
      max_tokens: maxTokens,
    };

    const timeoutSeconds = this.getTimeoutSeconds();
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.getTimeoutMs()),
      });
    } catch (err: any) {
      this.handleFetchError(err, "OpenAI", url, timeoutSeconds);
    }

    if (!res.ok) {
      await this.handleHttpError(res, "OpenAI", url);
    }

    const data: any = await res.json();
    const message = data.choices?.[0]?.message;
    const finishReason = data.choices?.[0]?.finish_reason;
    const isTruncated = finishReason === "length" || finishReason === "max_tokens";

    let textContent = message?.content || "";
    // If standard content is empty, check reasoning fields (used by Grok, DeepSeek-R1, and thinking models)
    if (!textContent && (message?.reasoning_content || message?.reasoning)) {
      textContent = message.reasoning_content || message.reasoning;
    }
    if (textContent && params.onToken) {
      params.onToken(textContent);
    }

    const toolCalls: ToolCall[] = [];
    for (const tc of message?.tool_calls || []) {
      try {
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          args: typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function.arguments || {},
        });
      } catch (err: any) {
        console.error(`[ProviderClient] Failed to parse tool call arguments for ${tc.function?.name}:`, err);
        if (isTruncated) {
          console.error(`[ProviderClient] Output truncated at max_tokens (${maxTokens}) with finish_reason="${finishReason}". Tool call JSON was incomplete.`);
        }
      }
    }

    const promptTokens = data.usage?.prompt_tokens || 0;
    const completionTokens = data.usage?.completion_tokens || 0;
    const cachedPromptTokens = data.usage?.prompt_tokens_details?.cached_tokens || 0;
    const totalTokens = data.usage?.total_tokens ?? (promptTokens + completionTokens);

    const usage: TokenUsage = {
      promptTokens,
      completionTokens,
      totalTokens,
      cachedPromptTokens,
    };

    return {
      content: textContent,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
      finishReason,
      truncationDetected: isTruncated,
    };
  }

  /**
   * OpenRouter API implementation (Unified gateway for Claude, DeepSeek, Llama, Qwen, etc.)
   */
  private async chatOpenRouter(params: {
    system: string;
    messages: ChatMessage[];
    tools: ToolDefinition[];
    onToken?: (text: string) => void;
  }): Promise<LLMResponse> {
    const baseUrl = (this.config.baseUrl || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
    const url = `${baseUrl}/chat/completions`;

    const openAiTools = (params.tools || []).map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const formattedMessages: any[] = [{ role: "system", content: params.system }];
    for (const msg of params.messages) {
      if (msg.role === "tool") {
        formattedMessages.push({
          role: "tool",
          tool_call_id: msg.tool_call_id,
          content: msg.content,
        });
      } else if (msg.role === "assistant" && msg.tool_calls) {
        formattedMessages.push({
          role: "assistant",
          content: msg.content || null,
          tool_calls: msg.tool_calls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args),
            },
          })),
        });
      } else {
        formattedMessages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    const maxTokens = this.config.maxTokens || 32768;
    let model = this.config.model || "anthropic/claude-3.7-sonnet";
    if (model === "anthropic/claude-3.5-sonnet") {
      model = "anthropic/claude-3.5-sonnet-20241022";
    }
    const body: Record<string, any> = {
      model,
      messages: formattedMessages,
      tools: openAiTools.length > 0 ? openAiTools : undefined,
      temperature: this.config.temperature ?? 0.2,
      max_tokens: maxTokens,
    };

    const timeoutSeconds = this.getTimeoutSeconds();
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
          "HTTP-Referer": "https://github.com/tidyproteomicsagent",
          "X-Title": "TidyProteomicsAgent",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.getTimeoutMs()),
      });
    } catch (err: any) {
      this.handleFetchError(err, "OpenRouter", url, timeoutSeconds);
    }

    if (!res.ok) {
      await this.handleHttpError(res, "OpenRouter", url);
    }

    const data: any = await res.json();
    const message = data.choices?.[0]?.message;
    const finishReason = data.choices?.[0]?.finish_reason;
    const isTruncated = finishReason === "length" || finishReason === "max_tokens";

    let textContent = message?.content || "";
    // If standard content is empty, check reasoning fields (used by Grok, DeepSeek-R1, and thinking models)
    if (!textContent && (message?.reasoning_content || message?.reasoning)) {
      textContent = message.reasoning_content || message.reasoning;
    }
    if (textContent && params.onToken) {
      params.onToken(textContent);
    }

    const toolCalls: ToolCall[] = [];
    for (const tc of message?.tool_calls || []) {
      try {
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          args: typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function.arguments || {},
        });
      } catch (err: any) {
        console.error(`[ProviderClient] Failed to parse tool call arguments for ${tc.function?.name}:`, err);
        if (isTruncated) {
          console.error(`[ProviderClient] Output truncated at max_tokens (${maxTokens}) with finish_reason="${finishReason}". Tool call JSON was incomplete.`);
        }
      }
    }

    const promptTokens = data.usage?.prompt_tokens || 0;
    const completionTokens = data.usage?.completion_tokens || 0;
    const cachedPromptTokens =
      data.usage?.prompt_tokens_details?.cached_tokens ??
      data.usage?.cache_read_input_tokens ??
      0;
    const totalTokens = data.usage?.total_tokens ?? (promptTokens + completionTokens);

    const usage: TokenUsage = {
      promptTokens,
      completionTokens,
      totalTokens,
      cachedPromptTokens,
    };

    return {
      content: textContent,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
      finishReason,
      truncationDetected: isTruncated,
    };
  }

  /**
   * Remote Hosted Ollama API implementation (OpenAI-compatible endpoint with function calling)
   */
  private async chatOllama(params: {
    system: string;
    messages: ChatMessage[];
    tools: ToolDefinition[];
    onToken?: (text: string) => void;
  }): Promise<LLMResponse> {
    let baseUrl = (this.config.baseUrl || "http://localhost:11434").replace(/\/+$/, "");
    if (!baseUrl.endsWith("/v1")) {
      baseUrl += "/v1";
    }
    const url = `${baseUrl}/chat/completions`;

    const openAiTools = (params.tools || []).map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const formattedMessages: any[] = [{ role: "system", content: params.system }];
    for (const msg of params.messages) {
      if (msg.role === "tool") {
        formattedMessages.push({
          role: "tool",
          tool_call_id: msg.tool_call_id,
          content: msg.content,
        });
      } else if (msg.role === "assistant" && msg.tool_calls) {
        formattedMessages.push({
          role: "assistant",
          content: msg.content || null,
          tool_calls: msg.tool_calls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args),
            },
          })),
        });
      } else {
        formattedMessages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    const maxTokens = this.config.maxTokens || 16384;
    const body: Record<string, any> = {
      model: this.config.model || "llama3.3:70b",
      messages: formattedMessages,
      tools: openAiTools.length > 0 ? openAiTools : undefined,
      temperature: this.config.temperature ?? 0.2,
      max_tokens: maxTokens,
      options: {
        num_predict: maxTokens,
      },
      stream: false,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // If remote Ollama is authenticated or behind an auth proxy
    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }

    const timeoutSeconds = this.getTimeoutSeconds();
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.getTimeoutMs()),
      });
    } catch (err: any) {
      this.handleFetchError(err, "Remote Ollama", url, timeoutSeconds);
    }

    if (!res.ok) {
      await this.handleHttpError(res, "Remote Ollama", url);
    }

    const data: any = await res.json();
    const message = data.choices?.[0]?.message;
    const finishReason = data.choices?.[0]?.finish_reason || data.done_reason;
    const isTruncated = finishReason === "length";

    let textContent = message?.content || "";
    // If standard content is empty, check reasoning fields (used by Grok, DeepSeek-R1, and thinking models)
    if (!textContent && (message?.reasoning_content || message?.reasoning)) {
      textContent = message.reasoning_content || message.reasoning;
    }
    if (textContent && params.onToken) {
      params.onToken(textContent);
    }

    const toolCalls: ToolCall[] = [];
    for (const tc of message?.tool_calls || []) {
      try {
        toolCalls.push({
          id: tc.id || `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          name: tc.function.name,
          args: typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function.arguments || {},
        });
      } catch (err: any) {
        console.error(`[ProviderClient] Failed to parse tool call arguments for ${tc.function?.name}:`, err);
        if (isTruncated) {
          console.error(`[ProviderClient] Output truncated at max_tokens (${maxTokens}) with finish_reason="${finishReason}".`);
        }
      }
    }

    // Extract usage metrics (OpenAI format or native Ollama stats)
    const promptTokens = data.usage?.prompt_tokens ?? data.prompt_eval_count ?? 0;
    const completionTokens = data.usage?.completion_tokens ?? data.eval_count ?? 0;
    const totalTokens = data.usage?.total_tokens ?? (promptTokens + completionTokens);

    const usage: TokenUsage = {
      promptTokens,
      completionTokens,
      totalTokens,
      cachedPromptTokens: 0,
    };

    return {
      content: textContent,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
      finishReason,
      truncationDetected: isTruncated,
    };
  }

  /**
   * Translates low-level fetch/network/timeout errors into actionable diagnostic Error objects.
   */
  private handleFetchError(err: any, providerLabel: string, url: string, timeoutSeconds: number): never {
    const isTimeout =
      err.name === "TimeoutError" ||
      err.name === "AbortError" ||
      /timeout|aborted|ETIMEDOUT/i.test(err.message || "");

    if (isTimeout) {
      const e = new Error(
        `${providerLabel} API request timed out after ${timeoutSeconds}s at ${url}. Increase Request Timeout in settings if running large models or heavy synthesis turns.`
      );
      (e as any).isTimeout = true;
      (e as any).isRetryable = true;
      throw e;
    }

    // Inspect underlying cause attached by Node.js fetch/undici
    const cause = err.cause;
    const causeName = cause?.name || "";
    const causeCode = cause?.code || "";
    const causeMsg = cause?.message || "";

    if (causeName === "ConnectTimeoutError" || causeCode === "UND_ERR_CONNECT_TIMEOUT") {
      const e = new Error(
        `${providerLabel} connection timed out establishing connection to ${url}. Check your internet connection, VPN, or firewall settings (ConnectTimeoutError).`
      );
      (e as any).isNetworkError = true;
      (e as any).isRetryable = true;
      throw e;
    }

    if (causeCode === "ENOTFOUND" || /getaddrinfo ENOTFOUND/i.test(causeMsg)) {
      const e = new Error(
        `${providerLabel} host lookup failed at ${url}. Unable to resolve host via DNS. Check internet connection or DNS configuration (ENOTFOUND).`
      );
      (e as any).isNetworkError = true;
      (e as any).isRetryable = true;
      throw e;
    }

    if (causeCode === "ECONNREFUSED") {
      const e = new Error(
        `${providerLabel} connection refused at ${url}. Ensure the server/endpoint is active and reachable (ECONNREFUSED).`
      );
      (e as any).isNetworkError = true;
      (e as any).isRetryable = true;
      throw e;
    }

    if (causeCode === "ECONNRESET") {
      const e = new Error(
        `${providerLabel} connection reset by peer at ${url}. The connection was unexpectedly closed (ECONNRESET).`
      );
      (e as any).isNetworkError = true;
      (e as any).isRetryable = true;
      throw e;
    }

    if (/CERT_|certificate|SSL|TLS/i.test(causeCode + " " + causeMsg)) {
      const e = new Error(
        `${providerLabel} SSL/TLS certificate verification failed for ${url} (${causeCode || causeMsg}). Check system clock and SSL proxy settings.`
      );
      (e as any).isNetworkError = true;
      (e as any).isRetryable = false;
      throw e;
    }

    if (err.message === "fetch failed") {
      const detail = causeMsg || causeCode || "unable to connect";
      const e = new Error(
        `${providerLabel} network connection failed connecting to ${url} (${detail}). Verify internet access and provider endpoint.`
      );
      (e as any).isNetworkError = true;
      (e as any).isRetryable = true;
      throw e;
    }

    const e = new Error(`${providerLabel} request failed: ${err.message || String(err)}`);
    (e as any).isNetworkError = true;
    (e as any).isRetryable = true;
    throw e;
  }

  /**
   * Formats HTTP error status codes with targeted, actionable diagnostics.
   */
  private async handleHttpError(res: Response, providerLabel: string, url: string): Promise<never> {
    const rawText = await res.text().catch(() => "");
    let cleanMessage = rawText.trim();
    try {
      const parsed = JSON.parse(rawText);
      const meta = parsed.error?.metadata;
      const metaDetail = meta?.raw || meta?.remedy_hint;
      cleanMessage = metaDetail || parsed.error?.message || parsed.message || parsed.error || rawText;
      if (typeof cleanMessage === "object") cleanMessage = JSON.stringify(cleanMessage);
    } catch (_) { }

    let friendly = "";
    let isRetryable = false;

    switch (res.status) {
      case 401:
        friendly = `${providerLabel} authentication failed (HTTP 401): Invalid or missing API key. Please check your credentials in settings.`;
        break;
      case 402:
        friendly = `${providerLabel} payment required (HTTP 402): Insufficient credits or account balance limit reached.`;
        break;
      case 403:
        friendly = `${providerLabel} access forbidden (HTTP 403): Account lacks permission for this model or region.`;
        break;
      case 404:
        friendly = `${providerLabel} resource not found (HTTP 404): The specified model '${this.config.model}' or endpoint does not exist.`;
        break;
      case 429:
        friendly = `${providerLabel} rate limited (HTTP 429): Request or token quota exceeded. Retrying may succeed.`;
        isRetryable = true;
        break;
      case 500:
      case 502:
      case 503:
      case 504:
        friendly = `${providerLabel} server error (HTTP ${res.status}): Provider service is temporarily degraded or undergoing maintenance.`;
        isRetryable = true;
        break;
      default:
        friendly = `${providerLabel} API error (${res.status}): ${cleanMessage || "Unexpected response"}`;
        break;
    }

    const errorMsg = cleanMessage && cleanMessage !== friendly
      ? `${friendly} [Detail: ${cleanMessage.length > 200 ? cleanMessage.slice(0, 197) + "..." : cleanMessage}]`
      : friendly;

    const err = new Error(errorMsg);
    (err as any).status = res.status;
    (err as any).isRetryable = isRetryable;
    throw err;
  }
}

