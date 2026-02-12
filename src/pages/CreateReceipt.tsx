import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { FeeCalculator } from "@/components/FeeCalculator";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import Navbar from "@/components/Navbar";

const CreateReceipt = () => {
  const [searchParams] = useSearchParams();
  const isReceiver = searchParams.get("user") === "receiver";

  const [receiverEmail, setReceiverEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [iAmReceiver, setIAmReceiver] = useState(isReceiver);

  const numericAmount = parseFloat(amount) || 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Will integrate with backend
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-24 pb-16 px-4">
        <div className="container mx-auto max-w-lg">
          <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
            <ArrowLeft className="w-4 h-4" /> Back to Dashboard
          </Link>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="font-display text-2xl font-bold text-foreground mb-1">Create Receipt</h1>
            <p className="text-sm text-muted-foreground mb-8">Set up a secure payment in seconds.</p>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Receiver checkbox */}
              <div className="flex items-center gap-3 bg-secondary rounded-xl p-4">
                <Checkbox
                  id="receiver"
                  checked={iAmReceiver}
                  onCheckedChange={(c) => setIAmReceiver(!!c)}
                />
                <label htmlFor="receiver" className="text-sm font-medium text-foreground cursor-pointer">
                  I am receiving money
                </label>
              </div>

              {/* Email */}
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

              {/* Amount */}
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

              {/* Live fee display */}
              <FeeCalculator amount={numericAmount} />

              {/* Description */}
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

              <Button variant="hero" size="lg" className="w-full">
                Create Receipt <ArrowRight className="w-5 h-5" />
              </Button>
            </form>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default CreateReceipt;
