import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { GoogleGenAI } from "@google/genai";

const app = express();
const PORT = 3000;

// API routes FIRST
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

async function fetchFromGemini(gtin: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") return null;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Найди точное название товара по штрихкоду (GTIN): ${gtin}. Ответь только названием товара на русском языке, без лишних слов. Если не нашел, ответь "НЕ НАЙДЕНО".`,
    });

    const text = response.text;
    if (text && !text.includes("НЕ НАЙДЕНО")) {
      return text.trim().replace(/^["']|["']$/g, '');
    }
  } catch (e) {
    console.error("[Gemini] Error:", e);
  }
  return null;
}

async function fetchFromOpenRouter(gtin: string) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey === "MY_OPENROUTER_API_KEY") return null;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
        "X-Title": "Chestny Znak Scanner",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "nvidia/llama-3.1-nemotron-70b-instruct:free",
        messages: [
          {
            role: "user",
            content: `Найди точное название товара по штрихкоду (GTIN): ${gtin}. Ответь только названием товара на русском языке, без лишних слов. Если не нашел, ответь "НЕ НАЙДЕНО".`
          }
        ]
      })
    });

    if (response.ok) {
      const data = await response.json();
      const text = data.choices?.[0]?.message?.content;
      if (text && !text.includes("НЕ НАЙДЕНО")) {
        return text.trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch (e) {
    console.error("[OpenRouter] Error:", e);
  }
  return null;
}

app.get("/api/product-info", async (req, res) => {
  try {
    const code = req.query.code as string;
    if (!code) {
      return res.status(400).json({ error: "Code is required" });
    }

    // Clean code for CZ API
    const cleanCode = code.replace(/[\(\)\u0000-\u001F\u007F-\u009F]/g, "");
    const codesToTry = [cleanCode];
    if (cleanCode !== code) codesToTry.push(code);
    
    const gtinMatch = code.match(/(?:01|\(01\))(\d{14})/);
    const gtin = gtinMatch ? gtinMatch[1] : null;
    if (gtin) {
      if (!codesToTry.includes(gtin)) codesToTry.push(gtin);
      if (!codesToTry.includes('01' + gtin)) codesToTry.push('01' + gtin);
    }

    const endpoints = [
      { url: 'https://mobile.api.crpt.ru/mobile/check/v3', param: 'code' },
      { url: 'https://mobile.api.crpt.ru/mobile/check/v2', param: 'code' },
      { url: 'https://mobile.api.crpt.ru/mobile/check/v4', param: 'code' },
      { url: 'https://mobile.api.crpt.ru/mobile/check/v1', param: 'code' },
      { url: 'https://mobile.api.crpt.ru/mobile/check', param: 'code' }
    ];

    const generateDeviceId = () => {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16).toUpperCase();
      });
    };

    const headerSets = [
      {
        'User-Agent': 'Markirovka/5.12.0 (iPhone; iOS 15.4.1; Scale/3.00)',
        'X-Platform': 'iOS',
        'X-App-Version': '5.12.0',
        'X-Device-Id': generateDeviceId(),
        'X-Certificate-Serial': '5A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P',
      },
      {
        'User-Agent': 'Markirovka/5.15.1 (Android; 12; Scale/2.62)',
        'X-Platform': 'Android',
        'X-App-Version': '5.15.1',
        'X-Device-Id': generateDeviceId(),
        'X-Certificate-Serial': '1A2B3C4D5E6F7G8H9I0J1K2L3M4N5O6P',
      },
      {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
        'X-Platform': 'iOS',
        'X-App-Version': '5.10.0',
      }
    ];

    let lastError = null;
    let lastStatus = 0;

    // Try CZ API first
    for (const endpoint of endpoints) {
      for (const headersBase of headerSets) {
        const hostOptions = [true, false];
        for (const includeHost of hostOptions) {
          const currentHeaders: Record<string, string> = {
            ...headersBase,
            'Accept': 'application/json',
            'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
            'Connection': 'keep-alive'
          };
          if (includeHost) currentHeaders['Host'] = 'mobile.api.crpt.ru';

          for (const c of codesToTry) {
            try {
              const url = `${endpoint.url}?${endpoint.param}=${encodeURIComponent(c)}`;
              const response = await fetch(url, {
                headers: currentHeaders,
                signal: AbortSignal.timeout(3000)
              });
              lastStatus = response.status;
              if (response.ok) {
                const data = await response.json();
                if (data && (data.productName || data.goodName || data.name || data.codeResolveData || data.results || data.product)) {
                  return res.json(data);
                }
              }
            } catch (e) {
              lastError = e;
            }
          }
        }
      }
    }

    // Fallback to AI if GTIN exists
    if (gtin) {
      console.log(`[Fallback] Trying AI for GTIN: ${gtin}`);
      
      // Try Gemini first
      const geminiName = await fetchFromGemini(gtin);
      if (geminiName) {
        return res.json({ productName: geminiName, source: "Gemini" });
      }

      // Try OpenRouter (Nemotron)
      const openRouterName = await fetchFromOpenRouter(gtin);
      if (openRouterName) {
        return res.json({ productName: openRouterName, source: "OpenRouter" });
      }
    }
    
    res.status(lastStatus || 404).json({ 
      error: "Product not found", 
      message: "Не удалось получить данные. Попробуйте ввести название вручную."
    });
  } catch (error) {
    console.error("Error in /api/product-info:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  if (process.env.NODE_ENV !== "test") {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

if (process.env.NODE_ENV !== "production") {
  startServer();
}

export default app;
