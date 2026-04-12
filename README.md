# InvoiceIQ — AI Invoice & PO Processor MVP

Upload an invoice or PO → AI extracts all data → Review & edit → Push to ERP

---

## Quick Start

### 1. Backend Setup

```bash
cd backend
npm install
ANTHROPIC_API_KEY=your_key_here node server.js
```

Backend runs on: http://localhost:4000

### 2. Frontend Setup (new terminal)

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on: http://localhost:3000

---

## How It Works

1. **Upload** — Drop any invoice PDF or image
2. **AI Extracts** — Claude Vision reads vendor, amounts, line items, dates, PO numbers
3. **Review** — Edit any field before approving
4. **Push to ERP** — One click sends to ERP (mock for now, real Oracle/QuickBooks integration next)

---

## Project Structure

```
invoiceiq/
├── backend/
│   ├── server.js        # Express API + Claude Vision
│   └── package.json
└── frontend/
    ├── src/
    │   ├── App.jsx              # Main app + routing
    │   ├── App.css              # All styles
    │   └── components/
    │       ├── Upload.jsx       # File upload screen
    │       ├── Processing.jsx   # AI processing screen
    │       ├── Review.jsx       # Data review & edit screen
    │       └── Success.jsx      # ERP push success screen
    ├── index.html
    ├── vite.config.js
    └── package.json
```

---

## Next Steps to Build

- [ ] Real QuickBooks API integration
- [ ] Real Oracle Fusion API integration  
- [ ] User authentication (Auth0)
- [ ] Invoice history & dashboard
- [ ] PO matching logic
- [ ] Duplicate detection
- [ ] Email forwarding inbox
- [ ] Multi-user approval workflows

---

## Tech Stack

- **Frontend:** React + Vite + CSS
- **Backend:** Node.js + Express
- **AI:** Claude claude-opus-4-6 (Vision)
- **File handling:** Multer
