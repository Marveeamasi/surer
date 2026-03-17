import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { FeeCalculator, calculateFee, useFeeSettings } from "@/components/FeeCalculator";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import AppLayout from "@/components/AppLayout";
import PinVerifyDialog from "@/components/PinVerifyDialog";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/supabase";
import { toast } from "sonner";

const CreateReceipt = () => {
  const [searchParams] = useSearchParams();
  const isReceiverParam = searchParams.get("user") === "receiver";
  const { user } = useAuth();
  const navigate = useNavigate();

  const [counterpartyEmail, setCounterpartyEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [iAmReceiver, setIAmReceiver] = useState(isReceiverParam);
  const [loading, setLoading] = useState(false);

  // PIN verify
  const [pinOpen, setPinOpen] = useState(false);

  // Fetch fee settings once — shared between FeeCalculator display and insert
  const { settings: feeSettings, loading: feeLoading } = useFeeSettings();

  const numericAmount = parseFloat(amount) || 0;

  // ── Create receipt (after PIN verified) ─────────────────────────────────

  const executeCreate = async () => {
    if (!user) return;
    if (numericAmount < 1000) {
      toast.error("Minimum amount is ₦1,000");
      return;
    }

    setLoading(true);

    // Calculate the single protection fee using current admin settings
    const protectionFee = calculateFee(numericAmount, feeSettings);

    const receiptData: any = {
      amount: numericAmount,
      description,
      created_by: user.id,
      // UPDATED: single protection_fee column (replaces surer_fee + payscrow_fee)
      protection_fee: protectionFee,
      status: "pending",
    };

    if (iAmReceiver) {
      // Receiver creates the receipt and invites sender
      receiptData.receiver_id = user.id;
      receiptData.receiver_email = user.email;
      // sender_id will be set when the actual sender pays
      // For now use user.id as placeholder so RLS doesn't block
      receiptData.sender_id = user.id;
    } else {
      // Sender creates the receipt
      receiptData.sender_id = user.id;
      receiptData.receiver_email = counterpartyEmail;
    }

    const { error } = await db.from("receipts").insert(receiptData);
    setLoading(false);

    if (error) {
      toast.error(error.message || "Failed to create receipt");
    } else {
      toast.success("Receipt created!");
      navigate("/dashboard");
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (numericAmount < 1000) {
      toast.error("Minimum amount is ₦1,000");
      return;
    }
    setPinOpen(true);
  };

  return (
    <AppLayout showBottomNav>
      <div className="pt-24 pb-16 px-4">
        <div className="container mx-auto max-w-lg">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Dashboard
          </Link>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="font-display text-2xl font-bold text-foreground mb-1">
              Create Receipt
            </h1>
            <p className="text-sm text-muted-foreground mb-8">
              Set up a secure payment in seconds.
            </p>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Receiver toggle */}
              <div className="flex items-center gap-3 bg-secondary rounded-xl p-4">
                <Checkbox
                  id="receiver"
                  checked={iAmReceiver}
                  onCheckedChange={(c) => {
                    setIAmReceiver(!!c);
                    if (c) setCounterpartyEmail("");
                  }}
                />
                <label
                  htmlFor="receiver"
                  className="text-sm font-medium text-foreground cursor-pointer"
                >
                  I am receiving money
                </label>
              </div>

              {/* Email fields */}
              {iAmReceiver ? (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">
                      My Email (Receiver)
                    </label>
                    <Input
                      type="email"
                      value={user?.email || ""}
                      readOnly
                      className="h-12 bg-muted cursor-not-allowed"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">
                      Sender's Email
                    </label>
                    <Input
                      type="email"
                      placeholder="sender@example.com"
                      value={counterpartyEmail}
                      onChange={(e) => setCounterpartyEmail(e.target.value)}
                      required
                      className="h-12"
                    />
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Receiver's Email
                  </label>
                  <Input
                    type="email"
                    placeholder="receiver@example.com"
                    value={counterpartyEmail}
                    onChange={(e) => setCounterpartyEmail(e.target.value)}
                    required
                    className="h-12"
                  />
                </div>
              )}

              {/* Amount */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Amount (₦)
                </label>
                <Input
                  type="number"
                  placeholder="10,000"
                  min="1000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                  className="h-12 text-lg font-semibold"
                />
              </div>

              {/* Fee display — uses admin-fetched settings, shows single protection fee */}
              {!feeLoading && (
                <FeeCalculator amount={numericAmount} feeSettings={feeSettings} />
              )}

              {/* Description */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Description
                </label>
                <Textarea
                  placeholder="What's this payment for? (e.g., Logo design, Phone purchase)"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                  rows={3}
                />
              </div>

              <Button
                variant="hero"
                size="lg"
                className="w-full"
                disabled={loading || feeLoading}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Creating...
                  </>
                ) : (
                  <>
                    Create Receipt <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </Button>
            </form>
          </motion.div>
        </div>
      </div>

      <PinVerifyDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        onVerified={executeCreate}
        title="Confirm Receipt Creation"
        description="Enter your PIN to create this receipt."
      />
    </AppLayout>
  );
};

export default CreateReceipt;