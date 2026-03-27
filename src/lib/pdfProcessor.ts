import { 
    MultiFormatReader, 
    DecodeHintType, 
    BarcodeFormat, 
    RGBLuminanceSource, 
    BinaryBitmap, 
    HybridBinarizer
} from '@zxing/library';

// @ts-ignore
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
// @ts-ignore
import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { GoogleGenAI } from "@google/genai";

// Initialize worker using Vite's asset URL mechanism
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export interface ExtractedCode {
    id: string;
    text: string;
    gtin: string;
    imageUrl: string;
    productName?: string;
    nameFetchTried?: boolean;
}

async function fetchNameFromGoogle(gtin: string): Promise<string | null> {
    try {
        // In Vite, process.env is replaced by define in vite.config.ts
        // @ts-ignore
        const apiKey = typeof process !== 'undefined' && process.env ? process.env.GEMINI_API_KEY : null;
        if (!apiKey) {
            console.warn("GEMINI_API_KEY not found in environment. Google Search fallback disabled.");
            return null;
        }

        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `Найди точное название товара по штрихкоду (GTIN): ${gtin}. Ответь только названием товара на русском языке, без лишних слов. Если не нашел, ответь "НЕ НАЙДЕНО".`,
            config: {
                tools: [{ googleSearch: {} }]
            }
        });

        const text = response.text;
        if (text && text.length > 3 && !text.toUpperCase().includes("НЕ НАЙДЕНО") && !text.toLowerCase().includes("извините")) {
            return text.trim().replace(/^["']|["']$/g, ''); // Remove quotes if any
        }
        return null;
    } catch (e) {
        console.error("Google Search fallback failed", e);
        return null;
    }
}

export async function fetchProductName(code: string): Promise<string | null> {
    try {
        console.log(`[FETCH] Starting fetch for code: ${code.substring(0, 20)}...`);
        
        // Send original code, server will try variations and AI fallbacks
        const response = await fetch(`/api/product-info?code=${encodeURIComponent(code)}`);
        
        if (response.ok) {
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                const data = await response.json();
                console.log(`[FETCH] Data received from server`, data.source ? `(Source: ${data.source})` : '');
                
                // Recursive function to find anything that looks like a product name
                const findName = (obj: any, depth = 0): string | null => {
                    if (!obj || typeof obj !== 'object' || depth > 10) return null;
                    
                    // Priority keys
                    const priorityKeys = ['productName', 'goodName', 'name', 'shortName', 'description', 'title', 'product_name', 'good_name'];
                    for (const key of priorityKeys) {
                        const val = obj[key];
                        if (typeof val === 'string' && val.trim().length > 2) {
                            return val.trim();
                        }
                        // Handle object-based names like { ru: "...", value: "..." }
                        if (typeof val === 'object' && val !== null) {
                            const subVal = val.ru || val.value || val.text || val.name || val.display_name;
                            if (typeof subVal === 'string' && subVal.trim().length > 2) {
                                return subVal.trim();
                            }
                        }
                    }
                    
                    // Check for 'product' or 'good' or 'item' objects specifically
                    const subObjects = ['product', 'good', 'item', 'codeResolveData', 'results'];
                    for (const key of subObjects) {
                        if (obj[key] && typeof obj[key] === 'object') {
                            const found = findName(obj[key], depth + 1);
                            if (found) return found;
                        }
                    }

                    // Check arrays
                    if (Array.isArray(obj)) {
                        for (const item of obj) {
                            const found = findName(item, depth + 1);
                            if (found) return found;
                        }
                    }
                    
                    // Final fallback: check all keys for anything that looks like a name
                    for (const key in obj) {
                        if (key.toLowerCase().includes('name') || key.toLowerCase().includes('title')) {
                            if (typeof obj[key] === 'string' && obj[key].length > 5) return obj[key];
                        }
                    }
                    
                    return null;
                };

                let name = findName(data);
                
                // Fallback for brand + model if found
                if (!name && data && data.brand && data.model) {
                    name = `${data.brand} ${data.model}`;
                }

                if (name) return name;
            } else {
                console.warn(`[FETCH] Server returned non-JSON response: ${contentType}`);
            }
        } else {
            console.warn(`[FETCH] Server returned status: ${response.status}`);
        }

        // Last resort: Client-side Gemini if server failed and we have a GTIN
        const gtinMatch = code.match(/(?:01|\(01\))(\d{14})/);
        const gtin = gtinMatch ? gtinMatch[1] : null;
        if (gtin) {
            console.log(`[FETCH] Server failed, trying client-side Gemini fallback for GTIN: ${gtin}`);
            return await fetchNameFromGoogle(gtin);
        }
        
        return null;
    } catch (e) {
        console.error("Failed to fetch product name", e);
        return null;
    }
}

export async function processImageFile(file: File, fetchNames: boolean = false): Promise<ExtractedCode[]> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const img = new Image();
                img.onload = async () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) return resolve([]);
                    ctx.drawImage(img, 0, 0);
                    
                    const hints = new Map();
                    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.DATA_MATRIX, BarcodeFormat.QR_CODE]);
                    hints.set(DecodeHintType.TRY_HARDER, true);
                    hints.set(DecodeHintType.ASSUME_GS1, true);
                    
                    const zxingReader = new MultiFormatReader();
                    zxingReader.setHints(hints);
                    
                    const codes = await extractCodesFromCanvas(canvas, zxingReader, fetchNames);
                    resolve(codes);
                };
                img.onerror = reject;
                img.src = e.target?.result as string;
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

export async function processPdfFile(file: File, onProgress: (progress: number) => void, fetchNames: boolean = false): Promise<ExtractedCode[]> {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ 
        data: arrayBuffer,
        disableFontFace: true,
        standardFontDataUrl: `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/standard_fonts/`
    });
    
    const pdf = await loadingTask.promise;
    const numPages = pdf.numPages;
    let allCodes: ExtractedCode[] = [];

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.DATA_MATRIX, BarcodeFormat.QR_CODE]);
    hints.set(DecodeHintType.TRY_HARDER, true);
    hints.set(DecodeHintType.ASSUME_GS1, true);
    
    const reader = new MultiFormatReader();
    reader.setHints(hints);

    for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        // Increase scale to 5.0 for even better detection of small/dense codes
        const viewport = page.getViewport({ scale: 5.0 }); 
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        
        if (!context) continue;
        
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        // @ts-ignore
        await page.render({ canvasContext: context, viewport }).promise;

        let codes = await extractCodesFromCanvas(canvas, reader, fetchNames);

        // FALLBACK: If ZXing fails, try PDF text extraction + visual crop
        // This is extremely reliable for standard Chestny Znak PDFs
        if (codes.length === 0) {
            try {
                const textContent = await page.getTextContent();
                const fullText = textContent.items.map((item: any) => item.str).join(' ');
                
                // Find all potential GTINs (with or without parentheses)
                const matches = Array.from(fullText.matchAll(/(?:01|\(01\))(\d{14})/g));
                if (matches.length > 0) {
                    // If we have multiple matches but only one page, they might be on the same page
                    // For now, let's try to find at least one robust crop
                    const crops = findMultipleBarcodeCrops(canvas);
                    
                    for (let m = 0; m < Math.min(matches.length, crops.length); m++) {
                        const match = matches[m];
                        const crop = crops[m];
                        
                        const cropCanvas = document.createElement('canvas');
                        cropCanvas.width = crop.size;
                        cropCanvas.height = crop.size;
                        const ctx = cropCanvas.getContext('2d')!;
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(0, 0, crop.size, crop.size);
                        
                        const dx = crop.size / 2 - crop.cx;
                        const dy = crop.size / 2 - crop.cy;
                        ctx.drawImage(canvas, dx, dy);

                        let productName = undefined;
                        let nameFetchTried = false;
                        if (fetchNames) {
                            productName = await fetchProductName(match[0]) || undefined;
                            nameFetchTried = true;
                        }

                        codes.push({
                            id: Math.random().toString(36).substring(2, 9),
                            text: match[0],
                            gtin: match[1],
                            imageUrl: cropCanvas.toDataURL('image/png'),
                            productName,
                            nameFetchTried
                        });
                    }
                }
            } catch (e) {
                console.error("Fallback extraction failed", e);
            }
        }

        allCodes = [...allCodes, ...codes];

        onProgress(i / numPages);
    }

    return allCodes;
}

async function extractCodesFromCanvas(canvas: HTMLCanvasElement, reader: MultiFormatReader, fetchNames: boolean): Promise<ExtractedCode[]> {
    const results: ExtractedCode[] = [];
    const seenTexts = new Set<string>();
    const foundRects: {x: number, y: number, w: number, h: number}[] = [];

    const isDuplicate = (x: number, y: number, w: number, h: number) => {
        for (const rect of foundRects) {
            const overlapX = Math.max(0, Math.min(x + w, rect.x + rect.w) - Math.max(x, rect.x));
            const overlapY = Math.max(0, Math.min(y + h, rect.y + rect.h) - Math.max(y, rect.y));
            const overlapArea = overlapX * overlapY;
            const rectArea = w * h;
            if (overlapArea > rectArea * 0.5) return true;
        }
        return false;
    };

    const processResult = async (res: any, offsetX: number, offsetY: number) => {
        const text = res.getText();
        const points = res.getResultPoints();
        if (!points || points.length < 2) return null;

        const xs = points.map((p: any) => p.getX());
        const ys = points.map((p: any) => p.getY());
        
        const minX_det = Math.min(...xs);
        const maxX_det = Math.max(...xs);
        const minY_det = Math.min(...ys);
        const maxY_det = Math.max(...ys);

        const centerX = (minX_det + maxX_det) / 2 + offsetX;
        const centerY = (minY_det + maxY_det) / 2 + offsetY;
        
        const width = maxX_det - minX_det;
        const height = maxY_det - minY_det;
        const detectedSize = Math.max(width, height);
        
        // Use a generous square crop size
        const cropSize = Math.ceil(detectedSize * 1.8); 
        
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = cropSize;
        cropCanvas.height = cropSize;
        const ctx = cropCanvas.getContext('2d')!;
        
        // Fill with white background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cropSize, cropSize);
        
        // Draw the source canvas onto the crop canvas such that the detected center 
        // is exactly at the center of the crop canvas.
        // dx and dy are the top-left coordinates on the destination canvas where the source starts.
        const dx = cropSize / 2 - centerX;
        const dy = cropSize / 2 - centerY;
        ctx.drawImage(canvas, dx, dy);

        const minX = centerX - cropSize / 2;
        const minY = centerY - cropSize / 2;

        if (isDuplicate(minX, minY, cropSize, cropSize)) return { minX, minY, finalSize: cropSize };

        const imageUrl = cropCanvas.toDataURL('image/png');
        const gtinMatch = text.match(/(?:01|\(01\))(\d{14})/);
        const gtin = gtinMatch ? gtinMatch[1] : 'GTIN не найден';
        
        let productName = undefined;
        let nameFetchTried = false;
        if (fetchNames) {
            productName = await fetchProductName(text) || undefined;
            nameFetchTried = true;
        }

        results.push({
            id: Math.random().toString(36).substring(2, 9),
            text,
            gtin,
            imageUrl,
            productName,
            nameFetchTried
        });
        foundRects.push({ x: minX, y: minY, w: cropSize, h: cropSize });
        seenTexts.add(text);

        return { minX, minY, finalSize: cropSize };
    };

    const decodeAndErase = async (workCanvas: HTMLCanvasElement) => {
        let foundAny = false;
        const ctx = workCanvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return false;

        // Try to find multiple codes by erasing them one by one
        for (let attempt = 0; attempt < 20; attempt++) {
            try {
                const imageData = ctx.getImageData(0, 0, workCanvas.width, workCanvas.height);
                const source = new RGBLuminanceSource(imageData.data, imageData.width, imageData.height);
                const bitmap = new BinaryBitmap(new HybridBinarizer(source));
                const res = reader.decode(bitmap);
                
                const crop = await processResult(res, 0, 0);
                if (crop) {
                    // Erase the found code to find the next one
                    ctx.fillStyle = '#ffffff';
                    // Erase a slightly larger area to be sure
                    ctx.fillRect(crop.minX - 5, crop.minY - 5, crop.finalSize + 10, crop.finalSize + 10);
                    foundAny = true;
                } else {
                    break;
                }
            } catch (e) {
                break;
            }
        }
        return foundAny;
    };

    const decodeCanvas = async (c: HTMLCanvasElement, offsetX: number, offsetY: number) => {
        try {
            const ctx = c.getContext('2d');
            if (!ctx) return;
            const imageData = ctx.getImageData(0, 0, c.width, c.height);
            const source = new RGBLuminanceSource(imageData.data, imageData.width, imageData.height);
            const bitmap = new BinaryBitmap(new HybridBinarizer(source));
            
            try {
                const res = reader.decode(bitmap);
                await processResult(res, offsetX, offsetY);
            } catch (e) {}
        } catch (e) {}
    };

    // Strategy 1: Find and Erase on the whole canvas
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.drawImage(canvas, 0, 0);
    await decodeAndErase(tempCanvas);

    // Strategy 2: Vertical strips (often codes are in a column)
    const strips = 5;
    const stripW = canvas.width / strips;
    for (let s = 0; s < strips; s++) {
        const stripCanvas = document.createElement('canvas');
        stripCanvas.width = stripW;
        stripCanvas.height = canvas.height;
        const ctx = stripCanvas.getContext('2d');
        if (!ctx) continue;
        ctx.drawImage(canvas, s * stripW, 0, stripW, canvas.height, 0, 0, stripW, canvas.height);
        await decodeAndErase(stripCanvas); // Use erase here too
    }

    // Strategy 3: Granular sliding windows
    const gridSizes = [2, 3, 5, 8];
    for (const size of gridSizes) {
        const cellW = canvas.width / size;
        const cellH = canvas.height / size;
        const stepX = cellW * 0.5;
        const stepY = cellH * 0.5;

        for (let y = 0; y <= canvas.height - cellH; y += stepY) {
            for (let x = 0; x <= canvas.width - cellW; x += stepX) {
                const cellCanvas = document.createElement('canvas');
                cellCanvas.width = cellW;
                cellCanvas.height = cellH;
                const ctx = cellCanvas.getContext('2d');
                if (!ctx) continue;
                ctx.drawImage(canvas, x, y, cellW, cellH, 0, 0, cellW, cellH);
                await decodeCanvas(cellCanvas, x, y);
            }
        }
    }
    
    return results;
}

function findMultipleBarcodeCrops(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];
    const width = canvas.width;
    const height = canvas.height;
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    // Calculate "energy" (transitions) to find barcode-like areas
    const energy = new Float32Array(width * height);
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const i = (y * width + x) * 4;
            const left = ((y * width + (x - 1)) * 4);
            const right = ((y * width + (x + 1)) * 4);
            const up = (((y - 1) * width + x) * 4);
            const down = (((y + 1) * width + x) * 4);
            
            // Horizontal and vertical gradients
            const gx = Math.abs(data[i] - data[right]) + Math.abs(data[i] - data[left]);
            const gy = Math.abs(data[i] - data[down]) + Math.abs(data[i] - data[up]);
            energy[y * width + x] = gx + gy;
        }
    }

    // Row density of high energy
    const rowEnergy = new Float32Array(height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (energy[y * width + x] > 100) {
                rowEnergy[y]++;
            }
        }
    }

    const regions: {y1: number, y2: number}[] = [];
    let inRegion = false;
    let startY = 0;
    let gap = 0;

    for (let y = 0; y < height; y++) {
        if (rowEnergy[y] > 20) {
            if (!inRegion) {
                startY = y;
                inRegion = true;
            }
            gap = 0;
        } else if (inRegion) {
            gap++;
            if (gap > 40) {
                if (y - startY > 50) {
                    regions.push({ y1: startY, y2: y - 40 });
                }
                inRegion = false;
            }
        }
    }
    if (inRegion) regions.push({ y1: startY, y2: height - 1 });

    const crops: {cx: number, cy: number, size: number}[] = [];

    for (const region of regions) {
        // Find horizontal bounds for this vertical region
        const colEnergy = new Float32Array(width);
        for (let x = 0; x < width; x++) {
            for (let y = region.y1; y <= region.y2; y++) {
                if (energy[y * width + x] > 100) {
                    colEnergy[x]++;
                }
            }
        }

        let inXRegion = false;
        let startX = 0;
        let xGap = 0;

        for (let x = 0; x < width; x++) {
            if (colEnergy[x] > 5) {
                if (!inXRegion) {
                    startX = x;
                    inXRegion = true;
                }
                xGap = 0;
            } else if (inXRegion) {
                xGap++;
                if (xGap > 40) {
                    const w = x - startX - 40;
                    const h = region.y2 - region.y1;
                    if (w > 50 && h > 50) {
                        const size = Math.max(w, h);
                        const cx = startX + w / 2;
                        const cy = region.y1 + h / 2;
                        const finalSize = Math.ceil(size * 1.8);

                        crops.push({ cx, cy, size: finalSize });
                    }
                    inXRegion = false;
                }
            }
        }
    }

    return crops;
}
