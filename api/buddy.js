// Serverless function: Buddy AI backend
// Environment variables expected:
// - DEEPSEEK_API_KEY
// - XAI_API_KEY (Grok / xAI)
// - OPENAI_API_KEY (ChatGPT)

// Ensure fetch exists in local Node (for Node <18)
if (typeof globalThis.fetch === "undefined") {
  globalThis.fetch = (...args) =>
    import("node-fetch").then(({ default: f }) => f(...args));
}

const DEFAULT_SUMMARIZER = "chatgpt"; // fallback summarizer for combined answer

const PROVIDER_MODELS = {
  chatgpt: "gpt-4o-mini",
  deepseek: "deepseek-chat",
  grok: "grok-2-latest",
};

// Utility: CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Utility: enforce JSON response
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

// Build OpenAI-like messages array from simple history
function buildMessagesFromHistory(history, userQuery) {
  const messages = [];
  // Optional system prompt to keep providers aligned
  messages.push({
    role: "system",
    content:
      "You are an expert assistant. Provide accurate, concise, and well-structured answers. Use markdown where helpful.",
  });
  if (Array.isArray(history)) {
    for (const item of history) {
      if (!item || !item.role || !item.content) continue;
      // Accept only user/assistant/system roles
      if (["user", "assistant", "system"].includes(item.role)) {
        messages.push({ role: item.role, content: String(item.content) });
      }
    }
  }
  if (userQuery && String(userQuery).trim().length > 0) {
    messages.push({ role: "user", content: String(userQuery) });
  }
  return messages;
}

// Provider: ChatGPT (OpenAI)
async function askChatGPT({ history, query, model }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { error: "OPENAI_API_KEY is not set" };
  }
  const messages = buildMessagesFromHistory(history, query);
  const body = {
    model: model || PROVIDER_MODELS.chatgpt,
    messages,
    temperature: 0.3,
  };
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      return { error: `OpenAI API error: ${res.status} ${text}` };
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content?.trim() || "";
    return { content };
  } catch (err) {
    return { error: `OpenAI request failed: ${err.message}` };
  }
}

// Provider: DeepSeek
async function askDeepseek({ history, query, model }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return { error: "DEEPSEEK_API_KEY is not set" };
  }
  const messages = buildMessagesFromHistory(history, query);
  const body = {
    model: model || PROVIDER_MODELS.deepseek,
    messages,
    temperature: 0.3,
  };
  try {
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      return { error: `DeepSeek API error: ${res.status} ${text}` };
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content?.trim() || "";
    return { content };
  } catch (err) {
    return { error: `DeepSeek request failed: ${err.message}` };
  }
}

// Provider: Grok (xAI)
async function askGrok({ history, query, model }) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return { error: "XAI_API_KEY is not set" };
  }
  const messages = buildMessagesFromHistory(history, query);
  const body = {
    model: model || PROVIDER_MODELS.grok,
    messages,
    temperature: 0.3,
  };
  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      return { error: `xAI Grok API error: ${res.status} ${text}` };
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content?.trim() || "";
    return { content };
  } catch (err) {
    return { error: `xAI request failed: ${err.message}` };
  }
}

// Summarize/merge with a chosen provider (prefers ChatGPT)
async function summarizeCombined({ history, query, answersByProvider, summarizer }) {
  const orderedProviders = Object.keys(answersByProvider);
  const bullets = orderedProviders
    .map((p) => `- ${p}: ${(answersByProvider[p] || "").slice(0, 8000)}`)
    .join("\n");
  const prompt = `You are an expert editor that merges multiple AI answers into one concise, accurate, and well-structured response.
Given the user query and several model answers, produce a single best answer. Prefer points of agreement, resolve conflicts with justification, keep it under ~12 sentences when possible, and include concrete steps or examples if helpful.

User query:\n${query}\n\nModel answers:\n${bullets}`;

  const finalSummarizer = summarizer || DEFAULT_SUMMARIZER;
  const messageHistory = Array.isArray(history) ? history.slice(-6) : [];
  const messages = [
    { role: "system", content: "You are a careful, reliable editor and synthesizer." },
    ...messageHistory.filter((m) => ["user", "assistant"].includes(m.role)),
    { role: "user", content: prompt },
  ];

  if (finalSummarizer === "chatgpt") {
    const res = await askChatGPT({ history: messages, query: "" });
    if (res?.content) return res.content;
  } else if (finalSummarizer === "deepseek") {
    const res = await askDeepseek({ history: messages, query: "" });
    if (res?.content) return res.content;
  } else if (finalSummarizer === "grok") {
    const res = await askGrok({ history: messages, query: "" });
    if (res?.content) return res.content;
  }

  // Fallback if summarizer fails or key missing
  return orderedProviders
    .map((p) => `${p.toUpperCase()}: ${answersByProvider[p] || ""}`)
    .join("\n\n");
}

async function handleParallel({ enabledProviders, history, query, summarizer }) {
  const calls = [];
  const results = {};

  const providerSet = new Set((enabledProviders || []).map((p) => p.toLowerCase()));
  if (providerSet.has("chatgpt")) {
    calls.push(
      askChatGPT({ history, query }).then((r) => {
        results.chatgpt = r?.content || r?.error || "";
      })
    );
  }
  if (providerSet.has("deepseek")) {
    calls.push(
      askDeepseek({ history, query }).then((r) => {
        results.deepseek = r?.content || r?.error || "";
      })
    );
  }
  if (providerSet.has("grok")) {
    calls.push(
      askGrok({ history, query }).then((r) => {
        results.grok = r?.content || r?.error || "";
      })
    );
  }

  await Promise.all(calls);

  const combined = await summarizeCombined({ history, query, answersByProvider: results, summarizer });
  return { ...results, combined };
}

async function handlePipeline({ enabledProviders, history, query, pipeline }) {
  // pipeline: { retriever: 'deepseek'|'chatgpt'|'grok', summarizer: same }
  const retriever = pipeline?.retriever || (enabledProviders?.[0] || "chatgpt");
  const summarizer = pipeline?.summarizer || DEFAULT_SUMMARIZER;

  const lowerRetriever = String(retriever).toLowerCase();
  const lowerSummarizer = String(summarizer).toLowerCase();

  let retrieved = "";
  const providerResults = {};

  if (lowerRetriever === "deepseek") {
    const r = await askDeepseek({ history, query });
    retrieved = r?.content || r?.error || "";
    providerResults.deepseek = retrieved;
  } else if (lowerRetriever === "grok") {
    const r = await askGrok({ history, query });
    retrieved = r?.content || r?.error || "";
    providerResults.grok = retrieved;
  } else {
    const r = await askChatGPT({ history, query });
    retrieved = r?.content || r?.error || "";
    providerResults.chatgpt = retrieved;
  }

  const summarizerPrompt = `You are given a user query and a draft/retrieved answer. Produce a final, polished answer that is accurate, concise, and well-structured. Improve clarity, fix any issues, and add missing steps if necessary.\n\nUser query:\n${query}\n\nDraft answer:\n${retrieved}`;

  let combined = "";
  if (lowerSummarizer === "deepseek") {
    const r = await askDeepseek({ history, query: summarizerPrompt });
    combined = r?.content || r?.error || "";
    providerResults.deepseek = providerResults.deepseek || "(used as summarizer)";
  } else if (lowerSummarizer === "grok") {
    const r = await askGrok({ history, query: summarizerPrompt });
    combined = r?.content || r?.error || "";
    providerResults.grok = providerResults.grok || "(used as summarizer)";
  } else {
    const r = await askChatGPT({ history, query: summarizerPrompt });
    combined = r?.content || r?.error || "";
    providerResults.chatgpt = providerResults.chatgpt || "(used as summarizer)";
  }

  return { ...providerResults, combined };
}

module.exports = async function (req, res) {
  // This signature is for Vercel Node serverless runtime
  if (req.method === "OPTIONS") {
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
    res.status(200).send("");
    return;
  }
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { query, enabledProviders, history, mode, pipeline, summarizer } = req.body || {};

    if (!query || String(query).trim().length === 0) {
      res.status(400).json({ error: "Missing 'query'" });
      return;
    }

    const safeProviders = Array.isArray(enabledProviders) && enabledProviders.length > 0
      ? enabledProviders
      : ["grok", "deepseek", "chatgpt"]; // default: all

    const runMode = (mode || "parallel").toLowerCase();

    let result;
    if (runMode === "pipeline") {
      result = await handlePipeline({ enabledProviders: safeProviders, history, query, pipeline });
    } else {
      result = await handleParallel({ enabledProviders: safeProviders, history, query, summarizer });
    }

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message || "Unknown error" });
  }
}


