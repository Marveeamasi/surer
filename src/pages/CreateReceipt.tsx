import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { FeeCalculator, calculateFees } from "@/components/FeeCalculator";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import AppLayout from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/supabase";
import { toast } from "sonner";

const CreateReceipt = () => {
  const [searchParams] = useSearchParams();
  const isReceiver = searchParams.get("user") === "receiver";
  const { user } = useAuth();
  const navigate = useNavigate();

  const [receiverEmail, setReceiverEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [iAmReceiver, setIAmReceiver] = useState(isReceiver);
  const [loading, setLoading] = useState(false);

  const numericAmount = parseFloat(amount) || 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setLoading(true);
    const fees = calculateFees(numericAmount);

    const receiptData: any = {
      sender_id: iAmReceiver ? undefined : user.id,
      receiver_email: iAmReceiver ? user.email! : receiverEmail,
      amount: numericAmount,
      description,
      created_by: user.id,
      surer_fee: fees.surerFee,
      payscrow_fee: fees.payscrowFee,
      status: "pending",
    };

    if (iAmReceiver) {
      receiptData.receiver_id = user.id;
      receiptData.sender_id = user.id; // Placeholder, will be updated when sender pays
      receiptData.receiver_email = receiverEmail; // This is actually the sender's email in this case
    } else {
      receiptData.sender_id = user.id;
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

  return (
    <AppLayout showBottomNav>
      <div className="pt-24 pb-16 px-4">
        <div className="container mx-auto max-w-lg">
          <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
            <ArrowLeft className="w-4 h-4" /> Back to Dashboard
          </Link>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="font-display text-2xl font-bold text-foreground mb-1">Create Receipt</h1>
            <p className="text-sm text-muted-foreground mb-8">Set up a secure payment in seconds.</p>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="flex items-center gap-3 bg-secondary rounded-xl p-4">
                <Checkbox id="receiver" checked={iAmReceiver} onCheckedChange={(c) => setIAmReceiver(!!c)} />
                <label htmlFor="receiver" className="text-sm font-medium text-foreground cursor-pointer">
                  I am receiving money
                </label>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  {iAmReceiver ? "Sender's Email" : "Receiver's Email"}
                </label>
                <Input
                  type="email"
                  placeholder="them@example.com"
                  value={receiverEmail}
                  onChange={(e) => setReceiverEmail(e.target.value)}
                  required
                  className="h-12"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Amount (₦)</label>
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

              <FeeCalculator amount={numericAmount} />

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Description</label>
                <Textarea
                  placeholder="What's this payment for? (e.g., Logo design, Phone purchase)"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                  rows={3}
                />
              </div>

              <Button variant="hero" size="lg" className="w-full" disabled={loading}>
                {loading ? "Creating..." : "Create Receipt"} <ArrowRight className="w-5 h-5" />
              </Button>
            </form>
          </motion.div>
        </div>
      </div>
    </AppLayout>
  );
};

export default CreateReceipt;
