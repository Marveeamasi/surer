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

    // If no Payscrow transaction exists, just update local status
    if (!transactionNumber) {
      console.log("No Payscrow transaction for receipt:", receiptId, "- updating local status only");
      await supabaseAdmin.from("receipts").update({ status: "completed" }).eq("id", receiptId);
      await cleanupDisputes(supabaseAdmin, receiptId);
      await sendCompletionNotification(receiptId);
      return new Response(JSON.stringify({ success: true, message: "Completed locally (no Payscrow transaction)" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 1: Check current Payscrow transaction status
    let payscrowStatus;
    try {
      const statusRes = await fetch(
        `${PAYSCROW_API_BASE}/transactions/${transactionNumber}/status`,
        {
          headers: { BrokerApiKey: payscrowApiKey },
        }
      );
      payscrowStatus = await statusRes.json();
      console.log("Payscrow status for", transactionNumber, ":", JSON.stringify(payscrowStatus));
    } catch (e) {
      console.error("Failed to get Payscrow status:", e);
    }

    // Step 2: Raise dispute on Payscrow with the broker decision
    // This communicates our decision to Payscrow's dispute resolution team
    let disputeComplaint = "";
    let requestedBy = "";

    switch (decision) {
      case "release_all":
        // Full release to merchant (receiver) - raise as customer requesting release
        disputeComplaint = `BROKER DECISION: Full release of ${receipt.amount} NGN to merchant. Both parties have agreed or auto-execute timer expired. Transaction ref: ${receipt.payscrow_transaction_ref}. Please release full escrow amount to the merchant.`;
        requestedBy = "customer";
        break;

      case "release_specific":
        // Partial release - specified amount to merchant, rest refunded
        const releaseAmt = amount || receipt.sender_decision_amount || 0;
        const refundAmt = receipt.amount - releaseAmt;
        disputeComplaint = `BROKER DECISION: Partial release. Release ${releaseAmt} NGN to merchant, refund ${refundAmt} NGN to customer. Transaction ref: ${receipt.payscrow_transaction_ref}. Reason: ${receipt.sender_decision_reason || "Partial delivery/agreement"}.`;
        requestedBy = "customer";
        break;

      case "refund":
        // Full refund to customer (sender)
        disputeComplaint = `BROKER DECISION: Full refund of ${receipt.amount} NGN to customer. Transaction ref: ${receipt.payscrow_transaction_ref}. Reason: ${receipt.sender_decision_reason || "Non-delivery or mutual agreement"}.`;
        requestedBy = "customer";
        break;

      default:
        disputeComplaint = `BROKER DECISION: ${decision} for transaction ${receipt.payscrow_transaction_ref}. Amount: ${amount || receipt.amount} NGN.`;
        requestedBy = "customer";
    }

    // Only raise dispute if transaction is in escrow and not already in dispute/finalized
    const canRaiseDispute = payscrowStatus?.data?.inEscrow === true && 
                            payscrowStatus?.data?.inDispute === false &&
                            payscrowStatus?.data?.statusId === 2; // In Progress

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
            body: JSON.stringify({
              requestedBy,
              complaint: disputeComplaint,
            }),
          }
        );
        const disputeData = await disputeRes.json();
        console.log("Payscrow dispute raised:", JSON.stringify(disputeData));

        if (!disputeRes.ok) {
          console.error("Payscrow dispute raise failed:", disputeData);
          // Still continue to update local status
        }
      } catch (e) {
        console.error("Failed to raise Payscrow dispute:", e);
      }
    } else {
      console.log("Cannot raise Payscrow dispute - transaction state:", JSON.stringify(payscrowStatus?.data));
      // If already in dispute or completed, just log it
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

    // Step 5: Send notification
    await sendCompletionNotification(receiptId);

    return new Response(
      JSON.stringify({
        success: true,
        decision,
        payscrowDisputeRaised: canRaiseDispute,
        transactionNumber,
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

async function sendCompletionNotification(receiptId: string) {
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
      }),
    });
  } catch (e) {
    console.error("Failed to send completion notification:", e);
  }
}
