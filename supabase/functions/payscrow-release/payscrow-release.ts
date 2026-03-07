import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PAYSCROW_API_BASE = "https://api.payscrow.net/api/v3/marketplace";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { receiptId, decision, amount } = await req.json();

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const payscrowApiKey = Deno.env.get("PAYSCROW_BROKER_API_KEY");
    if (!payscrowApiKey) {
      return new Response(JSON.stringify({ error: "Payscrow not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch receipt
    const { data: receipt, error: receiptError } = await supabaseAdmin
      .from("receipts")
      .select("*")
      .eq("id", receiptId)
      .single();

    if (receiptError || !receipt) {
      return new Response(JSON.stringify({ error: "Receipt not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const transactionNumber = receipt.payscrow_transaction_number;

    // If no Payscrow transaction (dev/test), just update local status
    if (!transactionNumber) {
      console.log("No Payscrow transaction for receipt:", receiptId, "- updating local status only");
      await supabaseAdmin.from("receipts").update({
        status: "completed",
        decision_auto_execute_at: null,
      }).eq("id", receiptId);
      await cleanupDisputes(supabaseAdmin, receiptId);
      await sendCompletionNotification(receiptId, decision);
      return new Response(JSON.stringify({ success: true, message: "Completed locally (no Payscrow transaction)" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ============================================================
    // FETCH ALL REQUIRED BANK DETAILS
    // ============================================================

    // Admin profile (for 1.5% platform fee)
    const { data: adminRole } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin")
      .limit(1)
      .maybeSingle();

    let adminProfile: any = null;
    if (adminRole) {
      const { data } = await supabaseAdmin
        .from("profiles")
        .select("*")
        .eq("id", adminRole.user_id)
        .single();
      adminProfile = data;
    }

    // Sender profile
    const { data: senderProfile } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", receipt.sender_id)
      .single();

    // Receiver profile
    const { data: receiverProfile } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("email", receipt.receiver_email)
      .maybeSingle();

    // ============================================================
    // BUILD SETTLEMENT ARRAY
    // ============================================================
    const adminFee = receipt.surer_fee || Math.round(receipt.amount * 0.015 * 100) / 100;
    const baseAmount = receipt.amount; // The actual transaction amount (excluding admin fee)
    const settlements: any[] = [];

    // 1. Always pay the Admin their 1.5% platform fee
    if (adminProfile?.bank_code && adminProfile?.account_number && adminProfile?.account_name) {
      settlements.push({
        bankCode: adminProfile.bank_code,
        accountNumber: adminProfile.account_number,
        accountName: adminProfile.account_name,
        amount: adminFee,
      });
    } else {
      console.warn("Admin bank details not configured! Platform fee cannot be settled.");
    }

    // 2. Decision-based fund distribution
    if (decision === "release_all") {
      // Full release to receiver
      if (!receiverProfile?.bank_code || !receiverProfile?.account_number) {
        console.error("Receiver bank details missing for settlement");
        return new Response(JSON.stringify({ error: "Receiver bank details not set. Cannot settle." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      settlements.push({
        bankCode: receiverProfile.bank_code,
        accountNumber: receiverProfile.account_number,
        accountName: receiverProfile.account_name || receiverProfile.display_name || "Receiver",
        amount: baseAmount,
      });
    } else if (decision === "refund") {
      // Full refund to sender
      if (!senderProfile?.bank_code || !senderProfile?.account_number) {
        console.error("Sender bank details missing for refund");
        return new Response(JSON.stringify({ error: "Sender bank details not set. Cannot refund." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      settlements.push({
        bankCode: senderProfile.bank_code,
        accountNumber: senderProfile.account_number,
        accountName: senderProfile.account_name || senderProfile.display_name || "Sender",
        amount: baseAmount,
      });
    } else if (decision === "release_specific") {
      // Partial: specific amount to receiver, remainder to sender
      const releaseAmt = amount || receipt.sender_decision_amount || 0;
      const refundAmt = baseAmount - releaseAmt;

      if (releaseAmt > 0) {
        if (!receiverProfile?.bank_code || !receiverProfile?.account_number) {
          return new Response(JSON.stringify({ error: "Receiver bank details not set. Cannot settle partial." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        settlements.push({
          bankCode: receiverProfile.bank_code,
          accountNumber: receiverProfile.account_number,
          accountName: receiverProfile.account_name || "Receiver",
          amount: releaseAmt,
        });
      }

      if (refundAmt > 0) {
        if (!senderProfile?.bank_code || !senderProfile?.account_number) {
          return new Response(JSON.stringify({ error: "Sender bank details not set. Cannot refund remainder." }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        settlements.push({
          bankCode: senderProfile.bank_code,
          accountNumber: senderProfile.account_number,
          accountName: senderProfile.account_name || "Sender",
          amount: refundAmt,
        });
      }
    }

    console.log("Settlement array:", JSON.stringify(settlements));

    // ============================================================
    // CALL PAYSCROW /broker/settle
    // ============================================================
    const settleRes = await fetch(
      `${PAYSCROW_API_BASE}/transactions/${transactionNumber}/broker/settle`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          BrokerApiKey: payscrowApiKey,
        },
        body: JSON.stringify({ settlements }),
      }
    );

    const settleData = await settleRes.json();
    console.log("Payscrow settle response:", JSON.stringify(settleData));

    if (!settleRes.ok || !settleData.success) {
      const errorMsg = settleData.message || settleData.errors || "Settlement failed on Payscrow";
      console.error("Payscrow settle failed:", JSON.stringify(settleData));
      return new Response(JSON.stringify({ 
        error: `Settlement failed: ${typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg)}`,
        payscrowResponse: settleData,
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ============================================================
    // UPDATE LOCAL DB
    // ============================================================
    await supabaseAdmin
      .from("receipts")
      .update({
        status: "completed",
        decision_auto_execute_at: null,
      })
      .eq("id", receiptId);

    // Clean up disputes and evidence
    await cleanupDisputes(supabaseAdmin, receiptId);

    // Send completion notification
    await sendCompletionNotification(receiptId, decision);

    return new Response(
      JSON.stringify({
        success: true,
        decision,
        settlements: settlements.length,
        transactionNumber,
        message: "Settlement executed via Payscrow. Funds being sent to bank accounts.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Release error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function cleanupDisputes(supabaseAdmin: any, receiptId: string) {
  const { data: disputes } = await supabaseAdmin
    .from("disputes")
    .select("id")
    .eq("receipt_id", receiptId);

  if (disputes && disputes.length > 0) {
    for (const d of disputes) {
      const { data: evidenceFiles } = await supabaseAdmin
        .from("evidence")
        .select("file_path")
        .eq("dispute_id", d.id);

      if (evidenceFiles && evidenceFiles.length > 0) {
        const paths = evidenceFiles.map((e: any) => e.file_path);
        await supabaseAdmin.storage.from("evidence").remove(paths);
        await supabaseAdmin.from("evidence").delete().eq("dispute_id", d.id);
      }

      await supabaseAdmin
        .from("disputes")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("id", d.id);
    }
  }
}

async function sendCompletionNotification(receiptId: string, decision: string) {
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-notification-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        type: "dispute_resolved",
        receiptId,
        decision,
      }),
    });
  } catch (e) {
    console.error("Failed to send completion notification:", e);
  }
}
