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

// ─── POST /api/create-link-token ──────────────────────────
// Called by the frontend when the user clicks "Checkout with Mesh".
// Generates a one-time linkToken that opens the Mesh Link UI
// configured for a USDC-on-Ethereum payment to our wallet.
app.post("/api/create-link-token", async (req, res) => {
  try {
    const { amount, userId, shippingAddress } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const transactionId = uuidv4();

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
            amount: amount,
          },
        ],
        fundingOptions: {
          enabled: true,
        },
      },
    };

    console.log("\n─── Creating link token ───");
    console.log("Amount:", amount, "USDC");
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

    res.json({
      linkToken: data.content?.linkToken || data.linkToken,
      transactionId,
    });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/webhook ───────────────────────────────────
// Receives transfer status updates from Mesh.
// In production, verify the signature with MESH_SECRET_KEY.
app.post("/api/webhook", (req, res) => {
  console.log("\n─── Webhook received ───");
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
