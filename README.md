# 🥾 Mesh Shoes — Crypto Checkout Demo

A single-page retail store that lets users buy mesh shoes and pay with **USDC on Ethereum** through their Coinbase account — powered by [Mesh Connect](https://meshconnect.com).

![Node.js](https://img.shields.io/badge/Node.js-16+-green) ![Mesh](https://img.shields.io/badge/Mesh-Sandbox-yellow)

---

## Overview

This project demonstrates a complete Mesh payment integration:

1. **Browse** — Pick one of three shoe products ($40, $50, or $60)
2. **Shipping** — Enter a delivery address
3. **Pay** — Click "Checkout with Mesh" to open the Mesh Link UI
4. **Connect** — Log in to the sandbox Coinbase mock exchange
5. **Transfer** — Send testnet USDC on Ethereum to the merchant wallet

The backend creates a one-time `linkToken` per checkout, and the frontend uses the [Mesh Web SDK](https://github.com/FrontFin/mesh-web-sdk) to launch the payment flow.

---

## Quick Start

### Prerequisites

- **Node.js** 16 or higher
- **npm** (comes with Node)

### 1. Clone the repo

```bash
git clone https://github.com/<your-username>/mesh-shoes-checkout.git
cd mesh-shoes-checkout
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy the example env file and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env` with your Mesh sandbox credentials:

```
MESH_API_URL=https://sandbox-integration-api.meshconnect.com
MESH_CLIENT_ID=<your_client_id>
MESH_API_KEY=<your_api_key>
MESH_SECRET_KEY=<your_secret_key>
DESTINATION_WALLET=<your_wallet_address>
ETHEREUM_NETWORK_ID=e3c7fdd8-b1fc-4e51-85ae-bb276e075611
WEBHOOK_URL=<your_webhook_url>
PORT=3000
```

### 4. Start the server

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Testing the Payment Flow

This project uses the **Mesh Sandbox** environment with mocked Coinbase endpoints.

| Step | Action |
|------|--------|
| 1 | Select a shoe and fill in shipping details |
| 2 | Click **"Checkout with Mesh"** |
| 3 | In the Mesh Link popup, select **Coinbase** |
| 4 | Enter any credentials (e.g. `user123` / `pass123`) |
| 5 | When prompted for MFA, enter **`123456`** |
| 6 | Confirm the USDC transfer |
| 7 | The transfer will complete and the status banner will update |

All transfers are simulated — no real funds are moved.

---

## Project Structure

```
mesh-shoes-checkout/
├── server.js            # Express backend (link token + webhook)
├── public/
│   └── index.html       # Single-page retail frontend
├── .env                 # Environment variables (not committed)
├── .env.example         # Template for env vars
├── .gitignore
├── package.json
└── README.md
```

---

## Architecture

```
┌─────────────┐        ┌──────────────┐        ┌───────────────────┐
│   Browser    │──POST──│  Express     │──POST──│ Mesh Sandbox API  │
│  (index.html)│  /api/ │  server.js   │        │ linktoken endpoint│
│              │◄─JSON──│              │◄─JSON──│                   │
└──────┬───────┘        └──────┬───────┘        └───────────────────┘
       │                       │
       │ openLink(token)       │ POST /api/webhook
       ▼                       ▼
┌──────────────┐        ┌───────────────┐
│  Mesh Link   │        │  Webhook.site │
│  SDK Modal   │        │  (or your     │
│  (Coinbase   │        │   endpoint)   │
│   sandbox)   │        └───────────────┘
└──────────────┘
```

**Backend** (`server.js`):
- `POST /api/create-link-token` — Creates a Mesh linkToken configured for a USDC payment
- `POST /api/webhook` — Receives transfer status webhooks from Mesh
- `GET /api/config` — Returns the client ID (safe for frontend)

**Frontend** (`public/index.html`):
- Product selection UI
- Shipping address form
- Mesh Link SDK integration via `MeshLink.createLink()` and `openLink()`

---

## Configuration Details

| Variable | Description |
|----------|-------------|
| `MESH_API_URL` | Sandbox: `https://sandbox-integration-api.meshconnect.com` |
| `MESH_CLIENT_ID` | Your Mesh sandbox client ID |
| `MESH_API_KEY` | Your Mesh sandbox API secret (used as `X-Client-Secret`) |
| `MESH_SECRET_KEY` | Used to verify webhook signatures |
| `DESTINATION_WALLET` | Ethereum address that receives USDC payments |
| `ETHEREUM_NETWORK_ID` | Mesh's UUID for the Ethereum network |
| `WEBHOOK_URL` | Where Mesh sends transfer status updates |
| `PORT` | Local server port (default: 3000) |

---

## Webhooks

Mesh sends webhook events when a transfer's status changes. In this demo, the webhook endpoint is at `POST /api/webhook` and also configured to forward to a [webhook.site](https://webhook.site) URL for easy inspection.

The server optionally verifies the `mesh-signature` header using HMAC-SHA256 with your secret key.

---

## Tech Stack

- **Backend**: Node.js + Express
- **Frontend**: Vanilla HTML/CSS/JS (no build step)
- **Payments**: Mesh Connect Web SDK + Sandbox API
- **Fonts**: DM Sans + Instrument Serif (Google Fonts)

---

## License

MIT
