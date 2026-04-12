const express = require("express");
const cors = require("cors");
const multer = require("multer");
const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");

const app = express();
const upload = multer({ dest: "uploads/" });
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Allow requests from Vercel frontend
app.use(cors({
  origin: process.env.FRONTEND_URL || "*",
  methods: ["GET", "POST"],
}));
app.use(express.json());

// Health check for Railway
app.get("/health", (req, res) => res.json({ status: "ok" }));

// Extract invoice data using Claude Vision
app.post("/api/extract", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const filePath = req.file.path;
    const mimeType = req.file.mimetype;
    const fileData = fs.readFileSync(filePath);
    const base64Data = fileData.toString("base64");

    // Determine media type
    let mediaType = mimeType;
    if (!["image/jpeg","image/png","image/webp","image/gif","application/pdf"].includes(mediaType)) {
      mediaType = "image/jpeg";
    }

    const prompt = `You are an expert invoice parser. Extract all data from this invoice/PO document.

Return ONLY a valid JSON object with no markdown, no explanation:
{
  "invoiceNumber": "string or null",
  "invoiceDate": "YYYY-MM-DD or null",
  "dueDate": "YYYY-MM-DD or null",
  "vendor": {
    "name": "string",
    "address": "string or null",
    "email": "string or null",
    "phone": "string or null"
  },
  "billTo": {
    "name": "string or null",
    "address": "string or null"
  },
  "lineItems": [
    {
      "description": "string",
      "quantity": number,
      "unitPrice": number,
      "amount": number
    }
  ],
  "subtotal": number,
  "tax": number,
  "total": number,
  "currency": "USD",
  "poNumber": "string or null",
  "paymentTerms": "string or null",
  "notes": "string or null",
  "confidence": number between 0 and 1
}`;

    const response = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64Data }
          },
          { type: "text", text: prompt }
        ]
      }]
    });

    // Cleanup temp file
    fs.unlinkSync(filePath);

    const rawText = response.content.find(b => b.type === "text")?.text || "{}";
    const cleaned = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

    let extracted;
    try {
      extracted = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      extracted = match ? JSON.parse(match[0]) : {};
    }

    res.json({ success: true, data: extracted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Mock ERP push
app.post("/api/push-erp", async (req, res) => {
  const { invoiceData } = req.body;
  // Simulate ERP push delay
  await new Promise(r => setTimeout(r, 1200));
  res.json({
    success: true,
    erpReference: `ERP-${Date.now()}`,
    message: `Invoice ${invoiceData.invoiceNumber || "N/A"} successfully pushed to ERP`,
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`InvoiceIQ backend running on http://localhost:${PORT}`));
