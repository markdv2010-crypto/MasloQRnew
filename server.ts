import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/product-info", async (req, res) => {
    try {
      const code = req.query.code as string;
      if (!code) {
        return res.status(400).json({ error: "Code is required" });
      }

      // Clean code for CZ API (remove parentheses and any non-printable chars)
      const cleanCode = code.replace(/[\(\)\u0000-\u001F\u007F-\u009F]/g, "");
      
      // Try multiple variations of the code
      const codesToTry = [cleanCode];
      if (cleanCode !== code) codesToTry.push(code);
      
      // If it looks like a GTIN-based code, try variations
      const gtinMatch = code.match(/(?:01|\(01\))(\d{14})/);
      if (gtinMatch) {
        const pureGtin = gtinMatch[1];
        if (!codesToTry.includes(pureGtin)) codesToTry.push(pureGtin);
        if (!codesToTry.includes('01' + pureGtin)) codesToTry.push('01' + pureGtin);
      }

      const endpoints = [
        { url: 'https://mobile.api.crpt.ru/mobile/check/v3', param: 'code' },
        { url: 'https://mobile.api.crpt.ru/mobile/check/v2', param: 'code' },
        { url: 'https://mobile.api.crpt.ru/mobile/check/v4', param: 'code' },
        { url: 'https://mobile.api.crpt.ru/mobile/check/v1', param: 'code' },
        { url: 'https://mobile.api.crpt.ru/mobile/check', param: 'code' }
      ];

      const headerSets = [
        {
          'User-Agent': 'Markirovka/5.12.0 (iPhone; iOS 15.4.1; Scale/3.00)',
          'X-Platform': 'iOS',
          'X-App-Version': '5.12.0',
          'X-Device-Id': '8E6B6B6B-6B6B-6B6B-6B6B-6B6B6B6B6B6B',
          'X-Certificate-Serial': '5A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P',
        },
        {
          'User-Agent': 'Markirovka/5.15.1 (Android; 12; Scale/2.62)',
          'X-Platform': 'Android',
          'X-App-Version': '5.15.1',
          'X-Device-Id': 'f0a1b2c3d4e5f6g7',
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

      for (const endpoint of endpoints) {
        for (const headersBase of headerSets) {
          // Try with and without Host header
          const hostOptions = [true, false];
          
          for (const includeHost of hostOptions) {
            const currentHeaders: Record<string, string> = {
              ...headersBase,
              'Accept': 'application/json',
              'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
              'Connection': 'keep-alive'
            };
            
            if (includeHost) {
              currentHeaders['Host'] = 'mobile.api.crpt.ru';
            }

            for (const c of codesToTry) {
              try {
                const url = `${endpoint.url}?${endpoint.param}=${encodeURIComponent(c)}`;
                console.log(`[CZ API] Trying: ${url} (${currentHeaders['X-Platform']}, Host: ${includeHost})`);
                
                const response = await fetch(url, {
                  headers: currentHeaders,
                  signal: AbortSignal.timeout(4000)
                });
                
                lastStatus = response.status;
                
                if (response.ok) {
                  const data = await response.json();
                  // Check if we got something useful
                  if (data && (data.productName || data.goodName || data.name || data.codeResolveData || data.results || data.product)) {
                    console.log(`[CZ API] SUCCESS for ${c.substring(0, 15)}...`);
                    return res.json(data);
                  } else {
                    console.log(`[CZ API] OK but no name found in response for ${c.substring(0, 15)}... Data keys: ${Object.keys(data || {}).join(', ')}`);
                    // If it's a valid response but empty, we might still want to return it for debugging
                    if (data && Object.keys(data).length > 0) {
                       return res.json(data);
                    }
                  }
                } else {
                  const text = await response.text();
                  console.warn(`[CZ API] Error ${response.status} for ${url}: ${text.substring(0, 100)}`);
                }
              } catch (e) {
                console.error(`[CZ API] Exception for ${endpoint.url}:`, e);
                lastError = e;
              }
            }
          }
        }
      }
      
      res.status(lastStatus || 404).json({ 
        error: "Product not found or API restricted", 
        details: lastError?.toString(),
        triedCodes: codesToTry,
        message: "Не удалось получить данные от Честного ЗНАКа. Возможно, код не зарегистрирован или сервис блокирует запросы."
      });
    } catch (error) {
      console.error("Error in /api/product-info:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
