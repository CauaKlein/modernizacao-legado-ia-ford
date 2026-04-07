import express from "express";
import dotenv from "dotenv";
import path from "path";
import axios from "axios";
import cors from "cors";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: "4mb" }));
app.use(cors());
app.use(express.static(__dirname));

app.get("/api/health", (req, res) => {
  return res.json({
    ok: true,
    model: GEMINI_MODEL,
    gemini_key_set: !!GEMINI_KEY,
    node_env: process.env.NODE_ENV || "development",
  });
});

app.get("/api/hf-test", async (req, res) => {
  if (!GEMINI_KEY) return res.status(400).json({ error: "GEMINI_API_KEY não definido (.env)" });

  const prompt = "Print 'Hello world' in a single line (no explanation).";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 512, temperature: 0.0 }
  };

  try {
    console.log(`[HF-TEST] POST ${url}`);
    const r = await axios.post(url, payload, {
      headers: { "x-goog-api-key": GEMINI_KEY, "Content-Type": "application/json" },
      timeout: 60000
    });
    const text = extractTextFromGeminiResponse(r.data);
    return res.json({ ok: true, endpoint_used: url, raw: r.data, text });
  } catch (err) {
    console.error("[HF-TEST] erro ao chamar Gemini:", err?.response?.status, err?.response?.data || err.message);
    if (err.response) {
      return res.status(err.response.status).json({ error: "Erro do Gemini (veja logs).", status: err.response.status, data: err.response.data });
    }
    return res.status(500).json({ error: "Erro de conexão: " + err.message });
  }
});

app.post("/api/convert", async (req, res) => {
  try {
    const { from_lang, to_lang, source_code } = req.body;
    if (!from_lang || !to_lang || !source_code) {
      return res.status(400).json({ error: "from_lang, to_lang e source_code são obrigatórios." });
    }

    if (req.query.mock === "true") {
      const mock = `// MOCK: conversão simulada (${from_lang} -> ${to_lang})\n// preview: ${source_code.slice(0,120).replace(/\n/g,' ')}\n\nconsole.log('Converted (mock)');`;
      return res.json({ refactored: mock });
    }

    if (!GEMINI_KEY) {
      console.error("[CONVERT] GEMINI_API_KEY não definido.");
      return res.status(500).json({ error: "GEMINI_API_KEY não definido no servidor." });
    }

    const prompt = buildPrompt(from_lang, to_lang, source_code);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 1024, temperature: 0.0, topP: 0.95 }
    };

    console.log(`[CONVERT] POST ${url} model=${GEMINI_MODEL}`);
    console.log("[CONVERT] prompt preview:", prompt.slice(0, 400).replace(/\n/g, " "));

    const r = await axios.post(url, payload, {
      headers: { "x-goog-api-key": GEMINI_KEY, "Content-Type": "application/json" },
      timeout: 120000
    });

    const generated = extractTextFromGeminiResponse(r.data);
    const cleaned = extractCodeBlock(generated) || generated;

    return res.json({ refactored: cleaned, raw: r.data, endpoint_used: url });
  } catch (err) {
    console.error("[CONVERT] Erro Gemini:", err?.response?.status, err?.response?.data || err.message);
    if (err.response) {
      return res.status(err.response.status).json({ error: "Erro da Gemini (veja logs).", status: err.response.status, data: err.response.data });
    }
    return res.status(500).json({ error: "Erro interno: " + err.message });
  }
});


function buildPrompt(from, to, source) {
  return `Você é um assistente especialista em converter/portar código entre linguagens de programação.
Regra IMPORTANTE: Retorne APENAS o código convertido, sem explicações, sem comentários descritivos extras. Se possível, entregue o código dentro de blocos de código em Markdown (triple backticks), mas não inclua texto fora desses blocos.
Se houver dependências externas, adicione um comentário curto no topo com "// NOTE:" e depois o código.
Converta do idioma ${from} para ${to} mantendo a lógica e os nomes de variáveis quando fizer sentido.

---INÍCIO DO CÓDIGO---
${source}
---FIM DO CÓDIGO---`;
}

function extractTextFromGeminiResponse(data) {
  try {
    if (Array.isArray(data?.candidates) && data.candidates.length > 0) {
      const cand = data.candidates[0];
      if (cand.content) {
        if (Array.isArray(cand.content.parts) && cand.content.parts[0]?.text) {
          return cand.content.parts.map(p => p.text).join("\n");
        }
        if (cand.content?.text) return cand.content.text;
        if (Array.isArray(cand.content) && cand.content[0]?.text) return cand.content[0].text;
      }
    }

    if (Array.isArray(data?.output) && data.output[0]?.content?.[0]?.text) {
      return data.output[0].content[0].text;
    }

    const found = deepFindText(data);
    if (found) return found;

    return typeof data === "string" ? data : JSON.stringify(data);
  } catch (e) {
    return JSON.stringify(data);
  }
}

function deepFindText(obj, depth = 0) {
  if (!obj || depth > 6) return null;
  if (typeof obj === "string") return obj;
  if (Array.isArray(obj)) {
    for (const el of obj) {
      const f = deepFindText(el, depth + 1);
      if (f) return f;
    }
  } else if (typeof obj === "object") {
    for (const k of Object.keys(obj)) {
      const val = obj[k];
      if (k.toLowerCase().includes("text") && typeof val === "string") return val;
      const f = deepFindText(val, depth + 1);
      if (f) return f;
    }
  }
  return null;
}

function extractCodeBlock(text) {
  if (!text) return "";
  const fence = /```(?:[\w+-]*)\n([\s\S]*?)```/;
  const m = text.match(fence);
  if (m && m[1].trim()) return m[1].trim();

  const lines = text.split("\n");

  const codeLike = lines.filter(l => /[;{}():=<>]|^\s*(def|class|function|public|private|console\.log)/i.test(l));
  if (codeLike.length >= Math.max(1, Math.floor(lines.length * 0.2))) {
    return text.trim();
  }

  const idx = text.indexOf("Código:");
  if (idx !== -1) return text.slice(idx + 7).trim();

  return text.trim();
}

app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
