import { jsPDF } from 'jspdf';
import { ExtractedCode } from './pdfProcessor';

export interface PdfOptions {
    columns: number;
    rows: number;
    margin: number;
    showCutLines: boolean;
    showGtin: boolean;
    showProductName: boolean;
    orientation: 'portrait' | 'landscape';
    codeScale: number;
    useFixedSize?: boolean;
    fixedSizeMm?: number;
}

function createTextDataUrl(text: string, maxWidthMm: number): { url: string, heightMm: number } {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const scale = 8; // Even higher resolution for ultra-crisp text
    const pxPerMm = 3.7795275591; // Approx pixels per mm at 96 DPI
    const maxWidthPx = maxWidthMm * pxPerMm;
    
    // Pre-calculate layout to determine height
    const fontSize = 11;
    const lineHeight = 13;
    const fontStack = '600 11px "Inter", "Segoe UI", "Roboto", "Helvetica Neue", sans-serif';
    
    ctx.font = fontStack;
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';
    
    for (let n = 0; n < words.length; n++) {
        const testLine = currentLine + words[n] + ' ';
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidthPx && n > 0) {
            lines.push(currentLine.trim());
            currentLine = words[n] + ' ';
        } else {
            currentLine = testLine;
        }
    }
    lines.push(currentLine.trim());
    
    const totalLines = lines.length;
    const actualHeightMm = (totalLines * lineHeight + 2) / pxPerMm;
    
    canvas.width = maxWidthPx * scale;
    canvas.height = (totalLines * lineHeight + 4) * scale;
    
    ctx.scale(scale, scale);
    ctx.fillStyle = '#000000';
    ctx.font = fontStack;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    
    // Use better text rendering
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    lines.forEach((line, i) => {
        ctx.fillText(line, maxWidthPx / 2, i * lineHeight + 1);
    });
    
    return { 
        url: canvas.toDataURL('image/png', 1.0),
        heightMm: actualHeightMm
    };
}

export function generateGridPdf(codes: ExtractedCode[], options: PdfOptions) {
    const { columns, rows, margin, showCutLines, showGtin, showProductName, orientation, codeScale, useFixedSize, fixedSizeMm = 40 } = options;
    const pdf = new jsPDF({
        orientation: orientation,
        unit: 'mm',
        format: 'a4'
    });

    const pageWidth = orientation === 'portrait' ? 210 : 297;
    const pageHeight = orientation === 'portrait' ? 297 : 210;
    const contentWidth = pageWidth - 2 * margin;
    const contentHeight = pageHeight - 2 * margin;

    // Determine grid dimensions
    let finalColumns = columns;
    let finalRows = rows;
    let cellWidth = contentWidth / columns;
    let cellHeight = contentHeight / rows;

    if (useFixedSize) {
        cellWidth = fixedSizeMm;
        cellHeight = fixedSizeMm + (showGtin ? 8 : 0) + (showProductName ? 10 : 0); // Add space for GTIN and product name if needed
        finalColumns = Math.floor(contentWidth / cellWidth);
        finalRows = Math.floor(contentHeight / cellHeight);
    }

    let currentCodeIndex = 0;

    while (currentCodeIndex < codes.length) {
        if (currentCodeIndex > 0) {
            pdf.addPage();
        }

        if (showCutLines) {
            pdf.setDrawColor(200, 200, 200);
            pdf.setLineWidth(0.1);
            // Vertical lines
            for (let c = 0; c <= finalColumns; c++) {
                const x = margin + c * cellWidth;
                pdf.line(x, margin, x, margin + finalRows * cellHeight);
            }
            // Horizontal lines
            for (let r = 0; r <= finalRows; r++) {
                const y = margin + r * cellHeight;
                pdf.line(margin, y, margin + finalColumns * cellWidth, y);
            }
        }

        for (let r = 0; r < finalRows; r++) {
            for (let c = 0; c < finalColumns; c++) {
                if (currentCodeIndex >= codes.length) break;

                const code = codes[currentCodeIndex];
                const x = margin + c * cellWidth;
                const y = margin + r * cellHeight;

                const padding = 2;
                
                let productNameData: { url: string, heightMm: number } | null = null;
                let productNameHeight = 0;
                
                if (showProductName && code.productName) {
                    productNameData = createTextDataUrl(code.productName, cellWidth - 2 * padding);
                    productNameHeight = productNameData.heightMm;
                }

                let imgSize = useFixedSize ? fixedSizeMm - 2 * padding : Math.min(cellWidth - 2 * padding, cellHeight - 2 * padding - (showGtin ? 4 : 0) - productNameHeight);
                imgSize *= codeScale;

                const imgX = x + (cellWidth - imgSize) / 2;
                
                let imgY = 0;
                if (useFixedSize) {
                    const extraTopSpace = showProductName ? 10 : 0;
                    imgY = y + padding + extraTopSpace + (fixedSizeMm - 2 * padding - imgSize) / 2;
                } else {
                    imgY = y + padding + productNameHeight + (cellHeight - padding - (showGtin ? 4 : 0) - imgSize - productNameHeight) / 2;
                }

                if (productNameData) {
                    const nameY = useFixedSize ? y + padding + (10 - productNameHeight) / 2 : imgY - productNameHeight;
                    pdf.addImage(productNameData.url, 'PNG', x + padding, nameY, cellWidth - 2 * padding, productNameHeight);
                }

                pdf.addImage(code.imageUrl, 'PNG', imgX, imgY, imgSize, imgSize);

                if (showGtin) {
                    pdf.setFontSize(7);
                    pdf.setTextColor(0, 0, 0);
                    const extraTopSpace = showProductName ? 10 : 0;
                    const gtinY = useFixedSize ? y + extraTopSpace + fixedSizeMm + 4 : imgY + imgSize + 3;
                    pdf.text(code.gtin, x + cellWidth / 2, gtinY, { align: 'center' });
                }

                currentCodeIndex++;
            }
        }
    }

    pdf.save('chestny-znak-grid.pdf');
}
