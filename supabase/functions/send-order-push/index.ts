import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type PushEvent = "new" | "completed";

type FcmServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const serviceAccountRaw = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON");

const supabase = createClient(supabaseUrl, serviceRoleKey);

function base64Url(input: Uint8Array | string) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function pemToArrayBuffer(pem: string) {
  const body = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function createGoogleAccessToken(sa: FcmServiceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const unsigned = header + "." + claim;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );

  const jwt = unsigned + "." + base64Url(new Uint8Array(signature));
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });

  if (!tokenResponse.ok) {
    throw new Error("Google OAuth token request failed: " + await tokenResponse.text());
  }
  const tokenJson = await tokenResponse.json();
  return String(tokenJson.access_token || "");
}

async function sendFcmMessage(
  accessToken: string,
  projectId: string,
  token: string,
  title: string,
  body: string,
  data: Record<string, string>
) {
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          data,
          android: {
            notification: {
              channel_id: "asil_orders",
              sound: "default",
              click_action: "FLUTTER_NOTIFICATION_CLICK"
            }
          }
        }
      })
    }
  );

  return {
    ok: response.ok,
    status: response.status,
    text: await response.text()
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    if (!serviceAccountRaw) {
      throw new Error("FCM_SERVICE_ACCOUNT_JSON is not configured");
    }

    const payload = await req.json();
    const orderId = String(payload.order_id || "");
    const event = String(payload.event || "") as PushEvent;
    const orderNumber = String(payload.order_number || "");

    if (!orderId || !["new", "completed"].includes(event)) {
      return Response.json({ error: "order_id and event(new|completed) are required" }, { status: 400 });
    }

    const serviceAccount = JSON.parse(serviceAccountRaw) as FcmServiceAccount;
    if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
      throw new Error("Invalid FCM_SERVICE_ACCOUNT_JSON");
    }

    const targetRole = event === "new" ? "preparer" : "manager";
    const title = event === "new" ? "طلبية جديدة" : "تم تحضير الطلبية";
    const body = event === "new"
      ? `تم إرسال الفاتورة رقم ${orderNumber} للتحضير.`
      : `تم الانتهاء من تحضير الفاتورة رقم ${orderNumber}.`;

    const { data: devices, error } = await supabase
      .from("push_devices")
      .select("id,token")
      .eq("role", targetRole)
      .eq("platform", "android")
      .eq("active", true);

    if (error) throw error;

    const accessToken = await createGoogleAccessToken(serviceAccount);
    const results = [];

    for (const device of devices || []) {
      const result = await sendFcmMessage(
        accessToken,
        serviceAccount.project_id,
        String(device.token),
        title,
        body,
        {
          order_id: orderId,
          order_number: orderNumber,
          event,
          role: targetRole
        }
      );

      results.push({ id: device.id, status: result.status, ok: result.ok });

      // FCM returns 404/410 for stale/unregistered tokens in common cases.
      // Disable those rows so future sends stay clean.
      if (result.status === 404 || result.status === 410) {
        await supabase.from("push_devices").update({ active: false }).eq("id", device.id);
      }
    }

    return Response.json({
      ok: true,
      event,
      target_role: targetRole,
      devices: results.length,
      results
    });
  } catch (error) {
    console.error("send-order-push:", error);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
});
