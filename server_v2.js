require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── Config ───────────────────────────────────────────────
const {
  MESH_API_URL,
  MESH_CLIENT_ID,
  MESH_API_KEY,
  MESH_SECRET_KEY,
  DESTINATION_WALLET,
  ETHEREUM_NETWORK_ID,
  WEBHOOK_URL,
  PORT = 3000,
} = process.env;

const TAX_RATE = 0.08; // 8% sales tax

// ─── In-memory order store ────────────────────────────────
// Maps transactionId → order details so we can enrich
// webhook payloads with product/shipping info.
const orders = new Map();

// ─── Helper: forward payload to webhook.site ─────────────
async function forwardToWebhook(eventType, payload) {
  if (!WEBHOOK_URL) return;
  try {
    const resp = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: eventType, ...payload }),
    });
    console.log(`  → Forwarded "${eventType}" to webhook (${resp.status})`);
  } catch (err) {
    console.error(`  ✗ Failed to forward to webhook:`, err.message);
  }
}

// ─── POST /api/create-link-token ──────────────────────────
// Called by the frontend when the user clicks "Checkout with Mesh".
// Generates a one-time linkToken that opens the Mesh Link UI
// configured for a USDC-on-Ethereum payment to our wallet.
app.post("/api/create-link-token", async (req, res) => {
  try {
    const { amount, userId, shippingAddress, productName } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const transactionId = uuidv4();

    // Calculate tax and total
    const subtotal = amount;
    const tax = Math.round(subtotal * TAX_RATE * 100) / 100;
    const total = Math.round((subtotal + tax) * 100) / 100;

    // Store order details for later webhook enrichment
    const orderDetails = {
      transactionId,
      productName: productName || "Unknown product",
      subtotal,
      tax,
      taxRate: `${TAX_RATE * 100}%`,
      total,
      currency: "USDC",
      network: "Ethereum",
      destinationWallet: DESTINATION_WALLET,
      shippingAddress: shippingAddress || null,
      createdAt: new Date().toISOString(),
    };
    orders.set(transactionId, orderDetails);

    const body = {
      userId: userId || `user_${uuidv4().slice(0, 8)}`,
      restrictMultipleAccounts: true,
      transferOptions: {
        transactionId,
        transferType: "payment",
        toAddresses: [
          {
            symbol: "USDC",
            address: DESTINATION_WALLET,
            networkId: ETHEREUM_NETWORK_ID,
            amount: total, // charge subtotal + tax
          },
        ],
        fundingOptions: {
          enabled: true,
        },
      },
    };

    console.log("\n─── Creating link token ───");
    console.log("Product:", orderDetails.productName);
    console.log("Subtotal:", subtotal, "USDC");
    console.log("Tax (8%):", tax, "USDC");
    console.log("Total:", total, "USDC");
    console.log("Destination:", DESTINATION_WALLET);
    console.log("Transaction ID:", transactionId);
    if (shippingAddress) {
      console.log("Shipping to:", shippingAddress.name, "-", shippingAddress.city, shippingAddress.state);
    }

    const response = await fetch(`${MESH_API_URL}/api/v1/linktoken`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Id": MESH_CLIENT_ID,
        "X-Client-Secret": MESH_API_KEY,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Mesh API error:", data);
      return res.status(response.status).json({
        error: "Failed to create link token",
        details: data,
      });
    }

    console.log("Link token created successfully ✓");

    // Forward order_created event to webhook
    await forwardToWebhook("order_created", { order: orderDetails });

    res.json({
      linkToken: data.content?.linkToken || data.linkToken,
      transactionId,
      orderSummary: {
        subtotal,
        tax,
        total,
      },
    });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/transfer-complete ─────────────────────────
// Called by the frontend when Mesh's onTransferFinished fires.
// Enriches the transfer data with stored order details and
// forwards everything to the external webhook URL.
app.post("/api/transfer-complete", async (req, res) => {
  try {
    const { transactionId, meshTransferPayload } = req.body;

    console.log("\n─── Transfer complete (from client SDK) ───");

    // Look up stored order
    const order = orders.get(transactionId) || null;

    const enrichedPayload = {
      order: order,
      transfer: {
        status: meshTransferPayload?.status || "unknown",
        meshTransferId: meshTransferPayload?.transferId || null,
        txHash: meshTransferPayload?.txHash || null,
        fromAddress: meshTransferPayload?.fromAddress || null,
        toAddress: meshTransferPayload?.toAddress || DESTINATION_WALLET,
        symbol: meshTransferPayload?.symbol || "USDC",
        amount: meshTransferPayload?.amount || null,
        amountInFiat: meshTransferPayload?.amountInFiat || null,
        networkName: meshTransferPayload?.networkName || "Ethereum",
        networkId: meshTransferPayload?.networkId || ETHEREUM_NETWORK_ID,
      },
      completedAt: new Date().toISOString(),
    };

    console.log("Status:", enrichedPayload.transfer.status);
    console.log("Tx Hash:", enrichedPayload.transfer.txHash);
    if (order) {
      console.log("Product:", order.productName);
      console.log("Total:", order.total, order.currency);
    }

    // Forward to external webhook
    await forwardToWebhook("transfer_complete", enrichedPayload);

    // Clean up after a delay (keep for potential Mesh webhook reconciliation)
    setTimeout(() => orders.delete(transactionId), 5 * 60 * 1000);

    res.json({ received: true });
  } catch (err) {
    console.error("transfer-complete error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/webhook ───────────────────────────────────
// Receives transfer status updates directly from Mesh.
// Enriches with stored order details and forwards to webhook.site.
app.post("/api/webhook", async (req, res) => {
  console.log("\n─── Mesh webhook received ───");
  console.log(JSON.stringify(req.body, null, 2));

  // Verify webhook signature (optional in sandbox)
  const signature = req.headers["mesh-signature"];
  if (signature && MESH_SECRET_KEY) {
    const payload = JSON.stringify(req.body);
    const expected = crypto
      .createHmac("sha256", MESH_SECRET_KEY)
      .update(payload)
      .digest("hex");
    if (signature !== expected) {
      console.warn("⚠ Webhook signature mismatch");
    } else {
      console.log("Webhook signature verified ✓");
    }
  }

  // Try to match with a stored order via transactionId
  const txId =
    req.body?.transactionId ||
    req.body?.data?.transactionId ||
    req.body?.content?.transactionId ||
    null;

  const order = txId ? orders.get(txId) || null : null;

  // Forward enriched Mesh webhook to external webhook
  await forwardToWebhook("mesh_webhook", {
    meshPayload: req.body,
    order: order,
    receivedAt: new Date().toISOString(),
  });

  res.status(200).json({ received: true });
});

// ─── GET /api/config ─────────────────────────────────────
// Sends safe, public config to the frontend (no secrets).
app.get("/api/config", (_req, res) => {
  res.json({
    clientId: MESH_CLIENT_ID,
  });
});

// ─── Fallback ────────────────────────────────────────────
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ─── Start ───────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🥾 Mesh Shoes running at http://localhost:${PORT}`);
  console.log(`   Mesh API: ${MESH_API_URL}`);
  console.log(`   Wallet:   ${DESTINATION_WALLET}`);
  console.log(`   Webhook:  ${WEBHOOK_URL}\n`);
});
