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

    // If no Payscrow transaction exists (dev/test), just update local status
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

    // Step 1: Check current Payscrow transaction status
    let payscrowStatus: any = null;
    try {
      const statusRes = await fetch(
        `${PAYSCROW_API_BASE}/transactions/${transactionNumber}/status`,
        { headers: { BrokerApiKey: payscrowApiKey } }
      );
      payscrowStatus = await statusRes.json();
      console.log("Payscrow status:", JSON.stringify(payscrowStatus));
    } catch (e) {
      console.error("Failed to get Payscrow status:", e);
    }

    // Step 2: Raise dispute on Payscrow to communicate our settlement decision
    // This is how brokers tell Payscrow what to do with the escrowed funds
    let complaint = "";
    let requestedBy = "customer"; // Default: customer (sender) perspective

    const releaseAmt = amount || receipt.sender_decision_amount || 0;
    const refundAmt = receipt.amount - releaseAmt;

    switch (decision) {
      case "release_all":
        // Full release to merchant (receiver)
        complaint = `BROKER SETTLEMENT DECISION: Release full escrow amount of ${receipt.amount} NGN to the merchant (receiver). ` +
          `Transaction ref: ${receipt.payscrow_transaction_ref}. ` +
          `Both parties have agreed to full release. Please settle the full amount to the merchant's settlement account as configured.`;
        requestedBy = "customer"; // Customer requesting release to merchant
        break;

      case "release_specific":
        // Partial: specific amount to merchant, remainder refunded to customer
        complaint = `BROKER SETTLEMENT DECISION: Partial settlement required. ` +
          `Release ${releaseAmt} NGN to the merchant (receiver) and refund ${refundAmt} NGN to the customer (sender). ` +
          `Transaction ref: ${receipt.payscrow_transaction_ref}. ` +
          `Reason: ${receipt.sender_decision_reason || "Partial delivery or mutual agreement"}.`;
        requestedBy = "customer";
        break;

      case "refund":
        // Full refund to customer (sender)
        complaint = `BROKER SETTLEMENT DECISION: Full refund of ${receipt.amount} NGN to the customer (sender). ` +
          `No payment to merchant. Transaction ref: ${receipt.payscrow_transaction_ref}. ` +
          `Reason: ${receipt.sender_decision_reason || "Non-delivery or agreement to refund"}.`;
        requestedBy = "customer";
        break;

      default:
        complaint = `BROKER SETTLEMENT DECISION: ${decision} for transaction ${receipt.payscrow_transaction_ref}. Amount: ${amount || receipt.amount} NGN.`;
    }

    // Raise dispute on Payscrow if transaction is in escrow and eligible
    const canRaiseDispute = payscrowStatus?.data?.inEscrow === true &&
      payscrowStatus?.data?.inDispute === false &&
      payscrowStatus?.data?.statusId === 2; // In Progress

    let disputeRaised = false;

    if (canRaiseDispute) {
      try {
        const disputeRes = await fetch(
          `${PAYSCROW_API_BASE}/transactions/${transactionNumber}/broker/raise-dispute`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              BrokerApiKey: payscrowApiKey,
            },
            body: JSON.stringify({ requestedBy, complaint }),
          }
        );
        const disputeData = await disputeRes.json();
        console.log("Payscrow dispute raised:", JSON.stringify(disputeData));
        disputeRaised = disputeRes.ok && disputeData.success;

        if (!disputeRes.ok) {
          console.error("Payscrow dispute raise failed:", JSON.stringify(disputeData));
        }
      } catch (e) {
        console.error("Failed to raise Payscrow dispute:", e);
      }
    } else {
      console.log("Cannot raise dispute on Payscrow - status:", JSON.stringify(payscrowStatus?.data));
      // If already in dispute or finalized, we still update local status
    }

    // Step 3: Update local receipt status to completed
    await supabaseAdmin
      .from("receipts")
      .update({
        status: "completed",
        decision_auto_execute_at: null,
      })
      .eq("id", receiptId);

    // Step 4: Clean up disputes and evidence
    await cleanupDisputes(supabaseAdmin, receiptId);

    // Step 5: Send completion notification
    await sendCompletionNotification(receiptId, decision);

    return new Response(
      JSON.stringify({
        success: true,
        decision,
        payscrowDisputeRaised: disputeRaised,
        transactionNumber,
        message: disputeRaised
          ? "Decision submitted to Payscrow for settlement processing."
          : "Decision recorded locally. Payscrow settlement may require manual follow-up.",
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
      // Delete evidence files from storage
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
