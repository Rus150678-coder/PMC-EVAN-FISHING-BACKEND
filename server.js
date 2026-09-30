require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json({ limit: "100kb" }));

const port = Number(process.env.PORT || 10000);
const supabaseUrl = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_ANON_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !publishableKey || !secretKey) {
  console.warn("Missing Supabase environment variables. Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) in Render.");
}

const sb = createClient(supabaseUrl, secretKey);
const adminAuth = createClient(supabaseUrl, publishableKey);

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "PMC EVAN FISHING V3.5", time: new Date().toISOString() });
});

async function requireAdmin(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = header.slice(7).trim();
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const userResult = await adminAuth.auth.getUser(token);
    if (userResult.error || !userResult.data.user) {
      return res.status(401).json({ error: "Invalid session" });
    }

    const adminResult = await sb
      .from("admins")
      .select("user_id")
      .eq("user_id", userResult.data.user.id)
      .maybeSingle();

    if (adminResult.error) {
      return res.status(500).json({ error: adminResult.error.message });
    }

    if (!adminResult.data) {
      return res.status(403).json({ error: "Admin access required" });
    }

    req.user = userResult.data.user;
    next();
  } catch (error) {
    console.error("Admin auth error:", error);
    res.status(500).json({ error: "Auth error" });
  }
}

app.get("/admin/bookings", requireAdmin, async (req, res) => {
  const result = await sb
    .from("bookings")
    .select("*")
    .order("slot_no", { ascending: true });

  if (result.error) return res.status(500).json({ error: result.error.message });
  res.json({ data: result.data || [] });
});

app.patch("/admin/bookings/:slot", requireAdmin, async (req, res) => {
  const slot = Number(req.params.slot);
  if (!Number.isInteger(slot) || slot < 1 || slot > 32) {
    return res.status(400).json({ error: "Invalid slot" });
  }

  const body = {};

  if (typeof req.body?.angler_name === "string") {
    const name = req.body.angler_name.trim();
    if (!name || name.length > 60) {
      return res.status(400).json({ error: "Invalid angler name" });
    }
    body.angler_name = name;
  }

  if (typeof req.body?.dp_status === "string") {
    const status = req.body.dp_status.trim().toUpperCase();
    if (!["BELUM BAYAR", "DP", "LUNAS"].includes(status)) {
      return res.status(400).json({ error: "Invalid DP status" });
    }
    body.dp_status = status;
  }

  if (Object.keys(body).length === 0) {
    return res.status(400).json({ error: "No changes supplied" });
  }

  body.updated_at = new Date().toISOString();

  const result = await sb
    .from("bookings")
    .update(body)
    .eq("slot_no", slot)
    .select("*")
    .maybeSingle();

  if (result.error) return res.status(500).json({ error: result.error.message });
  if (!result.data) return res.status(404).json({ error: "Booking not found" });

  res.json({ ok: true, data: result.data });
});

app.delete("/admin/bookings/:slot", requireAdmin, async (req, res) => {
  const slot = Number(req.params.slot);
  if (!Number.isInteger(slot) || slot < 1 || slot > 32) {
    return res.status(400).json({ error: "Invalid slot" });
  }

  const result = await sb
    .from("bookings")
    .delete()
    .eq("slot_no", slot)
    .select("slot_no")
    .maybeSingle();

  if (result.error) return res.status(500).json({ error: result.error.message });
  if (!result.data) return res.status(404).json({ error: "Booking not found" });

  res.json({ ok: true, slot: result.data.slot_no });
});

// WhatsApp Cloud API webhook verification
app.get("/webhook/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token && token === process.env.WA_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// WhatsApp Cloud API webhook receiver
app.post("/webhook/whatsapp", async (req, res) => {
  // Respond immediately so Meta does not retry while database work is running.
  res.sendStatus(200);

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const messages = value?.messages || [];

    for (const message of messages) {
      if (message.type !== "text") continue;

      const text = (message.text?.body || "").trim();
      const match = text.match(/^BOOKING\s+([1-9]|[12][0-9]|3[0-2])\s+(.+)$/i);
      if (!match) continue;

      const slot = Number(match[1]);
      const name = match[2].trim().replace(/\s+/g, " ");
      const replyTo = message.from;

      if (!name || name.length > 60) {
        await sendWA(replyTo, "❌ Nama tidak valid. Maksimal 60 karakter.");
        continue;
      }

      // Insert directly so two simultaneous requests cannot both pass a prior SELECT.
      const insert = await sb
        .from("bookings")
        .insert({
          slot_no: slot,
          angler_name: name,
          booking_date: "2026-10-04",
          dp_status: "BELUM BAYAR"
        });

      if (insert.error) {
        if (insert.error.code === "23505") {
          const current = await sb
            .from("bookings")
            .select("angler_name")
            .eq("slot_no", slot)
            .maybeSingle();

          const currentName = current.data?.angler_name || "peserta lain";
          await sendWA(
            replyTo,
            `❌ Nomor ${slot} sudah terisi oleh ${currentName}. Silakan pilih nomor lain.`
          );
        } else {
          console.error("WhatsApp booking insert error:", insert.error);
          await sendWA(replyTo, "❌ Booking gagal disimpan. Silakan coba lagi.");
        }
        continue;
      }

      await sendWA(
        replyTo,
        `✅ BOOKING BERHASIL\nNomor: ${slot}\nNama: ${name}\nTanggal: 4 Oktober 2026\nStatus: BELUM BAYAR\n\n🔒 Data terkunci. Edit/hapus hanya oleh ADMIN.`
      );
    }
  } catch (error) {
    console.error("WhatsApp webhook error:", error);
  }
});

async function sendWA(to, text) {
  const token = process.env.WA_ACCESS_TOKEN;
  const phoneNumberId = process.env.WA_PHONE_NUMBER_ID;
  const graphVersion = process.env.WA_GRAPH_VERSION;

  if (!token || !phoneNumberId || !graphVersion) {
    console.warn("WhatsApp credentials are not configured; reply was not sent.");
    return;
  }

  const url = `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    console.error("WhatsApp API error:", response.status, body);
  }
}

app.listen(port, "0.0.0.0", () => {
  console.log(`PMC EVAN FISHING V3.5 backend listening on ${port}`);
});
